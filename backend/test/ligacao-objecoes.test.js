const test = require('node:test')
const assert = require('node:assert/strict')

const { validarObjecao, registrarObjecao, atualizarObjecao, removerObjecao } = require('../src/db/ligacao-objecoes')

function fakePool(byQuery = {}) {
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

test('validarObjecao: texto obrigatorio; origem default; origem invalida barra', () => {
  assert.throws(() => validarObjecao({ texto: '  ' }), /texto da objecao obrigatorio/)
  assert.equal(validarObjecao({ texto: 'Ta caro' }).origem, 'novo_durante_ligacao')
  assert.throws(() => validarObjecao({ texto: 'x', origem: 'zzz' }), /origem de objecao invalida/)
})

test('validarObjecao: normaliza resposta e valida etapa_tipo', () => {
  const o = validarObjecao({ texto: '  Sem tempo  ', respostaUtilizada: '  Mostrei ROI  ', etapaTipo: 'objecoes', origem: 'roteiro' })
  assert.equal(o.texto, 'Sem tempo')
  assert.equal(o.respostaUtilizada, 'Mostrei ROI')
  assert.equal(o.etapaTipo, 'objecoes')
  assert.throws(() => validarObjecao({ texto: 'x', etapaTipo: 'nope' }), /etapa_tipo invalido/)
  assert.equal(validarObjecao({ texto: 'x' }).respostaUtilizada, null)
})

test('registrarObjecao: valida ANTES de tocar o banco', async () => {
  const pool = fakePool([])
  await assert.rejects(() => registrarObjecao(pool, 'emp1', 'lig1', { texto: '', origem: 'zzz' }), /origem de objecao invalida/)
  assert.equal(pool.calls.length, 0)
})

test('registrarObjecao: ligacao inexistente => 404', async () => {
  const pool = fakePool(() => [])
  await assert.rejects(() => registrarObjecao(pool, 'emp1', 'lig1', { texto: 'a' }),
    (err) => err.statusCode === 404)
})

test('registrarObjecao: ligacao nao em_andamento => 409 (nao insere)', async () => {
  const pool = fakePool((sql) => /FROM app\.ligacoes/.test(sql) ? [{ status: 'descartada' }] : [])
  await assert.rejects(() => registrarObjecao(pool, 'emp1', 'lig1', { texto: 'a' }),
    (err) => err.statusCode === 409 && /nao esta em andamento/.test(err.message))
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('registrarObjecao: idempotente por client_event_id', async () => {
  const existente = { id: 'obj1', texto_objecao: 'a', origem: 'roteiro' }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento' }]
    if (/FROM app\.roteiro_versoes/.test(sql) || /FROM app\.roteiro_etapas/.test(sql)) return [{ id: 'x' }]
    if (/SELECT[\s\S]*FROM app\.ligacao_objecoes WHERE empresa_id/.test(sql)) return [existente]
    return []
  })
  const r = await registrarObjecao(pool, 'emp1', 'lig1', { texto: 'a', clientEventId: 'ce1', roteiroVersaoId: 'v1', roteiroEtapaId: 'e1' })
  assert.equal(r.idempotente, true)
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('atualizarObjecao: resolvida seta resolvida_em (COALESCE) e RETORNA a linha', async () => {
  const captura = []
  const pool = fakePool((sql) => { captura.push(sql); return /UPDATE/.test(sql) ? [{ id: 'obj1', resolvida: true }] : [] })
  const r = await atualizarObjecao(pool, 'emp1', 'lig1', 'obj1', { resolvida: true, respostaUtilizada: 'ROI' })
  assert.equal(r.resolvida, true)
  assert.ok(captura.some((s) => /resolvida_em = COALESCE\(resolvida_em, NOW\(\)\)/.test(s)))
  assert.ok(captura.some((s) => /resposta_utilizada = \$/.test(s)))
})

test('atualizarObjecao: desmarcar resolvida limpa resolvida_em', async () => {
  const captura = []
  const pool = fakePool((sql) => { captura.push(sql); return /UPDATE/.test(sql) ? [{ id: 'obj1', resolvida: false }] : [] })
  await atualizarObjecao(pool, 'emp1', 'lig1', 'obj1', { resolvida: false })
  assert.ok(captura.some((s) => /resolvida_em = NULL/.test(s)))
})

test('atualizarObjecao: nada para atualizar => 400; inexistente => 404', async () => {
  await assert.rejects(() => atualizarObjecao(fakePool([]), 'emp1', 'lig1', 'obj1', {}), /Nada para atualizar/)
  const pool404 = fakePool(() => []) // UPDATE nao retorna linha
  await assert.rejects(() => atualizarObjecao(pool404, 'emp1', 'lig1', 'objX', { resolvida: true }),
    (err) => err.statusCode === 404)
})

test('removerObjecao: idempotente quando ja removida; 404 se inexistente', async () => {
  const poolJa = fakePool((sql) => /UPDATE/.test(sql) ? [] : [{ id: 'obj1' }])
  assert.equal((await removerObjecao(poolJa, 'emp1', 'lig1', 'obj1')).ja_removida, true)
  await assert.rejects(() => removerObjecao(fakePool(() => []), 'emp1', 'lig1', 'objX'),
    (err) => err.statusCode === 404)
})
