'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyConversationStage, VALID_STAGES } = require('../src/conversation-stage-classifier')

// ─── helpers ─────────────────────────────────────────────────────────────────

function ctx(overrides = {}) {
  return {
    texto: '',
    perfil: {},
    estagio: 'primeiro_contato',
    historico: [],
    status: null,
    tipo: null,
    ...overrides,
  }
}

function assertStage(result, expectedStage) {
  assert.ok(
    VALID_STAGES.includes(result.stage),
    `Stage "${result.stage}" não está na lista de estágios válidos`
  )
  assert.equal(result.stage, expectedStage, `Esperado "${expectedStage}", recebido "${result.stage}": ${result.reason}`)
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason deve ser string não vazia')
}

// ─── Critério 1: lead chegando pela primeira vez → new_lead ──────────────────

test('new_lead: primeiro contato, sem histórico', () => {
  const result = classifyConversationStage(ctx({
    texto: 'oi tudo bem',
    estagio: 'primeiro_contato',
    historico: [],
  }))
  assertStage(result, 'new_lead')
})

test('new_lead: estagio null com historico vazio', () => {
  const result = classifyConversationStage(ctx({
    texto: 'oi',
    estagio: null,
    historico: [],
  }))
  assertStage(result, 'new_lead')
})

test('NÃO é new_lead se bot já respondeu', () => {
  const result = classifyConversationStage(ctx({
    texto: 'qual o preço?',
    estagio: 'primeiro_contato',
    historico: [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá! Qual o seu negócio?' },
    ],
  }))
  assert.notEqual(result.stage, 'new_lead')
})

// ─── Critério 2: lead perguntou preço → price_question ───────────────────────

test('price_question: "quanto custa um site"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'quanto custa um site?',
    estagio: 'primeiro_contato',
    historico: [{ role: 'assistant', content: 'Oi!' }],
  }))
  assertStage(result, 'price_question')
})

test('price_question: "qual o valor"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'qual o valor?',
    estagio: 'diagnostico',
  }))
  assertStage(result, 'price_question')
})

test('price_question: "me passa a tabela de preço"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'me passa a tabela de preço por favor',
    estagio: 'proposta',
  }))
  assertStage(result, 'price_question')
})

test('price_question: "qual o investimento"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'qual o investimento?',
    estagio: 'diagnostico',
  }))
  assertStage(result, 'price_question')
})

test('price_question: detecta via histórico em estágio proposta', () => {
  const result = classifyConversationStage(ctx({
    texto: 'tá, entendi',
    estagio: 'proposta',
    historico: [
      { role: 'assistant', content: 'Aqui está a nossa proposta.' },
      { role: 'user', content: 'quanto custa?' },
      { role: 'assistant', content: 'O investimento varia conforme o escopo.' },
    ],
  }))
  assertStage(result, 'price_question')
})

// ─── Critério 3: lead deu objeção → objection ────────────────────────────────

test('objection: "tá caro"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'tá caro demais',
    estagio: 'proposta',
  }))
  assertStage(result, 'objection')
})

test('objection: "vou pensar"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'vou pensar e te falo',
    estagio: 'proposta',
  }))
  assertStage(result, 'objection')
})

test('objection: "agora não"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'agora não consigo, talvez mais pra frente',
    estagio: 'proposta',
  }))
  assertStage(result, 'objection')
})

test('objection: "já tenho alguém que faz isso"', () => {
  const result = classifyConversationStage(ctx({
    texto: 'já tenho um dev que faz isso pra mim',
    estagio: 'proposta',
  }))
  assertStage(result, 'objection')
})

test('objection: overrides estágio qualification também', () => {
  const result = classifyConversationStage(ctx({
    texto: 'não tenho verba agora',
    estagio: 'primeiro_contato',
    historico: [{ role: 'assistant', content: 'Oi!' }],
  }))
  assertStage(result, 'objection')
})

// ─── Critério 4: lead pode ser chamado para reunião ──────────────────────────

test('meeting_offer: bot ofertou horários no histórico recente', () => {
  const result = classifyConversationStage(ctx({
    texto: 'sim, pode ser',
    estagio: 'proposta',
    historico: [
      { role: 'user', content: 'quero saber mais' },
      { role: 'assistant', content: 'Posso marcar uma reunião rápida de 15 minutos. Qual horário funciona?' },
    ],
  }))
  assertStage(result, 'meeting_offer')
})

test('meeting_offer: reuniao_proposta.necessaria = true', () => {
  const result = classifyConversationStage(ctx({
    texto: 'ok',
    estagio: 'proposta',
    perfil: { reuniao_proposta: { necessaria: true, horario_confirmado: null } },
  }))
  assertStage(result, 'meeting_offer')
})

test('meeting_scheduled: horario confirmado no perfil', () => {
  const result = classifyConversationStage(ctx({
    texto: 'perfeito!',
    estagio: 'proposta',
    perfil: { reuniao_proposta: { horario_confirmado: '2026-05-20 19:30', necessaria: true } },
  }))
  assertStage(result, 'meeting_scheduled')
})

// ─── Estágios intermediários ──────────────────────────────────────────────────

test('qualification: dados faltando (negócio, cidade, serviço)', () => {
  const result = classifyConversationStage(ctx({
    texto: 'olá, vi o anúncio',
    estagio: 'primeiro_contato',
    historico: [{ role: 'assistant', content: 'Oi! Qual o seu negócio?' }],
  }))
  assertStage(result, 'qualification')
})

test('qualification: com dados parciais', () => {
  const result = classifyConversationStage(ctx({
    texto: 'sou cabeleireira',
    estagio: 'primeiro_contato',
    perfil: { negocio: 'salão de beleza' },
    historico: [{ role: 'assistant', content: 'Oi!' }],
  }))
  assertStage(result, 'qualification')
})

test('diagnosis: estagio diagnostico', () => {
  const result = classifyConversationStage(ctx({
    texto: 'tenho muitos clientes mas não consigo organizar',
    estagio: 'diagnostico',
    perfil: { negocio: 'pizzaria', cidade: 'São Paulo', servico_principal: 'site' },
    historico: [{ role: 'assistant', content: 'Entendo, me conta mais...' }],
  }))
  assertStage(result, 'diagnosis')
})

test('solution_explanation: proposta sem preço e sem reunião ofertada', () => {
  const result = classifyConversationStage(ctx({
    texto: 'quero entender melhor como funciona',
    estagio: 'proposta',
    perfil: { negocio: 'pizzaria', cidade: 'Santos' },
    historico: [{ role: 'assistant', content: 'Posso te explicar nossa abordagem.' }],
  }))
  assertStage(result, 'solution_explanation')
})

// ─── Terminais ────────────────────────────────────────────────────────────────

test('closed: status fechado', () => {
  const result = classifyConversationStage(ctx({ status: 'fechado' }))
  assertStage(result, 'closed')
})

test('closed: motivo_handoff aceitou_proposta', () => {
  const result = classifyConversationStage(ctx({
    perfil: { motivo_handoff: 'aceitou_proposta' },
  }))
  assertStage(result, 'closed')
})

test('lost: status perdido', () => {
  const result = classifyConversationStage(ctx({ status: 'perdido' }))
  assertStage(result, 'lost')
})

test('follow_up: tipo followup_auto', () => {
  const result = classifyConversationStage(ctx({ tipo: 'followup_auto' }))
  assertStage(result, 'follow_up')
})

// ─── Validação da estrutura de retorno ───────────────────────────────────────

test('retorno sempre tem stage e reason', () => {
  const result = classifyConversationStage(ctx({ texto: 'oi' }))
  assert.ok('stage' in result)
  assert.ok('reason' in result)
  assert.ok(VALID_STAGES.includes(result.stage))
})

test('stage resultante está sempre na lista de estágios válidos', () => {
  const cenarios = [
    ctx({ texto: 'quanto custa?', estagio: 'proposta' }),
    ctx({ texto: 'tá caro', estagio: 'proposta' }),
    ctx({ texto: 'oi', estagio: null, historico: [] }),
    ctx({ status: 'fechado' }),
    ctx({ status: 'perdido' }),
    ctx({ tipo: 'followup_auto' }),
    ctx({ texto: 'ok', estagio: 'diagnostico', historico: [{ role: 'assistant', content: 'Oi' }] }),
  ]
  for (const c of cenarios) {
    const result = classifyConversationStage(c)
    assert.ok(VALID_STAGES.includes(result.stage), `Stage inválido: "${result.stage}"`)
  }
})
