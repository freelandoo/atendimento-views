// @ts-check
'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { gerarRelatorioIA, coletarDadosRelatorio } = require('../services/relatorio')
const { resumoEnvios } = require('../db/mensagem-envios')
const { DEFINICOES } = require('../services/mensagem-autoria')
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

// GET /api/empresas/:empresaId/relatorios/mensagens?de=&ate=&instancia=
// Mensagens ENVIADAS no período, separando IA × pessoa × autoria desconhecida.
//
// Cada número vem com a definição do que ele conta (`definicoes`), porque "mensagem",
// "lead contatado" e "lead que respondeu" medem coisas diferentes e o pedido do operador exige
// que a tela diga qual é qual. O que esta rota NÃO afirma: entrega, leitura, e nada sobre o
// histórico anterior ao ledger (migration 117) — aquele período não tem autoria registrada e
// não é retroagido.
router.get('/mensagens', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await resumoEnvios(pool, req.empresa.id, {
      de: req.query.de || null,
      ate: req.query.ate || null,
      instancia: req.query.instancia || null,
    })
    return res.json({ ok: true, data: { ...data, definicoes: DEFINICOES } })
  } catch (erro) {
    const err = /** @type {any} */ (erro)
    const status = err.statusCode || 500
    logger.error('[api-relatorios] MENSAGENS_FAILED: ' + err.message)
    return res.status(status).json({ ok: false, error: { code: 'MENSAGENS_FAILED', message: err.message } })
  }
})

module.exports = router
