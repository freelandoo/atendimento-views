'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const A = require('../src/services/asaas-eventos')
const { STATUS } = require('../src/services/plano-definicao')

test('statusDoEvento: confirmado/recebido = ativo; vencido = atrasado; apagado = cancelado', () => {
  assert.equal(A.statusDoEvento('PAYMENT_CONFIRMED'), 'ativo')
  assert.equal(A.statusDoEvento('PAYMENT_RECEIVED'), 'ativo')
  assert.equal(A.statusDoEvento('PAYMENT_OVERDUE'), 'atrasado')
  assert.equal(A.statusDoEvento('SUBSCRIPTION_DELETED'), 'cancelado')
  assert.equal(A.statusDoEvento('PAYMENT_DELETED'), 'cancelado')
})

test('statusDoEvento: evento desconhecido ou created = null (ignora/ack)', () => {
  assert.equal(A.statusDoEvento('PAYMENT_CREATED'), null)
  assert.equal(A.statusDoEvento('ZORP'), null)
  assert.equal(A.statusDoEvento(undefined), null)
})

test('anti-drift: todo status mapeado existe em plano-definicao.STATUS', () => {
  for (const s of Object.values(A.EVENTO_PARA_STATUS)) {
    assert.ok(STATUS.includes(s), `status '${s}' precisa existir em plano-definicao.STATUS`)
  }
})

test('validarToken: casa igual, recusa diferente, vazio e tamanho diferente', () => {
  assert.equal(A.validarToken('segredo123', 'segredo123'), true)
  assert.equal(A.validarToken('segredo123', 'segredo124'), false)
  assert.equal(A.validarToken('curto', 'segredo123'), false) // tamanho diferente
  assert.equal(A.validarToken('qualquer', ''), false) // config vazio NUNCA valida
  assert.equal(A.validarToken(undefined, 'segredo123'), false)
})

test('chaveEvento: evento + id do pagamento ou da assinatura; null sem id', () => {
  assert.equal(A.chaveEvento({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_1' } }), 'PAYMENT_CONFIRMED:pay_1')
  assert.equal(A.chaveEvento({ event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_9' } }), 'SUBSCRIPTION_DELETED:sub_9')
  assert.equal(A.chaveEvento({ event: 'PAYMENT_CONFIRMED' }), null)
  assert.equal(A.chaveEvento(null), null)
})

test('referenciasAsaas: tira subscription e customer do payment ou da subscription', () => {
  assert.deepEqual(
    A.referenciasAsaas({ payment: { subscription: 'sub_1', customer: 'cus_1' } }),
    { subscriptionId: 'sub_1', customerId: 'cus_1' }
  )
  assert.deepEqual(
    A.referenciasAsaas({ subscription: { id: 'sub_2', customer: 'cus_2' } }),
    { subscriptionId: 'sub_2', customerId: 'cus_2' }
  )
  assert.deepEqual(A.referenciasAsaas({}), { subscriptionId: null, customerId: null })
})
