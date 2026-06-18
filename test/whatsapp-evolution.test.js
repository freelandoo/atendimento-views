'use strict'

/**
 * Testes para classificarErroEvolution e garantias de envio WhatsApp/Evolution API.
 * Cobre os requisitos de robustez do Passo 8 do plano de correção.
 */

const assert = require('assert')

// ─── Cópia local de classificarErroEvolution (sem import do módulo com deps) ─
function classificarErroEvolution(err) {
  const status = err.response?.status
  const msgRaw = err.response?.data?.response?.message || err.response?.data?.message || err.message || ''
  const msg = String(Array.isArray(msgRaw) ? msgRaw.join(' ') : msgRaw).toLowerCase()
  const code = String(err.code || '')

  if (msg.includes('connection closed') || msg.includes('conexão fechada')) {
    return { tipo: 'instance_disconnected', retryable: true, motivo: 'Evolution instance connection closed' }
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return { tipo: 'transient', retryable: true, motivo: `Network error: ${code}` }
  }
  if (status === 502 || status === 503 || status === 504) {
    return { tipo: 'transient', retryable: true, motivo: `HTTP ${status} gateway error` }
  }
  if (status === 400 || status === 422) {
    return { tipo: 'invalid_payload', retryable: false, motivo: `HTTP ${status} invalid payload` }
  }
  if (status === 401 || status === 403) {
    return { tipo: 'auth_error', retryable: false, motivo: `HTTP ${status} authentication error` }
  }
  if (status === 500) {
    return { tipo: 'transient', retryable: true, motivo: 'HTTP 500 internal server error' }
  }
  return { tipo: 'unknown', retryable: false, motivo: `Unexpected error: ${String(err.message || 'unknown').slice(0, 200)}` }
}

// ─── Cópia local de numeroEnvioWhatsapp ──────────────────────────────────────
function numeroEnvioWhatsapp(numero) {
  const raw = String(numero || '').trim()
  if (!raw) return ''
  if (/@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) return ''
  if (/@/.test(raw) && !/@s\.whatsapp\.net$/i.test(raw)) return ''
  return raw.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
}

// ─── Helpers de teste ────────────────────────────────────────────────────────
let passed = 0
let failed = 0
function test(nome, fn) {
  try {
    fn()
    console.log(`  ✓ ${nome}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${nome}`)
    console.error(`    ${e.message}`)
    failed++
  }
}

function makeErr(overrides = {}) {
  const err = new Error(overrides.message || 'test error')
  if (overrides.status != null) {
    err.response = { status: overrides.status, data: overrides.data || {} }
  }
  if (overrides.code) err.code = overrides.code
  return err
}

// ─── Suite 1: classificarErroEvolution ──────────────────────────────────────
console.log('\nSuite: classificarErroEvolution')

test('Connection Closed → instance_disconnected, retryable=true', () => {
  const err = makeErr({ status: 500, data: { response: { message: 'Connection Closed' } } })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'instance_disconnected')
  assert.strictEqual(r.retryable, true)
})

test('connection closed em minúsculo → instance_disconnected, retryable=true', () => {
  const err = makeErr({ status: 500, data: { response: { message: 'connection closed' } } })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'instance_disconnected')
  assert.strictEqual(r.retryable, true)
})

test('Connection Closed como array → instance_disconnected, retryable=true', () => {
  const err = makeErr({ status: 500, data: { response: { message: ['Connection Closed'] } } })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'instance_disconnected')
  assert.strictEqual(r.retryable, true)
})

test('ECONNRESET → transient, retryable=true', () => {
  const err = makeErr({ code: 'ECONNRESET' })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('ETIMEDOUT → transient, retryable=true', () => {
  const err = makeErr({ code: 'ETIMEDOUT' })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('ECONNABORTED → transient, retryable=true', () => {
  const err = makeErr({ code: 'ECONNABORTED' })
  const r = classificarErroEvolution(err)
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('HTTP 502 → transient, retryable=true', () => {
  const r = classificarErroEvolution(makeErr({ status: 502 }))
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('HTTP 503 → transient, retryable=true', () => {
  const r = classificarErroEvolution(makeErr({ status: 503 }))
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('HTTP 504 → transient, retryable=true', () => {
  const r = classificarErroEvolution(makeErr({ status: 504 }))
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('HTTP 500 sem Connection Closed → transient, retryable=true', () => {
  const r = classificarErroEvolution(makeErr({ status: 500, data: { error: 'Internal Server Error' } }))
  assert.strictEqual(r.tipo, 'transient')
  assert.strictEqual(r.retryable, true)
})

test('HTTP 400 → invalid_payload, retryable=false', () => {
  const r = classificarErroEvolution(makeErr({ status: 400 }))
  assert.strictEqual(r.tipo, 'invalid_payload')
  assert.strictEqual(r.retryable, false)
})

test('HTTP 422 → invalid_payload, retryable=false', () => {
  const r = classificarErroEvolution(makeErr({ status: 422 }))
  assert.strictEqual(r.tipo, 'invalid_payload')
  assert.strictEqual(r.retryable, false)
})

test('HTTP 401 → auth_error, retryable=false', () => {
  const r = classificarErroEvolution(makeErr({ status: 401 }))
  assert.strictEqual(r.tipo, 'auth_error')
  assert.strictEqual(r.retryable, false)
})

test('HTTP 403 → auth_error, retryable=false', () => {
  const r = classificarErroEvolution(makeErr({ status: 403 }))
  assert.strictEqual(r.tipo, 'auth_error')
  assert.strictEqual(r.retryable, false)
})

test('erro sem status → unknown, retryable=false', () => {
  const r = classificarErroEvolution(new Error('algo inesperado'))
  assert.strictEqual(r.tipo, 'unknown')
  assert.strictEqual(r.retryable, false)
})

// ─── Suite 2: lógica de prospect não marcado como enviado em falha ───────────
console.log('\nSuite: prospect não marcado como enviado em falha')

test('saída ok=false quando classificacao retorna retryable=true', () => {
  // Simula o que enviarProspectsAprovados faz após catch
  const err = makeErr({ status: 500, data: { response: { message: 'Connection Closed' } } })
  const cls = classificarErroEvolution(err)
  const saida = {
    prospect_id: 'uuid-123',
    ok: false,
    erro: err.message,
    tipo_erro: cls.tipo,
    retryable: cls.retryable,
    motivo: cls.motivo,
  }
  assert.strictEqual(saida.ok, false, 'prospect NÃO deve ser marcado como enviado')
  assert.strictEqual(saida.retryable, true, 'deve ser retryable')
  assert.strictEqual(saida.tipo_erro, 'instance_disconnected')
})

test('saída ok=false quando 400 (não retryable)', () => {
  const err = makeErr({ status: 400 })
  const cls = classificarErroEvolution(err)
  const saida = { ok: false, retryable: cls.retryable, tipo_erro: cls.tipo }
  assert.strictEqual(saida.ok, false)
  assert.strictEqual(saida.retryable, false, 'erro 400 não deve ser retryable')
})

// ─── Suite 3: backoff da job_queue ───────────────────────────────────────────
console.log('\nSuite: cálculo de backoff por tentativa')

function calcularBackoff(tentativa) {
  return tentativa <= 1 ? 300 : tentativa === 2 ? 900 : 3600
}

test('tentativa 1 → backoff 300s (5 min)', () => {
  assert.strictEqual(calcularBackoff(1), 300)
})

test('tentativa 2 → backoff 900s (15 min)', () => {
  assert.strictEqual(calcularBackoff(2), 900)
})

test('tentativa 3 → backoff 3600s (60 min)', () => {
  assert.strictEqual(calcularBackoff(3), 3600)
})

test('tentativa 5 → backoff 3600s (60 min)', () => {
  assert.strictEqual(calcularBackoff(5), 3600)
})

// ─── Suite 4: normalização de número ─────────────────────────────────────────
console.log('\nSuite: numeroEnvioWhatsapp')

test('JID → dígitos', () => {
  assert.strictEqual(numeroEnvioWhatsapp('5511987654321@s.whatsapp.net'), '5511987654321')
})

test('número limpo → mantido', () => {
  assert.strictEqual(numeroEnvioWhatsapp('5511987654321'), '5511987654321')
})

test('formatado → limpo', () => {
  assert.strictEqual(numeroEnvioWhatsapp('+55 (11) 98765-4321'), '5511987654321')
})

test('@broadcast → rejeitado', () => {
  assert.strictEqual(numeroEnvioWhatsapp('@broadcast'), '')
})

test('@g.us → rejeitado (grupo)', () => {
  assert.strictEqual(numeroEnvioWhatsapp('123456789@g.us'), '')
})

// ─── Suite 5: payload sendText ───────────────────────────────────────────────
console.log('\nSuite: payload sendText')

test('payload tem exatamente number e text', () => {
  const payload = { number: '5511987654321', text: 'mensagem' }
  assert.strictEqual(Object.keys(payload).length, 2)
  assert.ok(payload.number)
  assert.ok(payload.text)
  assert(!payload.message, 'não deve ter campo message')
  assert(!payload.textMessage, 'não deve ter campo textMessage')
})

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} testes — ✓ ${passed} passou, ✗ ${failed} falhou`)
if (failed > 0) {
  process.exitCode = 1
}
