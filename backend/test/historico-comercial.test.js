'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { montarBlocoHistoricoComercial } = require('../src/services/historico-comercial')

const pool = {}
const emp = 'e1'
const ok = (rows) => ({ _historico: async () => rows })

test('telefone invalido ou sem historico => bloco vazio', async () => {
  assert.equal(await montarBlocoHistoricoComercial(pool, emp, '123', ok([])), '')
  assert.equal(await montarBlocoHistoricoComercial(pool, emp, '5562999990000', ok([])), '')
  assert.equal(await montarBlocoHistoricoComercial(null, emp, '5562999990000', ok([{ tipo: 'ligacao_encerrada' }])), '')
})

test('resume ligacoes com contagem, tempo relativo e duracao', async () => {
  const rows = [
    { tipo: 'ligacao_encerrada', ocorrido_em: new Date(Date.now() - 3 * 86400000).toISOString(), rotulo: 'sem_interesse', detalhe: null, duracao_seg: 130 },
    { tipo: 'ligacao_registrada', ocorrido_em: new Date(Date.now() - 10 * 86400000).toISOString(), rotulo: 'nao_atendeu' },
  ]
  const bloco = await montarBlocoHistoricoComercial(pool, emp, '5562999990000', ok(rows))
  assert.match(bloco, /Ligações: 2 registrada/)
  assert.match(bloco, /última há 3 dias/)
  assert.match(bloco, /durou 2min 10s/)
  assert.match(bloco, /sem_interesse/)
})

test('inclui anotacoes de follow-up (proxima acao + nota do operador)', async () => {
  const rows = [
    { tipo: 'followup_concluido', ocorrido_em: new Date().toISOString(), rotulo: 'Retornar semana que vem', detalhe: 'cliente demonstrou interesse por site' },
  ]
  const bloco = await montarBlocoHistoricoComercial(pool, emp, '5562999990000', ok(rows))
  assert.match(bloco, /Anotação: Retornar semana que vem — cliente demonstrou interesse por site/)
})

test('falha na leitura nunca lanca (retorna vazio)', async () => {
  const bloco = await montarBlocoHistoricoComercial(pool, emp, '5562999990000', {
    _historico: async () => { throw new Error('db down') },
  })
  assert.equal(bloco, '')
})
