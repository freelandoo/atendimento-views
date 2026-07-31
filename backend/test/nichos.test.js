const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizarPatch, criarNicho, atualizarNicho } = require('../src/db/nichos')

function fakePool(rows = [], err = null) {
  const calls = []
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); if (err) throw err; return { rows } },
  }
}

test('normalizarPatch: nome obrigatorio na criacao', () => {
  assert.throws(() => normalizarPatch({}, { criar: true }), /nome e obrigatorio/)
})

test('normalizarPatch: nome vazio rejeitado na edicao', () => {
  assert.throws(() => normalizarPatch({ nome: '   ' }), /nao pode ser vazio/)
})

test('normalizarPatch: criterios precisa ser objeto', () => {
  assert.throws(() => normalizarPatch({ criterios: 'x' }), /criterios deve ser um objeto/)
})

test('normalizarPatch: ativo precisa ser booleano', () => {
  assert.throws(() => normalizarPatch({ ativo: 'sim' }), /ativo deve ser booleano/)
})

test('normalizarPatch: normaliza campos validos', () => {
  const v = normalizarPatch({ nome: '  Barbearia  ', descricao: '', criterios: { regiao: 'SP' }, ativo: false })
  assert.equal(v.nome, 'Barbearia')
  assert.equal(v.descricao, null)
  assert.deepEqual(v.criterios, { regiao: 'SP' })
  assert.equal(v.ativo, false)
})

test('criarNicho: nome duplicado vira 409 (traduz 23505)', async () => {
  const pool = fakePool([], Object.assign(new Error('dup'), { code: '23505' }))
  await assert.rejects(
    () => criarNicho(pool, 'emp1', { nome: 'Barbearia' }),
    (err) => err.statusCode === 409 && /Ja existe um nicho/.test(err.message)
  )
})

test('criarNicho: passa empresa_id como 1o parametro (isolamento)', async () => {
  const pool = fakePool([{ id: 'n1', nome: 'Barbearia' }])
  await criarNicho(pool, 'emp-abc', { nome: 'Barbearia' })
  assert.equal(pool.calls[0].params[0], 'emp-abc')
  assert.match(pool.calls[0].sql, /empresa_id/)
})

test('atualizarNicho: sem campos -> erro', async () => {
  const pool = fakePool([])
  await assert.rejects(() => atualizarNicho(pool, 'emp1', 'n1', {}), /Nada para atualizar/)
})

test('atualizarNicho: nao encontrado -> 404', async () => {
  const pool = fakePool([]) // UPDATE nao retornou linha (filtra empresa_id)
  await assert.rejects(
    () => atualizarNicho(pool, 'emp1', 'n-x', { nome: 'Novo' }),
    (err) => err.statusCode === 404
  )
})

test('atualizarNicho: WHERE filtra id + empresa_id', async () => {
  const pool = fakePool([{ id: 'n1', nome: 'Novo' }])
  await atualizarNicho(pool, 'emp1', 'n1', { nome: 'Novo' })
  assert.match(pool.calls[0].sql, /WHERE id = \$1 AND empresa_id = \$2/)
})
