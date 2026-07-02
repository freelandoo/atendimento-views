'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')

// Chave fixa antes de carregar o módulo (é lida na 1ª cifragem e cacheada).
process.env.FREELANDOO_ENC_KEY = crypto.randomBytes(32).toString('base64')

const {
  encrypt, decrypt, assinaturaEsperada, verificarAssinaturaWebhook, _resetChaveCache,
} = require('../src/freelandoo/crypto')

test('encrypt/decrypt faz round-trip e o texto cifrado não vaza o segredo', () => {
  const segredo = 'flnd_atd_abc123_super_secreto'
  const cifrado = encrypt(segredo)
  assert.ok(cifrado.startsWith('fl1:'), 'deve ter prefixo de versão')
  assert.ok(!cifrado.includes(segredo), 'texto cifrado não pode conter o segredo em claro')
  assert.strictEqual(decrypt(cifrado), segredo)
})

test('encrypt de valor vazio/nulo devolve null', () => {
  assert.strictEqual(encrypt(''), null)
  assert.strictEqual(encrypt(null), null)
  assert.strictEqual(decrypt(null), null)
})

test('decrypt de valor adulterado lança (GCM detecta)', () => {
  const cifrado = encrypt('valor')
  const partes = cifrado.split(':')
  partes[3] = Buffer.from('outracoisa').toString('base64url')
  assert.throws(() => decrypt(partes.join(':')))
})

test('assinatura do webhook confere com HMAC sobre `${ts}.${raw}`', () => {
  const secret = 'whsec_teste'
  const ts = 1700000000
  const raw = JSON.stringify({ event: 'message.received', message: { id_message: 'x' } })
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
  assert.strictEqual(assinaturaEsperada(secret, ts, raw), esperado)
})

test('verificarAssinaturaWebhook aceita assinatura válida', () => {
  const secret = 'whsec_teste'
  const ts = Math.floor(Date.now() / 1000)
  const raw = Buffer.from('{"event":"message.received"}', 'utf8')
  const sig = assinaturaEsperada(secret, ts, raw)
  const r = verificarAssinaturaWebhook({ webhookSecret: secret, timestamp: ts, signature: sig, rawBody: raw })
  assert.strictEqual(r.ok, true)
})

test('verificarAssinaturaWebhook rejeita assinatura errada', () => {
  const ts = Math.floor(Date.now() / 1000)
  const raw = Buffer.from('{"event":"message.received"}', 'utf8')
  const r = verificarAssinaturaWebhook({ webhookSecret: 'certo', timestamp: ts, signature: 'sha256=deadbeef', rawBody: raw })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.motivo, 'assinatura')
})

test('verificarAssinaturaWebhook rejeita replay (> 5 min)', () => {
  const secret = 'whsec_teste'
  const ts = Math.floor(Date.now() / 1000) - 600 // 10 min atrás
  const raw = Buffer.from('{}', 'utf8')
  const sig = assinaturaEsperada(secret, ts, raw)
  const r = verificarAssinaturaWebhook({ webhookSecret: secret, timestamp: ts, signature: sig, rawBody: raw })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.motivo, 'replay')
})

test('verificarAssinaturaWebhook rejeita quando falta segredo', () => {
  const r = verificarAssinaturaWebhook({ webhookSecret: '', timestamp: 1, signature: 'x', rawBody: 'y' })
  assert.strictEqual(r.ok, false)
  _resetChaveCache()
})
