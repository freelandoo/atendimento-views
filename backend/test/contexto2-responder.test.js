'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { createContexto2Responder } = require('../src/services/contexto2-responder')

function stubLogger() {
  return { info() {}, warn() {}, error() {}, child() { return this } }
}

// Monta o responder com deps mockadas e captura efeitos colaterais.
function montar(overrides = {}) {
  const calls = { enviarMensagem: [], salvarConversa: [], atualizarPerfil: [], alertarHandoff: [], limparFalhaResposta: [], cancelarFollowups: [], definirModoAnalise: [] }
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
    cancelarFollowupsDoLead: async (...a) => { calls.cancelarFollowups.push(a) },
    definirModoAnalise: async (...a) => { calls.definirModoAnalise.push(a) },
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
  // envia pela instância da conversa, declarando que o texto é da IA (ledger 117)
  assert.deepStrictEqual(calls.enviarMensagem[0][2], {
    autoria: 'ia', tipoMensagem: 'resposta_ia', instanceName: 'freelandoo',
  })
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

test('responderContexto2: qualificação BANT concluída avisa o operador e não envia nova mensagem ao lead', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({
      extracao: {
        qualificacao_bant: {
          status: 'pronto_para_assuncao',
          necessidade: { status: 'confirmada', evidencia: 'Quer CRM para não perder oportunidades.' },
          timing: { status: 'curto_prazo', evidencia: 'Quer resolver nas próximas semanas.' },
          autoridade: { status: 'decisor', evidencia: 'É o dono.' },
          budget: { status: 'aberto_a_avaliar', evidencia: 'Tem verba se fizer sentido.', precisa_esclarecer: false },
        },
      },
      decisao: { mensagem_pro_lead: 'Mensagem que não deve ser enviada.', precisa_handoff: true },
    }),
    buscarPerfil: async () => ({ apelido: 'Ana' }),
  })
  const r = await responderContexto2({ numero: '5511999990000', empresaId: 'e1', conversaUsada: conversaBase, historico: historicoBase, estagioLive: 'diagnostico' })
  assert.deepStrictEqual(r, { ok: true, via: 'playbook', handoff: true, mensagem_suprimida: true })
  assert.strictEqual(calls.enviarMensagem.length, 0)
  assert.strictEqual(calls.alertarHandoff.length, 1)
  assert.strictEqual(calls.alertarHandoff[0][3], 'qualificacao_bant_concluida')
  assert.deepStrictEqual(calls.cancelarFollowups[0], ['e1', '5511999990000', 'qualificacao_bant_concluida'])
  assert.deepStrictEqual(calls.definirModoAnalise[0], ['e1', '5511999990000'])
  assert.strictEqual(calls.salvarConversa[0][4], undefined)
  assert.strictEqual(calls.salvarConversa[0][3], 'aguardando_handoff')
  assert.strictEqual(calls.salvarConversa[0][1].length, historicoBase.length)
})

test('responderContexto2: em modo Análise após BANT, atualiza sem repetir alerta, agenda ou mensagem', async () => {
  const { responderContexto2, calls } = montar({
    processarMensagemComPlaybook: async () => ({
      extracao: {
        reuniao_status: 'deve_oferecer',
        qualificacao_bant: { status: 'pronto_para_assuncao' },
      },
      decisao: { mensagem_pro_lead: 'Mensagem apenas para análise.' },
    }),
    buscarSlotsDisponiveis: async () => {
      throw new Error('agenda não deveria ser consultada')
    },
  })
  const r = await responderContexto2({
    numero: '5511999990000', empresaId: 'e1',
    conversaUsada: { ...conversaBase, modo_ia: 'analise' },
    historico: historicoBase, estagioLive: 'diagnostico',
  })
  assert.deepStrictEqual(r, { skipped: true, reason: 'modo_analise', analise_registrada: true })
  assert.strictEqual(calls.enviarMensagem.length, 0)
  assert.strictEqual(calls.alertarHandoff.length, 0)
  assert.strictEqual(calls.definirModoAnalise.length, 0)
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
