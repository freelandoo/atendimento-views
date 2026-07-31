const test = require('node:test')
const assert = require('node:assert/strict')

const { validarSinal, registrarSinal, removerSinal } = require('../src/db/ligacao-sinais')

function fakePool(byQuery = {}) {
  // byQuery: funcao(sql, params) => rows  (ou array fixo). Registra as chamadas.
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      const rows = typeof byQuery === 'function' ? byQuery(sql, params) : byQuery
      return { rows: rows || [] }
    },
    connect() { throw new Error('connect() nao deveria ser chamado') },
  }
}

test('validarSinal: tipo obrigatorio/valido', () => {
  assert.throws(() => validarSinal({ texto: 'x' }), /tipo de sinal invalido/)
  assert.throws(() => validarSinal({ tipo: 'zzz', texto: 'x' }), /tipo de sinal invalido/)
})

test('validarSinal: origem default = novo_durante_ligacao; invalida barra', () => {
  assert.equal(validarSinal({ tipo: 'interesse', texto: 'quer preco' }).origem, 'novo_durante_ligacao')
  assert.equal(validarSinal({ tipo: 'interesse', texto: 'x', origem: 'roteiro' }).origem, 'roteiro')
  assert.throws(() => validarSinal({ tipo: 'interesse', texto: 'x', origem: 'zzz' }), /origem de sinal invalida/)
})

test('validarSinal: texto obrigatorio (trim) e etapa_tipo validado quando informado', () => {
  assert.throws(() => validarSinal({ tipo: 'resistencia', texto: '   ' }), /texto do sinal obrigatorio/)
  assert.throws(() => validarSinal({ tipo: 'resistencia', texto: 'x', etapaTipo: 'nope' }), /etapa_tipo invalido/)
  const s = validarSinal({ tipo: 'resistencia', texto: '  achou caro  ', etapaTipo: 'objecoes' })
  assert.equal(s.texto, 'achou caro')
  assert.equal(s.etapaTipo, 'objecoes')
})

test('registrarSinal: valida ANTES de tocar o banco (nao consulta ligacao)', async () => {
  const pool = fakePool([])
  await assert.rejects(() => registrarSinal(pool, 'emp1', 'lig1', { tipo: 'x', texto: 'a' }), /tipo de sinal invalido/)
  assert.equal(pool.calls.length, 0)
})

test('registrarSinal: ligacao inexistente => 404', async () => {
  const pool = fakePool(() => []) // SELECT status nao acha
  await assert.rejects(() => registrarSinal(pool, 'emp1', 'lig1', { tipo: 'interesse', texto: 'a' }),
    (err) => err.statusCode === 404 && /nao encontrada/.test(err.message))
})

test('registrarSinal: ligacao nao em_andamento => 409 (nao insere)', async () => {
  const pool = fakePool((sql) => /FROM app\.ligacoes/.test(sql) ? [{ status: 'encerrada' }] : [])
  await assert.rejects(() => registrarSinal(pool, 'emp1', 'lig1', { tipo: 'interesse', texto: 'a' }),
    (err) => err.statusCode === 409 && /nao esta em andamento/.test(err.message))
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)), 'nunca inseriu')
})

test('registrarSinal: idempotente por client_event_id (nao insere de novo)', async () => {
  const existente = { id: 'sin1', tipo: 'interesse', texto: 'a', origem: 'roteiro' }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento' }]
    if (/FROM app\.roteiro_versoes/.test(sql) || /FROM app\.roteiro_etapas/.test(sql)) return [{ id: 'x' }] // same-tenant ok
    if (/SELECT[\s\S]*FROM app\.ligacao_sinais WHERE empresa_id/.test(sql)) return [existente]
    return []
  })
  const r = await registrarSinal(pool, 'emp1', 'lig1', { tipo: 'interesse', texto: 'a', clientEventId: 'ce1', roteiroVersaoId: 'v1', roteiroEtapaId: 'e1' })
  assert.equal(r.idempotente, true)
  assert.equal(r.id, 'sin1')
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)), 'idempotente: nao inseriu')
})

test('removerSinal: idempotente quando ja removido; 404 se inexistente', async () => {
  // UPDATE nao afeta nada; existe (chk acha) => ja_removido
  const poolJa = fakePool((sql) => /UPDATE/.test(sql) ? [] : [{ id: 'sin1' }])
  const r = await removerSinal(poolJa, 'emp1', 'lig1', 'sin1')
  assert.equal(r.ja_removido, true)
  // UPDATE nao afeta e chk tambem nao acha => 404
  const pool404 = fakePool(() => [])
  await assert.rejects(() => removerSinal(pool404, 'emp1', 'lig1', 'sinX'),
    (err) => err.statusCode === 404)
})
