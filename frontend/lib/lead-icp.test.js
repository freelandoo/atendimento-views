'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const I = require('./lead-icp')

test('calcula Lead A/B/C na escala 13 sem depender de cadastro', () => {
  assert.equal(I.SCORE_MAXIMO_ICP, 13)
  assert.equal(I.faixaPorScoreIcp(13), 'A')
  assert.equal(I.faixaPorScoreIcp(10), 'A')
  assert.equal(I.faixaPorScoreIcp(9), 'B')
  assert.equal(I.faixaPorScoreIcp(6), 'B')
  assert.equal(I.faixaPorScoreIcp(5), 'C')
})

test('selo sempre traz texto e estado sem ICP explicito', () => {
  assert.equal(I.seloIcp('A', 12).rotulo, 'Lead A')
  assert.equal(I.seloIcp(null, null).rotulo, 'Sem ICP')
  assert.match(I.seloIcp(null, null).classe, /border-dashed/)
})

test('resumo do lead prefere snapshot do banco e nao inventa score', () => {
  const sem = I.resumoIcpDoLead({})
  assert.equal(sem.faixa, 'sem_icp')
  assert.equal(sem.score, null)
  const com = I.resumoIcpDoLead({ icp_faixa: 'B', icp_score: 8 })
  assert.equal(com.faixa, 'B')
  assert.equal(com.score, 8)
})

test('ordem ICP deixa sem avaliacao por ultimo', () => {
  assert.ok(I.ordemIcp({ icp_faixa: 'A', icp_score: 10 }) > I.ordemIcp({ icp_faixa: 'B', icp_score: 9 }))
  assert.ok(I.ordemIcp({ icp_faixa: 'C', icp_score: 5 }) > I.ordemIcp({}))
})

test('todo criterio ICP tem explicacao operacional para hover/detalhes', () => {
  for (const c of I.CRITERIOS_ICP_TENKA) {
    assert.ok(c.explicacao && c.explicacao.length > 20, c.id)
  }
})

test('resumo operacional usa sinais automaticos como previa antes de salvar', () => {
  const r = I.resumoIcpOperacional({
    origem: 'instagram',
    situacao_site: 'sem_site',
    avaliacoes: 12,
    rating: 4.7,
  })
  assert.equal(r.origem, 'previsao')
  assert.ok(r.score > 0)
  assert.notEqual(r.faixa, 'sem_icp')
})
