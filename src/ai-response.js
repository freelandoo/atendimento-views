'use strict'

const { parsearRespostaJsonClaude } = require('./string-utils')
const { validarRespostaVendasIA } = require('./domainSchemas')
const {
  guardPublicMessages,
  messageLooksLikeRawJsonLeak,
  fallbackPublicMessages,
} = require('./public-message-guard')

function extractPublicMessages(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value.mensagens_bolhas)) {
    const bolhas = value.mensagens_bolhas
      .filter((m) => typeof m === 'string')
      .map((m) => m.trim())
      .filter(Boolean)
    if (bolhas.length) return bolhas
  }
  if (typeof value.mensagem_pro_lead === 'string' && value.mensagem_pro_lead.trim()) {
    return [value.mensagem_pro_lead.trim()]
  }
  return []
}

function parseAiResponse(rawResponse, opts = {}) {
  const raw = typeof rawResponse === 'string' ? rawResponse : ''
  const codeFenceDetected = /```/.test(raw)
  const parsedRaw = raw ? parsearRespostaJsonClaude(raw) : null
  const parseSuccess = !!parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)

  if (!parseSuccess) {
    return {
      ok: false,
      error: 'json_parse_failed',
      value: null,
      publicMessages: [],
      codeFenceDetected,
      parseSuccess: false,
      schemaValid: false,
      bubblesCount: 0,
      guardBlocked: false,
      guardReason: null,
      issues: [],
    }
  }

  const schema = validarRespostaVendasIA(parsedRaw)
  const value = schema.value || parsedRaw
  const publicMessages = extractPublicMessages(value)
  const etapaPublica = opts.etapa || opts.stage || opts.estagio || value.etapa_proxima || null
  const schemaValid = publicMessages.length > 0

  if (!schemaValid) {
    return {
      ok: false,
      error: 'schema_public_messages_missing',
      value,
      publicMessages: [],
      codeFenceDetected,
      parseSuccess: true,
      schemaValid: false,
      bubblesCount: 0,
      guardBlocked: false,
      guardReason: null,
      issues: schema.issues || [],
    }
  }

  const guarded = guardPublicMessages(publicMessages, { ...opts, etapa: etapaPublica })
  if (guarded.blocked) {
    return {
      ok: false,
      error: guarded.reason || 'public_message_blocked',
      value,
      publicMessages: [],
      codeFenceDetected,
      parseSuccess: true,
      schemaValid: true,
      bubblesCount: publicMessages.length,
      guardBlocked: true,
      guardReason: guarded.reason,
      issues: schema.issues || [],
    }
  }

  return {
    ok: true,
    error: null,
    value,
    publicMessages: guarded.messages,
    codeFenceDetected,
    parseSuccess: true,
    schemaValid: true,
    bubblesCount: guarded.messages.length,
    guardBlocked: false,
    guardReason: null,
    issues: schema.issues || [],
  }
}

function renderPublicReplyFromAiResponse(rawResponse, opts = {}) {
  const parsed = parseAiResponse(rawResponse, opts)
  const publicMessages = parsed.ok
    ? parsed.publicMessages
    : guardPublicMessages(fallbackPublicMessages(opts), opts).messages
  return {
    ...parsed,
    publicMessages,
    reply: publicMessages.join('\n\n'),
    parsedResponse: parsed.value,
    publicMessagesGenerated: publicMessages.length > 0 && !publicMessages.some(messageLooksLikeRawJsonLeak),
  }
}

module.exports = {
  parseAiResponse,
  renderPublicReplyFromAiResponse,
  extractPublicMessages,
}
