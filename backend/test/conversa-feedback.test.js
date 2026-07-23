'use strict'

const assert = require('node:assert')
const test = require('node:test')
const { registrarFeedbackConversa } = require('../src/services/conversa-feedback')

function mensagem(role, content) {
  return { role, content, timestamp: '2026-07-22T12:00:00.000Z' }
}

function mockPool({ historico, conversa = {}, insertRow = {} } = {}) {
  const calls = []
  const clientCalls = []
  const pool = {
    calls,
    clientCalls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (/SELECT c\.id, c\.numero, c\.historico, c\.evolution_instance/.test(sql)) {
        return {
          rows: [{
            id: conversa.id || 123,
            numero: conversa.numero || '5511999999999',
            evolution_instance: conversa.evolution_instance || 'inst-1',
            historico: historico || [
              mensagem('user', 'Oi'),
              mensagem('assistant', 'Resposta do agente'),
            ],
          }],
        }
      }
      if (/UPDATE app\.conversa_feedbacks/.test(sql)) return { rows: [] }
      return { rows: [] }
    },
    async connect() {
      return {
        async query(sql, params) {
          clientCalls.push({ sql, params })
          if (/INSERT INTO app\.conversa_feedbacks/.test(sql)) {
            return {
              rows: [{
                id: insertRow.id || 'fb-1',
                tipo: params[6],
                contexto_versao_id: params[10],
              }],
            }
          }
          return { rows: [] }
        },
        release() {},
      }
    },
  }
  return pool
}

test('feedback positivo grava auditoria e nao cria sugestao', async () => {
  const pool = mockPool()
  const sugestoes = []

  const out = await registrarFeedbackConversa({
    pool,
    empresaId: '00000000-0000-0000-0000-000000000001',
    numero: '5511999999999',
    mensagemIndex: 1,
    tipo: 'positivo',
    usuarioId: 'user-1',
    _buscarContexto2Ativo: async () => ({ versao_id: 'ver-1' }),
    _registrarSugestaoAprendizadoContexto: async (args) => { sugestoes.push(args); return { id: 'sug-1' } },
  })

  assert.equal(out.criou_sugestao, false)
  assert.equal(sugestoes.length, 0)
  assert.equal(pool.clientCalls.filter((c) => /INSERT INTO app\.conversa_feedbacks/.test(c.sql)).length, 1)
})

test('feedback negativo grava auditoria e cria sugestao pendente quando ha playbook ativo', async () => {
  const pool = mockPool()
  const sugestoes = []

  const out = await registrarFeedbackConversa({
    pool,
    empresaId: '00000000-0000-0000-0000-000000000001',
    numero: '5511999999999',
    mensagemIndex: 1,
    tipo: 'negativo',
    tags: ['tom_ruim', 'fora_do_contexto', 'tag_invalida'],
    observacao: 'Respondeu sem usar o contexto correto.',
    usuarioId: 'user-1',
    _buscarContexto2Ativo: async () => ({ versao_id: 'ver-1' }),
    _registrarSugestaoAprendizadoContexto: async (args) => {
      sugestoes.push(args)
      return { id: 'sug-1' }
    },
  })

  assert.equal(out.criou_sugestao, true)
  assert.equal(sugestoes.length, 1)
  assert.equal(sugestoes[0].contextoVersaoId, 'ver-1')
  assert.equal(sugestoes[0].feedbackId, 'fb-1')
  assert.deepEqual(sugestoes[0].sugestaoJson.tags, ['tom_ruim', 'fora_do_contexto'])
  assert.ok(!pool.calls.some((c) => /UPDATE app\.empresa_contexto_versoes/.test(c.sql)))
})

test('feedback negativo sem observacao e recusado', async () => {
  const pool = mockPool()
  await assert.rejects(
    registrarFeedbackConversa({
      pool,
      empresaId: '00000000-0000-0000-0000-000000000001',
      numero: '5511999999999',
      mensagemIndex: 1,
      tipo: 'negativo',
      observacao: '   ',
    }),
    /Explique o motivo/
  )
})

test('feedback em mensagem que nao e do agente e recusado', async () => {
  const pool = mockPool({
    historico: [
      mensagem('user', 'Mensagem do lead'),
      mensagem('assistant', 'Resposta do agente'),
    ],
  })

  await assert.rejects(
    registrarFeedbackConversa({
      pool,
      empresaId: '00000000-0000-0000-0000-000000000001',
      numero: '5511999999999',
      mensagemIndex: 0,
      tipo: 'positivo',
    }),
    /resposta do agente/
  )
})

test('feedback negativo sem playbook ativo nao cria sugestao', async () => {
  const pool = mockPool()
  const sugestoes = []

  const out = await registrarFeedbackConversa({
    pool,
    empresaId: '00000000-0000-0000-0000-000000000001',
    numero: '5511999999999',
    mensagemIndex: 1,
    tipo: 'negativo',
    observacao: 'Nao respondeu a pergunta.',
    _buscarContexto2Ativo: async () => null,
    _registrarSugestaoAprendizadoContexto: async (args) => { sugestoes.push(args); return { id: 'sug-1' } },
  })

  assert.equal(out.criou_sugestao, false)
  assert.equal(sugestoes.length, 0)
})
