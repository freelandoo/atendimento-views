const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarEtapas, salvarEtapas, criarRoteiro,
} = require('../src/db/roteiros')

// Pool falso: devolve rows fixos e conta chamadas. connect() nao deve ser chamado nos
// caminhos testados (todos falham na validacao/guarda antes da transacao).
function fakePool(rows = []) {
  const calls = []
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return { rows } },
    connect() { throw new Error('connect() nao deveria ser chamado neste teste') },
  }
}

test('validarEtapas: rejeita tipo invalido', () => {
  assert.throws(() => validarEtapas([{ tipo: 'inexistente' }]), /tipo invalido/)
})

test('validarEtapas: rejeita ordem duplicada', () => {
  assert.throws(
    () => validarEtapas([{ tipo: 'abertura', ordem: 1 }, { tipo: 'situacao', ordem: 1 }]),
    /ordem duplicada/
  )
})

test('validarEtapas: rejeita nao-lista', () => {
  assert.throws(() => validarEtapas('nope'), /deve ser uma lista/)
})

test('validarEtapas: normaliza e preenche ordem implicita + arrays', () => {
  const out = validarEtapas([
    { tipo: 'abertura', titulo: 'Oi', perguntas: ['tudo bem?'] },
    { tipo: 'descoberta' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].ordem, 1)
  assert.equal(out[1].ordem, 2)
  assert.deepEqual(out[0].perguntas, ['tudo bem?'])
  assert.deepEqual(out[1].sinais_interesse, [])
  assert.equal(out[0].tipo, 'abertura')
})

test('validarEtapas: aceita todos os 11 tipos do enum', () => {
  const tipos = ['abertura', 'permissao', 'situacao', 'descoberta', 'problema', 'implicacao',
    'insight', 'qualificacao', 'objecoes', 'convite_reuniao', 'proxima_acao']
  const out = validarEtapas(tipos.map((t, i) => ({ tipo: t, ordem: i + 1 })))
  assert.equal(out.length, 11)
})

test('salvarEtapas: versao PUBLICADA e imutavel (409) — nao entra na transacao', async () => {
  const pool = fakePool([{ id: 'v1', status: 'publicada' }])
  await assert.rejects(
    () => salvarEtapas(pool, 'emp1', 'v1', [{ tipo: 'abertura' }]),
    (err) => err.statusCode === 409 && /imutavel/.test(err.message)
  )
})

test('salvarEtapas: versao inexistente/outro tenant (404)', async () => {
  const pool = fakePool([]) // SELECT nao achou (filtra empresa_id)
  await assert.rejects(
    () => salvarEtapas(pool, 'emp1', 'v-desconhecida', [{ tipo: 'abertura' }]),
    (err) => err.statusCode === 404 && /nao encontrada/.test(err.message)
  )
})

test('salvarEtapas: valida etapas ANTES de tocar o banco', async () => {
  const pool = fakePool([{ id: 'v1', status: 'rascunho' }])
  await assert.rejects(
    () => salvarEtapas(pool, 'emp1', 'v1', [{ tipo: 'xxx' }]),
    /tipo invalido/
  )
  assert.equal(pool.calls.length, 0, 'nao deve consultar o banco se as etapas sao invalidas')
})

test('criarRoteiro: nome obrigatorio', async () => {
  const pool = fakePool([])
  await assert.rejects(() => criarRoteiro(pool, 'emp1', { nome: '   ' }), /nome e obrigatorio/)
  assert.equal(pool.calls.length, 0)
})

test('salvarEtapas: SELECT de guarda filtra por empresa_id (isolamento)', async () => {
  const pool = fakePool([{ id: 'v1', status: 'publicada' }])
  await salvarEtapas(pool, 'emp1', 'v1', [{ tipo: 'abertura' }]).catch(() => {})
  assert.match(pool.calls[0].sql, /empresa_id = \$2/)
  assert.deepEqual(pool.calls[0].params, ['v1', 'emp1'])
})
