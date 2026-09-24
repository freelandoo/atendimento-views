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
const { normalizarPais, paisParaNominatim } = require('./paises')

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

// Geocodifica a cidade -> { lat, long, country_code } via OpenStreetMap (gratis).
// Pais default Brasil, mas o caller pode recortar por outro ISO-2.
async function geocodeCidade(cidade, pais = 'BR') {
  const paisNormalizado = normalizarPais(pais)
  const cidadeNormalizada = normalizarCidadeParaGeocode(cidade)
  if (!cidadeNormalizada) throw new Error('cidade vazia para geocoding')
  const chave = `${paisNormalizado}:${cidadeNormalizada.toLowerCase()}`
  if (_geoCache.has(chave)) return _geoCache.get(chave)

  const url = `${NOMINATIM_URL}?format=json&limit=1&addressdetails=1&countrycodes=${encodeURIComponent(paisParaNominatim(paisNormalizado))}&q=${encodeURIComponent(cidadeNormalizada)}`
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
      country_code: String(hit.address?.country_code || paisNormalizado).toUpperCase(),
    }
    _geoCache.set(chave, geo)
    return geo
  } finally {
    clearTimeout(timer)
  }
}

// Dispara a coleta (assíncrona). Retorna { snapshotId } para o worker acompanhar.
async function dispararBuscaMaps({ nicho, cidade, pais = 'BR' }) {
  const keyword = String(nicho || '').trim()
  if (!keyword) throw new Error('nicho (keyword) obrigatório para a busca do Maps')
  if (!brightDataMapsConfigurado()) {
    const err = new Error('Bright Data Maps não configurado (token + BRIGHTDATA_DATASET_MAPS_DESCOBERTA).')
    err.code = 'MAPS_OFF'
    throw err
  }
  const paisNormalizado = normalizarPais(pais)
  const geo = await geocodeCidade(cidade, paisNormalizado)
  const input = {
    country: geo.country_code,
    lat: geo.lat,
    long: geo.long,
    zoom_level: ZOOM_LEVEL,
    keyword,
  }
  const { snapshotId } = await trigger('maps_descoberta', input, { discoverBy: 'location' })
  logger.info({ operation: 'places_brightdata', etapa: 'trigger', nicho: keyword, cidade, pais: paisNormalizado, snapshotId }, 'busca Maps disparada')
  return { snapshotId, geo }
}

// Estado do job: 'running' | 'ready' | 'failed' | ...
async function estadoBuscaMaps(snapshotId) {
  const { status } = await progress(snapshotId)
  return status
}

// A chave vem do classificador de atividade: ele e' o dono do vocabulario e o unico
// consumidor do registro bruto. Duplicar o literal aqui deixaria os dois divergirem.
const { CHAVE_FONTE_BRUTA } = require('./google-business-activity')

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
    permanently_closed: r.permanently_closed === true,
    temporarily_closed: r.temporarily_closed === true,
    regularOpeningHours: r.open_hours && typeof r.open_hours === 'object' ? r.open_hours : null,
    // O registro CRU da fonte, preservado INTEIRO e sem interpretacao.
    //
    // Antes daqui saia `latestReviewDate: r.latest_review_date || r.last_review_date ||
    // r.reviews_last_updated || r.last_review_at`. Quatro grafias para o mesmo campo e' o
    // formato de um chute, e o custo do chute errado e' alto: a coleta e' PAGA, o campo nao
    // mapeado era descartado na hora, e descobrir o nome real exigia pagar tudo de novo.
    // Medido em 2026-09-16: dos 4.631 leads em producao, ZERO tinham data de atividade — e o
    // snapshot que os originou ja havia expirado na Bright Data, entao nao havia como conferir.
    //
    // Guardar o bruto troca "adivinhar antes" por "descobrir depois, de graca". Quem sabe o
    // que e' data de atividade e' o classificador (services/google-business-activity.js), que
    // le esta chave; o adaptador nao decide mais isso.
    [CHAVE_FONTE_BRUTA]: r,
  }
}

// `limite` = quantidade pedida na execução (1..200). Nunca ultrapassa o teto da fonte.
function adaptarRegistrosParaPlaces(registros, limite = MAX_LEADS_POR_BUSCA) {
  const teto = Math.max(1, Math.min(MAX_LEADS_POR_BUSCA, Number.parseInt(limite, 10) || MAX_LEADS_POR_BUSCA))
  const places = []
  for (const r of registros || []) {
    const p = adaptarRegistroParaPlace(r)
    if (p && p.id && p.displayName.text) places.push(p)
    if (places.length >= teto) break
  }
  return places
}

// Baixa o snapshot e preserva a contagem bruta para auditoria de custo, mesmo que somente
// os primeiros `limite` registros válidos sigam para o Banco de Leads.
async function snapshotParaPlacesComResumo(snapshotId, limite = MAX_LEADS_POR_BUSCA) {
  const registros = await snapshot(snapshotId, { format: 'json' })
  return {
    places: adaptarRegistrosParaPlaces(registros, limite),
    recebidos: Array.isArray(registros) ? registros.length : 0,
  }
}

async function snapshotRegistrosMaps(snapshotId) {
  const registros = await snapshot(snapshotId, { format: 'json' })
  return Array.isArray(registros) ? registros : []
}

async function snapshotParaPlaces(snapshotId, limite = MAX_LEADS_POR_BUSCA) {
  const { places } = await snapshotParaPlacesComResumo(snapshotId, limite)
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
  snapshotRegistrosMaps,
  snapshotParaPlaces,
}
