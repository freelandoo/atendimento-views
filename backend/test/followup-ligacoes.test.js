const test = require('node:test')
const assert = require('node:assert/strict')

const {
  registrarLigacao,
  metricasLigacoes,
  validarEnvioAposLigacao,
  RESULTADOS,
} = require('../src/db/followup-ligacoes')

// Pool falso: registra as queries e devolve respostas roteiradas por regex.
function fakePool(respostas = []) {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      for (const [re, rows] of respostas) {
        if (re.test(sql)) return { rows }
      }
      return { rows: [] }
    },
  }
}

test('resultado invalido e rejeitado', async () => {
  const pool = fakePool()
  await assert.rejects(
    () => registrarLigacao(pool, { empresaId: 'e1', numero: '55x', resultado: 'nada' }),
    (err) => err.statusCode === 400 && /resultado invalido/.test(err.message)
  )
})

test('numero vazio e rejeitado', async () => {
  const pool = fakePool()
  await assert.rejects(
    () => registrarLigacao(pool, { empresaId: 'e1', numero: '', resultado: 'atendeu' }),
    (err) => err.statusCode === 400 && /numero e obrigatorio/.test(err.message)
  )
})

test('sem_interesse tambem pausa o agente do lead', async () => {
  const pool = fakePool([[/INSERT INTO vendas\.followup_ligacoes/, [{ id: 1, resultado: 'sem_interesse' }]]])
  await registrarLigacao(pool, { empresaId: 'e1', numero: '5511999', resultado: 'sem_interesse' })
  assert.equal(pool.queries.length, 1, 'registro e pausa devem ocorrer em uma unica query atomica')
  assert.match(pool.queries[0].sql, /UPDATE vendas\.conversas/)
  assert.match(pool.queries[0].sql, /\$3::text = 'sem_interesse'/)
  assert.match(pool.queries[0].sql, /SET agente_pausado = true/)
})

test('atendeu NAO pausa o agente', async () => {
  const pool = fakePool([[/INSERT INTO vendas\.followup_ligacoes/, [{ id: 2, resultado: 'atendeu' }]]])
  await registrarLigacao(pool, { empresaId: 'e1', numero: '5511999', resultado: 'atendeu' })
  assert.equal(pool.queries[0].params[2], 'atendeu')
  assert.match(pool.queries[0].sql, /WHERE \$3::text = 'sem_interesse'/)
})

test('envio complementar so e permitido quando nao atendeu', () => {
  assert.doesNotThrow(() => validarEnvioAposLigacao('nao_atendeu', true))
  assert.doesNotThrow(() => validarEnvioAposLigacao('atendeu', false))
  for (const resultado of ['atendeu', 'agendou', 'sem_interesse', 'ligar_depois']) {
    assert.throws(
      () => validarEnvioAposLigacao(resultado, true),
      (err) => err.statusCode === 400 && /so pode ser enviado/.test(err.message)
    )
  }
})

test('metricas agregam total, hoje e taxa de agendamento', async () => {
  const pool = fakePool([[/FROM vendas\.followup_ligacoes/, [
    { resultado: 'atendeu', total: 6, hoje: 2 },
    { resultado: 'agendou', total: 4, hoje: 1 },
  ]]])
  const m = await metricasLigacoes(pool, 'e1', 30)
  assert.equal(m.total, 10)
  assert.equal(m.hoje, 3)
  assert.equal(m.por_resultado.agendou, 4)
  assert.equal(m.taxa_agendamento, 40) // 4/10
})

test('RESULTADOS expoe os 5 estados', () => {
  assert.deepEqual([...RESULTADOS].sort(), ['agendou', 'atendeu', 'ligar_depois', 'nao_atendeu', 'sem_interesse'])
})
