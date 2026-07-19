'use strict'
// Cliente da Bright Data — Web Scraper / Dataset API v3.
// API UNIFICADA: o mesmo endpoint/token serve para Instagram E LinkedIn; muda só o
// `dataset_id`. Fluxo assíncrono: trigger -> snapshot_id -> progress -> snapshot(json).
//
// Segredos só por env (nunca no código):
//   BRIGHTDATA_API_TOKEN          (obrigatório p/ a captação funcionar)
//   BRIGHTDATA_DATASET_IG_DESCOBERTA  dataset que descobre posts/perfis por hashtag
//   BRIGHTDATA_DATASET_IG_PERFIS      dataset de perfis do Instagram (input por URL)
//   BRIGHTDATA_DATASET_LI_PERFIS      dataset de perfis do LinkedIn (input por URL)
//   BRIGHTDATA_DATASET_LI_DESCOBERTA  (opcional) descoberta LinkedIn por palavra-chave
//
// Os dataset_id e o formato exato de input devem ser confirmados no painel Bright Data
// da conta (cada dataset lista seus campos e o "discover by"). O motor abaixo é agnóstico
// a esses ids — eles entram por env.

const { logger } = require('../logger')

const BASE = 'https://api.brightdata.com/datasets/v3'

function token() {
  return String(process.env.BRIGHTDATA_API_TOKEN || '').trim()
}

function datasetId(chave) {
  const map = {
    ig_descoberta: process.env.BRIGHTDATA_DATASET_IG_DESCOBERTA,
    ig_perfis: process.env.BRIGHTDATA_DATASET_IG_PERFIS,
    li_descoberta: process.env.BRIGHTDATA_DATASET_LI_DESCOBERTA,
    li_perfis: process.env.BRIGHTDATA_DATASET_LI_PERFIS,
    // Google Maps "full information" — Discover by location (nicho+coordenadas).
    maps_descoberta: process.env.BRIGHTDATA_DATASET_MAPS_DESCOBERTA,
  }
  return String(map[chave] || '').trim()
}

function brightDataConfigurado() {
  return Boolean(token())
}

async function brightFetch(url, options = {}) {
  const tk = token()
  if (!tk) {
    const err = new Error('BRIGHTDATA_API_TOKEN ausente — canal de captação desativado.')
    err.code = 'BRIGHTDATA_OFF'
    throw err
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.BRIGHTDATA_TIMEOUT_MS || 60000))
  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${tk}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const texto = await res.text()
  let json = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || texto || `HTTP ${res.status}`
    const err = new Error(`Bright Data ${res.status}: ${String(msg).slice(0, 300)}`)
    err.statusCode = res.status
    throw err
  }
  return json
}

/**
 * Dispara uma coleta. `discoverBy` ativa o modo de descoberta (ex.: por hashtag);
 * sem ele, é coleta direta por URL (input com {url}).
 * input: array de objetos (formato depende do dataset — ver painel Bright Data).
 * Retorna { snapshot_id }.
 */
async function trigger(datasetKey, input, { discoverBy = null } = {}) {
  const ds = datasetId(datasetKey)
  if (!ds) {
    const err = new Error(`dataset_id não configurado para "${datasetKey}" (defina a env correspondente).`)
    err.code = 'DATASET_OFF'
    throw err
  }
  const params = new URLSearchParams({ dataset_id: ds, include_errors: 'true' })
  if (discoverBy) {
    params.set('type', 'discover_new')
    params.set('discover_by', discoverBy)
  }
  const body = JSON.stringify(Array.isArray(input) ? input : [input])
  const json = await brightFetch(`${BASE}/trigger?${params.toString()}`, { method: 'POST', body })
  const snapshotId = json && (json.snapshot_id || json.snapshotId || json.id)
  if (!snapshotId) throw new Error('Bright Data: trigger sem snapshot_id na resposta.')
  logger.info({ datasetKey, snapshotId, discoverBy: discoverBy || null }, '[brightdata] trigger ok')
  return { snapshotId: String(snapshotId) }
}

/** Estado do snapshot: 'running' | 'ready' | 'failed' | ... */
async function progress(snapshotId) {
  const json = await brightFetch(`${BASE}/progress/${encodeURIComponent(snapshotId)}`, { method: 'GET' })
  return {
    status: String((json && json.status) || 'unknown').toLowerCase(),
    raw: json || {},
  }
}

/** Baixa os registros (array de objetos) de um snapshot pronto. */
async function snapshot(snapshotId, { format = 'json' } = {}) {
  const json = await brightFetch(
    `${BASE}/snapshot/${encodeURIComponent(snapshotId)}?format=${encodeURIComponent(format)}`,
    { method: 'GET' }
  )
  if (Array.isArray(json)) return json
  if (json && Array.isArray(json.data)) return json.data
  if (json && Array.isArray(json.results)) return json.results
  return []
}

module.exports = {
  brightDataConfigurado,
  datasetId,
  trigger,
  progress,
  snapshot,
}
