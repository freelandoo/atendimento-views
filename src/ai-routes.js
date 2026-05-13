'use strict'

const { pool } = require('./db')
const { dashboardAutorizado } = require('./dashboardAuth')
const { invalidateCache } = require('./ai-provider')

const VALID_PROVIDERS = ['openai', 'anthropic']

function registerAIRoutes(app) {
  app.get('/dashboard/ai/settings', dashboardAutorizado, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM vendas.ai_settings ORDER BY updated_at DESC LIMIT 1'
      )
      res.json({ ok: true, settings: rows[0] || null })
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message })
    }
  })

  app.post('/dashboard/ai/settings', dashboardAutorizado, async (req, res) => {
    try {
      const b = req.body || {}
      const provider = String(b.provider || 'anthropic')
      const model = String(b.model || 'claude-sonnet-4-6').slice(0, 120)
      const temperature = parseFloat(b.temperature) || 0.4
      const max_tokens = parseInt(b.max_tokens, 10) || 1200
      const fallback_provider = String(b.fallback_provider || 'openai')
      const fallback_model = String(b.fallback_model || 'gpt-4o-mini').slice(0, 120)
      const fallback_enabled = b.fallback_enabled !== false && b.fallback_enabled !== 'false'

      if (!VALID_PROVIDERS.includes(provider)) {
        return res.status(400).json({ ok: false, erro: 'Provedor inválido.' })
      }
      if (!VALID_PROVIDERS.includes(fallback_provider)) {
        return res.status(400).json({ ok: false, erro: 'Provedor de fallback inválido.' })
      }
      if (temperature < 0 || temperature > 2) {
        return res.status(400).json({ ok: false, erro: 'Temperatura deve ser entre 0 e 2.' })
      }
      if (max_tokens < 100 || max_tokens > 16000) {
        return res.status(400).json({ ok: false, erro: 'max_tokens deve ser entre 100 e 16000.' })
      }

      const { rows: existing } = await pool.query(
        'SELECT id FROM vendas.ai_settings LIMIT 1'
      )

      let result
      if (existing.length) {
        result = await pool.query(
          `UPDATE vendas.ai_settings
           SET provider=$1, model=$2, temperature=$3, max_tokens=$4,
               fallback_provider=$5, fallback_model=$6, fallback_enabled=$7,
               updated_at=NOW()
           WHERE id=$8 RETURNING *`,
          [provider, model, temperature, max_tokens, fallback_provider, fallback_model, fallback_enabled, existing[0].id]
        )
      } else {
        result = await pool.query(
          `INSERT INTO vendas.ai_settings
             (provider, model, temperature, max_tokens, fallback_provider, fallback_model, fallback_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [provider, model, temperature, max_tokens, fallback_provider, fallback_model, fallback_enabled]
        )
      }

      invalidateCache()
      res.json({ ok: true, settings: result.rows[0] })
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message })
    }
  })

  app.get('/dashboard/ai/logs', dashboardAutorizado, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM vendas.ai_logs ORDER BY created_at DESC LIMIT 50'
      )
      res.json({ ok: true, logs: rows })
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message })
    }
  })
}

module.exports = { registerAIRoutes }
