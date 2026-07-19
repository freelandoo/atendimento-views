'use strict'
// Fonte de dados da Aquisição via Bright Data (Google Maps "full information",
// Discover by location) — alternativa/assíncrona ao Google Places API.
//
// Estratégia de MENOR RISCO: este serviço NÃO reimplementa persistência nem score.
// Ele converte cada registro da Bright Data no MESMO shape que o Google Places devolve
// (adapter), e o caminho existente (`places.map(mapearPlace)` + `salvarProspects` em
// prospecting.js) segue idêntico — banco, dedup (place_id) e score não mudam.
//
// Fluxo (assíncrono, leva minutos): geocode(cidade) -> trigger(discover_by=location)
// -> [worker] progress/snapshot -> snapshotParaPlaces() -> mapearPlace -> salvarProspects.
const { trigger, progress, snapshot, brightDataConfigurado, datasetId } = require('./brightdata-client')
const { logger } = require('../logger')

const NOMINATIM_URL = process.env.GEOCODE_NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search'
const GEOCODE_TIMEOUT_MS = Math.max(2000, parseInt(process.env.GEOCODE_TIMEOUT_MS, 10) || 8000)
const ZOOM_LEVEL = Math.max(3, Math.min(20, parseInt(process.env.BRIGHTDATA_MAPS_ZOOM, 10) || 12))
const MAX_LEADS_POR_BUSCA = 200

// Cache simples de geocoding por cidade (evita repetir chamadas ao Nominatim).
const _geoCache = new Map()

function brightDataMapsConfigurado() {
  return brightDataConfigurado() && !!datasetId('maps_descoberta')
}

// "Cidade - UF" / "Cidade, UF" -> string de busca limpa para o geocoder.
function normalizarCidadeParaGeocode(cidade) {
  return String(cidade || '').replace(/\s*[-,]\s*/g, ', ').trim()
}

// Geocodifica a cidade -> { lat, long, country_code } via OpenStreetMap (grátis).
// País default Brasil, mas respeita o country_code que o Nominatim devolver.
async function geocodeCidade(cidade) {
  const chave = normalizarCidadeParaGeocode(cidade).toLowerCase()
  if (!chave) throw new Error('cidade vazia para geocoding')
  if (_geoCache.has(chave)) return _geoCache.get(chave)

  const url = `${NOMINATIM_URL}?format=json&limit=1&addressdetails=1&countrycodes=br&q=${encodeURIComponent(normalizarCidadeParaGeocode(cidade))}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'atendimento-views/1.0 (prospeccao)', 'Accept-Language': 'pt-BR' },
      signal: ctrl.signal,
    })
    if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`)
    const arr = await resp.json()
    const hit = Array.isArray(arr) ? arr[0] : null
    if (!hit || hit.lat == null || hit.lon == null) throw new Error(`sem coordenadas para "${cidade}"`)
    const geo = {
      lat: Number(hit.lat),
      long: Number(hit.lon),
      country_code: String(hit.address?.country_code || 'br').toUpperCase(),
    }
    _geoCache.set(chave, geo)
    return geo
  } finally {
    clearTimeout(timer)
  }
}

// Dispara a coleta (assíncrona). Retorna { snapshotId } para o worker acompanhar.
async function dispararBuscaMaps({ nicho, cidade }) {
  const keyword = String(nicho || '').trim()
  if (!keyword) throw new Error('nicho (keyword) obrigatório para a busca do Maps')
  if (!brightDataMapsConfigurado()) {
    const err = new Error('Bright Data Maps não configurado (token + BRIGHTDATA_DATASET_MAPS_DESCOBERTA).')
    err.code = 'MAPS_OFF'
    throw err
  }
  const geo = await geocodeCidade(cidade)
  const input = {
    country: geo.country_code,
    lat: geo.lat,
    long: geo.long,
    zoom_level: ZOOM_LEVEL,
    keyword,
  }
  const { snapshotId } = await trigger('maps_descoberta', input, { discoverBy: 'location' })
  logger.info({ operation: 'places_brightdata', etapa: 'trigger', nicho: keyword, cidade, snapshotId }, 'busca Maps disparada')
  return { snapshotId, geo }
}

// Estado do job: 'running' | 'ready' | 'failed' | ...
async function estadoBuscaMaps(snapshotId) {
  const { status } = await progress(snapshotId)
  return status
}

// Converte 1 registro da Bright Data no shape do Google Places (para reusar mapearPlace).
function adaptarRegistroParaPlace(r) {
  if (!r || typeof r !== 'object') return null
  const site = typeof r.open_website === 'string' ? r.open_website.trim() : ''
  const businessStatus = r.permanently_closed
    ? 'CLOSED_PERMANENTLY'
    : (r.temporarily_closed ? 'CLOSED_TEMPORARILY' : 'OPERATIONAL')
  return {
    // id: place_id no formato Google (ChIJ...) — dedup compatível com o Places oficial.
    id: String(r.place_id || r.cid || '').trim(),
    displayName: { text: String(r.name || '').trim() },
    formattedAddress: String(r.address || '').trim(),
    internationalPhoneNumber: String(r.phone_number || '').trim(),
    nationalPhoneNumber: '',
    websiteUri: site,
    googleMapsUri: String(r.url || '').trim(),
    rating: r.rating == null ? null : Number(r.rating),
    userRatingCount: r.reviews_count == null ? null : Number(r.reviews_count),
    businessStatus,
    primaryTypeDisplayName: { text: String(r.category || '').trim() },
    types: Array.isArray(r.all_categories) ? r.all_categories : [],
    // Campos usados pelo score de cadastro (lead-score-cadastro):
    photos: Array.isArray(r.photos_and_videos) ? r.photos_and_videos : [],
    regularOpeningHours: r.open_hours && typeof r.open_hours === 'object' ? r.open_hours : null,
  }
}

function adaptarRegistrosParaPlaces(registros) {
  const places = []
  for (const r of registros || []) {
    const p = adaptarRegistroParaPlace(r)
    if (p && p.id && p.displayName.text) places.push(p)
    if (places.length >= MAX_LEADS_POR_BUSCA) break
  }
  return places
}

// Baixa o snapshot e preserva a contagem bruta para auditoria de custo, mesmo que somente
// os primeiros 200 registros válidos sigam para o Banco de Leads.
async function snapshotParaPlacesComResumo(snapshotId) {
  const registros = await snapshot(snapshotId, { format: 'json' })
  return {
    places: adaptarRegistrosParaPlaces(registros),
    recebidos: Array.isArray(registros) ? registros.length : 0,
  }
}

async function snapshotParaPlaces(snapshotId) {
  const { places } = await snapshotParaPlacesComResumo(snapshotId)
  return places
}

module.exports = {
  MAX_LEADS_POR_BUSCA,
  brightDataMapsConfigurado,
  normalizarCidadeParaGeocode,
  geocodeCidade,
  dispararBuscaMaps,
  estadoBuscaMaps,
  adaptarRegistroParaPlace,
  adaptarRegistrosParaPlaces,
  snapshotParaPlacesComResumo,
  snapshotParaPlaces,
}
