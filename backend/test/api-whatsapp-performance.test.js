'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const router = require('../src/routes/api-whatsapp')

const { calcularResumoConexao, obterResumoConexao, invalidarResumoConexao, duplicarContexto } = router

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
  assert.deepStrictEqual(data, {
    total: 3,
    desconectadas: 1,
    alguma_desconectada: true,
    instancias: [
      { id: 'i1', evolution_instance: 'a', connected: true, state: 'unknown' },
      { id: 'i2', evolution_instance: 'desconectada', connected: false, state: 'unknown' },
      { id: 'i3', evolution_instance: 'c', connected: true, state: 'unknown' },
    ],
  })
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
