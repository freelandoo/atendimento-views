'use strict'
const axios = require('axios')

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

let _cache = null
let _cacheAt = 0
const CACHE_TTL = 30_000

function _envDefaults() {
  const primary = process.env.DEFAULT_AI_PROVIDER || 'anthropic'
  return {
    provider: primary,
    model:
      primary === 'openai'
        ? process.env.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini'
        : process.env.DEFAULT_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    temperature: 0.4,
    max_tokens: 1200,
    fallback_provider: primary === 'openai' ? 'anthropic' : 'openai',
    fallback_model:
      primary === 'openai'
        ? process.env.DEFAULT_ANTHROPIC_MODEL || 'claude-sonnet-4-6'
        : process.env.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini',
    fallback_enabled: true,
  }
}

async function getAISettings(pool) {
  const now = Date.now()
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache
  if (pool) {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1'
      )
      if (rows.length) {
        _cache = rows[0]
        _cacheAt = now
        return _cache
      }
    } catch (_) {}
  }
  _cache = _envDefaults()
  _cacheAt = now
  return _cache
}

function invalidateCache() {
  _cache = null
  _cacheAt = 0
}

async function _callAnthropic({ model, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs }) {
  const apiKey = String(process.env.ANTHROPIC_KEY || '').trim()
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_KEY não configurada'), { code: 'sem_chave' })
  const resp = await axios.post(
    ANTHROPIC_URL,
    {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: timeoutMs,
    }
  )
  return {
    text: String(resp.data?.content?.[0]?.text || ''),
    provider: 'anthropic',
    model: resp.data?.model || model,
    httpStatus: resp.status,
    stopReason: resp.data?.stop_reason || null,
    usage: resp.data?.usage || null,
  }
}

async function _callOpenAI({ model, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs }) {
  const apiKey = String(process.env.OPENAI_KEY || '').trim()
  if (!apiKey) throw Object.assign(new Error('OPENAI_KEY não configurada'), { code: 'sem_chave' })
  const resp = await axios.post(
    OPENAI_URL,
    {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    }
  )
  return {
    text: String(resp.data?.choices?.[0]?.message?.content || ''),
    provider: 'openai',
    model: resp.data?.model || model,
    httpStatus: resp.status,
    stopReason: resp.data?.choices?.[0]?.finish_reason || null,
    usage: resp.data?.usage || null,
  }
}

async function _doCall(provider, model, opts) {
  if (provider === 'openai') return _callOpenAI({ model, ...opts })
  return _callAnthropic({ model, ...opts })
}

async function _logAI(pool, { provider, model, task, success, errorMessage, latency }) {
  if (!pool) return
  try {
    await pool.query(
      'INSERT INTO vendas.ai_logs (provider, model, task, success, error_message, latency_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [provider, model, task || 'geral', success, errorMessage || null, Math.round(latency)]
    )
  } catch (_) {}
}

/**
 * Central AI dispatch function. Reads provider/model from ai_settings table (cached),
 * handles fallback automatically, and logs to ai_logs.
 *
 * @param {object} input
 * @param {string} input.systemPrompt
 * @param {string} input.userPrompt
 * @param {string} [input.task] - label for logging
 * @param {string} [input.provider] - override settings provider
 * @param {string} [input.model] - override settings model
 * @param {number} [input.temperature]
 * @param {number} [input.maxTokens]
 * @param {number} [input.timeoutMs]
 * @param {object} pool - pg Pool
 * @param {object} [log] - logger with .warn/.error methods
 * @returns {{ text, provider, model, httpStatus, stopReason, usage }}
 */
async function generateAIResponse(input, pool, log) {
  const settings = await getAISettings(pool)
  const provider = input.provider || settings.provider || 'anthropic'
  const model =
    input.model || settings.model || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-6')
  const temperature = input.temperature ?? settings.temperature ?? 0.4
  const maxTokens = input.maxTokens || settings.max_tokens || 1200
  const timeoutMs = input.timeoutMs || 30000
  const task = input.task || 'geral'

  const callOpts = {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    temperature,
    maxTokens,
    timeoutMs,
  }

  const inicio = Date.now()

  try {
    const result = await _doCall(provider, model, callOpts)
    await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio })
    return result
  } catch (primaryErr) {
    if (!settings.fallback_enabled || !settings.fallback_provider) {
      await _logAI(pool, { provider, model, task, success: false, errorMessage: primaryErr.message, latency: Date.now() - inicio })
      throw primaryErr
    }
    const fbProvider = settings.fallback_provider
    const fbModel =
      settings.fallback_model || (fbProvider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-6')
    if (log && typeof log.warn === 'function') {
      log.warn(`[ai-provider] ${provider}/${model} falhou: ${primaryErr.message} → fallback ${fbProvider}/${fbModel}`)
    }
    try {
      const result = await _doCall(fbProvider, fbModel, callOpts)
      await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio })
      return result
    } catch (fallbackErr) {
      const errMsg = `primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`
      await _logAI(pool, { provider: fbProvider, model: fbModel, task, success: false, errorMessage: errMsg, latency: Date.now() - inicio })
      throw fallbackErr
    }
  }
}

module.exports = { generateAIResponse, getAISettings, invalidateCache }
