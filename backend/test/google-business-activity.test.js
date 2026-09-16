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

// ─── Registro CRU preservado pelo adaptador (services/places-brightdata.js) ───────────────
// A recoleta paga passa a gravar o registro da fonte inteiro em `fonte_bruta`. Estes testes
// cobram que o classificador o enxergue: sem isso, guardar o bruto nao serviria para nada e o
// lead voltaria a ser lido como "sem sinal" — que aqui e' o mesmo que candidato a descarte.

test('data de review dentro de fonte_bruta e encontrada', () => {
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'OPERATIONAL',
    fonte_bruta: { reviews: [{ review_date: '2026-08-01T10:00:00Z' }] },
  }, { agora })

  assert.equal(atividade.faixa, 'ativo_recente')
  assert.equal(atividade.ultima_atividade_em, '2026-08-01T10:00:00.000Z')
})

test('fonte_bruta tambem e' + "' lida dentro de raw_json (lead vindo do banco)", () => {
  const atividade = calcularAtividadeGoogle({
    raw_json: { fonte_bruta: { reviews: [{ review_date: '2023-01-05T10:00:00Z' }] } },
  }, { agora })

  assert.equal(atividade.faixa, 'atividade_antiga')
})

test('fechamento declarado na fonte_bruta derruba o lead', () => {
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'OPERATIONAL',
    fonte_bruta: { permanently_closed: true },
  }, { agora })

  assert.equal(atividade.faixa, 'fechado')
})

test('nome alternativo da colecao de reviews e aceito', () => {
  const ultima = ultimaAtividadeGoogle({
    fonte_bruta: { reviews_data: [{ published_at: '2026-06-01T10:00:00Z' }] },
  })

  assert.equal(ultima.toISOString(), '2026-06-01T10:00:00.000Z')
})

test('foto como URL em texto nao inventa data de atividade', () => {
  // O registro real da Bright Data traz `photos_and_videos` como array de STRINGS. String nao
  // tem campo de data: se isto passasse a devolver uma data, todo lead com foto viraria
  // "ativo_recente" sem nenhuma prova de recencia.
  const ultima = ultimaAtividadeGoogle({
    fonte_bruta: { photos_and_videos: ['https://x/1.jpg', 'https://x/2.jpg'] },
  })

  assert.equal(ultima, null)
})

test('sem data nenhuma, a regra de 6 meses nao e avaliada', () => {
  // Estado medido em producao em 2026-09-16 nos 4.631 leads: status operacional, fotos e
  // horario, e NENHUMA data. O classificador nao pode inventar recencia a partir disso.
  const atividade = calcularAtividadeGoogle({
    businessStatus: 'OPERATIONAL',
    userRatingCount: 37,
    photos: ['https://x/1.jpg'],
    regularOpeningHours: { openNow: true },
  }, { agora })

  assert.equal(atividade.faixa, 'ativo_sem_data')
  assert.equal(atividade.dias_desde_atividade, null)
})
