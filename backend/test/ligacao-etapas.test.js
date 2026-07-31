const test = require('node:test')
const assert = require('node:assert/strict')

const { obterEtapaAtiva, fecharEtapaAtiva, abrirEtapa, trocarEtapa, listarEtapas } = require('../src/db/ligacao-etapas')

function fakePool(byQuery = {}) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      const rows = typeof byQuery === 'function' ? byQuery(sql, params) : byQuery
      return { rows: rows || [] }
    },
    connect() { throw new Error('connect() nao deveria ser chamado neste teste') },
  }
}

test('obterEtapaAtiva: null quando nao ha ocorrencia ativa', async () => {
  assert.equal(await obterEtapaAtiva(fakePool([]), 'emp1', 'lig1'), null)
})

test('fecharEtapaAtiva: null quando nao havia ativa (idempotente)', async () => {
  assert.equal(await fecharEtapaAtiva(fakePool([]), 'emp1', 'lig1'), null)
})

test('abrirEtapa: ligacao inexistente => 404', async () => {
  await assert.rejects(() => abrirEtapa(fakePool(() => []), 'emp1', 'lig1', { roteiroEtapaId: 're1' }),
    (err) => err.statusCode === 404 && /nao encontrada/.test(err.message))
})

test('abrirEtapa: ligacao nao em_andamento => 409', async () => {
  const pool = fakePool((sql) => /FROM app\.ligacoes/.test(sql) ? [{ status: 'encerrada', roteiro_versao_id: 'v1' }] : [])
  await assert.rejects(() => abrirEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're1' }),
    (err) => err.statusCode === 409 && /nao esta em andamento/.test(err.message))
})

test('abrirEtapa: idempotente por client_event_id (devolve a mesma, sem INSERT)', async () => {
  const existente = { id: 'oc1', tipo_etapa: 'abertura', ordem_etapa: 0 }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento', roteiro_versao_id: 'v1' }]
    if (/WHERE empresa_id = \$1 AND client_event_id/.test(sql)) return [existente]
    return []
  })
  const r = await abrirEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're1', clientEventId: 'ce1' })
  assert.equal(r.idempotente, true)
  assert.equal(r.id, 'oc1')
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('abrirEtapa: se ja ha etapa ativa, devolve-a (nao abre 2a)', async () => {
  const ativa = { id: 'oc-ativa', tipo_etapa: 'situacao', saiu_em: null }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento', roteiro_versao_id: 'v1' }]
    if (/saiu_em IS NULL/.test(sql)) return [ativa]
    return []
  })
  const r = await abrirEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're1' })
  assert.equal(r.ja_ativa, true)
  assert.equal(r.id, 'oc-ativa')
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('abrirEtapa: etapa de outro roteiro/versao => 400 (nao pertence)', async () => {
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento', roteiro_versao_id: 'v1' }]
    if (/saiu_em IS NULL/.test(sql)) return [] // sem ativa
    if (/FROM app\.roteiro_etapas re JOIN/.test(sql)) return [{ id: 're1', tipo: 'abertura', ordem: 0, versao_id: 'OUTRA', roteiro_id: 'r1' }]
    return []
  })
  await assert.rejects(() => abrirEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're1' }),
    (err) => err.statusCode === 400 && /nao pertence ao roteiro/.test(err.message))
})

test('trocarEtapa: ligacao encerrada => 409 (nao troca)', async () => {
  const pool = fakePool((sql) => /FROM app\.ligacoes/.test(sql) ? [{ status: 'encerrada', roteiro_versao_id: 'v1' }] : [])
  await assert.rejects(() => trocarEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're2' }),
    (err) => err.statusCode === 409)
})

test('trocarEtapa: idempotente por client_event_id', async () => {
  const existente = { id: 'oc2', tipo_etapa: 'descoberta' }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento', roteiro_versao_id: 'v1' }]
    if (/WHERE empresa_id = \$1 AND client_event_id/.test(sql)) return [existente]
    return []
  })
  const r = await trocarEtapa(pool, 'emp1', 'lig1', { roteiroEtapaId: 're2', clientEventId: 'ce2' })
  assert.equal(r.idempotente, true)
  assert.equal(r.id, 'oc2')
})

test('listarEtapas: exige ligacao_id', async () => {
  await assert.rejects(() => listarEtapas(fakePool([]), 'emp1', null), /ligacao_id obrigatorio/)
})
