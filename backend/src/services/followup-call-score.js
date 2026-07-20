'use strict'
// Call score do modo Semi da pagina de Follow-ups: pontua e ranqueia leads que valem
// uma LIGACAO humana (mensagem escala, mas ligacao converte). Funcao PURA e testavel:
// recebe um objeto de sinais ja normalizado (a coleta no banco vive no service de
// listagem) e devolve { elegivel, score, temperatura, motivo, motivos }.
//
// Pesos ficam como constantes nomeadas nesta fase (Fase 1). Torna-los editaveis pela
// UI e Fase 3 — por isso ficam agrupados aqui em cima, faceis de externalizar depois.

// Criterios da §2 do plano. Cada peso e o maximo de pontos que o sinal soma.
const PESOS = {
  pediu_preco_sumiu: 30, // 🔥 pediu preco / recebeu proposta e sumiu (sinal de compra travado)
  estagio_negociacao: 20, // quente: perto de fechar
  estagio_proposta: 18, // quente: proposta na mesa
  engajou_silenciou: 15, // respondeu antes e sumiu (estava interessado)
  followups_ignorados: 12, // canal mensagem esgotado -> hora da voz (medio)
  reuniao_pendente: 20, // reuniao marcada nao confirmada / no-show (recuperavel por ligacao)
  qualidade_lead: 15, // score do lead (lead quente > frio) (medio)
}

// A partir de quantos follow-ups de WhatsApp ignorados o canal msg conta como "esgotado".
const FOLLOWUPS_IGNORADOS_MIN = 2
// Janela em que o silencio ainda conta como "quente" (recencia). Alem disso, esfria.
const SILENCIO_QUENTE_DIAS = 3
const SILENCIO_MORNO_DIAS = 10

const ESTAGIOS_QUENTES = new Set(['negociacao', 'proposta_enviada'])

// Faixas de temperatura sobre o score final (0-100).
const TEMP_QUENTE_MIN = 60
const TEMP_MORNO_MIN = 35

const ACOES_HUMANAS = Object.freeze({
  ASSUMIR: 'assumir_conversa',
  LIGAR: 'ligar',
  COPIAR_PROMPT_PREVIEW: 'copiar_prompt_preview',
  REVISAR_PROPOSTA: 'revisar_proposta',
  MENSAGEM_MANUAL: 'mensagem_manual',
})

const ACAO_LABEL = Object.freeze({
  [ACOES_HUMANAS.ASSUMIR]: 'Assumir conversa',
  [ACOES_HUMANAS.LIGAR]: 'Ligar',
  [ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW]: 'Copiar prompt de preview',
  [ACOES_HUMANAS.REVISAR_PROPOSTA]: 'Revisar proposta',
  [ACOES_HUMANAS.MENSAGEM_MANUAL]: 'Mensagem manual',
})

function temperaturaDoScore(score) {
  if (score >= TEMP_QUENTE_MIN) return 'quente'
  if (score >= TEMP_MORNO_MIN) return 'morno'
  return 'frio'
}

// Fator de recencia (0..1): silencio recente pesa mais; muito antigo pesa menos.
function fatorRecencia(diasSilencio) {
  const d = Number(diasSilencio)
  if (!Number.isFinite(d) || d <= SILENCIO_QUENTE_DIAS) return 1
  if (d >= 30) return 0.35
  // decai linear de 1 (em SILENCIO_QUENTE_DIAS) ate ~0.35 (em 30 dias)
  const frac = (d - SILENCIO_QUENTE_DIAS) / (30 - SILENCIO_QUENTE_DIAS)
  return Math.max(0.35, 1 - frac * 0.65)
}

function frase(dias) {
  const d = Number(dias)
  if (!Number.isFinite(d) || d <= 0) return 'recentemente'
  if (d === 1) return 'ha 1 dia'
  return `ha ${Math.round(d)} dias`
}

/**
 * @param {object} s Sinais normalizados do lead:
 *   pediu_preco {boolean}, recebeu_proposta {boolean}, estagio {string},
 *   respondeu_alguma_vez {boolean}, dias_silencio {number},
 *   followups_ignorados {number}, reuniao_pendente {boolean},
 *   score_lead {number 0-100}, opt_out {boolean}
 * @returns {{elegivel:boolean, score:number, temperatura:string, motivo:string, motivos:string[]}}
 */
function calcularCallScore(s = {}) {
  // Opt-out / "sem interesse" -> SAI da lista (nunca ligar).
  if (s.opt_out) {
    return { elegivel: false, score: 0, temperatura: 'frio', motivo: 'opt-out / sem interesse', motivos: [] }
  }

  const rec = fatorRecencia(s.dias_silencio)
  const motivos = []
  let score = 0

  // 🔥 Pediu preco / recebeu proposta e sumiu — sinal de compra que travou.
  if (s.pediu_preco || s.recebeu_proposta) {
    score += PESOS.pediu_preco_sumiu * rec
    const oque = s.pediu_preco ? 'pediu preco' : 'recebeu proposta'
    motivos.push(`${oque} e sumiu ${frase(s.dias_silencio)}`)
  }

  // Estagio quente (perto de fechar).
  if (s.estagio === 'negociacao') {
    score += PESOS.estagio_negociacao * rec
    motivos.push('esta em negociacao')
  } else if (s.estagio === 'proposta_enviada') {
    score += PESOS.estagio_proposta * rec
    motivos.push('recebeu proposta e nao respondeu')
  }

  // Engajou (respondeu) e silenciou — estava interessado.
  if (s.respondeu_alguma_vez) {
    score += PESOS.engajou_silenciou * rec
    motivos.push(`conversou e silenciou ${frase(s.dias_silencio)}`)
  }

  // Ignorou N follow-ups de WhatsApp -> canal mensagem esgotado, hora da voz.
  const ignorados = Number(s.followups_ignorados) || 0
  if (ignorados >= FOLLOWUPS_IGNORADOS_MIN) {
    const escala = Math.min(1, ignorados / 4)
    score += PESOS.followups_ignorados * escala
    motivos.push(`ignorou ${ignorados} follow-ups no WhatsApp`)
  }

  // Reuniao marcada nao confirmada / no-show — recuperavel por ligacao.
  if (s.reuniao_pendente) {
    score += PESOS.reuniao_pendente
    motivos.push('tem reuniao marcada nao confirmada')
  }

  // Qualidade do lead (score) — quente > frio.
  const scoreLead = Number(s.score_lead)
  if (Number.isFinite(scoreLead) && scoreLead > 0) {
    score += PESOS.qualidade_lead * Math.min(1, scoreLead / 100)
  }

  const scoreFinal = Math.max(0, Math.min(100, Math.round(score)))
  const motivo = motivos[0] || 'lead silencioso — vale um contato por voz'

  return {
    elegivel: scoreFinal > 0,
    score: scoreFinal,
    temperatura: temperaturaDoScore(scoreFinal),
    motivo,
    motivos,
  }
}

function textoSeguro(value, max = 180) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function contextoPreview(s = {}) {
  const contexto = s.contexto_prospeccao && typeof s.contexto_prospeccao === 'object'
    ? s.contexto_prospeccao
    : {}
  const negocio = textoSeguro(s.negocio || contexto.nome, 100)
  const cidade = textoSeguro(s.cidade || contexto.cidade, 100)
  const produto = textoSeguro(s.produto_sugerido || s.complexidade, 100)
  const dor = textoSeguro(s.dor_principal || contexto.dor_principal, 180)
  const temSite = contexto.tem_site === true
  const ultimoTexto = textoSeguro(s.ultimo_texto_usuario, 300).toLowerCase()
  const pediuVisual = /(como ficaria|como vai ficar|exemplo|pr[eé]via|preview|visual|modelo|ver (?:o|um) site)/i.test(ultimoTexto)
  const produtoSite = /(site|landing|p[aá]gina|presen[cç]a digital|google)/i.test(`${produto} ${dor}`)
  const contextoSuficiente = !!(negocio && cidade && (dor || produto || contexto.tem_site === false))
  return {
    negocio,
    cidade,
    produto,
    dor,
    temSite,
    pediuVisual,
    contextoSuficiente,
    produtoSite,
  }
}

function montarPromptPreviewExterno(s = {}) {
  const ctx = contextoPreview(s)
  if (!ctx.contextoSuficiente) return null
  const situacaoSite = ctx.temSite
    ? 'O negócio já possui site; apresente uma evolução visual, sem copiar marcas ou layouts existentes.'
    : 'O negócio ainda não possui site confirmado; mostre uma presença digital profissional e plausível.'
  return [
    'Crie uma imagem de prévia visual de uma landing page desktop, moderna e comercial, em português do Brasil.',
    'A imagem deve parecer a captura de um site real pronto, não um wireframe, rascunho, blueprint ou apresentação.',
    `Negócio: ${ctx.negocio}.`,
    `Cidade/região: ${ctx.cidade}.`,
    ctx.produto ? `Solução em avaliação: ${ctx.produto}.` : '',
    ctx.dor ? `Objetivo/dor conhecida: ${ctx.dor}.` : '',
    situacaoSite,
    'Estrutura sugerida: hero com proposta de valor curta, prova de confiança, serviços principais, benefícios e chamada para WhatsApp.',
    'Use textos curtos, legíveis e realistas. Não invente telefone, preço, avaliações, depoimentos, certificações, logotipo ou promessa de resultado.',
    'Formato 16:9, aparência premium e adequada a uma pequena empresa brasileira.',
  ].filter(Boolean).join('\n')
}

function horarioSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const get = (tipo) => partes.find((p) => p.type === tipo)?.value
  return {
    dia: get('weekday'),
    hora: (Number(get('hour')) || 0) + ((Number(get('minute')) || 0) / 60),
  }
}

function fmtHora(decimal) {
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

function recomendarJanelaAcao(acao, contexto = horarioSaoPaulo()) {
  if (acao === ACOES_HUMANAS.ASSUMIR) return 'Agora'
  const diaUtil = !['Sat', 'Sun', 'sabado', 'domingo'].includes(contexto.dia)
  const janelas = acao === ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW || acao === ACOES_HUMANAS.REVISAR_PROPOSTA
    ? [[14.5, 17]]
    : acao === ACOES_HUMANAS.LIGAR
      ? [[8.5, 10.5], [14.5, 17]]
      : [[8.5, 10.5], [18.5, 20]]
  const label = ([ini, fim]) => `${fmtHora(ini)}–${fmtHora(fim)}`
  const verbo = acao === ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW
    ? 'enviar o preview'
    : acao === ACOES_HUMANAS.LIGAR
      ? 'ligar'
      : acao === ACOES_HUMANAS.REVISAR_PROPOSTA
        ? 'revisar a proposta'
        : 'contatar'
  if (!diaUtil) return `Próximo dia útil — ${verbo}, ${label(janelas[0])}`
  const atual = janelas.find(([ini, fim]) => contexto.hora >= ini && contexto.hora <= fim)
  if (atual) return `Agora — ${verbo} até ${fmtHora(atual[1])}`
  const proxima = janelas.find(([ini]) => contexto.hora < ini)
  return proxima
    ? `Hoje — ${verbo}, ${label(proxima)}`
    : `Próximo dia útil — ${verbo}, ${label(janelas[0])}`
}

function recomendarAcaoHumana(s = {}, contextoHorario) {
  const call = calcularCallScore(s)
  const handoffPendente = s.aguardando_handoff || s.pronto_handoff
  if (s.opt_out || (!call.elegivel && !handoffPendente)) {
    return {
      ...call,
      acao_recomendada: null,
      acao_label: null,
      janela_recomendada: null,
      orientacao: null,
      prompt_preview: null,
    }
  }

  let acao = null
  let score = call.score
  let motivo = call.motivo
  let orientacao = 'Revise o histórico e faça uma abordagem humana curta, sem repetir perguntas já respondidas.'
  const preview = contextoPreview(s)
  const previewElegivel = !s.recebeu_preview && s.respondeu_alguma_vez && preview.contextoSuficiente &&
    (preview.pediuVisual || preview.produtoSite || !preview.temSite)

  if (handoffPendente) {
    acao = ACOES_HUMANAS.ASSUMIR
    score = 100
    motivo = 'handoff solicitado — a conversa precisa de uma pessoa'
    orientacao = 'Assuma a conversa agora, leia o último pedido do lead e deixe claro que o atendimento humano começou.'
  } else if (s.reuniao_pendente) {
    acao = ACOES_HUMANAS.LIGAR
    score = Math.max(score, 80)
    motivo = 'reunião pendente ou ainda não confirmada'
    orientacao = 'Ligue para confirmar disponibilidade e remover o atrito do agendamento; não refaça todo o diagnóstico.'
  } else if ((Number(s.followups_ignorados) || 0) >= FOLLOWUPS_IGNORADOS_MIN) {
    acao = ACOES_HUMANAS.LIGAR
    score = Math.max(score, 70)
    motivo = `ignorou ${Number(s.followups_ignorados)} follow-ups — o canal de mensagem está esgotado`
    orientacao = 'Use a ligação como troca de canal, com abertura curta e sem cobrar resposta às mensagens anteriores.'
  } else if (previewElegivel && preview.pediuVisual) {
    acao = ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW
    score = Math.max(score, 75)
    motivo = 'o lead pediu para visualizar como o site poderia ficar'
    orientacao = 'Copie o prompt, gere a imagem fora do projeto, revise os fatos e só então envie manualmente ao lead.'
  } else if (s.recebeu_proposta) {
    acao = ACOES_HUMANAS.REVISAR_PROPOSTA
    score = Math.max(score, 65)
    motivo = 'recebeu proposta e ainda não avançou'
    orientacao = 'Revise a proposta e a objeção provável antes de retomar; não reenvie preço sem um ângulo novo.'
  } else if (previewElegivel && (s.pediu_preco || ['diagnostico', 'proposta', 'objecao'].includes(s.estagio) || Number(s.score_lead) >= 45)) {
    acao = ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW
    score = Math.max(score, 55)
    motivo = 'uma prova visual pode destravar a percepção de valor'
    orientacao = 'Copie o prompt, gere a imagem fora do projeto e valide se ela representa o negócio antes de enviar.'
  } else if (['negociacao', 'proposta_enviada'].includes(s.estagio)) {
    acao = ACOES_HUMANAS.LIGAR
    score = Math.max(score, 55)
    motivo = s.estagio === 'negociacao' ? 'negociação parada' : 'proposta enviada sem resposta'
    orientacao = 'Ligue para identificar o atrito real e combinar um próximo passo concreto, sem pressionar fechamento.'
  } else {
    acao = ACOES_HUMANAS.MENSAGEM_MANUAL
    score = Math.max(score, 35)
  }

  return {
    elegivel: true,
    score: Math.min(100, Math.round(score)),
    temperatura: temperaturaDoScore(score),
    motivo,
    motivos: call.motivos,
    acao_recomendada: acao,
    acao_label: ACAO_LABEL[acao],
    janela_recomendada: recomendarJanelaAcao(acao, contextoHorario || horarioSaoPaulo()),
    orientacao,
    prompt_preview: acao === ACOES_HUMANAS.COPIAR_PROMPT_PREVIEW ? montarPromptPreviewExterno(s) : null,
  }
}

module.exports = {
  calcularCallScore,
  temperaturaDoScore,
  fatorRecencia,
  PESOS,
  ESTAGIOS_QUENTES,
  FOLLOWUPS_IGNORADOS_MIN,
  ACOES_HUMANAS,
  ACAO_LABEL,
  recomendarAcaoHumana,
  recomendarJanelaAcao,
  montarPromptPreviewExterno,
}
