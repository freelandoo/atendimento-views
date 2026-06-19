'use strict'
const { Router } = require('express')
const axios = require('axios')
const { pool } = require('../db')
const { requireAuth } = require('../middleware/tenant')
const { invalidateCache } = require('../ai-provider')

const router = Router()

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    modelsUrl: 'https://api.openai.com/v1/models',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    parseModels: (data) => (data?.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by })),
  },
  anthropic: {
    label: 'Anthropic',
    modelsUrl: 'https://api.anthropic.com/v1/models',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    parseModels: (data) => (data?.data || []).map((m) => ({ id: m.id, display_name: m.display_name })),
  },
}

function maskKey(k) {
  if (!k) return null
  if (k.length <= 10) return '***'
  return `${k.slice(0, 6)}…${k.slice(-4)}`
}

// GET /api/llm — retorna config atual (sem expor chaves)
router.get('/', requireAuth, async (_req, res) => {
  const { rows: [s] } = await pool.query(
    'SELECT * FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1'
  )
  if (!s) return res.json({ ok: true, data: null })
  return res.json({
    ok: true,
    data: {
      provider: s.provider,
      model: s.model,
      status: s.status || 'pendente',
      last_error: s.last_error,
      tested_at: s.tested_at,
      openai_key_masked: maskKey(s.openai_api_key),
      anthropic_key_masked: maskKey(s.anthropic_api_key),
      has_openai_key: !!s.openai_api_key,
      has_anthropic_key: !!s.anthropic_api_key,
    },
  })
})

// POST /api/llm/test — { provider, api_key } → lista modelos disponíveis
router.post('/test', requireAuth, async (req, res) => {
  const { provider, api_key } = req.body || {}
  const cfg = PROVIDERS[provider]
  if (!cfg) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Provider inválido. Use "openai" ou "anthropic".' } })
  }
  if (!api_key || typeof api_key !== 'string' || api_key.length < 10) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'API key obrigatória.' } })
  }
  try {
    const { data } = await axios.get(cfg.modelsUrl, {
      headers: cfg.authHeader(api_key.trim()),
      timeout: 15000,
    })
    return res.json({ ok: true, data: { provider, models: cfg.parseModels(data) } })
  } catch (err) {
    const status = err.response?.status || 0
    const body = err.response?.data
    const message = body?.error?.message || body?.message || err.message
    return res.status(200).json({
      ok: false,
      error: {
        code: 'PROVIDER_ERROR',
        message: `[${status || 'rede'}] ${message}`,
        details: typeof body === 'object' ? body : { raw: String(body || '') },
      },
    })
  }
})

// POST /api/llm/activate — { provider, api_key, model } → salva e ativa
router.post('/activate', requireAuth, async (req, res) => {
  const { provider, api_key, model } = req.body || {}
  const cfg = PROVIDERS[provider]
  if (!cfg) return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Provider inválido.' } })
  if (!api_key || !model) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'api_key e model obrigatórios.' } })
  }

  const keyTrimmed = String(api_key).trim()
  const keyColumn = provider === 'openai' ? 'openai_api_key' : 'anthropic_api_key'

  try {
    await axios.get(cfg.modelsUrl, { headers: cfg.authHeader(keyTrimmed), timeout: 15000 })
  } catch (err) {
    const status = err.response?.status || 0
    const message = err.response?.data?.error?.message || err.response?.data?.message || err.message
    await pool.query(
      `UPDATE vendas.ai_settings SET status = 'erro', last_error = $1, tested_at = NOW(), updated_at = NOW()
       WHERE id = (SELECT id FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1)`,
      [`[${status}] ${message}`]
    )
    invalidateCache()
    return res.status(200).json({
      ok: false,
      error: { code: 'PROVIDER_ERROR', message: `[${status || 'rede'}] ${message}` },
    })
  }

  const { rowCount } = await pool.query(
    `UPDATE vendas.ai_settings
     SET provider = $1, model = $2, ${keyColumn} = $3,
         status = 'ativo', last_error = NULL, tested_at = NOW(), updated_at = NOW()
     WHERE id = (SELECT id FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1)`,
    [provider, model, keyTrimmed]
  )
  if (rowCount === 0) {
    await pool.query(
      `INSERT INTO vendas.ai_settings (provider, model, ${keyColumn}, status, tested_at)
       VALUES ($1, $2, $3, 'ativo', NOW())`,
      [provider, model, keyTrimmed]
    )
  }
  invalidateCache()
  const { rows: [s] } = await pool.query('SELECT * FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1')
  return res.json({
    ok: true,
    data: {
      provider: s.provider,
      model: s.model,
      status: s.status,
      tested_at: s.tested_at,
    },
  })
})

module.exports = router
