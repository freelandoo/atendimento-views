'use strict'

/**
 * Convite para reunião de diagnóstico.
 *
 * A IA não pode ficar explicando infinitamente. Quando o lead tem negócio,
 * cidade, interesse claro e dor/objetivo identificado, o próximo passo é
 * oferecer uma reunião rápida de 15 minutos.
 *
 * Fluxo:
 *   isQualifiedForMeeting(profile, intent) → true
 *   shouldOfferMeeting(stage, intent, profile) → true
 *   buildMeetingInvite({ profile, date }) → texto pronto para WhatsApp
 */

// ─── Regras de agenda (conforme spec) ────────────────────────────────────────

const MEETING_RULES = {
  durationMinutes: 15,
  allowedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  startTime: '19:30',
  endTime: '21:30',
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Intents que sinalizam interesse claro do lead
const INTEREST_INTENTS = [
  'interested',
  'asking_price',
  'asking_how_it_works',
  'wants_meeting',
  'sent_business_info',
]

// Estágios que bloqueiam nova oferta de reunião
const BLOCKING_STAGES = ['lost', 'closed', 'meeting_scheduled']

// ─── Verificações ─────────────────────────────────────────────────────────────

/**
 * Retorna true se a data cai em um dia permitido para reunião (seg-sex).
 *
 * @param {Date} [date=new Date()]
 * @returns {boolean}
 */
function isMeetingDay(date = new Date()) {
  return MEETING_RULES.allowedDays.includes(DAY_NAMES[date.getDay()])
}

/**
 * Verifica se o lead atende os 4 critérios mínimos para convite de reunião:
 *   1. Negócio identificado (businessType)
 *   2. Cidade identificada (city)
 *   3. Interesse claro (intent ou meetingInterest no perfil)
 *   4. Dor ou objetivo identificado (goal, mainService, ou presença conhecida)
 *
 * @param {object} [profile={}]  Perfil do lead
 * @param {string} [intent='']   Intenção detectada na mensagem atual
 * @returns {boolean}
 */
function isQualifiedForMeeting(profile = {}, intent = '') {
  const hasBusinessType = profile.businessType != null
  const hasCity = profile.city != null
  const hasInterest = INTEREST_INTENTS.includes(intent) || profile.meetingInterest === true
  // Presença conhecida (hasWebsite true/false) significa que entendemos a dor
  const hasPainOrGoal = (
    profile.goal != null ||
    profile.mainService != null ||
    profile.hasWebsite !== null && profile.hasWebsite !== undefined
  )
  return hasBusinessType && hasCity && hasInterest && hasPainOrGoal
}

/**
 * Retorna os critérios ainda não atendidos para convite de reunião.
 * Útil para diagnóstico e testes.
 *
 * @param {object} [profile={}]
 * @param {string} [intent='']
 * @returns {string[]}  Lista de critérios faltantes
 */
function getQualificationGaps(profile = {}, intent = '') {
  const gaps = []
  if (profile.businessType == null) gaps.push('businessType')
  if (profile.city == null) gaps.push('city')
  if (!INTEREST_INTENTS.includes(intent) && profile.meetingInterest !== true) gaps.push('interest')
  const hasPainOrGoal = (
    profile.goal != null ||
    profile.mainService != null ||
    (profile.hasWebsite !== null && profile.hasWebsite !== undefined)
  )
  if (!hasPainOrGoal) gaps.push('painOrGoal')
  return gaps
}

/**
 * Combina qualificação + estágio para decidir se a IA deve oferecer reunião.
 * Não oferece se o lead já está em estágio terminal ou com reunião agendada.
 *
 * @param {string} stage
 * @param {string} intent
 * @param {object} [profile={}]
 * @returns {boolean}
 */
function shouldOfferMeeting(stage, intent, profile = {}) {
  if (BLOCKING_STAGES.includes(stage)) return false
  return isQualifiedForMeeting(profile, intent)
}

// ─── Geração do convite ───────────────────────────────────────────────────────

/**
 * Retorna os horários disponíveis na janela de reunião.
 * Retorna array vazio se não for dia permitido.
 *
 * @param {Date}   [date=new Date()]
 * @param {number} [intervalMinutes=30]  Intervalo entre slots
 * @returns {string[]}  Horários no formato "HH:MM"
 */
function getAvailableSlots(date = new Date(), intervalMinutes = 30) {
  if (!isMeetingDay(date)) return []

  const slots = []
  const [startH, startM] = MEETING_RULES.startTime.split(':').map(Number)
  const [endH, endM] = MEETING_RULES.endTime.split(':').map(Number)

  let current = startH * 60 + startM
  const endTotal = endH * 60 + endM

  while (current <= endTotal) {
    const h = Math.floor(current / 60)
    const m = current % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    current += intervalMinutes
  }

  return slots
}

/**
 * Gera o texto do convite de reunião pronto para WhatsApp.
 * Adapta a frase de agendamento conforme o dia da semana.
 *
 * @param {object} [params={}]
 * @param {object} [params.profile={}]  Perfil do lead (para personalização futura)
 * @param {Date}   [params.date]        Data de referência (default: hoje)
 * @returns {string}  Texto completo do convite (3 parágrafos)
 */
function buildMeetingInvite({ profile = {}, date = new Date() } = {}) {
  const dayAvailable = isMeetingDay(date)

  const opening = 'Pelo que você explicou, faz sentido eu te mostrar o melhor formato para sua empresa.'

  const duration = `A reunião é rápida, coisa de ${MEETING_RULES.durationMinutes} minutos, só para eu te apresentar uma proposta mais certeira.`

  const scheduling = dayAvailable
    ? `Hoje consigo entre ${MEETING_RULES.startTime} e ${MEETING_RULES.endTime}. Qual horário fica melhor?`
    : `Consigo entre ${MEETING_RULES.startTime} e ${MEETING_RULES.endTime}. Qual dia e horário fica melhor?`

  return [opening, duration, scheduling].join('\n\n')
}

module.exports = {
  MEETING_RULES,
  DAY_NAMES,
  INTEREST_INTENTS,
  BLOCKING_STAGES,
  isMeetingDay,
  isQualifiedForMeeting,
  getQualificationGaps,
  shouldOfferMeeting,
  getAvailableSlots,
  buildMeetingInvite,
}
