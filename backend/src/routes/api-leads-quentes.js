'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { listarLeadsQuentesParaTrabalhar } = require('../leads-quentes')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/leads-quentes?limite=150&dias=45
// Carteira quente da empresa: leads qualificados/com oferta de reunião,
// ativos, sem venda fechada e sem reunião futura — ranqueados p/ o operador.
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const leads = await listarLeadsQuentesParaTrabalhar(pool, {
      empresaId: req.empresa.id,
      limite: req.query?.limite,
      diasAtivo: req.query?.dias,
    })
    return res.json({ ok: true, data: leads, meta: { total: leads.length } })
  } catch (err) {
    logger.error('GET /api/empresas/:id/leads-quentes:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'LEADS_QUENTES_FAILED', message: err.message } })
  }
})

module.exports = router
