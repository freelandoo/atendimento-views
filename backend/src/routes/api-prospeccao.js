'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { listarProspects, pesquisarPlaces } = require('../prospecting')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/prospeccao/prospects?status=&nicho=&cidade=&busca=
router.get('/prospects', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const prospects = await listarProspects({
      empresaId: req.empresa.id,
      status: req.query.status,
      nicho: req.query.nicho,
      cidade: req.query.cidade,
      busca: req.query.busca,
      origem: req.query.origem,
      limit: req.query.limit,
    })
    return res.json({ ok: true, data: prospects, meta: { total: prospects.length } })
  } catch (err) {
    logger.error('GET prospeccao/prospects:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'PROSPECTS_FAILED', message: err.message } })
  }
})

// GET /api/empresas/:empresaId/prospeccao/metricas
router.get('/metricas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows: [m] } = await pool.query(
      `SELECT
         COUNT(*)                                   AS total,
         COUNT(*) FILTER (WHERE status='aguardando') AS aguardando,
         COUNT(*) FILTER (WHERE status='aprovado')   AS aprovados,
         COUNT(*) FILTER (WHERE status='rejeitado')  AS rejeitados,
         COUNT(*) FILTER (WHERE status='enviado')    AS enviados,
         COUNT(*) FILTER (WHERE status='respondeu')  AS responderam
       FROM prospectador.prospects WHERE empresa_id = $1`,
      [req.empresa.id]
    )
    const enviados = Number(m.enviados || 0) + Number(m.responderam || 0)
    const taxa_resposta = enviados > 0 ? Math.round((Number(m.responderam || 0) / enviados) * 100) : 0
    return res.json({ ok: true, data: { ...m, taxa_resposta } })
  } catch (err) {
    logger.error('GET prospeccao/metricas:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'METRICAS_FAILED', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/prospeccao/buscar  { nicho, cidade, quantidade }
// Pesquisa leads no Google Places e persiste como prospects DESTA empresa.
router.post('/buscar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nicho, cidade, local, quantidade } = req.body || {}
  if (!nicho || !(cidade || local)) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe nicho e cidade.' } })
  }
  try {
    const resultado = await pesquisarPlaces({
      nicho,
      local: cidade || local,
      quantidade,
      origem: 'manual',
      empresaId: req.empresa.id,
    })
    return res.json({ ok: true, data: resultado })
  } catch (err) {
    const status = err.statusCode || 500
    logger.error('POST prospeccao/buscar:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'BUSCA_FAILED', message: err.message } })
  }
})

module.exports = router
