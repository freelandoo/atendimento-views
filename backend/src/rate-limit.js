'use strict'

// Limiter em memória por IP. Janela deslizante simples. Suficiente para mitigar
// brute force/abuso de cadastro num único processo. (Multi-instância → trocar por Redis.)
function criarLimiter({ windowMs, max, code = 'RATE_LIMITED', message = 'Muitas tentativas. Tente mais tarde.' }) {
  const hits = new Map() // ip → [timestamps]
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'desconhecido'
    const agora = Date.now()
    const lista = (hits.get(ip) || []).filter((t) => agora - t < windowMs)
    lista.push(agora)
    hits.set(ip, lista)
    if (lista.length > max) {
      return res.status(429).json({ ok: false, error: { code, message } })
    }
    next()
  }
}

const signupLimiter = criarLimiter({ windowMs: 60 * 60 * 1000, max: 10 }) // 10 cadastros/h por IP
const loginLimiter = criarLimiter({ windowMs: 15 * 60 * 1000, max: 20 }) // 20 logins/15min por IP

module.exports = { criarLimiter, signupLimiter, loginLimiter }
