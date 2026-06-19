'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  validateSalesMessage,
  _checkGooglePromise,
  _checkAggressive,
  _checkPriceTooEarly,
  _checkIgnoredProfileInfo,
  _checkWallOfText,
  _checkMeetingOffer,
} = require('../src/message-validator')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _norm(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Mensagem curta e limpa para estágio de qualificação
const CLEAN_SHORT = 'Qual é o seu negócio?'

// Mensagem de diagnóstico limpa e completa (150-300 chars)
const CLEAN_MEDIUM = 'Entendido! Para te orientar melhor, você já tem algum site ou página hoje?\n\nIsso me ajuda a entender o melhor caminho para a sua empresa.'

// Perfil vazio
const emptyProfile = { businessType: null, city: null, hasWebsite: null, goal: null }

// Perfil preenchido
const fullProfile = {
  businessType: 'dentista',
  city: 'Santo André',
  hasWebsite: false,
  goal: 'atrair mais pacientes',
  mainService: 'site profissional',
  meetingInterest: null,
}

// ─── Resultado aprovado (golden path) ────────────────────────────────────────

test('mensagem limpa, estágio e perfil corretos → approved=true', () => {
  const result = validateSalesMessage({
    stage: 'qualification',
    message: CLEAN_SHORT,
    leadProfile: emptyProfile,
  })
  assert.equal(result.approved, true)
  assert.equal(result.problems.length, 0)
})

test('resultado sempre tem approved e problems', () => {
  const result = validateSalesMessage({ stage: 'new_lead', message: 'Oi', leadProfile: emptyProfile })
  assert.ok('approved' in result)
  assert.ok('problems' in result)
  assert.ok(Array.isArray(result.problems))
})

test('fixedMessage ausente quando não há problema mecânico', () => {
  const result = validateSalesMessage({
    stage: 'qualification',
    message: CLEAN_SHORT,
    leadProfile: emptyProfile,
  })
  assert.ok(!('fixedMessage' in result))
})

test('sem argumentos não quebra', () => {
  assert.doesNotThrow(() => validateSalesMessage())
  const result = validateSalesMessage()
  assert.equal(typeof result.approved, 'boolean')
})

// ─── Regra 1: limite de caracteres ───────────────────────────────────────────

test('mensagem dentro do limite → sem problema de tamanho', () => {
  const msg = 'a'.repeat(200)  // qualification maxChars = 300
  const result = validateSalesMessage({ stage: 'qualification', message: msg, leadProfile: emptyProfile })
  assert.ok(!result.problems.some((p) => p.includes('longa')))
})

test('mensagem acima do limite → problema de tamanho', () => {
  const msg = 'a'.repeat(400)  // qualification maxChars = 300
  const result = validateSalesMessage({ stage: 'qualification', message: msg, leadProfile: emptyProfile })
  assert.ok(result.problems.some((p) => p.toLowerCase().includes('longa')))
  assert.equal(result.approved, false)
})

test('mensagem longa tem fixedMessage automático', () => {
  const msg = 'palavra '.repeat(60)  // > 300 chars
  const result = validateSalesMessage({ stage: 'qualification', message: msg, leadProfile: emptyProfile })
  assert.ok('fixedMessage' in result)
  assert.ok(result.fixedMessage.length <= 300 + 5)  // +5 para o "…"
})

test('fixedMessage termina com "…" quando truncado', () => {
  const msg = 'a '.repeat(200)
  const result = validateSalesMessage({ stage: 'qualification', message: msg, leadProfile: emptyProfile })
  if ('fixedMessage' in result) {
    assert.ok(result.fixedMessage.endsWith('…'))
  }
})

// ─── Regra 2: perguntas demais ────────────────────────────────────────────────

test('uma pergunta → sem problema', () => {
  const result = validateSalesMessage({
    stage: 'qualification',
    message: 'Qual é o seu negócio?',
    leadProfile: emptyProfile,
  })
  assert.ok(!result.problems.some((p) => p.includes('pergunta')))
})

test('duas perguntas → problema', () => {
  const result = validateSalesMessage({
    stage: 'qualification',
    message: 'Qual é o seu negócio? E você tem site?',
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.some((p) => p.includes('pergunta')))
  assert.equal(result.approved, false)
})

test('mensagem com 2 perguntas tem fixedMessage com 1 pergunta', () => {
  const result = validateSalesMessage({
    stage: 'qualification',
    message: 'Qual é o seu negócio? E você tem site?',
    leadProfile: emptyProfile,
  })
  assert.ok('fixedMessage' in result)
  // fixedMessage deve ter apenas 1 "?"
  const count = (result.fixedMessage.match(/\?/g) || []).length
  assert.equal(count, 1)
})

test('três perguntas → problema', () => {
  const result = validateSalesMessage({
    stage: 'diagnosis',
    message: 'Qual o negócio? Tem site? Usa Instagram?',
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.some((p) => p.includes('pergunta')))
})

// ─── Regra 3: promessa indevida de Google ─────────────────────────────────────

test('_checkGooglePromise: "garantimos aparecer no Google"', () => {
  assert.equal(_checkGooglePromise(_norm('garantimos aparecer no Google')), true)
})

test('_checkGooglePromise: "topo do Google"', () => {
  assert.equal(_checkGooglePromise(_norm('você vai aparecer no topo do Google')), true)
})

test('_checkGooglePromise: "primeira página do Google"', () => {
  assert.equal(_checkGooglePromise(_norm('aparece na primeira página do Google')), true)
})

test('_checkGooglePromise: texto legítimo sobre Google não dispara', () => {
  assert.equal(_checkGooglePromise(_norm('isso pode ajudar sua presença no Google com o tempo')), false)
})

test('validateSalesMessage: "garantimos aparecer no Google" → reprovado', () => {
  const result = validateSalesMessage({
    stage: 'solution_explanation',
    message: 'Com nosso serviço garantimos aparecer no Google imediatamente!\n\nQual o seu negócio?',
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.some((p) => p.includes('Google')))
  assert.equal(result.approved, false)
})

// ─── Regra 4: linguagem agressiva ────────────────────────────────────────────

test('_checkAggressive: "última chance"', () => {
  assert.equal(_checkAggressive(_norm('Essa é sua última chance!')), true)
})

test('_checkAggressive: "só hoje"', () => {
  assert.equal(_checkAggressive(_norm('Promoção só hoje!')), true)
})

test('_checkAggressive: "vagas limitadas"', () => {
  assert.equal(_checkAggressive(_norm('Temos vagas limitadas para esse mês.')), true)
})

test('_checkAggressive: "decidir agora"', () => {
  assert.equal(_checkAggressive(_norm('Você precisa decidir agora.')), true)
})

test('_checkAggressive: texto normal não dispara', () => {
  assert.equal(_checkAggressive(_norm('Qual horário fica melhor para você?')), false)
})

test('validateSalesMessage: "última chance" → reprovado', () => {
  const result = validateSalesMessage({
    stage: 'objection',
    message: 'Essa é sua última chance de garantir o preço!\n\nQuer fechar?',
    leadProfile: fullProfile,
  })
  assert.ok(result.problems.some((p) => p.toLowerCase().includes('agressiv')))
  assert.equal(result.approved, false)
})

// ─── Regra 5: preço cedo demais ───────────────────────────────────────────────

test('_checkPriceTooEarly: R$ em new_lead → detecta', () => {
  assert.equal(_checkPriceTooEarly('new_lead', _norm('o investimento é R$ 500 por mês')), true)
})

test('_checkPriceTooEarly: "mensalidade" com valor em new_lead → detecta', () => {
  assert.equal(_checkPriceTooEarly('new_lead', _norm('mensalidade é 300 reais')), true)
})

test('_checkPriceTooEarly: preço em qualification → não detecta (só new_lead)', () => {
  assert.equal(_checkPriceTooEarly('qualification', _norm('custa R$ 500 por mês')), false)
})

test('_checkPriceTooEarly: preço em price_question → não detecta', () => {
  assert.equal(_checkPriceTooEarly('price_question', _norm('custa R$ 500 por mês')), false)
})

test('validateSalesMessage: preço em new_lead → reprovado', () => {
  const result = validateSalesMessage({
    stage: 'new_lead',
    message: 'Olá! Nossos planos começam em R$ 500 por mês.\n\nQual o seu negócio?',
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.some((p) => p.includes('Preço')))
  assert.equal(result.approved, false)
})

// ─── Regra 6: ignorou informação já fornecida ─────────────────────────────────

test('_checkIgnoredProfileInfo: pergunta businessType quando já tem', () => {
  const ignored = _checkIgnoredProfileInfo(
    _norm('Qual é o seu negócio?'),
    { businessType: 'dentista' }
  )
  assert.ok(ignored.includes('businessType'))
})

test('_checkIgnoredProfileInfo: pergunta city quando já tem', () => {
  const ignored = _checkIgnoredProfileInfo(
    _norm('Em qual cidade você atende?'),
    { city: 'SP' }
  )
  assert.ok(ignored.includes('city'))
})

test('_checkIgnoredProfileInfo: pergunta hasWebsite quando já tem', () => {
  const ignored = _checkIgnoredProfileInfo(
    _norm('Você já tem site?'),
    { hasWebsite: false }
  )
  assert.ok(ignored.includes('hasWebsite'))
})

test('_checkIgnoredProfileInfo: campo null → não conta como ignorado', () => {
  const ignored = _checkIgnoredProfileInfo(
    _norm('Qual é o seu negócio?'),
    { businessType: null }
  )
  assert.equal(ignored.length, 0)
})

test('_checkIgnoredProfileInfo: pergunta sobre campo não conhecido → ok', () => {
  const ignored = _checkIgnoredProfileInfo(
    _norm('Qual é o seu negócio?'),
    emptyProfile
  )
  assert.equal(ignored.length, 0)
})

test('validateSalesMessage: perguntou negócio que lead já informou → reprovado', () => {
  const result = validateSalesMessage({
    stage: 'diagnosis',
    message: 'Qual é o seu negócio?\n\nVocê já tem site hoje?',
    leadProfile: { ...emptyProfile, businessType: 'dentista' },
  })
  assert.ok(result.problems.some((p) => p.includes('fornecida')))
  assert.equal(result.approved, false)
})

// ─── Regra 7: textão sem quebras ─────────────────────────────────────────────

test('_checkWallOfText: mensagem > 300 chars sem quebra → textão', () => {
  const msg = 'a'.repeat(350)
  assert.equal(_checkWallOfText(msg), true)
})

test('_checkWallOfText: mensagem > 300 chars COM quebra → não é textão', () => {
  const msg = 'a'.repeat(200) + '\n' + 'b'.repeat(200)
  assert.equal(_checkWallOfText(msg), false)
})

test('_checkWallOfText: mensagem <= 300 chars sem quebra → ok', () => {
  assert.equal(_checkWallOfText('a'.repeat(299)), false)
})

test('validateSalesMessage: parágrafo único > 300 chars → reprovado', () => {
  // Constrói um bloco de 350 chars sem quebra de linha
  const msg = 'palavra '.repeat(44).trimEnd()  // ~350 chars sem \n
  assert.ok(msg.length > 300)
  assert.ok(!msg.includes('\n'))
  const result = validateSalesMessage({
    stage: 'qualification',
    message: msg,
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.some((p) => p.toLowerCase().includes('textão') || p.toLowerCase().includes('densa')))
})

test('validateSalesMessage: mesma mensagem com quebras → aprovada (sem textão)', () => {
  const block = 'Aqui é da PJ Codeworks. Criamos sites profissionais para sua empresa aparecer melhor e direcionar clientes ao WhatsApp.'
  const msg = block + '\n\n' + 'Qual é o seu negócio?'
  const result = validateSalesMessage({
    stage: 'qualification',
    message: msg,
    leadProfile: emptyProfile,
  })
  assert.ok(!result.problems.some((p) => p.toLowerCase().includes('textão') || p.toLowerCase().includes('densa')))
})

// ─── Regra 8: convite para reunião no momento certo ──────────────────────────

test('convite em mensagem com lead não qualificado → problema', () => {
  const result = validateSalesMessage({
    stage: 'new_lead',
    message: 'A reunião é rápida, coisa de 15 minutos. Qual horário fica melhor?',
    leadProfile: emptyProfile,
    intent: 'greeting',
  })
  assert.ok(result.problems.some((p) => p.toLowerCase().includes('reunião')))
  assert.equal(result.approved, false)
})

test('convite em mensagem com lead qualificado → aprovado (regra 8 ok)', () => {
  const result = validateSalesMessage({
    stage: 'meeting_offer',
    message: 'A reunião é rápida, coisa de 15 minutos. Qual horário fica melhor?\n\nConsigo entre 19h30 e 21h30.',
    leadProfile: fullProfile,
    intent: 'interested',
  })
  assert.ok(!result.problems.some((p) => p.toLowerCase().includes('reunião')))
})

test('mensagem sem convite com lead qualificado → aprovado (sem obrigação de mencionar)', () => {
  const result = validateSalesMessage({
    stage: 'diagnosis',
    message: CLEAN_MEDIUM,
    leadProfile: fullProfile,
    intent: 'interested',
  })
  assert.ok(!result.problems.some((p) => p.toLowerCase().includes('reunião')))
})

test('_checkMeetingOffer: sem linguagem de reunião → null', () => {
  const msg = 'Qual é o seu negócio?'
  assert.equal(_checkMeetingOffer(msg, _norm(msg), emptyProfile, 'greeting'), null)
})

// ─── Múltiplos problemas simultaneamente ─────────────────────────────────────

test('mensagem com 3 problemas → 3 entradas em problems', () => {
  const longMsg = 'garantimos aparecer no Google! ' +
    'Última chance de contratar! ' +
    'Qual seu negócio? Tem site? Usa Instagram? '.repeat(5)

  const result = validateSalesMessage({
    stage: 'new_lead',
    message: longMsg,
    leadProfile: emptyProfile,
  })
  assert.ok(result.problems.length >= 3)
  assert.equal(result.approved, false)
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: nenhuma mensagem enviada sem validação — casos comuns', () => {
  const casos = [
    // Mensagem limpa → aprovada
    {
      input: { stage: 'qualification', message: 'Qual é o seu negócio?', leadProfile: emptyProfile },
      shouldApprove: true,
    },
    // Google promise → reprovada
    {
      input: {
        stage: 'solution_explanation',
        message: 'Garantimos aparecer no Google!\n\nQuer saber mais?',
        leadProfile: emptyProfile,
      },
      shouldApprove: false,
    },
    // Preço em new_lead → reprovada
    {
      input: {
        stage: 'new_lead',
        message: 'Nosso plano custa R$ 500 por mês.\n\nQual seu negócio?',
        leadProfile: emptyProfile,
      },
      shouldApprove: false,
    },
    // Duas perguntas → reprovada mas tem fixedMessage
    {
      input: {
        stage: 'qualification',
        message: 'Qual é o negócio? E você tem site?',
        leadProfile: emptyProfile,
      },
      shouldApprove: false,
      hasFixedMessage: true,
    },
  ]

  for (const { input, shouldApprove, hasFixedMessage } of casos) {
    const result = validateSalesMessage(input)
    assert.equal(
      result.approved,
      shouldApprove,
      `approved errado para: "${input.message.slice(0, 50)}..."`
    )
    if (hasFixedMessage) {
      assert.ok('fixedMessage' in result, 'deve ter fixedMessage')
    }
  }
})

test('critério: fixedMessage é sempre menor ou igual em perguntas que o original', () => {
  const duasPerguntas = 'Qual é o seu negócio? E você tem site?'
  const result = validateSalesMessage({
    stage: 'qualification',
    message: duasPerguntas,
    leadProfile: emptyProfile,
  })
  if ('fixedMessage' in result) {
    const originalCount = (duasPerguntas.match(/\?/g) || []).length
    const fixedCount = (result.fixedMessage.match(/\?/g) || []).length
    assert.ok(fixedCount <= originalCount, 'fixedMessage não deve ter mais perguntas')
  }
})
