'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const leadSearchDb = require('../db/lead-search')
const LS = require('../services/lead-search')
const { processarJobMaps } = require('../services/lead-search-worker')
const { registrarAuditoria } = require('../db/auditoria')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function responderErro(res, err, code = 'LEAD_SEARCH_FAILED') {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({
    ok: false,
    error: { code: err.code || code, message: err.message },
  })
}

function apresentarJobComFontes(data) {
  if (!data) return null
  return {
    job: LS.apresentarJob(data.job),
    sources: (data.sources || []).map(LS.apresentarSource),
  }
}

// POST /api/empresas/:empresaId/lead-search/maps
// Cria uma busca em lote por Google Maps/Bright Data. Nao aplica qualificacao nem salva no
// Banco de Leads: esta API e' motor de dados, e a aplicacao decide o que fazer com o retorno.
router.post('/maps', async (req, res) => {
  try {
    const normalizado = LS.normalizarRequestMaps(req.body || {})
    const data = await leadSearchDb.criarJobMaps(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      request: normalizado.request,
      requestedLimit: normalizado.requestedLimit,
    })

    registrarAuditoria(pool, req.empresa.id, {
      usuarioId: req.usuario?.id || null,
      entidadeTipo: 'lead_search_job',
      entidadeId: data.job.id,
      acao: 'criar_busca_maps',
      estadoNovo: data.job.status,
      contexto: {
        nicho: normalizado.request.nicho,
        cidade: normalizado.request.cidade,
        pais: normalizado.request.pais,
        limit: normalizado.request.limit,
      },
    }).catch(() => {})

    processarJobMaps(pool, data.job.id).catch((err) => {
      logger.warn({ err: err.message, jobId: data.job.id }, '[lead-search] processamento inicial falhou')
    })

    return res.status(202).json({ ok: true, data: apresentarJobComFontes(data) })
  } catch (err) {
    return responderErro(res, err, 'LEAD_SEARCH_MAPS_CREATE_FAILED')
  }
})

// GET /api/empresas/:empresaId/lead-search/jobs/:jobId
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const data = await leadSearchDb.carregarJob(pool, { empresaId: req.empresa.id, jobId: req.params.jobId })
    if (!data) {
      return res.status(404).json({ ok: false, error: { code: 'JOB_NOT_FOUND', message: 'Job nao encontrado nesta empresa.' } })
    }
    return res.json({ ok: true, data: apresentarJobComFontes(data) })
  } catch (err) {
    return responderErro(res, err, 'LEAD_SEARCH_JOB_GET_FAILED')
  }
})

// GET /api/empresas/:empresaId/lead-search/jobs/:jobId/dossiers?limit=&offset=
router.get('/jobs/:jobId/dossiers', async (req, res) => {
  try {
    const data = await leadSearchDb.carregarJob(pool, { empresaId: req.empresa.id, jobId: req.params.jobId })
    if (!data) {
      return res.status(404).json({ ok: false, error: { code: 'JOB_NOT_FOUND', message: 'Job nao encontrado nesta empresa.' } })
    }
    const dossiers = await leadSearchDb.listarDossiers(pool, {
      empresaId: req.empresa.id,
      jobId: req.params.jobId,
      limit: req.query.limit,
      offset: req.query.offset,
    })
    return res.json({
      ok: true,
      data: {
        job: LS.apresentarJob(data.job),
        dossiers: dossiers.map(LS.apresentarDossier),
      },
      meta: { total: dossiers.length },
    })
  } catch (err) {
    return responderErro(res, err, 'LEAD_SEARCH_DOSSIERS_GET_FAILED')
  }
})

module.exports = router
