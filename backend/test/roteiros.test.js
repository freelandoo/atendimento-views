const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarEtapas, salvarEtapas, criarRoteiro, obterRoteiro, definirArquivamentoRoteiro,
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

// --- arquivamento do ROTEIRO (o cabecalho), que nao e' arquivar uma VERSAO -------------
// Mora em app.roteiros.ativo (migration 033). Nao ha status derivavel das versoes que sirva:
// publicarVersao arquiva a versao publicada anterior sozinha, entao quase todo roteiro
// saudavel tem versao arquivada sem estar arquivado.
test('definirArquivamentoRoteiro: arquivar grava ativo = false', async () => {
  const pool = fakePool([{ id: 'r1', nome: 'Abordagem fria', ativo: false }])
  const out = await definirArquivamentoRoteiro(pool, 'emp1', 'r1', true)
  assert.equal(out.arquivado, true)
  assert.equal(out.ativo, false)
  assert.deepEqual(pool.calls[0].params, ['r1', 'emp1', false])
})

test('definirArquivamentoRoteiro: desarquivar grava ativo = true', async () => {
  const pool = fakePool([{ id: 'r1', nome: 'Abordagem fria', ativo: true }])
  const out = await definirArquivamentoRoteiro(pool, 'emp1', 'r1', false)
  assert.equal(out.arquivado, false)
  assert.deepEqual(pool.calls[0].params, ['r1', 'emp1', true])
})

test('definirArquivamentoRoteiro: roteiro de outro tenant nao e encontrado (404)', async () => {
  const pool = fakePool([]) // UPDATE ... WHERE empresa_id = $2 nao afetou linha
  await assert.rejects(
    () => definirArquivamentoRoteiro(pool, 'emp1', 'r-de-outro', true),
    (err) => err.statusCode === 404 && /nao encontrado/.test(err.message)
  )
})

// Arquivar e' guardar, nao apagar: o UPDATE toca UMA coluna e nao encosta em versoes,
// etapas, ligacoes ou campanhas. As FKs de historico sao ON DELETE SET NULL — um DELETE
// aqui nao seria barrado pelo banco: desligaria em silencio as ligacoes ja realizadas.
test('definirArquivamentoRoteiro: nao apaga nada (so UPDATE escopado em app.roteiros)', async () => {
  const pool = fakePool([{ id: 'r1', nome: 'X', ativo: false }])
  await definirArquivamentoRoteiro(pool, 'emp1', 'r1', true)
  assert.equal(pool.calls.length, 1)
  assert.match(pool.calls[0].sql, /UPDATE app\.roteiros/)
  assert.match(pool.calls[0].sql, /WHERE id = \$1 AND empresa_id = \$2/)
  assert.ok(!/DELETE/i.test(pool.calls[0].sql))
})

test('o modulo nao exporta exclusao de roteiro (arquivar e a operacao segura)', () => {
  const R = require('../src/db/roteiros')
  const destrutivas = Object.keys(R).filter((k) => /excluir|remover|apagar|deletar/i.test(k))
  assert.deepEqual(destrutivas, [], `exclusao de roteiro nao deve existir: ${destrutivas}`)
})

// campanhas_usando alimenta o aviso do modal de arquivamento: campanha que ja usa o roteiro
// continua funcionando, e o operador precisa saber disso ANTES de confirmar.
test('obterRoteiro: conta campanhas que usam o roteiro, escopadas na empresa', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params })
      if (/FROM app\.roteiros r/.test(sql)) {
        return { rows: [{ id: 'r1', nome: 'X', ativo: true, campanhas_usando: 2 }] }
      }
      return { rows: [] }
    },
  }
  const out = await obterRoteiro(pool, 'emp1', 'r1')
  assert.equal(out.campanhas_usando, 2)
  assert.match(pool.calls[0].sql, /c\.empresa_id = \$2/)
})
