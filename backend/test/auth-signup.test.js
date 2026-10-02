'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { validarSignup } = require('../src/auth-validation')

// CPF/telefone válidos para os casos "felizes".
const OK = { email: 'a@b.com', password: 'segredo12', nome: 'Ana', cpf: '11144477735', telefone: '11988887777' }

test('validarSignup — rejeita email inválido', () => {
  const r = validarSignup({ ...OK, email: 'naoEmail' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — exige nome', () => {
  const r = validarSignup({ ...OK, nome: '  ' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — rejeita CPF inválido', () => {
  const r = validarSignup({ ...OK, cpf: '12345678900' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'CPF_INVALIDO')
})

test('validarSignup — rejeita telefone curto', () => {
  const r = validarSignup({ ...OK, telefone: '123' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'TELEFONE_INVALIDO')
})

test('validarSignup — rejeita senha fraca (sem número ou curta)', () => {
  assert.equal(validarSignup({ ...OK, password: '123' }).error.code, 'WEAK_PASSWORD')
  assert.equal(validarSignup({ ...OK, password: 'semnumero' }).error.code, 'WEAK_PASSWORD')
})

test('validarSignup — normaliza e força role user', () => {
  const r = validarSignup({ ...OK, email: '  A@B.COM ', nome: ' Ana ', cpf: '111.444.777-35', telefone: '(11) 98888-7777', role: 'superadmin' })
  assert.equal(r.ok, true)
  assert.equal(r.data.email, 'a@b.com')
  assert.equal(r.data.nome, 'Ana')
  assert.equal(r.data.cpf, '11144477735')
  assert.equal(r.data.telefone, '11988887777')
  assert.equal(r.data.role, 'user')
})
