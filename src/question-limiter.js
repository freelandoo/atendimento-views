'use strict'

/**
 * Regra de uma pergunta por mensagem.
 *
 * Distinção central:
 *   Pergunta SOLTA  → frase própria terminada em "?". Múltiplas = problema.
 *   Pergunta CONTEXTUAL → uma única frase que combina 2 necessidades com "e" ou "ou".
 *
 * Exemplo ruim  (2 perguntas soltas):
 *   "Qual seu negócio? E a cidade?"
 *
 * Exemplo correto (1 pergunta contextual):
 *   "Qual é o seu negócio e em qual cidade você atende?"
 *
 * Run-on question (1 "?" mas pedindo muita coisa — também ruim):
 *   "Qual negócio, cidade, ticket, se tem site e quanto investe?"
 */

const MAX_QUESTIONS_PER_MESSAGE = 1

// ─── Mapeamento de campo → fragmento de pergunta contextual ──────────────────
// Cada fragmento é formulado para se conectar naturalmente com "e" ou sozinho.

const FIELD_QUESTION_FRAGMENTS = {
  businessType: 'qual é o seu negócio',
  city: 'em qual cidade ou região você atende',
  mainService: 'você procura site, sistema, automação ou agente de IA',
  hasWebsite: 'já tem site',
  goal: 'qual é o seu principal objetivo com a solução digital',
}

// ─── Detecção ─────────────────────────────────────────────────────────────────

/**
 * Conta o número de perguntas SOLTAS (frases separadas terminadas em "?").
 * "???" conta como uma única pergunta (uma frase só).
 *
 * @param {string} message
 * @returns {number}
 */
function countLooseQuestions(message) {
  const text = String(message || '')
  // Split no(s) "?". Cada segmento não-vazio antes de um "?" é uma pergunta.
  const segments = text.split(/\?+/)
  return segments.filter((seg, i) => i < segments.length - 1 && seg.trim().length > 0).length
}

/**
 * Alias explícito para uso como validação simples (conforme especificação da Etapa 5).
 * Idêntico a countLooseQuestions.
 */
const countQuestions = countLooseQuestions

/**
 * Detecta run-on question: uma única "?" mas listando 3+ itens separados por vírgula.
 * Indica que a IA está empacotando muitas perguntas numa só frase.
 *
 * @param {string} message
 * @returns {boolean}
 */
function detectRunOnQuestion(message) {
  const text = String(message || '')
  // Só aplica se há exatamente 1 "?" (run-on tem 1 "?")
  if (countLooseQuestions(text) !== 1) return false

  // Pattern: lista com 3+ vírgulas dentro da mesma pergunta
  const questionSegment = text.split(/\?/)[0]
  const commaCount = (questionSegment.match(/,/g) || []).length
  if (commaCount >= 3) return true

  // Pattern: múltiplos "se" na mesma pergunta (se tem X, se aparece Y, se usa Z)
  const seCount = (questionSegment.match(/\bse\s+\w/gi) || []).length
  if (seCount >= 2) return true

  return false
}

// ─── Validação ────────────────────────────────────────────────────────────────

/**
 * Valida a regra de 1 pergunta por mensagem, independente de estágio.
 *
 * @param {string} message
 * @returns {{ valid, questionCount, maxAllowed, hasRunOn, violations }}
 */
function validateQuestionRule(message) {
  const questionCount = countLooseQuestions(message)
  const hasRunOn = detectRunOnQuestion(message)
  const tooManyLoose = questionCount > MAX_QUESTIONS_PER_MESSAGE

  const violations = []
  if (tooManyLoose) {
    violations.push(`${questionCount} perguntas separadas — máximo é ${MAX_QUESTIONS_PER_MESSAGE}`)
  }
  if (hasRunOn) {
    violations.push('run-on question: uma pergunta listando muitos itens')
  }

  return {
    valid: !tooManyLoose && !hasRunOn,
    questionCount,
    maxAllowed: MAX_QUESTIONS_PER_MESSAGE,
    hasRunOn,
    violations,
  }
}

// ─── Reparo ───────────────────────────────────────────────────────────────────

/**
 * Remove perguntas extras de uma mensagem, mantendo apenas a primeira.
 * Preserva todo o texto de contexto anterior à primeira "?".
 *
 * Entrada:  "Entendo. Qual seu negócio? E a cidade? E o site?"
 * Saída:    "Entendo. Qual seu negócio?"
 *
 * @param {string} message
 * @returns {string}
 */
function stripToOneQuestion(message) {
  const text = String(message || '').trim()
  if (countLooseQuestions(text) <= MAX_QUESTIONS_PER_MESSAGE) return text

  const firstMark = text.indexOf('?')
  if (firstMark === -1) return text

  return text.slice(0, firstMark + 1).trim()
}

// ─── Construtor de pergunta contextual ───────────────────────────────────────

/**
 * Constrói UMA pergunta contextual a partir de campos faltantes,
 * combinando no máximo 2 deles com "e" para não sobrecarregar o lead.
 *
 * Exemplo:
 *   buildContextualQuestion(['businessType', 'city'])
 *   → "Qual é o seu negócio e em qual cidade ou região você atende?"
 *
 *   buildContextualQuestion(['city'])
 *   → "Em qual cidade ou região você atende?"
 *
 * @param {string[]} missingFields  Lista de campos faltantes (de getMissingInfo)
 * @param {string}   [prefix]       Contexto opcional antes da pergunta ("Para te orientar: ")
 * @returns {string|null}  Pergunta pronta ou null se não há campos
 */
function buildContextualQuestion(missingFields, prefix = '') {
  if (!Array.isArray(missingFields) || missingFields.length === 0) return null

  // Usa no máximo 2 campos para manter a pergunta legível
  const fieldsToAsk = missingFields.slice(0, 2)
  const fragments = fieldsToAsk
    .map((f) => FIELD_QUESTION_FRAGMENTS[f])
    .filter(Boolean)

  if (fragments.length === 0) return null

  let questionBody
  if (fragments.length === 1) {
    questionBody = _capitalize(fragments[0])
  } else {
    // "X e Y?" — conecta os dois fragmentos
    questionBody = _capitalize(fragments[0]) + ' e ' + fragments[1]
  }

  const prefixStr = prefix ? prefix.trim() + ' ' : ''
  return `${prefixStr}${questionBody}?`
}

// ─── Interno ──────────────────────────────────────────────────────────────────

function _capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

module.exports = {
  MAX_QUESTIONS_PER_MESSAGE,
  FIELD_QUESTION_FRAGMENTS,
  countQuestions,
  countLooseQuestions,
  detectRunOnQuestion,
  validateQuestionRule,
  stripToOneQuestion,
  buildContextualQuestion,
}
