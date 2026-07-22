'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  enviarMensagemManualOperador,
  alterarPausaAgenteConversa,
  validarNumeroConversa,
  validarTextoMensagem,
} = require('../src/services/conversa-manual')

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111'
const NUMERO = '5511999999999@s.whatsapp.net'

test('mensagem manual valida numero individual e texto obrigatorio', () => {
  assert.equal(validarNumeroConversa(NUMERO), NUMERO)
  assert.equal(validarNumeroConversa('5511999999999'), '5511999999999')
  assert.equal(validarTextoMensagem('  oi  '), 'oi')

  for (const numero of ['', '123@g.us', '5511999999999@broadcast', '5511999999999@exemplo.com']) {
    assert.throws(() => validarNumeroConversa(numero), /numero/)
  }
  assert.throws(() => validarTextoMensagem('   '), /texto/)
  assert.throws(() => validarTextoMensagem('x'.repeat(4097)), /4096/)
})

test('mensagem manual envia pela instancia da conversa, registra operator e pausa agente', async () => {
  const chamadas = []
  const pool = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      if (/SELECT c\.numero/.test(sql)) {
        return {
          rows: [{
            numero: NUMERO,
            empresa_id: EMPRESA_ID,
            evolution_instance: 'inst-main',
            instance_name: 'inst-main',
            instance_conversa_indisponivel: false,
          }],
        }
      }
      if (/UPDATE vendas\.conversas/.test(sql)) {
        const entrada = JSON.parse(params[3])[0]
        return {
          rows: [{
            numero: NUMERO,
            historico: [{ role: 'user', content: 'oi' }, entrada],
            estagio: 'diagnostico',
            status: 'ativo',
            agente_pausado: true,
            evolution_instance: 'inst-main',
            atualizado_em: '2026-07-22T12:00:00.000Z',
          }],
        }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }
  const envios = []
  const out = await enviarMensagemManualOperador({
    pool,
    empresaId: EMPRESA_ID,
    numero: NUMERO,
    texto: '  Vamos retomar por aqui?  ',
    operadorId: 'user-1',
    _verificarStatusInstanciaEvolution: async (instance) => ({ connected: instance === 'inst-main' }),
    _enviarMensagem: async (numero, texto, opts) => {
      envios.push({ numero, texto, opts })
      return { key: { id: 'msg-1' } }
    },
    _now: () => new Date('2026-07-22T12:00:00.000Z'),
  })

  assert.equal(envios.length, 1)
  assert.deepEqual(envios[0], {
    numero: NUMERO,
    texto: 'Vamos retomar por aqui?',
    opts: { instanceName: 'inst-main' },
  })
  assert.equal(out.enviado, true)
  assert.equal(out.assumido, true)
  assert.equal(out.historico.at(-1).role, 'operator')
  assert.equal(out.historico.at(-1).content, 'Vamos retomar por aqui?')
  assert.equal(out.historico.at(-1).tipo, 'mensagem_manual_operador')
  assert.equal(out.historico.at(-1).operador_id, 'user-1')

  const update = chamadas.find((c) => /UPDATE vendas\.conversas/.test(c.sql))
  assert.ok(update, 'deve atualizar o historico da conversa')
  assert.equal(update.params[5], true, 'assumir=true deve pausar o agente')
  assert.equal(update.params[6], 'inst-main', 'deve persistir a instancia usada quando faltante')
})

test('mensagem manual bloqueia envio quando instancia esta desconectada', async () => {
  const pool = {
    query: async () => ({
      rows: [{
        numero: NUMERO,
        empresa_id: EMPRESA_ID,
        evolution_instance: 'inst-main',
        instance_name: 'inst-main',
        instance_conversa_indisponivel: false,
      }],
    }),
  }
  let enviou = false
  await assert.rejects(
    () => enviarMensagemManualOperador({
      pool,
      empresaId: EMPRESA_ID,
      numero: NUMERO,
      texto: 'oi',
      _verificarStatusInstanciaEvolution: async () => ({ connected: false, motivo: 'Instancia fechada.' }),
      _enviarMensagem: async () => { enviou = true },
    }),
    (err) => err.statusCode === 409 && err.code === 'INSTANCE_DISCONNECTED'
  )
  assert.equal(enviou, false)
})

test('mensagem manual usa fallback ativo quando conversa legada nao tem instancia', async () => {
  const pool = {
    query: async (sql, params) => {
      if (/SELECT c\.numero/.test(sql)) {
        return {
          rows: [{
            numero: NUMERO,
            empresa_id: EMPRESA_ID,
            evolution_instance: null,
            instance_name: 'inst-fallback',
            instance_conversa_indisponivel: false,
          }],
        }
      }
      if (/UPDATE vendas\.conversas/.test(sql)) {
        const entrada = JSON.parse(params[3])[0]
        return {
          rows: [{
            numero: NUMERO,
            historico: [entrada],
            estagio: 'primeiro_contato',
            status: 'ativo',
            agente_pausado: true,
            evolution_instance: params[6],
            atualizado_em: '2026-07-22T12:00:00.000Z',
          }],
        }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }
  const envios = []
  const out = await enviarMensagemManualOperador({
    pool,
    empresaId: EMPRESA_ID,
    numero: NUMERO,
    texto: 'oi',
    _verificarStatusInstanciaEvolution: async () => ({ connected: true }),
    _enviarMensagem: async (numero, texto, opts) => {
      envios.push(opts)
      return {}
    },
  })

  assert.deepEqual(envios, [{ instanceName: 'inst-fallback' }])
  assert.equal(out.evolution_instance, 'inst-fallback')
})

test('mensagem manual bloqueia conversa com instancia antiga inativa mesmo com fallback disponivel', async () => {
  const pool = {
    query: async () => ({
      rows: [{
        numero: NUMERO,
        empresa_id: EMPRESA_ID,
        evolution_instance: 'inst-antiga',
        instance_name: null,
        instance_conversa_indisponivel: true,
      }],
    }),
  }
  let verificou = false
  await assert.rejects(
    () => enviarMensagemManualOperador({
      pool,
      empresaId: EMPRESA_ID,
      numero: NUMERO,
      texto: 'oi',
      _verificarStatusInstanciaEvolution: async () => { verificou = true; return { connected: true } },
      _enviarMensagem: async () => {},
    }),
    (err) => err.statusCode === 409 && err.code === 'INSTANCE_UNAVAILABLE'
  )
  assert.equal(verificou, false)
})

test('pausa da conversa atualiza agente_pausado e cancela follow-ups pendentes', async () => {
  const chamadas = []
  const pool = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      assert.match(sql, /UPDATE vendas\.conversas/)
      assert.equal(params[0], EMPRESA_ID)
      assert.equal(params[2], NUMERO)
      assert.equal(params[3], true)
      return {
        rows: [{
          numero: NUMERO,
          historico: [],
          estagio: 'diagnostico',
          status: 'ativo',
          agente_pausado: true,
          evolution_instance: 'inst-main',
          atualizado_em: '2026-07-22T12:00:00.000Z',
        }],
      }
    },
  }
  const cancelados = []
  const out = await alterarPausaAgenteConversa({
    pool,
    empresaId: EMPRESA_ID,
    numero: NUMERO,
    pausado: true,
    _cancelarFollowupsAutoPendentes: async (poolArg, numero, motivo) => {
      assert.equal(poolArg, pool)
      cancelados.push({ numero, motivo })
      return 2
    },
  })

  assert.equal(out.agente_pausado, true)
  assert.equal(out.followups_cancelados, 2)
  assert.deepEqual(cancelados, [{ numero: NUMERO, motivo: 'agente_pausado' }])
  assert.equal(chamadas.length, 1)
})

test('retomada da conversa nao cancela follow-ups e valida booleano', async () => {
  const pool = {
    query: async (sql, params) => {
      assert.match(sql, /UPDATE vendas\.conversas/)
      assert.equal(params[3], false)
      return {
        rows: [{
          numero: NUMERO,
          historico: [],
          estagio: 'diagnostico',
          status: 'ativo',
          agente_pausado: false,
          evolution_instance: 'inst-main',
          atualizado_em: '2026-07-22T12:00:00.000Z',
        }],
      }
    },
  }
  let cancelou = false
  const out = await alterarPausaAgenteConversa({
    pool,
    empresaId: EMPRESA_ID,
    numero: NUMERO,
    pausado: false,
    _cancelarFollowupsAutoPendentes: async () => { cancelou = true },
  })

  assert.equal(out.agente_pausado, false)
  assert.equal(out.followups_cancelados, 0)
  assert.equal(cancelou, false)

  await assert.rejects(
    () => alterarPausaAgenteConversa({ pool, empresaId: EMPRESA_ID, numero: NUMERO, pausado: 'false' }),
    (err) => err.statusCode === 400 && /booleano/.test(err.message)
  )
})
