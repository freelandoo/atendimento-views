'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { _internals } = require('../src/services/notificacoes-centro')

test('central de notificacoes ordena criticidade antes de recencia', () => {
  const itens = _internals.ordenarItens([
    { id: 'media-nova', prioridade: 'media', quando: '2026-09-25T18:00:00.000Z' },
    { id: 'critica-antiga', prioridade: 'critica', quando: '2026-09-25T09:00:00.000Z' },
    { id: 'alta', prioridade: 'alta', quando: '2026-09-25T17:00:00.000Z' },
  ])

  assert.deepEqual(itens.map((i) => i.id), ['critica-antiga', 'alta', 'media-nova'])
})

test('central de notificacoes ignora item sem total', () => {
  const itens = []
  _internals.addItem(itens, { id: 'zero', total: 0 })
  _internals.addItem(itens, { id: 'um', total: 1, titulo: 'Um', tipo: 'x', grupo: 'Teste', destino_url: '/x' })

  assert.equal(itens.length, 1)
  assert.equal(itens[0].id, 'um')
})

test('central de notificacoes pluraliza lembrete ativo', () => {
  assert.equal(_internals.plural(1, 'lembrete ativo', 'lembretes ativos'), 'lembrete ativo')
  assert.equal(_internals.plural(2, 'lembrete ativo', 'lembretes ativos'), 'lembretes ativos')
})
