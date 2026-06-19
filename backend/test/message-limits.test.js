'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MESSAGE_LIMITS,
  ABSOLUTE_MAX_CHARS,
  getLimits,
  validateMessageLength,
  countQuestions,
  validateQuestionCount,
  validateBubbleCount,
  validateAll,
  validateBubbles,
  truncateToLimit,
  limiteBolhasPorEtapa,
  limitarBolhasPorEtapa,
} = require('../src/message-limits')

// ─── helpers ──────────────────────────────────────────────────────────────────

const str = (n, char = 'a') => char.repeat(n)

function assertValid(result) {
  assert.equal(result.valid, true, `Esperava válido, violations: ${JSON.stringify(result.violations || [])}`)
}

function assertInvalid(result) {
  assert.equal(result.valid, false, 'Esperava inválido')
}

// ─── Critério principal: nenhuma mensagem passa de 900 chars ─────────────────

test('ABSOLUTE_MAX_CHARS é 900', () => {
  assert.equal(ABSOLUTE_MAX_CHARS, 900)
})

test('o maior maxChars de todos os estágios é 900 (objection)', () => {
  const maxOfAll = Math.max(...Object.values(MESSAGE_LIMITS).map((l) => l.maxChars))
  assert.equal(maxOfAll, 900)
})

test('nenhum estágio tem maxChars acima de 900', () => {
  for (const [stage, limits] of Object.entries(MESSAGE_LIMITS)) {
    assert.ok(
      limits.maxChars <= 900,
      `Estágio "${stage}" tem maxChars=${limits.maxChars} > 900`
    )
  }
})

// ─── getLimits ────────────────────────────────────────────────────────────────

test('getLimits retorna limites corretos para new_lead', () => {
  const limits = getLimits('new_lead')
  assert.equal(limits.minChars, 180)
  assert.equal(limits.maxChars, 350)
  assert.equal(limits.maxQuestions, 1)
  assert.equal(limits.maxMessages, 1)
})

test('getLimits retorna fallback para estágio desconhecido', () => {
  const limits = getLimits('estagio_inexistente')
  assert.ok(limits.maxChars > 0, 'fallback deve ter maxChars')
  assert.ok(limits.maxChars <= 900, 'fallback não pode passar de 900')
})

// ─── validateMessageLength por estágio ───────────────────────────────────────

test('new_lead: mensagem de 250 chars é válida', () => {
  assertValid(validateMessageLength('new_lead', str(250)))
})

test('new_lead: mensagem de 100 chars é inválida (abaixo de 180)', () => {
  const result = validateMessageLength('new_lead', str(100))
  assertInvalid(result)
  assert.equal(result.tooShort, true)
})

test('new_lead: mensagem de 400 chars é inválida (acima de 350)', () => {
  const result = validateMessageLength('new_lead', str(400))
  assertInvalid(result)
  assert.equal(result.tooLong, true)
})

test('qualification: mensagem de 200 chars é válida', () => {
  assertValid(validateMessageLength('qualification', str(200)))
})

test('qualification: mensagem de 301 chars é inválida', () => {
  assertInvalid(validateMessageLength('qualification', str(301)))
})

test('diagnosis: mensagem de 300 chars é válida', () => {
  assertValid(validateMessageLength('diagnosis', str(300)))
})

test('solution_explanation: mensagem de 500 chars é válida', () => {
  assertValid(validateMessageLength('solution_explanation', str(500)))
})

test('solution_explanation: mensagem de 200 chars é inválida (abaixo de 350)', () => {
  const result = validateMessageLength('solution_explanation', str(200))
  assertInvalid(result)
  assert.equal(result.tooShort, true)
})

test('price_question: mensagem de 600 chars é válida', () => {
  assertValid(validateMessageLength('price_question', str(600)))
})

test('price_question: mensagem de 801 chars é inválida', () => {
  assertInvalid(validateMessageLength('price_question', str(801)))
})

test('objection: mensagem de 700 chars é válida', () => {
  assertValid(validateMessageLength('objection', str(700)))
})

test('objection: mensagem de 900 chars é válida (limite exato)', () => {
  assertValid(validateMessageLength('objection', str(900)))
})

test('objection: mensagem de 901 chars é inválida', () => {
  const result = validateMessageLength('objection', str(901))
  assertInvalid(result)
  assert.equal(result.tooLong, true)
})

test('meeting_offer: mensagem de 350 chars é válida', () => {
  assertValid(validateMessageLength('meeting_offer', str(350)))
})

test('follow_up: mensagem de 200 chars é válida', () => {
  assertValid(validateMessageLength('follow_up', str(200)))
})

test('follow_up: mensagem de 301 chars é inválida', () => {
  assertInvalid(validateMessageLength('follow_up', str(301)))
})

// ─── resultado tem campos corretos ───────────────────────────────────────────

test('validateMessageLength retorna todos os campos esperados', () => {
  const result = validateMessageLength('qualification', str(200))
  assert.ok('valid' in result)
  assert.ok('tooShort' in result)
  assert.ok('tooLong' in result)
  assert.ok('length' in result)
  assert.ok('minAllowed' in result)
  assert.ok('maxAllowed' in result)
  assert.equal(result.length, 200)
  assert.equal(result.maxAllowed, 300)
})

// ─── countQuestions ───────────────────────────────────────────────────────────

test('countQuestions: 0 perguntas', () => {
  assert.equal(countQuestions('Olá, tudo bem'), 0)
})

test('countQuestions: 1 pergunta', () => {
  assert.equal(countQuestions('Qual é o seu negócio?'), 1)
})

test('countQuestions: 2 perguntas', () => {
  assert.equal(countQuestions('Qual o negócio? E a cidade?'), 2)
})

test('countQuestions: "???" conta como 1 pergunta', () => {
  assert.equal(countQuestions('Oi??? Como vai?'), 2)
})

test('countQuestions: vazio retorna 0', () => {
  assert.equal(countQuestions(''), 0)
  assert.equal(countQuestions(null), 0)
})

// ─── validateQuestionCount ────────────────────────────────────────────────────

test('1 pergunta é válida em new_lead (maxQuestions=1)', () => {
  assertValid(validateQuestionCount('new_lead', 'Qual o seu negócio?'))
})

test('2 perguntas é inválido em qualquer estágio (maxQuestions=1)', () => {
  const result = validateQuestionCount('qualification', 'Qual o negócio? E a cidade?')
  assertInvalid(result)
  assert.equal(result.count, 2)
  assert.equal(result.maxAllowed, 1)
})

test('0 perguntas é válido em meeting_scheduled (maxQuestions=0 → confirmar sem perguntar)', () => {
  assertValid(validateQuestionCount('meeting_scheduled', 'Confirmado para amanhã às 19h.'))
})

test('1 pergunta é inválido em meeting_scheduled (maxQuestions=0)', () => {
  assertInvalid(validateQuestionCount('meeting_scheduled', 'Confirmado! Qual seu email?'))
})

// ─── validateBubbleCount ──────────────────────────────────────────────────────

test('1 bubble é válido em new_lead (maxMessages=1)', () => {
  assertValid(validateBubbleCount('new_lead', ['mensagem única']))
})

test('2 bubbles é inválido em new_lead (maxMessages=1)', () => {
  assertInvalid(validateBubbleCount('new_lead', ['msg1', 'msg2']))
})

test('2 bubbles é válido em price_question (maxMessages=2)', () => {
  assertValid(validateBubbleCount('price_question', ['parte 1', 'parte 2']))
})

test('3 bubbles é inválido em price_question (maxMessages=2)', () => {
  assertInvalid(validateBubbleCount('price_question', ['a', 'b', 'c']))
})

// ─── validateAll ─────────────────────────────────────────────────────────────

test('validateAll: mensagem válida não tem violations', () => {
  const result = validateAll('qualification', str(200))
  assert.equal(result.valid, true)
  assert.deepEqual(result.violations, [])
})

test('validateAll: mensagem muito longa tem violation', () => {
  const result = validateAll('qualification', str(500))
  assert.equal(result.valid, false)
  assert.ok(result.violations.length > 0)
  assert.ok(result.violations.some((v) => v.includes('muito longa')))
})

test('validateAll: mensagem muito curta tem violation', () => {
  const result = validateAll('objection', str(100))
  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.includes('muito curta')))
})

test('validateAll: muitas perguntas tem violation', () => {
  const msg = str(200) + ' Qual o negócio? E a cidade?'
  const result = validateAll('qualification', msg)
  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.includes('perguntas demais')))
})

// ─── validateBubbles ─────────────────────────────────────────────────────────

test('validateBubbles: 2 bubbles válidas em price_question', () => {
  const bubbles = [str(500), str(200)]
  const result = validateBubbles('price_question', bubbles)
  assert.equal(result.valid, true)
  assert.deepEqual(result.violations, [])
})

test('validateBubbles: 3 bubbles é inválido em price_question', () => {
  const bubbles = [str(200), str(200), str(200)]
  const result = validateBubbles('price_question', bubbles)
  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.includes('bubbles')))
})

test('validateBubbles: bubble muito longa gera violation individual', () => {
  const result = validateBubbles('objection', [str(1000)])
  assert.equal(result.valid, false)
  assert.ok(result.violations.some((v) => v.includes('bubble 1')))
})

// ─── truncateToLimit ─────────────────────────────────────────────────────────

test('truncateToLimit: não altera mensagem dentro do limite', () => {
  const msg = str(200)
  assert.equal(truncateToLimit('qualification', msg), msg)
})

test('truncateToLimit: corta mensagem acima do limite', () => {
  const msg = str(500)
  const truncated = truncateToLimit('qualification', msg)
  assert.ok(truncated.length <= 300)
  assert.ok(truncated.endsWith('…'))
})

test('truncateToLimit: resultado nunca passa do maxChars', () => {
  for (const [stage, limits] of Object.entries(MESSAGE_LIMITS)) {
    const longMsg = str(limits.maxChars + 200)
    const result = truncateToLimit(stage, longMsg)
    assert.ok(
      result.length <= limits.maxChars,
      `truncate em "${stage}" resultou em ${result.length}, max era ${limits.maxChars}`
    )
  }
})

test('truncateToLimit: resultado nunca passa de 900 para nenhum estágio', () => {
  const GLOBAL_MAX = 900
  for (const stage of Object.keys(MESSAGE_LIMITS)) {
    const longMsg = str(1200)
    const result = truncateToLimit(stage, longMsg)
    assert.ok(
      result.length <= GLOBAL_MAX,
      `truncate em "${stage}" resultou em ${result.length} > 900`
    )
  }
})

// ─── Todos os estágios do classificador têm limites definidos ─────────────────

test('todos os estágios do conversation-stage-classifier têm limites', () => {
  const { VALID_STAGES } = require('../src/conversation-stage-classifier')
  for (const stage of VALID_STAGES) {
    const limits = getLimits(stage)
    assert.ok(limits.maxChars > 0, `Stage "${stage}" não tem maxChars`)
    assert.ok(limits.maxChars <= 900, `Stage "${stage}" passa de 900: ${limits.maxChars}`)
  }
})
