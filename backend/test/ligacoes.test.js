const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarRegistro, derivarEtapasDeSinais, transicaoValida,
  encerrarLigacao, descartarLigacao, obterLigacao, atualizarNotas, marcarChamadaEncerrada,
} = require('../src/db/ligacoes')

function fakePool(rows = []) {
  const calls = []
  return {
    calls,
    async query(sql, params) { calls.push({ sql, params }); return { rows } },
    connect() { throw new Error('connect() nao deveria ser chamado neste teste') },
  }
}

test('validarRegistro: resultado obrigatorio/valido', () => {
  assert.throws(() => validarRegistro({}), /resultado invalido/)
  assert.throws(() => validarRegistro({ resultado: 'xxx' }), /resultado invalido/)
})

test('validarRegistro: motivo_perda invalido', () => {
  assert.throws(() => validarRegistro({ resultado: 'atendeu', motivoPerda: 'nao_existe' }), /motivo_perda invalido/)
})

test('validarRegistro: etapa_alcancada invalida', () => {
  assert.throws(() => validarRegistro({ resultado: 'atendeu', etapaAlcancada: 'zzz' }), /etapa_alcancada invalido/)
})

test('validarRegistro: status de oportunidade invalido', () => {
  assert.throws(() => validarRegistro({ resultado: 'atendeu', novoStatusOportunidade: 'zzz' }), /status de oportunidade invalido/)
})

test('validarRegistro: caso valido nao lanca', () => {
  assert.doesNotThrow(() => validarRegistro({
    resultado: 'atendeu', motivoPerda: null, etapaAlcancada: 'descoberta', novoStatusOportunidade: 'qualificado',
  }))
})

// --- Unificacao das marcas: interesse/resistencia derivam dos SINAIS ------------------
test('derivarEtapasDeSinais: pega a ULTIMA etapa de cada tipo (ordem cronologica)', () => {
  const r = derivarEtapasDeSinais([
    { tipo: 'interesse', etapa_tipo: 'abertura' },
    { tipo: 'resistencia', etapa_tipo: 'situacao' },
    { tipo: 'interesse', etapa_tipo: 'qualificacao' },
  ])
  assert.equal(r.etapaMaiorInteresse, 'qualificacao')
  assert.equal(r.etapaPerdaInteresse, 'situacao')
})

test('derivarEtapasDeSinais: sem sinais => null nos dois campos', () => {
  const r = derivarEtapasDeSinais([])
  assert.equal(r.etapaMaiorInteresse, null)
  assert.equal(r.etapaPerdaInteresse, null)
})

test('derivarEtapasDeSinais: ignora sinal sem etapa_tipo ou com etapa invalida', () => {
  const r = derivarEtapasDeSinais([
    { tipo: 'interesse', etapa_tipo: 'abertura' },
    { tipo: 'interesse', etapa_tipo: null },
    { tipo: 'interesse', etapa_tipo: 'etapa_que_nao_existe' },
  ])
  assert.equal(r.etapaMaiorInteresse, 'abertura')
})

// --- Fatia A: maquina de estados da sessao ------------------------------------------
test('transicaoValida: em_andamento -> encerrada|descartada; terminais nao voltam', () => {
  assert.equal(transicaoValida('em_andamento', 'encerrada'), true)
  assert.equal(transicaoValida('em_andamento', 'descartada'), true)
  assert.equal(transicaoValida('encerrada', 'em_andamento'), false)
  assert.equal(transicaoValida('descartada', 'em_andamento'), false)
  assert.equal(transicaoValida('encerrada', 'descartada'), false)
  assert.equal(transicaoValida('descartada', 'encerrada'), false)
  assert.equal(transicaoValida('inexistente', 'encerrada'), false)
})

test('obterLigacao: sem registro no tenant => 404', async () => {
  await assert.rejects(() => obterLigacao(fakePool([]), 'emp1', 'lig1'),
    (err) => err.statusCode === 404 && /nao encontrada/.test(err.message))
})

test('encerrarLigacao: ja encerrada => idempotente (nao reprocessa, nao grava nada)', async () => {
  const pool = fakePool([{ id: 'lig1', status: 'encerrada', duracao_seg: 42 }])
  const r = await encerrarLigacao(pool, 'emp1', 'lig1', { resultado: 'atendeu' })
  assert.equal(r.ja_encerrada, true)
  assert.ok(pool.calls.every((c) => !/INSERT|UPDATE/.test(c.sql)), 'idempotente: nao grava nada')
})

test('encerrarLigacao: ligacao descartada nao pode ser encerrada => 409', async () => {
  const pool = fakePool([{ id: 'lig1', status: 'descartada' }])
  await assert.rejects(() => encerrarLigacao(pool, 'emp1', 'lig1', { resultado: 'atendeu' }),
    (err) => err.statusCode === 409 && /descartada nao pode ser encerrada/.test(err.message))
})

test('descartarLigacao: ligacao encerrada nao pode ser descartada => 409', async () => {
  const pool = fakePool([{ id: 'lig1', status: 'encerrada' }])
  await assert.rejects(() => descartarLigacao(pool, 'emp1', 'lig1', {}),
    (err) => err.statusCode === 409 && /encerrada nao pode ser descartada/.test(err.message))
})

test('descartarLigacao: ja descartada => idempotente', async () => {
  const pool = fakePool([{ id: 'lig1', status: 'descartada' }])
  const r = await descartarLigacao(pool, 'emp1', 'lig1', {})
  assert.equal(r.ja_descartada, true)
  assert.ok(pool.calls.every((c) => !/UPDATE/.test(c.sql)), 'idempotente: nao atualiza')
})

// --- Fatia F: registro rapido incremental (notas) ----------------------------------
// Pool por SEQUENCIA de chamadas (determinístico): 1a = UPDATE, 2a = obterLigacao (SELECT).
function seqPool(sequence) {
  let i = 0
  return { async query() { return { rows: sequence[i++] || [] } }, connect() { throw new Error('sem tx') } }
}

test('atualizarNotas: em_andamento => grava e retorna a nota', async () => {
  const r = await atualizarNotas(seqPool([[{ id: 'lig1', notas: 'oi' }]]), 'emp1', 'lig1', 'oi')
  assert.equal(r.notas, 'oi')
})

test('atualizarNotas: ligacao ja encerrada => 409', async () => {
  const pool = seqPool([[], [{ id: 'lig1', status: 'encerrada' }]]) // UPDATE vazio, depois SELECT encerrada
  await assert.rejects(() => atualizarNotas(pool, 'emp1', 'lig1', 'x'),
    (err) => err.statusCode === 409 && /nao aceita edicao de notas/.test(err.message))
})

test('atualizarNotas: ligacao inexistente => 404', async () => {
  const pool = seqPool([[], []]) // UPDATE vazio + obterLigacao vazio
  await assert.rejects(() => atualizarNotas(pool, 'emp1', 'ligX', 'x'),
    (err) => err.statusCode === 404)
})

// --- Fim da chamada separado do momento do save (migration 049) ----------------------
// marcarChamadaEncerrada passou a rodar em TRANSACAO (marca o instante E fecha a etapa ativa
// juntos), entao precisa de um pool com connect(). BEGIN/COMMIT/ROLLBACK nao consomem a fila.
function seqTxPool(sequence) {
  let i = 0
  const calls = []
  const query = async (sql, params) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] }
    calls.push({ sql, params })
    return { rows: sequence[i++] || [] }
  }
  const client = { query, release() { } }
  return { calls, query, async connect() { return client } }
}

// A transacao passou a comecar por um SELECT ... FOR UPDATE do valor ANTERIOR, para o
// chamador distinguir o PRIMEIRO clique do repetido (`ja_marcada`) — e' o que impede a
// auditoria de registrar uma transicao por clique e o que serializa duas sessoes da mesma
// conta clicando quase juntas. Por isso a fila destes testes comeca com essa leitura.
const ANTES_SEM_FIM = [{ chamada_encerrada_em: null }]

test('marcarChamadaEncerrada: em_andamento => grava o instante do fim da chamada', async () => {
  const pool = seqTxPool([
    ANTES_SEM_FIM,
    [{ id: 'lig1', status: 'em_andamento', iniciada_em: 'T0', chamada_encerrada_em: 'T1' }],
    [{ id: 'etapa1' }],
  ])
  const r = await marcarChamadaEncerrada(pool, 'emp1', 'lig1')
  assert.equal(r.chamada_encerrada_em, 'T1')
  assert.equal(r.ja_marcada, false)
})

// A transicao de negocio em_andamento -> aguardando_resumo acontece AQUI, sem mudar o status.
test('marcarChamadaEncerrada: devolve estado_sessao aguardando_resumo (status segue em_andamento)', async () => {
  const pool = seqTxPool([
    ANTES_SEM_FIM,
    [{ id: 'lig1', status: 'em_andamento', iniciada_em: 'T0', chamada_encerrada_em: 'T1' }],
    [{ id: 'etapa1' }],
  ])
  const r = await marcarChamadaEncerrada(pool, 'emp1', 'lig1')
  assert.equal(r.status, 'em_andamento', 'o status no banco NAO muda')
  assert.equal(r.estado_sessao, 'aguardando_resumo')
})

// Vale o PRIMEIRO clique: um 2o Encerrar nao pode empurrar o fim da chamada para frente
// (senao o tempo de preenchimento do resumo entraria na duracao).
test('marcarChamadaEncerrada: idempotente por COALESCE (1o clique define o fim da chamada)', async () => {
  const pool = seqTxPool([
    ANTES_SEM_FIM,
    [{ id: 'lig1', status: 'em_andamento', iniciada_em: 'T0', chamada_encerrada_em: 'T1' }],
    [],
  ])
  await marcarChamadaEncerrada(pool, 'emp1', 'lig1')
  const upd = pool.calls.find((c) => /UPDATE app\.ligacoes/.test(c.sql))
  assert.match(upd.sql, /chamada_encerrada_em = COALESCE\(chamada_encerrada_em, NOW\(\)\)/,
    'sem COALESCE, o 2o clique sobrescreveria o fim da chamada')
})

// A etapa ativa tem de fechar no MESMO instante do fim da chamada — nao em NOW().
test('marcarChamadaEncerrada: fecha a etapa ativa no instante do fim da chamada', async () => {
  const pool = seqTxPool([
    ANTES_SEM_FIM,
    [{ id: 'lig1', status: 'em_andamento', iniciada_em: 'T0', chamada_encerrada_em: 'T1' }],
    [{ id: 'etapa1' }],
  ])
  await marcarChamadaEncerrada(pool, 'emp1', 'lig1')
  const fech = pool.calls.find((c) => /UPDATE app\.ligacao_etapas/.test(c.sql))
  assert.ok(fech, 'deve fechar a ocorrencia temporal ativa na mesma transacao')
  assert.equal(fech.params[2], 'T1', 'o momento do fechamento e o fim da chamada, nao NOW()')
})

test('marcarChamadaEncerrada: ligacao ja encerrada => 409', async () => {
  const pool = seqTxPool([[], [], [{ id: 'lig1', status: 'encerrada' }]]) // antes, UPDATE vazio, SELECT
  await assert.rejects(() => marcarChamadaEncerrada(pool, 'emp1', 'lig1'),
    (err) => err.statusCode === 409 && /nao aceita marcar fim de chamada/.test(err.message))
})

test('marcarChamadaEncerrada: ligacao inexistente => 404', async () => {
  await assert.rejects(() => marcarChamadaEncerrada(seqTxPool([[], [], []]), 'emp1', 'ligX'),
    (err) => err.statusCode === 404)
})
