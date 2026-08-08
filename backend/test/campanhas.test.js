const test = require('node:test')
const assert = require('node:assert/strict')

const {
  assertMesmaEmpresa, assertRoteiroVersaoUtilizavel,
  criarCampanha, atualizarCampanha, atualizarLead, adicionarLeads,
} = require('../src/db/campanhas')

function fakePool(rows = []) {
  const calls = []
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows } } }
}

// Pool por padrao de SQL: os caminhos com roteiro passam por consultas DIFERENTES
// (assertMesmaEmpresa e depois a guarda de arquivamento), entao um unico `rows` fixo nao serve.
function poolPorSql(regras) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      for (const [padrao, rows] of regras) if (padrao.test(sql)) return { rows }
      return { rows: [] }
    },
  }
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

// --- roteiro ARQUIVADO nao entra em campanha nova ------------------------------------
// A tela promete que arquivar nao interrompe nada em andamento e so' impede adocao NOVA.
// Estes testes sao o lado de dados dessa promessa: sem eles, "arquivado" seria so' um rotulo.
test('assertRoteiroVersaoUtilizavel: versao de roteiro ARQUIVADO -> 409', async () => {
  const pool = poolPorSql([[/FROM app\.roteiro_versoes v/, [{ ativo: false }]]])
  await assert.rejects(
    () => assertRoteiroVersaoUtilizavel(pool, 'emp1', 'v-arquivado'),
    (err) => err.statusCode === 409 && /arquivado/i.test(err.message)
  )
})

test('assertRoteiroVersaoUtilizavel: versao de roteiro ATIVO passa', async () => {
  const pool = poolPorSql([[/FROM app\.roteiro_versoes v/, [{ ativo: true }]]])
  await assertRoteiroVersaoUtilizavel(pool, 'emp1', 'v-ok')
})

test('assertRoteiroVersaoUtilizavel: sem id nao consulta (no-op)', async () => {
  const pool = fakePool([])
  await assertRoteiroVersaoUtilizavel(pool, 'emp1', null)
  assert.equal(pool.calls.length, 0)
})

// Quem barra versao inexistente/de outro tenant e' assertMesmaEmpresa, que roda antes.
// Esta guarda cala de proposito para nao dar dois erros diferentes para a mesma causa.
test('assertRoteiroVersaoUtilizavel: versao inexistente e silencio (quem barra e assertMesmaEmpresa)', async () => {
  const pool = poolPorSql([])
  await assertRoteiroVersaoUtilizavel(pool, 'emp1', 'v-inexistente')
})

test('assertRoteiroVersaoUtilizavel: consulta escopada na empresa (isolamento)', async () => {
  const pool = poolPorSql([[/FROM app\.roteiro_versoes v/, [{ ativo: true }]]])
  await assertRoteiroVersaoUtilizavel(pool, 'emp1', 'v1')
  assert.match(pool.calls[0].sql, /v\.empresa_id = \$2/)
  assert.deepEqual(pool.calls[0].params, ['v1', 'emp1'])
})

test('criarCampanha: roteiro arquivado e barrado ANTES do INSERT', async () => {
  const pool = poolPorSql([
    [/^SELECT 1 FROM app\.roteiro_versoes/, [{ id: 'v1' }]], // assertMesmaEmpresa
    [/JOIN app\.roteiros r/, [{ ativo: false }]],                                     // guarda
  ])
  await assert.rejects(
    () => criarCampanha(pool, 'emp1', { nome: 'C', roteiro_versao_id: 'v1' }),
    (err) => err.statusCode === 409 && /arquivado/i.test(err.message)
  )
  assert.ok(pool.calls.every((c) => !/INSERT/.test(c.sql)), 'nao pode chegar ao INSERT')
})

test('atualizarCampanha: nao aceita TROCAR para um roteiro arquivado', async () => {
  const pool = poolPorSql([
    [/^SELECT 1 FROM app\.roteiro_versoes/, [{ id: 'v1' }]],
    [/JOIN app\.roteiros r/, [{ ativo: false }]],
  ])
  await assert.rejects(
    () => atualizarCampanha(pool, 'emp1', 'c1', { roteiro_versao_id: 'v1' }),
    (err) => err.statusCode === 409 && /arquivado/i.test(err.message)
  )
  assert.ok(pool.calls.every((c) => !/UPDATE/.test(c.sql)), 'nao pode chegar ao UPDATE')
})

test('adicionarLeads: sem ids -> 0 (nao consulta insert)', async () => {
  const pool = fakePool([])
  // assertMesmaEmpresa da campanha roda 1 SELECT (retorna [] -> barraria); usamos campanha valida:
  const pool2 = { calls: [], async query(sql) { this.calls.push({ sql }); return { rows: /campanhas/.test(sql) ? [{ x: 1 }] : [] } } }
  const r = await adicionarLeads(pool2, 'emp1', 'c1', [])
  assert.equal(r.adicionados, 0)
})
