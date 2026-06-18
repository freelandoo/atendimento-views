'use strict'

/**
 * Follow-ups inteligentes — cada mensagem tem uma função.
 *
 * O lead sumiu. A IA não pode spammar com mensagens genéricas nem ficar
 * insistindo sem contexto. Cada step tem um objetivo distinto e o texto
 * considera o que sabemos do lead.
 *
 * Sequência:
 *   Step 1 (3h)   → retomar diagnóstico   — pergunta sobre prioridade
 *   Step 2 (24h)  → reforçar benefício    — referencia o que o lead comentou
 *   Step 3 (48h)  → trazer dor ou prova   — prova social, universal
 *   Step 4 (168h) → última tentativa leve — deixa porta aberta, sem pressão
 *
 * Critério-chave: nenhum follow-up é enviado sem considerar o contexto do lead.
 * - Estágios terminais bloqueiam (closed, lost, meeting_scheduled)
 * - Após step 4, encerrar — não criar loop de mensagens
 */

// ─── Constante do spec ────────────────────────────────────────────────────────

const FOLLOW_UPS = [
  { step: 1, delayHours: 3,   goal: 'retomar diagnóstico' },
  { step: 2, delayHours: 24,  goal: 'reforçar benefício' },
  { step: 3, delayHours: 48,  goal: 'trazer dor ou prova' },
  { step: 4, delayHours: 168, goal: 'última tentativa leve' },
]

// Estágios onde não enviamos follow-up (lead engajado ou encerrado)
const BLOCKING_STAGES = ['closed', 'lost', 'meeting_scheduled', 'meeting_offer']

// ─── Lookup de steps ──────────────────────────────────────────────────────────

/**
 * Retorna o objeto de follow-up para o step informado.
 * Retorna null se o step não existir.
 *
 * @param {number} step
 * @returns {{ step, delayHours, goal } | null}
 */
function getFollowUpByStep(step) {
  return FOLLOW_UPS.find((f) => f.step === step) || null
}

/**
 * Retorna o próximo follow-up após currentStep.
 * Retorna null se currentStep já for o último.
 *
 * @param {number} currentStep  Último step enviado (0 = nunca enviou)
 * @returns {{ step, delayHours, goal } | null}
 */
function getNextFollowUp(currentStep) {
  return getFollowUpByStep(currentStep + 1)
}

// ─── Verificação de timing ────────────────────────────────────────────────────

/**
 * Verifica se o delay necessário para o step já passou.
 *
 * @param {Date|number|string} lastContactAt  Quando foi o último contato
 * @param {number}             step           Step a verificar
 * @param {function}           [_now]         Injeção de clock (para testes)
 * @returns {boolean}
 */
function isFollowUpDue(lastContactAt, step, _now = Date.now) {
  const followUp = getFollowUpByStep(step)
  if (!followUp) return false

  const last = new Date(lastContactAt).getTime()
  if (isNaN(last)) return false

  const elapsed = _now() - last
  return elapsed >= followUp.delayHours * 3_600_000
}

// ─── Decisão de envio ─────────────────────────────────────────────────────────

/**
 * Decide se e qual follow-up enviar agora.
 *
 * @param {object} params
 * @param {number}            [params.currentStep=0]   Último step enviado (0 = nunca)
 * @param {Date|number|string} params.lastContactAt     Quando o lead enviou a última msg
 * @param {string}            [params.stage='']        Estágio atual da conversa
 * @param {function}          [params._now]            Injeção de clock (para testes)
 * @returns {{
 *   should: boolean,
 *   step: number|null,
 *   goal: string|null,
 *   hoursRemaining: number|null,
 * }}
 */
function shouldSendFollowUp({ currentStep = 0, lastContactAt, stage = '', _now = Date.now } = {}) {
  const noop = { should: false, step: null, goal: null, hoursRemaining: null }

  if (BLOCKING_STAGES.includes(stage)) return noop

  const nextFollowUp = getNextFollowUp(currentStep)
  if (!nextFollowUp) return noop  // esgotou os steps

  const last = new Date(lastContactAt).getTime()
  if (isNaN(last)) return noop

  const elapsed = _now() - last
  const requiredMs = nextFollowUp.delayHours * 3_600_000

  if (elapsed >= requiredMs) {
    return {
      should: true,
      step: nextFollowUp.step,
      goal: nextFollowUp.goal,
      hoursRemaining: 0,
    }
  }

  return {
    should: false,
    step: nextFollowUp.step,
    goal: nextFollowUp.goal,
    hoursRemaining: Math.ceil((requiredMs - elapsed) / 3_600_000),
  }
}

// ─── Geração de mensagens ─────────────────────────────────────────────────────

/**
 * Gera o texto do follow-up para o step informado, personalizado com o contexto
 * do lead quando disponível.
 *
 * Step 1 — usa businessType se disponível para contextualizar a pergunta
 * Step 2 — usa businessType + city para reforçar o benefício com contexto real
 * Step 3 — dor universal (prova social não precisa de personalização)
 * Step 4 — última tentativa leve, universal
 *
 * @param {number} step
 * @param {object} [context={}]
 * @param {object} [context.profile={}]  Perfil do lead
 * @returns {string|null}  Texto pronto para WhatsApp, ou null se step inválido
 */
function buildFollowUpMessage(step, context = {}) {
  const { profile = {} } = context
  const { businessType, city } = profile

  switch (step) {
    case 1: {
      const intro = businessType
        ? `Só para te orientar certo no que faz mais sentido para ${businessType}:`
        : 'Só para eu te orientar certo:'
      return `${intro} hoje sua prioridade é passar mais confiança ou começar a receber mais contatos pelo WhatsApp?`
    }

    case 2: {
      const ref = businessType && city
        ? `sobre seu ${businessType} em ${city}`
        : businessType
          ? `sobre seu ${businessType}`
          : ''
      const connector = ref
        ? `pelo que você comentou ${ref}, dá`
        : 'pelo que você comentou, dá'
      return `Passando para reforçar: ${connector} para estruturar uma página objetiva para apresentar seus serviços e facilitar o contato pelo WhatsApp.`
    }

    case 3:
      return 'Muitos negócios perdem clientes porque a pessoa procura, não entende bem o serviço e desiste. A ideia do site é deixar sua apresentação mais clara e profissional.'

    case 4:
      return 'Quer que eu deixe isso para outro momento ou ainda faz sentido avaliarmos uma estrutura para sua empresa?'

    default:
      return null
  }
}

module.exports = {
  FOLLOW_UPS,
  BLOCKING_STAGES,
  getFollowUpByStep,
  getNextFollowUp,
  isFollowUpDue,
  shouldSendFollowUp,
  buildFollowUpMessage,
}
