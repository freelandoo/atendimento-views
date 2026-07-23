'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const router = require('../src/routes/api-whatsapp')

const {
  calcularResumoConexao,
  obterResumoConexao,
  invalidarResumoConexao,
  duplicarContexto,
  limparReferenciasInstanciaRemovida,
} = router

test('calcularResumoConexao consulta instancias em paralelo', async () => {
  let ativas = 0
  let maxAtivas = 0
  const verificarStatus = async (nome) => {
    ativas += 1
    maxAtivas = Math.max(maxAtivas, ativas)
    await new Promise((resolve) => setTimeout(resolve, 10))
    ativas -= 1
    return { connected: nome !== 'desconectada' }
  }

  const data = await calcularResumoConexao([
    { id: 'i1', evolution_instance: 'a' },
    { id: 'i2', evolution_instance: 'desconectada' },
    { id: 'i3', evolution_instance: 'c' },
  ], verificarStatus)

  assert.equal(maxAtivas, 3)
  assert.equal(data.total, 3)
  assert.equal(data.desconectadas, 1)
  assert.equal(data.desconhecidas, 0)
  assert.equal(data.alguma_desconectada, true)
  assert.equal(data.alguma_indisponivel, true)
  assert.deepStrictEqual(
    data.instancias.map(({ id, evolution_instance, connected, state, can_send }) => ({
      id, evolution_instance, connected, state, can_send,
    })),
    [
      { id: 'i1', evolution_instance: 'a', connected: true, state: 'unknown', can_send: true },
      { id: 'i2', evolution_instance: 'desconectada', connected: false, state: 'unknown', can_send: false },
      { id: 'i3', evolution_instance: 'c', connected: true, state: 'unknown', can_send: true },
    ]
  )
  assert.ok(data.instancias.every((i) => i.last_checked_at))
})

test('calcularResumoConexao trata status desconhecido como indisponivel', async () => {
  const data = await calcularResumoConexao([
    { id: 'i1', evolution_instance: 'open' },
    { id: 'i2', evolution_instance: 'unknown' },
  ], async (nome) => nome === 'unknown'
    ? { connected: null, state: 'unknown', motivo: 'Evolution indisponivel' }
    : { connected: true, state: 'open' })

  assert.equal(data.desconectadas, 0)
  assert.equal(data.desconhecidas, 1)
  assert.equal(data.alguma_desconectada, false)
  assert.equal(data.alguma_indisponivel, true)
  assert.equal(data.instancias[1].can_send, false)
  assert.equal(data.instancias[1].motivo, 'Evolution indisponivel')
})

test('obterResumoConexao reutiliza cache e agrupa requisicoes simultaneas', async () => {
  const empresaId = 'empresa-cache'
  invalidarResumoConexao(empresaId)
  let buscas = 0
  let verificacoes = 0
  const deps = {
    buscarInstancias: async () => {
      buscas += 1
      return [{ evolution_instance: 'a' }, { evolution_instance: 'b' }]
    },
    verificarStatus: async () => {
      verificacoes += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { connected: true }
    },
  }

  const [a, b] = await Promise.all([
    obterResumoConexao(empresaId, deps),
    obterResumoConexao(empresaId, deps),
  ])
  const c = await obterResumoConexao(empresaId, deps)

  assert.deepStrictEqual(a, b)
  assert.deepStrictEqual(b, c)
  assert.equal(buscas, 1)
  assert.equal(verificacoes, 2)
  invalidarResumoConexao(empresaId)
})

test('invalidacao durante requisicao nao restaura resposta antiga no cache', async () => {
  const empresaId = 'empresa-invalidacao'
  invalidarResumoConexao(empresaId)
  let buscas = 0
  let liberarPrimeira
  const primeiraPendente = new Promise((resolve) => { liberarPrimeira = resolve })
  const deps = {
    buscarInstancias: async () => {
      buscas += 1
      return [{ evolution_instance: 'a' }]
    },
    verificarStatus: async () => {
      if (buscas === 1) await primeiraPendente
      return { connected: true }
    },
  }

  const primeira = obterResumoConexao(empresaId, deps)
  await new Promise((resolve) => setImmediate(resolve))
  invalidarResumoConexao(empresaId)
  liberarPrimeira()
  await primeira
  await obterResumoConexao(empresaId, deps)

  assert.equal(buscas, 2)
  invalidarResumoConexao(empresaId)
})

test('duplicarContexto nunca copia runtime_ativo da origem', async () => {
  const sqls = []
  const client = {
    query: async (sql) => {
      sqls.push(sql)
      if (sql.includes('INSERT INTO app.empresa_contextos')) return { rows: [{ id: 'ctx-novo', nome: 'Cópia' }] }
      return { rows: [] }
    },
  }
  const novo = await duplicarContexto(client, 'e1', 'ctx-origem')
  assert.equal(novo.id, 'ctx-novo')
  assert.match(sqls[0], /gatilhos_agenda_json, false, ativo/)
})

test('limparReferenciasInstanciaRemovida limpa ponteiros operacionais e preserva historico', async () => {
  const chamadas = []
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      if (sql.includes('app.banco_leads_config')) return { rowCount: 1, rows: [] }
      if (sql.includes('prospectador.lead_disparos')) return { rowCount: 2, rows: [] }
      if (sql.includes('vendas.conversas')) return { rowCount: 3, rows: [] }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }

  const out = await limparReferenciasInstanciaRemovida(client, 'e1', {
    id: 'inst-id',
    evolution_instance: 'inst-main',
  })

  assert.deepStrictEqual(out, {
    banco_leads_config: 1,
    rascunhos_cancelados: 2,
    conversas_desvinculadas: 3,
  })
  assert.match(chamadas[0].sql, /auto_instancia_id = NULL/)
  assert.match(chamadas[0].sql, /auto_ativo = false/)
  assert.deepStrictEqual(chamadas[0].params, ['e1', 'inst-id'])
  assert.match(chamadas[1].sql, /status IN \('gerando', 'aguardando_disparo'\)/)
  assert.deepStrictEqual(chamadas[1].params, ['e1', 'inst-main'])
  assert.match(chamadas[2].sql, /SET evolution_instance = NULL/)
})
