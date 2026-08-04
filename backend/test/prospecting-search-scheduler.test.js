'use strict'
// Leitura do RESULTADO da busca automática legada. O agendamento que este arquivo
// cobria (buscaProspeccaoDevePreencher) foi removido junto com o motor autônomo da
// Busca IA — o que sobrou aqui serve aos snapshots legados que o worker ainda fecha.
// A regra de tempo viva da Aquisição é testada em aquisicao-rotinas-scheduler.test.js.

const test = require('node:test')
const assert = require('node:assert/strict')

const { resultadoBuscaAutomatica } = require('../src/services/prospecting-search-scheduler')

test('automático fixo pausa depois de duas buscas sem leads novos', () => {
  const r = resultadoBuscaAutomatica({ modo_busca: 'automatico_fixo', busca_zero_consecutivos: 1 }, {
    novos_prospects: 0, nicho: 'dentistas', cidade: 'Campinas',
  })
  assert.equal(r.zeros, 2)
  assert.equal(r.estado, 'esgotado')
  assert.match(r.mensagem, /Não encontramos mais leads novos/)
})

test('Busca IA troca o mercado depois de duas buscas vazias sem pausar o motor', () => {
  const r = resultadoBuscaAutomatica({ modo_busca: 'ia', busca_zero_consecutivos: 1 }, {
    novos_prospects: 0, nicho: 'dentistas', cidade: 'Campinas',
  })
  assert.equal(r.zeros, 2)
  assert.equal(r.estado, 'aguardando')
  assert.match(r.mensagem, /escolherá outro mercado/)
})

test('resultado com leads novos zera a sequência de esgotamento', () => {
  const r = resultadoBuscaAutomatica({ modo_busca: 'automatico_fixo', busca_zero_consecutivos: 2 }, {
    novos_prospects: 7, nicho: 'dentistas', cidade: 'Campinas',
  })
  assert.equal(r.zeros, 0)
  assert.equal(r.estado, 'aguardando')
})
