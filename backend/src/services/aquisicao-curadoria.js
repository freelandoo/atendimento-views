'use strict'
// Assistente de Oportunidades (por lead) — orquestração.
//
// O operador roda a Busca avulsa; ela coleta e importa os leads como sempre fez (este
// módulo NÃO toca no pipeline de coleta e não alcança `pesquisarPlaces`). Depois, no
// comando dele — nunca sozinho —, o assistente abre uma sessão e mostra UMA
// oportunidade por vez, com uma justificativa curta.
//
// Aprovar move o lead para a carteira de trabalho ('aprovado'); descartar o tira da
// fila ('rejeitado'). Toda decisão vira sinal de aprendizado da PRÓPRIA empresa, e o
// aprendizado reordena as filas seguintes sem nenhuma configuração visível.
//
// A meta ("máximo de leads novos") limita quantos leads são APROVADOS — nunca quantos
// são avaliados: repetição e descarte não consomem meta.

const aiProviderPadrao = require('../ai-provider')
const curadoriaDb = require('../db/aquisicao-curadoria')
const { aprenderPesos, ordenarCandidatos, pontuarLead } = require('./aquisicao-curadoria-ranking')
const { calcularScoreCadastroPlaces } = require('./lead-score-cadastro')
const { classificarLead } = require('./site-classificacao')
const { normalizarUf } = require('./aquisicao-rotinas-scheduler')
const { logger } = require('../logger')

// Quantos candidatos entram numa "rodada" da fila. É também o tamanho do lote enviado à
// IA: uma chamada explica o lote inteiro, em vez de uma chamada por lead.
const LOTE_FILA = 12
// Quantos candidatos são lidos do banco para ranquear antes de cortar o lote.
const CANDIDATOS_AVALIADOS = 60
const META_MAX = 200

const ESTADOS = {
  ANALISANDO: 'analisando',
  CONCLUIDA: 'concluida',
  SEM_CANDIDATOS: 'sem_candidatos',
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

function normalizarMeta(valor) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return 10
  return Math.max(1, Math.min(META_MAX, n))
}

// ── Redação por IA ──────────────────────────────────────────────────────────────
// A IA recebe só FAIXAS e recomendações já calculadas — nome, telefone, e-mail e
// endereço do lead nunca entram no prompt. Ela não escolhe o que priorizar: a ordem já
// veio das regras. A única tarefa é transformar os sinais numa frase legível.
const SYSTEM_JUSTIFICATIVA = [
  'Você ajuda o dono de um pequeno negócio a decidir se vale a pena abordar um lead, em português do Brasil.',
  'Você recebe leads JÁ RANQUEADOS, descritos apenas por características gerais (tem site, faixa de nota, faixa de avaliações, completude do cadastro).',
  'Sua única tarefa é escrever UMA frase curta explicando por que aquele lead é (ou não é) uma boa oportunidade.',
  'Regras obrigatórias:',
  '- Use SOMENTE as características recebidas; não invente número, nome, cidade ou fato.',
  '- No máximo 160 caracteres por frase.',
  '- Nada de jargão técnico (nada de score, ranking, modelo, prompt, dataset, API).',
  '- Fale direto com a pessoa ("você"), tom calmo e objetivo, sem exagero comercial.',
  'Responda SOMENTE um JSON: {"itens":[{"ref":0,"motivo":"..."}]}',
].join('\n')

function resumirParaIA(itens) {
  return itens.map((item, indice) => ({
    ref: indice,
    caracteristicas: item.caracteristicas,
    sinais: item.motivos,
  }))
}

// Aplica a redação da IA. Item inválido é IGNORADO — o lead mantém o motivo
// determinístico e a sessão nunca trava por causa da IA.
function aplicarJustificativas(itens, bruto) {
  const texto = String(bruto || '').trim()
    .replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim()
  let lista
  try {
    const parsed = JSON.parse(texto)
    lista = Array.isArray(parsed?.itens) ? parsed.itens : null
  } catch (_) {
    lista = null
  }
  if (!lista) return { itens, redigidos: 0 }

  const saida = itens.map((i) => ({ ...i }))
  let redigidos = 0
  for (const bloco of lista) {
    const ref = Number.parseInt(bloco?.ref, 10)
    if (!Number.isInteger(ref) || ref < 0 || ref >= saida.length) continue
    const motivo = textoLimitado(bloco?.motivo, 160)
    if (!motivo) continue
    saida[ref].motivo = motivo
    saida[ref].origem_texto = 'ia'
    redigidos += 1
  }
  return { itens: saida, redigidos }
}

async function justificarComIA(pool, empresaId, itens, deps = {}) {
  if (!itens.length) return { itens, redigidos: 0 }
  const ai = deps.aiProvider || aiProviderPadrao
  try {
    const resultado = await ai.generateAIResponse(
      {
        systemPrompt: SYSTEM_JUSTIFICATIVA,
        userPrompt: `Leads:\n${JSON.stringify(resumirParaIA(itens), null, 1)}`,
        task: 'aquisicao_curadoria',
        empresaId,
        refType: 'curadoria_oportunidade',
        model: ai.modeloAuxiliarAtivo(),
        temperature: 0.4,
        maxTokens: 900,
        timeoutMs: 25000,
        responseFormatJson: true,
      },
      pool,
      null
    )
    return aplicarJustificativas(itens, resultado?.text)
  } catch (e) {
    logger.warn({ operation: 'aquisicao_curadoria', etapa: 'justificativa_falhou', empresa_id: empresaId, erro: e.message })
    return { itens, redigidos: 0 }
  }
}

// ── Fila ────────────────────────────────────────────────────────────────────────
// O item da fila carrega tudo o que a tela precisa mostrar. Guardá-lo pronto é o que
// permite recarregar a página sem repetir a chamada de IA.
function itemDaFila(lead, avaliacao) {
  // Veredito canônico: `site` só aparece quando é site PRÓPRIO; um Instagram vai para
  // `link_original` e o selo da tela mostra "Sem site próprio", não "Tem site".
  const url = classificarLead(lead)
  return {
    prospect_id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone || null,
    endereco: lead.endereco || null,
    nicho: lead.nicho,
    cidade: lead.cidade,
    site: url.site || null,
    tem_site: url.tem_site,
    link_original: url.link_original || null,
    classificacao_url: url.classificacao,
    situacao_site: url.situacao_site,
    maps_url: lead.maps_url || null,
    rating: lead.rating == null ? null : Number(lead.rating),
    avaliacoes: lead.avaliacoes == null ? null : Number(lead.avaliacoes),
    score_cadastro: lead.score_cadastro,
    pontos: avaliacao.pontos,
    caracteristicas: avaliacao.caracteristicas,
    motivos: avaliacao.motivos,
    // Motivo determinístico até a IA responder — a fila nunca fica sem explicação.
    motivo: avaliacao.motivos[0] || 'Lead ainda não avaliado por você.',
    origem_texto: 'regra',
  }
}

/**
 * Monta a próxima rodada da fila: lê candidatos, ranqueia com o aprendizado da empresa,
 * corta o lote e pede à IA uma frase para cada. Devolve [] quando acabaram os leads.
 */
async function montarFila(pool, { empresaId, sessao, deps = {} }) {
  const [candidatos, historico] = await Promise.all([
    curadoriaDb.listarCandidatos(pool, empresaId, {
      nicho: sessao.nicho,
      cidade: sessao.cidade,
      ampliado: sessao.escopo_ampliado,
      limite: CANDIDATOS_AVALIADOS,
    }),
    curadoriaDb.historicoDecisoes(pool, empresaId),
  ])
  if (!candidatos.length) return []

  // A pontuação de cadastro é calculada na leitura (mesma regra da lista de leads).
  const leads = candidatos.map((row) => {
    const cad = calcularScoreCadastroPlaces(row)
    return { ...row, score_cadastro: cad.score }
  })

  const { pesos } = aprenderPesos(historico)
  const ordenados = ordenarCandidatos(leads, pesos).slice(0, LOTE_FILA)
  const itens = ordenados.map(({ lead, avaliacao }) => itemDaFila(lead, avaliacao))
  const { itens: comTexto } = await justificarComIA(pool, empresaId, itens, deps)
  return comTexto
}

function apresentarSessao(sessao) {
  if (!sessao) return null
  return {
    id: sessao.id,
    nicho: sessao.nicho,
    cidade: sessao.cidade,
    uf: sessao.uf,
    escopo_ampliado: !!sessao.escopo_ampliado,
    meta: Number(sessao.meta),
    aprovados: Number(sessao.aprovados),
    descartados: Number(sessao.descartados),
    status: sessao.status,
    criado_em: sessao.criado_em,
    encerrado_em: sessao.encerrado_em,
  }
}

function mercadoDaSessao(sessao) {
  if (!sessao?.nicho) return 'sua carteira'
  const local = sessao.cidade ? ` em ${sessao.cidade}` : ''
  return `${sessao.nicho}${local}`
}

/**
 * Estado completo da sessão para a tela: onde ela está, qual a oportunidade da vez e o
 * que fazer quando acabar. Reabastece a fila quando ela esvazia.
 */
async function montarEstado(pool, { empresaId, sessao, deps = {} }) {
  if (!sessao) return { sessao: null, oportunidade: null, estado: null, mensagem: null, restantes: 0 }

  if (sessao.status !== 'ativa') {
    return {
      sessao: apresentarSessao(sessao),
      oportunidade: null,
      estado: ESTADOS.CONCLUIDA,
      restantes: 0,
      mensagem: `Meta atingida: ${sessao.aprovados} lead(s) aprovado(s) e prontos para abordagem.`,
    }
  }

  let fila = Array.isArray(sessao.fila_json) ? sessao.fila_json : []
  if (!fila.length) {
    fila = await montarFila(pool, { empresaId, sessao, deps })
    if (fila.length) {
      const atualizada = await curadoriaDb.salvarFila(pool, empresaId, sessao.id, fila)
      if (atualizada) sessao = atualizada
    }
  }

  if (!fila.length) {
    // Sessão que ainda não decidiu nada e não achou ninguém não é fila esgotada: é
    // mercado que ainda não chegou na carteira (a coleta leva minutos). Dizer "você já
    // decidiu todos" nesse caso seria mentira — e logo depois de uma busca guiada, é
    // justamente o estado mais provável.
    const nadaDecidido = Number(sessao.aprovados) === 0 && Number(sessao.descartados) === 0
    const mensagem = sessao.escopo_ampliado
      ? 'Acabaram os leads sem decisão na sua carteira. Faça uma nova busca para trazer leads novos.'
      : nadaDecidido
        ? `Ainda não há leads de ${mercadoDaSessao(sessao)} esperando decisão. Se você acabou de buscar, eles chegam em alguns minutos — ou dá para ampliar e olhar o resto da carteira agora.`
        : `Você já decidiu todos os leads de ${mercadoDaSessao(sessao)}. Dá para ampliar e olhar o resto da carteira, ou buscar mais leads deste mercado.`
    return {
      sessao: apresentarSessao(sessao),
      oportunidade: null,
      estado: ESTADOS.SEM_CANDIDATOS,
      restantes: 0,
      mensagem,
      // Ações objetivas para não encerrar a sessão no vazio.
      ampliar_disponivel: !sessao.escopo_ampliado,
    }
  }

  const restantes = await curadoriaDb.contarCandidatos(pool, empresaId, {
    nicho: sessao.nicho, cidade: sessao.cidade, ampliado: sessao.escopo_ampliado,
  })

  return {
    sessao: apresentarSessao(sessao),
    oportunidade: fila[0],
    estado: ESTADOS.ANALISANDO,
    restantes,
    mensagem: null,
  }
}

/**
 * Retrato BARATO da sessão do operador, para desenhar o modal de entrada do assistente.
 *
 * Diferente de `obterEstadoAtual`, este caminho NÃO monta fila e portanto NÃO chama a IA
 * nem varre candidatos: abrir o menu do botão premium não pode custar uma chamada paga.
 * Só responde "existe sessão em andamento? de qual mercado? em que ponto ela está?".
 */
async function resumoSessao(pool, { empresaId, usuarioId = null } = {}) {
  if (!empresaId) throw erro('Empresa não informada.', 400)
  const [sessao, historico] = await Promise.all([
    curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId),
    curadoriaDb.historicoSessoes(pool, empresaId),
  ])
  return {
    sessao: apresentarSessao(sessao),
    // Quantos leads da fila já explicada continuam esperando decisão. É estimativa de
    // tela (a fila é reabastecida quando esvazia), nunca base para contar meta.
    fila_pendente: Array.isArray(sessao?.fila_json) ? sessao.fila_json.length : 0,
    historico,
  }
}

/** Sessão ativa do operador (ou nada). Não cria sessão e não chama IA à toa. */
async function obterEstadoAtual(pool, { empresaId, usuarioId = null, deps = {} } = {}) {
  const sessao = await curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId)
  const estado = await montarEstado(pool, { empresaId, sessao, deps })
  const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
  return { ...estado, historico }
}

/**
 * Abre a sessão (ou devolve a que já estava aberta — o botão nunca cria duas).
 * NÃO dispara busca, não importa lead e não altera nenhum lead por si.
 */
async function iniciarSessao(pool, { empresaId, usuarioId = null, nicho = null, cidade = null, uf = null, meta, deps = {} } = {}) {
  if (!empresaId) throw erro('Empresa não informada.', 400)

  const existente = await curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId)
  if (existente) {
    const estado = await montarEstado(pool, { empresaId, sessao: existente, deps })
    const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
    return { ...estado, historico, reaproveitada: true }
  }

  const sessao = await curadoriaDb.criarSessao(pool, empresaId, {
    usuarioId,
    nicho: textoLimitado(nicho, 160) || null,
    cidade: textoLimitado(cidade, 160) || null,
    uf: normalizarUf(uf) || null,
    meta: normalizarMeta(meta),
  })
  logger.info(
    { operation: 'aquisicao_curadoria', etapa: 'sessao_aberta', empresa_id: empresaId, meta: sessao.meta },
    'sessão de curadoria aberta'
  )
  const estado = await montarEstado(pool, { empresaId, sessao, deps })
  const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
  return { ...estado, historico }
}

/**
 * Aplica a decisão do operador sobre a oportunidade da vez e já devolve a próxima.
 * A idempotência é garantida no banco: repetir a ação não importa o lead de novo nem
 * consome a meta.
 */
async function decidirOportunidade(pool, { empresaId, usuarioId = null, prospectId, decisao, deps = {} } = {}) {
  if (!empresaId || !prospectId) throw erro('Lead não informado.', 400)
  if (!['aprovado', 'descartado'].includes(decisao)) throw erro('Decisão inválida.', 400)

  const sessao = await curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId)
  if (!sessao) throw erro('Nenhuma sessão em andamento. Clique em Analisar oportunidades.', 409)

  const fila = Array.isArray(sessao.fila_json) ? sessao.fila_json : []
  const item = fila.find((i) => i && i.prospect_id === prospectId) || null
  const filaRestante = fila.filter((i) => i && i.prospect_id !== prospectId)

  const resultado = await curadoriaDb.decidir(pool, {
    empresaId,
    sessaoId: sessao.id,
    prospectId,
    decisao,
    usuarioId,
    justificativa: item?.motivo || null,
    caracteristicas: item?.caracteristicas || {},
    filaRestante,
  })

  const estado = await montarEstado(pool, { empresaId, sessao: resultado.sessao, deps })
  const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
  return {
    ...estado,
    historico,
    decisao: {
      prospect_id: prospectId,
      decisao,
      contou_meta: resultado.contou,
      repetida: resultado.repetida,
      // Já decidido antes (por outra aba, outro operador ou pela lista de leads).
      ja_decidido: !resultado.novo,
      nome: item?.nome || resultado.prospect?.nome || null,
    },
  }
}

/** Amplia a sessão para além do mercado buscado, quando os candidatos acabam. */
async function ampliarSessao(pool, { empresaId, usuarioId = null, deps = {} } = {}) {
  const sessao = await curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId)
  if (!sessao) throw erro('Nenhuma sessão em andamento.', 409)
  if (sessao.escopo_ampliado) throw erro('A sessão já está olhando toda a carteira.', 409)
  const ampliada = await curadoriaDb.ampliarEscopo(pool, empresaId, sessao.id)
  const estado = await montarEstado(pool, { empresaId, sessao: ampliada || sessao, deps })
  const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
  return { ...estado, historico }
}

/** Encerra a sessão por vontade do operador. Nada do que foi decidido é desfeito. */
async function encerrarSessao(pool, { empresaId, usuarioId = null } = {}) {
  const sessao = await curadoriaDb.obterSessaoAtiva(pool, empresaId, usuarioId)
  if (!sessao) return { sessao: null, oportunidade: null, estado: null, mensagem: null, restantes: 0, historico: [] }
  const encerrada = await curadoriaDb.encerrarSessao(pool, empresaId, sessao.id, 'encerrada')
  const historico = await curadoriaDb.historicoSessoes(pool, empresaId)
  return {
    sessao: apresentarSessao(encerrada || sessao),
    oportunidade: null,
    estado: ESTADOS.CONCLUIDA,
    restantes: 0,
    mensagem: `Sessão encerrada com ${(encerrada || sessao).aprovados} lead(s) aprovado(s).`,
    historico,
  }
}

module.exports = {
  ESTADOS,
  LOTE_FILA,
  CANDIDATOS_AVALIADOS,
  META_MAX,
  normalizarMeta,
  aplicarJustificativas,
  itemDaFila,
  apresentarSessao,
  montarFila,
  montarEstado,
  resumoSessao,
  obterEstadoAtual,
  iniciarSessao,
  decidirOportunidade,
  ampliarSessao,
  encerrarSessao,
}
