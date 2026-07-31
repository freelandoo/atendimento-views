const test = require('node:test')
const assert = require('node:assert/strict')

const {
  assertMesmaEmpresa, criarCampanha, atualizarCampanha, atualizarLead, adicionarLeads,
} = require('../src/db/campanhas')

function fakePool(rows = []) {
  const calls = []
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows } } }
}

test('assertMesmaEmpresa: id de outra empresa (nao achou) -> 400', async () => {
  const pool = fakePool([]) // SELECT filtra empresa_id e nao retorna
  await assert.rejects(
    () => assertMesmaEmpresa(pool, { schema: 'app', table: 'nichos', id: 'n-x', empresaId: 'emp1', rotulo: 'Nicho' }),
    (err) => err.statusCode === 400 && /Nicho nao encontrado/.test(err.message)
  )
})

test('assertMesmaEmpresa: id nulo nao consulta (no-op)', async () => {
  const pool = fakePool([])
  await assertMesmaEmpresa(pool, { schema: 'app', table: 'nichos', id: null, empresaId: 'emp1', rotulo: 'Nicho' })
  assert.equal(pool.calls.length, 0)
})

test('criarCampanha: nome obrigatorio', async () => {
  const pool = fakePool([])
  await assert.rejects(() => criarCampanha(pool, 'emp1', { nome: '  ' }), /nome e obrigatorio/)
  assert.equal(pool.calls.length, 0)
})

test('criarCampanha: status invalido', async () => {
  const pool = fakePool([])
  await assert.rejects(() => criarCampanha(pool, 'emp1', { nome: 'C', status: 'xxx' }), /status invalido/)
})

test('criarCampanha: nicho de outro tenant e barrado (same-tenant guard) antes de inserir', async () => {
  const pool = fakePool([]) // o SELECT do assertMesmaEmpresa nao acha o nicho no tenant
  await assert.rejects(
    () => criarCampanha(pool, 'emp1', { nome: 'C', nicho_id: 'n-de-outro' }),
    (err) => err.statusCode === 400 && /Nicho nao encontrado/.test(err.message)
  )
  // so rodou o SELECT de validacao, nunca o INSERT
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('atualizarCampanha: status invalido', async () => {
  const pool = fakePool([])
  await assert.rejects(() => atualizarCampanha(pool, 'emp1', 'c1', { status: 'zzz' }), /status invalido/)
})

test('atualizarLead: status de oportunidade invalido', async () => {
  const pool = fakePool([])
  await assert.rejects(() => atualizarLead(pool, 'emp1', 'cl1', { status: 'inexistente' }), /status invalido/)
})

test('atualizarLead: status valido do enum passa da validacao', async () => {
  const pool = fakePool([{ id: 'cl1', status: 'qualificado' }])
  const r = await atualizarLead(pool, 'emp1', 'cl1', { status: 'qualificado' })
  assert.equal(r.status, 'qualificado')
  assert.match(pool.calls[0].sql, /WHERE id = \$1 AND empresa_id = \$2/)
})

test('adicionarLeads: sem ids -> 0 (nao consulta insert)', async () => {
  const pool = fakePool([])
  // assertMesmaEmpresa da campanha roda 1 SELECT (retorna [] -> barraria); usamos campanha valida:
  const pool2 = { calls: [], async query(sql) { this.calls.push({ sql }); return { rows: /campanhas/.test(sql) ? [{ x: 1 }] : [] } } }
  const r = await adicionarLeads(pool2, 'emp1', 'c1', [])
  assert.equal(r.adicionados, 0)
})
