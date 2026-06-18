'use strict'

/**
 * Pipeline de conversa — orquestrador dos módulos determinísticos.
 *
 * Conecta os 12 módulos em sequência e retorna um contexto rico que:
 *   1. Alimenta o system prompt da IA com dados precisos do lead
 *   2. Valida a resposta gerada antes do envio
 *
 * Integração com o fluxo existente:
 *   gerarEEnviarRespostaWhatsapp(numero, historico, estagio, conversa, visao)
 *     → buildConversationContext(message, history, profile, stage)   ← novo
 *     → montarSystemPromptDinamico(estagio, perfil, ...)             ← existente
 *     → buildContextBlock(context)  appended ao system prompt        ← novo
 *     → aiProvider.generateAIResponse(...)                           ← existente
 *     → validateResponse(stage, aiResponse, updatedProfile)          ← novo
 *     → Evolution API send                                           ← existente
 *
 * O pipeline é não-destrutivo: enriquece sem substituir lógica existente.
 */

const { detectIntent }              = require('./intent-detector')
const { handleConfusion }           = require('./confusion-handler')
const { classifyConversationStage } = require('./conversation-stage-classifier')
const { extractFromMessage, mergeProfile, getMissingInfo } = require('./lead-profile')
const { selectGoal }                = require('./goal-selector')
const { shouldOfferMeeting, buildMeetingInvite } = require('./meeting-invite')
const { validateSalesMessage }      = require('./message-validator')
const { getLimits }                 = require('./message-limits')

// ─── Etapa 1-5: Contexto determinístico ──────────────────────────────────────

/**
 * Roda todos os módulos determinísticos sobre a mensagem consolidada do lead
 * e retorna um objeto de contexto rico para alimentar a IA.
 *
 * @param {object} params
 * @param {string}  params.message   Mensagem consolidada (após MessageBuffer)
 * @param {Array}   [params.history] Histórico da conversa
 * @param {object}  [params.profile] Perfil atual do lead (formato LeadProfile)
 * @param {string}  [params.stage]   Estágio atual da conversa
 * @returns {ConversationContext}
 */
function buildConversationContext({ message, history = [], profile = {}, stage = 'new_lead' } = {}) {
  const text = String(message || '')

  // 1. Intenção
  const intentResult = detectIntent(text)

  // 2. Confusão site/anúncio/Google
  const confusionResult = handleConfusion(text, intentResult)

  // 3. Estágio
  const stageResult = classifyConversationStage({
    texto: text,
    perfil: profile,
    estagio: stage,
    historico: history,
    status: null,
    tipo: null,
  })

  // 4. Perfil — extrai desta mensagem e mescla com o existente
  const profileUpdates = extractFromMessage(text)
  const updatedProfile = mergeProfile(profile, profileUpdates)
  const missingInfo = getMissingInfo(updatedProfile)

  // 5. Objetivo desta resposta
  const goalResult = selectGoal({
    stage: stageResult.stage,
    intent: intentResult.intent,
    profile: updatedProfile,
    intentResult,
  })

  // 6. Reunião
  const meetingReady = shouldOfferMeeting(stageResult.stage, intentResult.intent, updatedProfile)
  const meetingInvite = meetingReady ? buildMeetingInvite({ profile: updatedProfile }) : null

  return {
    // Análise da mensagem
    intent: intentResult.intent,
    secondaryIntents: intentResult.secondaryIntents || [],
    confusionDetected: intentResult.confusionDetected,
    confusionType: intentResult.confusionType || null,
    // Estágio
    stage: stageResult.stage,
    stageReason: stageResult.reason,
    previousStage: stage,
    // Perfil
    updatedProfile,
    profileUpdates,
    missingInfo,
    // Objetivo
    goal: goalResult.goal,
    messageStyle: goalResult.messageStyle,
    suggestedQuestion: goalResult.question,
    // Confusão
    shouldClarifyFirst: confusionResult.shouldClarify,
    clarificationText: confusionResult.clarificationText || null,
    // Reunião
    meetingReady,
    meetingInvite,
  }
}

// ─── Etapa 6: Bloco de contexto para o system prompt ─────────────────────────

/**
 * Converte o contexto do pipeline em um bloco de texto para appending
 * no system prompt existente (montarSystemPromptDinamico).
 *
 * Segue a ordem de prioridade:
 *   1. Clarificação de confusão (obrigatório quando detectada)
 *   2. Convite de reunião (quando lead qualificado)
 *   3. Dados do lead e objetivo
 *   4. Regras estruturais
 *
 * @param {ConversationContext} context  Saída de buildConversationContext
 * @returns {string}
 */
function buildContextBlock(context) {
  const lines = []

  // ── Seção 1: Confusão ─────────────────────────────────────────────────────
  if (context.shouldClarifyFirst && context.clarificationText) {
    lines.push('## ⚠️ PRIORIDADE: Esclarecer confusão antes de continuar')
    lines.push('O lead confundiu o serviço. Use exatamente este texto de esclarecimento:')
    lines.push('')
    lines.push(context.clarificationText)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // ── Seção 2: Convite de reunião ───────────────────────────────────────────
  if (context.meetingReady && context.meetingInvite) {
    lines.push('## ✅ Lead qualificado — oferecer reunião')
    lines.push('Use este convite de reunião (pode adaptar levemente o tom):')
    lines.push('')
    lines.push(context.meetingInvite)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // ── Seção 3: Dados do lead ────────────────────────────────────────────────
  lines.push('## Contexto do lead')
  const p = context.updatedProfile
  const known = []
  if (p.businessType) known.push(`Negócio: ${p.businessType}`)
  if (p.city) known.push(`Cidade: ${p.city}`)
  if (p.hasWebsite !== null) known.push(`Site: ${p.hasWebsite ? 'já tem' : 'não tem'}`)
  if (p.goal) known.push(`Objetivo declarado: ${p.goal}`)
  if (p.mainService) known.push(`Procura: ${p.mainService}`)
  if (p.budgetSignal) known.push(`Sinal de orçamento: ${p.budgetSignal}`)

  if (known.length > 0) {
    lines.push('**O que já sabemos:**')
    for (const item of known) lines.push(`- ${item}`)
  } else {
    lines.push('**Lead novo — ainda não temos dados coletados.**')
  }

  if (context.missingInfo.length > 0) {
    lines.push('')
    lines.push('**Ainda precisamos coletar:**')
    for (const field of context.missingInfo) lines.push(`- ${field}`)
  }

  // ── Seção 4: Objetivo e intenção ──────────────────────────────────────────
  lines.push('')
  lines.push('## Objetivo desta resposta')
  lines.push(`- Goal: \`${context.goal}\``)
  lines.push(`- Intenção detectada: \`${context.intent}\``)
  lines.push(`- Tom: \`${context.messageStyle}\``)
  if (context.suggestedQuestion) {
    lines.push(`- Pergunta a usar (pode adaptar): "${context.suggestedQuestion}"`)
  }

  return lines.join('\n')
}

// ─── Etapa 7: Regras estruturais para o prompt ───────────────────────────────

/**
 * Gera o bloco de regras obrigatórias baseado no estágio.
 * Sempre deve aparecer no system prompt.
 *
 * @param {string} stage
 * @returns {string}
 */
function buildRulesBlock(stage) {
  const limits = getLimits(stage)

  return [
    '## Regras obrigatórias',
    `- Máximo ${limits.maxChars} caracteres na resposta`,
    `- No máximo ${limits.maxQuestions} pergunta por mensagem`,
    '- Nunca prometer aparecer no Google, no topo do Google ou na primeira página',
    '- Nunca usar urgência artificial: "última chance", "só hoje", "vagas limitadas"',
    '- Nunca revelar preço concreto (R$) no primeiro contato',
    '- Responda sempre em Português do Brasil',
    '- Tom direto, humano e consultivo — sem script robótico',
  ].join('\n')
}

// ─── Etapa 8: Validação da resposta gerada ────────────────────────────────────

/**
 * Valida a resposta gerada pela IA antes do envio.
 * Retorna a resposta original ou a versão corrigida automaticamente.
 *
 * @param {object} params
 * @param {string}  params.stage         Estágio da conversa
 * @param {string}  params.response      Texto gerado pela IA
 * @param {object}  [params.leadProfile] Perfil do lead
 * @param {string}  [params.intent]      Intenção detectada
 * @returns {{ approved, problems, textToSend }}
 */
function validateResponse({ stage, response, leadProfile = {}, intent = '' } = {}) {
  const result = validateSalesMessage({ stage, message: response, leadProfile, intent })
  return {
    ...result,
    textToSend: result.fixedMessage || response,
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

module.exports = {
  buildConversationContext,
  buildContextBlock,
  buildRulesBlock,
  validateResponse,
}
