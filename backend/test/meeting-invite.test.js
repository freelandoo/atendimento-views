'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MEETING_RULES,
  INTEREST_INTENTS,
  BLOCKING_STAGES,
  isMeetingDay,
  isQualifiedForMeeting,
  getQualificationGaps,
  shouldOfferMeeting,
  getAvailableSlots,
  buildMeetingInvite,
} = require('../src/meeting-invite')

// ─── Datas de referência ──────────────────────────────────────────────────────

const MONDAY    = new Date(2024, 0, 1)   // Segunda-feira
const TUESDAY   = new Date(2024, 0, 2)   // Terça
const WEDNESDAY = new Date(2024, 0, 3)   // Quarta
const THURSDAY  = new Date(2024, 0, 4)   // Quinta
const FRIDAY    = new Date(2024, 0, 5)   // Sexta
const SATURDAY  = new Date(2024, 0, 6)   // Sábado
const SUNDAY    = new Date(2024, 0, 7)   // Domingo

// ─── Perfis de referência ─────────────────────────────────────────────────────

const emptyProfile = {
  businessType: null, city: null, mainService: null,
  hasWebsite: null, goal: null, meetingInterest: null,
}

// Atende os 4 critérios via goal
const qualifiedViaGoal = {
  businessType: 'dentista',
  city: 'Santo André',
  mainService: null,
  hasWebsite: null,
  goal: 'atrair mais pacientes',
  meetingInterest: null,
}

// Atende os 4 critérios via mainService
const qualifiedViaService = {
  businessType: 'salão de beleza',
  city: 'Campinas',
  mainService: 'site profissional',
  hasWebsite: null,
  goal: null,
  meetingInterest: null,
}

// Atende os 4 critérios via presença conhecida (hasWebsite=false = dor clara)
const qualifiedViaPresence = {
  businessType: 'clínica',
  city: 'SP',
  mainService: null,
  hasWebsite: false,
  goal: null,
  meetingInterest: null,
}

// Falta apenas cidade
const profileNeedsCity = { ...qualifiedViaGoal, city: null }

// Falta apenas interesse (sem goal/service/presence)
const profileNeedsPain = {
  businessType: 'pet shop',
  city: 'BH',
  mainService: null,
  hasWebsite: null,
  goal: null,
  meetingInterest: null,
}

// ─── MEETING_RULES ────────────────────────────────────────────────────────────

test('MEETING_RULES tem os valores do spec', () => {
  assert.equal(MEETING_RULES.durationMinutes, 15)
  assert.deepEqual(MEETING_RULES.allowedDays, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
  assert.equal(MEETING_RULES.startTime, '19:30')
  assert.equal(MEETING_RULES.endTime, '21:30')
})

// ─── isMeetingDay ─────────────────────────────────────────────────────────────

test('segunda → dia permitido', () => {
  assert.equal(isMeetingDay(MONDAY), true)
})

test('terça → dia permitido', () => {
  assert.equal(isMeetingDay(TUESDAY), true)
})

test('quarta → dia permitido', () => {
  assert.equal(isMeetingDay(WEDNESDAY), true)
})

test('quinta → dia permitido', () => {
  assert.equal(isMeetingDay(THURSDAY), true)
})

test('sexta → dia permitido', () => {
  assert.equal(isMeetingDay(FRIDAY), true)
})

test('sábado → dia bloqueado', () => {
  assert.equal(isMeetingDay(SATURDAY), false)
})

test('domingo → dia bloqueado', () => {
  assert.equal(isMeetingDay(SUNDAY), false)
})

// ─── isQualifiedForMeeting ────────────────────────────────────────────────────

test('4 critérios atendidos (goal) + interested → qualificado', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaGoal, 'interested'), true)
})

test('4 critérios atendidos (mainService) + asking_price → qualificado', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaService, 'asking_price'), true)
})

test('4 critérios atendidos (presença) + asking_how_it_works → qualificado', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaPresence, 'asking_how_it_works'), true)
})

test('intent=wants_meeting já qualifica com perfil básico', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaGoal, 'wants_meeting'), true)
})

test('intent=sent_business_info qualifica', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaGoal, 'sent_business_info'), true)
})

test('meetingInterest=true no perfil substitui intent de interesse', () => {
  const profile = { ...qualifiedViaGoal, meetingInterest: true }
  assert.equal(isQualifiedForMeeting(profile, 'unclear'), true)
})

test('falta businessType → não qualificado', () => {
  const profile = { ...qualifiedViaGoal, businessType: null }
  assert.equal(isQualifiedForMeeting(profile, 'interested'), false)
})

test('falta city → não qualificado', () => {
  assert.equal(isQualifiedForMeeting(profileNeedsCity, 'interested'), false)
})

test('intent neutro (greeting) sem meetingInterest → não qualificado', () => {
  assert.equal(isQualifiedForMeeting(qualifiedViaGoal, 'greeting'), false)
})

test('nenhum indicador de dor/objetivo → não qualificado', () => {
  // profileNeedsPain tem negócio + cidade mas sem goal/service/presença
  assert.equal(isQualifiedForMeeting(profileNeedsPain, 'interested'), false)
})

test('hasWebsite=true (presença positiva) também qualifica como dor/objetivo', () => {
  const profile = { ...profileNeedsPain, hasWebsite: true }
  assert.equal(isQualifiedForMeeting(profile, 'interested'), true)
})

test('hasWebsite=null (presença desconhecida) NÃO qualifica como dor/objetivo', () => {
  // null = não sabemos → ainda precisamos coletar
  assert.equal(isQualifiedForMeeting(profileNeedsPain, 'interested'), false)
})

test('perfil vazio → não qualificado', () => {
  assert.equal(isQualifiedForMeeting(emptyProfile, 'interested'), false)
})

test('sem argumentos não quebra', () => {
  assert.doesNotThrow(() => isQualifiedForMeeting())
  assert.equal(isQualifiedForMeeting(), false)
})

// ─── getQualificationGaps ─────────────────────────────────────────────────────

test('perfil vazio com greeting → 4 gaps', () => {
  const gaps = getQualificationGaps(emptyProfile, 'greeting')
  assert.equal(gaps.length, 4)
  assert.ok(gaps.includes('businessType'))
  assert.ok(gaps.includes('city'))
  assert.ok(gaps.includes('interest'))
  assert.ok(gaps.includes('painOrGoal'))
})

test('perfil qualificado → 0 gaps', () => {
  const gaps = getQualificationGaps(qualifiedViaGoal, 'interested')
  assert.equal(gaps.length, 0)
})

test('falta só city → 1 gap', () => {
  const gaps = getQualificationGaps(profileNeedsCity, 'interested')
  assert.deepEqual(gaps, ['city'])
})

test('falta só interesse → retorna interest no gaps', () => {
  const gaps = getQualificationGaps(qualifiedViaGoal, 'greeting')
  assert.deepEqual(gaps, ['interest'])
})

test('falta só painOrGoal → retorna painOrGoal no gaps', () => {
  const gaps = getQualificationGaps(profileNeedsPain, 'interested')
  assert.deepEqual(gaps, ['painOrGoal'])
})

// ─── shouldOfferMeeting ───────────────────────────────────────────────────────

test('lead qualificado em estágio normal → deve oferecer reunião', () => {
  assert.equal(shouldOfferMeeting('diagnosis', 'interested', qualifiedViaGoal), true)
})

test('stage=lost bloqueia mesmo com lead qualificado', () => {
  assert.equal(shouldOfferMeeting('lost', 'interested', qualifiedViaGoal), false)
})

test('stage=closed bloqueia', () => {
  assert.equal(shouldOfferMeeting('closed', 'interested', qualifiedViaGoal), false)
})

test('stage=meeting_scheduled bloqueia (reunião já marcada)', () => {
  assert.equal(shouldOfferMeeting('meeting_scheduled', 'interested', qualifiedViaGoal), false)
})

test('lead não qualificado → não oferece reunião', () => {
  assert.equal(shouldOfferMeeting('qualification', 'interested', emptyProfile), false)
})

test('BLOCKING_STAGES exportado tem os 3 estágios esperados', () => {
  assert.ok(BLOCKING_STAGES.includes('lost'))
  assert.ok(BLOCKING_STAGES.includes('closed'))
  assert.ok(BLOCKING_STAGES.includes('meeting_scheduled'))
})

// ─── getAvailableSlots ────────────────────────────────────────────────────────

test('dia útil → retorna slots no intervalo', () => {
  const slots = getAvailableSlots(MONDAY)
  assert.ok(slots.length > 0)
  assert.ok(slots.includes('19:30'))
  assert.ok(slots.includes('21:30'))
})

test('slots com intervalo de 30min: 19:30, 20:00, 20:30, 21:00, 21:30', () => {
  const slots = getAvailableSlots(TUESDAY, 30)
  assert.deepEqual(slots, ['19:30', '20:00', '20:30', '21:00', '21:30'])
})

test('primeiro slot é o startTime', () => {
  const slots = getAvailableSlots(WEDNESDAY)
  assert.equal(slots[0], MEETING_RULES.startTime)
})

test('último slot é o endTime', () => {
  const slots = getAvailableSlots(THURSDAY)
  assert.equal(slots[slots.length - 1], MEETING_RULES.endTime)
})

test('sábado → array vazio', () => {
  assert.deepEqual(getAvailableSlots(SATURDAY), [])
})

test('domingo → array vazio', () => {
  assert.deepEqual(getAvailableSlots(SUNDAY), [])
})

test('intervalo de 60min resulta em menos slots', () => {
  const slots30 = getAvailableSlots(FRIDAY, 30)
  const slots60 = getAvailableSlots(FRIDAY, 60)
  assert.ok(slots60.length < slots30.length)
})

// ─── buildMeetingInvite ───────────────────────────────────────────────────────

test('texto do spec: 3 parágrafos separados por \\n\\n', () => {
  const text = buildMeetingInvite({ date: MONDAY })
  const paragraphs = text.split('\n\n')
  assert.equal(paragraphs.length, 3)
})

test('parágrafo 1: menciona "melhor formato para sua empresa"', () => {
  const text = buildMeetingInvite({ date: MONDAY })
  assert.ok(text.includes('melhor formato para sua empresa'))
})

test('parágrafo 2: menciona duração de 15 minutos', () => {
  const text = buildMeetingInvite({ date: MONDAY })
  assert.ok(text.includes('15 minutos'))
})

test('parágrafo 3 (dia útil): começa com "Hoje" e menciona horário', () => {
  const text = buildMeetingInvite({ date: TUESDAY })
  const lastPara = text.split('\n\n')[2]
  assert.ok(lastPara.startsWith('Hoje'))
  assert.ok(lastPara.includes('19:30'))
  assert.ok(lastPara.includes('21:30'))
})

test('parágrafo 3 (fim de semana): não usa "Hoje", pede dia e horário', () => {
  const text = buildMeetingInvite({ date: SATURDAY })
  const lastPara = text.split('\n\n')[2]
  assert.ok(!lastPara.startsWith('Hoje'))
  assert.ok(lastPara.includes('dia'))
})

test('texto exato do spec (dia útil)', () => {
  const expected = [
    'Pelo que você explicou, faz sentido eu te mostrar o melhor formato para sua empresa.',
    'A reunião é rápida, coisa de 15 minutos, só para eu te apresentar uma proposta mais certeira.',
    'Hoje consigo entre 19:30 e 21:30. Qual horário fica melhor?',
  ].join('\n\n')
  assert.equal(buildMeetingInvite({ date: MONDAY }), expected)
})

test('sem argumentos não quebra', () => {
  assert.doesNotThrow(() => buildMeetingInvite())
})

// ─── INTEREST_INTENTS ─────────────────────────────────────────────────────────

test('INTEREST_INTENTS tem 5 intents', () => {
  assert.equal(INTEREST_INTENTS.length, 5)
})

test('INTEREST_INTENTS inclui os intents esperados', () => {
  assert.ok(INTEREST_INTENTS.includes('interested'))
  assert.ok(INTEREST_INTENTS.includes('asking_price'))
  assert.ok(INTEREST_INTENTS.includes('wants_meeting'))
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: IA para de explicar e oferece reunião quando lead está qualificado', () => {
  const casos = [
    // Dentista com objetivo claro
    {
      stage: 'solution_explanation',
      intent: 'interested',
      profile: qualifiedViaGoal,
      expectMeeting: true,
    },
    // Salão perguntando preço
    {
      stage: 'price_question',
      intent: 'asking_price',
      profile: qualifiedViaService,
      expectMeeting: true,
    },
    // Clínica sem site (dor clara)
    {
      stage: 'diagnosis',
      intent: 'asking_how_it_works',
      profile: qualifiedViaPresence,
      expectMeeting: true,
    },
    // Lead explicitamente quer reunião
    {
      stage: 'qualification',
      intent: 'wants_meeting',
      profile: qualifiedViaGoal,
      expectMeeting: true,
    },
  ]

  for (const { stage, intent, profile, expectMeeting } of casos) {
    const qualified = isQualifiedForMeeting(profile, intent)
    const offer = shouldOfferMeeting(stage, intent, profile)
    assert.equal(qualified, expectMeeting, `isQualified errado para: ${stage}/${intent}`)
    assert.equal(offer, expectMeeting, `shouldOffer errado para: ${stage}/${intent}`)

    if (expectMeeting) {
      const text = buildMeetingInvite({ profile })
      assert.ok(text.includes('15 minutos'), `convite deve mencionar 15 minutos`)
      assert.ok(text.includes('?'), `convite deve terminar com pergunta`)
    }
  }
})

test('critério: nunca oferece reunião quando lead ainda não está qualificado', () => {
  const casos = [
    { stage: 'new_lead', intent: 'greeting', profile: emptyProfile },
    { stage: 'qualification', intent: 'interested', profile: emptyProfile },
    { stage: 'qualification', intent: 'interested', profile: profileNeedsCity },
    { stage: 'qualification', intent: 'interested', profile: profileNeedsPain },
  ]

  for (const { stage, intent, profile } of casos) {
    assert.equal(
      shouldOfferMeeting(stage, intent, profile),
      false,
      `não deve oferecer reunião para: stage=${stage} businessType=${profile.businessType} city=${profile.city}`
    )
  }
})

test('critério: convite tem os 3 elementos do spec', () => {
  const text = buildMeetingInvite({ date: WEDNESDAY })
  // 1. Contexto — por que faz sentido
  assert.ok(text.includes('faz sentido'))
  // 2. Duração — desmistifica o compromisso
  assert.ok(text.includes('15 minutos'))
  // 3. Pergunta de fechamento
  assert.ok(text.includes('Qual'))
})
