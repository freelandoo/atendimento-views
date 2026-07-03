'use strict'

// Playbook de Atendimento — coleta os dados públicos/operacionais de um vendedor
// na "API de Dados da Freelandoo" e gera um documento Markdown de base de
// conhecimento (usado por atendente humano ou bot).
//
// Camadas:
//  - montarAgregado(raw): função PURA (testável) que normaliza e correlaciona os
//    JSONs crus dos 7 endpoints em um único objeto por perfil. Converte centavos
//    → R$, filtra itens ativos (produtos: moderation_status='active').
//  - coletarDados(client): dispara os 7 GETs em paralelo; se algum falhar, segue
//    com o que veio e registra a seção como faltante em `avisos`.
//  - gerarPlaybook({...}): orquestra coleta → agregação → LLM → Markdown + rodapé.
//
// NUNCA logar/persistir o token: ele só transita por parâmetro para o client.

const { criarDataClient } = require('../freelandoo/data-client')
const { generateAIResponse } = require('../ai-provider')

const FMT_BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// centavos (inteiro) → "R$ 50,00". Retorna null quando não há valor.
function centavosParaBRL(centavos) {
  // Distingue "sem valor" (null/undefined/'') de um preço legítimo de 0 (grátis):
  // Number(null) é 0, então o guard precisa checar nulidade ANTES de converter.
  if (centavos === null || centavos === undefined || centavos === '') return null
  const n = Number(centavos)
  if (!Number.isFinite(n)) return null
  return FMT_BRL.format(n / 100)
}

function arr(v, chave) {
  if (Array.isArray(v)) return v
  if (v && Array.isArray(v[chave])) return v[chave]
  return []
}

// Monta o objeto agregado que vai para a LLM. Entrada: os JSONs crus (ou null se
// o endpoint falhou). Saída: { conta, perfis[], cursos[], metricas, gerado_em }.
function montarAgregado({ me, profiles, services, products, social, courses, metrics } = {}) {
  const perfisRaw = arr(profiles, 'profiles')
  const servicosRaw = arr(services, 'services')
  const produtosRaw = arr(products, 'products')
  const socialRaw = arr(social, 'social')
  const cursosRaw = arr(courses, 'courses')

  // Índice de perfis por id_profile para correlacionar serviços/produtos/social.
  const porId = new Map()
  const perfis = perfisRaw
    .filter((p) => p && p.is_active !== false)
    .map((p) => {
      const entry = {
        id_profile: p.id_profile,
        username: p.username || null,
        display_name: p.display_name || null,
        bio: p.bio || null,
        profissao: p.profession || null,
        enxame: p.enxame_name || p.enxame_slug || null,
        cidade: [p.municipio, p.estado].filter(Boolean).join(' - ') || null,
        tipo: p.is_community ? 'comunidade' : (p.is_clan ? 'clã' : (p.is_user_account ? 'conta' : 'perfil')),
        seguidores: Number(p.followers) || 0,
        nivel: Number(p.level) || 0,
        servicos: [],
        produtos: [],
        social: [],
      }
      porId.set(p.id_profile, entry)
      return entry
    })

  // Serviços ativos, agrupados por perfil.
  for (const s of servicosRaw) {
    if (!s || s.is_active !== true) continue
    const alvo = porId.get(s.id_profile)
    if (!alvo) continue
    alvo.servicos.push({
      nome: s.name || null,
      descricao: s.description || null,
      duracao_min: Number.isFinite(Number(s.duration_minutes)) ? Number(s.duration_minutes) : null,
      preco: centavosParaBRL(s.price_amount),
    })
  }

  // Produtos ativos e moderados, com disponibilidade por estoque.
  for (const p of produtosRaw) {
    if (!p || p.is_active !== true || p.moderation_status !== 'active') continue
    const alvo = porId.get(p.id_profile)
    if (!alvo) continue
    const estoque = Number(p.stock_quantity)
    alvo.produtos.push({
      nome: p.name || null,
      descricao: p.description || null,
      preco: centavosParaBRL(p.price_amount),
      disponibilidade: Number.isFinite(estoque) ? (estoque > 0 ? 'em estoque' : 'esgotado') : 'não informado',
    })
  }

  // Redes sociais e telefone, por perfil.
  for (const s of socialRaw) {
    if (!s) continue
    const alvo = porId.get(s.id_profile)
    if (!alvo) continue
    alvo.social.push({
      rede: s.network || null,
      url: s.url || null,
      faixa_seguidores: s.follower_range || null,
      telefone: s.phone_number_normalized || null,
    })
  }

  // Cursos: preço em price_cents; status published/rascunho preservado.
  const cursos = cursosRaw.map((c) => ({
    titulo: c.title || null,
    resumo: c.short_description || null,
    preco: centavosParaBRL(c.price_cents),
    aulas: Number.isFinite(Number(c.lessons_count)) ? Number(c.lessons_count) : null,
    modulos: Number.isFinite(Number(c.modules_count)) ? Number(c.modules_count) : null,
    alunos: Number.isFinite(Number(c.students_count)) ? Number(c.students_count) : null,
    status: c.status || null,
  }))

  const metricas = metrics ? {
    seguidores_total: Number(metrics?.totals?.followers) || 0,
    por_perfil: arr(metrics?.per_profile).map((m) => ({
      display_name: m.display_name || null,
      seguidores: Number(m.followers) || 0,
      nivel: Number(m.level) || 0,
      is_community: !!m.is_community,
      is_clan: !!m.is_clan,
    })),
  } : null

  const conta = me ? {
    username: me.username || null,
    nivel: me.level || null,
    totais: me.counts || null,
  } : null

  return { conta, perfis, cursos, metricas, gerado_em: new Date().toISOString() }
}

const ROTULO_SECAO = {
  me: 'conta (/me)',
  profiles: 'perfis',
  services: 'serviços',
  products: 'produtos',
  social: 'redes sociais',
  courses: 'cursos',
  metrics: 'métricas',
}

// Dispara os 7 endpoints em paralelo. Se algum falhar, guarda null e registra o
// aviso; a geração segue com o que veio (seções faltantes viram "(não informado)").
async function coletarDados(client) {
  const chaves = ['me', 'profiles', 'services', 'products', 'social', 'courses', 'metrics']
  const resultados = await Promise.allSettled(chaves.map((k) => client[k]()))
  const raw = {}
  const avisos = []
  let primeiroErro = null
  chaves.forEach((k, i) => {
    const r = resultados[i]
    if (r.status === 'fulfilled') {
      raw[k] = r.value
    } else {
      raw[k] = null
      if (!primeiroErro) primeiroErro = r.reason
      avisos.push(`Não foi possível carregar ${ROTULO_SECAO[k]}: ${r.reason?.message || 'erro'}`)
    }
  })
  return { raw, avisos, primeiroErro }
}

const SYSTEM_PROMPT = `Você é um assistente que cria PLAYBOOKS DE CONTEXTO para equipes de atendimento.
Recebe um JSON com os dados públicos/operacionais de um vendedor da plataforma
Freelandoo (perfis, serviços, produtos, cursos, redes sociais e métricas) e produz
um documento em Markdown, em português, que um atendente humano ou bot usará como
base de conhecimento para responder clientes.

Regras:
- Use SOMENTE os dados do JSON. Nunca invente preços, prazos, políticas ou números.
- Se um dado faltar, escreva "(não informado)" — não preencha por conta própria.
- Valores monetários já vêm formatados em R$ no JSON; use-os como estão.
- Não exponha dados internos (ids, flags booleanas cruas) no texto para o cliente;
  use-os só para organizar as seções.
- Tom: claro, cordial e objetivo, pronto para ser reutilizado numa resposta.

Estrutura do playbook:
1. **Quem é** — nome/@username, profissão, enxame, cidade, resumo da bio.
2. **Perfis e comunidades** — lista dos subperfis/comunidades ativos e o que cada um oferece.
3. **Serviços** — nome, descrição curta, duração e preço de cada serviço ativo.
4. **Produtos** — nome, descrição, preço e disponibilidade (em estoque / esgotado).
5. **Cursos** — título, resumo, preço, nº de aulas e status (publicado/rascunho).
6. **Redes e contato** — canais sociais e telefone, quando houver.
7. **Provas sociais** — seguidores e nível, para reforçar credibilidade.
8. **Respostas rápidas (FAQ)** — gere 5 a 8 perguntas prováveis de clientes
   (preço, prazo, como comprar, formas de contato, o que está incluso) já com a
   resposta baseada nos dados acima.
9. **O que NÃO responder** — deixe explícito que o atendente não deve prometer
   descontos, reembolsos ou prazos que não estejam nos dados.`

// Orquestra tudo. Retorna { markdown, username, gerado_em, provider, model, avisos }.
// `pool`/`log` são injetados pela rota (para logging de LLM e substituição de marca).
async function gerarPlaybook({ token, baseUrl, empresaId, pool, log } = {}) {
  const client = criarDataClient({ baseUrl, token })
  const { raw, avisos, primeiroErro } = await coletarDados(client)

  // Se NADA veio (todos falharam), propaga o primeiro erro para a rota mapear o
  // status (401 token inválido, 403 escopo/tipo, 429 rate limit).
  if (Object.values(raw).every((v) => v === null)) {
    throw primeiroErro || new Error('Nenhum dado retornado pela Freelandoo.')
  }

  const agregado = montarAgregado(raw)
  const username = agregado?.conta?.username || null

  const userPrompt = `Aqui está o JSON da conta:\n\n${JSON.stringify(agregado, null, 2)}\n\nGere o playbook completo em Markdown.`

  const result = await generateAIResponse(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      task: 'playbook-freelandoo',
      temperature: 0.3,
      maxTokens: 4000,
      empresaId,
    },
    pool,
    log
  )

  const geradoEm = new Date()
  const dataBR = geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const rodape = `\n\n---\n_Playbook gerado em ${dataBR}${username ? ` · conta @${username}` : ''}._`
  const markdown = `${String(result.text || '').trim()}${rodape}`

  return {
    markdown,
    username,
    gerado_em: geradoEm.toISOString(),
    provider: result.provider,
    model: result.model,
    avisos,
  }
}

module.exports = { montarAgregado, coletarDados, gerarPlaybook, centavosParaBRL, SYSTEM_PROMPT }
