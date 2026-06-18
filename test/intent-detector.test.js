'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { detectIntent, VALID_INTENTS, CONFUSION_TYPES } = require('../src/intent-detector')

// ─── helper ───────────────────────────────────────────────────────────────────

function assertIntent(texto, expectedIntent) {
  const result = detectIntent(texto)
  assert.ok(
    VALID_INTENTS.includes(result.intent),
    `Intent "${result.intent}" não está na lista de intenções válidas`
  )
  assert.equal(
    result.intent,
    expectedIntent,
    `"${texto}" → esperado "${expectedIntent}", recebido "${result.intent}"`
  )
  return result
}

function assertConfusion(texto, expectedType) {
  const result = detectIntent(texto)
  assert.ok(result.confusionDetected, `Esperava confusão em: "${texto}"`)
  assert.equal(result.confusionType, expectedType)
  return result
}

function assertNoConfusion(texto) {
  const result = detectIntent(texto)
  assert.equal(result.confusionDetected, false, `Não esperava confusão em: "${texto}"`)
  return result
}

// ─── Critério 1: Preço ────────────────────────────────────────────────────────

test('asking_price: "quanto custa um site?"', () => {
  assertIntent('quanto custa um site?', 'asking_price')
})

test('asking_price: "qual o valor?"', () => {
  assertIntent('qual o valor?', 'asking_price')
})

test('asking_price: "qual o investimento para um sistema?"', () => {
  assertIntent('qual o investimento para um sistema?', 'asking_price')
})

test('asking_price: "me passa a tabela de preço"', () => {
  assertIntent('me passa a tabela de preço', 'asking_price')
})

test('asking_price: "quanto fica?"', () => {
  assertIntent('quanto fica?', 'asking_price')
})

test('asking_price: "me fala o preço"', () => {
  assertIntent('me fala o preço', 'asking_price')
})

// ─── Critério 2: Interesse ────────────────────────────────────────────────────

test('interested: "tenho interesse"', () => {
  assertIntent('tenho interesse', 'interested')
})

test('interested: "quero saber mais, me interessa"', () => {
  assertIntent('me interessa, pode me ajudar?', 'interested')
})

test('interested: "to precisando de um site"', () => {
  assertIntent('to precisando de um site', 'interested')
})

test('interested: "quero contratar"', () => {
  assertIntent('quero contratar', 'interested')
})

// ─── Critério 3: Objeção ──────────────────────────────────────────────────────

test('objection_price: "tá caro"', () => {
  assertIntent('tá caro', 'objection_price')
})

test('objection_price: "muito caro pra mim"', () => {
  assertIntent('muito caro pra mim', 'objection_price')
})

test('objection_price: "não tenho budget agora"', () => {
  assertIntent('não tenho budget agora', 'objection_price')
})

test('objection_price: "sem verba no momento"', () => {
  assertIntent('sem verba no momento', 'objection_price')
})

test('objection_time: "vou pensar e te falo"', () => {
  assertIntent('vou pensar e te falo', 'objection_time')
})

test('objection_time: "agora não, mais pra frente"', () => {
  assertIntent('agora não, mais pra frente', 'objection_time')
})

test('objection_time: "numa próxima"', () => {
  assertIntent('numa próxima', 'objection_time')
})

test('objection_trust: "não conheço vocês"', () => {
  assertIntent('não conheço vocês', 'objection_trust')
})

test('objection_trust: "têm portfólio para ver?"', () => {
  assertIntent('têm portfólio para ver?', 'objection_trust')
})

test('objection_trust: "como sei que vocês entregam?"', () => {
  assertIntent('como sei que vocês entregam?', 'objection_trust')
})

// ─── Critério 4: Dúvida sobre Google ─────────────────────────────────────────

test('asking_google: "aparece no Google?"', () => {
  assertIntent('aparece no Google?', 'asking_google')
})

test('asking_google: "ajuda a ranquear no Google?"', () => {
  assertIntent('ajuda a ranquear no Google?', 'asking_google')
})

test('asking_google: "vocês fazem SEO?"', () => {
  assertIntent('vocês fazem SEO?', 'asking_google')
})

test('asking_google: "me ajuda a aparecer na primeira página do Google"', () => {
  assertIntent('me ajuda a aparecer na primeira página do Google', 'asking_google')
})

test('asking_google: "Google Meu Negócio"', () => {
  assertIntent('apareço no Google Meu Negócio?', 'asking_google')
})

// ─── Critério 5: Dúvida sobre funcionamento ───────────────────────────────────

test('asking_how_it_works: "como funciona?"', () => {
  assertIntent('como funciona?', 'asking_how_it_works')
})

test('asking_how_it_works: "o que vocês fazem exatamente?"', () => {
  assertIntent('o que vocês fazem exatamente?', 'asking_how_it_works')
})

test('asking_how_it_works: "me explica como é o processo"', () => {
  assertIntent('me explica como é o processo', 'asking_how_it_works')
})

test('asking_how_it_works: "como vocês trabalham?"', () => {
  assertIntent('como vocês trabalham?', 'asking_how_it_works')
})

// ─── Critério 6: Pedido de reunião ────────────────────────────────────────────

test('wants_meeting: "quero marcar uma reunião"', () => {
  assertIntent('quero marcar uma reunião', 'wants_meeting')
})

test('wants_meeting: "quando posso falar com vocês?"', () => {
  assertIntent('quando posso falar com vocês?', 'wants_meeting')
})

test('wants_meeting: "tem algum horário disponível?"', () => {
  assertIntent('tem algum horário disponível?', 'wants_meeting')
})

// ─── Critério 7: Lead frio / não interessado ──────────────────────────────────

test('not_interested: "não tenho interesse"', () => {
  assertIntent('não tenho interesse', 'not_interested')
})

test('not_interested: "obrigado mas não"', () => {
  assertIntent('obrigado mas não', 'not_interested')
})

test('not_interested: "vlw mas não preciso"', () => {
  assertIntent('vlw mas não preciso', 'not_interested')
})

// ─── Critério 8: Lead confuso ─────────────────────────────────────────────────

test('confusão site/anúncio: "Quanto custa um anúncio desse?"', () => {
  const result = assertIntent('Quanto custa um anúncio desse?', 'asking_price')
  assert.ok(result.confusionDetected)
  assert.equal(result.confusionType, CONFUSION_TYPES.SITE_AD_GOOGLE)
})

test('confusão site/anúncio: "vocês fazem tráfego pago?"', () => {
  assertConfusion('vocês fazem tráfego pago?', CONFUSION_TYPES.SITE_AD_GOOGLE)
})

test('confusão site/anúncio: "quero fazer Google Ads"', () => {
  assertConfusion('quero fazer Google Ads', CONFUSION_TYPES.SITE_AD_GOOGLE)
})

test('confusão site/app: "vocês fazem app para baixar?"', () => {
  assertConfusion('vocês fazem app para baixar?', CONFUSION_TYPES.SITE_APP)
})

test('confusão site/app: "quero app na Play Store"', () => {
  assertConfusion('quero app na Play Store', CONFUSION_TYPES.SITE_APP)
})

test('confusão IA/chatbot: "quero um chatbot para WhatsApp"', () => {
  assertConfusion('quero um chatbot para WhatsApp', CONFUSION_TYPES.AI_CHATBOT)
})

test('confusão orgânico/pago: "quero aparecer no Google de forma orgânica mas paga"', () => {
  assertConfusion(
    'quero aparecer no Google de forma orgânica mas pago',
    CONFUSION_TYPES.ORGANIC_PAID
  )
})

test('sem confusão: "quero um site profissional"', () => {
  assertNoConfusion('quero um site profissional')
})

test('sem confusão: "quanto custa um sistema de agendamento?"', () => {
  assertNoConfusion('quanto custa um sistema de agendamento?')
})

// ─── Cumprimento / greeting ───────────────────────────────────────────────────

test('greeting: "oi"', () => {
  assertIntent('oi', 'greeting')
})

test('greeting: "bom dia"', () => {
  assertIntent('bom dia', 'greeting')
})

test('greeting: "boa tarde!"', () => {
  assertIntent('boa tarde!', 'greeting')
})

// ─── Informação do negócio ────────────────────────────────────────────────────

test('sent_business_info: "sou dentista em São Paulo"', () => {
  assertIntent('sou dentista em São Paulo', 'sent_business_info')
})

test('sent_business_info: "minha loja fica em Santos"', () => {
  assertIntent('minha loja fica em Santos', 'sent_business_info')
})

test('sent_business_info: "trabalho com estética"', () => {
  assertIntent('trabalho com estética', 'sent_business_info')
})

// ─── Unclear / fallback ───────────────────────────────────────────────────────

test('unclear: mensagem curta sem padrão', () => {
  assertIntent('tá', 'unclear')
})

test('unclear: texto genérico', () => {
  assertIntent('sim', 'unclear')
})

// ─── Intenções secundárias ────────────────────────────────────────────────────

test('secondaryIntents: preço + como funciona na mesma mensagem', () => {
  const result = detectIntent('como funciona e quanto custa?')
  assert.ok(['asking_price', 'asking_how_it_works'].includes(result.intent))
  assert.ok(
    result.secondaryIntents.length > 0,
    'Deveria detectar intenção secundária'
  )
  const all = [result.intent, ...result.secondaryIntents]
  assert.ok(all.includes('asking_price'))
  assert.ok(all.includes('asking_how_it_works'))
})

test('secondaryIntents: interesse + dados do negócio', () => {
  const result = detectIntent('tenho interesse, sou dentista')
  const all = [result.intent, ...result.secondaryIntents]
  assert.ok(all.includes('interested'))
  assert.ok(all.includes('sent_business_info'))
})

// ─── Estrutura do retorno ─────────────────────────────────────────────────────

test('retorno sempre tem todos os campos obrigatórios', () => {
  const result = detectIntent('qualquer mensagem')
  assert.ok('intent' in result)
  assert.ok('secondaryIntents' in result)
  assert.ok('confusionDetected' in result)
  assert.ok('confusionType' in result)
  assert.ok(Array.isArray(result.secondaryIntents))
  assert.ok(VALID_INTENTS.includes(result.intent))
})

test('intent está sempre na lista de intenções válidas', () => {
  const mensagens = [
    'oi',
    'quanto custa?',
    'aparece no Google?',
    'como funciona?',
    'tá caro',
    'vou pensar',
    'não conheço vocês',
    'quero marcar reunião',
    'não tenho interesse',
    'sou dentista',
    'quanto custa um anúncio desse?',
    '',
    '   ',
  ]
  for (const msg of mensagens) {
    const result = detectIntent(msg)
    assert.ok(VALID_INTENTS.includes(result.intent), `Intent inválido para "${msg}": "${result.intent}"`)
  }
})
