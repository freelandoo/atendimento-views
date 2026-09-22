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
    // Usavel como input futuro do cross-reference com `fb_paginas` da Bright Data (nao
    // consumido nesta rodada — ver docs/ai-task-start-log.md, proximos passos).
    pageProfileUri: info ? texto(info.page_profile_uri) : '',
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
  const cls = classificarUrl(a.linkUrl)
  if (cls.tem_site) {
    return { ...a, aproveitavel: false, motivo: MOTIVO.TEM_SITE_PROPRIO, site: cls.site }
  }
  return {
    ...a,
    aproveitavel: true,
    motivo: MOTIVO.OK,
    site: null,
    link_original: cls.link_original || a.linkUrl || null,
    classificacao_url: cls.classificacao,
  }
}

/**
 * Constroi o formato que `db/meta-ads-leads.js` grava, a partir de um veredito aproveitavel.
 * `nicho`/`cidade` vem sempre do CONTEXTO DA BUSCA (o que o operador pediu) — nunca inventados
 * da categoria da pagina, que e' informacao SOBRE o negocio, nao sobre o que foi pesquisado.
 */
function montarLeadDeAnuncio(avaliado, { nicho, cidade, empresaId } = {}, registroBruto = null) {
  if (!avaliado || !avaliado.aproveitavel) return null
  return {
    empresa_id: empresaId || null,
    nome: avaliado.pageName || avaliado.pageId,
    nicho: texto(nicho),
    cidade: texto(cidade),
    site: avaliado.site,
    link_original: avaliado.link_original,
    classificacao_url: avaliado.classificacao_url,
    categoria_perfil: avaliado.categoriaEspecifica || avaliado.categorias[0] || null,
    bio: avaliado.sobre || null,
    external_ref: avaliado.pageId,
    anuncio_meta_ativo: avaliado.isActive,
    anuncio_meta_inicio_em: avaliado.inicioEm,
    anuncio_meta_page_id: avaliado.pageId,
    raw_json: { fonte: 'meta_ads', anuncio: avaliado, registro: registroBruto || null },
  }
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
  normalizarAnuncio,
  avaliarAnuncio,
  montarLeadDeAnuncio,
  decidirCrossReferencePagina,
  avaliarResultadoPagina,
}
