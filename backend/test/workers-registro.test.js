'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { WORKERS, iniciarWorkers } = require('../src/workers')

const FONTE_INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

function loggerFalso() {
  const avisos = []
  const infos = []
  return { avisos, infos, warn: (o, m) => avisos.push({ o, m }), info: (o, m) => infos.push({ o, m }) }
}

// ─── O registro ──────────────────────────────────────────────────────────────────────────

test('o registro lista exatamente os workers que o processo roda', () => {
  // Lista fechada de proposito: worker e' o que gasta credito pago, dispara WhatsApp e mexe em
  // lead sem ninguem pedir. Acrescentar um tem de ser uma decisao visivel, nao um `setInterval`
  // que aparece no meio de um service.
  assert.deepEqual(WORKERS.map((w) => w.nome), [
    'job-worker',
    'silence-watcher',
    'captacao-social',
    'lead-lock',
    'banco-leads-auto',
    'lead-search',
    'freelandoo-playbook-refresh',
  ])
})

test('so o motor de atendimento e essencial', () => {
  // Sem job worker e sem silence watcher o produto aceita webhook e nunca responde — subir
  // assim e' pior que nao subir. As automacoes periodicas degradam a operacao, nao o
  // atendimento, entao a falha delas na largada nao pode derrubar o processo.
  const essenciais = WORKERS.filter((w) => w.essencial).map((w) => w.nome)
  assert.deepEqual(essenciais, ['job-worker', 'silence-watcher'])
})

test('todo worker declara nome, descricao e como iniciar', () => {
  for (const w of WORKERS) {
    assert.match(w.nome, /^[a-z0-9-]+$/, 'nome em kebab-case')
    assert.ok(w.descricao && w.descricao.length > 10, `${w.nome} sem descricao util`)
    assert.equal(typeof w.iniciar, 'function')
    assert.equal(typeof w.essencial, 'boolean')
  }
})

// ─── A politica de falha na largada ──────────────────────────────────────────────────────

test('inicia todos e devolve o que subiu', () => {
  const chamados = []
  const workers = [
    { nome: 'a', essencial: true, iniciar: () => chamados.push('a') },
    { nome: 'b', essencial: false, iniciar: () => chamados.push('b') },
  ]
  const logger = loggerFalso()
  const r = iniciarWorkers({ agent: {}, pool: {}, workers, logger })

  assert.deepEqual(chamados, ['a', 'b'], 'a ordem do registro e a ordem de largada')
  assert.deepEqual(r.iniciados, ['a', 'b'])
  assert.deepEqual(r.falharam, [])
})

test('falha de worker NAO essencial e registrada e o boot segue', () => {
  const workers = [
    { nome: 'quebra', essencial: false, iniciar: () => { throw new Error('sem credencial') } },
    { nome: 'depois', essencial: false, iniciar: () => {} },
  ]
  const logger = loggerFalso()
  const r = iniciarWorkers({ agent: {}, pool: {}, workers, logger })

  assert.deepEqual(r.iniciados, ['depois'], 'um worker quebrado nao impede o proximo')
  assert.deepEqual(r.falharam, [{ nome: 'quebra', erro: 'sem credencial' }])
  assert.equal(logger.avisos.length, 1)
  assert.equal(logger.avisos[0].o.worker, 'quebra')
})

test('falha de worker ESSENCIAL derruba o boot', () => {
  const depois = []
  const workers = [
    { nome: 'motor', essencial: true, iniciar: () => { throw new Error('motor nao subiu') } },
    { nome: 'depois', essencial: false, iniciar: () => depois.push('rodou') },
  ]
  assert.throws(
    () => iniciarWorkers({ agent: {}, pool: {}, workers, logger: loggerFalso() }),
    /motor nao subiu/
  )
  assert.deepEqual(depois, [], 'nada sobe depois de um essencial falhar')
})

test('cada worker recebe agent e pool', () => {
  const agent = { marca: 'agent' }
  const pool = { marca: 'pool' }
  let recebido = null
  iniciarWorkers({
    agent,
    pool,
    workers: [{ nome: 'x', essencial: false, iniciar: (deps) => { recebido = deps } }],
    logger: loggerFalso(),
  })
  assert.equal(recebido.agent, agent)
  assert.equal(recebido.pool, pool)
})

// ─── Guardas: o boot nao pode voltar a espalhar worker ───────────────────────────────────

test('index.js inicia workers SO pelo registro', () => {
  // Era exatamente isto que o registro veio resolver: cinco workers no `.then()` do initDB e o
  // do Freelandoo solto no meio da montagem de rotas, ~80 linhas acima.
  assert.ok(/iniciarWorkers\(\{\s*agent,\s*pool\s*\}\)/.test(FONTE_INDEX),
    'o boot precisa chamar o registro')

  const semComentarios = FONTE_INDEX.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

  for (const proibido of [
    'iniciarJobWorker',
    'iniciarSilenceWatcher',
    'iniciarCaptureWorker',
    'iniciarLeadLockWorker',
    'iniciarBancoLeadsAutoWorker',
    'iniciarLeadSearchWorker',
    'iniciarRefreshDiarioDePlaybooks',
  ]) {
    assert.ok(!semComentarios.includes(proibido),
      `${proibido} nao pode ser chamado direto no index.js — declare no registro de workers`)
  }
})

test('o registro nao carrega os modulos de worker so por ser importado', () => {
  // O `require` de cada worker e' lazy dentro do `iniciar`. Se subisse para o topo do modulo,
  // importar o registro (num teste, num script) arrastaria rotas, pool e clientes HTTP junto.
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'workers', 'index.js'), 'utf8')
  const requiresNoTopo = fonte
    .split(/\r?\n/)
    .filter((l) => /^const .*= require\(/.test(l))
    .map((l) => l.match(/require\('([^']+)'\)/)?.[1])
    .filter(Boolean)
  assert.deepEqual(requiresNoTopo, ['../logger'], 'so o logger pode ser carregado no topo')
})
