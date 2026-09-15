'use strict'
// Acessos rapidos de um lead — os links que valem um clique direto de dentro do modal de
// conversa do Banco de Leads (rede social, site proprio e ficha no Google Maps).
//
// PURO e testavel (node:test), mesma convencao de site-rotulos.js / lead-operacao.js: a tela
// so DESENHA o que este modulo devolve.
//
// LIMITE QUE NAO SE NEGOCIA: este arquivo NAO classifica site. Quem decide se um link e' site
// proprio e' o backend (`backend/src/services/site-classificacao.js`), e o veredito chega
// pronto em `tem_site`, `site`, `link_original` e `classificacao_url`. O botao "Site" so nasce
// quando o backend disse `tem_site` E mandou `site` preenchido. A deteccao de marca aqui
// embaixo escolhe apenas a PALAVRA do botao ("Instagram"/"Facebook") de um link que o backend
// ja classificou como nao-site — foi a equivalencia `site || tem_site` espalhada pelas telas
// que fez o sistema inteiro chamar Instagram de site, e ela nao volta por aqui.

const { rotuloLink } = require('./site-rotulos')

/** Tipos possiveis de acesso — lista FECHADA. */
const TIPO_ACESSO = Object.freeze({
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  SITE: 'site',
  MAPS: 'maps',
  LINK: 'link',
})

/**
 * Normaliza a URL para EXIBICAO/NAVEGACAO e recusa o que nao for navegavel.
 * So http(s) sai daqui: `javascript:`/`data:` guardados no cadastro nunca viram href.
 */
function normalizarLink(bruta) {
  const texto = bruta == null ? '' : String(bruta).trim()
  if (!texto) return null
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`
  let u
  try { u = new URL(comEsquema) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return { href: u.href, host: u.hostname.toLowerCase().replace(/^www\./, '') }
}

/** A marca da rede social, quando da para reconhecer. So ROTULO — nunca decide "e' site". */
function marcaDoLink(bruta) {
  const info = normalizarLink(bruta)
  if (!info) return null
  const h = info.host
  if (h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'instagr.am') return TIPO_ACESSO.INSTAGRAM
  if (h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h === 'fb.me' || h === 'fb.watch') return TIPO_ACESSO.FACEBOOK
  return null
}

const ROTULO_MARCA = Object.freeze({
  [TIPO_ACESSO.INSTAGRAM]: 'Instagram',
  [TIPO_ACESSO.FACEBOOK]: 'Facebook',
})

/** Rotulo curto de um link que NAO e' site proprio, quando a marca nao foi reconhecida. */
function rotuloGenerico(classificacaoUrl) {
  const r = rotuloLink(classificacaoUrl)
  if (!r || r === 'site') return 'Link'
  return r.charAt(0).toUpperCase() + r.slice(1)
}

function acesso(tipo, rotulo, href, dica) {
  return { tipo, rotulo, href, dica }
}

/**
 * Monta a lista FECHADA de acessos rapidos do lead, na ordem em que a tela deve exibi-los.
 * Sem link nenhum, devolve `[]` — a area simplesmente nao aparece (nao ha estado vazio a
 * desenhar num cabecalho).
 */
function acessosDoLead(lead) {
  const l = lead || {}
  const lista = []
  const vistos = new Set()

  const push = (tipo, rotulo, bruta, dica) => {
    const info = normalizarLink(bruta)
    if (!info || vistos.has(info.href)) return
    vistos.add(info.href)
    lista.push(acesso(tipo, rotulo, info.href, dica))
  }

  const handle = String(l.instagram_handle || '').trim().replace(/^@/, '')
  if (handle) push(TIPO_ACESSO.INSTAGRAM, 'Instagram', `https://instagram.com/${handle}`, `Abrir o perfil @${handle} no Instagram`)

  // Link cru do cadastro que o backend NAO classificou como site proprio.
  if (l.link_original && l.classificacao_url !== 'site_proprio') {
    const marca = marcaDoLink(l.link_original)
    const rotulo = marca ? ROTULO_MARCA[marca] : rotuloGenerico(l.classificacao_url)
    push(marca || TIPO_ACESSO.LINK, rotulo, l.link_original,
      marca ? `Abrir o perfil no ${rotulo}` : `Abrir o link do cadastro (${rotulo.toLowerCase()}) — nao e' site proprio`)
  }

  if (l.link_bio) {
    const marca = marcaDoLink(l.link_bio)
    push(marca || TIPO_ACESSO.LINK, marca ? ROTULO_MARCA[marca] : 'Link da bio', l.link_bio, 'Abrir o link da bio')
  }

  // Site: SO com o veredito do backend. `tem_site` sozinho nao basta — link duvidoso chega
  // como `tem_site: true` com `site` vazio, e ali nao ha site para abrir.
  if (l.tem_site && l.site) push(TIPO_ACESSO.SITE, 'Site', l.site, 'Abrir o site proprio do negocio')

  if (l.maps_url) push(TIPO_ACESSO.MAPS, 'Maps', l.maps_url, 'Ver a ficha no Google Maps')

  return lista
}

module.exports = { TIPO_ACESSO, ROTULO_MARCA, normalizarLink, marcaDoLink, rotuloGenerico, acessosDoLead }
