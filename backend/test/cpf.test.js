'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { cpfValido, normalizarCpf } = require('../src/cpf')

test('cpfValido: aceita CPF válido (com e sem máscara)', () => {
  assert.equal(cpfValido('11144477735'), true)
  assert.equal(cpfValido('111.444.777-35'), true)
})

test('cpfValido: recusa dígito verificador errado, tamanho errado e todos iguais', () => {
  assert.equal(cpfValido('11144477700'), false) // DV errado
  assert.equal(cpfValido('12345678900'), false)
  assert.equal(cpfValido('111444777'), false) // curto
  assert.equal(cpfValido('11111111111'), false) // todos iguais
  assert.equal(cpfValido(''), false)
  assert.equal(cpfValido(null), false)
})

test('normalizarCpf: só dígitos', () => {
  assert.equal(normalizarCpf('111.444.777-35'), '11144477735')
  assert.equal(normalizarCpf(null), '')
})
