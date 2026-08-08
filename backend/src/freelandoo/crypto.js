'use strict'

// Cifragem em repouso do token e do webhook_secret da conexão Freelandoo.
// AES-256-GCM. A chave vem de FREELANDOO_ENC_KEY (32 bytes em base64 ou hex);
// se ausente, é DERIVADA de JWT_SECRET via scrypt (fallback determinístico) para
// não quebrar em dev — em produção prefira setar FREELANDOO_ENC_KEY explícito.
//
// O algoritmo mora em src/segredos-crypto.js (usado também pelo cofre da Meta).
// Prefixo ('fl1'), salt e ordem das envs continuam EXATAMENTE os mesmos de antes —
// o que já está cifrado no banco segue legível. Trocar qualquer um dos três torna
// ilegível todo token da Freelandoo já gravado.
//
// Formato do valor cifrado (string única, base64url por segmento):
//   fl1:<iv>:<authTag>:<ciphertext>

const crypto = require('crypto')
const { criarCofre } = require('../segredos-crypto')

const cofre = criarCofre({
  prefixo: 'fl1',
  salt: 'freelandoo-enc-v1',
  envs: ['FREELANDOO_ENC_KEY'],
  fallback: ['JWT_SECRET', 'REPROCESS_SECRET'],
  semente: 'freelandoo-dev-key',
})

const { encrypt, decrypt, _resetChaveCache } = cofre

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
