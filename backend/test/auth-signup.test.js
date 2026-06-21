'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { validarSignup } = require('../src/auth-validation')

test('validarSignup — rejeita email inválido', () => {
  const r = validarSignup({ email: 'naoEmail', password: 'segredo12', nome: 'Ana' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — rejeita senha curta', () => {
  const r = validarSignup({ email: 'a@b.com', password: '123', nome: 'Ana' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'WEAK_PASSWORD')
})

test('validarSignup — exige nome', () => {
  const r = validarSignup({ email: 'a@b.com', password: 'segredo12', nome: '  ' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'BAD_REQUEST')
})

test('validarSignup — normaliza e força role user', () => {
  const r = validarSignup({ email: '  A@B.COM ', password: 'segredo12', nome: ' Ana ', role: 'superadmin' })
  assert.equal(r.ok, true)
  assert.equal(r.data.email, 'a@b.com')
  assert.equal(r.data.nome, 'Ana')
  assert.equal(r.data.role, 'user')
})
