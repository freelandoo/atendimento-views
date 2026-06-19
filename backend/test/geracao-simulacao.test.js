'use strict'

const assert = require('node:assert')
const test = require('node:test')

require('../src/logger')

const estagiosSvc = require('../src/services/contexto-estagios')
const { simularERefinar, ETAPAS_PADRAO_SIMULACAO } = require('../src/services/geracao-simulacao')

function fakeProvider(map) {
  const calls = []
  return {
    calls,
    async generateAIResponse(input) {
      calls.push(input.task)
      const v = map[input.task]
      return { text: typeof v === 'function' ? v(input) : (v != null ? v : '') }
    },
  }
}

const baseEstagios = estagiosSvc.normalizarEstagios({
  nucleo: 'N', primeiro_contato: 'PC',
  diagnostico: 'DIAG', objecao: 'OBJ', fechamento: 'FEC',
})

test('simularERefinar: refina as 3 etapas difíceis por padrão e monta o transcript', async () => {
  const gen = fakeProvider({
    simularLeadDificil: 'Tá caro demais, vou pensar.',
    criticarRefinarEstagio: '{"critica":"faltou prova social","estagio":"ESTAGIO REFINADO"}',
  })
  const runtime = fakeProvider({ simularRespostaAgente: 'Entendo — posso te mostrar casos reais.' })

  const { estagios, simulacoes } = await simularERefinar({
    pool: {}, log: null, empresaId: 'e1', contextoId: 'c1',
    genProvider: gen, runtimeProvider: runtime, estagios: baseEstagios, conhecimento: 'empresa de sites',
  })

  // só as 3 etapas-padrão foram simuladas (têm conteúdo)
  assert.deepEqual(simulacoes.map((s) => s.etapa).sort(), [...ETAPAS_PADRAO_SIMULACAO].sort())
  for (const s of simulacoes) {
    assert.equal(s.mudou, true)
    assert.ok(s.mensagem_lead && s.resposta_agente && s.critica)
  }
  // estágios refinados; etapas não simuladas ficam intactas
  assert.equal(estagios.diagnostico, 'ESTAGIO REFINADO')
  assert.equal(estagios.objecao, 'ESTAGIO REFINADO')
  assert.equal(estagios.fechamento, 'ESTAGIO REFINADO')
  assert.equal(estagios.primeiro_contato, 'PC')
  assert.equal(estagios.nucleo, 'N')

  // usou o modelo de ATENDIMENTO pra responder e o de GERAÇÃO pra lead+crítica
  assert.ok(runtime.calls.includes('simularRespostaAgente'))
  assert.ok(gen.calls.includes('simularLeadDificil'))
  assert.ok(gen.calls.includes('criticarRefinarEstagio'))
})

test('simularERefinar: crítica com JSON inválido mantém o estágio original (não apaga)', async () => {
  const gen = fakeProvider({
    simularLeadDificil: 'mensagem dura',
    criticarRefinarEstagio: 'isso não é json',
  })
  const runtime = fakeProvider({ simularRespostaAgente: 'resposta' })

  const { estagios, simulacoes } = await simularERefinar({
    pool: {}, empresaId: 'e1', contextoId: 'c1',
    genProvider: gen, runtimeProvider: runtime, estagios: baseEstagios, conhecimento: 'x',
    etapas: ['objecao'],
  })
  assert.equal(simulacoes.length, 1)
  assert.equal(simulacoes[0].etapa, 'objecao')
  assert.equal(simulacoes[0].mudou, false)
  assert.equal(estagios.objecao, 'OBJ') // original preservado
})

test('simularERefinar: ignora etapa sem conteúdo', async () => {
  const gen = fakeProvider({ simularLeadDificil: 'x', criticarRefinarEstagio: '{"estagio":"Y"}' })
  const runtime = fakeProvider({ simularRespostaAgente: 'r' })
  const { simulacoes } = await simularERefinar({
    pool: {}, empresaId: 'e1', contextoId: 'c1',
    genProvider: gen, runtimeProvider: runtime,
    estagios: estagiosSvc.normalizarEstagios({ objecao: 'OBJ' }), // só objecao tem conteúdo
    conhecimento: 'x', etapas: ['diagnostico', 'objecao', 'fechamento'],
  })
  assert.deepEqual(simulacoes.map((s) => s.etapa), ['objecao'])
})
