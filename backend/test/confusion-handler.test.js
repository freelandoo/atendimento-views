'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  confusionKeywords,
  detectConfusionByKeywords,
  shouldClarifyFirst,
  buildClarificationResponse,
  handleConfusion,
  CLARIFICATION_TEXTS,
} = require('../src/confusion-handler')
const { CONFUSION_TYPES } = require('../src/intent-detector')

// ─── detectConfusionByKeywords ────────────────────────────────────────────────

test('detecta keyword exata: anúncio', () => {
  const result = detectConfusionByKeywords('Quanto custa um anúncio?')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('anúncio'))
})

test('detecta keyword sem acento: anuncio', () => {
  const result = detectConfusionByKeywords('quero um anuncio no google')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.some((k) => k === 'anuncio' || k === 'anúncio'))
})

test('detecta keyword: ads', () => {
  const result = detectConfusionByKeywords('preciso de google ads')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('ads'))
})

test('detecta keyword: google', () => {
  const result = detectConfusionByKeywords('quero aparecer no Google')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('google'))
})

test('detecta keyword: aparecer', () => {
  const result = detectConfusionByKeywords('como faço pra aparecer?')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('aparecer'))
})

test('detecta keyword: pesquisar', () => {
  const result = detectConfusionByKeywords('quero aparecer quando o cliente pesquisar')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('pesquisar'))
})

test('detecta keyword: divulgação', () => {
  const result = detectConfusionByKeywords('Preciso de divulgação pra minha empresa')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('divulgação'))
})

test('detecta keyword sem acento: divulgacao', () => {
  const result = detectConfusionByKeywords('quero divulgacao')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.some((k) => k === 'divulgacao' || k === 'divulgação'))
})

test('detecta keyword: impulsionar', () => {
  const result = detectConfusionByKeywords('quero impulsionar meu post')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.includes('impulsionar'))
})

test('não detecta quando não há keyword de confusão', () => {
  const result = detectConfusionByKeywords('quanto custa o site?')
  assert.equal(result.isConfused, false)
  assert.equal(result.matchedKeywords.length, 0)
})

test('não detecta em mensagem vazia', () => {
  const result = detectConfusionByKeywords('')
  assert.equal(result.isConfused, false)
})

test('não detecta em null/undefined', () => {
  assert.equal(detectConfusionByKeywords(null).isConfused, false)
  assert.equal(detectConfusionByKeywords(undefined).isConfused, false)
})

test('detecta múltiplas keywords na mesma mensagem', () => {
  const result = detectConfusionByKeywords('quero anúncio e aparecer no google')
  assert.equal(result.isConfused, true)
  assert.ok(result.matchedKeywords.length >= 3)
})

test('detecção é case-insensitive', () => {
  const result = detectConfusionByKeywords('GOOGLE ADS')
  assert.equal(result.isConfused, true)
})

test('confusionKeywords exportado tem 9 itens', () => {
  assert.equal(confusionKeywords.length, 9)
})

// ─── shouldClarifyFirst ───────────────────────────────────────────────────────

test('retorna false se intentResult é null/undefined', () => {
  assert.equal(shouldClarifyFirst(null), false)
  assert.equal(shouldClarifyFirst(undefined), false)
})

test('retorna true se confusionDetected=true (prioridade 1)', () => {
  const intentResult = { intent: 'greeting', confusionDetected: true, confusionType: CONFUSION_TYPES.SITE_AD_GOOGLE }
  assert.equal(shouldClarifyFirst(intentResult), true)
})

test('retorna true: keyword + asking_price', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'Quanto custa um anúncio desse?'), true)
})

test('retorna true: keyword + interested', () => {
  const intentResult = { intent: 'interested', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'tenho interesse no ads'), true)
})

test('retorna true: keyword + asking_google', () => {
  const intentResult = { intent: 'asking_google', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'como apareço no google?'), true)
})

test('retorna true: keyword + unclear', () => {
  const intentResult = { intent: 'unclear', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'quero divulgação'), true)
})

test('retorna false: keyword + intent não-prioritário (greeting)', () => {
  const intentResult = { intent: 'greeting', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'Oi, vi um anúncio de vocês'), false)
})

test('retorna false: keyword + intent não-prioritário (not_interested)', () => {
  const intentResult = { intent: 'not_interested', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'não quero anúncio'), false)
})

test('retorna false: sem keyword + asking_price', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  assert.equal(shouldClarifyFirst(intentResult, 'quanto custa o site?'), false)
})

// ─── buildClarificationResponse ──────────────────────────────────────────────

test('SITE_AD_GOOGLE: contém explicação e pergunta de diagnóstico', () => {
  const text = buildClarificationResponse(CONFUSION_TYPES.SITE_AD_GOOGLE)
  assert.ok(text.includes('não é apenas um anúncio'))
  assert.ok(text.includes('Instagram/WhatsApp'))
})

test('ORGANIC_PAID: explica diferença entre orgânico e pago', () => {
  const text = buildClarificationResponse(CONFUSION_TYPES.ORGANIC_PAID)
  assert.ok(text.includes('orgân'))
  assert.ok(text.includes('anúncio'))
})

test('SITE_APP: explica que não é aplicativo para baixar', () => {
  const text = buildClarificationResponse(CONFUSION_TYPES.SITE_APP)
  assert.ok(text.includes('aplicativo'))
  assert.ok(text.includes('baixar'))
})

test('AI_CHATBOT: explica diferença entre agente de IA e chatbot simples', () => {
  const text = buildClarificationResponse(CONFUSION_TYPES.AI_CHATBOT)
  assert.ok(text.includes('chatbot'))
})

test('tipo desconhecido retorna texto genérico', () => {
  const text = buildClarificationResponse('tipo_inventado')
  assert.ok(text.includes('PJ Codeworks'))
})

test('null retorna texto genérico', () => {
  const text = buildClarificationResponse(null)
  assert.ok(typeof text === 'string' && text.length > 0)
})

test('CLARIFICATION_TEXTS exportado tem 4 entradas', () => {
  assert.equal(Object.keys(CLARIFICATION_TEXTS).length, 4)
  assert.ok(CONFUSION_TYPES.SITE_AD_GOOGLE in CLARIFICATION_TEXTS)
  assert.ok(CONFUSION_TYPES.ORGANIC_PAID in CLARIFICATION_TEXTS)
  assert.ok(CONFUSION_TYPES.SITE_APP in CLARIFICATION_TEXTS)
  assert.ok(CONFUSION_TYPES.AI_CHATBOT in CLARIFICATION_TEXTS)
})

// ─── handleConfusion ──────────────────────────────────────────────────────────

test('caso do spec: "Quanto custa um anúncio desse?" → shouldClarify=true', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  const result = handleConfusion('Quanto custa um anúncio desse?', intentResult)
  assert.equal(result.shouldClarify, true)
  assert.ok(result.clarificationText !== null)
  assert.ok(result.clarificationText.includes('não é apenas um anúncio'))
})

test('mensagem sem confusão: shouldClarify=false, clarificationText=null', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  const result = handleConfusion('quanto custa o site?', intentResult)
  assert.equal(result.shouldClarify, false)
  assert.equal(result.clarificationText, null)
})

test('retorna confusionType do intent-detector quando disponível', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: true, confusionType: CONFUSION_TYPES.SITE_APP }
  const result = handleConfusion('quero baixar o app', intentResult)
  assert.equal(result.confusionType, CONFUSION_TYPES.SITE_APP)
})

test('fallback confusionType para SITE_AD_GOOGLE quando apenas keyword match', () => {
  const intentResult = { intent: 'interested', confusionDetected: false, confusionType: null }
  const result = handleConfusion('tenho interesse, vi nos ads', intentResult)
  assert.equal(result.confusionType, CONFUSION_TYPES.SITE_AD_GOOGLE)
})

test('matchedKeywords é populado quando há keywords', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  const result = handleConfusion('Quanto custa um anúncio desse?', intentResult)
  assert.ok(Array.isArray(result.matchedKeywords))
  assert.ok(result.matchedKeywords.length > 0)
})

test('matchedKeywords é array vazio quando não há keywords', () => {
  const intentResult = { intent: 'asking_price', confusionDetected: false, confusionType: null }
  const result = handleConfusion('quanto custa o site?', intentResult)
  assert.deepEqual(result.matchedKeywords, [])
})

test('resultado sempre tem os 4 campos esperados', () => {
  const intentResult = { intent: 'greeting', confusionDetected: false, confusionType: null }
  const result = handleConfusion('oi', intentResult)
  assert.ok('shouldClarify' in result)
  assert.ok('confusionType' in result)
  assert.ok('matchedKeywords' in result)
  assert.ok('clarificationText' in result)
})

test('confusionType é null quando não há confusão', () => {
  const intentResult = { intent: 'greeting', confusionDetected: false, confusionType: null }
  const result = handleConfusion('oi', intentResult)
  assert.equal(result.confusionType, null)
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: sempre explica antes de vender quando lead confunde anúncio, site e Google', () => {
  const casos = [
    { msg: 'Quanto custa um anúncio desse?', intent: 'asking_price' },
    { msg: 'Quero aparecer no Google, quanto fica?', intent: 'asking_price' },
    { msg: 'Vi o ads de vocês e tenho interesse', intent: 'interested' },
    { msg: 'Quanto custa impulsionar meu post?', intent: 'asking_price' },
    { msg: 'Quero divulgação da minha empresa', intent: 'unclear' },
  ]

  for (const { msg, intent } of casos) {
    const intentResult = { intent, confusionDetected: false, confusionType: null }
    const result = handleConfusion(msg, intentResult)
    assert.equal(result.shouldClarify, true, `deve clarificar para: "${msg}"`)
    assert.ok(result.clarificationText && result.clarificationText.length > 50, `texto de clarificação deve ser substantivo para: "${msg}"`)
  }
})

test('critério: não interrompe fluxo normal quando lead entende o produto', () => {
  const casos = [
    { msg: 'Quero um site para minha loja', intent: 'interested' },
    { msg: 'Quanto custa o site?', intent: 'asking_price' },
    { msg: 'Preciso de um sistema de agendamento', intent: 'asking_how_it_works' },
  ]

  for (const { msg, intent } of casos) {
    const intentResult = { intent, confusionDetected: false, confusionType: null }
    const result = handleConfusion(msg, intentResult)
    assert.equal(result.shouldClarify, false, `não deve clarificar para: "${msg}"`)
  }
})
