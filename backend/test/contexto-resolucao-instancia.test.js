'use strict'
// Trava a regra arquitetural: atendimento é 100% por instância.
// buscarContexto2Ativo NÃO pode cair em contexto da empresa "fora da instância"
// quando a instância é informada mas não tem contexto linkado.
const { test } = require('node:test')
const assert = require('node:assert')
const { buscarContexto2Ativo } = require('../src/services/contexto-empresa')
const { createContexto2Responder } = require('../src/services/contexto2-responder')

function stubLogger() {
  return { info() {}, warn() {}, error() {}, child() { return this } }
}

// pool que registra cada query e devolve resultados pré-programados em sequência.
function fakePool(resultsBySequence) {
  const queries = []
  let i = 0
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      const r = resultsBySequence[i++] || { rows: [] }
      return r
    },
  }
}

test('buscarContexto2Ativo: instância informada SEM contexto linkado retorna null (não cai na empresa)', async () => {
  // 1ª query (por instância) volta vazia → deve retornar null sem 2ª query.
  const pool = fakePool([{ rows: [] }])
  const r = await buscarContexto2Ativo(pool, 'empresa-1', 'freelandoo')

  assert.strictEqual(r, null)
  // Garante que o fallback por empresa NÃO foi consultado.
  assert.strictEqual(pool.queries.length, 1, 'só pode rodar a query por instância')
})

test('buscarContexto2Ativo: instância COM contexto linkado resolve o playbook da instância', async () => {
  const pool = fakePool([{ rows: [{
    id: 'versao-9', conteudo_json: { resumo_empresa: {} }, conteudo_markdown: 'md',
    ativado_em: '2026-06-23', contexto_id: 'ctx-9', contexto_form_json: null,
  }] }])
  const r = await buscarContexto2Ativo(pool, 'empresa-1', 'freelandoo')

  assert.ok(r)
  assert.strictEqual(r.versao_id, 'versao-9')
  assert.strictEqual(r.contexto_id, 'ctx-9')
  assert.strictEqual(pool.queries.length, 1)
})

test('buscarContexto2Ativo: SEM instância (chamada admin) usa o fallback por empresa', async () => {
  const pool = fakePool([{ rows: [{
    id: 'versao-emp', conteudo_json: { resumo_empresa: {} }, conteudo_markdown: '',
    ativado_em: '2026-06-23', contexto_id: 'ctx-emp', contexto_form_json: null,
  }] }])
  const r = await buscarContexto2Ativo(pool, 'empresa-1', null)

  assert.ok(r)
  assert.strictEqual(r.versao_id, 'versao-emp')
  assert.strictEqual(pool.queries.length, 1)
})

test('responderContexto2: propaga a evolutionInstance da conversa para a resolução do playbook', async () => {
  let recebido = null
  const { responderContexto2 } = createContexto2Responder({
    pool: {},
    logger: stubLogger(),
    processarMensagemComPlaybook: async (args) => {
      recebido = args
      return { extracao: {}, decisao: { mensagem_pro_lead: 'Oi!' } }
    },
    buscarPerfil: async () => ({}),
    atualizarPerfil: async () => {},
    salvarConversa: async () => {},
    limparFalhaResposta: async () => {},
    alertarHandoff: async () => {},
    enviarMensagem: async () => {},
    buscarSlotsDisponiveis: async () => null,
    validarSlotReuniao: async () => false,
  })

  await responderContexto2({
    numero: '5511999990000',
    empresaId: 'e1',
    conversaUsada: { id: 'c1', status: 'ativo', evolution_instance: 'free' },
    historico: [{ role: 'user', content: 'oi' }],
    estagioLive: 'diagnostico',
  })

  assert.strictEqual(recebido.evolutionInstance, 'free', 'a resolução do playbook deve receber a instância da conversa')
})
