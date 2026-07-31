const test = require('node:test')
const assert = require('node:assert/strict')

const { estadoSessao, chamadaAberta, comEstado } = require('../src/db/ligacoes-estado')
const { assertChamadaAberta } = require('../src/db/ligacao-sessao-guard')

// ---------------------------------------------------------------------------------------
// Estado de NEGOCIO da sessao: 4 estados operacionais para 3 status no banco.
// 'aguardando_resumo' e' DERIVADO de chamada_encerrada_em (nao existe como status) — ver
// src/db/ligacoes-estado.js para a justificativa (indice parcial da migration 048).
// ---------------------------------------------------------------------------------------

test('estadoSessao: chamada acontecendo => em_andamento', () => {
  assert.equal(estadoSessao({ status: 'em_andamento', chamada_encerrada_em: null }), 'em_andamento')
})

test('estadoSessao: chamada terminou mas resumo pendente => aguardando_resumo', () => {
  assert.equal(estadoSessao({ status: 'em_andamento', chamada_encerrada_em: '2026-07-30T18:00:00Z' }), 'aguardando_resumo')
})

test('estadoSessao: terminais preservam o status', () => {
  assert.equal(estadoSessao({ status: 'encerrada', chamada_encerrada_em: '2026-07-30T18:00:00Z' }), 'encerrada')
  assert.equal(estadoSessao({ status: 'descartada', chamada_encerrada_em: null }), 'descartada')
})

test('estadoSessao: entrada invalida => null (nao inventa estado)', () => {
  assert.equal(estadoSessao(null), null)
  assert.equal(estadoSessao(undefined), null)
  assert.equal(estadoSessao({}), null)
})

// A regra que impede o bug relatado: uma sessao com resumo pendente NAO pode ser lida como
// conversa telefonica em andamento (era isso que fazia o cronometro reiniciar apos o refresh).
test('chamadaAberta: so em_andamento; aguardando_resumo NAO conta como chamada ativa', () => {
  assert.equal(chamadaAberta({ status: 'em_andamento', chamada_encerrada_em: null }), true)
  assert.equal(chamadaAberta({ status: 'em_andamento', chamada_encerrada_em: 'T1' }), false)
  assert.equal(chamadaAberta({ status: 'encerrada' }), false)
  assert.equal(chamadaAberta({ status: 'descartada' }), false)
})

test('comEstado: anexa estado_sessao e preserva o resto do payload', () => {
  const r = comEstado({ id: 'lig1', status: 'em_andamento', chamada_encerrada_em: 'T1', notas: 'oi' })
  assert.equal(r.estado_sessao, 'aguardando_resumo')
  assert.equal(r.id, 'lig1')
  assert.equal(r.notas, 'oi')
  assert.equal(comEstado(null), null)
})

// ---------------------------------------------------------------------------------------
// Guard de escrita de evento TEMPORAL (etapa/sinal/objecao/pergunta).
// ---------------------------------------------------------------------------------------
const poolCom = (row) => ({ async query() { return { rows: row ? [row] : [] } } })

test('assertChamadaAberta: chamada aberta => passa e devolve a linha', async () => {
  const r = await assertChamadaAberta(
    poolCom({ status: 'em_andamento', chamada_encerrada_em: null, roteiro_versao_id: 'rv1' }), 'emp1', 'lig1')
  assert.equal(r.roteiro_versao_id, 'rv1')
})

// O nucleo da correcao: depois de Encerrar ligacao o registro da conversa fecha.
test('assertChamadaAberta: aguardando_resumo => 409 (nao aceita evento temporal novo)', async () => {
  await assert.rejects(
    () => assertChamadaAberta(poolCom({ status: 'em_andamento', chamada_encerrada_em: 'T1' }), 'emp1', 'lig1'),
    (err) => err.statusCode === 409 && /chamada ja foi encerrada/.test(err.message))
})

test('assertChamadaAberta: encerrada/descartada => 409', async () => {
  for (const status of ['encerrada', 'descartada']) {
    await assert.rejects(
      () => assertChamadaAberta(poolCom({ status, chamada_encerrada_em: null }), 'emp1', 'lig1'),
      (err) => err.statusCode === 409 && /nao esta em andamento/.test(err.message))
  }
})

// Isolamento por empresa: a query filtra empresa_id, entao outro tenant nao acha a linha.
test('assertChamadaAberta: ligacao de outra empresa => 404', async () => {
  await assert.rejects(() => assertChamadaAberta(poolCom(null), 'emp2', 'lig1'),
    (err) => err.statusCode === 404 && /nao encontrada/.test(err.message))
})

test('assertChamadaAberta: sem ligacao_id => 400', async () => {
  await assert.rejects(() => assertChamadaAberta(poolCom(null), 'emp1', null),
    (err) => err.statusCode === 400)
})

test('assertChamadaAberta: filtra por empresa_id na query (isolamento de tenant)', async () => {
  let visto = null
  const pool = { async query(sql, params) { visto = { sql, params }; return { rows: [{ status: 'em_andamento', chamada_encerrada_em: null }] } } }
  await assertChamadaAberta(pool, 'emp1', 'lig1')
  assert.match(visto.sql, /empresa_id = \$2/)
  assert.deepEqual(visto.params, ['lig1', 'emp1'])
})
