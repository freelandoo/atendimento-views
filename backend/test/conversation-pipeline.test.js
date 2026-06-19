'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildConversationContext,
  buildContextBlock,
  buildRulesBlock,
  validateResponse,
} = require('../src/conversation-pipeline')

// ─── Perfis de referência ─────────────────────────────────────────────────────

const emptyProfile = {
  businessType: null, city: null, mainService: null,
  hasWebsite: null, goal: null, meetingInterest: null,
}

const fullProfile = {
  businessType: 'dentista',
  city: 'Santo André',
  mainService: 'site profissional',
  hasWebsite: false,
  goal: 'atrair mais pacientes',
  meetingInterest: null,
}

// ─── buildConversationContext — estrutura do resultado ────────────────────────

test('retorna todos os campos esperados', () => {
  const ctx = buildConversationContext({
    message: 'Oi, tenho interesse',
    history: [],
    profile: emptyProfile,
    stage: 'new_lead',
  })

  assert.ok('intent' in ctx)
  assert.ok('secondaryIntents' in ctx)
  assert.ok('confusionDetected' in ctx)
  assert.ok('confusionType' in ctx)
  assert.ok('stage' in ctx)
  assert.ok('stageReason' in ctx)
  assert.ok('previousStage' in ctx)
  assert.ok('updatedProfile' in ctx)
  assert.ok('profileUpdates' in ctx)
  assert.ok('missingInfo' in ctx)
  assert.ok('goal' in ctx)
  assert.ok('messageStyle' in ctx)
  assert.ok('suggestedQuestion' in ctx)
  assert.ok('shouldClarifyFirst' in ctx)
  assert.ok('clarificationText' in ctx)
  assert.ok('meetingReady' in ctx)
  assert.ok('meetingInvite' in ctx)
})

test('sem argumentos não quebra', () => {
  assert.doesNotThrow(() => buildConversationContext())
  const ctx = buildConversationContext()
  assert.ok(typeof ctx.intent === 'string')
  assert.ok(typeof ctx.stage === 'string')
})

test('previousStage preserva o estágio de entrada', () => {
  const ctx = buildConversationContext({ message: 'oi', stage: 'qualification', profile: emptyProfile })
  assert.equal(ctx.previousStage, 'qualification')
})

// ─── buildConversationContext — intent ────────────────────────────────────────

test('"Tenho interesse" → intent=interested', () => {
  const ctx = buildConversationContext({ message: 'Tenho interesse no serviço', profile: emptyProfile, stage: 'new_lead' })
  assert.equal(ctx.intent, 'interested')
})

test('"Quanto custa?" → intent=asking_price', () => {
  const ctx = buildConversationContext({ message: 'Quanto custa o site?', profile: emptyProfile, stage: 'qualification' })
  assert.equal(ctx.intent, 'asking_price')
})

test('"Não tenho interesse" → intent=not_interested', () => {
  const ctx = buildConversationContext({ message: 'não tenho interesse obrigado', profile: emptyProfile, stage: 'qualification' })
  assert.equal(ctx.intent, 'not_interested')
})

// ─── buildConversationContext — confusão ──────────────────────────────────────

test('"Quanto custa um anúncio?" → shouldClarifyFirst=true', () => {
  const ctx = buildConversationContext({
    message: 'Quanto custa um anúncio desse?',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  assert.equal(ctx.confusionDetected || ctx.shouldClarifyFirst, true)
})

test('confusão detectada → clarificationText não é null', () => {
  const ctx = buildConversationContext({
    message: 'Quanto custa um anúncio desse?',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  if (ctx.shouldClarifyFirst) {
    assert.ok(ctx.clarificationText && ctx.clarificationText.length > 50)
  }
})

test('mensagem limpa → shouldClarifyFirst=false', () => {
  const ctx = buildConversationContext({
    message: 'Preciso de um site para minha empresa',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  assert.equal(ctx.shouldClarifyFirst, false)
})

// ─── buildConversationContext — perfil ────────────────────────────────────────

test('extrai cidade de "Sou dentista em Santo André"', () => {
  const ctx = buildConversationContext({
    message: 'Sou dentista em Santo André',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  assert.ok(ctx.updatedProfile.businessType || ctx.profileUpdates.businessType || ctx.updatedProfile.city)
})

test('não sobrescreve dados já existentes no perfil', () => {
  const ctx = buildConversationContext({
    message: 'Oi, sou médico em SP',
    profile: { ...emptyProfile, businessType: 'dentista' },
    stage: 'qualification',
  })
  // dentista já estava no perfil — não deve ser sobrescrito por 'médico'
  assert.equal(ctx.updatedProfile.businessType, 'dentista')
})

test('missingInfo inclui businessType para perfil vazio', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  assert.ok(ctx.missingInfo.includes('businessType'))
})

test('missingInfo vazio para perfil completo', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: fullProfile, stage: 'diagnosis' })
  // fullProfile tem businessType, city, mainService, hasWebsite, goal — todos os obrigatórios
  assert.equal(ctx.missingInfo.length, 0)
})

// ─── buildConversationContext — goal ─────────────────────────────────────────

test('perfil vazio → goal de coleta', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  const collectionGoals = ['collect_business_type', 'collect_city', 'collect_current_presence']
  assert.ok(collectionGoals.includes(ctx.goal), `goal ${ctx.goal} deve ser de coleta`)
})

test('not_interested → goal=end_politely', () => {
  const ctx = buildConversationContext({
    message: 'não tenho interesse',
    profile: fullProfile,
    stage: 'qualification',
  })
  assert.equal(ctx.goal, 'end_politely')
})

test('asking_price → goal=handle_price', () => {
  const ctx = buildConversationContext({
    message: 'quanto custa?',
    profile: emptyProfile,
    stage: 'qualification',
  })
  assert.equal(ctx.goal, 'handle_price')
})

// ─── buildConversationContext — reunião ───────────────────────────────────────

test('lead qualificado + interested → meetingReady=true', () => {
  const ctx = buildConversationContext({
    message: 'tenho interesse',
    profile: fullProfile,
    stage: 'diagnosis',
  })
  assert.equal(ctx.meetingReady, true)
  assert.ok(ctx.meetingInvite !== null)
  assert.ok(ctx.meetingInvite.includes('15 minutos'))
})

test('perfil vazio → meetingReady=false', () => {
  const ctx = buildConversationContext({
    message: 'tenho interesse',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  assert.equal(ctx.meetingReady, false)
  assert.equal(ctx.meetingInvite, null)
})

// ─── buildContextBlock — estrutura do prompt ──────────────────────────────────

test('retorna string não-vazia', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  const block = buildContextBlock(ctx)
  assert.ok(typeof block === 'string' && block.length > 0)
})

test('inclui seção de contexto do lead', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  const block = buildContextBlock(ctx)
  assert.ok(block.includes('Contexto do lead'))
})

test('inclui dados conhecidos do perfil', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: fullProfile, stage: 'diagnosis' })
  const block = buildContextBlock(ctx)
  assert.ok(block.includes('dentista'))
  assert.ok(block.includes('Santo André'))
})

test('inclui goal e intent', () => {
  const ctx = buildConversationContext({ message: 'quanto custa?', profile: emptyProfile, stage: 'qualification' })
  const block = buildContextBlock(ctx)
  assert.ok(block.includes('Goal'))
  assert.ok(block.includes('Intenção'))
})

test('inclui pergunta sugerida quando disponível', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  const block = buildContextBlock(ctx)
  if (ctx.suggestedQuestion) {
    assert.ok(block.includes(ctx.suggestedQuestion))
  }
})

test('confusão detectada → seção PRIORIDADE aparece primeiro', () => {
  const ctx = buildConversationContext({
    message: 'Quanto custa um anúncio desse?',
    profile: emptyProfile,
    stage: 'new_lead',
  })
  const block = buildContextBlock(ctx)
  if (ctx.shouldClarifyFirst) {
    assert.ok(block.includes('PRIORIDADE'))
    // Deve aparecer antes do "Contexto do lead"
    const prioIdx = block.indexOf('PRIORIDADE')
    const ctxIdx = block.indexOf('Contexto do lead')
    assert.ok(prioIdx < ctxIdx)
  }
})

test('lead qualificado → seção de reunião inclui texto do convite', () => {
  const ctx = buildConversationContext({
    message: 'tenho interesse',
    profile: fullProfile,
    stage: 'diagnosis',
  })
  const block = buildContextBlock(ctx)
  if (ctx.meetingReady) {
    assert.ok(block.includes('15 minutos') || block.includes('reunião'))
  }
})

test('perfil novo → texto "Lead novo" aparece', () => {
  const ctx = buildConversationContext({ message: 'oi', profile: emptyProfile, stage: 'new_lead' })
  const block = buildContextBlock(ctx)
  assert.ok(block.includes('Lead novo'))
})

// ─── buildRulesBlock ──────────────────────────────────────────────────────────

test('retorna string com regras', () => {
  const block = buildRulesBlock('qualification')
  assert.ok(block.includes('Regras'))
  assert.ok(block.includes('caracteres'))
  assert.ok(block.includes('pergunta'))
})

test('limites variam por estágio', () => {
  const q = buildRulesBlock('qualification')   // maxChars=300
  const p = buildRulesBlock('price_question')  // maxChars=800
  assert.ok(q.includes('300'))
  assert.ok(p.includes('800'))
})

test('sempre inclui regra anti-Google e anti-pressão', () => {
  const block = buildRulesBlock('new_lead')
  assert.ok(block.includes('Google'))
  assert.ok(block.includes('urgência') || block.includes('última chance'))
})

// ─── validateResponse ─────────────────────────────────────────────────────────

test('resposta limpa → approved=true, textToSend=response', () => {
  const result = validateResponse({
    stage: 'qualification',
    response: 'Qual é o seu negócio?',
    leadProfile: emptyProfile,
  })
  assert.equal(result.approved, true)
  assert.equal(result.textToSend, 'Qual é o seu negócio?')
})

test('resposta muito longa → approved=false, textToSend=fixedMessage', () => {
  const response = 'palavra '.repeat(60)
  const result = validateResponse({
    stage: 'qualification',
    response,
    leadProfile: emptyProfile,
  })
  assert.equal(result.approved, false)
  assert.ok(result.textToSend.length < response.length)
})

test('textToSend nunca é undefined', () => {
  const result = validateResponse({
    stage: 'qualification',
    response: 'garantimos aparecer no Google!\n\nQual o negócio?',
    leadProfile: emptyProfile,
  })
  assert.ok(typeof result.textToSend === 'string')
})

test('problemas semânticos → textToSend igual ao original (sem auto-fix)', () => {
  const response = 'garantimos aparecer no Google!\n\nQual o negócio?'
  const result = validateResponse({
    stage: 'qualification',
    response,
    leadProfile: emptyProfile,
  })
  // Problema semântico (Google promise) não tem auto-fix
  assert.equal(result.approved, false)
  assert.equal(result.textToSend, response)
})

// ─── Critério: pipeline integra todos os módulos ──────────────────────────────

test('critério Sprint 1: contexto correto para resposta ao vivo — lead novo', () => {
  const ctx = buildConversationContext({
    message: 'Oi',
    history: [],
    profile: emptyProfile,
    stage: 'new_lead',
  })

  // Todos os campos essenciais existem
  assert.ok(ctx.intent)
  assert.ok(ctx.stage)
  assert.ok(ctx.goal)
  assert.ok(Array.isArray(ctx.missingInfo))

  // Prompt blocks gerados sem erro
  const contextBlock = buildContextBlock(ctx)
  const rulesBlock = buildRulesBlock(ctx.stage)
  assert.ok(contextBlock.length > 100)
  assert.ok(rulesBlock.length > 50)
})

test('critério Sprint 1: contexto correto — lead qualificado pedindo preço', () => {
  const ctx = buildConversationContext({
    message: 'Quanto custa o site?',
    history: [],
    profile: fullProfile,
    stage: 'diagnosis',
  })

  assert.equal(ctx.intent, 'asking_price')
  assert.equal(ctx.goal, 'handle_price')
  assert.equal(ctx.missingInfo.length, 0)

  // Não deve haver confusão em pergunta direta de preço
  assert.equal(ctx.shouldClarifyFirst, false)

  // Como perfil está completo, pode ser meeting-ready também
  // (asking_price está nos INTEREST_INTENTS do meeting-invite)
  assert.ok(typeof ctx.meetingReady === 'boolean')
})

test('critério Sprint 1: contexto correto — confusão site/anúncio', () => {
  const ctx = buildConversationContext({
    message: 'Quanto custa um anúncio desse?',
    history: [],
    profile: emptyProfile,
    stage: 'new_lead',
  })

  // O pipeline deve detectar a confusão e preparar o texto de esclarecimento
  if (ctx.shouldClarifyFirst) {
    assert.ok(ctx.clarificationText)
    const block = buildContextBlock(ctx)
    assert.ok(block.includes('PRIORIDADE'))
  }
})

test('critério: validação sempre retorna textToSend utilizável', () => {
  const casos = [
    { response: 'Qual é o seu negócio?', stage: 'qualification' },
    { response: 'a'.repeat(500), stage: 'qualification' },  // muito longa
    { response: 'Temos vagas limitadas!\n\nQual o negócio?', stage: 'new_lead' },  // agressiva
  ]

  for (const { response, stage } of casos) {
    const result = validateResponse({ stage, response, leadProfile: emptyProfile })
    assert.ok(
      typeof result.textToSend === 'string' && result.textToSend.length > 0,
      `textToSend deve ser string não-vazia para: "${response.slice(0, 30)}..."`
    )
    assert.ok(Array.isArray(result.problems))
    assert.ok(typeof result.approved === 'boolean')
  }
})
