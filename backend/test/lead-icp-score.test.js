const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SCORE_MAXIMO,
  faixaPorScore,
  normalizarRespostas,
  calcularScoreRespostas,
} = require('../src/services/icp-modelo')
const {
  calcularSinaisAutomaticos,
  respostasSugeridas,
  calcularIcpLead,
} = require('../src/services/lead-icp-score')

test('ICP Tenka v1.1 soma ate 13 e classifica A/B/C', () => {
  assert.equal(SCORE_MAXIMO, 13)
  assert.equal(faixaPorScore(13), 'A')
  assert.equal(faixaPorScore(10), 'A')
  assert.equal(faixaPorScore(9), 'B')
  assert.equal(faixaPorScore(6), 'B')
  assert.equal(faixaPorScore(5), 'C')
})

test('respostas desconhecidas nao entram no score', () => {
  const r = normalizarRespostas({
    operacao_validada: 'sim',
    instagram_ativo: true,
    campo_inventado: true,
  })
  assert.equal(r.operacao_validada, true)
  assert.equal(r.instagram_ativo, true)
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'campo_inventado'), false)
  const score = calcularScoreRespostas(r)
  assert.equal(score.score, 2)
  assert.equal(score.faixa, 'C')
})

test('sinais automaticos sugerem ICP sem transformar cadastro em prioridade', () => {
  const lead = {
    origem: 'automatico',
    place_id: 'ChIJ_x',
    tem_site: false,
    site: null,
    instagram_handle: 'loja',
    avaliacoes: 74,
    rating: 4.7,
    score_cadastro: 20,
  }
  const sinais = calcularSinaisAutomaticos(lead)
  assert.equal(sinais.operacao_validada.sugerido, true)
  assert.equal(sinais.instagram_ativo.sugerido, true)
  assert.equal(sinais.lacuna_digital_clara.sugerido, true)
  assert.equal(respostasSugeridas(lead).lacuna_digital_clara, true)
  const icp = calcularIcpLead(lead)
  assert.equal(icp.score, 4)
  assert.equal(icp.faixa, 'C')
})

test('score final usa o checklist humano, mesmo quando o cadastro e fraco', () => {
  const icp = calcularIcpLead({ score_cadastro: 10 }, {
    operacao_validada: true,
    instagram_ativo: true,
    imagem_valor: true,
    investiu_marketing_tecnologia: true,
    crescimento: true,
    cliente_valor_relevante: true,
    lacuna_digital_clara: true,
    acesso_decisor: true,
  })
  assert.equal(icp.score, 13)
  assert.equal(icp.faixa, 'A')
  assert.ok(icp.criterios.every((c) => c.marcado))
})
