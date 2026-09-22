'use strict'
// Descoberta de leads pela Biblioteca de Anuncios do Meta — QUE anuncio vale virar lead, e
// POR QUE. Fonte: ator Apify `facebook-ads-scraper` (ver docs/ai-task-start-log.md, 2026-09-21
// (3), e a sonda real de 2026-09-22 contra "energia solar" em Goiania/GO).
//
// MODULO PURO: sem banco, sem HTTP, sem IA, sem rede. Ele nao busca nada e nao escreve nada —
// recebe o registro CRU que o ator devolveu e devolve o VEREDITO: este anuncio e' de um negocio
// (nao ruido de politico/influencer), e esse negocio tem lacuna (nao tem site proprio)?
//
// A PERGUNTA CENTRAL nao e' "isso e' um anuncio?", e sim "vale abordar quem colocou este
// anuncio?" — medido na sonda: buscar "energia solar goiania" devolveu tambem a pagina de um
// POLITICO e de um "empreendedor" pessoa fisica, junto das empresas reais. Sem filtrar isso, a
// carteira nasceria suja de gente que nao e' o cliente que a Aquisicao busca.

const { classificarUrl } = require('./site-classificacao')
// STATUS/MOTIVO sao vocabulario GENERICO de fila de enriquecimento (retry/backoff/lease),
// nao especifico de Instagram — reusado aqui para o cross-reference com `fb_paginas` em vez de
// duplicar o mesmo vocabulario com nomes diferentes.
const { STATUS, MOTIVO: MOTIVO_FILA } = require('./enriquecimento-pipeline')
// O @ vem do registro do anuncio; quem sabe sanear e' o dono do vocabulario de Instagram.
const {
  normalizarHandle, normalizar, tokensDistintivos,
  ORIGEM: IG_ORIGEM, CONFIANCA: IG_CONFIANCA,
} = require('./instagram-perfil')

const MOTIVO = Object.freeze({
  SEM_PAGE_ID: 'sem_page_id',
  CATEGORIA_NAO_NEGOCIO: 'categoria_nao_negocio',
  TEM_SITE_PROPRIO: 'tem_site_proprio',
  OK: 'ok',
})
const MOTIVOS = Object.freeze(Object.values(MOTIVO))

// Categorias do Facebook que a sonda comprovou aparecerem numa busca por nicho+cidade sem
// serem o tipo de negocio que a Aquisicao qualifica. Lista de BLOQUEIO, nao de permissao: a
// variedade real de categoria de negocio e' grande demais para uma lista fechada de permissao
// (mesmo raciocinio do `site-classificacao.js` para dominio de site proprio).
const CATEGORIA_NAO_NEGOCIO = new Set([
  'politician', 'political candidate', 'political organization', 'political party',
  'government official', 'public figure',
  'community', 'community organization', 'nonprofit organization', 'charity organization',
  'personal blog', 'blogger', 'author', 'artist', 'musician/band', 'media/news company',
  'entrepreneur',
])

function texto(v) {
  return String(v == null ? '' : v).trim()
}

/** As categorias amplas do anuncio (`snapshot.pageCategories`) — sempre presentes na resposta. */
function categoriasDoAnuncio(registro) {
  const cats = registro && registro.snapshot && Array.isArray(registro.snapshot.pageCategories)
    ? registro.snapshot.pageCategories : []
  return cats.map(texto).filter(Boolean)
}

/**
 * A categoria ESPECIFICA da pagina (ex.: "Solar Energy Company"), bem mais util que as
 * categorias amplas — mas so' vem quando o ator busca os detalhes da pagina (`includeAboutPage`/
 * `isDetailsPerAd`), aninhada fundo dentro de `ad_details.advertiser...page_info`.
 */
function categoriaEspecifica(registro) {
  const info = registro && registro.ad_details && registro.ad_details.advertiser &&
    registro.ad_details.advertiser.ad_library_page_info &&
    registro.ad_details.advertiser.ad_library_page_info.page_info
  return info ? texto(info.page_category) : ''
}

/** Sem categoria nenhuma, nao ha' motivo pra descartar por ruido — so descarta quem BATEU o bloqueio. */
function pareceNegocio(registro) {
  const cats = categoriasDoAnuncio(registro)
  if (!cats.length) return true
  return !cats.some((c) => CATEGORIA_NAO_NEGOCIO.has(c.toLowerCase()))
}

/**
 * O destino do anuncio leva a ALGUM lugar?
 *
 * Medido na sonda de 2026-09-22: 5 dos 8 anuncios traziam `http://fb.me/` — a raiz NUA do
 * encurtador, sem caminho — e outro trazia `https://api.whatsapp.com/send` sem `phone`. Sao
 * anuncios de clique-para-conversa: a Biblioteca nao expoe o destino, e o que ela devolve e' um
 * carimbo do canal, nao um endereco. Abrir isso nao leva a lugar nenhum.
 *
 * A regra e' estrutural, nao uma lista de dominios: link sem caminho e sem query nao e' destino.
 * Assim ela vale para qualquer encurtador que a Meta use amanha.
 */
function destinoUtilizavel(url) {
  const bruto = texto(url)
  if (!bruto) return false
  let u
  try {
    u = new URL(/^https?:/i.test(bruto) ? bruto : `https://${bruto}`)
  } catch {
    return false
  }
  const caminho = u.pathname.replace(/\/+$/, '')
  const temCaminho = caminho !== '' && caminho !== '/'
  const temQuery = u.search.length > 1
  // O compositor VAZIO do WhatsApp (`api.whatsapp.com/send` sem `phone`) tem caminho e mesmo
  // assim nao leva a ninguem — abre a janela de "para quem?". E' o segundo formato de stub que a
  // sonda encontrou, e a excecao e' nomeada por isso, nao por ser uma lista de dominios:
  // `m.me/<pagina>` e `wa.me/<numero>` carregam o destinatario e continuam validos.
  if (/(^|\.)whatsapp\.com$/i.test(u.hostname) && caminho === '/send' && !temQuery) return false
  return temCaminho || temQuery
}

/** O anuncio na propria Biblioteca — sempre navegavel, ao contrario do destino. */
function permalinkDoAnuncio(registro) {
  const id = texto(registro && (registro.adArchiveID || registro.adArchiveId))
  return id ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}` : null
}

/** Extrai os campos que interessam do registro cru, sem julgar nada ainda. */
function normalizarAnuncio(registro) {
  const snap = (registro && registro.snapshot) || {}
  const info = registro && registro.ad_details && registro.ad_details.advertiser &&
    registro.ad_details.advertiser.ad_library_page_info &&
    registro.ad_details.advertiser.ad_library_page_info.page_info
  const about = registro && registro.ad_details && registro.ad_details.advertiser &&
    registro.ad_details.advertiser.page && registro.ad_details.advertiser.page.about
  const startDate = registro && Number.isFinite(registro.startDate) ? registro.startDate : null
  return {
    pageId: texto(registro && (registro.pageId || registro.pageID)),
    pageName: texto(snap.pageName),
    isActive: !!(registro && registro.isActive),
    inicioEm: startDate ? new Date(startDate * 1000) : null,
    linkUrl: texto(snap.linkUrl),
    ctaTipo: texto(snap.ctaType),
    categorias: categoriasDoAnuncio(registro),
    categoriaEspecifica: categoriaEspecifica(registro),
    pageLikeCount: Number.isFinite(snap.pageLikeCount) ? snap.pageLikeCount : null,
    // A URL NAVEGAVEL da pagina — e' ela que o cross-reference com `fb_paginas` consulta.
    // NAO e' derivavel do `pageId`: medido na sonda, em 2 de 5 casos ela aponta para outro
    // identificador (o do perfil), e montar `facebook.com/<pageId>/` consultava pagina errada.
    pageProfileUri: info ? texto(info.page_profile_uri) : '',
    permalink: permalinkDoAnuncio(registro),
    igUsernameDeclarado: info ? texto(info.ig_username) : '',
    sobre: about ? texto(about.text) : '',
    publisherPlatform: Array.isArray(registro && registro.publisherPlatform) ? registro.publisherPlatform : [],
  }
}

/**
 * O anuncio vale virar lead?
 *
 * Ordem importa: sem page_id nao ha' identidade pra deduplicar; categoria de ruido descarta
 * antes de gastar a classificacao de URL (mais barato eliminar por categoria); so' quem passa
 * nos dois e' que tem o link classificado — e "tem site proprio" e' o criterio ELIMINATORIO
 * final, exatamente como no desenho original (empresa que ja resolveu nao e' lacuna).
 */
function avaliarAnuncio(registroBruto) {
  const a = normalizarAnuncio(registroBruto)
  if (!a.pageId) return { ...a, aproveitavel: false, motivo: MOTIVO.SEM_PAGE_ID, site: null }
  if (!pareceNegocio(registroBruto)) {
    return { ...a, aproveitavel: false, motivo: MOTIVO.CATEGORIA_NAO_NEGOCIO, site: null }
  }
  const destinoUtil = destinoUtilizavel(a.linkUrl)
  const cls = classificarUrl(a.linkUrl)
  if (cls.tem_site) {
    return { ...a, aproveitavel: false, motivo: MOTIVO.TEM_SITE_PROPRIO, site: cls.site, destinoUtil }
  }
  return {
    ...a,
    aproveitavel: true,
    motivo: MOTIVO.OK,
    site: null,
    destinoUtil,
    // Destino que nao leva a lugar nenhum NAO e' gravado como link do lead: a tela o ofereceria
    // como "abrir destino" e o operador cairia numa pagina vazia. A classificacao da URL
    // continua valendo (um `fb.me` segue sendo rede social, e nao site proprio) — o que muda e'
    // so' o link que a tela pode oferecer.
    link_original: destinoUtil ? (cls.link_original || a.linkUrl || null) : null,
    classificacao_url: cls.classificacao,
  }
}

/**
 * Constroi o formato que `db/meta-ads-leads.js` grava, a partir de um veredito aproveitavel.
 * `nicho`/`cidade` vem sempre do CONTEXTO DA BUSCA (o que o operador pediu) — nunca inventados
 * da categoria da pagina, que e' informacao SOBRE o negocio, nao sobre o que foi pesquisado.
 */
function montarLeadDeAnuncio(avaliado, { nicho, cidade, empresaId, totalAtivos = null } = {}, registroBruto = null) {
  if (!avaliado || !avaliado.aproveitavel) return null
  // O @ que o proprio anunciante declarou na pagina dele — ja vem no registro do anuncio, de
  // graca. Sem isto o lead pagaria uma consulta SERP para descobrir o que ja estava na mao, e
  // ainda concorreria pela cota diaria com os leads do Maps.
  const handle = normalizarHandle(avaliado.igUsernameDeclarado)
  return {
    empresa_id: empresaId || null,
    nome: avaliado.pageName || avaliado.pageId,
    nicho: texto(nicho),
    cidade: texto(cidade),
    instagram_handle: handle,
    instagram_origem: handle ? IG_ORIGEM.PAGINA_FACEBOOK : null,
    instagram_confianca: handle ? IG_CONFIANCA.CONFIRMADO : null,
    instagram_evidencia: handle
      ? { fonte: 'pagina_facebook', page_id: avaliado.pageId, declarado_em: 'ad_library_page_info' }
      : null,
    site: avaliado.site,
    link_original: avaliado.link_original,
    classificacao_url: avaliado.classificacao_url,
    categoria_perfil: avaliado.categoriaEspecifica || avaliado.categorias[0] || null,
    bio: avaliado.sobre || null,
    external_ref: avaliado.pageId,
    anuncio_meta_ativo: avaliado.isActive,
    anuncio_meta_inicio_em: avaliado.inicioEm,
    anuncio_meta_page_id: avaliado.pageId,
    // `null` quando ninguem contou — nunca 0, que afirmaria "nao tem anuncio ativo".
    anuncio_meta_total_ativos: Number.isFinite(totalAtivos) ? totalAtivos : null,
    // Os dois links que FUNCIONAM, ao contrario do destino (ver `destinoUtilizavel`).
    anuncio_meta_permalink: avaliado.permalink || null,
    anuncio_meta_pagina_url: avaliado.pageProfileUri || null,
    raw_json: { fonte: 'meta_ads', anuncio: avaliado, registro: registroBruto || null },
  }
}

/**
 * UMA entrada por PAGINA, com a contagem de anuncios ativos dela.
 *
 * A busca devolve uma linha por ANUNCIO, e o mesmo negocio costuma ter varios ("CMD SOLAR" veio
 * 3x na sonda). Uma linha por anuncio na carteira seria o mesmo negocio repetido, e quem trabalha
 * a lista liga para a mesma pessoa tres vezes. O que interessa ao vendedor nao e' qual anuncio, e
 * sim QUANTOS — e' a medida de quanto aquele negocio esta investindo agora.
 *
 * O anuncio ESCOLHIDO como representante e' o mais ANTIGO com destino utilizavel (ou o mais
 * antigo, se nenhum tiver): o inicio mais antigo diz ha quanto tempo a empresa investe, e um
 * destino que abre vale mais que um stub.
 */
function agruparPorPagina(registros) {
  const porPagina = new Map()
  for (const registro of Array.isArray(registros) ? registros : []) {
    const avaliado = avaliarAnuncio(registro)
    if (!avaliado.pageId) continue
    const atual = porPagina.get(avaliado.pageId)
    if (!atual) {
      porPagina.set(avaliado.pageId, {
        avaliado,
        registro,
        totalAtivos: avaliado.isActive ? 1 : 0,
        anuncios: 1,
      })
      continue
    }
    atual.anuncios += 1
    if (avaliado.isActive) atual.totalAtivos += 1
    // Promove o representante quando o novo tem destino utilizavel e o atual nao, ou quando
    // comecou antes (com a mesma qualidade de destino).
    const melhorDestino = !!avaliado.destinoUtil && !atual.avaliado.destinoUtil
    const maisAntigo = !!avaliado.inicioEm && !!atual.avaliado.inicioEm
      && avaliado.inicioEm < atual.avaliado.inicioEm
      && (!!avaliado.destinoUtil === !!atual.avaliado.destinoUtil)
    if (melhorDestino || maisAntigo) {
      atual.avaliado = avaliado
      atual.registro = registro
    }
  }
  return [...porPagina.values()]
}

// ── Dedup ENTRE CANAIS: este anunciante ja esta na carteira, vindo do Maps? ─────────────────
//
// POR QUE. As chaves de identidade sao diferentes por canal (`place_id` no Maps,
// `(empresa, 'meta_ads', page_id)` aqui), entao a MESMA empresa achada nos dois vira duas
// linhas — dois vendedores trabalhando o mesmo negocio e risco de duas abordagens ao mesmo
// cliente. E o lead do Maps ja tem telefone, que e' exatamente o que falta ao lead de anuncio.
//
// A REGRA E' CONSERVADORA DE PROPOSITO: casar por semelhanca de nome e' o que faz todo
// concorrente virar "o mesmo negocio" (a licao de `tokensDistintivos`, que remove nicho e
// cidade justamente porque "Energia Solar Goiania" nao distingue ninguem). Na duvida, NAO funde:
// uma linha a mais custa retrabalho; fundir errado costura dois negocios num lead so'.

/** Primeiro segmento da cidade, normalizado — "Goiania - GO" e "Goiania, GO" viram "goiania". */
function cidadeBase(valor) {
  const n = normalizar(valor)
  if (!n) return ''
  return n.split(' ').filter(Boolean)[0] || ''
}

function cidadeCompativel(a, b) {
  const x = cidadeBase(a)
  const y = cidadeBase(b)
  // Cidade desconhecida dos dois lados nao autoriza fusao: sem ela sobra so' o nome, e nome
  // sozinho e' o criterio que junta concorrentes.
  return !!x && !!y && x === y
}

/**
 * O anunciante e o lead existente sao o MESMO negocio?
 *
 * Exige, junto: cidade compativel E tokens distintivos em comum onde a intersecao ou cobre um
 * dos lados por inteiro ("CMD" dentro de "CMD Solar Energia") ou tem pelo menos dois tokens.
 * Um unico token generico em comum ("Brasil" em dois nomes diferentes) NAO funde.
 */
function mesmoNegocio(anuncio = {}, existente = {}, { nicho = '', cidade = '' } = {}) {
  // PROVA FORTE, e ela dispensa a cidade: o @ do Instagram e' identificador UNICO. Dois
  // negocios diferentes nao compartilham handle, entao aqui nao ha' o risco de semelhanca que
  // torna o nome perigoso. E' tambem o que faz a dedup funcionar na busca SEM cidade — que a
  // aba Meta permite, e onde a comparacao por nome+cidade simplesmente nao roda.
  const handleAnuncio = normalizarHandle(anuncio.igUsernameDeclarado || anuncio.instagram_handle)
  const handleExistente = normalizarHandle(existente.instagram_handle)
  if (handleAnuncio && handleExistente && handleAnuncio === handleExistente) return true

  if (!cidadeCompativel(existente.cidade, cidade || anuncio.cidade)) return false
  const contexto = { nicho, cidade: cidade || existente.cidade }
  const a = tokensDistintivos({ nome: anuncio.pageName || anuncio.nome, ...contexto })
  const b = tokensDistintivos({ nome: existente.nome, ...contexto })
  if (!a.length || !b.length) return false
  const comuns = a.filter((t) => b.includes(t))
  if (!comuns.length) return false
  const cobreUmLado = comuns.length === a.length || comuns.length === b.length
  return cobreUmLado || comuns.length >= 2
}

/** O melhor candidato a fusao entre os leads que a empresa ja tem, ou null. */
function escolherLeadExistente(anuncio = {}, existentes = [], contexto = {}) {
  for (const cand of Array.isArray(existentes) ? existentes : []) {
    if (mesmoNegocio(anuncio, cand, contexto)) return cand
  }
  return null
}

// ── Cross-reference com a PAGINA do anunciante (fb_paginas da Bright Data, migration 092) ──
//
// Este e' o passo 2 da cascata: o anuncio ja disse "sem site" (ou nem foi checado ainda), e a
// pagina do Facebook pode confirmar isso com mais forca — telefone, e-mail, endereco, e um
// `is_running_ads` que independe do anuncio especifico que a busca achou.

const TTL_PAGINA_DIAS = 30

function diasDesde(data, agora) {
  if (!data) return null
  const t = data instanceof Date ? data.getTime() : Date.parse(String(data))
  if (!Number.isFinite(t)) return null
  return Math.floor((agora.getTime() - t) / 86400000)
}

/**
 * Vale gastar 1 credito da Bright Data pra cruzar esta pagina?
 *
 * Sem `anuncio_meta_page_id` nao ha' pagina pra buscar (nunca deveria acontecer — todo lead
 * deste canal nasce com o page_id — mas o worker nao confia nisso, confia no dado). Cache
 * recente evita repagar a mesma pagina numa recoleta do mesmo mercado.
 */
function decidirCrossReferencePagina(lead = {}, { agora = new Date(), ttlDias = TTL_PAGINA_DIAS } = {}) {
  const pageId = texto(lead.anuncio_meta_page_id)
  if (!pageId) return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO_FILA.SEM_HANDLE, pageId: null }
  const dias = diasDesde(lead.anuncio_meta_pagina_verificada_em, agora)
  if (dias !== null && dias < ttlDias) {
    return { rodar: false, status: STATUS.PULADO, motivo: MOTIVO_FILA.CACHE_RECENTE, pageId }
  }
  return { rodar: true, status: STATUS.PROCESSANDO, motivo: null, pageId }
}

/**
 * O que o registro de `fb_paginas` prova sobre este lead — nunca julga, so' extrai e classifica
 * pelo MESMO `site-classificacao.js` de sempre (nunca uma segunda regua de "isso e' site?").
 *
 * `perfilExiste` distingue "a Bright Data nao achou esta pagina" (resposta) de "nao veio nada
 * no lote" (falha de transporte) — a mesma disciplina de `ATIVIDADE.perfilExiste` do Instagram.
 */
function avaliarResultadoPagina(registro) {
  const contato = (registro && registro.contact_and_basic_info && registro.contact_and_basic_info.contact_info) || {}
  const websites = Array.isArray(contato.websites) ? contato.websites.map(texto).filter(Boolean) : []
  const phones = Array.isArray(contato.phones) ? contato.phones.map(texto).filter(Boolean) : []
  const emails = Array.isArray(contato.emails) ? contato.emails.map(texto).filter(Boolean) : []
  const cls = websites.length ? classificarUrl(websites[0]) : null
  const transparencia = (registro && registro.page_transparency) || {}
  const seguidores = registro && Number.isFinite(registro.followers) ? registro.followers : null
  return {
    perfilExiste: !!(registro && (transparencia.page_id || registro.id || registro.page_name)),
    temSiteProprio: !!(cls && cls.tem_site),
    site: cls && cls.tem_site ? cls.site : null,
    linkOriginal: cls ? cls.link_original : (websites[0] || null),
    classificacaoUrl: cls ? cls.classificacao : null,
    telefone: phones[0] || null,
    email: emails[0] || null,
    endereco: texto(registro && registro.address && registro.address.formatted) || null,
    anuncioAtivoConfirmado: transparencia.is_running_ads === true,
    seguidores,
    pageIdConfirmado: texto(transparencia.page_id) || null,
  }
}

module.exports = {
  MOTIVO,
  MOTIVOS,
  CATEGORIA_NAO_NEGOCIO,
  TTL_PAGINA_DIAS,
  categoriasDoAnuncio,
  categoriaEspecifica,
  pareceNegocio,
  destinoUtilizavel,
  permalinkDoAnuncio,
  normalizarAnuncio,
  avaliarAnuncio,
  agruparPorPagina,
  montarLeadDeAnuncio,
  decidirCrossReferencePagina,
  avaliarResultadoPagina,
  cidadeCompativel,
  mesmoNegocio,
  escolherLeadExistente,
}
