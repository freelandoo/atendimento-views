'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  HOSTS_LOCAIS, MOTIVOS,
  hostDoDestino, destinoLocal, provaDeProducao, avaliarDestino, mensagemDeBloqueio,
} = require('../src/services/destino-migrations')
const { runMigrations } = require('../src/db/migrations')

const PROD = 'postgresql://u:senha-secreta@postgres.railway.internal:5432/railway'
const PROXY = 'postgresql://u:senha-secreta@monorail.proxy.rlwy.net:41234/railway'
const LOCAL = 'postgresql://evolution:evolution@localhost:5432/evolution_api'

// ─── A regra pura ────────────────────────────────────────────────────────────────────────

test('banco local e liberado', () => {
  for (const host of HOSTS_LOCAIS) {
    // IPv6 precisa de colchetes para ser URL valida — o modulo normaliza na leitura
    const naUrl = host.includes(':') ? `[${host}]` : host
    const url = `postgresql://u:p@${naUrl}:5432/db`
    const v = avaliarDestino({ databaseUrl: url, env: {} })
    assert.equal(v.permitido, true, `${host} deveria ser local`)
    assert.equal(v.motivo, MOTIVOS.LOCAL)
  }
})

test('banco REMOTO sem prova de producao e BLOQUEADO', () => {
  for (const url of [PROD, PROXY]) {
    const v = avaliarDestino({ databaseUrl: url, env: { NODE_ENV: 'development' } })
    assert.equal(v.permitido, false)
    assert.equal(v.motivo, MOTIVOS.REMOTO_SEM_PROVA)
  }
})

test('as DUAS provas de producao liberam, isoladamente', () => {
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: { NODE_ENV: 'production' } }).permitido, true)
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: { RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' } }).permitido, true)
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: { RAILWAY_ENVIRONMENT: 'production' } }).permitido, true)
})

test('para a guarda barrar um deploy real, as DUAS provas teriam de sumir juntas', () => {
  // E' o cenario que torna o bloqueio de producao improvavel: dentro da Railway sempre ha
  // pelo menos uma das duas. Se nao ha nenhuma, aquilo nao e' a Railway.
  const dentroDaRailway = { NODE_ENV: 'production', RAILWAY_PROJECT_ID: 'abc' }
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: dentroDaRailway }).permitido, true)
  delete dentroDaRailway.NODE_ENV
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: dentroDaRailway }).permitido, true)
  delete dentroDaRailway.RAILWAY_PROJECT_ID
  assert.equal(avaliarDestino({ databaseUrl: PROD, env: dentroDaRailway }).permitido, false)
})

test('sem DATABASE_URL o boot segue: db.js cai no default local do proprio codigo', () => {
  const v = avaliarDestino({ databaseUrl: '', env: {} })
  assert.equal(v.permitido, true)
  assert.equal(v.motivo, MOTIVOS.SEM_URL)
  assert.equal(avaliarDestino({ env: {} }).permitido, true)
})

test('URL ilegivel NAO e' + ' tratada como local', () => {
  // Nao se supoe local o que nao deu para ler — erra para o lado de bloquear.
  assert.equal(destinoLocal('nao-e-uma-url'), false)
  assert.equal(hostDoDestino('nao-e-uma-url'), null)
  assert.equal(avaliarDestino({ databaseUrl: 'nao-e-uma-url', env: {} }).permitido, false)
})

test('provaDeProducao aceita qualquer RAILWAY_, e nada alem disso', () => {
  assert.equal(provaDeProducao({ RAILWAY_QUALQUER_COISA: '1' }), true)
  assert.equal(provaDeProducao({ NODE_ENV: 'production' }), true)
  assert.equal(provaDeProducao({ NODE_ENV: 'producao' }), false)
  assert.equal(provaDeProducao({ MEU_RAILWAY: '1' }), false, 'so PREFIXO conta')
  assert.equal(provaDeProducao({}), false)
})

// ─── A mensagem ──────────────────────────────────────────────────────────────────────────

test('a mensagem diz o host, o motivo e a saida — e NUNCA a credencial', () => {
  const v = avaliarDestino({ databaseUrl: PROD, env: {} })
  const msg = mensagemDeBloqueio(v)
  assert.match(msg, /postgres\.railway\.internal/)
  assert.match(msg, /NODE_ENV=production/, 'precisa dizer como seguir de proposito')
  assert.match(msg, /backend\/\.env/, 'precisa dizer onde corrigir')
  assert.ok(!msg.includes('senha-secreta'), 'credencial nunca entra na mensagem')
  assert.ok(!msg.includes(PROD), 'a URL inteira nunca entra na mensagem')
})

// ─── A guarda no runner (o que realmente protege) ────────────────────────────────────────

test('bloqueado: NENHUMA consulta chega ao banco, nem o CREATE SCHEMA', async () => {
  const consultas = []
  const poolFalso = {
    query: async (sql) => { consultas.push(sql); return { rows: [] } },
    connect: async () => { throw new Error('nao deveria conectar') },
  }
  await assert.rejects(
    () => runMigrations(poolFalso, { databaseUrl: PROD, env: { NODE_ENV: 'development' } }),
    /Migrations BLOQUEADAS/
  )
  assert.deepEqual(consultas, [], 'a guarda tem de vir ANTES de qualquer escrita')
})

test('liberado: o runner segue o caminho normal', async () => {
  const consultas = []
  const poolFalso = {
    query: async (sql) => {
      consultas.push(String(sql))
      return { rows: [] }
    },
    connect: async () => ({
      query: async (sql) => { consultas.push(String(sql)); return { rows: [] } },
      release: () => {},
    }),
  }
  await runMigrations(poolFalso, { databaseUrl: LOCAL, env: {} })
  assert.ok(consultas.some((s) => /CREATE SCHEMA IF NOT EXISTS app/.test(s)))
})

// ─── Guardas de regressao ────────────────────────────────────────────────────────────────

const fonteServico = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'destino-migrations.js'), 'utf8'
)
const fonteRunner = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'db', 'migrations.js'), 'utf8'
)

test('o modulo continua PURO: sem banco, sem rede, sem fs', () => {
  for (const proibido of ["require('pg')", 'require("pg")', 'axios', 'node:fs', "require('fs')", 'fetch(']) {
    assert.ok(!fonteServico.includes(proibido), `destino-migrations.js nao pode usar ${proibido}`)
  }
})

test('a guarda nao foi movida para DEPOIS de uma escrita', () => {
  const posGuarda = fonteRunner.indexOf('mensagemDeBloqueio(destino)')
  const posPrimeiraEscrita = fonteRunner.indexOf('CREATE SCHEMA IF NOT EXISTS app')
  assert.ok(posGuarda > 0 && posPrimeiraEscrita > 0, 'os dois trechos precisam existir')
  assert.ok(
    posGuarda < posPrimeiraEscrita,
    'a guarda tem de vir ANTES do CREATE SCHEMA — ele ja e DDL no banco de destino'
  )
})

test('nao nasceu variavel de ambiente propria para furar a guarda', () => {
  // A saida deliberada e NODE_ENV=production. Uma flag propria seria um segundo vocabulario
  // para o mesmo fato — e a porta mais facil de deixar ligada por engano.
  for (const inventada of ['MIGRATIONS_PERMITIR', 'PERMITIR_PRODUCAO', 'FORCE_MIGRATIONS', 'SKIP_GUARD']) {
    assert.ok(!fonteServico.includes(inventada), `nao crie ${inventada}`)
    assert.ok(!fonteRunner.includes(inventada), `nao crie ${inventada}`)
  }
})
