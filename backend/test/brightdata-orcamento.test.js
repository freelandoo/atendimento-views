'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const O = require('../src/services/brightdata-orcamento')

const SRC = path.join(__dirname, '..', 'src')
const FONTE_MODULO = fs.readFileSync(path.join(SRC, 'services', 'brightdata-orcamento.js'), 'utf8')
const FONTE_PROSPECTING = fs.readFileSync(path.join(SRC, 'prospecting.js'), 'utf8')
const FONTE_DB = fs.readFileSync(path.join(SRC, 'db', 'brightdata-consumo.js'), 'utf8')
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '081_brightdata_consumo.sql'), 'utf8'
)
// A 092 alarga o MESMO CHECK (fb_paginas, cross-reference da Biblioteca de Anuncios do Meta) —
// e' a definicao CORRENTE do vocabulario aceito pelo banco, nao mais a da 081 sozinha.
const MIGRATION_SCRAPER_ATUAL = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'migrations', '092_meta_ads_pagina.sql'), 'utf8'
)

// ── As duas travas respondem perguntas diferentes ─────────────────────────────

test('teto diario barra pelo pior caso, nao pela media', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 300, custoEstimado: 200, teto: 400, reserva: 0 })
  assert.equal(v.permitido, false)
  assert.equal(v.motivo, O.MOTIVO.TETO_DIARIO)
  assert.match(v.mensagem, /300\/400/)
})

test('teto respeitado libera', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 100, custoEstimado: 200, teto: 400, reserva: 0 })
  assert.equal(v.permitido, true)
  assert.equal(v.motivo, O.MOTIVO.LIBERADO)
  assert.equal(v.restante_hoje, 300)
})

test('teto 0 desliga a trava diaria', () => {
  const v = O.avaliarOrcamento({ consumidoHoje: 99999, custoEstimado: 200, teto: 0, reserva: 0 })
  assert.equal(v.permitido, true)
  assert.equal(v.restante_hoje, null)
})

test('a RESERVA protege o saldo do enriquecimento, que o teto diario sozinho nao protege', () => {
  // Dentro do teto do dia, mas comeria a reserva: e' exatamente o caso que o teto nao pega.
  const v = O.avaliarOrcamento({
    consumidoHoje: 0, custoEstimado: 200, saldoEstimado: 1100, teto: 400, reserva: 1000,
  })
  assert.equal(v.permitido, false)
  assert.equal(v.motivo, O.MOTIVO.RESERVA)
})

test('saldo folgado passa pela reserva', () => {
  const v = O.avaliarOrcamento({
    consumidoHoje: 0, custoEstimado: 200, saldoEstimado: 4760, teto: 400, reserva: 1000,
  })
  assert.equal(v.permitido, true)
})

test('saldo DESCONHECIDO pula a reserva — nao a assume', () => {
  // Bloquear por um saldo que ninguem informou pararia a operacao por falta de cadastro.
  const v = O.avaliarOrcamento({
    consumidoHoje: 0, custoEstimado: 200, saldoEstimado: null, teto: 400, reserva: 1000,
  })
  assert.equal(v.permitido, true)
  assert.equal(v.saldo_estimado, null)
})

test('o teto e avaliado ANTES da reserva — o motivo devolvido e o mais imediato', () => {
  const v = O.avaliarOrcamento({
    consumidoHoje: 400, custoEstimado: 200, saldoEstimado: 10, teto: 400, reserva: 1000,
  })
  assert.equal(v.motivo, O.MOTIVO.TETO_DIARIO)
})

// ── Saldo estimado ────────────────────────────────────────────────────────────

test('saldo estimado e aritmetica sobre o valor informado', () => {
  assert.equal(O.saldoEstimado({ saldoInformado: 4760, consumidoDesde: 260 }), 4500)
})

test('saldo nunca fica negativo, e sem informe e null (nunca zero)', () => {
  assert.equal(O.saldoEstimado({ saldoInformado: 100, consumidoDesde: 500 }), 0)
  assert.equal(O.saldoEstimado({ saldoInformado: null, consumidoDesde: 10 }), null)
  assert.equal(O.saldoEstimado({}), null)
})

// ── Vocabulario ───────────────────────────────────────────────────────────────

test('scraper fora da lista fechada e recusado antes do banco', () => {
  assert.equal(O.scraperConhecido('maps_descoberta'), true)
  assert.equal(O.scraperConhecido('ig_posts'), true)
  assert.equal(O.scraperConhecido('inventado'), false)
  assert.equal(O.scraperConhecido(''), false)
})

test('a lista de scrapers do modulo bate com o CHECK CORRENTE do banco (081 alargado pela 092)', () => {
  const m = MIGRATION_SCRAPER_ATUAL.match(/scraper_type IN \(([^)]+)\)/s)
  assert.ok(m, 'a migration 092 precisa ter o CHECK de scraper_type (ela alarga o da 081)')
  const noBanco = m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')).sort()
  assert.deepEqual(noBanco, [...O.SCRAPERS].sort(),
    'vocabulario divergente entre o modulo e o banco — um dos dois aceitaria valor que o outro recusa')
})

// ── Guardas de regressao ──────────────────────────────────────────────────────

test('GUARDA: o modulo de orcamento e PURO', () => {
  for (const proibido of ['require(\'../db\')', 'pool.query', 'axios', 'fetch(']) {
    assert.ok(!FONTE_MODULO.includes(proibido),
      `brightdata-orcamento.js nao pode conter "${proibido}" — ele julga, nao consulta`)
  }
})

test('GUARDA: a Aquisicao confere orcamento ANTES de reservar e de disparar', () => {
  const posOrcamento = FONTE_PROSPECTING.indexOf('avaliarOrcamento({')
  // Âncora no INSERT real, não no nome do índice: ele também aparece em comentário.
  const posReserva = FONTE_PROSPECTING.indexOf('INSERT INTO prospectador.busca_snapshots')
  const posTrigger = FONTE_PROSPECTING.indexOf('dispararBuscaMaps({')
  assert.ok(posOrcamento > 0, 'pesquisarPlaces precisa avaliar orcamento')
  assert.ok(posOrcamento < posReserva,
    'o orcamento tem de ser avaliado antes da reserva — reservar para depois recusar deixaria lixo na fila')
  assert.ok(posOrcamento < posTrigger,
    'o orcamento tem de ser avaliado ANTES do disparo pago, senao a trava nao trava nada')
})

test('GUARDA: o consumo gravado e o REAL devolvido, nunca a quantidade solicitada', () => {
  const i = FONTE_PROSPECTING.indexOf('registrarConsumo({')
  const trecho = FONTE_PROSPECTING.slice(i, i + 400)
  assert.ok(/registros:\s*recebidos/.test(trecho),
    'o ledger precisa gravar `recebidos` (o que a fonte devolveu), nunca `alvo`/`quantidade_solicitada`')
})

test('GUARDA: o consumo e somado GLOBALMENTE, nao por empresa', () => {
  // Os creditos sao de UMA conta. Somar por empresa deixaria N empresas gastarem N x o teto.
  const i = FONTE_DB.indexOf('async function consumidoHoje')
  const trecho = FONTE_DB.slice(i, i + 700)
  assert.ok(!/empresa_id\s*=/.test(trecho),
    'consumidoHoje nao pode filtrar por empresa_id — a conta Bright Data e uma so')
})

test('GUARDA: o ledger e idempotente por snapshot', () => {
  assert.ok(/brightdata_consumo_snapshot_uk/.test(MIGRATION) && /ON CONFLICT DO NOTHING/.test(FONTE_DB),
    'sem isso o worker somaria o mesmo snapshot a cada reprocessamento e o teto travaria sozinho')
})

test('GUARDA: registrar consumo NUNCA derruba o processamento ja pago', () => {
  const i = FONTE_DB.indexOf('async function registrarConsumo')
  const trecho = FONTE_DB.slice(i, FONTE_DB.indexOf('async function consumidoHoje'))
  assert.ok(/catch\s*\(/.test(trecho) && /return false/.test(trecho),
    'contabilidade quebrada nao pode perder leads que ja foram pagos')
})

test('GUARDA: a migration e ADITIVA e nao muta dado', () => {
  assert.ok(!/^\s*UPDATE\s/im.test(MIGRATION), 'a 081 nao pode atualizar linha existente')
  assert.ok(!/ALTER TABLE prospectador\.prospects/i.test(MIGRATION),
    'a 081 nao deve tocar prospects — ela so cria a contabilidade')
})
