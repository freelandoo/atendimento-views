const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { AGENDA_VENDAS, AGENDA_APP, EVENTOS_COMERCIAIS_TIPOS, JOB_QUEUE_TIPOS } = require('../src/domain-enums')

const initSql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8')
const mig011 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '011_agenda_multiempresa.sql'), 'utf8')
const mig032 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '032_eventos_comerciais_auto_reply.sql'), 'utf8')

// Extrai a lista de valores da primeira CHECK (... IN (...)) que segue o nome da constraint.
function checkIn(sql, constraintName) {
  const m = sql.match(new RegExp(constraintName + '[\\s\\S]*?\\bIN\\s*\\(([^)]*)\\)'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}
function mesmoConjunto(codigo, sql, rotulo) {
  assert.ok(Array.isArray(sql), `${rotulo}: nao achei a CHECK no SQL`)
  assert.deepEqual([...codigo].sort(), [...sql].sort(),
    `${rotulo}: enum do codigo (domain-enums.js) divergiu da CHECK no SQL`)
}

test('AGENDA_VENDAS bate com a CHECK de vendas.agenda_eventos (sql/init.sql)', () => {
  mesmoConjunto(AGENDA_VENDAS.TIPOS, checkIn(initSql, 'agenda_eventos_tipo_chk'), 'vendas.tipo')
  mesmoConjunto(AGENDA_VENDAS.STATUS, checkIn(initSql, 'agenda_eventos_status_chk'), 'vendas.status')
  mesmoConjunto(AGENDA_VENDAS.PRIORIDADES, checkIn(initSql, 'agenda_eventos_prioridade_chk'), 'vendas.prioridade')
})

test('AGENDA_APP bate com a CHECK de app.agenda_eventos (migration 011)', () => {
  mesmoConjunto(AGENDA_APP.TIPOS, checkIn(mig011, 'agenda_eventos_tipo_chk'), 'app.tipo')
  mesmoConjunto(AGENDA_APP.STATUS, checkIn(mig011, 'agenda_eventos_status_chk'), 'app.status')
})

test('EVENTOS_COMERCIAIS_TIPOS bate com a CHECK eventos_comerciais_tipo_chk (init.sql + migration 032)', () => {
  mesmoConjunto(EVENTOS_COMERCIAIS_TIPOS, checkIn(initSql, 'eventos_comerciais_tipo_chk'), 'eventos_comerciais(init.sql)')
  mesmoConjunto(EVENTOS_COMERCIAIS_TIPOS, checkIn(mig032, 'eventos_comerciais_tipo_chk'), 'eventos_comerciais(migration 032)')
})

test('db-crud.registrarEventoComercial usa a fonte unica (whitelist = EVENTOS_COMERCIAIS_TIPOS)', () => {
  // Garante que o whitelist do codigo nao voltou a ser um array literal solto.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db-crud.js'), 'utf8')
  assert.match(src, /new Set\(EVENTOS_COMERCIAIS_TIPOS\)/, 'db-crud deve construir o Set a partir da fonte unica')
})

test('JOB_QUEUE_TIPOS bate com a CHECK job_queue_tipo_chk (sql/init.sql)', () => {
  mesmoConjunto(JOB_QUEUE_TIPOS, checkIn(initSql, 'job_queue_tipo_chk'), 'job_queue')
})

// Varre src/ por INSERTs literais em vendas.job_queue e coleta o tipo. Enqueues
// parametrizados (VALUES ($1, ...)) nao casam (nao tem aspas) — sao validados no proprio
// produtor. Pega o risco concreto: um produtor enfileirar um tipo fora da CHECK.
function scanEnqueueTipos(dir, out = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { scanEnqueueTipos(full, out); continue }
    if (!entry.name.endsWith('.js')) continue
    const txt = fs.readFileSync(full, 'utf8')
    const re = /INSERT\s+INTO\s+vendas\.job_queue[\s\S]{0,200}?VALUES\s*\(\s*'([a-z_]+)'/g
    let m
    while ((m = re.exec(txt))) out.add(m[1])
  }
  return out
}

test('job_queue: todo tipo literal enfileirado em src/ esta na fonte unica (== CHECK)', () => {
  const enfileirados = scanEnqueueTipos(path.join(__dirname, '..', 'src'))
  assert.ok(enfileirados.size > 0, 'esperava achar ao menos um enqueue literal de job_queue')
  for (const tipo of enfileirados) {
    assert.ok(JOB_QUEUE_TIPOS.includes(tipo),
      `job_queue: produtor enfileira '${tipo}', que NAO esta na CHECK job_queue_tipo_chk — INSERT seria rejeitado (falha silenciosa)`)
  }
})

test('arrays da fonte unica sem duplicatas e nao vazios', () => {
  for (const arr of [AGENDA_VENDAS.TIPOS, AGENDA_VENDAS.STATUS, AGENDA_VENDAS.PRIORIDADES,
    AGENDA_APP.TIPOS, AGENDA_APP.STATUS, AGENDA_APP.PRIORIDADES, EVENTOS_COMERCIAIS_TIPOS]) {
    assert.ok(arr.length > 0)
    assert.equal(new Set(arr).size, arr.length, 'ha valor duplicado no enum')
  }
})

test('agenda.js e agenda-multiempresa.js carregam consumindo a fonte unica', () => {
  // Regressao de import: garante que os modulos resolvem './domain-enums' / '../domain-enums'.
  const agenda = require('../src/agenda')
  const multi = require('../src/services/agenda-multiempresa')
  assert.equal(typeof agenda.criarEventoAgenda, 'function')
  assert.equal(typeof multi.criarEvento, 'function')
})
