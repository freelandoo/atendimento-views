// @ts-check
'use strict'

// Validação de CPF (puro). Usado no cadastro público (1 conta por CPF) e onde mais precisar.
// Faz o dígito verificador (mod-11) — não é só "tem 11 dígitos": CPF é identidade, garbage com 11
// dígitos passaria e quebraria o anti-abuso e a cobrança.

function normalizarCpf(v) {
  return String(v == null ? '' : v).replace(/\D/g, '')
}

function _dv(base, pesoInicial) {
  let soma = 0
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i)
  const resto = (soma * 10) % 11
  return resto === 10 ? 0 : resto
}

function cpfValido(v) {
  const cpf = normalizarCpf(v)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false // 000..., 111... etc. passam no mod-11 mas são inválidos
  const d1 = _dv(cpf.slice(0, 9), 10)
  const d2 = _dv(cpf.slice(0, 10), 11)
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

module.exports = { normalizarCpf, cpfValido }
