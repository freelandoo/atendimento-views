const test = require('node:test')
const assert = require('node:assert/strict')

const { validarPergunta, registrarPergunta, removerPergunta } = require('../src/db/ligacao-perguntas')

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

test('validarPergunta: texto obrigatorio (trim)', () => {
  assert.throws(() => validarPergunta({ texto: '   ' }), /texto da pergunta obrigatorio/)
  assert.equal(validarPergunta({ texto: '  A decisao e sua?  ' }).texto, 'A decisao e sua?')
})

test('validarPergunta: etapa_tipo e indice validados', () => {
  assert.throws(() => validarPergunta({ texto: 'x', etapaTipo: 'nope' }), /etapa_tipo invalido/)
  assert.throws(() => validarPergunta({ texto: 'x', perguntaIndice: -1 }), /pergunta_indice invalido/)
  assert.throws(() => validarPergunta({ texto: 'x', perguntaIndice: 1.5 }), /pergunta_indice invalido/)
  const q = validarPergunta({ texto: 'x', etapaTipo: 'descoberta', perguntaIndice: 2 })
  assert.equal(q.etapaTipo, 'descoberta')
  assert.equal(q.perguntaIndice, 2)
  assert.equal(validarPergunta({ texto: 'x' }).perguntaIndice, null)
})

test('registrarPergunta: valida ANTES de tocar o banco', async () => {
  const pool = fakePool([])
  await assert.rejects(() => registrarPergunta(pool, 'emp1', 'lig1', { texto: '' }), /texto da pergunta obrigatorio/)
  assert.equal(pool.calls.length, 0)
})

test('registrarPergunta: ligacao inexistente => 404', async () => {
  await assert.rejects(() => registrarPergunta(fakePool(() => []), 'emp1', 'lig1', { texto: 'a' }),
    (err) => err.statusCode === 404)
})

test('registrarPergunta: ligacao nao em_andamento => 409 (nao insere)', async () => {
  const pool = fakePool((sql) => /FROM app\.ligacoes/.test(sql) ? [{ status: 'encerrada' }] : [])
  await assert.rejects(() => registrarPergunta(pool, 'emp1', 'lig1', { texto: 'a' }),
    (err) => err.statusCode === 409 && /nao esta em andamento/.test(err.message))
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('registrarPergunta: idempotente por client_event_id', async () => {
  const existente = { id: 'p1', texto_no_momento: 'a', status: 'realizada' }
  const pool = fakePool((sql) => {
    if (/FROM app\.ligacoes/.test(sql)) return [{ status: 'em_andamento' }]
    if (/FROM app\.roteiro_versoes/.test(sql) || /FROM app\.roteiro_etapas/.test(sql)) return [{ id: 'x' }]
    if (/SELECT[\s\S]*FROM app\.ligacao_perguntas WHERE empresa_id/.test(sql)) return [existente]
    return []
  })
  const r = await registrarPergunta(pool, 'emp1', 'lig1', { texto: 'a', clientEventId: 'ce1', roteiroVersaoId: 'v1', roteiroEtapaId: 'e1' })
  assert.equal(r.idempotente, true)
  assert.equal(r.id, 'p1')
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)))
})

test('removerPergunta: idempotente quando ja desmarcada; 404 se inexistente', async () => {
  const poolJa = fakePool((sql) => /UPDATE/.test(sql) ? [] : [{ id: 'p1' }])
  assert.equal((await removerPergunta(poolJa, 'emp1', 'lig1', 'p1')).ja_desmarcada, true)
  await assert.rejects(() => removerPergunta(fakePool(() => []), 'emp1', 'lig1', 'pX'),
    (err) => err.statusCode === 404)
})
