'use strict'
// CLASSIFICADOR CANONICO DE URL — "isto e' um site proprio ou so um link?"
//
// Fonte de verdade UNICA do projeto para a pergunta "este lead tem site proprio?".
// Modulo PURO: sem banco, sem HTTP, sem IA, sem rede. Nunca faz requisicao para
// descobrir o que ha' no outro lado do link — classifica pelo DOMINIO.
//
// Por que existe: ate' aqui, sete pontos diferentes do codigo faziam a equivalencia
// ingenua `site preenchido => tem site`. O resultado era um lead cujo unico link e' o
// Instagram (ou o Linktree da bio) contando como "ja tem site" — justamente o lead mais
// qualificado de uma campanha de CRIACAO de site, sumindo do filtro "Sem site" e perdendo
// o bonus de prioridade na fila de ligacoes.
//
// Regra de negocio (fixada com o operador):
//   tem_site = true  SOMENTE quando ha' site proprio em DOMINIO INDEPENDENTE.
//   Rede social, agregador de links, mapa, marketplace, diretorio e perfil => tem_site FALSE.
//   Link que nao da' para julgar com seguranca => 'desconhecido' (revisar), NUNCA promovido
//   a site proprio.
//
// Contrato de dados (colunas de prospectador.prospects):
//   site             -> so' preenchido quando a classificacao e' 'site_proprio'
//   link_original    -> o valor CRU recebido, sempre preservado (auditoria/rastreabilidade)
//   classificacao_url-> a categoria abaixo
//   tem_site         -> booleano derivado (cache; a autoridade e' esta funcao, na leitura)

const CLASSIFICACOES = Object.freeze([
  'site_proprio',
  'rede_social',
  'agregador',
  'perfil_ou_diretorio',
  'desconhecido',
  'sem_link',
])

// Rotulos de UI. A tela de atendimento do lead precisa dizer o que e' o link, nao esconder.
const CLASSIFICACAO_LABEL = Object.freeze({
  site_proprio: 'Site proprio',
  rede_social: 'Rede social',
  agregador: 'Agregador de links',
  perfil_ou_diretorio: 'Perfil / diretorio',
  desconhecido: 'Link a verificar',
  sem_link: 'Sem link',
})

// Situacao consolidada do lead (o que a fila de ligacoes e a tela de atendimento exibem).
const SITUACAO_LABEL = Object.freeze({
  tem_site: 'Tem site proprio',
  sem_site: 'Sem site proprio',
  nao_identificado: 'Verificar link',
})

// ── Dominios conhecidos ────────────────────────────────────────────────────────────────
// A chave e' o dominio (sem `www.`). A busca casa o host EXATO e qualquer subdominio dele,
// do mais especifico para o menos especifico — por isso `maps.app.goo.gl` (mapa) e
// `sites.google.com` (construtor) vencem `goo.gl` e `google.com`.

const REDE_SOCIAL = [
  'instagram.com', 'instagr.am', 'ig.me',
  'facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'messenger.com', 'm.me',
  'tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 't.co',
  'linkedin.com', 'lnkd.in',
  'whatsapp.com', 'wa.me', 'wa.link', 'whts.app',
  'telegram.me', 'telegram.org', 't.me',
  'pinterest.com', 'pinterest.com.br', 'pin.it',
  'snapchat.com', 'threads.net', 'threads.com',
  'kwai.com', 'twitch.tv', 'discord.com', 'discord.gg',
  'reddit.com', 'tumblr.com', 'vk.com', 'flickr.com',
  'soundcloud.com', 'vimeo.com', 'spotify.com',
]

const AGREGADOR = [
  'linktr.ee', 'linktree.com',
  'beacons.ai', 'beacons.page',
  'bio.link', 'biolink.info', 'linkin.bio', 'lnk.bio', 'link.bio',
  'taplink.cc', 'taplink.ru', 'taplink.at',
  'campsite.bio', 'solo.to', 'allmylinks.com', 'about.me',
  'milkshake.app', 'msha.ke', 'koji.to', 'hoo.be', 'direct.me',
  'linkpop.com', 'shorby.com', 'znap.link', 'flowcode.com', 'flowpage.com',
  'many.link', 'contactinbio.com', 'linkme.bio', 'zaap.bio',
]

const PERFIL_OU_DIRETORIO = [
  // Google (mapa / ficha / pagina gerada pelo Perfil da Empresa)
  'google.com', 'google.com.br', 'maps.google.com', 'maps.app.goo.gl', 'g.page',
  'business.google.com', 'business.site', 'negocio.site',
  // Marketplaces
  'mercadolivre.com.br', 'mercadolibre.com', 'olx.com.br', 'elo7.com.br',
  'shopee.com.br', 'amazon.com.br', 'americanas.com.br', 'magazineluiza.com.br',
  'enjoei.com.br', 'shein.com', 'aliexpress.com',
  // Delivery / cardapio hospedado
  'ifood.com.br', 'rappi.com.br', 'ubereats.com', 'aiqfome.com',
  'goomer.app', 'goomer.com.br', 'cardapioweb.com', 'anota.ai', 'delivery.much.com.br',
  // Reserva / avaliacao / turismo
  'booking.com', 'airbnb.com', 'airbnb.com.br', 'tripadvisor.com', 'tripadvisor.com.br',
  'yelp.com', 'foursquare.com', 'reclameaqui.com.br',
  // Agendamento / saude / servicos
  'doctoralia.com.br', 'boaconsulta.com', 'zocdoc.com',
  'booksy.com', 'trinks.com', 'belezanaweb.com.br', 'getninjas.com.br', 'gethelp.com.br',
  'sympla.com.br', 'eventbrite.com', 'eventbrite.com.br',
  // Listas / diretorios
  'apontador.com.br', 'telelistas.net', 'guiamais.com.br', 'solutudo.com.br',
  'hotfrog.com.br', 'cylex.com.br', 'encontra-portugal.com', 'kekanto.com.br',
  'paginasamarelas.com.br', 'guiafacil.com',
]

// Construtores/hospedagens em SUBDOMINIO COMPARTILHADO. Nao e' dominio independente, mas
// tambem nao e' rede social: pode ser uma pagina real do negocio. Vai para 'desconhecido'
// (revisar) — a regra manda nao assumir site proprio sem seguranca.
const CONSTRUTOR_COMPARTILHADO = [
  'wixsite.com', 'wix.com', 'editorx.io',
  'blogspot.com', 'blogspot.com.br', 'wordpress.com',
  'weebly.com', 'jimdosite.com', 'jimdo.com', 'webnode.page', 'webnode.com.br',
  'mystrikingly.com', 'strikingly.com', 'square.site', 'myshopify.com',
  'godaddysites.com', 'sites.google.com', 'carrd.co',
  'github.io', 'netlify.app', 'vercel.app', 'pages.dev', 'web.app', 'firebaseapp.com',
  'notion.site', 'super.site', 'canva.site', 'framer.website', 'webflow.io',
  'lojaintegrada.com.br', 'catalogo.nuvemshop.com.br',
]

// Encurtadores: escondem o destino. Nunca da' para afirmar nada => 'desconhecido'.
const ENCURTADOR = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 'cutt.ly', 'is.gd', 'ow.ly', 'rebrand.ly',
  'encurtador.com.br', 'shorturl.at', 'l1nk.dev', 'linkr.ee', 'urlz.fr', 'rb.gy',
]

function montarIndice() {
  const idx = new Map()
  const add = (lista, categoria, motivo) => {
    for (const dominio of lista) idx.set(dominio, { categoria, motivo })
  }
  add(REDE_SOCIAL, 'rede_social', 'perfil de rede social, nao e site proprio')
  add(AGREGADOR, 'agregador', 'agregador de links, nao e site proprio')
  add(PERFIL_OU_DIRETORIO, 'perfil_ou_diretorio', 'perfil em mapa, marketplace ou diretorio')
  add(CONSTRUTOR_COMPARTILHADO, 'desconhecido', 'pagina em dominio compartilhado de construtor: revisar')
  add(ENCURTADOR, 'desconhecido', 'link encurtado esconde o destino: revisar')
  return idx
}

const INDICE_DOMINIOS = montarIndice()

// ── Normalizacao ───────────────────────────────────────────────────────────────────────

function textoCru(valor) {
  if (valor == null) return ''
  return String(valor).trim().replace(/^["'<(]+|["'>)]+$/g, '').trim()
}

/**
 * Normaliza a URL antes de classificar. Aceita "instagram.com/loja" (sem esquema), corrige
 * espacos e devolve o host limpo. Devolve `null` quando nao ha' URL utilizavel.
 * @returns {{href:string, host:string, path:string}|null}
 */
function normalizarUrl(bruta) {
  const cru = textoCru(bruta)
  if (!cru) return null
  // Descarta lixo comum de planilha/coleta.
  if (/^(n\/?a|nao|não|none|null|undefined|-{1,}|sem site)$/i.test(cru)) return null

  let comEsquema = cru
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cru)) comEsquema = `https://${cru}`

  let u
  try {
    u = new URL(comEsquema)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  if (!host) return null
  return { href: u.href, host, path: u.pathname || '/' }
}

// Sobe a hierarquia do host, do mais especifico para o menos: para `loja.wixsite.com`
// testa 'loja.wixsite.com', depois 'wixsite.com', depois 'com'. O primeiro que casa vence.
function dominioConhecido(host) {
  const partes = host.split('.')
  for (let i = 0; i < partes.length - 1; i += 1) {
    const candidato = partes.slice(i).join('.')
    const hit = INDICE_DOMINIOS.get(candidato)
    if (hit) return { dominio: candidato, ...hit }
  }
  return null
}

function ehHostSuspeito(host) {
  if (!host.includes('.')) return true                       // 'localhost', 'x'
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true       // IP puro
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)) return true
  if (/\.(test|local|invalid|example|localhost)$/.test(host)) return true
  if (/^(example|exemplo|teste|test|dominio|domain|placeholder|sample|demo|fake|seusite|seu-site|meusite)\./.test(host)) return true
  return false
}

// ── Classificacao ──────────────────────────────────────────────────────────────────────

function resultado({ classificacao, motivo, linkOriginal, host = null, site = null }) {
  return {
    classificacao,
    tem_site: classificacao === 'site_proprio',
    site,
    link_original: linkOriginal || null,
    host,
    motivo,
    label: CLASSIFICACAO_LABEL[classificacao],
  }
}

/**
 * Classifica UMA url crua. Nunca lanca — entrada invalida vira 'sem_link'/'desconhecido'.
 *
 * @param {string|null|undefined} bruta URL como veio da coleta/importacao/digitacao.
 * @returns {{classificacao:string, tem_site:boolean, site:string|null,
 *   link_original:string|null, host:string|null, motivo:string, label:string}}
 */
function classificarUrl(bruta) {
  const linkOriginal = textoCru(bruta) || null
  const norm = normalizarUrl(bruta)

  if (!norm) {
    if (!linkOriginal) return resultado({ classificacao: 'sem_link', motivo: 'nenhum link informado', linkOriginal: null })
    return resultado({ classificacao: 'desconhecido', motivo: 'link ilegivel ou fora do padrao http(s)', linkOriginal })
  }

  const { host, path } = norm

  if (ehHostSuspeito(host)) {
    return resultado({ classificacao: 'desconhecido', motivo: 'dominio invalido, local ou de exemplo', linkOriginal, host })
  }

  const conhecido = dominioConhecido(host)
  if (conhecido) {
    return resultado({ classificacao: conhecido.categoria, motivo: conhecido.motivo, linkOriginal, host })
  }

  // Caminho de mapa em dominio nao listado (ex.: `*.google.<tld>/maps`) — defensivo.
  if (/^\/maps(\/|$)/.test(path)) {
    return resultado({ classificacao: 'perfil_ou_diretorio', motivo: 'link de mapa', linkOriginal, host })
  }

  // Dominio independente que nao casa nenhuma lista: e' site proprio.
  return resultado({
    classificacao: 'site_proprio',
    motivo: 'dominio proprio e independente',
    linkOriginal,
    host,
    site: norm.href,
  })
}

/**
 * Classifica uma LISTA de links e devolve o melhor resultado: um site proprio vence
 * qualquer outro; na falta dele, o primeiro link com alguma informacao. Usado onde o lead
 * tem mais de um candidato (ex.: `website` do perfil + link da bio).
 */
function classificarMelhorLink(links = []) {
  const lista = (Array.isArray(links) ? links : [links]).map(textoCru).filter(Boolean)
  if (!lista.length) return classificarUrl(null)

  const classificados = lista.map(classificarUrl)
  const proprio = classificados.find((c) => c.classificacao === 'site_proprio')
  if (proprio) return proprio
  const informativo = classificados.find((c) => c.classificacao !== 'sem_link')
  return informativo || classificados[0]
}

// ── Visao canonica do LEAD ─────────────────────────────────────────────────────────────

/**
 * Resultado canonico para um lead ja' lido do banco. Todo consumidor (fila, filtros,
 * pontuacao, mensagens, relatorios, telas) deve passar por aqui — nunca por
 * `!!(lead.site || lead.tem_site)`.
 *
 * Considera, nesta ordem de evidencia: `site`, `link_original` e `link_bio`.
 *
 * `situacao_site` tem tres estados porque "nao tem site" e "ninguem verificou" valem coisas
 * diferentes numa campanha de criacao de site:
 *   - tem_site         -> site proprio confirmado
 *   - sem_site         -> confirmado que NAO ha site proprio. Duas provas valem: (a) o unico
 *                         link do lead e' rede social / agregador / perfil (decisao do
 *                         operador: link social so' conta como SEM site), ou (b) a ficha do
 *                         Maps foi lida (`place_id`) e nao havia site.
 *   - nao_identificado -> ninguem verificou, ou o link precisa de revisao humana.
 *
 * @param {object} lead linha de prospectador.prospects (ou payload equivalente).
 */
function classificarLead(lead = {}) {
  const cls = classificarMelhorLink([lead.site, lead.link_original, lead.link_bio])
  const fichaMapsLida = !!textoCru(lead.place_id)

  let situacao
  if (cls.classificacao === 'site_proprio') situacao = 'tem_site'
  else if (cls.classificacao === 'rede_social' || cls.classificacao === 'agregador' || cls.classificacao === 'perfil_ou_diretorio') situacao = 'sem_site'
  else if (cls.classificacao === 'desconhecido') situacao = 'nao_identificado'
  else if (lead.tem_site === true) situacao = 'tem_site'      // flag sem URL: respeita o dado existente
  else if (fichaMapsLida) situacao = 'sem_site'               // Maps lido e sem site na ficha
  else situacao = 'nao_identificado'

  return {
    ...cls,
    tem_site: situacao === 'tem_site',
    situacao_site: situacao,
    situacao_label: SITUACAO_LABEL[situacao],
  }
}

/** Atalho booleano canonico. Substitui todo `!!(lead.site || lead.tem_site)` do projeto. */
function temSiteProprio(lead = {}) {
  return classificarLead(lead).tem_site
}

/** Atalho da situacao em 3 estados (fila de ligacoes, filtros, selos). */
function situacaoSiteDoLead(lead = {}) {
  return classificarLead(lead).situacao_site
}

module.exports = {
  CLASSIFICACOES,
  CLASSIFICACAO_LABEL,
  SITUACAO_LABEL,
  normalizarUrl,
  classificarUrl,
  classificarMelhorLink,
  classificarLead,
  temSiteProprio,
  situacaoSiteDoLead,
}
