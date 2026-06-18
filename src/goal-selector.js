'use strict'

/**
 * Seletor de objetivo da resposta do bot.
 *
 * Toda resposta precisa ter um objetivo claro — sem objetivo, a IA responde bonito
 * mas não conduz o lead. Este módulo determina o que a IA deve tentar alcançar
 * em cada turno da conversa.
 *
 * Ordem de prioridade:
 *   1. Estado terminal (lead perdido/encerrado, não interessado) → end_politely
 *   2. Agendamento em andamento → schedule_meeting
 *   3. Objeção ativa → handle_objection
 *   4. Pergunta de preço → handle_price
 *   5. Lead pronto para reunião → offer_meeting
 *   6. Coleta de dados em cascata: businessType → city → presença atual
 *   7. Padrão → explain_solution
 */

const { getMissingInfo } = require('./lead-profile')

// ─── Constantes exportadas ────────────────────────────────────────────────────

const GOALS = {
  COLLECT_BUSINESS_TYPE: 'collect_business_type',
  COLLECT_CITY: 'collect_city',
  COLLECT_CURRENT_PRESENCE: 'collect_current_presence',
  EXPLAIN_SOLUTION: 'explain_solution',
  HANDLE_PRICE: 'handle_price',
  HANDLE_OBJECTION: 'handle_objection',
  OFFER_MEETING: 'offer_meeting',
  SCHEDULE_MEETING: 'schedule_meeting',
  END_POLITELY: 'end_politely',
}

const MESSAGE_STYLES = {
  SHORT: 'short',
  DIRECT: 'direct',
  WARM: 'warm',
  EMPATHETIC: 'empathetic',
  DETAILED: 'detailed',
}

// Estilo padrão por objetivo
const GOAL_STYLE = {
  [GOALS.COLLECT_BUSINESS_TYPE]: MESSAGE_STYLES.SHORT,
  [GOALS.COLLECT_CITY]: MESSAGE_STYLES.SHORT,
  [GOALS.COLLECT_CURRENT_PRESENCE]: MESSAGE_STYLES.SHORT,
  [GOALS.EXPLAIN_SOLUTION]: MESSAGE_STYLES.WARM,
  [GOALS.HANDLE_PRICE]: MESSAGE_STYLES.DETAILED,
  [GOALS.HANDLE_OBJECTION]: MESSAGE_STYLES.EMPATHETIC,
  [GOALS.OFFER_MEETING]: MESSAGE_STYLES.DIRECT,
  [GOALS.SCHEDULE_MEETING]: MESSAGE_STYLES.DIRECT,
  [GOALS.END_POLITELY]: MESSAGE_STYLES.WARM,
}

// Perguntas fixas (algumas são geradas dinamicamente)
const GOAL_QUESTION = {
  [GOALS.COLLECT_CITY]: 'Em qual cidade você atende?',
  [GOALS.COLLECT_CURRENT_PRESENCE]: 'Você já tem site ou usa mais Instagram e WhatsApp para divulgar seu negócio?',
  [GOALS.EXPLAIN_SOLUTION]: 'Faz sentido para o que você precisa?',
  [GOALS.HANDLE_PRICE]: 'Quer que eu te passe um orçamento personalizado?',
  [GOALS.OFFER_MEETING]: 'Qual horário fica melhor para você hoje entre 19h30 e 21h30?',
  [GOALS.SCHEDULE_MEETING]: 'Posso confirmar o horário?',
  [GOALS.END_POLITELY]: null,
  [GOALS.HANDLE_OBJECTION]: null,  // gerada por _objectionQuestion
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _objectionQuestion(intent) {
  const questions = {
    objection_price: 'O que ficou de fora do seu orçamento?',
    objection_time: 'Qual seria o melhor momento para você?',
    objection_trust: 'Posso te mostrar alguns projetos que já entregamos?',
  }
  return questions[intent] || 'O que posso esclarecer para te ajudar?'
}

/**
 * Lead está pronto para oferta de reunião quando:
 *   - estágio já indica isso, OU
 *   - manifestou interesse explícito em reunião, OU
 *   - tem negócio identificado + sabe-se a presença atual + intenção positiva
 */
function _isMeetingReady(stage, intent, profile) {
  if (stage === 'meeting_offer') return true
  if (intent === 'wants_meeting') return true
  if (!profile) return false

  const hasBusinessType = profile.businessType != null
  const hasPresence = profile.hasWebsite !== null && profile.hasWebsite !== undefined

  const positiveIntents = ['interested', 'asking_how_it_works', 'sent_business_info']
  return hasBusinessType && hasPresence && positiveIntents.includes(intent)
}

function _build(goal, question) {
  return { goal, messageStyle: GOAL_STYLE[goal], question }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Seleciona o objetivo da próxima resposta do bot e a pergunta correspondente.
 *
 * @param {object} params
 * @param {string}  params.stage        Estágio atual (conversation-stage-classifier)
 * @param {string}  params.intent       Intenção detectada (intent-detector)
 * @param {object}  [params.profile]    Perfil do lead (lead-profile)
 * @param {object}  [params.intentResult] Resultado completo do detectIntent
 * @returns {{ goal: string, messageStyle: string, question: string|null }}
 */
function selectGoal({ stage, intent, profile = {}, intentResult = {} }) {
  const missing = getMissingInfo(profile)

  // 1. Estados terminais
  if (stage === 'lost' || stage === 'closed' || intent === 'not_interested') {
    return _build(GOALS.END_POLITELY, null)
  }

  // 2. Agendamento em andamento
  if (stage === 'meeting_scheduled') {
    return _build(GOALS.SCHEDULE_MEETING, GOAL_QUESTION[GOALS.SCHEDULE_MEETING])
  }

  // 3. Objeções têm prioridade sobre coleta de dados
  if (intent && intent.startsWith('objection_')) {
    return _build(GOALS.HANDLE_OBJECTION, _objectionQuestion(intent))
  }

  // 4. Pergunta de preço
  if (intent === 'asking_price' || stage === 'price_question') {
    return _build(GOALS.HANDLE_PRICE, GOAL_QUESTION[GOALS.HANDLE_PRICE])
  }

  // 5. Lead qualificado para reunião
  if (_isMeetingReady(stage, intent, profile)) {
    return _build(GOALS.OFFER_MEETING, GOAL_QUESTION[GOALS.OFFER_MEETING])
  }

  // 6. Coleta de dados em cascata (ordem de importância)
  if (missing.includes('businessType')) {
    const question = missing.includes('city')
      ? 'Qual é o seu negócio e em qual cidade você atende?'
      : 'Qual é o seu negócio?'
    return _build(GOALS.COLLECT_BUSINESS_TYPE, question)
  }

  if (missing.includes('city')) {
    return _build(GOALS.COLLECT_CITY, GOAL_QUESTION[GOALS.COLLECT_CITY])
  }

  if (missing.includes('hasWebsite')) {
    return _build(GOALS.COLLECT_CURRENT_PRESENCE, GOAL_QUESTION[GOALS.COLLECT_CURRENT_PRESENCE])
  }

  // 7. Contexto suficiente — explicar a solução
  return _build(GOALS.EXPLAIN_SOLUTION, GOAL_QUESTION[GOALS.EXPLAIN_SOLUTION])
}

module.exports = {
  GOALS,
  MESSAGE_STYLES,
  GOAL_STYLE,
  GOAL_QUESTION,
  selectGoal,
}
