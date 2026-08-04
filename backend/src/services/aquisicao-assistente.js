'use strict'
// Assistente de Oportunidades — orquestração.
//
// Junta os dados da empresa (db/aquisicao-oportunidades.js), aplica as REGRAS
// determinísticas (services/aquisicao-sinais.js), pede à IA apenas que REDIJA a
// explicação e persiste as sugestões. Nada aqui executa a sugestão.
//
// Limite de projeto, não de configuração: este módulo não importa nem alcança
// `pesquisarPlaces`, `dispararBuscaMaps` ou qualquer função de coleta. A única escrita
// fora da tabela de sugestões acontece em `aplicarSugestao`, sob decisão explícita do
// administrador, e reusa o CRUD normal das rotinas (que valida tudo de novo).

const aiProviderPadrao = require('../ai-provider')
const rotinasDb = require('../db/aquisicao-rotinas')
const oportunidadesDb = require('../db/aquisicao-oportunidades')
const { avaliarOportunidades, ordenar, chaveMercado } = require('./aquisicao-sinais')
const { obterConfiguracaoProspeccao } = require('./prospecting-settings')
const { normalizarUf } = require('./aquisicao-rotinas-scheduler')
const { logger } = require('../logger')

// Poucas sugestões, priorizadas. Uma lista longa vira ruído e o admin para de ler.
const MAX_SUGESTOES = 3
// Intervalo mínimo entre análises que GERARAM sugestão (evita gastar IA à toa).
// Uma análise sem candidatos não consome IA e não abre cooldown.
const COOLDOWN_MINUTOS = 10
// Teto de confiança de uma sugestão exploratória: ela nasce de um mercado sem histórico,
// então nunca pode parecer tão sólida quanto uma sustentada por números reais.
const CONFIANCA_MAX_EXPLORACAO = 50
const MAX_ROTINAS_PARA_EXPLORAR = 12

const ESTADOS = {
  SUGESTAO: 'sugestao_disponivel',
  SEM_NOVIDADE: 'sem_novidade',
  SEM_DADOS: 'sem_dados_suficientes',
}

function erro(mensagem, statusCode = 400, extra = {}) {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  Object.assign(e, extra)
  return e
}

function textoLimitado(valor, max) {
  const t = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, max) : ''
}

// ── Redação por IA ──────────────────────────────────────────────────────────────
// A IA recebe a AÇÃO e as EVIDÊNCIAS já decididas e devolve só texto. Ela não escolhe
// o que fazer, não muda o alvo e não vê PII (nomes, telefones e e-mails nunca entram).
const SYSTEM_REDACAO = [
  'Você explica recomendações de prospecção para o dono de um pequeno negócio, em português do Brasil.',
  'Você recebe recomendações JÁ DECIDIDAS por regras, com os números que as sustentam.',
  'Sua única tarefa é reescrever o título, o motivo e o impacto de cada uma em linguagem simples.',
  'Regras obrigatórias:',
  '- NÃO invente números: use apenas os que estiverem nas evidências.',
  '- NÃO mude a ação, o mercado ou a rotina de cada recomendação.',
  '- Nada de jargão técnico (nada de snapshot, dataset, API, modelo, prompt, coleta paga).',
  '- Título com no máximo 70 caracteres; motivo e impacto com no máximo 220 caracteres cada.',
  '- Fale direto com a pessoa ("você"), tom calmo e objetivo, sem exagero comercial.',
  'Responda SOMENTE um JSON: {"itens":[{"ref":0,"titulo":"...","motivo":"...","impacto":"..."}]}',
].join('\n')

function resumirParaIA(candidatos) {
  return candidatos.map((c, indice) => ({
    ref: indice,
    acao: c.tipo,
    mercado: `${c.nicho}${c.cidade ? ` em ${c.cidade}${c.uf ? `/${c.uf}` : ''}` : ''}`,
    proposta: c.parametros && Object.keys(c.parametros).length ? c.parametros : undefined,
    evidencias: c.evidencias,
    texto_atual: { titulo: c.titulo, motivo: c.motivo, impacto: c.impacto },
  }))
}

// Aplica a redação da IA sobre os candidatos. Item inválido é IGNORADO (o candidato
// mantém o texto determinístico) — nunca derruba a análise inteira.
function aplicarRedacao(candidatos, bruto) {
  const texto = String(bruto || '').trim()
    .replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim()
  let itens
  try {
    const parsed = JSON.parse(texto)
    itens = Array.isArray(parsed?.itens) ? parsed.itens : null
  } catch (_) {
    itens = null
  }
  if (!itens) return { candidatos, redigidos: 0 }

  const saida = candidatos.map((c) => ({ ...c }))
  let redigidos = 0
  for (const item of itens) {
    const ref = Number.parseInt(item?.ref, 10)
    if (!Number.isInteger(ref) || ref < 0 || ref >= saida.length) continue
    const titulo = textoLimitado(item?.titulo, 70)
    const motivo = textoLimitado(item?.motivo, 220)
    // Sem motivo não há explicação — e explicação é o produto. Mantém o determinístico.
    if (!titulo || !motivo) continue
    saida[ref].titulo = titulo
    saida[ref].motivo = motivo
    saida[ref].impacto = textoLimitado(item?.impacto, 220) || saida[ref].impacto
    saida[ref].origem_texto = 'ia'
    redigidos += 1
  }
  return { candidatos: saida, redigidos }
}

async function redigirComIA(pool, empresaId, candidatos, deps = {}) {
  const ai = deps.aiProvider || aiProviderPadrao
  try {
    const resultado = await ai.generateAIResponse(
      {
        systemPrompt: SYSTEM_REDACAO,
        userPrompt: `Recomendações:\n${JSON.stringify(resumirParaIA(candidatos), null, 1)}`,
        task: 'aquisicao_assistente',
        empresaId,
        refType: 'aquisicao_sugestao',
        model: (deps.aiProvider || aiProviderPadrao).modeloAuxiliarAtivo(),
        temperature: 0.4,
        maxTokens: 700,
        timeoutMs: 25000,
        responseFormatJson: true,
      },
      pool,
      null
    )
    return aplicarRedacao(candidatos, resultado?.text)
  } catch (e) {
    // Falha de IA não invalida a análise: as sugestões saem com o texto das regras.
    logger.warn({ operation: 'aquisicao_assistente', etapa: 'redacao_falhou', empresa_id: empresaId, erro: e.message })
    return { candidatos, redigidos: 0 }
  }
}

// ── Candidato exploratório ──────────────────────────────────────────────────────
// Único ponto em que a IA propõe um ALVO — e só porque um mercado nunca explorado não
// tem, por definição, histórico para uma regra medir. Entra com prioridade baixa,
// confiança limitada e passa pelos mesmos filtros de duplicidade e preferências.
async function candidatoExploratorio(pool, empresaId, { rotinas, config, deps = {} }) {
  const selecionar = deps.selecionarMercado
    // Lazy para não acoplar o assistente ao módulo de prospecção no carregamento.
    || require('../prospecting').selecionarMercadoDiarioIA
  let mercado
  try {
    mercado = await selecionar(pool, config, { empresaId, aiProvider: deps.aiProvider })
  } catch (e) {
    logger.warn({ operation: 'aquisicao_assistente', etapa: 'exploracao_falhou', empresa_id: empresaId, erro: e.message })
    return null
  }
  if (!mercado?.nicho || !mercado?.cidade) return null

  const bruta = String(mercado.cidade)
  const capturaUf = bruta.match(/[-,/]\s*([A-Za-z]{2})\s*$/)
  const cidade = bruta.replace(/[-,/]\s*[A-Za-z]{2}\s*$/, '').trim() || bruta
  const uf = capturaUf ? normalizarUf(capturaUf[1]) : null

  const chave = chaveMercado(mercado.nicho, cidade)
  if (rotinas.some((r) => chaveMercado(r.nicho, r.cidade) === chave)) return null

  return {
    tipo: 'criar_rotina',
    rotina_id: null,
    nicho: mercado.nicho,
    cidade,
    uf,
    parametros: {
      dias_semana: [1, 2, 3, 4, 5],
      janela_inicio: '08:00',
      janela_fim: '18:00',
      intervalo_horas: 24,
      quantidade: 200,
    },
    prioridade: 40,
    confianca: Math.min(CONFIANCA_MAX_EXPLORACAO, Math.max(20, Number.parseInt(mercado.confianca, 10) || 30)),
    evidencias: {
      exploratoria: true,
      rotinas_existentes: rotinas.length,
      observacao: 'Mercado ainda não prospectado por você — sugestão de teste, sem histórico próprio.',
    },
    assinatura: `criar_rotina|explorar|mkt:${chave}`,
    titulo: `Testar ${mercado.nicho} em ${uf ? `${cidade}/${uf}` : cidade}`,
    motivo: mercado.motivo
      ? `Mercado ainda não explorado por você. ${textoLimitado(mercado.motivo, 180)}`
      : 'Mercado ainda não explorado por você, com perfil parecido com os que já funcionam.',
    impacto: 'Abrir uma frente nova sem depender só dos mercados que você já conhece.',
  }
}

/**
 * Roda a análise sob demanda para UMA empresa e persiste as sugestões pendentes.
 * Não dispara coleta, não altera rotina e não envia nada.
 */
async function analisarOportunidades(pool, { empresaId, agora = new Date(), deps = {} } = {}) {
  if (!empresaId) throw erro('Empresa não informada.', 400)

  const ultima = await oportunidadesDb.ultimaGeracaoEm(pool, empresaId)
  if (ultima) {
    const minutos = (agora.getTime() - new Date(ultima).getTime()) / 60000
    if (minutos < COOLDOWN_MINUTOS) {
      throw erro(
        `Uma análise foi feita há pouco. Tente de novo em ${Math.ceil(COOLDOWN_MINUTOS - minutos)} min.`,
        429,
        { motivo: 'cooldown' }
      )
    }
  }

  const [rotinas, coletas, mercados, config] = await Promise.all([
    rotinasDb.listarRotinas(pool, empresaId),
    oportunidadesDb.listarExecucoesRecentes(pool, empresaId),
    oportunidadesDb.listarDesempenhoMercados(pool, empresaId),
    obterConfiguracaoProspeccao(pool, empresaId).catch(() => ({})),
  ])

  const avaliacao = avaliarOportunidades({ rotinas, coletas, mercados })
  if (!avaliacao.suficiente) {
    return { estado: ESTADOS.SEM_DADOS, mensagem: avaliacao.motivo_insuficiencia, sugestoes: [] }
  }

  // Já decidido pelo admin não volta enquanto a evidência não mudar de faixa.
  const decididas = await oportunidadesDb.assinaturasDecididas(pool, empresaId)
  let candidatos = avaliacao.candidatos.filter((c) => !decididas.has(c.assinatura))

  // Exploração só quando sobra espaço na lista e a operação ainda comporta mais frentes.
  if (candidatos.length < MAX_SUGESTOES && rotinas.length < MAX_ROTINAS_PARA_EXPLORAR) {
    const exploratorio = await candidatoExploratorio(pool, empresaId, { rotinas, config, deps })
    if (exploratorio && !decididas.has(exploratorio.assinatura)) candidatos.push(exploratorio)
  }

  candidatos = ordenar(candidatos).slice(0, MAX_SUGESTOES)
  if (!candidatos.length) {
    return {
      estado: ESTADOS.SEM_NOVIDADE,
      mensagem: 'Nada de novo por enquanto: suas rotinas estão coerentes com os resultados atuais.',
      sugestoes: [],
    }
  }

  const { candidatos: redigidos } = await redigirComIA(pool, empresaId, candidatos, deps)
  const gravadas = await oportunidadesDb.registrarSugestoes(pool, empresaId, redigidos)
  logger.info(
    { operation: 'aquisicao_assistente', empresa_id: empresaId, candidatos: candidatos.length, gravadas: gravadas.length },
    'análise de oportunidades concluída'
  )
  return {
    estado: gravadas.length ? ESTADOS.SUGESTAO : ESTADOS.SEM_NOVIDADE,
    mensagem: gravadas.length ? null : 'Estas sugestões já estavam na sua lista.',
    sugestoes: gravadas,
  }
}

// Traduz a sugestão + os ajustes do admin no payload da rotina. `ajustes` é o formulário
// que o admin revisou na tela: ele MANDA sobre a proposta da IA.
function montarPayloadRotina(sugestao, ajustes = {}) {
  const base = sugestao.parametros && typeof sugestao.parametros === 'object' ? sugestao.parametros : {}
  return {
    ...base,
    nicho: ajustes.nicho ?? sugestao.nicho,
    cidade: ajustes.cidade ?? sugestao.cidade,
    uf: ajustes.uf ?? sugestao.uf,
    dias_semana: ajustes.dias_semana ?? base.dias_semana,
    janela_inicio: ajustes.janela_inicio ?? base.janela_inicio,
    janela_fim: ajustes.janela_fim ?? base.janela_fim,
    intervalo_horas: ajustes.intervalo_horas ?? base.intervalo_horas,
    quantidade: ajustes.quantidade ?? base.quantidade,
  }
}

/**
 * Aprova uma sugestão. Tudo acontece em UMA transação e a sugestão é "reivindicada"
 * antes da ação: dois cliques simultâneos não criam duas rotinas, e se a ação falhar
 * a decisão volta atrás junto (ROLLBACK).
 *
 * Regra dura: rotina criada por aprovação nasce PAUSADA (`ativo: false`), sempre.
 * Aprovar uma sugestão nunca pode, por si, iniciar uma coleta.
 */
async function aplicarSugestao(pool, { empresaId, sugestaoId, usuarioId = null, ajustes = {}, nota = null } = {}) {
  if (!empresaId || !sugestaoId) throw erro('Sugestão não informada.', 400)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const sugestao = await oportunidadesDb.obterSugestao(client, empresaId, sugestaoId)
    if (!sugestao) throw erro('Sugestão não encontrada.', 404)
    if (sugestao.status !== 'pendente') throw erro('Esta sugestão já foi decidida.', 409)

    const reivindicada = await oportunidadesDb.decidirSugestao(client, empresaId, sugestaoId, {
      status: 'aprovada', usuarioId, nota,
    })
    if (!reivindicada) throw erro('Esta sugestão já foi decidida.', 409)

    let rotina = null
    if (sugestao.tipo === 'criar_rotina') {
      rotina = await rotinasDb.criarRotina(client, empresaId, {
        ...montarPayloadRotina(sugestao, ajustes),
        // Nunca `true`, mesmo que o formulário peça: a ativação é um segundo ato do admin.
        ativo: false,
      })
    } else if (sugestao.tipo === 'ajustar_rotina') {
      if (!sugestao.rotina_id) throw erro('Sugestão sem rotina de destino.', 400)
      rotina = await rotinasDb.atualizarRotina(client, empresaId, sugestao.rotina_id, montarPayloadRotina(sugestao, ajustes))
    } else if (sugestao.tipo === 'pausar_rotina') {
      if (!sugestao.rotina_id) throw erro('Sugestão sem rotina de destino.', 400)
      rotina = await rotinasDb.alternarRotina(client, empresaId, sugestao.rotina_id, false)
      if (!rotina) throw erro('Rotina não encontrada.', 404)
    } else {
      // 'revisar_rotina' não tem ação automática: a tela abre a rotina para o admin olhar.
      rotina = sugestao.rotina_id
        ? await rotinasDb.obterRotina(client, empresaId, sugestao.rotina_id)
        : null
    }

    if (rotina?.id) {
      await client.query(
        `UPDATE prospectador.aquisicao_sugestoes
            SET rotina_resultante_id = $3::uuid, atualizado_em = NOW()
          WHERE empresa_id = $1 AND id = $2::uuid`,
        [empresaId, sugestaoId, rotina.id]
      )
    }

    await client.query('COMMIT')
    return { sugestao: { ...reivindicada, rotina_resultante_id: rotina?.id || null }, rotina }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function dispensarSugestao(pool, { empresaId, sugestaoId, usuarioId = null, nota = null } = {}) {
  if (!empresaId || !sugestaoId) throw erro('Sugestão não informada.', 400)
  const sugestao = await oportunidadesDb.decidirSugestao(pool, empresaId, sugestaoId, {
    status: 'dispensada', usuarioId, nota,
  })
  if (!sugestao) {
    const existente = await oportunidadesDb.obterSugestao(pool, empresaId, sugestaoId)
    throw erro(existente ? 'Esta sugestão já foi decidida.' : 'Sugestão não encontrada.', existente ? 409 : 404)
  }
  return sugestao
}

module.exports = {
  ESTADOS,
  MAX_SUGESTOES,
  COOLDOWN_MINUTOS,
  CONFIANCA_MAX_EXPLORACAO,
  aplicarRedacao,
  montarPayloadRotina,
  analisarOportunidades,
  aplicarSugestao,
  dispensarSugestao,
}
