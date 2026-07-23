'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const router = require('../src/routes/api-whatsapp')
const { registerWebhookRoute } = require('../src/webhook-handler')
const {
  eventoSaudeDeWebhook,
} = require('../src/db/whatsapp-instance-events')

const {
  calcularResumoConexao,
  obterResumoConexao,
  invalidarResumoConexao,
  duplicarContexto,
  limparReferenciasInstanciaRemovida,
  calcularImpactoRemocaoInstancia,
  calcularImpactoSubstituicaoInstancia,
  substituirReferenciasInstancia,
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

test('calcularResumoConexao inclui alerta de saude quando a instancia tem evento de risco', async () => {
  const data = await calcularResumoConexao([
    {
      id: 'i1',
      evolution_instance: 'a',
      saude_event: 'CONNECTION_UPDATE',
      saude_state: 'close',
      saude_reason: 'device_removed',
      saude_disconnect_code: '401',
      saude_risk_level: 'alto',
      saude_risk_message: 'Nao reconecte ainda.',
      saude_criado_em: '2026-07-23T10:00:00.000Z',
    },
  ], async () => ({ connected: false, state: 'close' }))

  assert.equal(data.instancias[0].health_alert.risk_level, 'alto')
  assert.equal(data.instancias[0].health_alert.message, 'Nao reconecte ainda.')
  assert.equal(data.instancias[0].health_alert.disconnect_code, '401')
})

test('eventoSaudeDeWebhook classifica desconexao 401 como alto risco sem payload bruto', () => {
  const evento = eventoSaudeDeWebhook({
    event: 'CONNECTION_UPDATE',
    instance: 'inst-main',
    data: {
      state: 'close',
      lastDisconnect: {
        error: {
          message: 'device_removed',
          output: { statusCode: 401 },
        },
      },
    },
  }, 'e1', 'inst-main')

  assert.equal(evento.event, 'CONNECTION_UPDATE')
  assert.equal(evento.risk_level, 'alto')
  assert.equal(evento.disconnect_code, '401')
  assert.equal(evento.reason, 'device_removed')
  assert.deepStrictEqual(Object.keys(evento.detalhes_json).sort(), ['message_status', 'message_stub_parameters', 'source_event'])
})

test('eventoSaudeDeWebhook classifica MESSAGES_UPDATE ERROR 463 como alto risco', () => {
  const evento = eventoSaudeDeWebhook({
    event: 'MESSAGES_UPDATE',
    instance: 'inst-main',
    data: {
      status: 'ERROR',
      messageStubParameters: ['463'],
    },
  }, 'e1', 'inst-main')

  assert.equal(evento.risk_level, 'alto')
  assert.deepStrictEqual(evento.detalhes_json.message_stub_parameters, ['463'])
})

test('webhook registra CONNECTION_UPDATE antes de ignorar eventos sem mensagem', async () => {
  let handler
  const app = { post: (_path, cb) => { handler = cb } }
  const log = {
    child: () => log,
    info: () => {},
    warn: () => {},
    error: () => {},
  }
  const registrados = []
  registerWebhookRoute(app, {
    webhookAutorizado: () => true,
    gerarRequestIdAnthropic: () => 'rid',
    loggerForWebhook: () => log,
    serializeError: (err) => ({ message: err.message }),
    eventoSaudeDeWebhook: (body, empresaId, evolutionInstance) => ({
      empresa_id: empresaId,
      evolution_instance: evolutionInstance,
      event: body.event,
      risk_level: 'atencao',
    }),
    registrarEventoSaudeInstancia: async (evento) => { registrados.push(evento) },
  })

  await handler(
    { headers: {}, body: { event: 'CONNECTION_UPDATE' }, empresaId: 'e1', evolutionInstance: 'inst-main' },
    { status: () => ({ json: () => {} }), json: () => {} }
  )

  assert.equal(registrados.length, 1)
  assert.equal(registrados[0].event, 'CONNECTION_UPDATE')
  assert.equal(registrados[0].empresa_id, 'e1')
  assert.equal(registrados[0].evolution_instance, 'inst-main')
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

test('calcularImpactoRemocaoInstancia resume impacto e bloqueia envio em andamento', async () => {
  const client = {
    query: async (sql, params) => {
      if (sql.includes('FROM app.banco_leads_config')) {
        assert.deepStrictEqual(params, ['e1', 'inst-id'])
        return { rows: [{ auto_ativo: true, modo: 'automatico' }] }
      }
      if (sql.includes("status IN ('gerando', 'aguardando_disparo')")) {
        assert.deepStrictEqual(params, ['e1', 'inst-main'])
        return { rows: [{ total: 4 }] }
      }
      if (sql.includes("status IN ('enviando', 'pendente_confirmacao')")) {
        assert.deepStrictEqual(params, ['e1', 'inst-main'])
        return { rows: [{ total: 1 }] }
      }
      if (sql.includes('FROM vendas.conversas')) {
        assert.deepStrictEqual(params, ['e1', 'inst-main'])
        return { rows: [{ total: 7 }] }
      }
      if (sql.includes('FROM app.empresa_whatsapp_instances')) {
        assert.deepStrictEqual(params, ['ctx-1', 'e1', 'inst-id'])
        return { rows: [{ total: 0 }] }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }

  const out = await calcularImpactoRemocaoInstancia(client, 'e1', {
    id: 'inst-id',
    nome: 'Vendas',
    evolution_instance: 'inst-main',
    contexto_id: 'ctx-1',
  })

  assert.equal(out.banco_leads.configuracao_usando, true)
  assert.equal(out.banco_leads.automatico_ativo, true)
  assert.equal(out.rascunhos_cancelaveis, 4)
  assert.equal(out.envios_em_andamento, 1)
  assert.equal(out.conversas_vinculadas, 7)
  assert.equal(out.contexto.sera_removido, true)
  assert.equal(out.bloqueia_remocao, true)
  assert.ok(out.avisos.some((a) => /envios em andamento/.test(a)))
})

test('calcularImpactoSubstituicaoInstancia resume transferencia sem apagar dados', async () => {
  const client = {
    query: async (sql, params) => {
      if (sql.includes('FROM app.banco_leads_config')) {
        assert.deepStrictEqual(params, ['e1', 'origem-id'])
        return { rows: [{ auto_ativo: true, modo: 'automatico' }] }
      }
      if (sql.includes("status IN ('gerando', 'aguardando_disparo', 'erro_ia')")) {
        assert.deepStrictEqual(params, ['e1', 'inst-antiga'])
        return { rows: [{ total: 5 }] }
      }
      if (sql.includes("status IN ('enviando', 'pendente_confirmacao')")) {
        assert.deepStrictEqual(params, ['e1', 'inst-antiga'])
        return { rows: [{ total: 0 }] }
      }
      if (sql.includes('FROM vendas.conversas') && params[1] === 'inst-antiga') {
        return { rows: [{ total: 8 }] }
      }
      if (sql.includes('FROM vendas.conversas') && params[1] === 'inst-nova') {
        return { rows: [{ total: 2 }] }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }

  const out = await calcularImpactoSubstituicaoInstancia(
    client,
    'e1',
    { id: 'origem-id', nome: 'Antiga', evolution_instance: 'inst-antiga', contexto_id: 'ctx-1' },
    { id: 'destino-id', nome: 'Nova', evolution_instance: 'inst-nova', ativo: true, contexto_id: 'ctx-2' }
  )

  assert.equal(out.banco_leads.configuracao_usando, true)
  assert.equal(out.rascunhos_transferiveis, 5)
  assert.equal(out.conversas_transferiveis, 8)
  assert.equal(out.destino_conversas_atuais, 2)
  assert.equal(out.contexto.sera_transferido, true)
  assert.equal(out.contexto.destino_contexto_substituido, true)
  assert.equal(out.bloqueia_substituicao, false)
  assert.ok(out.avisos.some((a) => /passara a usar a instancia nova/.test(a)))
})

test('substituirReferenciasInstancia transfere ponteiros e desativa origem', async () => {
  const chamadas = []
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      if (sql.includes('UPDATE app.banco_leads_config')) return { rowCount: 1, rows: [] }
      if (sql.includes('UPDATE prospectador.lead_disparos')) return { rowCount: 2, rows: [] }
      if (sql.includes('UPDATE vendas.conversas')) return { rowCount: 3, rows: [] }
      if (sql.includes('UPDATE app.empresa_whatsapp_instances') && sql.includes('contexto_id = $3')) return { rowCount: 1, rows: [] }
      if (sql.includes('DELETE FROM app.empresa_contextos')) return { rowCount: 1, rows: [] }
      if (sql.includes('UPDATE app.empresa_whatsapp_instances') && sql.includes('ativo = false')) return { rowCount: 1, rows: [] }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }

  const out = await substituirReferenciasInstancia(client, 'e1', {
    id: 'origem-id',
    evolution_instance: 'inst-antiga',
    contexto_id: 'ctx-origem',
    config_json: { saudacao: 'Oi', usa_agenda: false },
  }, {
    id: 'destino-id',
    evolution_instance: 'inst-nova',
    contexto_id: 'ctx-destino',
    config_json: {},
  })

  assert.deepStrictEqual(out, {
    banco_leads_config: 1,
    rascunhos_transferidos: 2,
    conversas_transferidas: 3,
    contexto_transferido: true,
    destino_contexto_anterior_removido: true,
    origem_desativada: true,
  })
  assert.deepStrictEqual(chamadas[0].params, ['e1', 'origem-id', 'destino-id'])
  assert.deepStrictEqual(chamadas[1].params, ['e1', 'inst-antiga', 'inst-nova'])
  assert.deepStrictEqual(chamadas[2].params, ['e1', 'inst-antiga', 'inst-nova'])
  assert.match(chamadas[3].sql, /contexto_id = \$3/)
  assert.deepStrictEqual(chamadas[3].params.slice(0, 3), ['destino-id', 'e1', 'ctx-origem'])
  assert.match(chamadas[chamadas.length - 1].sql, /ativo = false/)
})
