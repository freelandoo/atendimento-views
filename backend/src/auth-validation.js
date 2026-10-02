// @ts-check
'use strict'

const { problemaDaSenha } = require('./services/cadastro-membro')
const { cpfValido, normalizarCpf } = require('./cpf')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

// Valida e normaliza o corpo do signup. role é SEMPRE 'user' (anti-escalonamento).
// Cadastro público exige nome, e-mail, CPF, telefone e senha forte. A senha usa a MESMA régua do
// cadastro de membro (services/cadastro-membro.js: 8+, uma letra, um número) — duas réguas fariam
// a mesma porta nascer com exigências diferentes. CPF é obrigatório: a conta fica linkada a ele
// (1 conta por CPF, anti-abuso do trial — a unicidade vive na migration 116).
function validarSignup(body) {
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const nome = String(body?.nome || '').trim()
  const cpf = normalizarCpf(body?.cpf)
  const telefone = String(body?.telefone || '').replace(/\D/g, '')

  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Email inválido.' } }
  }
  if (!nome) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'Nome obrigatório.' } }
  }
  if (!cpfValido(cpf)) {
    return { ok: false, error: { code: 'CPF_INVALIDO', message: 'CPF inválido.' } }
  }
  if (telefone.length < 10 || telefone.length > 13) {
    return { ok: false, error: { code: 'TELEFONE_INVALIDO', message: 'Telefone inválido — informe com DDD.' } }
  }
  const probSenha = problemaDaSenha(password)
  if (probSenha) {
    return { ok: false, error: { code: 'WEAK_PASSWORD', message: probSenha } }
  }
  return { ok: true, data: { email, password, nome, cpf, telefone, role: 'user' } }
}

module.exports = { validarSignup, MIN_PASSWORD, EMAIL_RE }
