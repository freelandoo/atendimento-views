'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { createContexto2Responder } = require('../src/services/contexto2-responder')

function stubLogger() {
  return { info() {}, warn() {}, error() {}, child() { return this } }
}

// Monta o responder com deps mockadas e captura efeitos colaterais.
function montar(overrides = {}) {
  const calls = { enviarMensagem: [], salvarConversa: [], atualizarPerfil: [], alertarHandoff: [], limparFalhaResposta: [] }
  const deps = {
    pool: {},
    logger: stubLogger(),
    processarMensagemComPlaybook: async () => ({ extracao: {}, decisao: { mensagem_pro_lead: 'Oi! Aqui é a Freelandoo.' } }),
    buscarPerfil: async () => ({}),
    atualizarPerfil: async (...a) => { calls.atualizarPerfil.push(a) },
    salvarConversa: async (...a) => { calls.salvarConversa.push(a) },
    limparFalhaResposta: async (...a) => { calls.limparFalhaResposta.push(a) },
    alertarHandoff: async (...a) => { calls.alertarHandoff.push(a) },
    enviarMensagem: async (...a) => { calls.enviarMensagem.push(a) },
    buscarSlotsDisponiveis: async () => null,
    validarSlotReuniao: async () => false,
    ...overrides,
  }
  const { responderContexto2 } = createContexto2Responder(deps)
  return { responderContexto2, calls }
}

const conversaBase = { id: 'c1', status: 'ativo', evolution_instance: 'freelandoo' }
const historicoBase = [{ role: 'user', content: 'oi, como funciona?' }]

test('responderContexto2: persiste atualizar_perfil geral da decisao do playbook', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({
      extracao: {},
      decisao: {
        mensagem_pro_lead: 'Para seu caso, eu recomendo SEO.',
        atualizar_perfil: { produto_sugerido: 'SEO' },
      },
    }),
  })
  await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'diagnostico' })

  assert.ok(calls.atualizarPerfil.some((a) => a[1]?.produto_sugerido === 'SEO'))
  assert.strictEqual(calls.enviarMensagem.length, 1)
})

test('responderContexto2: envia a mensagem do playbook e persiste a conversa', async () => {
  const { responderContexto2, calls } = montar()
  const r = await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'diagnostico' })

  assert.deepStrictEqual(r, { ok: true, via: 'playbook' })
  assert.strictEqual(calls.enviarMensagem.length, 1)
  assert.strictEqual(calls.enviarMensagem[0][0], '5511999990000')
  assert.match(calls.enviarMensagem[0][1], /Freelandoo/)
  // envia pela instância da conversa
  assert.deepStrictEqual(calls.enviarMensagem[0][2], { instanceName: 'freelandoo' })
  // persiste o histórico com a resposta do assistente
  assert.strictEqual(calls.salvarConversa.length, 1)
  const histSalvo = calls.salvarConversa[0][1]
  assert.strictEqual(histSalvo[histSalvo.length - 1].role, 'assistant')
})

test('responderContexto2: pula o turno quando o playbook não produz mensagem', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({ extracao: {}, decisao: { mensagem_pro_lead: '' } }),
  })
  const r = await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'diagnostico' })
  assert.deepStrictEqual(r, { skipped: true, reason: 'playbook_sem_mensagem' })
  assert.strictEqual(calls.enviarMensagem.length, 0)
})

test('responderContexto2: handoff pausa a conversa (5º arg = true)', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({ extracao: {}, decisao: { mensagem_pro_lead: 'Vou te passar pra equipe.', precisa_handoff: true } }),
  })
  await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'diagnostico' })
  assert.strictEqual(calls.salvarConversa[0][4], true)
})

test('responderContexto2: oferta de reunião quando reuniao_status=deve_oferecer e há slots', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({ extracao: { reuniao_status: 'deve_oferecer' }, decisao: { mensagem_pro_lead: 'Posso te mostrar a estrutura.' } }),
    buscarSlotsDisponiveis: async () => ({ data_sugerida: '2026-07-01', data_label: '01/07', horarios_sugeridos: ['19:45', '20:30'] }),
  })
  await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'proposta' })
  assert.match(calls.enviarMensagem[0][1], /19:45|20:30/)
  // gravou a proposta de reunião no perfil
  assert.ok(calls.atualizarPerfil.some((a) => a[1] && a[1].reuniao_proposta))
})
