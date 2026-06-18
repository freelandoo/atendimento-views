'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  MULTI_MESSAGE_BUFFER_SECONDS,
  calculateReplyDelay,
  isMultiMessageSequence,
  calculateDelayWithContext,
  delayToMs,
  sleep,
} = require('../src/reply-delay')

// ─── Constantes ───────────────────────────────────────────────────────────────

test('constantes têm os valores corretos', () => {
  assert.equal(MIN_DELAY_SECONDS, 3)
  assert.equal(MAX_DELAY_SECONDS, 30)
  assert.equal(MULTI_MESSAGE_BUFFER_SECONDS, 15)
})

// ─── calculateReplyDelay — fórmula exata do usuário ──────────────────────────

test('delay base: mensagem curta + resposta curta = 5s', () => {
  assert.equal(calculateReplyDelay('oi', 'olá'), 5)
})

test('delay +5: userMessage > 100 chars', () => {
  const user = 'a'.repeat(101)
  assert.equal(calculateReplyDelay(user, 'ok'), 10)
})

test('delay +8 extra: userMessage > 300 chars (acumula com >100)', () => {
  const user = 'a'.repeat(301)
  // base 5 + 5 (>100) + 8 (>300) = 18
  assert.equal(calculateReplyDelay(user, 'ok'), 18)
})

test('delay +6: botReply > 500 chars', () => {
  const reply = 'a'.repeat(501)
  assert.equal(calculateReplyDelay('oi', reply), 11)  // 5 + 6
})

test('delay máximo combinado: user>300 + reply>500 = 24', () => {
  const user = 'a'.repeat(400)
  const reply = 'a'.repeat(600)
  assert.equal(calculateReplyDelay(user, reply), 24)  // 5 + 5 + 8 + 6
})

test('clamp mínimo: nunca abaixo de 3s', () => {
  assert.ok(calculateReplyDelay('', '') >= MIN_DELAY_SECONDS)
  assert.equal(calculateReplyDelay('', ''), 5)  // base já está acima do mínimo
})

test('clamp máximo: nunca acima de 30s', () => {
  // Fórmula atual: base(5) + >100(5) + >300(8) + >500reply(6) = 24 máximo
  // O clamp em 30 é proteção para adições futuras, não atingível pela fórmula atual
  const huge = 'a'.repeat(5000)
  const result = calculateReplyDelay(huge, huge)
  assert.ok(result <= MAX_DELAY_SECONDS, `delay ${result}s deve ser <= ${MAX_DELAY_SECONDS}s`)
  assert.equal(result, 24)  // máximo real com a fórmula atual
})

test('strings null/undefined tratadas como vazias', () => {
  assert.equal(calculateReplyDelay(null, null), 5)
  assert.equal(calculateReplyDelay(undefined, undefined), 5)
})

test('delay de exatamente 100 chars não aplica +5 (threshold é >100)', () => {
  const user = 'a'.repeat(100)
  assert.equal(calculateReplyDelay(user, 'ok'), 5)  // == 100, não >100
})

test('delay de exatamente 101 chars aplica +5', () => {
  const user = 'a'.repeat(101)
  assert.equal(calculateReplyDelay(user, 'ok'), 10)
})

test('delay de exatamente 500 chars de reply não aplica +6', () => {
  const reply = 'a'.repeat(500)
  assert.equal(calculateReplyDelay('oi', reply), 5)  // == 500, não >500
})

test('delay nunca é instantâneo para qualquer entrada', () => {
  const cases = [
    ['', ''],
    ['oi', 'olá'],
    ['a'.repeat(50), 'b'.repeat(50)],
    ['a'.repeat(200), 'b'.repeat(200)],
  ]
  for (const [u, r] of cases) {
    const d = calculateReplyDelay(u, r)
    assert.ok(d >= MIN_DELAY_SECONDS, `delay ${d}s é menor que o mínimo ${MIN_DELAY_SECONDS}s`)
  }
})

// ─── isMultiMessageSequence ───────────────────────────────────────────────────

test('count=1: não é sequência', () => {
  assert.equal(isMultiMessageSequence(1), false)
})

test('count=2: é sequência', () => {
  assert.equal(isMultiMessageSequence(2), true)
})

test('count=3: é sequência', () => {
  assert.equal(isMultiMessageSequence(5), true)
})

test('array vazio: não é sequência', () => {
  assert.equal(isMultiMessageSequence([]), false)
})

test('array de 1 timestamp: não é sequência', () => {
  assert.equal(isMultiMessageSequence([Date.now()]), false)
})

test('2 timestamps próximos (5s): é sequência', () => {
  const now = Date.now()
  assert.equal(isMultiMessageSequence([now - 5000, now]), true)
})

test('2 timestamps dentro da janela de 30s: é sequência', () => {
  const now = Date.now()
  assert.equal(isMultiMessageSequence([now - 25000, now]), true)
})

test('2 timestamps distantes (>30s): não é sequência', () => {
  const now = Date.now()
  assert.equal(isMultiMessageSequence([now - 31000, now]), false)
})

test('3 timestamps dentro da janela: é sequência', () => {
  const now = Date.now()
  assert.equal(isMultiMessageSequence([now - 20000, now - 10000, now]), true)
})

test('array de objetos com timestamp: funciona', () => {
  const now = Date.now()
  const msgs = [
    { timestamp: now - 8000, content: 'msg 1' },
    { timestamp: now - 3000, content: 'msg 2' },
    { timestamp: now, content: 'msg 3' },
  ]
  assert.equal(isMultiMessageSequence(msgs), true)
})

test('array de objetos distantes: não é sequência', () => {
  const now = Date.now()
  const msgs = [
    { timestamp: now - 120000, content: 'ontem' },
    { timestamp: now, content: 'agora' },
  ]
  assert.equal(isMultiMessageSequence(msgs), false)
})

test('janela customizada: 5s detecta apenas mensagens muito próximas', () => {
  const now = Date.now()
  assert.equal(isMultiMessageSequence([now - 6000, now], 5000), false)
  assert.equal(isMultiMessageSequence([now - 4000, now], 5000), true)
})

// ─── calculateDelayWithContext ────────────────────────────────────────────────

test('mensagem única: retorna delay base sem buffer', () => {
  const result = calculateDelayWithContext('oi', 'olá', 1)
  assert.equal(result.isMultiMessage, false)
  assert.equal(result.seconds, 5)
})

test('multi-message com delay base < 15: aplica buffer de 15s', () => {
  const result = calculateDelayWithContext('oi', 'olá', 3)  // count=3 → multi
  assert.equal(result.isMultiMessage, true)
  assert.equal(result.seconds, MULTI_MESSAGE_BUFFER_SECONDS)  // 15
})

test('multi-message com delay base > 15: mantém delay calculado', () => {
  const user = 'a'.repeat(400)
  const reply = 'a'.repeat(600)
  // base delay = 24, MULTI_MESSAGE_BUFFER = 15 → max(24, 15) = 24
  const result = calculateDelayWithContext(user, reply, 3)
  assert.equal(result.isMultiMessage, true)
  assert.equal(result.seconds, 24)
})

test('nunca passa de 30s mesmo com multi-message', () => {
  const huge = 'a'.repeat(5000)
  const result = calculateDelayWithContext(huge, huge, 10)
  assert.ok(result.seconds <= MAX_DELAY_SECONDS)
})

test('breakdown descreve a composição do delay', () => {
  const user = 'a'.repeat(150)
  const reply = 'a'.repeat(600)
  const result = calculateDelayWithContext(user, reply, 1)
  assert.ok('breakdown' in result)
  assert.equal(result.breakdown.base, 5)
  assert.equal(result.breakdown.userReadingTime, 5)    // >100
  assert.equal(result.breakdown.replyTypingTime, 6)    // >500
})

test('resultado tem todos os campos esperados', () => {
  const result = calculateDelayWithContext('oi', 'olá', 1)
  assert.ok('seconds' in result)
  assert.ok('isMultiMessage' in result)
  assert.ok('breakdown' in result)
  assert.ok(typeof result.seconds === 'number')
  assert.ok(typeof result.isMultiMessage === 'boolean')
})

// ─── delayToMs ───────────────────────────────────────────────────────────────

test('delayToMs converte corretamente', () => {
  assert.equal(delayToMs(5), 5000)
  assert.equal(delayToMs(15), 15000)
  assert.equal(delayToMs(30), 30000)
  assert.equal(delayToMs(0), 0)
})

test('delayToMs arredonda frações', () => {
  assert.equal(delayToMs(1.5), 1500)
  assert.equal(delayToMs(1.234), 1234)
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: nunca responde instantaneamente', () => {
  const casos = [
    { u: 'oi', r: 'olá' },
    { u: 'a'.repeat(50), r: 'b'.repeat(50) },
    { u: 'a'.repeat(500), r: 'b'.repeat(1000) },
  ]
  for (const { u, r } of casos) {
    const d = calculateReplyDelay(u, r)
    assert.ok(d > 0, 'delay deve ser positivo')
    assert.ok(delayToMs(d) > 0, 'delay em ms deve ser positivo')
  }
})

test('critério: aguarda mensagens quebradas do cliente (multi-message buffer)', () => {
  // Lead mandou 3 mensagens em sequência
  const now = Date.now()
  const sequencia = [now - 8000, now - 4000, now]

  assert.equal(isMultiMessageSequence(sequencia), true)

  const result = calculateDelayWithContext('oi', 'olá', sequencia)
  assert.equal(result.isMultiMessage, true)
  assert.ok(
    result.seconds >= MULTI_MESSAGE_BUFFER_SECONDS,
    `delay ${result.seconds}s deve ser >= ${MULTI_MESSAGE_BUFFER_SECONDS}s para multi-message`
  )
})

// ─── sleep (teste de integração rápida — sem timer real) ─────────────────────

test('sleep resolve corretamente', async () => {
  const inicio = Date.now()
  const ms = await sleep(0.05)  // 50ms para não tornar o teste lento
  const elapsed = Date.now() - inicio
  assert.equal(ms, 50)
  assert.ok(elapsed >= 40, `elapsed ${elapsed}ms < 40ms`)
})
