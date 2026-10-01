'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const P = require('./plano')

test('precisaAssinar: só quando a API diz liberado=false; null não bloqueia', () => {
  assert.equal(P.precisaAssinar(null), false)
  assert.equal(P.precisaAssinar({ liberado: true }), false)
  assert.equal(P.precisaAssinar({ liberado: false }), true)
})

test('somenteLeitura: liberado mas atrasado', () => {
  assert.equal(P.somenteLeitura({ liberado: true, somenteLeitura: true }), true)
  assert.equal(P.somenteLeitura({ liberado: true, somenteLeitura: false }), false)
  assert.equal(P.somenteLeitura({ liberado: false, somenteLeitura: true }), false)
  assert.equal(P.somenteLeitura(null), false)
})

test('diasRestantesTrial: arredonda pra cima, 0 no passado, null fora de trial', () => {
  const futuro = new Date(Date.now() + 2.2 * 86400000).toISOString()
  assert.equal(P.diasRestantesTrial({ status: 'trial', trial_fim: futuro }), 3)
  assert.equal(P.diasRestantesTrial({ status: 'trial', trial_fim: new Date(Date.now() - 1000).toISOString() }), 0)
  assert.equal(P.diasRestantesTrial({ status: 'ativo', trial_fim: futuro }), null)
  assert.equal(P.diasRestantesTrial({ status: 'trial', trial_fim: null }), null)
})

test('rotuloStatus e formatarPreco', () => {
  assert.equal(P.rotuloStatus({ status: 'ativo' }), 'Ativo')
  assert.equal(P.rotuloStatus({ status: 'zorp' }), 'zorp')
  assert.equal(P.rotuloStatus(null), '—')
  assert.equal(P.formatarPreco(null), '—')
  assert.match(P.formatarPreco(149.9), /149,90/)
})
