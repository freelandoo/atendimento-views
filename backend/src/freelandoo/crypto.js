'use strict'

// Cifragem em repouso do token e do webhook_secret da conexão Freelandoo.
// AES-256-GCM. A chave vem de FREELANDOO_ENC_KEY (32 bytes em base64 ou hex);
// se ausente, é DERIVADA de JWT_SECRET via scrypt (fallback determinístico) para
// não quebrar em dev — em produção prefira setar FREELANDOO_ENC_KEY explícito.
//
// Formato do valor cifrado (string única, base64url por segmento):
//   fl1:<iv>:<authTag>:<ciphertext>

const crypto = require('crypto')

const PREFIX = 'fl1'
let _cachedKey = null

function resolverChave() {
  if (_cachedKey) return _cachedKey
  const raw = String(process.env.FREELANDOO_ENC_KEY || '').trim()
  if (raw) {
    let buf = null
    if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex')
    else {
      try { buf = Buffer.from(raw, 'base64') } catch (_) { buf = null }
    }
    if (buf && buf.length === 32) {
      _cachedKey = buf
      return _cachedKey
    }
    // Chave presente mas em formato/tamanho inesperado: deriva dela por scrypt.
    _cachedKey = crypto.scryptSync(raw, 'freelandoo-enc-v1', 32)
    return _cachedKey
  }
  const seed = String(process.env.JWT_SECRET || process.env.REPROCESS_SECRET || 'freelandoo-dev-key')
  _cachedKey = crypto.scryptSync(seed, 'freelandoo-enc-v1', 32)
  return _cachedKey
}

// Só para testes: permite trocar a chave em runtime.
function _resetChaveCache() { _cachedKey = null }

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null
  const key = resolverChave()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':')
}

function decrypt(value) {
  if (value == null || value === '') return null
  const parts = String(value).split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Valor cifrado Freelandoo inválido')
  }
  const key = resolverChave()
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const ct = Buffer.from(parts[3], 'base64url')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

// ─── Assinatura do webhook (HMAC-SHA256 sobre `${ts}.${raw}`) ───────────────────
// rawBody deve ser o corpo CRU (Buffer ou string) exatamente como recebido.
function assinaturaEsperada(webhookSecret, ts, rawBody) {
  const h = crypto.createHmac('sha256', String(webhookSecret))
  h.update(`${ts}.`)
  h.update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
  return 'sha256=' + h.digest('hex')
}

// Retorna { ok: true } ou { ok: false, motivo }. Nunca lança.
function verificarAssinaturaWebhook({ webhookSecret, timestamp, signature, rawBody, toleranciaSeg = 300, agoraSeg }) {
  if (!webhookSecret) return { ok: false, motivo: 'sem_segredo' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, motivo: 'timestamp_invalido' }
  const now = Number.isFinite(agoraSeg) ? agoraSeg : Date.now() / 1000
  if (Math.abs(now - ts) > toleranciaSeg) return { ok: false, motivo: 'replay' }
  const sig = String(signature || '')
  const esperada = assinaturaEsperada(webhookSecret, timestamp, rawBody)
  const a = Buffer.from(sig)
  const b = Buffer.from(esperada)
  if (a.length !== b.length) return { ok: false, motivo: 'assinatura' }
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, motivo: 'assinatura' }
  return { ok: true }
}

module.exports = {
  encrypt,
  decrypt,
  assinaturaEsperada,
  verificarAssinaturaWebhook,
  _resetChaveCache,
}
