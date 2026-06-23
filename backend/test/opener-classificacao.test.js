'use strict'

const assert = require('node:assert')
const test = require('node:test')

const { classificarLeadOferecerOuContratar } = require('../src/core-funnel')

// Protocolo de abertura: classifica se o lead OFERECE serviços (provedor) ou
// BUSCA contratar (cliente). Default = provedor (público principal).
test('classificarLeadOferecerOuContratar: provedor (oferece serviços)', () => {
  for (const t of [
    'Eu sou freelancer de marketing',
    'sou freelancer procurando clientes', // não pode virar "cliente" pelo "procurando"
    'trabalho com design',
    'ofereço serviços de social media',
    'sou influenciador',
    'quero divulgar meu trabalho',
    'faço edição de vídeo',
  ]) {
    assert.equal(classificarLeadOferecerOuContratar(t), 'provedor', `falhou: ${t}`)
  }
})

test('classificarLeadOferecerOuContratar: cliente (busca contratar)', () => {
  for (const t of [
    'preciso de um designer',
    'quero contratar um social media',
    'estou procurando uma manicure',
    'busco uma pessoa pra fazer meu site',
    'preciso contratar alguém',
  ]) {
    assert.equal(classificarLeadOferecerOuContratar(t), 'cliente', `falhou: ${t}`)
  }
})

test('classificarLeadOferecerOuContratar: ambíguo/vazio cai no default provedor', () => {
  assert.equal(classificarLeadOferecerOuContratar('Quero ganhar dinheiro'), 'provedor')
  assert.equal(classificarLeadOferecerOuContratar(''), 'provedor')
  assert.equal(classificarLeadOferecerOuContratar(null), 'provedor')
})
