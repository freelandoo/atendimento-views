'use strict'
// Extração de CONTATO a partir de um perfil social (bio + link da bio).
// Saída: { email, telefone, link_bio, site, sinais } — telefone já normalizado p/ WhatsApp.
//
// Decisão: por padrão extraímos APENAS do texto/links que o scraper já trouxe (barato).
// Seguir o link da bio (fetch extra) é opcional e controlado por env
// BRIGHTDATA_SEGUIR_LINK_BIO=on (default off) para proteger orçamento e tempo.

const { normalizarNumeroProspeccao, telefoneEhCelular } = require('./prospecting-eligibility')

const RX_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// wa.me/55..., api.whatsapp.com/send?phone=55..., "whatsapp 55 11 9...", "(11) 91234-5678"
const RX_WA_LINK = /(?:wa\.me|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=)\/?\??(?:phone=)?\+?(\d[\d\s-]{8,})/i
const RX_WA_TEXTO = /\b(?:whats(?:app)?|wpp|zap|fone|tel|telefone|contato)\b[^\d+]{0,15}(\+?\d[\d\s().-]{8,})/i
const RX_TEL_SOLTO = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[\s.-]?\d{4}/

const EMAILS_DESCARTAR = /(no-?reply|noreply|example\.com|sentry\.io|wixpress|sentry-next|\.png|\.jpg)/i

function seguirLinkBioAtivo() {
  return String(process.env.BRIGHTDATA_SEGUIR_LINK_BIO || 'off').toLowerCase() === 'on'
}

function txt(v) {
  return String(v == null ? '' : v)
}

function primeiroEmailValido(texto) {
  const achados = txt(texto).match(RX_EMAIL) || []
  for (const e of achados) {
    const email = e.toLowerCase().trim()
    if (!EMAILS_DESCARTAR.test(email)) return email
  }
  return null
}

function primeiroWhatsapp(texto) {
  const t = txt(texto)
  let bruto = null
  const link = t.match(RX_WA_LINK)
  if (link) bruto = link[1]
  if (!bruto) {
    const marcado = t.match(RX_WA_TEXTO)
    if (marcado) bruto = marcado[1]
  }
  if (!bruto) {
    const solto = t.match(RX_TEL_SOLTO)
    if (solto) bruto = solto[0]
  }
  if (!bruto) return null
  const normalizado = normalizarNumeroProspeccao(bruto)
  // Só aceita se parecer um celular brasileiro com WhatsApp.
  return telefoneEhCelular(normalizado) ? normalizado : null
}

// Campos típicos de perfil que diferentes datasets podem usar para "bio" e "link da bio".
function colherBio(perfil = {}) {
  return (
    perfil.biography ||
    perfil.bio ||
    perfil.about ||
    perfil.description ||
    perfil.headline ||
    ''
  )
}

// external_url pode vir como string OU array (Instagram - Profiles devolve array).
function primeiroLink(v) {
  if (Array.isArray(v)) return v.find((x) => typeof x === 'string' && x.trim()) || ''
  return typeof v === 'string' ? v : ''
}

function colherLinkBio(perfil = {}) {
  return (
    primeiroLink(perfil.external_url) ||
    primeiroLink(perfil.bio_link) ||
    primeiroLink(perfil.website) ||
    primeiroLink(perfil.link_in_bio) ||
    primeiroLink(perfil.url_in_bio) ||
    ''
  )
}

function colherEmailDireto(perfil = {}) {
  // `email_address` é o campo real do dataset Instagram - Profiles da Bright Data.
  return (
    perfil.email_address || perfil.business_email || perfil.email ||
    perfil.public_email || perfil.contact_email || ''
  )
}

function colherTelefoneDireto(perfil = {}) {
  return perfil.business_phone_number || perfil.business_phone || perfil.phone || perfil.public_phone || ''
}

async function tentarSeguirLink(url, forcar = null) {
  const ligado = forcar == null ? seguirLinkBioAtivo() : Boolean(forcar)
  if (!ligado || !url) return ''
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Number(process.env.LINK_BIO_TIMEOUT_MS || 8000))
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return ''
    const html = await res.text()
    return html.slice(0, 200000) // teto de segurança
  } catch {
    return ''
  }
}

/**
 * Extrai contato de um perfil bruto do scraper.
 * @returns {Promise<{email, telefone, link_bio, bio, sinais: string[]}>}
 */
async function extrairContato(perfil = {}, opcoes = {}) {
  const forcarSeguirLink = opcoes.seguirLink != null ? opcoes.seguirLink : null
  const bio = txt(colherBio(perfil)).trim()
  const linkBio = txt(colherLinkBio(perfil)).trim() || null

  const sinais = []
  // 1) Campos diretos do scraper (quando o perfil é Business/Creator).
  let email = primeiroEmailValido(colherEmailDireto(perfil))
  if (email) sinais.push('email:campo_direto')
  let telefone = (() => {
    const direto = normalizarNumeroProspeccao(colherTelefoneDireto(perfil))
    return telefoneEhCelular(direto) ? direto : null
  })()
  if (telefone) sinais.push('whatsapp:campo_direto')

  // 2) Texto da bio (+ o próprio link, caso seja wa.me).
  const baseTexto = `${bio}\n${linkBio || ''}`
  if (!email) {
    email = primeiroEmailValido(baseTexto)
    if (email) sinais.push('email:bio')
  }
  if (!telefone) {
    telefone = primeiroWhatsapp(baseTexto)
    if (telefone) sinais.push('whatsapp:bio')
  }

  // 3) Opcional: seguir o link da bio atrás de email/WhatsApp.
  if ((!email || !telefone) && linkBio) {
    const html = await tentarSeguirLink(linkBio, forcarSeguirLink)
    if (html) {
      if (!email) {
        email = primeiroEmailValido(html)
        if (email) sinais.push('email:link_bio')
      }
      if (!telefone) {
        telefone = primeiroWhatsapp(html)
        if (telefone) sinais.push('whatsapp:link_bio')
      }
    }
  }

  return { email: email || null, telefone: telefone || null, link_bio: linkBio, bio: bio || null, sinais }
}

module.exports = {
  extrairContato,
  primeiroEmailValido,
  primeiroWhatsapp,
  seguirLinkBioAtivo,
}
