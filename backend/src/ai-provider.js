'use strict'
const axios = require('axios')

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Preços em USD por TOKEN (não por 1k). Atualize quando houver mudança de tabela.
// Usado pela camada SaaS (api-llm-uso) para estimar custo a partir do usage logado.
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
  const m = String(model)
  const dated = Object.keys(MODEL_PRICES)
    .filter((key) => key.includes('-'))
    .sort((a, b) => b.length - a.length)
    .find((key) => m === key || m.startsWith(`${key}-`))
  if (dated) return MODEL_PRICES[dated]
  const base = m.split(/[-:@]/).slice(0, 4).join('-')
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

/**
 * Presets por provedor — usado para defaults na UI e validacao no backend.
 * Estrutura central para evitar divergencia entre frontend e backend.
 */
const AI_MODEL_PRESETS = {
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-4-6',
    defaultTemperature: 0.4,
    defaultMaxTokens: 1200,
    modelPrefixes: ['claude-'],
    models: [
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (mais capaz)' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recomendado)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (mais rápido)' },
      { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    ],
  },
  openai: {
    label: 'OpenAI GPT',
    defaultModel: 'gpt-4o-mini',
    defaultTemperature: 0.4,
    defaultMaxTokens: 1200,
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-'],
    models: [
      { value: 'gpt-4o', label: 'GPT-4o (mais capaz)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (recomendado)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (econômico)' },
    ],
  },
}

/**
 * Verifica se um par provider/model e valido. Se for, retorna `{ ok: true }`.
 * Caso contrario retorna `{ ok: false, erro: '...' }`.
 *
 * Evita estado inconsistente como provider=openai/model=claude-sonnet ou
 * provider=anthropic/model=gpt-4o.
 */
function validarProviderModel(provider, model) {
  const preset = AI_MODEL_PRESETS[provider]
  if (!preset) {
    return { ok: false, erro: `Provedor inválido: ${provider}.` }
  }
  const m = String(model || '').trim().toLowerCase()
  if (!m) {
    return { ok: false, erro: 'Modelo é obrigatório.' }
  }
  const ok = preset.modelPrefixes.some((p) => m.startsWith(p))
  if (!ok) {
    return {
      ok: false,
      erro: `Modelo "${model}" não é compatível com provedor "${preset.label}". Modelos esperados começam com: ${preset.modelPrefixes.join(', ')}.`,
    }
  }
  return { ok: true }
}

/**
 * Infere o provider a partir do nome do modelo (via modelPrefixes dos presets).
 * Usado quando o caller passa `model` mas nao `provider`: sem isto, um modelo
 * Claude ia para a OpenAI (provider configurado) e vice-versa, tomando 404 +
 * fallback a cada chamada. Retorna null se nao reconhecer o modelo.
 */
function inferProviderFromModel(model) {
  const m = String(model || '').trim().toLowerCase()
  if (!m) return null
  for (const [prov, preset] of Object.entries(AI_MODEL_PRESETS)) {
    if ((preset.modelPrefixes || []).some((p) => m.startsWith(p))) return prov
  }
  return null
}

function _envDefaults() {
  const primaryRaw = process.env.AI_PROVIDER || process.env.DEFAULT_AI_PROVIDER || 'openai'
  const primary = AI_MODEL_PRESETS[primaryRaw] ? primaryRaw : 'openai'
  const presetP = AI_MODEL_PRESETS[primary] || AI_MODEL_PRESETS.openai
  const fallback = primary === 'openai' ? 'anthropic' : 'openai'
  const presetF = AI_MODEL_PRESETS[fallback] || AI_MODEL_PRESETS.openai
  return {
    provider: primary,
    model:
      primary === 'openai'
        ? process.env.AI_MODEL || process.env.DEFAULT_AI_MODEL || process.env.DEFAULT_OPENAI_MODEL || presetP.defaultModel
        : process.env.AI_MODEL || process.env.DEFAULT_AI_MODEL || process.env.DEFAULT_ANTHROPIC_MODEL || presetP.defaultModel,
    temperature: presetP.defaultTemperature,
    max_tokens: presetP.defaultMaxTokens,
    fallback_provider: fallback,
    fallback_model:
      fallback === 'openai'
        ? process.env.DEFAULT_OPENAI_MODEL || presetF.defaultModel
        : process.env.DEFAULT_ANTHROPIC_MODEL || presetF.defaultModel,
    fallback_enabled: true,
  }
}

function _systemPromptToText(systemPrompt) {
  if (systemPrompt == null) return ''
  if (typeof systemPrompt === 'string') return systemPrompt
  if (Array.isArray(systemPrompt)) {
    return systemPrompt
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof systemPrompt === 'object' && typeof systemPrompt.text === 'string') return systemPrompt.text
  return String(systemPrompt)
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
        // Ensure numeric fields are actually numbers (not strings from DB)
        if (_cache.temperature != null) _cache.temperature = Number(_cache.temperature)
        if (_cache.max_tokens != null) _cache.max_tokens = Number(_cache.max_tokens)
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

/**
 * Converte um historico no formato Anthropic (messages: [{role, content}]) — que e o formato
 * usado internamente pelo agente — em payload OpenAI Chat Completions.
 */
/**
 * Converte o `content` de uma mensagem (formato interno Anthropic) para o formato
 * aceito pela OpenAI Chat Completions. Mantem compatibilidade total: quando NAO ha
 * imagem, retorna string simples (comportamento legado). Quando ha bloco de imagem
 * (`{ type:'image', source:{ type:'base64', media_type, data } }`), converte para o
 * formato multimodal da OpenAI (`{ type:'image_url', image_url:{ url:'data:...' } }`),
 * para que modelos com visao (ex.: gpt-4o) realmente enxerguem a imagem — antes o
 * bloco era descartado e a imagem nunca chegava ao modelo.
 */
function _anthropicContentToOpenAI(content) {
  if (!Array.isArray(content)) {
    if (content == null) return ''
    return typeof content === 'string' ? content : String(content)
  }
  const parts = []
  let temImagem = false
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (typeof b.text === 'string') {
      parts.push({ type: 'text', text: b.text })
    } else if (b.type === 'image' && b.source && b.source.data && b.source.media_type) {
      temImagem = true
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
      })
    }
  }
  if (!temImagem) {
    return parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  }
  return parts
}

function _anthropicMessagesToOpenAI(systemPrompt, messages) {
  const out = []
  const systemText = _systemPromptToText(systemPrompt).trim()
  if (systemText) out.push({ role: 'system', content: systemText })
  for (const m of messages || []) {
    if (!m || !m.role) continue
    // OpenAI Chat aceita roles user, assistant, system, tool. Mapeia operator -> user.
    const role = m.role === 'operator' ? 'user' : m.role
    out.push({ role, content: _anthropicContentToOpenAI(m.content) })
  }
  return out
}

async function _callAnthropic({ model, systemPrompt, userPrompt, messages, temperature, maxTokens, timeoutMs, extraHeaders }) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || '').trim()
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_KEY não configurada'), { code: 'sem_chave' })
  const finalMessages = Array.isArray(messages) && messages.length > 0
    ? messages.map((m) => ({ role: m.role === 'operator' ? 'user' : m.role, content: m.content }))
    : [{ role: 'user', content: String(userPrompt || '') }]
  const resp = await axios.post(
    ANTHROPIC_URL,
    {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: finalMessages,
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        ...(extraHeaders || {}),
      },
      timeout: timeoutMs,
    }
  )
  // Junta blocos `type: text` na Messages API (para o caso de respostas com tools/citations).
  let text = ''
  const content = resp.data?.content
  if (Array.isArray(content)) {
    text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
  } else if (typeof content === 'string') {
    text = content
  }
  return {
    text,
    raw_content: content,
    provider: 'anthropic',
    model: resp.data?.model || model,
    httpStatus: resp.status,
    stopReason: resp.data?.stop_reason || null,
    usage: resp.data?.usage || null,
  }
}

async function _callOpenAI({ model, systemPrompt, userPrompt, messages, temperature, maxTokens, timeoutMs, responseFormatJson, responseSchema, log }) {
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim()
  const systemText = _systemPromptToText(systemPrompt).trim()
  if (!apiKey) throw Object.assign(new Error('OPENAI_KEY não configurada'), { code: 'sem_chave' })
  const finalMessages = Array.isArray(messages) && messages.length > 0
    ? _anthropicMessagesToOpenAI(systemPrompt, messages)
    : [
        { role: 'system', content: systemText },
        { role: 'user', content: String(userPrompt || '') },
      ]
  // Ensure temperature is always a number
  const finalTemperature = Number.isFinite(temperature) ? temperature : 0.4

  // Structured Outputs (json_schema strict): quando o caller passa responseSchema,
  // a API OBRIGA o modelo a devolver todos os campos do contrato (fim do "campo
  // obrigatorio ausente"). Kill-switch: AI_STRUCTURED_OUTPUTS=off desliga. Se a API
  // recusar o schema (4xx), degrada para json_object automaticamente — nunca quebra.
  // responseFormatJson é o modo legado (só "JSON válido", sem garantir campos).
  const usarSchema = responseSchema && typeof responseSchema === 'object' && process.env.AI_STRUCTURED_OUTPUTS !== 'off'
  const montarBody = (comSchema) => {
    const b = { model, max_tokens: maxTokens, temperature: finalTemperature, messages: finalMessages }
    if (comSchema) {
      b.response_format = { type: 'json_schema', json_schema: { name: 'resposta_agente', strict: true, schema: responseSchema } }
    } else if (responseFormatJson === true) {
      b.response_format = { type: 'json_object' }
    }
    return b
  }
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  let resp
  try {
    resp = await axios.post(OPENAI_URL, montarBody(usarSchema), { headers, timeout: timeoutMs })
  } catch (err) {
    const st = err.response && err.response.status
    if (usarSchema && st >= 400 && st < 500) {
      if (log && typeof log.warn === 'function') {
        log.warn(`[ai-provider] structured outputs recusado (${st}) → fallback json_object`)
      }
      resp = await axios.post(OPENAI_URL, montarBody(false), { headers, timeout: timeoutMs })
    } else {
      throw err
    }
  }
  const text = String(resp.data?.choices?.[0]?.message?.content || '')
  return {
    text,
    raw_content: text,
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

async function _logAI(pool, { provider, model, task, success, errorMessage, latency, fallback_used }) {
  if (!pool) return
  try {
    await pool.query(
      'INSERT INTO vendas.ai_logs (provider, model, task, success, error_message, latency_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        provider,
        model,
        (task || 'geral') + (fallback_used ? ' (fallback)' : ''),
        success,
        errorMessage || null,
        Math.round(latency),
      ]
    )
  } catch (_) {}
}

/**
 * Central AI dispatch. Le ai_settings do banco (com cache), chama o provedor configurado,
 * faz fallback automatico (se habilitado e nao explicitamente desativado), e registra em ai_logs.
 *
 * @param {object} input
 * @param {string} [input.systemPrompt]
 * @param {string} [input.userPrompt] - usado quando nao ha `messages`
 * @param {Array<{role:string, content:string}>} [input.messages] - conversa multi-turn (preferido para agente)
 * @param {string} [input.task] - label de logging (ex.: 'agent_response', 'learning_diagnostico')
 * @param {string} [input.provider] - sobrescreve provider da config
 * @param {string} [input.model] - sobrescreve model da config
 * @param {number} [input.temperature]
 * @param {number} [input.maxTokens]
 * @param {number} [input.timeoutMs] - timeout do provider primario (default env AI_TIMEOUT_MS ou 30000)
 * @param {number} [input.fallbackTimeoutMs] - timeout do provider de fallback (default env AI_FALLBACK_TIMEOUT_MS ou herda do primario)
 * @param {boolean} [input.disableFallback] - se true, nao tenta fallback mesmo se habilitado
 * @param {boolean} [input.responseFormatJson] - OPT-IN explicito para forcar response_format=json_object na OpenAI; sem isso o provider retorna texto livre
 * @param {object} [input.extraHeaders] - headers extras para Anthropic (ex.: anthropic-beta)
 * @param {object} pool - pg Pool
 * @param {object} [log] - logger com .warn/.error
 * @returns {{ text, raw_content, provider, model, httpStatus, stopReason, usage, fallback_used }}
 */
async function generateAIResponse(input, pool, log) {
  const settings = await getAISettings(pool)
  // Quando o caller fixa um modelo sem provider, o provider e inferido do modelo
  // (Claude->anthropic, GPT->openai). Sem isto, model+provider divergiam e toda
  // chamada tomava 404 no provider configurado antes de cair no fallback.
  const providerInferido = !input.provider && input.model ? inferProviderFromModel(input.model) : null
  const provider = input.provider || providerInferido || settings.provider || 'openai'
  const model =
    input.model || settings.model || (AI_MODEL_PRESETS[provider] || AI_MODEL_PRESETS.openai).defaultModel
  // Ensure temperature is always a number (not string from DB)
  const temperature = Number.isFinite(input.temperature) ? input.temperature : (Number.isFinite(settings.temperature) ? settings.temperature : 0.4)
  const maxTokens = input.maxTokens || settings.max_tokens || 1200
  // Primario respeita o caller; env AI_TIMEOUT_MS so atua se ninguem passou timeoutMs.
  const primaryTimeoutMs = input.timeoutMs || parseInt(process.env.AI_TIMEOUT_MS, 10) || 30000
  // Fallback tem budget proprio (controla pior caso primary+fallback); herda do primario se nao configurado.
  const fallbackTimeoutMs = input.fallbackTimeoutMs || parseInt(process.env.AI_FALLBACK_TIMEOUT_MS, 10) || primaryTimeoutMs
  const task = input.task || 'geral'
  const disableFallback = input.disableFallback === true

  const callOpts = {
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    messages: input.messages,
    temperature,
    maxTokens,
    extraHeaders: input.extraHeaders,
    responseFormatJson: input.responseFormatJson === true,
    // Structured Outputs (só usado no caminho OpenAI; Anthropic ignora).
    responseSchema: input.responseSchema || null,
    log,
  }

  const inicio = Date.now()
  const systemPromptChars = _systemPromptToText(input.systemPrompt).trim().length
  if (log && typeof log.info === 'function') {
    log.info(`[AI_ENGINE] provider selected: ${provider}`)
    log.info(`[AI_ENGINE] model selected: ${model}`)
    log.info(`[AI_ENGINE] system prompt loaded: ${systemPromptChars > 0}`)
    log.info('[AI_ENGINE] system prompt source: runtime')
    log.info(`[AI_ENGINE] system prompt chars: ${systemPromptChars}`)
    log.info(`[AI_ENGINE] conversation messages loaded: ${Array.isArray(input.messages) ? input.messages.length : 0}`)
  }

  try {
    const result = await _doCall(provider, model, { ...callOpts, timeoutMs: primaryTimeoutMs })
    if (log && typeof log.info === 'function') log.info('[AI_ENGINE] fallback used: false')
    await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio })
    return { ...result, fallback_used: false }
  } catch (primaryErr) {
    if (disableFallback || !settings.fallback_enabled || !settings.fallback_provider) {
      await _logAI(pool, { provider, model, task, success: false, errorMessage: primaryErr.message, latency: Date.now() - inicio })
      throw primaryErr
    }
    const fbProvider = settings.fallback_provider
    const fbModel =
      settings.fallback_model || (AI_MODEL_PRESETS[fbProvider] || AI_MODEL_PRESETS.openai).defaultModel
    if (log && typeof log.warn === 'function') {
      log.warn(`[ai-provider] ${provider}/${model} falhou: ${primaryErr.message} → fallback ${fbProvider}/${fbModel}`)
    }
    try {
      const result = await _doCall(fbProvider, fbModel, { ...callOpts, timeoutMs: fallbackTimeoutMs })
      if (log && typeof log.info === 'function') log.info('[AI_ENGINE] fallback used: true')
      await _logAI(pool, { provider: result.provider, model: result.model, task, success: true, latency: Date.now() - inicio, fallback_used: true })
      return { ...result, fallback_used: true, primary_error: primaryErr.message }
    } catch (fallbackErr) {
      const errMsg = `primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`
      await _logAI(pool, { provider: fbProvider, model: fbModel, task, success: false, errorMessage: errMsg, latency: Date.now() - inicio, fallback_used: true })
      throw fallbackErr
    }
  }
}

/**
 * Lê a config do "LLM de geração" (gen_provider/gen_model) de ai_settings.
 * Retorna { provider, model } — campos null quando não configurados (= usar o
 * modelo de atendimento). Reusa o cache de getAISettings.
 */
async function getGenerationSettings(pool) {
  const s = await getAISettings(pool)
  return {
    provider: s && s.gen_provider ? s.gen_provider : null,
    model: s && s.gen_model ? s.gen_model : null,
  }
}

/**
 * Cria um "provider de geração" com a MESMA interface usada pelos serviços que
 * aceitam `aiProvider` injetável (contexto-estagios, contexto-empresa, etc.):
 * expõe `generateAIResponse(input, pool, log)`. Ele força provider/model de
 * geração (lidos de ai_settings a cada chamada, via cache) quando configurados;
 * sem config, comporta-se igual ao provider de atendimento. A CHAVE continua a
 * do ambiente (decisão "mesma conta").
 *
 * Uso (Slice 2): passar o objeto retornado como `aiProvider` para os serviços.
 */
function makeGenerationProvider() {
  return {
    async generateAIResponse(input, pool, log) {
      const gen = await getGenerationSettings(pool)
      const override = {}
      // Só sobrescreve quando o caller NÃO fixou explicitamente provider/model.
      if (!input.model && gen.model) override.model = gen.model
      if (!input.provider && gen.provider) override.provider = gen.provider
      return generateAIResponse({ ...input, ...override }, pool, log)
    },
  }
}

// Wrappers usados pela camada SaaS (resumo-conversa.js, relatorio.js, api-contextos.js).
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
  getGenerationSettings,
  makeGenerationProvider,
  invalidateCache,
  validarProviderModel,
  AI_MODEL_PRESETS,
  _systemPromptToText,
  priceFor,
  computeCost,
  generateContextPlan,
  summarizeConversation,
  generateReport,
}
