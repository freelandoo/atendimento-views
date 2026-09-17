'use strict'
// Descoberta de PERFIS por nicho/lead sem raspar o Instagram diretamente:
//   1) Bright Data SERP API (`site:instagram.com <nicho|nome> <cidade>`), usando a zona SERP
//      da conta. Nao usa GOOGLE_CSE_KEY/GOOGLE_CSE_ID.
//   2) Bola de neve via related_accounts (vem em cada perfil raspado pela Bright Data) — feita
//      no motor (social-capture), nao aqui.
// Aqui so normalizamos usernames de URLs do Instagram e consultamos a SERP da Bright Data.

const axios = require('axios')
const { logger } = require('../logger')

const BRIGHTDATA_SERP_ENDPOINT = 'https://api.brightdata.com/request'
// Caminhos do instagram.com que NÃO são perfil.
const NAO_PERFIL = new Set(['p', 'reel', 'reels', 'explore', 'tags', 'stories', 'tv', 'accounts', 'about', 'directory', 'developer', 'legal', 'privacy'])

function brightDataSerpConfigurado() {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN && process.env.BRIGHTDATA_SERP_ZONE)
}

// Alias legado: chamadores antigos perguntavam "CSE configurado?". Para o fluxo de Instagram,
// a resposta agora significa "SERP da Bright Data configurada".
function cseConfigurado() {
  return brightDataSerpConfigurado()
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

function montarUrlBuscaGoogle(consulta) {
  const q = String(consulta || '').trim()
  const params = new URLSearchParams({ q, hl: 'pt-BR', gl: 'br' })
  return `https://www.google.com/search?${params.toString()}`
}

function jsonSerp(data) {
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return {} }
  }
  return data && typeof data === 'object' ? data : {}
}

function resultadosOrganicos(data) {
  const d = jsonSerp(data)
  if (Array.isArray(d.organic)) return d.organic
  if (Array.isArray(d.results)) return d.results
  if (Array.isArray(d.body?.organic)) return d.body.organic
  return []
}

function textoCampo(valor) {
  return String(valor == null ? '' : valor)
}

/**
 * Consulta CRUA a Bright Data SERP, restrita a perfis do Instagram.
 *
 * Devolve `{handle, url, titulo, resumo}` — o título e o resumo existem porque quem precisa
 * PROVAR que um perfil pertence a um negócio (services/instagram-perfil.js) não consegue fazer
 * isso só com o username.
 *
 * Nunca lança, e por isso devolve `{ok, resultados, consultas, erro, statusCode}` em vez de uma
 * lista: quem chama precisa distinguir "a busca respondeu e não achou nada" de "a busca nem
 * aconteceu". `consultas` é quantas chamadas SERP foram efetivamente tentadas.
 *
 * Um único ponto de acesso a SERP neste módulo, de propósito — duas chamadas com parâmetros
 * próprios divergiriam em idioma, região e paginação.
 */
async function consultarSerpInstagramDetalhado(consulta, { limite = 20 } = {}) {
  const token = String(process.env.BRIGHTDATA_API_TOKEN || '').trim()
  const zone = String(process.env.BRIGHTDATA_SERP_ZONE || '').trim()
  const q = String(consulta || '').trim()
  if (!token || !zone) {
    return { ok: false, resultados: [], consultas: 0, erro: 'serp_nao_configurada', statusCode: 0 }
  }
  if (!q) return { ok: true, resultados: [], consultas: 0, erro: null, statusCode: 0 }
  const vistos = new Set()
  const out = []
  const consultas = 1
  try {
    const r = await axios.post(BRIGHTDATA_SERP_ENDPOINT, {
      zone,
      url: montarUrlBuscaGoogle(q),
      format: 'raw',
      data_format: 'parsed_light',
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: Number(process.env.BRIGHTDATA_SERP_TIMEOUT_MS || 60000),
    })
    const items = resultadosOrganicos(r.data)
    for (const it of items) {
      const link = textoCampo(it?.link || it?.url)
      const handle = usernameDeUrlInstagram(link)
      if (!handle || vistos.has(handle)) continue
      vistos.add(handle)
      out.push({
        handle,
        url: link || `https://www.instagram.com/${handle}/`,
        titulo: textoCampo(it?.title || it?.name),
        resumo: textoCampo(it?.description || it?.snippet || it?.text),
      })
      if (out.length >= limite) break
    }
    logger.info({ operation: 'instagram_discovery', fonte: 'brightdata_serp',
      resultados: out.length }, 'Bright Data SERP Instagram consultada')
    return { ok: true, resultados: out, consultas, erro: null, statusCode: 200 }
  } catch (e) {
    const status = Number(e?.response?.status || 0)
    const motivo = String(e?.response?.data?.error || e?.response?.data?.message || e?.code || '')
    logger.warn({ operation: 'instagram_discovery', fonte: 'brightdata_serp',
      status, motivo: motivo || null, erro: e.message }, 'Bright Data SERP Instagram falhou')
    return { ok: false, resultados: out, consultas, erro: motivo || 'erro_serp', statusCode: status }
  }
}

// Alias legado: mantem compatibilidade com testes/chamadores antigos. Nao consulta Google CSE.
async function consultarCseInstagramDetalhado(consulta, opcoes = {}) {
  return consultarSerpInstagramDetalhado(consulta, opcoes)
}

/**
 * Contrato ANTIGO, preservado: devolve só a lista e nunca lança.
 *
 * Existe para os chamadores que varrem um mercado (`descobrirPerfisPorNicho`), onde "achei
 * menos" e "falhou" têm a mesma consequência prática — a varredura continua. Quem precisa
 * DECIDIR sobre um lead nunca deve usar esta função: para ele, confundir "não achei" com "não
 * perguntei" vira um veredito falso gravado no banco (ver `consultarSerpInstagramDetalhado`).
 */
async function consultarSerpInstagram(consulta, limite = 20) {
  const r = await consultarSerpInstagramDetalhado(consulta, { limite })
  return r.resultados
}

async function consultarCseInstagram(consulta, limite = 20) {
  return consultarSerpInstagram(consulta, limite)
}

/**
 * Busca o Instagram de UM negócio específico (nome + cidade).
 *
 * Diferente de `descobrirPerfisPorNicho`, que varre um mercado: aqui procura-se um dono
 * conhecido. Quem decide se algum resultado realmente é dele é `instagram-perfil.js` — esta
 * função não julga, só colhe.
 *
 * Devolve o resultado DETALHADO (`{ok, resultados, consultas, erro}`), e não uma lista solta, de
 * propósito: quem procura o perfil de UM lead vai gravar um veredito sobre ele, e uma lista
 * vazia não diz se a busca não achou nada ou se nem chegou a acontecer.
 *
 * UMA SERP, sempre: o custo tem de ser previsível em 1 consulta por lead, porque é sobre ele
 * que o teto diário da descoberta é calculado.
 */
async function buscarPerfisDeNegocio(nome, cidade, limite = 8) {
  const negocio = String(nome || '').trim()
  if (!negocio) return { ok: true, resultados: [], consultas: 0, erro: null, statusCode: 0 }
  const cid = String(cidade || '').trim()
  return consultarSerpInstagramDetalhado(`${negocio} ${cid} site:instagram.com`.trim(),
    { limite })
}

/**
 * Descobre usernames de perfis do Instagram por nicho (+cidade) via Bright Data SERP.
 * Nunca lança — devolve [] em erro/indisponível. `limite` limita resultados.
 */
async function descobrirPerfisPorNicho(nicho, cidade, limite = 20) {
  const seg = String(nicho || '').trim()
  if (!seg) return []
  const cid = String(cidade || '').trim()
  const achados = await consultarSerpInstagram(`${seg} ${cid} site:instagram.com`.trim(), limite)
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
  brightDataSerpConfigurado,
  cseConfigurado,
  consultarSerpInstagram,
  consultarSerpInstagramDetalhado,
  consultarCseInstagram,
  consultarCseInstagramDetalhado,
  buscarPerfisDeNegocio,
  descobrirPerfisPorNicho,
  usernameDeUrlInstagram,
  normalizarSeeds,
  BRIGHTDATA_SERP_ENDPOINT,
}
