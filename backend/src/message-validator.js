'use strict'

/**
 * Validador final da resposta antes do envio.
 *
 * Toda mensagem gerada passa por aqui antes de ser enviada ao lead.
 * Verifica 8 regras estruturais e semânticas, retorna lista de problemas
 * e, quando possível, uma versão corrigida automaticamente.
 *
 * Integra:
 *   message-limits   → limites por estágio, truncateToLimit
 *   question-limiter → countLooseQuestions, stripToOneQuestion
 *   meeting-invite   → isQualifiedForMeeting
 */

const { getLimits, truncateToLimit } = require('./message-limits')
const { countLooseQuestions, stripToOneQuestion } = require('./question-limiter')
const { isQualifiedForMeeting } = require('./meeting-invite')

// ─── Padrões de detecção (com NFD para ignorar acentos) ──────────────────────

function _norm(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// Promessas indevidas de resultado no Google
const GOOGLE_PROMISE_PATTERNS = [
  /garanti\w*\s+aparecer\s+no\s+google/,
  /vai\s+aparecer\s+no\s+google/,
  /aparece?\s+no\s+google/,
  /topo\s+do\s+google/,
  /primeira\s+pagina\s+do\s+google/,
  /primeiro\s+resultado\s+do\s+google/,
  /ranquear\s+no\s+google/,
  /prometo\s+\w+\s+(aparecer|ranquear)/,
]

// Linguagem agressiva / pressão indevida
const AGGRESSIVE_PATTERNS = [
  /ultima\s+chance/,
  /ultima\s+oportunidade/,
  /so\s+hoje/,
  /somente\s+hoje/,
  /agora\s+ou\s+nunca/,
  /decid\w+\s+agora/,
  /nao\s+perca\s+(essa|esta|a)\s+(chance|oportunidade)/,
  /promocao\s+(vai\s+)?acabar/,
  /desconto\s+acaba/,
  /vagas?\s+limitadas?/,
  /urgente[!.]/,
]

// Indicadores de preço concreto na mensagem
const PRICE_PATTERNS = [
  /r\$\s*\d/,
  /\d+\s*reais/,
  /mensalidade\s+[ée]\s+\d/,
  /parcelas?\s+de\s+r?\$?\s*\d/,
  /investimento\s+[ée]\s+\d/,
  /custa\s+r?\$?\s*\d/,
  /cobra\w*\s+r?\$?\s*\d/,
]

// Estágios onde revelar preço concreto é prematuro
const EARLY_PRICE_STAGES = ['new_lead']

// Linguagem de convite para reunião
const MEETING_LANGUAGE_PATTERNS = [
  /reuni[aã]o\s+r[aá]pida/,
  /15\s+minutos/,
  /qual\s+hor[aá]rio\s+fica\s+melhor/,
  /marcar\s+uma?\s+reuni[aã]o/,
  /bater\s+um\s+papo\s+r[aá]pido/,
  /apresentar\s+uma?\s+proposta/,
]

// Perguntas que indicam re-coleta de dado já informado
const PROFILE_REASKING = [
  {
    field: 'businessType',
    patterns: [
      /qual\s+[eé]\s+o\s+seu\s+neg[oó]cio/,
      /que\s+tipo\s+de\s+neg[oó]cio/,
      /qual\s+seu\s+neg[oó]cio/,
      /o\s+que\s+voc[eê]\s+faz\s+\?/,
    ],
  },
  {
    field: 'city',
    patterns: [
      /em\s+qual\s+cidade/,
      /de\s+qual\s+cidade/,
      /qual\s+cidade\s+voc[eê]/,
      /qual\s+a\s+sua\s+cidade/,
    ],
  },
  {
    field: 'hasWebsite',
    patterns: [
      /j[aá]\s+tem\s+site/,
      /voc[eê]\s+tem\s+site/,
      /tem\s+algum\s+site/,
      /possui\s+site/,
    ],
  },
]

// ─── Regras de validação ──────────────────────────────────────────────────────

function _checkGooglePromise(normalizedMsg) {
  return GOOGLE_PROMISE_PATTERNS.some((re) => re.test(normalizedMsg))
}

function _checkAggressive(normalizedMsg) {
  return AGGRESSIVE_PATTERNS.some((re) => re.test(normalizedMsg))
}

function _checkPriceTooEarly(stage, normalizedMsg) {
  if (!EARLY_PRICE_STAGES.includes(stage)) return false
  return PRICE_PATTERNS.some((re) => re.test(normalizedMsg))
}

function _checkIgnoredProfileInfo(normalizedMsg, profile = {}) {
  const ignored = []
  for (const { field, patterns } of PROFILE_REASKING) {
    if (profile[field] != null) {  // dado já informado pelo lead
      const reAsked = patterns.some((re) => re.test(normalizedMsg))
      if (reAsked) ignored.push(field)
    }
  }
  return ignored
}

function _checkWallOfText(message, maxChars) {
  const text = String(message || '')
  // Mensagem > 300 chars sem nenhuma quebra de linha é textão desnecessário
  return text.length > 300 && !text.includes('\n')
}

function _checkMeetingOffer(message, normalizedMsg, profile, intent) {
  const hasMeetingLanguage = MEETING_LANGUAGE_PATTERNS.some((re) => re.test(normalizedMsg))
  if (!hasMeetingLanguage) return null

  // Convite existe na mensagem — verifica se o lead está qualificado
  const qualified = isQualifiedForMeeting(profile, intent || 'interested')
  if (!qualified) return 'Convite para reunião prematuro — lead ainda não qualificado'

  return null
}

// ─── Auto-fix ─────────────────────────────────────────────────────────────────

/**
 * Tenta corrigir automaticamente problemas mecânicos (tamanho, perguntas).
 * Retorna null se nenhuma correção for possível.
 */
function _autoFix(stage, message, hasTooLong, hasTooManyQuestions) {
  if (!hasTooLong && !hasTooManyQuestions) return null

  let fixed = message

  if (hasTooLong) {
    fixed = truncateToLimit(stage, fixed)
  }

  if (hasTooManyQuestions && countLooseQuestions(fixed) > 1) {
    fixed = stripToOneQuestion(fixed)
  }

  return fixed !== message ? fixed : null
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Valida uma mensagem gerada pela IA antes de enviá-la ao lead.
 *
 * @param {object} params
 * @param {string}  params.stage        Estágio da conversa (conversation-stage-classifier)
 * @param {string}  params.message      Texto da mensagem a validar
 * @param {object}  [params.leadProfile={}]  Perfil atual do lead
 * @param {string}  [params.intent='']  Intenção detectada (para validar convite de reunião)
 * @returns {{ approved: boolean, problems: string[], fixedMessage?: string }}
 */
function validateSalesMessage({ stage, message, leadProfile = {}, intent = '' } = {}) {
  const text = String(message || '')
  const normalized = _norm(text)
  const limits = getLimits(stage)
  const problems = []

  // 1. Limite de caracteres
  const tooLong = text.length > limits.maxChars
  if (tooLong) {
    problems.push(`Mensagem muito longa (${text.length} > ${limits.maxChars} chars)`)
  }

  // 2. Perguntas demais
  const questionCount = countLooseQuestions(text)
  const tooManyQuestions = questionCount > limits.maxQuestions
  if (tooManyQuestions) {
    problems.push(`Muitas perguntas na mesma mensagem (${questionCount} > ${limits.maxQuestions})`)
  }

  // 3. Promessa indevida de resultado no Google
  if (_checkGooglePromise(normalized)) {
    problems.push('Promessa indevida de resultado no Google')
  }

  // 4. Linguagem agressiva ou pressão indevida
  if (_checkAggressive(normalized)) {
    problems.push('Linguagem agressiva ou pressão indevida')
  }

  // 5. Preço revelado cedo demais
  if (_checkPriceTooEarly(stage, normalized)) {
    problems.push('Preço mencionado cedo demais')
  }

  // 6. Perguntou sobre informação já fornecida pelo lead
  const ignoredFields = _checkIgnoredProfileInfo(normalized, leadProfile)
  if (ignoredFields.length > 0) {
    problems.push(`Perguntou sobre informação já fornecida: ${ignoredFields.join(', ')}`)
  }

  // 7. Textão desnecessário (> 300 chars sem quebras)
  if (_checkWallOfText(text, limits.maxChars)) {
    problems.push('Mensagem densa sem quebras de linha (textão)')
  }

  // 8. Convite para reunião no momento certo
  const meetingProblem = _checkMeetingOffer(text, normalized, leadProfile, intent)
  if (meetingProblem) {
    problems.push(meetingProblem)
  }

  const result = {
    approved: problems.length === 0,
    problems,
  }

  // Auto-fix apenas para problemas mecânicos (tamanho e perguntas)
  const fixedMessage = _autoFix(stage, text, tooLong, tooManyQuestions)
  if (fixedMessage !== null) {
    result.fixedMessage = fixedMessage
  }

  return result
}

module.exports = {
  validateSalesMessage,
  // Exporta helpers para testes
  _checkGooglePromise,
  _checkAggressive,
  _checkPriceTooEarly,
  _checkIgnoredProfileInfo,
  _checkWallOfText,
  _checkMeetingOffer,
}
