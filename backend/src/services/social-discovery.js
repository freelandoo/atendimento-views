'use strict'
// Descoberta de PERFIS por nicho — fontes GRÁTIS, sem tocar/raspar o Instagram:
//   1) Google Custom Search (`site:instagram.com <nicho> <cidade>`) — mesma infra já
//      usada em agent.js (GOOGLE_CSE_KEY/GOOGLE_CSE_ID). Zero risco de ban.
//   2) Bola de neve via related_accounts (vem de graça em cada perfil raspado pela
//      Bright Data) — feita no motor (social-capture), não aqui.
// Aqui só normalizamos usernames de URLs do Instagram e consultamos o CSE.

const axios = require('axios')
const { logger } = require('../logger')

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'
// Caminhos do instagram.com que NÃO são perfil.
const NAO_PERFIL = new Set(['p', 'reel', 'reels', 'explore', 'tags', 'stories', 'tv', 'accounts', 'about', 'directory', 'developer', 'legal', 'privacy'])

function cseConfigurado() {
  return Boolean(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID)
}

/** Extrai o @username de uma URL do Instagram; null se não for perfil. */
function usernameDeUrlInstagram(url) {
  try {
    const u = new URL(String(url))
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null
    const seg = u.pathname.split('/').filter(Boolean)
    if (seg.length === 0) return null
    const handle = decodeURIComponent(seg[0]).replace(/^@/, '').toLowerCase().trim()
    if (!handle || NAO_PERFIL.has(handle)) return null
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null
    return handle
  } catch {
    return null
  }
}

/**
 * Descobre usernames de perfis do Instagram por nicho (+cidade) via Google CSE.
 * Nunca lança — devolve [] em erro/indisponível. `limite` limita resultados.
 */
async function descobrirPerfisPorNicho(nicho, cidade, limite = 20) {
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_ID
  if (!key || !cx) return []
  const seg = String(nicho || '').trim()
  if (!seg) return []
  const cid = String(cidade || '').trim()
  const q = `${seg} ${cid} site:instagram.com`.trim()
  const encontrados = new Set()
  try {
    // CSE devolve no máx. 10 por página; pagina via `start` até atingir o limite.
    for (let start = 1; start <= 31 && encontrados.size < limite; start += 10) {
      const r = await axios.get(GOOGLE_CSE_ENDPOINT, {
        params: { key, cx, q, num: 10, start, gl: 'br', hl: 'pt-BR', safe: 'active' },
        timeout: 8000,
      })
      const items = Array.isArray(r.data?.items) ? r.data.items : []
      if (items.length === 0) break
      for (const it of items) {
        const handle = usernameDeUrlInstagram(it?.link)
        if (handle) encontrados.add(handle)
        if (encontrados.size >= limite) break
      }
    }
    const out = Array.from(encontrados).slice(0, limite)
    logger.info(`🔎 CSE perfis "${q}": ${out.length} usernames`)
    return out
  } catch (e) {
    const status = e?.response?.status
    logger.warn(`⚠️ CSE descoberta perfis falhou (status=${status}): ${e.message}`)
    return Array.from(encontrados).slice(0, limite)
  }
}

/** Normaliza uma lista crua (usernames ou URLs) em handles únicos e válidos. */
function normalizarSeeds(lista) {
  const out = new Set()
  for (const item of Array.isArray(lista) ? lista : String(lista || '').split(/[\s,;\n]+/)) {
    const raw = String(item || '').trim()
    if (!raw) continue
    let handle = null
    if (/instagram\.com/i.test(raw)) handle = usernameDeUrlInstagram(raw.startsWith('http') ? raw : `https://${raw}`)
    else handle = raw.replace(/^@/, '').toLowerCase().trim()
    if (handle && /^[a-z0-9._]{1,30}$/.test(handle) && !NAO_PERFIL.has(handle)) out.add(handle)
  }
  return Array.from(out)
}

module.exports = { cseConfigurado, descobrirPerfisPorNicho, usernameDeUrlInstagram, normalizarSeeds }
