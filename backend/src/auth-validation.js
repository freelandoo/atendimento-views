'use strict'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

// Valida e normaliza o corpo do signup. role é SEMPRE 'user' (anti-escalonamento).
function validarSignup(body) {
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const nome = String(body?.nome || '').trim()

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Email inválido.' } }
  }
  if (!nome) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Nome obrigatório.' } }
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: { code: 'WEAK_PASSWORD', message: `Senha precisa de ao menos ${MIN_PASSWORD} caracteres.` } }
  }
  return { ok: true, data: { email, password, nome, role: 'user' } }
}

module.exports = { validarSignup, MIN_PASSWORD, EMAIL_RE }
