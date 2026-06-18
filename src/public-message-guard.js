'use strict'

const { limitarBolhasPorEtapa } = require('./message-limits')

const INTERNAL_SCHEMA_FIELDS = Object.freeze([
  'mensagem_pro_lead',
  'mensagens_bolhas',
  'atualizar_perfil',
  'etapa_proxima',
  'solicitar_calculo_preco',
  'solicitar_classificacao_nicho',
  'handoff',
  'motivo_handoff',
  'resumo_handoff',
  'eventos_conversa',
  'maturidade_digital',
  'reuniao_proposta',
  'registrar_lacuna',
  'tema_lacuna',
  'links_sugeridos',
  'project_handoff',
])

const FALLBACK_PUBLIC_MESSAGES = Object.freeze([
  'Oi! Sou da PJ Codeworks.',
  'Você busca site, sistema, automação ou presença no Google?',
])

function normalizePublicMessages(messages, max = 2) {
  const arr = Array.isArray(messages) ? messages : [messages]
  return arr
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, max)
}

function normalizePublicMessagesByStage(messages, opts = {}) {
  const normalized = normalizePublicMessages(messages, Number.MAX_SAFE_INTEGER)
  return limitarBolhasPorEtapa({
    etapa: opts.etapa || opts.stage || opts.estagio,
    mensagens: normalized,
  }).slice(0, opts.maxMessages || Number.MAX_SAFE_INTEGER)
}

function messageLooksLikeRawJsonLeak(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return false
  if (s.includes('```')) return true

  const lower = s.toLowerCase()
  if (INTERNAL_SCHEMA_FIELDS.some((field) => lower.includes(field.toLowerCase()))) {
    return true
  }

  if ((s.startsWith('{') || s.startsWith('[')) && /"[^"]+"\s*:/.test(s)) {
    return true
  }

  if (/[{}]/.test(s) && /"[^"]+"\s*:/.test(s)) {
    return true
  }

  return false
}

function fallbackPublicMessages() {
  return FALLBACK_PUBLIC_MESSAGES.slice()
}

function guardPublicMessages(messages, opts = {}) {
  const normalized = normalizePublicMessagesByStage(messages, opts)
  let blocked = false
  let reason = null

  if (!normalized.length) {
    blocked = true
    reason = 'empty_public_messages'
  } else if (normalized.some(messageLooksLikeRawJsonLeak)) {
    blocked = true
    reason = 'raw_json_or_schema_leak'
  }

  return {
    blocked,
    reason,
    messages: blocked ? fallbackPublicMessages(opts) : normalized,
  }
}

module.exports = {
  INTERNAL_SCHEMA_FIELDS,
  messageLooksLikeRawJsonLeak,
  normalizePublicMessages,
  normalizePublicMessagesByStage,
  fallbackPublicMessages,
  guardPublicMessages,
}
