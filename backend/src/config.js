'use strict'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ''
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const MAX_IMAGEM_BYTES_CLAUDE = 4 * 1024 * 1024
const WEBHOOK_REPLY_DEBOUNCE_MS = Math.min(
  Math.max(parseInt(process.env.WEBHOOK_REPLY_DEBOUNCE_MS, 10) || 2500, 200),
  60000
)

function sanitizarCpfRespostaHabilitado() {
  const v = String(process.env.SANITIZAR_CPF_RESPOSTA ?? '0')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

// Fase 1 da esteira inteligente de prospecção.
// Quando desligada (padrão), o sistema segue exatamente o fluxo atual.
// Ligar: PROSPECTING_INTELLIGENCE_ENABLED=1 (ou "true").
function prospectingIntelligenceEnabled() {
  const v = String(process.env.PROSPECTING_INTELLIGENCE_ENABLED ?? '0')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true'
}

const CLAUDE_TIMEOUT_CAP_MS = 180000
const CLAUDE_AUXILIAR_TIMEOUT_CAP_MS = Math.min(
  Math.max(parseInt(process.env.CLAUDE_AUXILIAR_TIMEOUT_CAP_MS, 10) || 600000, 120000),
  900000
)
const CLAUDE_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 45000, 5000),
  CLAUDE_TIMEOUT_CAP_MS
)

function claudeWebSearchHabilitado() {
  const v = String(process.env.CLAUDE_WEB_SEARCH ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}

const CLAUDE_WEB_SEARCH_MAX_USES = Math.min(
  Math.max(parseInt(process.env.CLAUDE_WEB_SEARCH_MAX_USES, 10) || 5, 1),
  20
)
const CLAUDE_WEB_SEARCH_PAUSE_MAX = Math.min(
  Math.max(parseInt(process.env.CLAUDE_WEB_SEARCH_PAUSE_MAX, 10) || 8, 1),
  15
)
const CLAUDE_TIMEOUT_COM_BUSCA_MS = Math.min(
  Math.max(
    parseInt(process.env.CLAUDE_WEB_SEARCH_TIMEOUT_MS, 10) || Math.max(CLAUDE_TIMEOUT_MS, 120000),
    CLAUDE_TIMEOUT_MS
  ),
  300000
)

const ALERTA_FALHA_RESPOSTA_DEDUPE_MS = 15 * 60 * 1000
const FOLLOWUP_INSTRUCAO_MAX_CHARS = 2000
const FOLLOWUP_EXPLICITO_MIN_MINUTOS = 15
const FOLLOWUP_EXPLICITO_MAX_DIAS = 30
const FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO =
  'Retomada combinada com o lead: checar se o momento mudou; manter tom leve e continuidade natural.'
const FOLLOWUP_LOTE_MAX_ITENS = 50
const FOLLOWUP_SNIPPET_MAX_CHARS = 300
const FOLLOWUP_ERRO_LOG_MAX_CHARS = 500
const LEAD_CONTEXTO_MAX_CHARS = 4000
const LEAD_CONTEXTO_PROMPT_LIMIT = 8
const HISTORICO_CLAUDE_MAX_MSGS = Math.min(
  Math.max(parseInt(process.env.HISTORICO_CLAUDE_MAX_MSGS, 10) || 20, 12),
  30
)
const AUDIO_UPLOAD_MAX_BYTES = 18 * 1024 * 1024
const FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS = 30
const JOB_WORKER_POLL_MS = Math.min(
  Math.max(parseInt(process.env.JOB_WORKER_POLL_MS, 10) || 3000, 250),
  30000
)
const JOB_WORKER_LOCK_MS = Math.min(
  Math.max(parseInt(process.env.JOB_WORKER_LOCK_MS, 10) || 120000, 10000),
  600000
)
const JOB_MAX_ATTEMPTS = Math.min(
  Math.max(parseInt(process.env.JOB_MAX_ATTEMPTS, 10) || 5, 1),
  20
)
const SILENCE_WATCHER_INTERVAL_MS = Math.min(
  Math.max(parseInt(process.env.SILENCE_WATCHER_INTERVAL_MS, 10) || 60000, 10000),
  30 * 60 * 1000
)
const SILENCE_TRIGGER_MINUTES = Math.min(
  Math.max(parseInt(process.env.SILENCE_TRIGGER_MINUTES, 10) || 60, 1),
  24 * 60
)
const FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO = Math.min(
  Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PADRAO, 10) || 3, 1),
  10
)
const FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO = {
  primeiro_contato: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PRIMEIRO_CONTATO, 10) || 1, 1), 10),
  proposta_enviada: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PROPOSTA_ENVIADA, 10) || 5, 1), 10),
  negociacao: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_NEGOCIACAO, 10) || 5, 1), 10),
}
const FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA = 1
const FOLLOWUP_AUTO_BUSINESS_TZ = process.env.FOLLOWUP_AUTO_BUSINESS_TZ || 'America/Sao_Paulo'
const FOLLOWUP_AUTO_BUSINESS_START_HOUR = Math.min(
  Math.max(parseInt(process.env.FOLLOWUP_AUTO_BUSINESS_START_HOUR, 10) || 8, 0),
  23
)
const FOLLOWUP_AUTO_BUSINESS_END_HOUR = Math.min(
  Math.max(
    parseInt(process.env.FOLLOWUP_AUTO_BUSINESS_END_HOUR, 10) || 20,
    FOLLOWUP_AUTO_BUSINESS_START_HOUR + 1
  ),
  24
)
const FOLLOWUP_AUTO_DELAY_HORAS = {
  1: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ1_H) || 2),
  2: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ2_H) || 24),
  3: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ3_H) || 72),
  4: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ4_H) || 120),
  5: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ5_H) || 168),
  6: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ6_H) || 168),
  7: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ7_H) || 168),
}

module.exports = {
  ANTHROPIC_KEY,
  OPENAI_KEY,
  ANTHROPIC_MESSAGES_URL,
  MAX_IMAGEM_BYTES_CLAUDE,
  WEBHOOK_REPLY_DEBOUNCE_MS,
  sanitizarCpfRespostaHabilitado,
  CLAUDE_TIMEOUT_CAP_MS,
  CLAUDE_AUXILIAR_TIMEOUT_CAP_MS,
  CLAUDE_TIMEOUT_MS,
  claudeWebSearchHabilitado,
  CLAUDE_WEB_SEARCH_MAX_USES,
  CLAUDE_WEB_SEARCH_PAUSE_MAX,
  CLAUDE_TIMEOUT_COM_BUSCA_MS,
  ALERTA_FALHA_RESPOSTA_DEDUPE_MS,
  FOLLOWUP_INSTRUCAO_MAX_CHARS,
  FOLLOWUP_EXPLICITO_MIN_MINUTOS,
  FOLLOWUP_EXPLICITO_MAX_DIAS,
  FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO,
  FOLLOWUP_LOTE_MAX_ITENS,
  FOLLOWUP_SNIPPET_MAX_CHARS,
  FOLLOWUP_ERRO_LOG_MAX_CHARS,
  LEAD_CONTEXTO_MAX_CHARS,
  LEAD_CONTEXTO_PROMPT_LIMIT,
  HISTORICO_CLAUDE_MAX_MSGS,
  AUDIO_UPLOAD_MAX_BYTES,
  FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS,
  JOB_WORKER_POLL_MS,
  JOB_WORKER_LOCK_MS,
  JOB_MAX_ATTEMPTS,
  SILENCE_WATCHER_INTERVAL_MS,
  SILENCE_TRIGGER_MINUTES,
  FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO,
  FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO,
  FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA,
  FOLLOWUP_AUTO_BUSINESS_TZ,
  FOLLOWUP_AUTO_BUSINESS_START_HOUR,
  FOLLOWUP_AUTO_BUSINESS_END_HOUR,
  FOLLOWUP_AUTO_DELAY_HORAS,
  prospectingIntelligenceEnabled,
}
