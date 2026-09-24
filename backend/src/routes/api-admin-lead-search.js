'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireRole } = require('../middleware/tenant')
const keysDb = require('../db/lead-search-keys')
const KEY = require('../services/lead-search-keys')
const { logger } = require('../logger')

const router = Router()
router.use(requireAuth, requireRole('superadmin'))

function erro(res, err, code = 'ADMIN_LEAD_SEARCH_FAILED') {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code: err.code || code, message: err.message } })
}

// GET /api/admin/lead-search/empresas
router.get('/empresas', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, slug, ativo
         FROM app.empresas
        WHERE ativo IS DISTINCT FROM false
        ORDER BY nome ASC
        LIMIT 500`
    )
    return res.json({ ok: true, data: rows })
  } catch (err) {
    return erro(res, err, 'LEAD_SEARCH_COMPANIES_LIST_FAILED')
  }
})

// GET /api/admin/lead-search/keys
router.get('/keys', async (req, res) => {
  try {
    const rows = await keysDb.listarChaves(pool, {
      empresaId: req.query.empresa_id || null,
      status: req.query.status || null,
      limit: req.query.limit,
    })
    return res.json({ ok: true, data: rows.map(KEY.apresentarChave) })
  } catch (err) {
    return erro(res, err, 'LEAD_SEARCH_KEYS_LIST_FAILED')
  }
})

// POST /api/admin/lead-search/keys
router.post('/keys', async (req, res) => {
  try {
    const b = req.body || {}
    const r = await keysDb.criarChave(pool, {
      empresaId: b.empresa_id || b.empresaId || null,
      nome: b.nome || b.name,
      scopes: b.scopes,
      expiresAt: b.expires_at || b.expiresAt || null,
      maxLeadsPerJob: b.max_leads_per_job ?? b.maxLeadsPerJob,
      rateLimitPerMinute: b.rate_limit_per_minute ?? b.rateLimitPerMinute,
      createdByUsuarioId: req.usuario?.id || null,
    })
    return res.status(201).json({
      ok: true,
      data: {
        key: KEY.apresentarChave(r.chave),
        codigo: r.codigo,
      },
      meta: {
        aviso: 'Guarde este codigo agora. Ele nao sera exibido novamente.',
      },
    })
  } catch (err) {
    return erro(res, err, 'LEAD_SEARCH_KEY_CREATE_FAILED')
  }
})

// POST /api/admin/lead-search/keys/:keyId/revoke
router.post('/keys/:keyId/revoke', async (req, res) => {
  try {
    const row = await keysDb.revogarChave(pool, { keyId: req.params.keyId, usuarioId: req.usuario?.id || null })
    if (!row) return res.status(404).json({ ok: false, error: { code: 'KEY_NOT_FOUND', message: 'Codigo nao encontrado.' } })
    return res.json({ ok: true, data: KEY.apresentarChave(row) })
  } catch (err) {
    return erro(res, err, 'LEAD_SEARCH_KEY_REVOKE_FAILED')
  }
})

// POST /api/admin/lead-search/keys/:keyId/rotate
router.post('/keys/:keyId/rotate', async (req, res) => {
  try {
    const r = await keysDb.rotacionarChave(pool, { keyId: req.params.keyId, usuarioId: req.usuario?.id || null })
    if (!r) return res.status(404).json({ ok: false, error: { code: 'KEY_NOT_FOUND', message: 'Codigo nao encontrado.' } })
    return res.status(201).json({
      ok: true,
      data: {
        key: KEY.apresentarChave(r.chave),
        codigo: r.codigo,
      },
      meta: {
        aviso: 'Guarde este codigo agora. Ele nao sera exibido novamente.',
      },
    })
  } catch (err) {
    return erro(res, err, 'LEAD_SEARCH_KEY_ROTATE_FAILED')
  }
})

module.exports = router
