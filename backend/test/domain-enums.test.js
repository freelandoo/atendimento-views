const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { AGENDA_VENDAS, AGENDA_APP } = require('../src/domain-enums')

const initSql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'init.sql'), 'utf8')
const mig011 = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrations', '011_agenda_multiempresa.sql'), 'utf8')

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

test('arrays da fonte unica sem duplicatas e nao vazios', () => {
  for (const arr of [AGENDA_VENDAS.TIPOS, AGENDA_VENDAS.STATUS, AGENDA_VENDAS.PRIORIDADES,
    AGENDA_APP.TIPOS, AGENDA_APP.STATUS, AGENDA_APP.PRIORIDADES]) {
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
