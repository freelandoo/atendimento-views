'use strict'

const dbPadrao = require('../db/lead-search')
const mapsPadrao = require('./places-brightdata')
const LS = require('./lead-search')
const { logger } = require('../logger')

const INTERVALO_MS = Math.max(10000, Number.parseInt(process.env.LEAD_SEARCH_WORKER_INTERVAL_MS, 10) || 60000)
const LOTE_PADRAO = Math.max(1, Math.min(10, Number.parseInt(process.env.LEAD_SEARCH_WORKER_BATCH, 10) || 3))

const ESTADOS_EM_ANDAMENTO = new Set(['running', 'building', 'collecting', 'pending'])
const ESTADOS_FALHA = new Set(['failed', 'error'])

function erroMsg(err) {
  return err && err.message ? err.message : String(err || 'erro desconhecido')
}

async function processarJobMaps(pool, jobId, deps = {}) {
  const db = deps.db || dbPadrao
  const maps = deps.maps || mapsPadrao

  const job = await db.iniciarJobMaps(pool, jobId)
  if (!job) return { ok: false, motivo: 'job_nao_processavel' }

  let fonte = await db.carregarFonte(pool, job.id, LS.SOURCES.GOOGLE_MAPS)
  if (!fonte || !fonte.external_snapshot_id) {
    try {
      const disparo = await maps.dispararBuscaMaps({
        nicho: job.request?.nicho,
        cidade: job.request?.cidade,
        pais: job.request?.pais || 'BR',
      })
      fonte = await db.registrarTriggerMaps(pool, {
        jobId: job.id,
        snapshotId: disparo.snapshotId,
        providerStatus: 'triggered',
        rawProgress: { geo: disparo.geo || null },
      })
      return { ok: true, status: LS.JOB_STATUS.RUNNING, triggered: true, snapshot_id: fonte?.external_snapshot_id || disparo.snapshotId }
    } catch (err) {
      await db.marcarProviderFailed(pool, {
        jobId: job.id,
        errorType: err.code || 'trigger_failed',
        errorMessage: erroMsg(err),
      })
      return { ok: false, motivo: 'trigger_failed', erro: erroMsg(err) }
    }
  }

  let status
  try {
    status = await maps.estadoBuscaMaps(fonte.external_snapshot_id)
  } catch (err) {
    await db.marcarProviderFailed(pool, {
      jobId: job.id,
      errorType: err.code || 'progress_failed',
      errorMessage: erroMsg(err),
    })
    return { ok: false, motivo: 'progress_failed', erro: erroMsg(err) }
  }

  if (ESTADOS_EM_ANDAMENTO.has(status)) {
    await db.registrarProgressoFonte(pool, {
      jobId: job.id,
      providerStatus: status,
      rawProgress: { status },
    })
    return { ok: true, status: LS.JOB_STATUS.RUNNING, provider_status: status }
  }

  if (ESTADOS_FALHA.has(status)) {
    await db.marcarProviderFailed(pool, {
      jobId: job.id,
      errorType: `bright_data_${status}`,
      errorMessage: `Bright Data retornou estado ${status}.`,
    })
    return { ok: false, motivo: 'provider_failed', provider_status: status }
  }

  if (status !== 'ready') {
    await db.registrarProgressoFonte(pool, {
      jobId: job.id,
      providerStatus: status || 'unknown',
      rawProgress: { status: status || null },
    })
    return { ok: true, status: LS.JOB_STATUS.RUNNING, provider_status: status || 'unknown' }
  }

  try {
    const registros = await maps.snapshotRegistrosMaps(fonte.external_snapshot_id)
    const final = await db.salvarResultadosMaps(pool, { jobId: job.id, registros })
    return {
      ok: true,
      status: final?.status || LS.JOB_STATUS.COMPLETED,
      returned_count: Number(final?.returned_count || 0),
      raw_records: Array.isArray(registros) ? registros.length : 0,
    }
  } catch (err) {
    await db.marcarProviderFailed(pool, {
      jobId: job.id,
      errorType: err.code || 'snapshot_failed',
      errorMessage: erroMsg(err),
    })
    return { ok: false, motivo: 'snapshot_failed', erro: erroMsg(err) }
  }
}

async function processarJobsPendentes(pool, deps = {}) {
  const db = deps.db || dbPadrao
  const limit = Math.max(1, Math.min(10, deps.limit || LOTE_PADRAO))
  let processados = 0
  const resultados = []

  for (let i = 0; i < limit; i += 1) {
    const job = await db.claimProximoJobMaps(pool)
    if (!job) break
    const resultado = await processarJobMaps(pool, job.id, deps)
    resultados.push({ job_id: job.id, ...resultado })
    processados += 1
  }

  return { ok: true, processados, resultados }
}

function iniciarLeadSearchWorker(pool, deps = {}) {
  let rodando = false
  const tick = async () => {
    if (rodando) return
    rodando = true
    try {
      const r = await processarJobsPendentes(pool, deps)
      if (r.processados > 0) {
        logger.info({ operation: 'lead_search_worker', processados: r.processados }, 'lead search jobs processados')
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[lead-search] worker falhou; proximo tick tentara novamente')
    } finally {
      rodando = false
    }
  }

  const timer = setInterval(tick, INTERVALO_MS)
  if (timer.unref) timer.unref()
  setTimeout(tick, 5000).unref?.()
  return { parar: () => clearInterval(timer) }
}

module.exports = {
  ESTADOS_EM_ANDAMENTO,
  ESTADOS_FALHA,
  processarJobMaps,
  processarJobsPendentes,
  iniciarLeadSearchWorker,
}
