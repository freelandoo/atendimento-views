'use strict'
const axios = require('axios')

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Preços em USD por TOKEN (não por 1k). Atualize quando houver mudança de tabela.
const MODEL_PRICES = {
  'gpt-4o-mini':        { input: 0.150 / 1e6, output: 0.600 / 1e6 },
  'gpt-4o':             { input: 2.500 / 1e6, output: 10.000 / 1e6 },
  'gpt-4-turbo':        { input: 10.000 / 1e6, output: 30.000 / 1e6 },
  'gpt-3.5-turbo':      { input: 0.500 / 1e6, output: 1.500 / 1e6 },
  'claude-sonnet-4-6':  { input: 3.000 / 1e6, output: 15.000 / 1e6 },
  'claude-sonnet-4-5':  { input: 3.000 / 1e6, output: 15.000 / 1e6 },
  'claude-haiku-4-5':   { input: 1.000 / 1e6, output: 5.000 / 1e6 },
  'claude-opus-4-7':    { input: 15.000 / 1e6, output: 75.000 / 1e6 },
}

function priceFor(model) {
  if (!model) return null
  if (MODEL_PRICES[model]) return MODEL_PRICES[model]
  const base = String(model).split(/[-:@]/).slice(0, 4).join('-')
  return MODEL_PRICES[base] || null
}

function computeCost(model, inputTokens, outputTokens) {
  const p = priceFor(model)
  if (!p) return null
  return (Number(inputTokens || 0) * p.input) + (Number(outputTokens || 0) * p.output)
}

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

async function _callAnthropic({ model, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs, apiKey: keyOverride }) {
  const apiKey = String(keyOverride || process.env.ANTHROPIC_KEY || '').trim()
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_KEY não configurada'), { code: 'sem_chave' })
  let resp
  try {
    resp = await axios.post(
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
  } catch (err) {
    const status = err.response?.status
    const body = err.response?.data
    const detail = body?.error?.message || body?.message || JSON.stringify(body || {}).slice(0, 500)
    throw Object.assign(new Error(`Anthropic ${status || ''} ${detail}`.trim()), { code: 'anthropic_http_error', status, body })
  }
  return {
    text: String(resp.data?.content?.[0]?.text || ''),
    provider: 'anthropic',
    model: resp.data?.model || model,
    httpStatus: resp.status,
    stopReason: resp.data?.stop_reason || null,
    usage: resp.data?.usage || null,
  }
}

async function _callOpenAI({ model, systemPrompt, userPrompt, temperature, maxTokens, timeoutMs, apiKey: keyOverride }) {
  const apiKey = String(keyOverride || process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim()
  if (!apiKey) throw Object.assign(new Error('OPENAI_KEY não configurada'), { code: 'sem_chave' })
  let resp
  try {
    resp = await axios.post(
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
  } catch (err) {
    const status = err.response?.status
    const body = err.response?.data
    const detail = body?.error?.message || body?.message || JSON.stringify(body || {}).slice(0, 500)
    throw Object.assign(new Error(`OpenAI ${status || ''} ${detail}`.trim()), { code: 'openai_http_error', status, body })
  }
  return {
    text: String(resp.data?.choices?.[0]?.message?.content || ''),
    provider: 'openai',
    model: resp.data?.model || model,
    httpStatus: resp.status,
    stopReason: resp.data?.choices?.[0]?.finish_reason || null,
    usage: resp.data?.usage || null,
  }
}

async function _doCall(provider, model, opts, settings) {
  const apiKey = provider === 'openai'
    ? (settings?.openai_api_key || null)
    : (settings?.anthropic_api_key || null)
  if (provider === 'openai') return _callOpenAI({ model, apiKey, ...opts })
  return _callAnthropic({ model, apiKey, ...opts })
}

async function _logAI(pool, { provider, model, task, success, errorMessage, latency, empresaId, refType, refId, clientNumero, inputTokens, outputTokens }) {
  if (!pool) return
  const cost = success ? computeCost(model, inputTokens, outputTokens) : null
  try {
    await pool.query(
      `INSERT INTO vendas.ai_logs
       (provider, model, task, success, error_message, latency_ms,
        empresa_id, ref_type, ref_id, client_numero, input_tokens, output_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        provider, model, task || 'geral', success, errorMessage || null, Math.round(latency || 0),
        empresaId || null, refType || null, refId || null, clientNumero || null,
        inputTokens || null, outputTokens || null, cost,
      ]
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
function _usageOf(result) {
  const u = result?.usage || {}
  return {
    inputTokens: u.input_tokens ?? u.prompt_tokens ?? null,
    outputTokens: u.output_tokens ?? u.completion_tokens ?? null,
  }
}

async function generateAIResponse(input, pool, log) {
  const settings = await getAISettings(pool)
  const provider = input.provider || settings.provider || 'anthropic'
  const model =
    input.model || settings.model || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-6')
  const temperature = input.temperature ?? settings.temperature ?? 0.4
  const maxTokens = input.maxTokens || settings.max_tokens || 1200
  const timeoutMs = input.timeoutMs || 30000
  const task = input.task || 'geral'
  const ctx = {
    empresaId: input.empresaId,
    refType: input.refType,
    refId: input.refId,
    clientNumero: input.clientNumero,
  }

  const callOpts = {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    temperature,
    maxTokens,
    timeoutMs,
  }

  const inicio = Date.now()

  try {
    const result = await _doCall(provider, model, callOpts, settings)
    const u = _usageOf(result)
    await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio, ...ctx, ...u })
    return result
  } catch (primaryErr) {
    if (!settings.fallback_enabled || !settings.fallback_provider) {
      await _logAI(pool, { provider, model, task, success: false, errorMessage: primaryErr.message, latency: Date.now() - inicio, ...ctx })
      throw primaryErr
    }
    const fbProvider = settings.fallback_provider
    const fbModel =
      settings.fallback_model || (fbProvider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-6')
    if (log && typeof log.warn === 'function') {
      log.warn(`[ai-provider] ${provider}/${model} falhou: ${primaryErr.message} → fallback ${fbProvider}/${fbModel}`)
    }
    try {
      const result = await _doCall(fbProvider, fbModel, callOpts, settings)
      const u = _usageOf(result)
      await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio, ...ctx, ...u })
      return result
    } catch (fallbackErr) {
      const errMsg = `primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`
      await _logAI(pool, { provider: fbProvider, model: fbModel, task, success: false, errorMessage: errMsg, latency: Date.now() - inicio, ...ctx })
      throw fallbackErr
    }
  }
}

// ─── Funções de domínio ───────────────────────────────────────────────────────

const { parsearRespostaJsonClaude } = require('./string-utils')

async function generateContextPlan({ contexto1, pool, log, empresaId, refId }) {
  const systemPrompt = `Você é um especialista em vendas consultivas e automação de WhatsApp.
Dado o Contexto 1 (briefing textual de uma empresa), gere um Contexto 2 em JSON estruturado.
Responda APENAS com o JSON válido, sem markdown, sem explicação extra.`

  const userPrompt = `CONTEXTO 1:\n${contexto1}\n\nGere o Contexto 2 JSON conforme o schema da documentação.`

  const result = await generateAIResponse(
    {
      systemPrompt, userPrompt, task: 'generateContextPlan', maxTokens: 4000,
      empresaId, refType: 'contexto', refId,
    },
    pool,
    log
  )
  return { ...result, json: parsearRespostaJsonClaude(result.text) }
}

async function extractLeadData({ conversa, pool, log }) {
  const systemPrompt = `Extraia dados estruturados do lead a partir do texto da conversa.
Responda APENAS com JSON válido. Inclua campos que você conseguir inferir, mesmo que incompletos.
Campos possíveis: negocio, cidade, ticket_cliente_final, ja_aparece_google, complexidade, dor_principal, intencao_principal, temperatura_lead.`

  const userPrompt = `CONVERSA:\n${conversa}`

  const result = await generateAIResponse(
    { systemPrompt, userPrompt, task: 'extractLeadData', maxTokens: 800 },
    pool,
    log
  )
  return { ...result, json: parsearRespostaJsonClaude(result.text) }
}

async function generateAgentReply({ systemPrompt, userPrompt, pool, log, temperature, maxTokens, timeoutMs, empresaId, clientNumero }) {
  return generateAIResponse(
    {
      systemPrompt, userPrompt, task: 'agentReply', temperature, maxTokens, timeoutMs,
      empresaId, refType: 'reply', clientNumero,
    },
    pool,
    log
  )
}

async function summarizeConversation({ historico, pool, log, empresaId, clientNumero }) {
  const systemPrompt = `Resuma a conversa de vendas em 3-5 frases, destacando: estágio atual, principais dores, objeções, próximos passos.`
  const userPrompt = Array.isArray(historico)
    ? historico.map(m => `${m.role}: ${m.content || ''}`).join('\n')
    : String(historico || '')

  return generateAIResponse(
    {
      systemPrompt, userPrompt, task: 'summarizeConversation', maxTokens: 400,
      empresaId, refType: 'resumo', clientNumero,
    },
    pool,
    log
  )
}

async function generateReport({ dados, tipo = 'geral', pool, log, empresaId }) {
  const systemPrompt = `Você é um analista de vendas. Gere um relatório objetivo em português brasileiro, em formato de bullet points, com insights acionáveis.`
  const userPrompt = `TIPO: ${tipo}\nDADOS:\n${typeof dados === 'string' ? dados : JSON.stringify(dados, null, 2)}`

  return generateAIResponse(
    {
      systemPrompt, userPrompt, task: 'generateReport', maxTokens: 1000,
      empresaId, refType: 'relatorio',
    },
    pool,
    log
  )
}

module.exports = {
  generateAIResponse,
  getAISettings,
  invalidateCache,
  generateContextPlan,
  extractLeadData,
  generateAgentReply,
  summarizeConversation,
  generateReport,
}
