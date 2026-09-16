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
 * Consulta CRUA ao CSE, restrita a perfis do Instagram.
 *
 * Devolve `{handle, url, titulo, resumo}` — o título e o resumo existem porque quem precisa
 * PROVAR que um perfil pertence a um negócio (services/instagram-perfil.js) não consegue fazer
 * isso só com o username. Nunca lança: erro vira lista parcial e o chamador decide.
 *
 * Um único ponto de acesso ao CSE neste módulo, de propósito — duas chamadas com parâmetros
 * próprios divergiriam em idioma, região e paginação.
 */
async function consultarCseInstagram(consulta, limite = 20) {
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_ID
  const q = String(consulta || '').trim()
  if (!key || !cx || !q) return []
  const vistos = new Set()
  const out = []
  try {
    // CSE devolve no máx. 10 por página; pagina via `start` até atingir o limite.
    for (let start = 1; start <= 31 && out.length < limite; start += 10) {
      const r = await axios.get(GOOGLE_CSE_ENDPOINT, {
        params: { key, cx, q, num: 10, start, gl: 'br', hl: 'pt-BR', safe: 'active' },
        timeout: 8000,
      })
      const items = Array.isArray(r.data?.items) ? r.data.items : []
      if (items.length === 0) break
      for (const it of items) {
        const handle = usernameDeUrlInstagram(it?.link)
        if (!handle || vistos.has(handle)) continue
        vistos.add(handle)
        out.push({
          handle,
          url: String(it?.link || `https://www.instagram.com/${handle}/`),
          titulo: String(it?.title || ''),
          resumo: String(it?.snippet || ''),
        })
        if (out.length >= limite) break
      }
    }
    logger.info(`🔎 CSE Instagram "${q}": ${out.length} perfis`)
    return out
  } catch (e) {
    const status = e?.response?.status
    logger.warn(`⚠️ CSE Instagram falhou (status=${status}): ${e.message}`)
    return out
  }
}

/**
 * Busca o Instagram de UM negócio específico (nome + cidade).
 *
 * Diferente de `descobrirPerfisPorNicho`, que varre um mercado: aqui procura-se um dono
 * conhecido. Quem decide se algum resultado realmente é dele é `instagram-perfil.js` — esta
 * função não julga, só colhe.
 */
async function buscarPerfisDeNegocio(nome, cidade, limite = 8) {
  const negocio = String(nome || '').trim()
  if (!negocio) return []
  const cid = String(cidade || '').trim()
  return consultarCseInstagram(`${negocio} ${cid} site:instagram.com`.trim(), limite)
}

/**
 * Descobre usernames de perfis do Instagram por nicho (+cidade) via Google CSE.
 * Nunca lança — devolve [] em erro/indisponível. `limite` limita resultados.
 */
async function descobrirPerfisPorNicho(nicho, cidade, limite = 20) {
  const seg = String(nicho || '').trim()
  if (!seg) return []
  const cid = String(cidade || '').trim()
  const achados = await consultarCseInstagram(`${seg} ${cid} site:instagram.com`.trim(), limite)
  return achados.map((a) => a.handle)
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

module.exports = {
  cseConfigurado,
  consultarCseInstagram,
  buscarPerfisDeNegocio,
  descobrirPerfisPorNicho,
  usernameDeUrlInstagram,
  normalizarSeeds,
}
