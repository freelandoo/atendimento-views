'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FOLLOW_UPS,
  BLOCKING_STAGES,
  getFollowUpByStep,
  getNextFollowUp,
  isFollowUpDue,
  shouldSendFollowUp,
  buildFollowUpMessage,
} = require('../src/follow-up')

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Cria um clock fake que retorna `now` fixo
const fakeClock = (now) => () => now

// Calcula timestamp passado subtraindo horas de "agora"
const hoursAgo = (h, now = Date.now()) => new Date(now - h * 3_600_000)

// ─── FOLLOW_UPS — constante do spec ──────────────────────────────────────────

test('FOLLOW_UPS tem 4 steps', () => {
  assert.equal(FOLLOW_UPS.length, 4)
})

test('step 1: 3h, retomar diagnóstico', () => {
  const s = FOLLOW_UPS[0]
  assert.equal(s.step, 1)
  assert.equal(s.delayHours, 3)
  assert.equal(s.goal, 'retomar diagnóstico')
})

test('step 2: 24h, reforçar benefício', () => {
  const s = FOLLOW_UPS[1]
  assert.equal(s.step, 2)
  assert.equal(s.delayHours, 24)
  assert.equal(s.goal, 'reforçar benefício')
})

test('step 3: 48h, trazer dor ou prova', () => {
  const s = FOLLOW_UPS[2]
  assert.equal(s.step, 3)
  assert.equal(s.delayHours, 48)
  assert.equal(s.goal, 'trazer dor ou prova')
})

test('step 4: 168h, última tentativa leve', () => {
  const s = FOLLOW_UPS[3]
  assert.equal(s.step, 4)
  assert.equal(s.delayHours, 168)
  assert.equal(s.goal, 'última tentativa leve')
})

// ─── getFollowUpByStep ────────────────────────────────────────────────────────

test('getFollowUpByStep(1) retorna step 1', () => {
  assert.equal(getFollowUpByStep(1).step, 1)
})

test('getFollowUpByStep(4) retorna step 4', () => {
  assert.equal(getFollowUpByStep(4).step, 4)
})

test('getFollowUpByStep(5) retorna null', () => {
  assert.equal(getFollowUpByStep(5), null)
})

test('getFollowUpByStep(0) retorna null', () => {
  assert.equal(getFollowUpByStep(0), null)
})

// ─── getNextFollowUp ──────────────────────────────────────────────────────────

test('currentStep=0 → próximo é step 1', () => {
  assert.equal(getNextFollowUp(0).step, 1)
})

test('currentStep=1 → próximo é step 2', () => {
  assert.equal(getNextFollowUp(1).step, 2)
})

test('currentStep=3 → próximo é step 4', () => {
  assert.equal(getNextFollowUp(3).step, 4)
})

test('currentStep=4 → null (esgotou os steps)', () => {
  assert.equal(getNextFollowUp(4), null)
})

test('currentStep=99 → null', () => {
  assert.equal(getNextFollowUp(99), null)
})

// ─── isFollowUpDue ────────────────────────────────────────────────────────────

test('step 1 vencido (4h atrás) → due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(4, now), 1, fakeClock(now)), true)
})

test('step 1 ainda não vencido (2h atrás) → não due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(2, now), 1, fakeClock(now)), false)
})

test('step 1 exatamente no limite (3h atrás) → due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(3, now), 1, fakeClock(now)), true)
})

test('step 2 vencido (25h atrás) → due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(25, now), 2, fakeClock(now)), true)
})

test('step 2 não vencido (20h atrás) → não due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(20, now), 2, fakeClock(now)), false)
})

test('step 4 vencido (200h atrás) → due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(200, now), 4, fakeClock(now)), true)
})

test('step 4 não vencido (100h atrás) → não due', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(100, now), 4, fakeClock(now)), false)
})

test('step inexistente → false', () => {
  const now = Date.now()
  assert.equal(isFollowUpDue(hoursAgo(999, now), 5, fakeClock(now)), false)
})

test('data inválida → false', () => {
  assert.equal(isFollowUpDue('data-inválida', 1), false)
})

// ─── shouldSendFollowUp ───────────────────────────────────────────────────────

test('delay vencido, currentStep=0 → should=true, step=1', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(4, now),
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(result.should, true)
  assert.equal(result.step, 1)
  assert.equal(result.goal, 'retomar diagnóstico')
  assert.equal(result.hoursRemaining, 0)
})

test('delay não vencido → should=false, informa hoursRemaining', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(1, now),
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
  assert.equal(result.step, 1)
  assert.ok(result.hoursRemaining > 0)
  assert.ok(result.hoursRemaining <= 3)
})

test('currentStep=1, step 2 vencido → should=true, step=2', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 1,
    lastContactAt: hoursAgo(25, now),
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(result.should, true)
  assert.equal(result.step, 2)
})

test('currentStep=4 → esgotou steps, should=false, step=null', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 4,
    lastContactAt: hoursAgo(999, now),
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
  assert.equal(result.step, null)
  assert.equal(result.goal, null)
})

test('stage=closed → bloqueia follow-up', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(99, now),
    stage: 'closed',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
})

test('stage=lost → bloqueia follow-up', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(99, now),
    stage: 'lost',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
})

test('stage=meeting_scheduled → bloqueia (lead engajado)', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(99, now),
    stage: 'meeting_scheduled',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
})

test('stage=meeting_offer → bloqueia (reunião em aberto)', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(99, now),
    stage: 'meeting_offer',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
})

test('resultado sempre tem os 4 campos', () => {
  const result = shouldSendFollowUp({})
  assert.ok('should' in result)
  assert.ok('step' in result)
  assert.ok('goal' in result)
  assert.ok('hoursRemaining' in result)
})

test('sem argumentos não quebra', () => {
  assert.doesNotThrow(() => shouldSendFollowUp())
})

test('BLOCKING_STAGES tem os 4 estágios esperados', () => {
  assert.ok(BLOCKING_STAGES.includes('closed'))
  assert.ok(BLOCKING_STAGES.includes('lost'))
  assert.ok(BLOCKING_STAGES.includes('meeting_scheduled'))
  assert.ok(BLOCKING_STAGES.includes('meeting_offer'))
})

// ─── buildFollowUpMessage — templates do spec ─────────────────────────────────

test('step 1 sem contexto: texto padrão do spec', () => {
  const text = buildFollowUpMessage(1, {})
  assert.ok(text.includes('te orientar certo'))
  assert.ok(text.includes('passar mais confiança'))
  assert.ok(text.includes('WhatsApp'))
  assert.ok(text.endsWith('?'))
})

test('step 2 sem contexto: texto padrão do spec', () => {
  const text = buildFollowUpMessage(2, {})
  assert.ok(text.includes('Passando para reforçar'))
  assert.ok(text.includes('pelo que você comentou'))
  assert.ok(text.includes('WhatsApp'))
})

test('step 3: texto de dor/prova do spec', () => {
  const text = buildFollowUpMessage(3, {})
  assert.ok(text.includes('perdem clientes'))
  assert.ok(text.includes('mais clara e profissional'))
})

test('step 4: última tentativa leve do spec', () => {
  const text = buildFollowUpMessage(4, {})
  assert.ok(text.includes('outro momento'))
  assert.ok(text.includes('faz sentido'))
  assert.ok(text.endsWith('?'))
})

test('step inválido → null', () => {
  assert.equal(buildFollowUpMessage(0), null)
  assert.equal(buildFollowUpMessage(5), null)
  assert.equal(buildFollowUpMessage(99), null)
})

// ─── buildFollowUpMessage — personalização por contexto ──────────────────────

test('step 1 com businessType: menciona o negócio', () => {
  const text = buildFollowUpMessage(1, { profile: { businessType: 'dentista' } })
  assert.ok(text.includes('dentista'))
})

test('step 1 com businessType: não perde a pergunta de prioridade', () => {
  const text = buildFollowUpMessage(1, { profile: { businessType: 'salão de beleza' } })
  assert.ok(text.includes('confiança'))
  assert.ok(text.endsWith('?'))
})

test('step 2 com businessType + city: referencia negócio e cidade', () => {
  const text = buildFollowUpMessage(2, {
    profile: { businessType: 'pet shop', city: 'Campinas' },
  })
  assert.ok(text.includes('pet shop'))
  assert.ok(text.includes('Campinas'))
})

test('step 2 só com businessType (sem city): referencia apenas o negócio', () => {
  const text = buildFollowUpMessage(2, {
    profile: { businessType: 'clínica', city: null },
  })
  assert.ok(text.includes('clínica'))
  assert.ok(!text.includes('null'))
})

test('step 2 sem contexto: usa "pelo que você comentou" genérico', () => {
  const text = buildFollowUpMessage(2, { profile: {} })
  assert.ok(text.includes('pelo que você comentou, dá'))
})

test('step 3 não muda com contexto (universal)', () => {
  const semContext = buildFollowUpMessage(3, {})
  const comContext = buildFollowUpMessage(3, { profile: { businessType: 'dentista', city: 'SP' } })
  assert.equal(semContext, comContext)
})

test('step 4 não muda com contexto (universal)', () => {
  const semContext = buildFollowUpMessage(4, {})
  const comContext = buildFollowUpMessage(4, { profile: { businessType: 'dentista', city: 'SP' } })
  assert.equal(semContext, comContext)
})

test('sem contexto (undefined) não quebra em nenhum step', () => {
  for (let step = 1; step <= 4; step++) {
    assert.doesNotThrow(() => buildFollowUpMessage(step))
    assert.doesNotThrow(() => buildFollowUpMessage(step, {}))
    assert.doesNotThrow(() => buildFollowUpMessage(step, { profile: {} }))
  }
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: follow-up sempre considera contexto — step 1 é diferente com e sem perfil', () => {
  const semPerfil = buildFollowUpMessage(1, {})
  const comPerfil = buildFollowUpMessage(1, { profile: { businessType: 'médico' } })
  assert.notEqual(semPerfil, comPerfil)
  assert.ok(comPerfil.includes('médico'))
})

test('critério: follow-up nunca enviado para leads em estágio terminal', () => {
  const now = Date.now()
  const terminais = ['closed', 'lost', 'meeting_scheduled', 'meeting_offer']
  for (const stage of terminais) {
    const result = shouldSendFollowUp({
      currentStep: 0,
      lastContactAt: hoursAgo(999, now),
      stage,
      _now: fakeClock(now),
    })
    assert.equal(result.should, false, `não deve enviar follow-up para stage=${stage}`)
  }
})

test('critério: sequência completa de 4 steps com delays corretos', () => {
  const now = Date.now()
  const delays = [3, 24, 48, 168]
  let lastContact = hoursAgo(200, now)  // início: 200h atrás

  for (let currentStep = 0; currentStep < 4; currentStep++) {
    const result = shouldSendFollowUp({
      currentStep,
      lastContactAt: lastContact,
      stage: 'follow_up',
      _now: fakeClock(now),
    })
    assert.equal(result.should, true, `step ${currentStep + 1} deveria ser enviado`)
    assert.equal(result.step, currentStep + 1)
    assert.equal(result.goal, FOLLOW_UPS[currentStep].goal)

    // Texto de follow-up existe e não é null
    const text = buildFollowUpMessage(currentStep + 1, {})
    assert.ok(text && text.length > 20, `step ${currentStep + 1} deve ter mensagem substantiva`)
  }

  // Após step 4, não há mais follow-up
  const final = shouldSendFollowUp({
    currentStep: 4,
    lastContactAt: lastContact,
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(final.should, false)
  assert.equal(final.step, null)
})

test('critério: hoursRemaining informa quando vai ser o próximo follow-up', () => {
  const now = Date.now()
  const result = shouldSendFollowUp({
    currentStep: 0,
    lastContactAt: hoursAgo(1, now),  // 1h atrás, precisa de 3h
    stage: 'follow_up',
    _now: fakeClock(now),
  })
  assert.equal(result.should, false)
  assert.equal(result.hoursRemaining, 2)  // faltam 2h
})
