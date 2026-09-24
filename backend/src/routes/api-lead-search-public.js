'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const leadSearchDb = require('../db/lead-search')
const keysDb = require('../db/lead-search-keys')
const LS = require('../services/lead-search')
const KEY = require('../services/lead-search-keys')
const { processarJobMaps } = require('../services/lead-search-worker')
const { logger } = require('../logger')

const router = Router()

function responderErro(res, err, code = 'LEAD_SEARCH_PUBLIC_FAILED') {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code: err.code || code, message: err.message } })
}

function apresentarJobComFontes(data) {
  if (!data) return null
  return {
    job: LS.apresentarJob(data.job),
    sources: (data.sources || []).map(LS.apresentarSource),
  }
}

async function autenticar(req, scope) {
  const codigo = KEY.extrairBearer(req.get('authorization'))
  if (!codigo) throw KEY.erro('Informe Authorization: Bearer <codigo>.', 401, 'MISSING_API_KEY')
  return keysDb.autenticarCodigo(pool, codigo, { scope })
}

// POST /api/lead-search/maps
router.post('/maps', async (req, res) => {
  let chave = null
  try {
    chave = await autenticar(req, 'lead_search:maps:create')
    const normalizado = LS.normalizarRequestMaps(req.body || {})
    if (normalizado.requestedLimit > Number(chave.max_leads_per_job || 100)) {
      const err = KEY.erro(`Este codigo permite no maximo ${chave.max_leads_per_job} leads por busca.`, 400, 'KEY_LIMIT_EXCEEDED')
      await keysDb.registrarBloqueio(pool, {
        chave,
        endpoint: 'POST /api/lead-search/maps',
        requestSummary: normalizado.request,
        errorCode: err.code,
      }).catch(() => {})
      throw err
    }

    const recentes = await keysDb.contarCriacoesRecentes(pool, chave.id)
    if (recentes >= Number(chave.rate_limit_per_minute || 10)) {
      const err = KEY.erro('Muitas criacoes de busca em pouco tempo. Tente novamente em instantes.', 429, 'RATE_LIMITED')
      await keysDb.registrarBloqueio(pool, {
        chave,
        endpoint: 'POST /api/lead-search/maps',
        requestSummary: normalizado.request,
        errorCode: err.code,
      }).catch(() => {})
      throw err
    }

    const data = await leadSearchDb.criarJobMaps(pool, {
      empresaId: chave.empresa_id,
      usuarioId: null,
      apiKeyId: chave.id,
      channel: 'external',
      endpoint: 'POST /api/lead-search/maps',
      request: normalizado.request,
      requestedLimit: normalizado.requestedLimit,
    })

    processarJobMaps(pool, data.job.id).catch((err) => {
      logger.warn({ err: err.message, jobId: data.job.id }, '[lead-search-public] processamento inicial falhou')
    })

    return res.status(202).json({ ok: true, data: apresentarJobComFontes(data) })
  } catch (err) {
    return responderErro(res, err, 'LEAD_SEARCH_PUBLIC_MAPS_CREATE_FAILED')
  }
})

// GET /api/lead-search/jobs/:jobId
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const chave = await autenticar(req, 'lead_search:jobs:read')
    const data = await leadSearchDb.carregarJobPorApiKey(pool, { apiKeyId: chave.id, jobId: req.params.jobId })
    if (!data) {
      return res.status(404).json({ ok: false, error: { code: 'JOB_NOT_FOUND', message: 'Job nao encontrado para este codigo.' } })
    }
    return res.json({ ok: true, data: apresentarJobComFontes(data) })
  } catch (err) {
    return responderErro(res, err, 'LEAD_SEARCH_PUBLIC_JOB_GET_FAILED')
  }
})

// GET /api/lead-search/jobs/:jobId/dossiers
router.get('/jobs/:jobId/dossiers', async (req, res) => {
  try {
    const chave = await autenticar(req, 'lead_search:jobs:read')
    const data = await leadSearchDb.carregarJobPorApiKey(pool, { apiKeyId: chave.id, jobId: req.params.jobId })
    if (!data) {
      return res.status(404).json({ ok: false, error: { code: 'JOB_NOT_FOUND', message: 'Job nao encontrado para este codigo.' } })
    }
    const dossiers = await leadSearchDb.listarDossiersPorApiKey(pool, {
      apiKeyId: chave.id,
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
    return responderErro(res, err, 'LEAD_SEARCH_PUBLIC_DOSSIERS_GET_FAILED')
  }
})

module.exports = router
