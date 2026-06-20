'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const {
  listarEventos,
  obterEvento,
  criarEvento,
  atualizarEvento,
  removerEvento,
} = require('../services/agenda-multiempresa')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function tratarErro(res, err, fallbackCode, contexto) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${contexto}:`, err.message)
  return res.status(status).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
  })
}

// GET /api/empresas/:empresaId/agenda?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&tipo=&status=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await listarEventos(pool, {
      empresaId: req.empresa.id,
      inicio: req.query.inicio,
      fim: req.query.fim,
      tipo: req.query.tipo || null,
      status: req.query.status || null,
    })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_LIST_FAILED', 'GET agenda')
  }
})

// GET /api/empresas/:empresaId/agenda/:id
router.get('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await obterEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    if (!evento) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Evento não encontrado.' } })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_GET_FAILED', 'GET agenda/:id')
  }
})

// POST /api/empresas/:empresaId/agenda
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await criarEvento(pool, {
      empresaId: req.empresa.id,
      criadoPor: req.usuario?.id || null,
      ...(req.body || {}),
    })
    return res.status(201).json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_CREATE_FAILED', 'POST agenda')
  }
})

// PATCH /api/empresas/:empresaId/agenda/:id
router.patch('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const evento = await atualizarEvento(pool, {
      empresaId: req.empresa.id,
      id: req.params.id,
      ...(req.body || {}),
    })
    return res.json({ ok: true, data: evento })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_UPDATE_FAILED', 'PATCH agenda/:id')
  }
})

// DELETE /api/empresas/:empresaId/agenda/:id
router.delete('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const out = await removerEvento(pool, { empresaId: req.empresa.id, id: req.params.id })
    return res.json({ ok: true, data: out })
  } catch (err) {
    return tratarErro(res, err, 'AGENDA_DELETE_FAILED', 'DELETE agenda/:id')
  }
})

module.exports = router
