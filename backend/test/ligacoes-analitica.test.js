const test = require('node:test')
const assert = require('node:assert/strict')

const { listarLigacoesEncerradas } = require('../src/db/ligacoes-analitica')
const { registrarAuditoria, listarAuditoria } = require('../src/db/auditoria')

function fakePool(onQuery) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (typeof onQuery === 'function') return onQuery(sql, params)
      return { rows: [] }
    },
  }
}
function throwingPool() {
  return { async query() { throw new Error('db down') } }
}

test('listarLigacoesEncerradas: le a VIEW (nao a tabela) e filtra empresa', async () => {
  const pool = fakePool(() => ({ rows: [{ ligacao_id: 'l1' }] }))
  const r = await listarLigacoesEncerradas(pool, 'emp1', {})
  assert.equal(r.length, 1)
  assert.match(pool.calls[0].sql, /FROM app\.vw_ligacoes_analiticas/)
  assert.match(pool.calls[0].sql, /empresa_id = \$1/)
  assert.equal(pool.calls[0].params[0], 'emp1')
})

test('listarLigacoesEncerradas: aplica filtro de campanha', async () => {
  const pool = fakePool(() => ({ rows: [] }))
  await listarLigacoesEncerradas(pool, 'emp1', { campanhaId: 'c1', limit: 10 })
  assert.match(pool.calls[0].sql, /campanha_id = \$2/)
  assert.deepEqual(pool.calls[0].params.slice(0, 2), ['emp1', 'c1'])
})

test('registrarAuditoria: grava e retorna o evento', async () => {
  const pool = fakePool(() => ({ rows: [{ id: 'a1', ocorrido_em: 'now' }] }))
  const r = await registrarAuditoria(pool, 'emp1', { entidadeTipo: 'ligacao', entidadeId: 'l1', acao: 'ligacao_iniciada', estadoNovo: 'em_andamento' })
  assert.equal(r.id, 'a1')
  assert.match(pool.calls[0].sql, /INSERT INTO app\.auditoria_eventos/)
})

test('registrarAuditoria: BEST-EFFORT — falha do banco NAO propaga (retorna null)', async () => {
  const r = await registrarAuditoria(throwingPool(), 'emp1', { entidadeTipo: 'ligacao', acao: 'ligacao_encerrada' })
  assert.equal(r, null) // nao lancou
})

test('registrarAuditoria: campos obrigatorios ausentes => no-op (nao consulta)', async () => {
  const pool = fakePool()
  assert.equal(await registrarAuditoria(pool, 'emp1', { entidadeTipo: 'ligacao' }), null) // sem acao
  assert.equal(await registrarAuditoria(pool, null, { entidadeTipo: 'ligacao', acao: 'x' }), null) // sem empresa
  assert.equal(pool.calls.length, 0)
})

test('registrarAuditoria: contexto vira JSON string', async () => {
  const pool = fakePool(() => ({ rows: [{ id: 'a1' }] }))
  await registrarAuditoria(pool, 'emp1', { entidadeTipo: 'ligacao', entidadeId: 'l1', acao: 'ligacao_descartada', contexto: { motivo: 'teste' } })
  const ctxParam = pool.calls[0].params[7]
  assert.equal(typeof ctxParam, 'string')
  assert.deepEqual(JSON.parse(ctxParam), { motivo: 'teste' })
})

test('listarAuditoria: filtra por entidade e empresa', async () => {
  const pool = fakePool(() => ({ rows: [] }))
  await listarAuditoria(pool, 'emp1', { entidadeTipo: 'ligacao', entidadeId: 'l1' })
  assert.match(pool.calls[0].sql, /FROM app\.auditoria_eventos/)
  assert.match(pool.calls[0].sql, /entidade_tipo = \$2/)
  assert.match(pool.calls[0].sql, /entidade_id = \$3/)
})
