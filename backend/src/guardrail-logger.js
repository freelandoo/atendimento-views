'use strict'

/**
 * Gravacao defensiva em vendas.ai_guardrail_logs.
 *
 * Importante:
 *   - Falha aqui NUNCA pode quebrar o envio. Todas as chamadas sao try/catch
 *     silencioso (so loga warn).
 *   - Schema da tabela (existente, nao alterar):
 *       id BIGSERIAL, numero TEXT, tipo_guardrail TEXT, severidade TEXT,
 *       "detecção" JSONB, "ação_tomada" TEXT, criado_em TIMESTAMPTZ
 */

let cachedDefaultPool = null
function getDefaultPool() {
  if (cachedDefaultPool !== null) return cachedDefaultPool
  try {
    cachedDefaultPool = require('./db').pool || null
  } catch (_) {
    cachedDefaultPool = null
  }
  return cachedDefaultPool
}

function maskNumero(numero) {
  return String(numero || '').replace(/\d(?=\d{4})/g, '*')
}

function truncate(value, max = 800) {
  const s = typeof value === 'string' ? value : String(value || '')
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

async function logAiGuardrail(payload = {}, { pool, logger } = {}) {
  const usePool = pool || getDefaultPool()
  if (!usePool || typeof usePool.query !== 'function') return false

  const numero = maskNumero(payload.numero || payload.conversationId || '')
  const rule = String(payload.rule || payload.tipo_guardrail || 'desconhecido').slice(0, 80)
  const severity = String(payload.severity || payload.severidade || 'bloquear').slice(0, 24)
  const action = String(payload.action || payload['ação_tomada'] || 'fallback_seguro').slice(0, 64)

  const deteccao = {
    rule,
    erros: Array.isArray(payload.erros) ? payload.erros.slice(0, 10) : undefined,
    original: truncate(payload.originalMessage),
    sanitized: truncate(payload.sanitizedMessage),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
  }

  try {
    await usePool.query(
      'INSERT INTO vendas.ai_guardrail_logs (numero, tipo_guardrail, severidade, "detecção", "ação_tomada") VALUES ($1, $2, $3, $4::jsonb, $5)',
      [numero, rule, severity, JSON.stringify(deteccao), action]
    )
    return true
  } catch (err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[guardrail-log] falha gravando ai_guardrail_logs (ignorado)', { erro: err.message })
    }
    return false
  }
}

module.exports = {
  logAiGuardrail,
  maskNumero,
}
