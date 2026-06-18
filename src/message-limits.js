'use strict'

/**
 * Limites de mensagem por estágio da conversa.
 *
 * Cada estágio define:
 *   minChars     → mínimo de caracteres (resposta muito seca = ruim)
 *   maxChars     → máximo de caracteres (HARD LIMIT — nunca ultrapassar)
 *   maxQuestions → máximo de perguntas por resposta (lead não pode responder 3 perguntas de vez)
 *   maxMessages  → máximo de bubbles WhatsApp para esse estágio
 *
 * LIMITE ABSOLUTO DO SISTEMA: 900 caracteres por mensagem (objection stage).
 * Nenhuma mensagem pode passar disso independente do estágio.
 */

const MESSAGE_LIMITS = {
  new_lead: {
    minChars: 180,
    maxChars: 350,
    maxQuestions: 1,
    maxMessages: 1,
  },
  qualification: {
    minChars: 100,
    maxChars: 300,
    maxQuestions: 1,
    maxMessages: 1,
  },
  diagnosis: {
    minChars: 150,
    maxChars: 450,
    maxQuestions: 1,
    maxMessages: 1,
  },
  solution_explanation: {
    minChars: 350,
    maxChars: 700,
    maxQuestions: 1,
    maxMessages: 2,
  },
  price_question: {
    minChars: 400,
    maxChars: 800,
    maxQuestions: 1,
    maxMessages: 2,
  },
  objection: {
    minChars: 500,
    maxChars: 900,
    maxQuestions: 1,
    maxMessages: 2,
  },
  meeting_offer: {
    minChars: 250,
    maxChars: 500,
    maxQuestions: 1,
    maxMessages: 1,
  },
  meeting_scheduled: {
    minChars: 100,
    maxChars: 350,
    maxQuestions: 0,
    maxMessages: 1,
  },
  follow_up: {
    minChars: 120,
    maxChars: 300,
    maxQuestions: 1,
    maxMessages: 1,
  },
  closed: {
    minChars: 80,
    maxChars: 300,
    maxQuestions: 0,
    maxMessages: 1,
  },
  lost: {
    minChars: 80,
    maxChars: 250,
    maxQuestions: 0,
    maxMessages: 1,
  },
}

const ABSOLUTE_MAX_CHARS = 900

const FALLBACK_LIMITS = {
  minChars: 100,
  maxChars: 500,
  maxQuestions: 1,
  maxMessages: 1,
}

const BUBBLE_LIMITS_BY_FUNNEL_STAGE = Object.freeze({
  primeiro_contato: 1,
  diagnostico: 2,
  qualificacao: 2,
  conexao_valor: 2,
  convite_reuniao: 2,
  agendamento_pendente: 2,
  agendamento: 2,
  reuniao_agendada: 2,
  confirmacao_reuniao: 2,
  proposta: 2,
  objecao: 2,
  fechamento: 2,
  follow_up: 2,
  encerrado: 1,
  handoff_humano: 1,
})

const BUBBLE_STAGE_ALIASES = Object.freeze({
  new_lead: 'primeiro_contato',
  first_contact: 'primeiro_contato',
  qualification: 'qualificacao',
  diagnosis: 'diagnostico',
  solution_explanation: 'conexao_valor',
  meeting_offer: 'convite_reuniao',
  meeting_scheduled: 'reuniao_agendada',
  scheduled_meeting: 'reuniao_agendada',
  closed: 'encerrado',
})

const DEFAULT_FUNNEL_BUBBLE_LIMIT = 2
const BOLHA_COMPACTADA_MAX_CHARS = 450

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna os limites para um estágio. Usa fallback se o estágio for desconhecido.
 *
 * @param {string} stage
 * @returns {{ minChars, maxChars, maxQuestions, maxMessages }}
 */
function getLimits(stage) {
  return MESSAGE_LIMITS[stage] || FALLBACK_LIMITS
}

function normalizarEtapaLimiteBolhas(etapa) {
  const raw = String(etapa || '').trim().toLowerCase()
  if (!raw) return ''
  return BUBBLE_STAGE_ALIASES[raw] || raw
}

function limiteBolhasPorEtapa(etapa) {
  const stage = normalizarEtapaLimiteBolhas(etapa)
  if (!stage) return DEFAULT_FUNNEL_BUBBLE_LIMIT
  return BUBBLE_LIMITS_BY_FUNNEL_STAGE[stage] || DEFAULT_FUNNEL_BUBBLE_LIMIT
}

function removerPerguntasExtras(texto, maxPerguntas = 1) {
  let count = 0
  return String(texto || '').replace(/\?+/g, (match) => {
    count += 1
    return count <= maxPerguntas ? '?' : '.'
  })
}

function compactarTextoBolha(texto, maxChars = BOLHA_COMPACTADA_MAX_CHARS) {
  let out = String(texto || '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  out = removerPerguntasExtras(out, 1)
  if (out.length <= maxChars) return out
  const cutoff = maxChars - 1
  const lastSpace = out.lastIndexOf(' ', cutoff)
  const breakAt = lastSpace > maxChars * 0.75 ? lastSpace : cutoff
  return out.slice(0, breakAt).trimEnd() + '...'
}

function normalizarListaBolhas(mensagens) {
  const arr = Array.isArray(mensagens) ? mensagens : [mensagens]
  return arr
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim())
    .filter(Boolean)
}

/**
 * Limita bolhas por etapa sem bloquear a conversa. Quando ha excesso, compacta
 * as mensagens excedentes para garantir que nada com 3 ou 4 bolhas chegue ao lead.
 *
 * @param {{ etapa?: string, mensagens: string[] }} input
 * @returns {string[]}
 */
function limitarBolhasPorEtapa(input = {}) {
  const mensagens = normalizarListaBolhas(input.mensagens)
  if (!mensagens.length) return []
  const limite = Math.max(1, limiteBolhasPorEtapa(input.etapa))
  if (mensagens.length <= limite) return mensagens.map((m) => compactarTextoBolha(m))
  if (limite === 1) {
    return [compactarTextoBolha(mensagens.join(' '))]
  }
  const mantidas = mensagens.slice(0, limite - 1).map((m) => compactarTextoBolha(m))
  const excedenteCompactado = compactarTextoBolha(mensagens.slice(limite - 1).join(' '))
  return [...mantidas, excedenteCompactado].filter(Boolean)
}

/**
 * Valida o tamanho da mensagem contra os limites do estágio.
 *
 * @param {string} stage    Estágio da conversa
 * @param {string} message  Texto da mensagem (uma bubble)
 * @returns {{ valid, tooShort, tooLong, length, minAllowed, maxAllowed }}
 */
function validateMessageLength(stage, message) {
  const limits = getLimits(stage)
  const length = String(message || '').length

  const tooShort = length < limits.minChars
  const tooLong = length > limits.maxChars

  return {
    valid: !tooShort && !tooLong,
    tooShort,
    tooLong,
    length,
    minAllowed: limits.minChars,
    maxAllowed: limits.maxChars,
  }
}

/**
 * Conta o número de perguntas em uma mensagem.
 * Sequências de "???" contam como uma única pergunta.
 *
 * @param {string} text
 * @returns {number}
 */
function countQuestions(text) {
  return (String(text || '').match(/\?+/g) || []).length
}

/**
 * Valida a quantidade de perguntas contra o limite do estágio.
 *
 * @param {string} stage
 * @param {string} message
 * @returns {{ valid, count, maxAllowed }}
 */
function validateQuestionCount(stage, message) {
  const limits = getLimits(stage)
  const count = countQuestions(message)
  return {
    valid: count <= limits.maxQuestions,
    count,
    maxAllowed: limits.maxQuestions,
  }
}

/**
 * Valida o número de bubbles contra o limite do estágio.
 *
 * @param {string} stage
 * @param {string[]} bubbles  Array de mensagens (uma por bubble)
 * @returns {{ valid, count, maxAllowed }}
 */
function validateBubbleCount(stage, bubbles) {
  const limits = getLimits(stage)
  const count = Array.isArray(bubbles) ? bubbles.length : 1
  return {
    valid: count <= limits.maxMessages,
    count,
    maxAllowed: limits.maxMessages,
  }
}

/**
 * Executa todas as validações (tamanho + perguntas) para uma mensagem única.
 *
 * @param {string} stage
 * @param {string} message
 * @returns {{ valid, length, questions, violations }}
 */
function validateAll(stage, message) {
  const lengthResult = validateMessageLength(stage, message)
  const questionResult = validateQuestionCount(stage, message)
  const valid = lengthResult.valid && questionResult.valid
  const violations = _collectViolations(lengthResult, questionResult)

  return {
    valid,
    length: lengthResult,
    questions: questionResult,
    violations,
  }
}

/**
 * Executa validação completa incluindo múltiplas bubbles.
 *
 * Regra de multi-bubble:
 *   - maxChars é verificado POR BUBBLE (cada parte não pode ser um textão)
 *   - minChars é verificado no TOTAL COMBINADO (a resposta como um todo não pode ser seca)
 *   - maxMessages verifica o número de bubbles
 *   - maxQuestions verifica o total de perguntas em todas as bubbles
 *
 * @param {string}   stage
 * @param {string[]} bubbles  Array de mensagens
 * @returns {{ valid, bubbleCount, perBubble, violations }}
 */
function validateBubbles(stage, bubbles) {
  const bubblesArray = Array.isArray(bubbles) ? bubbles : [String(bubbles || '')]
  const limits = getLimits(stage)
  const countResult = validateBubbleCount(stage, bubblesArray)

  // Valida maxChars individualmente e conta perguntas por bubble
  const perBubble = bubblesArray.map((b) => {
    const len = String(b || '').length
    const tooLong = len > limits.maxChars
    const qResult = validateQuestionCount(stage, b)
    return {
      valid: !tooLong && qResult.valid,
      tooShort: false,  // minChars não se aplica por bubble
      tooLong,
      length: len,
      maxAllowed: limits.maxChars,
      questions: qResult,
      violations: [
        ...(tooLong ? [`muito longa: ${len} > ${limits.maxChars} caracteres`] : []),
        ...(!qResult.valid ? [`perguntas demais: ${qResult.count} > ${qResult.maxAllowed}`] : []),
      ],
    }
  })

  // minChars é verificado no total combinado
  const totalLength = bubblesArray.reduce((sum, b) => sum + String(b || '').length, 0)
  const totalTooShort = totalLength < limits.minChars

  const allBubblesValid = perBubble.every((r) => r.valid)

  const violations = []
  if (!countResult.valid) {
    violations.push(`${countResult.count} bubbles enviadas, máximo é ${countResult.maxAllowed}`)
  }
  if (totalTooShort) {
    violations.push(`total muito curto: ${totalLength} < ${limits.minChars} caracteres`)
  }
  perBubble.forEach((r, i) => {
    r.violations.forEach((v) => violations.push(`bubble ${i + 1}: ${v}`))
  })

  return {
    valid: countResult.valid && allBubblesValid && !totalTooShort,
    bubbleCount: countResult,
    perBubble,
    violations,
  }
}

/**
 * Trunca uma mensagem no limite do estágio sem cortar palavras.
 * Adiciona "…" quando trunca.
 *
 * @param {string} stage
 * @param {string} message
 * @returns {string}
 */
function truncateToLimit(stage, message) {
  const limits = getLimits(stage)
  const text = String(message || '')
  if (text.length <= limits.maxChars) return text

  const cutoff = limits.maxChars - 1
  const lastSpace = text.lastIndexOf(' ', cutoff)
  const breakAt = lastSpace > limits.maxChars * 0.8 ? lastSpace : cutoff
  return text.slice(0, breakAt).trimEnd() + '…'
}

// ─── Interno ──────────────────────────────────────────────────────────────────

function _collectViolations(lengthResult, questionResult) {
  const violations = []
  if (lengthResult.tooShort) {
    violations.push(`muito curta: ${lengthResult.length} < ${lengthResult.minAllowed} caracteres`)
  }
  if (lengthResult.tooLong) {
    violations.push(`muito longa: ${lengthResult.length} > ${lengthResult.maxAllowed} caracteres`)
  }
  if (!questionResult.valid) {
    violations.push(`perguntas demais: ${questionResult.count} > ${questionResult.maxAllowed}`)
  }
  return violations
}

module.exports = {
  MESSAGE_LIMITS,
  ABSOLUTE_MAX_CHARS,
  BUBBLE_LIMITS_BY_FUNNEL_STAGE,
  getLimits,
  normalizarEtapaLimiteBolhas,
  limiteBolhasPorEtapa,
  limitarBolhasPorEtapa,
  validateMessageLength,
  countQuestions,
  validateQuestionCount,
  validateBubbleCount,
  validateAll,
  validateBubbles,
  truncateToLimit,
}
