'use strict'

const { parsearRespostaJsonClaude } = require('../string-utils')

// Cache TTL: 60s por empresa_id (apenas para getContextoAtivoEmpresa)
const _cache = new Map()
const CACHE_TTL_MS = 60_000

function _cacheGet(empresaId) {
  const entry = _cache.get(empresaId)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    _cache.delete(empresaId)
    return undefined
  }
  return entry.value
}

function _cacheSet(empresaId, value) {
  _cache.set(empresaId, { value, at: Date.now() })
}

function invalidarCacheEmpresa(empresaId) {
  if (empresaId) _cache.delete(empresaId)
  else _cache.clear()
}

// ─── Schema do Contexto 1 (form) ──────────────────────────────────────────────
// Mantém compatibilidade com campos antigos. Novos campos são aditivos.
const CONTEXTO1_CAMPOS_LEGADO = [
  'nome_empresa', 'tipo_negocio', 'nicho', 'cidade_regiao',
  'servicos_produtos', 'precos_planos', 'publico_alvo', 'cliente_ideal',
  'diferenciais', 'problemas_que_resolve', 'tom_de_voz', 'horario_atendimento',
  'formas_pagamento', 'objecoes_comuns', 'perguntas_frequentes',
  'quando_chamar_humano', 'links_uteis', 'informacoes_extras',
]
const CONTEXTO1_CAMPOS_NOVOS = [
  'como_funciona',
  'proposta_de_valor',
  'diferenciais_competitivos',
  'plano_gratuito',
  'link_principal',
  'link_cadastro',
  'link_login',
  'whatsapp',
  'email',
  'instagram',
  'telefone',
  'endereco',
  'ctas_principais',
  'maquinas_modulos_funcionalidades',
]
const CONTEXTO1_CAMPOS = [...CONTEXTO1_CAMPOS_LEGADO, ...CONTEXTO1_CAMPOS_NOVOS]

function normalizarContexto1(input) {
  const form = {}
  for (const c of CONTEXTO1_CAMPOS) form[c] = String((input && input[c]) || '').trim()
  const linhas = CONTEXTO1_CAMPOS
    .filter((c) => form[c])
    .map((c) => `${c.replace(/_/g, ' ').toUpperCase()}: ${form[c]}`)
  return {
    contexto_form_json: form,
    contexto_bruto: linhas.join('\n'),
  }
}

// ─── Schema do Contexto 2 Playbook ────────────────────────────────────────────
const PLAYBOOK_SCHEMA_VERSION = 'contexto2.playbook.v2'

function _esqueletoPlaybook() {
  return {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    resumo_empresa: {
      nome: '', nicho: '', cidade_regiao: '',
      descricao_curta: '', promessa_comercial: '', posicionamento: '',
    },
    tom_de_voz: {
      estilo: '', formalidade: '', ritmo: '',
      palavras_recomendadas: [], palavras_evitar: [], regras_de_linguagem: [],
    },
    servicos: [],
    precos_planos: '',
    dados_para_coletar: [],
    fluxo_atendimento: [],
    respostas_base: [],
    regras_orcamento: {
      dados_minimos_para_orcamento: [],
      pode_falar_preco_quando: [],
      nao_falar_preco_quando: [],
      respostas_para_pergunta_de_preco: [],
      como_lidar_com_orcamento_baixo: [],
      quando_chamar_humano: [],
    },
    regras_reuniao: {
      oferecer_reuniao_quando: [],
      nao_oferecer_reuniao_quando: [],
      mensagens_base: [],
    },
    objecoes: [],
    lead_scoring: { quente: [], morno: [], frio: [] },
    runtime_policy: {
      regra_principal: 'Nunca seguir roteiro fixo. Sempre extrair dados da resposta do lead, atualizar memória, identificar campos faltantes e escolher a próxima melhor pergunta.',
      fazer_uma_pergunta_por_vez: true,
      nao_repetir_pergunta_respondida: true,
      como_lidar_com_respostas_incompletas: [],
      como_evitar_repeticao: [],
      como_decidir_proxima_pergunta: [],
      como_aproveitar_dados_parciais: [],
    },
    aprendizado_continuo: {
      o_que_registrar: [],
      como_sugerir_melhoria: [],
      nao_alterar_contexto_ativo_sem_aprovacao: true,
    },
    limites_da_ia: {
      nao_prometer: [], nao_inventar: [], nao_fazer: [], chamar_humano_quando: [],
    },
    handoff: { gatilhos: [], mensagem_para_lead: '', mensagem_para_operador: '' },
    regras_de_conversao: {
      regra_principal: 'Quando o lead perguntar algo direto sobre cadastro, preço, planos, como funciona, link, produto ou serviço, responda diretamente antes de fazer pergunta.',
      nao_pedir_nome_no_inicio: true,
      sempre_entregar_valor_antes_de_qualificar: true,
      sempre_incluir_cta_quando_houver_link: true,
      sempre_conectar_resposta_com_produto: true,
      evitar_resposta_generica: true,
      estrutura_de_resposta: [
        'responder diretamente a pergunta do lead',
        'explicar o benefício principal',
        'citar produto/serviço/plano/máquina relacionado',
        'citar preço se existir no contexto',
        'enviar link se existir',
        'fazer uma pergunta de qualificação ligada à venda',
      ],
      perguntas_que_exigem_resposta_direta: [
        'como funciona', 'como faço cadastro', 'quanto custa', 'qual valor',
        'tem link', 'tem plano gratuito', 'quais planos', 'quais serviços',
        'quais produtos', 'como começo', 'como entro',
      ],
    },
    cadastro_e_onboarding: {
      link_cadastro: '',
      tem_plano_gratuito: null,
      passos: [],
      resposta_base_cadastro: '',
      perguntas_para_direcionar: [],
    },
    maquinas_ou_modulos: [],
    links_uteis_estruturados: [],
    intencoes_de_conversao: {
      cadastro: {
        deve_responder_com: ['passos', 'link', 'beneficio', 'pergunta_de_direcionamento'],
      },
      preco: {
        deve_responder_com: ['preco_se_existir', 'beneficio', 'plano', 'pergunta_de_direcionamento'],
      },
      como_funciona: {
        deve_responder_com: ['explicacao_empresa', 'ofertas', 'beneficios', 'cta'],
      },
      plano_gratuito: {
        deve_responder_com: ['se_existe_gratuito', 'limites', 'beneficio_do_plano_pago', 'cta'],
      },
      link: {
        deve_responder_com: ['link', 'beneficio', 'cta'],
      },
    },
  }
}

/**
 * Garante todas as seções obrigatórias. Mescla recursivamente o JSON da IA sobre
 * o esqueleto padrão. Se a IA esquecer algo, fica o default seguro.
 */
function validarContexto2Playbook(json) {
  const esq = _esqueletoPlaybook()
  if (!json || typeof json !== 'object') return esq
  const merged = JSON.parse(JSON.stringify(esq))
  for (const k of Object.keys(esq)) {
    if (json[k] === undefined || json[k] === null) continue
    if (Array.isArray(esq[k])) {
      merged[k] = Array.isArray(json[k]) ? json[k] : esq[k]
    } else if (typeof esq[k] === 'object') {
      merged[k] = { ...esq[k], ...(typeof json[k] === 'object' ? json[k] : {}) }
    } else {
      merged[k] = json[k]
    }
  }
  merged.schema_version = PLAYBOOK_SCHEMA_VERSION

  // Sanitiza fake URLs (example.com, localhost, etc.) substituindo pelo link real
  // se foi passado em validarContexto2Playbook(json, { linkPrincipal }).
  return merged
}

function validarContexto2PlaybookComUrls(json, { linkPrincipal = '' } = {}) {
  const merged = validarContexto2Playbook(json)
  const { sanitizarPlaybookUrls } = require('./url-sanitize')
  return sanitizarPlaybookUrls(merged, linkPrincipal)
}

// ─── Prompt para gerar Contexto 2 Playbook ────────────────────────────────────
function gerarPromptContexto2({ empresa, contexto1 }) {
  const empresaJson = JSON.stringify({
    id: empresa?.id, nome: empresa?.nome, slug: empresa?.slug, plano: empresa?.plano,
  })
  const contexto1Json = typeof contexto1 === 'string'
    ? contexto1
    : JSON.stringify(contexto1, null, 2)

  const systemPrompt = `Você é um estrategista comercial especialista em vendas consultivas, WhatsApp, qualificação de leads e agentes de IA.

Sua tarefa é transformar o CONTEXTO 1 de uma empresa em um CONTEXTO 2, que será usado como playbook operacional de atendimento por IA.

O Contexto 2 não é um texto institucional.
O Contexto 2 é o manual de venda da IA.

REGRA COMERCIAL CENTRAL — RESPONDER PRIMEIRO, QUALIFICAR DEPOIS.
Quando o lead faz uma pergunta direta (cadastro, preço, link, como funciona, plano gratuito, quais serviços), o agente DEVE responder diretamente usando os dados do Contexto 1, e SÓ DEPOIS fazer uma pergunta de qualificação ligada à venda. Nunca pedir nome no início. Nunca responder "depende da sua necessidade", "preciso entender melhor" ou "qual é o seu nome?" quando o contexto tem dados suficientes.

REGRA DE URL — PROIBIDO INVENTAR LINK.
Nunca emita example.com, localhost, teste.com, site.com, yoursite.com, dominio.com, sample.com, demo.com, fake.com, empresa.com ou qualquer URL placeholder. Se o Contexto 1 não tem link, deixe o campo vazio. NUNCA invente URL.

Regras de geração:
- Não invente dados específicos que não estejam no Contexto 1.
- Se preço não foi informado, crie regra dizendo que preço depende do escopo.
- Crie perguntas curtas, naturais e boas para WhatsApp.
- Crie respostas-base que sigam a estrutura: abertura → resposta direta → benefício → produto/plano → preço/link se houver → pergunta de direcionamento.
- O agente sempre aproveita respostas parciais.
- O agente nunca repete pergunta que o lead já respondeu.
- Aprendizados viram sugestões pendentes, nunca alteração automática do contexto ativo.

EXTRAÇÃO ESPECÍFICA OBRIGATÓRIA do Contexto 1:
- cadastro_e_onboarding.link_cadastro: pegue de links_uteis se for o site da empresa.
- cadastro_e_onboarding.tem_plano_gratuito: true/false/null com base em precos_planos.
- cadastro_e_onboarding.passos: lista curta de passos práticos (ex: ["acesse o site", "crie sua conta", "escolha o módulo", "complete o perfil"]).
- cadastro_e_onboarding.resposta_base_cadastro: 2-3 frases de exemplo seguindo a estrutura de resposta.
- cadastro_e_onboarding.perguntas_para_direcionar: 2-4 perguntas curtas (ex: "Você quer vender serviços, criar curso ou captar clientes?").
- maquinas_ou_modulos: se Contexto 1 menciona módulos, áreas, máquinas ou funções da plataforma (ex: "divulgar serviços", "vender cursos", "agenda", "feed", "perfil"), transforme cada um em item com nome/descricao/indicado_para/beneficios/quando_recomendar/perguntas_de_qualificacao.
- links_uteis_estruturados: array de { label, url, quando_enviar } extraído de links_uteis.
- intencoes_de_conversao: mantenha o default (cadastro/preco/como_funciona/plano_gratuito/link), customize deve_responder_com se necessário.
- regras_de_conversao: mantenha defaults; ajuste perguntas_que_exigem_resposta_direta com termos do nicho da empresa.

Crie pelo menos: 8 dados_para_coletar, 8 fluxo_atendimento etapas, 15 respostas_base (variadas, seguindo a estrutura comercial), 8 objecoes, 5 itens em cada lista de regras_orcamento, 5 em regras_reuniao, 5 handoff.gatilhos.

Retorne APENAS JSON válido (sem markdown, sem texto extra) com o formato:
{
  "markdown": "texto completo em markdown para o usuário editar",
  "json": {
    "schema_version": "contexto2.playbook.v2",
    "resumo_empresa": {...},
    "tom_de_voz": {...},
    "servicos": [...],
    "dados_para_coletar": [...],
    "fluxo_atendimento": [...],
    "respostas_base": [...],
    "regras_orcamento": {...},
    "regras_reuniao": {...},
    "objecoes": [...],
    "lead_scoring": {...},
    "runtime_policy": {...},
    "aprendizado_continuo": {...},
    "limites_da_ia": {...},
    "handoff": {...},
    "regras_de_conversao": {...},
    "cadastro_e_onboarding": {...},
    "maquinas_ou_modulos": [...],
    "links_uteis_estruturados": [...],
    "intencoes_de_conversao": {...}
  }
}`

  const userPrompt = `EMPRESA:
${empresaJson}

CONTEXTO 1:
${contexto1Json}

Gere o Contexto 2 Playbook em JSON conforme as regras.`

  return { systemPrompt, userPrompt }
}

/**
 * Gera o Contexto 2 Playbook chamando IA e salva como nova versão (rascunho).
 * Retorna { versao_id, markdown, json }.
 */
async function gerarContexto2Playbook({ pool, log, empresaId, contextoId, userId, aiProvider }) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('gerarContexto2Playbook: pool, empresaId, contextoId obrigatórios')
  }

  const { rows: [empresa] } = await pool.query(
    'SELECT id, nome, slug, plano FROM app.empresas WHERE id = $1',
    [empresaId]
  )
  if (!empresa) throw new Error('Empresa não encontrada')

  const { rows: [ctx] } = await pool.query(
    'SELECT id, nome, conteudo, contexto_form_json FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
    [contextoId, empresaId]
  )
  if (!ctx) throw new Error('Contexto 1 não encontrado')

  const formJson = ctx.contexto_form_json && Object.keys(ctx.contexto_form_json).length > 0
    ? ctx.contexto_form_json
    : null
  const contexto1 = formJson || ctx.conteudo || ''
  if (!contexto1 || (typeof contexto1 === 'string' && contexto1.trim().length < 20)) {
    throw new Error('Contexto 1 muito curto para gerar playbook')
  }

  const { systemPrompt, userPrompt } = gerarPromptContexto2({ empresa, contexto1 })

  const provider = aiProvider || require('../ai-provider')
  const result = await provider.generateAIResponse(
    {
      systemPrompt, userPrompt,
      task: 'generateContextPlaybook',
      maxTokens: Number(process.env.CONTEXT_PLAYBOOK_MAX_TOKENS) || 8000,
      timeoutMs: Number(process.env.CONTEXT_PLAYBOOK_TIMEOUT_MS) || 120000,
      empresaId, refType: 'contexto', refId: contextoId,
      ...(process.env.CONTEXT_PLAYBOOK_MODEL ? { model: process.env.CONTEXT_PLAYBOOK_MODEL } : {}),
    },
    pool, log
  )

  let parsed
  try {
    parsed = parsearRespostaJsonClaude(result.text) || {}
  } catch (_) { parsed = {} }

  const markdown = typeof parsed.markdown === 'string' && parsed.markdown.trim()
    ? parsed.markdown
    : ''

  // Determina link principal real do contexto pra usar como fallback de fake URLs
  const c1 = ctx.contexto_form_json || {}
  const linkPrincipalReal = pickPrimeiroLinkValido([
    c1.link_principal, c1.link_cadastro, c1.links_uteis,
  ])
  const jsonValidado = validarContexto2PlaybookComUrls(parsed.json || {}, { linkPrincipal: linkPrincipalReal })
  if (c1.precos_planos && !jsonValidado.precos_planos) {
    jsonValidado.precos_planos = String(c1.precos_planos).trim()
  }
  // Gate de agenda POR INSTÂNCIA: a instância dona deste contexto (1:1) define se
  // usa agenda. Sem agenda → não gera regras de reunião no playbook (o runtime
  // também bloqueia, mas aqui o texto gerado já sai coerente). Default = ligado.
  const usaAgenda = await pool.query(
    `SELECT config_json->>'usa_agenda' AS usa_agenda
       FROM app.empresa_whatsapp_instances WHERE contexto_id = $1 LIMIT 1`,
    [contextoId]
  ).then((r) => r.rows[0]?.usa_agenda !== 'false').catch(() => true)
  if (!usaAgenda) {
    jsonValidado.regras_reuniao = {
      oferecer_reuniao_quando: [],
      nao_oferecer_reuniao_quando: ['Esta instância não usa agenda — nunca ofereça nem agende reunião; conduza para qualificação e handoff humano.'],
      mensagens_base: [],
    }
  }

  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(versao), 0)::int AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1',
    [contextoId]
  )
  const versao = (last?.max_versao || 0) + 1

  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes
      (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown,
       gerado_por, status, playbook_schema_version)
     VALUES ($1, $2, $3, $4, $5, 'ia', 'rascunho', $6)
     RETURNING *`,
    [contextoId, empresaId, versao, JSON.stringify(jsonValidado), markdown, PLAYBOOK_SCHEMA_VERSION]
  )

  invalidarCacheEmpresa(empresaId)
  return { versao: v, json: jsonValidado, markdown }
}

/**
 * Ativa uma versão e arquiva todas as outras do mesmo contexto.
 */
async function ativarContexto2({ pool, empresaId, versaoId, userId }) {
  if (!pool || !empresaId || !versaoId) throw new Error('ativarContexto2: parâmetros obrigatórios')

  const { rows: [v] } = await pool.query(
    `SELECT id, contexto_id FROM app.empresa_contexto_versoes WHERE id = $1 AND empresa_id = $2`,
    [versaoId, empresaId]
  )
  if (!v) throw new Error('Versão não encontrada')

  await pool.query(
    `UPDATE app.empresa_contexto_versoes
       SET status = 'arquivado'
     WHERE contexto_id = $1 AND status = 'ativo' AND id <> $2`,
    [v.contexto_id, versaoId]
  )
  const { rows: [ativada] } = await pool.query(
    `UPDATE app.empresa_contexto_versoes
       SET status = 'ativo',
           ativado_em = NOW(),
           aprovado_por = $2,
           aprovado_em = NOW()
     WHERE id = $1
     RETURNING *`,
    [versaoId, userId || null]
  )
  invalidarCacheEmpresa(empresaId)
  return ativada
}

/**
 * Busca a versão ativa do Contexto 2 para uma empresa.
 * Se evolutionInstance for fornecido e a instance estiver linkada a um
 * contexto específico, prioriza a versão ativa daquele contexto. Senão,
 * cai pra qualquer versão ativa da empresa.
 *
 * Retorna { json, markdown, versao_id, ativado_em, contexto_id } ou null.
 */
// Bloco de FATOS da empresa (verbatim do formulário/Contexto 1). É a fonte que o
// runtime consulta ANTES de responder qualquer pergunta do lead.
function _blocoInformacoesDoForm(c1) {
  if (!c1 || typeof c1 !== 'object') return ''
  return Object.entries(c1)
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `${k.replace(/_/g, ' ').toUpperCase()}: ${String(v).trim()}`)
    .join('\n')
}

function _enriquecerPlaybookComContexto1(playbookJson, contextoFormJson) {
  const out = playbookJson && typeof playbookJson === 'object' ? { ...playbookJson } : {}
  const c1 = contextoFormJson && typeof contextoFormJson === 'object' ? contextoFormJson : {}
  if (!out.precos_planos && c1.precos_planos) out.precos_planos = String(c1.precos_planos).trim()
  // Sempre (re)injeta o bloco de informações da empresa — funciona inclusive para
  // playbooks antigos que foram gerados antes deste campo existir.
  const bloco = _blocoInformacoesDoForm(c1)
  if (bloco) out.informacoes_empresa = bloco
  return out
}

async function buscarContexto2Ativo(pool, empresaId, evolutionInstance = null) {
  if (!empresaId) return null

  if (evolutionInstance) {
    const { rows } = await pool.query(
      `SELECT ecv.id, ecv.conteudo_json, ecv.conteudo_markdown, ecv.ativado_em, ecv.contexto_id,
              ec.contexto_form_json
         FROM app.empresa_whatsapp_instances ewi
         JOIN app.empresa_contexto_versoes ecv
           ON ecv.contexto_id = ewi.contexto_id
         LEFT JOIN app.empresa_contextos ec
           ON ec.id = ecv.contexto_id
        WHERE ewi.empresa_id = $1
          AND ewi.evolution_instance = $2
          AND ewi.contexto_id IS NOT NULL
          AND ecv.status = 'ativo'
        ORDER BY ecv.ativado_em DESC NULLS LAST
        LIMIT 1`,
      [empresaId, evolutionInstance]
    )
    if (rows.length) {
      return {
        versao_id: rows[0].id,
        json: _enriquecerPlaybookComContexto1(rows[0].conteudo_json, rows[0].contexto_form_json),
        markdown: rows[0].conteudo_markdown || '',
        ativado_em: rows[0].ativado_em,
        contexto_id: rows[0].contexto_id,
      }
    }
  }

  const { rows } = await pool.query(
    `SELECT ecv.id, ecv.conteudo_json, ecv.conteudo_markdown, ecv.ativado_em, ecv.contexto_id,
            ec.contexto_form_json
       FROM app.empresa_contexto_versoes ecv
       LEFT JOIN app.empresa_contextos ec
         ON ec.id = ecv.contexto_id
      WHERE ecv.empresa_id = $1 AND ecv.status = 'ativo'
      ORDER BY ativado_em DESC NULLS LAST
      LIMIT 1`,
    [empresaId]
  )
  if (!rows.length) return null
  return {
    versao_id: rows[0].id,
    json: _enriquecerPlaybookComContexto1(rows[0].conteudo_json, rows[0].contexto_form_json),
    markdown: rows[0].conteudo_markdown || '',
    ativado_em: rows[0].ativado_em,
    contexto_id: rows[0].contexto_id,
  }
}

/**
 * LEGADO: mantém assinatura antiga (retorna só json) para compatibilidade com
 * agente atual. Usa cache.
 */
async function getContextoAtivoEmpresa(pool, empresaId) {
  if (!empresaId) return null
  const cached = _cacheGet(empresaId)
  if (cached !== undefined) return cached
  const ativo = await buscarContexto2Ativo(pool, empresaId)
  const result = ativo ? ativo.json : null
  _cacheSet(empresaId, result)
  return result
}

/**
 * Aplica uma sugestão criando um NOVO draft a partir da versão ativa.
 * NÃO altera nada que esteja ativo — usuário precisa revisar e ativar.
 * Retorna { versao_novo_draft, sugestao_atualizada }.
 */
async function aplicarSugestaoComoDraft({ pool, log, empresaId, sugestaoId, userId, aiProvider }) {
  if (!pool || !empresaId || !sugestaoId) throw new Error('aplicarSugestaoComoDraft: parâmetros obrigatórios')

  const { rows: [sug] } = await pool.query(
    `SELECT * FROM app.empresa_contexto_sugestoes WHERE id = $1 AND empresa_id = $2`,
    [sugestaoId, empresaId]
  )
  if (!sug) throw new Error('Sugestão não encontrada')
  if (sug.status === 'aplicada') throw new Error('Sugestão já foi aplicada')

  const ativo = await buscarContexto2Ativo(pool, empresaId)
  if (!ativo) throw new Error('Nenhum Contexto 2 ativo para receber a sugestão. Ative um primeiro.')

  // Descobre contexto_id da versão ativa
  const { rows: [versaoAtiva] } = await pool.query(
    'SELECT contexto_id FROM app.empresa_contexto_versoes WHERE id = $1',
    [ativo.versao_id]
  )
  if (!versaoAtiva) throw new Error('Versão ativa órfã')

  // Pede para a IA mesclar a sugestão no playbook ativo
  const systemPrompt = `Você recebe um Contexto 2 (playbook comercial) e uma sugestão de aprendizado vinda de uma conversa real.
Sua tarefa: criar uma NOVA VERSÃO do playbook incorporando a sugestão de forma mínima e cirúrgica.
Não reescreva tudo. Só ajuste/adicione o que a sugestão indica.
Não invente regras que não estão na sugestão.
Mantenha schema_version e estrutura idênticos.

Retorne APENAS JSON: { "markdown": "...", "json": { ...playbook_completo... } }`

  const userPrompt = `PLAYBOOK ATUAL (JSON):
${JSON.stringify(ativo.json, null, 2)}

PLAYBOOK ATUAL (Markdown):
${ativo.markdown || '(sem markdown)'}

SUGESTÃO (tipo: ${sug.tipo}, confiança: ${sug.confianca}):
Evidência: ${sug.evidencia}
${sug.sugestao_markdown ? `Sugestão (markdown):\n${sug.sugestao_markdown}\n` : ''}
${sug.sugestao_json && Object.keys(sug.sugestao_json).length ? `Sugestão (json):\n${JSON.stringify(sug.sugestao_json, null, 2)}` : ''}

Incorpore a sugestão. Retorne o playbook completo (não só o delta).`

  const provider = aiProvider || require('../ai-provider')
  const result = await provider.generateAIResponse(
    {
      systemPrompt, userPrompt,
      task: 'applyLearningSuggestion',
      maxTokens: Number(process.env.CONTEXT_PLAYBOOK_MAX_TOKENS) || 8000,
      timeoutMs: Number(process.env.CONTEXT_PLAYBOOK_TIMEOUT_MS) || 120000,
      empresaId, refType: 'contexto', refId: versaoAtiva.contexto_id,
    },
    pool, log
  )
  const parsed = parsearRespostaJsonClaude(result.text) || {}
  const markdown = typeof parsed.markdown === 'string' ? parsed.markdown : (ativo.markdown || '')
  const jsonValidado = validarContexto2Playbook(parsed.json || ativo.json || {})

  // Cria novo draft
  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(versao), 0)::int AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1',
    [versaoAtiva.contexto_id]
  )
  const versao = (last?.max_versao || 0) + 1
  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes
      (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown,
       gerado_por, status, playbook_schema_version)
     VALUES ($1, $2, $3, $4, $5, 'sugestao', 'rascunho', $6)
     RETURNING *`,
    [versaoAtiva.contexto_id, empresaId, versao, JSON.stringify(jsonValidado), markdown, PLAYBOOK_SCHEMA_VERSION]
  )

  // Marca sugestão como aplicada
  await pool.query(
    `UPDATE app.empresa_contexto_sugestoes
       SET status = 'aplicada', reviewed_at = NOW(), reviewed_by = $2, contexto_versao_id = $3
     WHERE id = $1`,
    [sugestaoId, userId || null, v.id]
  )

  invalidarCacheEmpresa(empresaId)
  return { versao_novo_draft: v, sugestao_id: sugestaoId }
}

/**
 * Registra uma sugestão de aprendizado pendente.
 * NUNCA altera o contexto ativo automaticamente.
 */
async function registrarSugestaoAprendizadoContexto({
  pool, empresaId, contextoVersaoId, conversaId, leadPhone,
  tipo, evidencia, sugestaoJson, sugestaoMarkdown, confianca, impactoComercial,
}) {
  if (!pool || !empresaId || !tipo || !evidencia) return null
  const conf = ['baixa', 'media', 'alta'].includes(confianca) ? confianca : 'media'
  const { rows: [s] } = await pool.query(
    `INSERT INTO app.empresa_contexto_sugestoes
      (empresa_id, contexto_versao_id, conversa_id, lead_phone, tipo, evidencia,
       impacto_comercial, sugestao_json, sugestao_markdown, confianca, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendente')
     RETURNING *`,
    [
      empresaId, contextoVersaoId || null, conversaId || null, leadPhone || null,
      tipo, evidencia, impactoComercial || null,
      JSON.stringify(sugestaoJson || {}), sugestaoMarkdown || null, conf,
    ]
  )
  return s
}

// ─── Formatação para prompt ──────────────────────────────────────────────────
function _formatarValor(val, indent) {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    return val
      .map((item) => `${indent}- ${_formatarValor(item, indent + '  ')}`)
      .join('\n')
  }
  if (typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        const formatted = _formatarValor(v, indent + '  ')
        if (!formatted) return null
        return Array.isArray(v) || (typeof v === 'object' && v !== null)
          ? `${indent}${label}:\n${formatted}`
          : `${indent}${label}: ${formatted}`
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function formatarContexto2ParaPrompt(json) {
  if (!json || typeof json !== 'object' || Object.keys(json).length === 0) return null
  const corpo = _formatarValor(json, '')
  if (!corpo.trim()) return null
  return `===== CONTEXTO DA EMPRESA (Contexto 2 — playbook operacional) =====\n\n${corpo.trim()}\n`
}

// Helper: pega o primeiro link válido (não fake) de uma lista de strings
function pickPrimeiroLinkValido(arr) {
  const { ehUrlFalsa } = require('./url-sanitize')
  for (const v of arr || []) {
    if (!v) continue
    const matches = String(v).match(/https?:\/\/[^\s)>\]]+/gi) || []
    for (const u of matches) {
      const limpo = u.replace(/[.,;:!?)>\]]+$/, '').trim()
      if (limpo && !ehUrlFalsa(limpo)) return limpo
    }
  }
  return ''
}

module.exports = {
  CONTEXTO1_CAMPOS,
  CONTEXTO1_CAMPOS_LEGADO,
  CONTEXTO1_CAMPOS_NOVOS,
  PLAYBOOK_SCHEMA_VERSION,
  normalizarContexto1,
  validarContexto2Playbook,
  validarContexto2PlaybookComUrls,
  pickPrimeiroLinkValido,
  gerarPromptContexto2,
  gerarContexto2Playbook,
  ativarContexto2,
  buscarContexto2Ativo,
  getContextoAtivoEmpresa,
  registrarSugestaoAprendizadoContexto,
  aplicarSugestaoComoDraft,
  formatarContexto2ParaPrompt,
  invalidarCacheEmpresa,
}
