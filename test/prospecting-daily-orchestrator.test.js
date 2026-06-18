'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  slotEnvioParaInstante,
  verificarAgendaDiariaProspeccao,
  agendarEnvioItemFilaDiaria,
} = require('../src/prospecting')

test('slotEnvioParaInstante converte horário local de São Paulo (-03) para instante UTC', () => {
  // 09:00 em São Paulo = 12:00 UTC (sem horário de verão desde 2019)
  assert.equal(slotEnvioParaInstante('2026-05-28T09:00:00').toISOString(), '2026-05-28T12:00:00.000Z')
  assert.equal(slotEnvioParaInstante('2026-05-28T08:00:00').toISOString(), '2026-05-28T11:00:00.000Z')
})

test('slotEnvioParaInstante aceita data com espaço e ignora sufixo extra', () => {
  assert.equal(slotEnvioParaInstante('2026-05-28 14:30:00').toISOString(), '2026-05-28T17:30:00.000Z')
})

test('slotEnvioParaInstante retorna null para entrada inválida', () => {
  assert.equal(slotEnvioParaInstante('abc'), null)
  assert.equal(slotEnvioParaInstante(''), null)
  assert.equal(slotEnvioParaInstante(null), null)
})

test('orquestrador e helper de agendamento são exportados como funções', () => {
  assert.equal(typeof verificarAgendaDiariaProspeccao, 'function')
  assert.equal(typeof agendarEnvioItemFilaDiaria, 'function')
})
