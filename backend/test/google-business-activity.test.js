'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  calcularAtividadeGoogle,
  normalizarStatusGoogle,
  ultimaAtividadeGoogle,
} = require('../src/services/google-business-activity')

const agora = '2026-09-16T12:00:00Z'

test('review recente deixa o perfil quente nos ultimos 6 meses', () => {
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'OPERATIONAL',
    userRatingCount: 32,
    reviews: [{ publishTime: '2026-07-20T10:00:00Z' }],
  }, { agora })

  assert.equal(atividade.faixa, 'ativo_recente')
  assert.ok(atividade.pontos > 0)
  assert.equal(atividade.ultima_atividade_em, '2026-07-20T10:00:00.000Z')
})

test('atividade antiga esfria sem descartar automaticamente', () => {
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'OPERATIONAL',
    userRatingCount: 40,
    reviews: [{ publishTime: '2024-01-10T10:00:00Z' }],
  }, { agora })

  assert.equal(atividade.faixa, 'atividade_antiga')
  assert.ok(atividade.pontos < 0)
})

test('perfil fechado derruba forte mesmo com sinais bons', () => {
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'CLOSED_PERMANENTLY',
    userRatingCount: 250,
    reviews: [{ publishTime: '2026-08-01T10:00:00Z' }],
  }, { agora })

  assert.equal(normalizarStatusGoogle({ businessStatus: 'CLOSED_PERMANENTLY' }), 'fechado_permanente')
  assert.equal(atividade.faixa, 'fechado')
  assert.ok(atividade.pontos <= -80)
})

test('status interno do prospect nao mascara businessStatus do raw_json', () => {
  const atividade = calcularAtividadeGoogle({
    status: 'aguardando',
    raw_json: { businessStatus: 'CLOSED_PERMANENTLY' },
  }, { agora })

  assert.equal(atividade.faixa, 'fechado')
})

test('sem status e sem sinais vira possivelmente inativo', () => {
  const atividade = calcularAtividadeGoogle({}, { agora })

  assert.equal(atividade.faixa, 'possivelmente_inativo')
  assert.ok(atividade.pontos < 0)
  assert.equal(atividade.ultima_atividade_em, null)
})

test('ultima atividade considera datas de review e foto', () => {
  const ultima = ultimaAtividadeGoogle({
    reviews: [{ publishTime: '2026-04-01T10:00:00Z' }],
    photos: [{ publishTime: '2026-05-10T10:00:00Z' }],
  })

  assert.equal(ultima.toISOString(), '2026-05-10T10:00:00.000Z')
})
