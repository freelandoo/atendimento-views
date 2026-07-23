'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const {
  listarProspects,
  pesquisarPlaces,
  listarBuscasRecentes,
  atualizarStatusProspect,
  atualizarStatusProspectsLote,
  atualizarEmailProspect,
} = require('../prospecting')
const {
  obterConfiguracaoProspeccao,
  salvarConfiguracaoProspeccao,
  montarAgendaPainelProspeccao,
} = require('../services/prospecting-settings')
const { obterDashboardEstrategicoProspeccao } = require('../services/prospecting-performance-analytics')
const { listarOpcoesFiltrosMercado } = require('../services/prospect-filters')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/prospeccao/prospects?status=&nicho=&cidade=&busca=
router.get('/prospects', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const prospects = await listarProspects({
      empresaId: req.empresa.id,
      status: req.query.status,
      mercado: req.query.mercado,
      nicho: req.query.nicho,
      categoria: req.query.categoria,
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

router.get('/filtros', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const status = String(req.query.status || '')
    const data = await listarOpcoesFiltrosMercado(pool, {
      empresaId: req.empresa.id,
      origem: req.query.origem ? String(req.query.origem) : undefined,
      status: status || undefined,
    })
    return res.json({ ok: true, data })
  } catch (err) {
    logger.error('GET prospeccao/filtros:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'FILTROS_FAILED', message: err.message } })
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

// POST /api/empresas/:empresaId/prospeccao/buscar  { nicho, cidade }
// Pesquisa leads no Google Places e persiste como prospects DESTA empresa.
router.post('/buscar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nicho, cidade, local } = req.body || {}
  if (!nicho || !(cidade || local)) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe nicho e cidade.' } })
  }
  try {
    const resultado = await pesquisarPlaces({
      nicho,
      local: cidade || local,
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

// GET /api/empresas/:empresaId/prospeccao/buscas
// Andamento das buscas (Bright Data Maps é assíncrona): o painel acompanha o status
// de cada busca e atualiza a lista quando 'concluido'.
router.get('/buscas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const buscas = await listarBuscasRecentes(req.empresa.id, req.query.limit)
    return res.json({ ok: true, data: buscas })
  } catch (err) {
    logger.error('GET prospeccao/buscas:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'BUSCAS_FAILED', message: err.message } })
  }
})

// GET /api/empresas/:empresaId/prospeccao/resultados
// Analytics da carteira DESTA empresa: desempenho por mercado (nicho/cidade) e
// quem respondeu recentemente. Tudo read-only e escopado por empresa_id.
router.get('/resultados', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows: porMercado } = await pool.query(
      `SELECT nicho, cidade,
              COUNT(*)                                          AS total,
              COUNT(*) FILTER (WHERE status IN ('enviado','respondeu')) AS enviados,
              COUNT(*) FILTER (WHERE status='respondeu')        AS responderam
         FROM prospectador.prospects
        WHERE empresa_id = $1
        GROUP BY nicho, cidade
        ORDER BY responderam DESC, total DESC
        LIMIT 12`,
      [req.empresa.id]
    )
    const { rows: recentes } = await pool.query(
      `SELECT nome, telefone, nicho, cidade, score, updated_at
         FROM prospectador.prospects
        WHERE empresa_id = $1 AND status = 'respondeu'
        ORDER BY updated_at DESC
        LIMIT 10`,
      [req.empresa.id]
    )
    return res.json({ ok: true, data: { por_mercado: porMercado, recentes } })
  } catch (err) {
    logger.error('GET prospeccao/resultados:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'RESULTADOS_FAILED', message: err.message } })
  }
})

// GET /api/empresas/:empresaId/prospeccao/analytics?inicio=&fim=&categoria=&cidade=&modo=&status=
// Dashboard estratégico (funil, rankings, série diária) escopado nesta empresa.
router.get('/analytics', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const dashboard = await obterDashboardEstrategicoProspeccao(pool, {
      ...req.query,
      empresaId: req.empresa.id,
    })
    return res.json({ ok: true, data: dashboard })
  } catch (err) {
    logger.error('GET prospeccao/analytics:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'ANALYTICS_FAILED', message: err.message } })
  }
})

// GET /api/empresas/:empresaId/prospeccao/configuracao
// Rotina + agenda do dia DESTA empresa (nicho/região/capacidade/próximos envios).
router.get('/configuracao', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const config = await obterConfiguracaoProspeccao(pool, req.empresa.id)
    const agenda = montarAgendaPainelProspeccao(config)
    return res.json({ ok: true, data: { config, agenda, escopo: 'empresa' } })
  } catch (err) {
    logger.error('GET prospeccao/configuracao:', err.message)
    return res.status(500).json({ ok: false, error: { code: 'CONFIG_FAILED', message: err.message } })
  }
})

// PUT /api/empresas/:empresaId/prospeccao/configuracao
// Salva a rotina DESTA empresa (nicho/cidade/região/capacidade/intervalo/janela/modo/ativo).
router.put('/configuracao', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const config = await salvarConfiguracaoProspeccao(pool, req.body || {}, req.empresa.id)
    const agenda = montarAgendaPainelProspeccao(config)
    return res.json({ ok: true, data: { config, agenda, escopo: 'empresa' } })
  } catch (err) {
    const status = err.statusCode || 500
    logger.error('PUT prospeccao/configuracao:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'CONFIG_SAVE_FAILED', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/prospeccao/prospects/:id/aprovar
router.post('/prospects/:id/aprovar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const prospect = await atualizarStatusProspect(req.params.id, 'aprovado', req.empresa.id)
    return res.json({ ok: true, data: prospect })
  } catch (err) {
    const status = err.statusCode || 500
    logger.error('POST prospeccao/aprovar:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'APROVAR_FAILED', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/prospeccao/prospects/:id/rejeitar
router.post('/prospects/:id/rejeitar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const prospect = await atualizarStatusProspect(req.params.id, 'rejeitado', req.empresa.id)
    return res.json({ ok: true, data: prospect })
  } catch (err) {
    const status = err.statusCode || 500
    logger.error('POST prospeccao/rejeitar:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'REJEITAR_FAILED', message: err.message } })
  }
})

// PATCH /api/empresas/:empresaId/prospeccao/prospects/:id/email  { email }
router.patch('/prospects/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await atualizarEmailProspect(req.empresa.id, req.params.id, (req.body || {}).email)
    return res.json({ ok: true, data })
  } catch (err) {
    const status = err.statusCode || 500
    logger.error('PATCH prospeccao/email:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'EMAIL_UPDATE_FAILED', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/prospeccao/prospects/lote  { ids: [], acao: 'aprovar'|'rejeitar' }
router.post('/prospects/lote', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { ids, acao } = req.body || {}
  const status = acao === 'rejeitar' ? 'rejeitado' : acao === 'aprovar' ? 'aprovado' : null
  if (!Array.isArray(ids) || !ids.length || !status) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe ids[] e acao (aprovar|rejeitar).' } })
  }
  try {
    const prospects = await atualizarStatusProspectsLote(ids, status, req.empresa.id)
    return res.json({ ok: true, data: prospects, meta: { atualizados: prospects.length } })
  } catch (err) {
    const code = err.statusCode || 500
    logger.error('POST prospeccao/lote:', err.message)
    return res.status(code).json({ ok: false, error: { code: 'LOTE_FAILED', message: err.message } })
  }
})

module.exports = router
