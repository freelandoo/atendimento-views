'use strict'
const { test } = require('node:test')
const assert = require('node:assert')

const O = require('../src/services/apify-orcamento')

test('teto diario barra pelo pior caso (custo estimado = solicitado), nao pela media', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 150, custoEstimado: 100, teto: 200 })
  assert.equal(v.permitido, false)
  assert.equal(v.motivo, O.MOTIVO.TETO_DIARIO)
  assert.match(v.mensagem, /150\/200/)
})

test('dentro do teto libera e devolve o restante do dia', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 50, custoEstimado: 25, teto: 200 })
  assert.equal(v.permitido, true)
  assert.equal(v.motivo, O.MOTIVO.LIBERADO)
  assert.equal(v.restante_hoje, 150)
})

test('teto 0 desliga a trava', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 99999, custoEstimado: 200, teto: 0 })
  assert.equal(v.permitido, true)
  assert.equal(v.restante_hoje, null)
})

test('exatamente no limite ainda libera (so estoura quando ULTRAPASSA)', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 100, custoEstimado: 100, teto: 200 })
  assert.equal(v.permitido, true)
})

test('o PADRAO e SEM teto (decisao do operador, 2026-09-22) — o freio e o clamp por busca', () => {
  assert.equal(O.PADRAO_TETO_DIARIO, 0)
  const antigo = process.env.APIFY_META_ADS_TETO_DIARIO
  try {
    delete process.env.APIFY_META_ADS_TETO_DIARIO
    // Sem env e sem teto: nenhuma busca e recusada por orcamento, por maior que seja o gasto.
    const v = O.avaliarOrcamento({ consumidoHoje: 10000, custoEstimado: 200, teto: O.tetoDiarioMetaAds() })
    assert.equal(v.permitido, true)
    assert.equal(v.restante_hoje, null)
  } finally {
    if (antigo === undefined) delete process.env.APIFY_META_ADS_TETO_DIARIO
    else process.env.APIFY_META_ADS_TETO_DIARIO = antigo
  }
})

test('a trava RELIGA so com a env — o mecanismo nao foi removido', () => {
  const antigo = process.env.APIFY_META_ADS_TETO_DIARIO
  try {
    process.env.APIFY_META_ADS_TETO_DIARIO = '200'
    assert.equal(O.tetoDiarioMetaAds(), 200)
    const v = O.avaliarOrcamento({ consumidoHoje: 5, custoEstimado: 200, teto: O.tetoDiarioMetaAds() })
    assert.equal(v.permitido, false)
    assert.equal(v.motivo, O.MOTIVO.TETO_DIARIO)
  } finally {
    if (antigo === undefined) delete process.env.APIFY_META_ADS_TETO_DIARIO
    else process.env.APIFY_META_ADS_TETO_DIARIO = antigo
  }
})

test('tetoDiarioMetaAds le a env, com o padrao quando ausente/invalida', () => {
  const antigo = process.env.APIFY_META_ADS_TETO_DIARIO
  try {
    delete process.env.APIFY_META_ADS_TETO_DIARIO
    assert.equal(O.tetoDiarioMetaAds(), O.PADRAO_TETO_DIARIO)
    process.env.APIFY_META_ADS_TETO_DIARIO = '50'
    assert.equal(O.tetoDiarioMetaAds(), 50)
    process.env.APIFY_META_ADS_TETO_DIARIO = 'nao-e-numero'
    assert.equal(O.tetoDiarioMetaAds(), O.PADRAO_TETO_DIARIO)
  } finally {
    if (antigo === undefined) delete process.env.APIFY_META_ADS_TETO_DIARIO
    else process.env.APIFY_META_ADS_TETO_DIARIO = antigo
  }
})
