'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { gerarRelatorioIA, coletarDadosRelatorio } = require('../services/relatorio')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/relatorios/resumo
router.get('/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const data = await coletarDadosRelatorio(pool, req.empresa.id)
  return res.json({ ok: true, data })
})

// POST /api/empresas/:empresaId/relatorios/ia
// Body: { tipo?: string, dados?: object }
// Se dados não fornecido, coleta automaticamente da empresa.
router.post('/ia', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { tipo = 'geral', dados } = req.body || {}
  const dadosFinais = dados || await coletarDadosRelatorio(pool, req.empresa.id)
  const result = await gerarRelatorioIA(pool, {
    empresaId: req.empresa.id,
    tipo,
    dados: dadosFinais,
    log: logger,
  })
  return res.json({ ok: true, data: result })
})

module.exports = router
