'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  GOALS,
  MESSAGE_STYLES,
  GOAL_STYLE,
  GOAL_QUESTION,
  selectGoal,
} = require('../src/goal-selector')

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Perfil completamente vazio (tudo null)
const emptyProfile = {
  businessType: null,
  city: null,
  mainService: null,
  hasWebsite: null,
  usesInstagram: null,
  usesWhatsApp: null,
  goal: null,
}

// Perfil completo (tudo preenchido)
const fullProfile = {
  businessType: 'dentista',
  city: 'Santo André',
  mainService: 'site profissional',
  hasWebsite: false,
  usesInstagram: true,
  usesWhatsApp: true,
  goal: 'atrair mais clientes',
}

// Perfil parcial: tem negócio, falta tudo o mais
const profileWithBusiness = { ...emptyProfile, businessType: 'salão de beleza' }

// Perfil com negócio + cidade, falta presença
const profileWithBusinessAndCity = {
  ...emptyProfile,
  businessType: 'salão',
  city: 'SP',
}

// Perfil meeting-ready: tem negócio + presença conhecida
const profileMeetingReady = {
  ...emptyProfile,
  businessType: 'clínica odontológica',
  city: 'Campinas',
  hasWebsite: false,
}

// ─── Formato do resultado ─────────────────────────────────────────────────────

test('resultado sempre tem goal, messageStyle e question', () => {
  const result = selectGoal({ stage: 'new_lead', intent: 'greeting', profile: emptyProfile })
  assert.ok('goal' in result)
  assert.ok('messageStyle' in result)
  assert.ok('question' in result)
})

test('goal nunca é null/undefined', () => {
  const casos = [
    { stage: 'new_lead', intent: 'greeting', profile: emptyProfile },
    { stage: 'qualification', intent: 'interested', profile: fullProfile },
    { stage: 'price_question', intent: 'asking_price', profile: fullProfile },
    { stage: 'lost', intent: 'not_interested', profile: fullProfile },
  ]
  for (const params of casos) {
    const result = selectGoal(params)
    assert.ok(result.goal, `goal não pode ser falsy para: ${JSON.stringify(params)}`)
  }
})

test('messageStyle é um dos valores válidos', () => {
  const validStyles = Object.values(MESSAGE_STYLES)
  const result = selectGoal({ stage: 'new_lead', intent: 'greeting', profile: emptyProfile })
  assert.ok(validStyles.includes(result.messageStyle))
})

// ─── Estados terminais ────────────────────────────────────────────────────────

test('stage=lost → end_politely', () => {
  const result = selectGoal({ stage: 'lost', intent: 'unclear', profile: fullProfile })
  assert.equal(result.goal, GOALS.END_POLITELY)
})

test('stage=closed → end_politely', () => {
  const result = selectGoal({ stage: 'closed', intent: 'unclear', profile: fullProfile })
  assert.equal(result.goal, GOALS.END_POLITELY)
})

test('intent=not_interested → end_politely', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'not_interested', profile: fullProfile })
  assert.equal(result.goal, GOALS.END_POLITELY)
})

test('end_politely: question é null', () => {
  const result = selectGoal({ stage: 'lost', intent: 'not_interested', profile: fullProfile })
  assert.equal(result.question, null)
})

test('end_politely: messageStyle é warm', () => {
  const result = selectGoal({ stage: 'lost', intent: 'not_interested', profile: fullProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.WARM)
})

// ─── Agendamento em andamento ─────────────────────────────────────────────────

test('stage=meeting_scheduled → schedule_meeting', () => {
  const result = selectGoal({ stage: 'meeting_scheduled', intent: 'interested', profile: fullProfile })
  assert.equal(result.goal, GOALS.SCHEDULE_MEETING)
})

test('schedule_meeting: messageStyle é direct', () => {
  const result = selectGoal({ stage: 'meeting_scheduled', intent: 'interested', profile: fullProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.DIRECT)
})

test('schedule_meeting: question não é null', () => {
  const result = selectGoal({ stage: 'meeting_scheduled', intent: 'interested', profile: fullProfile })
  assert.ok(result.question !== null && result.question.length > 0)
})

// ─── Objeções ─────────────────────────────────────────────────────────────────

test('intent=objection_price → handle_objection', () => {
  const result = selectGoal({ stage: 'objection', intent: 'objection_price', profile: fullProfile })
  assert.equal(result.goal, GOALS.HANDLE_OBJECTION)
})

test('intent=objection_time → handle_objection', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'objection_time', profile: emptyProfile })
  assert.equal(result.goal, GOALS.HANDLE_OBJECTION)
})

test('intent=objection_trust → handle_objection', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'objection_trust', profile: emptyProfile })
  assert.equal(result.goal, GOALS.HANDLE_OBJECTION)
})

test('handle_objection: messageStyle é empathetic', () => {
  const result = selectGoal({ stage: 'objection', intent: 'objection_price', profile: fullProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.EMPATHETIC)
})

test('objection_price: question menciona orçamento', () => {
  const result = selectGoal({ stage: 'objection', intent: 'objection_price', profile: fullProfile })
  assert.ok(result.question && result.question.toLowerCase().includes('orçamento'))
})

test('objection_trust: question menciona projetos', () => {
  const result = selectGoal({ stage: 'objection', intent: 'objection_trust', profile: fullProfile })
  assert.ok(result.question && result.question.toLowerCase().includes('projetos'))
})

test('objeção tem prioridade sobre coleta de dados (perfil vazio)', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'objection_price', profile: emptyProfile })
  assert.equal(result.goal, GOALS.HANDLE_OBJECTION)
})

// ─── Pergunta de preço ────────────────────────────────────────────────────────

test('intent=asking_price → handle_price', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'asking_price', profile: emptyProfile })
  assert.equal(result.goal, GOALS.HANDLE_PRICE)
})

test('stage=price_question → handle_price (mesmo sem intent)', () => {
  const result = selectGoal({ stage: 'price_question', intent: 'unclear', profile: fullProfile })
  assert.equal(result.goal, GOALS.HANDLE_PRICE)
})

test('handle_price: messageStyle é detailed', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'asking_price', profile: emptyProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.DETAILED)
})

test('handle_price: question convida para orçamento', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'asking_price', profile: emptyProfile })
  assert.ok(result.question && result.question.length > 0)
})

test('preço tem prioridade sobre coleta de dados', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'asking_price', profile: emptyProfile })
  assert.equal(result.goal, GOALS.HANDLE_PRICE)
})

// ─── Oferta de reunião ────────────────────────────────────────────────────────

test('stage=meeting_offer → offer_meeting', () => {
  const result = selectGoal({ stage: 'meeting_offer', intent: 'interested', profile: fullProfile })
  assert.equal(result.goal, GOALS.OFFER_MEETING)
})

test('intent=wants_meeting → offer_meeting', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'wants_meeting', profile: emptyProfile })
  assert.equal(result.goal, GOALS.OFFER_MEETING)
})

test('lead com negócio + presença + intent positivo → offer_meeting', () => {
  const result = selectGoal({ stage: 'diagnosis', intent: 'interested', profile: profileMeetingReady })
  assert.equal(result.goal, GOALS.OFFER_MEETING)
})

test('offer_meeting: messageStyle é direct', () => {
  const result = selectGoal({ stage: 'meeting_offer', intent: 'interested', profile: fullProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.DIRECT)
})

test('offer_meeting: question pergunta sobre horário', () => {
  const result = selectGoal({ stage: 'meeting_offer', intent: 'interested', profile: fullProfile })
  assert.ok(result.question && result.question.toLowerCase().includes('horário'))
})

test('lead sem negócio e intent interested NÃO vai para offer_meeting', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'interested', profile: emptyProfile })
  assert.notEqual(result.goal, GOALS.OFFER_MEETING)
})

// ─── Coleta de dados — businessType ──────────────────────────────────────────

test('businessType e city faltando → collect_business_type com pergunta combinada', () => {
  const result = selectGoal({ stage: 'new_lead', intent: 'greeting', profile: emptyProfile })
  assert.equal(result.goal, GOALS.COLLECT_BUSINESS_TYPE)
  assert.ok(result.question && result.question.includes('negócio'))
  assert.ok(result.question.includes('cidade'))
})

test('spec: businessType + city faltando → question exata do exemplo', () => {
  const result = selectGoal({ stage: 'new_lead', intent: 'interested', profile: emptyProfile })
  assert.equal(result.goal, GOALS.COLLECT_BUSINESS_TYPE)
  assert.equal(result.question, 'Qual é o seu negócio e em qual cidade você atende?')
})

test('só businessType faltando (tem city) → pergunta simples', () => {
  const profile = { ...emptyProfile, city: 'São Paulo' }
  const result = selectGoal({ stage: 'new_lead', intent: 'greeting', profile })
  assert.equal(result.goal, GOALS.COLLECT_BUSINESS_TYPE)
  assert.ok(result.question && !result.question.includes('cidade'))
})

test('collect_business_type: messageStyle é short', () => {
  const result = selectGoal({ stage: 'new_lead', intent: 'greeting', profile: emptyProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.SHORT)
})

// ─── Coleta de dados — city ───────────────────────────────────────────────────

test('businessType preenchido, city faltando → collect_city', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'interested', profile: profileWithBusiness })
  assert.equal(result.goal, GOALS.COLLECT_CITY)
})

test('collect_city: question menciona cidade', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'interested', profile: profileWithBusiness })
  assert.ok(result.question && result.question.toLowerCase().includes('cidade'))
})

test('collect_city: messageStyle é short', () => {
  const result = selectGoal({ stage: 'qualification', intent: 'interested', profile: profileWithBusiness })
  assert.equal(result.messageStyle, MESSAGE_STYLES.SHORT)
})

// ─── Coleta de dados — presença atual ────────────────────────────────────────

test('businessType + city preenchidos, hasWebsite null → collect_current_presence', () => {
  const result = selectGoal({ stage: 'diagnosis', intent: 'interested', profile: profileWithBusinessAndCity })
  assert.equal(result.goal, GOALS.COLLECT_CURRENT_PRESENCE)
})

test('collect_current_presence: question menciona site e Instagram', () => {
  const result = selectGoal({ stage: 'diagnosis', intent: 'interested', profile: profileWithBusinessAndCity })
  assert.ok(result.question && result.question.toLowerCase().includes('site'))
  assert.ok(result.question.includes('Instagram'))
})

test('collect_current_presence: messageStyle é short', () => {
  const result = selectGoal({ stage: 'diagnosis', intent: 'interested', profile: profileWithBusinessAndCity })
  assert.equal(result.messageStyle, MESSAGE_STYLES.SHORT)
})

// ─── Explicação da solução ────────────────────────────────────────────────────

test('perfil completo + intent neutro (greeting) → explain_solution', () => {
  // greeting não está em positiveIntents, então não dispara offer_meeting
  const result = selectGoal({ stage: 'solution_explanation', intent: 'greeting', profile: fullProfile })
  assert.equal(result.goal, GOALS.EXPLAIN_SOLUTION)
})

test('explain_solution: messageStyle é warm', () => {
  const result = selectGoal({ stage: 'solution_explanation', intent: 'greeting', profile: fullProfile })
  assert.equal(result.messageStyle, MESSAGE_STYLES.WARM)
})

test('explain_solution: question é string não-vazia', () => {
  const result = selectGoal({ stage: 'solution_explanation', intent: 'greeting', profile: fullProfile })
  assert.ok(typeof result.question === 'string' && result.question.length > 0)
})

test('perfil completo + asking_how_it_works → offer_meeting (lead qualificado)', () => {
  // lead com dados completos + intenção positiva é encaminhado para reunião
  const result = selectGoal({ stage: 'solution_explanation', intent: 'asking_how_it_works', profile: fullProfile })
  assert.equal(result.goal, GOALS.OFFER_MEETING)
})

// ─── Prioridade de objetivos ──────────────────────────────────────────────────

test('lost tem prioridade sobre objeção', () => {
  const result = selectGoal({ stage: 'lost', intent: 'objection_price', profile: emptyProfile })
  assert.equal(result.goal, GOALS.END_POLITELY)
})

test('meeting_scheduled tem prioridade sobre objeção', () => {
  const result = selectGoal({ stage: 'meeting_scheduled', intent: 'objection_price', profile: fullProfile })
  assert.equal(result.goal, GOALS.SCHEDULE_MEETING)
})

test('objeção tem prioridade sobre preço', () => {
  // intents podem ser combinados em situações reais — objeção ganha
  const result = selectGoal({ stage: 'price_question', intent: 'objection_price', profile: fullProfile })
  assert.equal(result.goal, GOALS.HANDLE_OBJECTION)
})

test('preço tem prioridade sobre oferta de reunião via stage', () => {
  // asking_price ganha sobre meeting_offer quando ambos poderiam se aplicar
  const result = selectGoal({ stage: 'price_question', intent: 'asking_price', profile: fullProfile })
  assert.equal(result.goal, GOALS.HANDLE_PRICE)
})

// ─── Inputs inválidos / edge cases ───────────────────────────────────────────

test('profile ausente não quebra', () => {
  assert.doesNotThrow(() => selectGoal({ stage: 'new_lead', intent: 'greeting' }))
})

test('intentResult ausente não quebra', () => {
  assert.doesNotThrow(() => selectGoal({ stage: 'new_lead', intent: 'greeting', profile: emptyProfile }))
})

test('intent desconhecido com perfil vazio → collect_business_type', () => {
  const result = selectGoal({ stage: 'new_lead', intent: 'algum_intent_inventado', profile: emptyProfile })
  assert.equal(result.goal, GOALS.COLLECT_BUSINESS_TYPE)
})

// ─── Constantes exportadas ────────────────────────────────────────────────────

test('GOALS tem 9 valores únicos', () => {
  const values = Object.values(GOALS)
  assert.equal(values.length, 9)
  assert.equal(new Set(values).size, 9)
})

test('MESSAGE_STYLES tem 5 valores', () => {
  assert.equal(Object.values(MESSAGE_STYLES).length, 5)
})

test('GOAL_STYLE cobre todos os GOALS', () => {
  for (const goal of Object.values(GOALS)) {
    assert.ok(goal in GOAL_STYLE, `GOAL_STYLE não cobre: ${goal}`)
  }
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: nenhuma resposta sem objetivo claro — varredura de casos reais', () => {
  const casos = [
    // Novo lead sem info
    { stage: 'new_lead', intent: 'greeting', profile: emptyProfile },
    // Lead interessado, sem dados
    { stage: 'qualification', intent: 'interested', profile: emptyProfile },
    // Lead perguntou preço sem contexto
    { stage: 'qualification', intent: 'asking_price', profile: emptyProfile },
    // Lead tem negócio, falta cidade
    { stage: 'qualification', intent: 'interested', profile: profileWithBusiness },
    // Lead tem negócio e cidade, falta presença
    { stage: 'diagnosis', intent: 'interested', profile: profileWithBusinessAndCity },
    // Lead completo, curioso sobre solução
    { stage: 'solution_explanation', intent: 'asking_how_it_works', profile: fullProfile },
    // Lead completo querendo reunião
    { stage: 'meeting_offer', intent: 'wants_meeting', profile: fullProfile },
    // Agendamento em curso
    { stage: 'meeting_scheduled', intent: 'interested', profile: fullProfile },
    // Objeção de preço
    { stage: 'objection', intent: 'objection_price', profile: fullProfile },
    // Lead não interessado
    { stage: 'qualification', intent: 'not_interested', profile: fullProfile },
    // Conversa encerrada
    { stage: 'closed', intent: 'unclear', profile: fullProfile },
  ]

  for (const params of casos) {
    const result = selectGoal(params)
    assert.ok(
      result.goal && typeof result.goal === 'string',
      `objetivo deve ser string não-vazia para: stage=${params.stage} intent=${params.intent}`
    )
    assert.ok(
      result.messageStyle && typeof result.messageStyle === 'string',
      `messageStyle deve ser string não-vazia para: ${params.stage}`
    )
    assert.ok(
      'question' in result,
      `campo question deve existir para: ${params.stage}`
    )
  }
})
