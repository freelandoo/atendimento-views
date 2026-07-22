'use strict'

const axios = require('axios')
const cheerio = require('cheerio')
const pdfParse = require('pdf-parse')

const aiProvider = require('../ai-provider')
const { parsearRespostaJsonClaude } = require('../string-utils')
const { CONTEXTO1_CAMPOS } = require('./contexto-empresa')

const MAX_TEXT_CHARS = 60000
const JINA_TIMEOUT_MS = 25000
const HTTP_TIMEOUT_MS = 15000
const MAX_PAGINAS_CRAWL = 25  // limite total
const MAX_DEPTH = 2

// Padrões → priority (alto > 0). Maior = mais comercial = entra primeiro.
const PRIORIDADE_PADROES = [
  { rx: /(planos?|pre[çc]os?|pricing|assinatur)/i, score: 100 },
  { rx: /(servi[cç]os?|produtos?|catalog)/i, score: 90 },
  { rx: /(como[-\s]funciona|funcionalidades?|features?)/i, score: 85 },
  { rx: /(cadastr|sign[-\s]?up|registr|criar[-\s]?conta|contratar|assinar)/i, score: 80 },
  { rx: /(quem[-\s]somos|sobre|about|empresa)/i, score: 70 },
  { rx: /(faq|d[uú]vidas|ajuda|help|suporte|support|perguntas)/i, score: 65 },
  { rx: /(contato|contact|fale[-\s]?conosco)/i, score: 60 },
  { rx: /(diferenciais?|por[-\s]que|vantagens)/i, score: 55 },
  { rx: /(maquinas?|m[oó]dulos?|freelancers?|cursos?|marketplace|profissionais)/i, score: 50 },
  { rx: /(termos|privacidade|terms|privacy|politica)/i, score: 25 },
  { rx: /(blog|noticias?)/i, score: 10 },
]

// Padrões que NUNCA entram no crawl (admin, login, mídia, etc.)
const IGNORAR_PADROES = [
  /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|tar|gz|mp4|mp3|wav|css|js|json|xml|woff2?|ttf|eot)(\?|#|$)/i,
  /\/(wp-admin|admin|wp-login|login|logout|signin|signout|signup\?|carrinho|cart|checkout|conta|account|dashboard|painel)(\/|$|\?)/i,
  /\/feed\/?$/i,
  /^mailto:|^tel:|^javascript:|^#/i,
]

// Domínios externos relevantes (registrar como link, NÃO crawlar)
const REDES_SOCIAIS = [
  /(?:^|\.)instagram\.com\//i,
  /(?:^|\.)facebook\.com\//i,
  /(?:^|\.)linkedin\.com\//i,
  /(?:^|\.)twitter\.com\//i,
  /(?:^|\.)x\.com\//i,
  /(?:^|\.)youtube\.com\//i,
  /(?:^|\.)tiktok\.com\//i,
  /(?:^|\.)wa\.me\//i,
  /api\.whatsapp\.com\//i,
]

// ─── Extração de texto bruto ─────────────────────────────────────────────────

function extrairTextoDeHtml(html) {
  if (!html || typeof html !== 'string') return ''
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, svg, nav, footer, header').remove()
  const main = $('main').text() || $('article').text() || $('body').text() || ''
  return main.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

async function extrairTextoDePdf(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error('PDF buffer inválido')
  const r = await pdfParse(buffer)
  return (r?.text || '').trim()
}

function truncar(texto) {
  const s = String(texto || '')
  if (s.length <= MAX_TEXT_CHARS) return { texto: s, truncado: false }
  return { texto: s.slice(0, MAX_TEXT_CHARS), truncado: true }
}

// ─── Busca conteúdo de site (Jina Reader → fallback axios+cheerio) ──────────

// Busca uma URL específica. Sempre tenta HTML cru (pra extrair links/estrutura).
// Texto vem do HTML; se HTML falhar, usa Jina Reader como fallback.
async function _buscarPaginaUnica(url, log) {
  let html = null
  let texto = ''
  let titulo = null
  let fonte_render = 'cheerio'

  // 1. HTML cru via axios (mais barato e nos dá <a href> reais)
  try {
    const r = await axios.get(url, {
      timeout: HTTP_TIMEOUT_MS,
      maxContentLength: 5 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PJCodeworksBot/1.0)' },
      responseType: 'text',
      validateStatus: (s) => s < 500,
    })
    if (r.status >= 200 && r.status < 400) {
      html = String(r.data || '')
      texto = extrairTextoDeHtml(html)
      const $ = cheerio.load(html)
      titulo = $('title').first().text().trim() || null
    }
  } catch (err) {
    if (log) log.warn({ url, err: err.message }, '[crawl] HTML fallback')
  }

  // 2. Se HTML retornou pouco texto (SPA, Cloudflare), tenta Jina Reader pra ver o conteúdo renderizado
  if (!texto || texto.length < 200) {
    try {
      const r = await axios.get(`https://r.jina.ai/${url}`, {
        timeout: JINA_TIMEOUT_MS,
        headers: { 'X-Return-Format': 'markdown' },
        maxContentLength: 5 * 1024 * 1024,
        responseType: 'text',
      })
      const md = String(r.data || '').trim()
      if (md.length > 200) {
        texto = md
        if (!titulo) titulo = extrairTituloDeMarkdown(md)
        fonte_render = 'jina'
      }
    } catch (err) {
      if (log) log.warn({ url, err: err.message }, '[crawl] Jina fallback')
    }
  }

  if (!texto || texto.length < 80) throw new Error('Página sem conteúdo útil.')
  return { texto, html, fonte_render, titulo }
}

// Decide se uma URL deve ser ignorada (mídia, admin, login, etc.)
function _ehUrlIgnoravel(url) {
  return IGNORAR_PADROES.some((rx) => rx.test(url))
}

function _normalizarUrl(href, baseUrl) {
  try {
    const abs = new URL(href, baseUrl)
    abs.hash = ''
    let s = abs.toString().replace(/\/+$/, '')
    return s
  } catch (_) {
    return null
  }
}

function _ehRedeSocial(url) {
  return REDES_SOCIAIS.some((rx) => rx.test(url))
}

function _scoreUrl(url, anchorText, source) {
  let score = 0
  const txt = (anchorText || '').toLowerCase()
  for (const { rx, score: s } of PRIORIDADE_PADROES) {
    if (rx.test(url) || rx.test(txt)) {
      score = Math.max(score, s)
    }
  }
  // Boost por origem (footer/header geralmente têm sobre/contato/planos)
  if (source === 'footer' || source === 'header' || source === 'nav') score += 5
  if (source === 'button' || source === 'cta') score += 10
  return score
}

/**
 * Descobre links internos relevantes de uma página, classifica por origem
 * (header/footer/nav/button/body) e atribui priority score.
 *
 * Retorna { internos: [...], externos_uteis: [...] } ordenados por priority desc.
 */
function descobrirLinksInternosRelevantes(html, baseUrl) {
  if (!html) return { internos: [], externos_uteis: [] }
  const base = new URL(baseUrl)
  const $ = cheerio.load(html)

  const seenInternos = new Map()  // url → { url, anchorText, source, priority }
  const seenExternos = new Map()  // mesmo formato

  // Para detectar a origem do link, marcamos os elementos pai
  function detectarSource($el) {
    const cls = ($el.attr('class') || '').toLowerCase()
    let parents = $el.parents('header, nav, footer, button, [role="button"], .btn, .button, .cta, .header, .footer, .menu, .nav, .navbar')
    if (parents.length > 0) {
      const tags = parents.map((_, p) => p.tagName?.toLowerCase()).get().reverse()
      for (const t of ['button', 'footer', 'header', 'nav']) if (tags.includes(t)) return t
      if (parents.toArray().some((p) => /btn|button|cta/.test(($(p).attr('class') || '').toLowerCase()))) return 'button'
      if (parents.toArray().some((p) => /menu|navbar|nav/.test(($(p).attr('class') || '').toLowerCase()))) return 'nav'
    }
    if (/btn|button|cta/.test(cls)) return 'button'
    return 'body'
  }

  $('a[href]').each((_, el) => {
    const $el = $(el)
    const hrefRaw = $el.attr('href') || ''
    if (!hrefRaw || _ehUrlIgnoravel(hrefRaw)) return
    const abs = _normalizarUrl(hrefRaw, baseUrl)
    if (!abs || _ehUrlIgnoravel(abs)) return
    let urlObj
    try { urlObj = new URL(abs) } catch (_) { return }
    if (abs === baseUrl.replace(/\/+$/, '')) return

    const anchor = ($el.text() || '').trim().replace(/\s+/g, ' ').slice(0, 200)
    const source = detectarSource($el)
    const isMesmoHost = urlObj.host === base.host || urlObj.host.endsWith('.' + base.host) || base.host.endsWith('.' + urlObj.host)

    if (isMesmoHost) {
      const prev = seenInternos.get(abs)
      const priority = _scoreUrl(abs, anchor, source)
      if (!prev || prev.priority < priority) {
        seenInternos.set(abs, { url: abs, anchorText: anchor, source, priority })
      }
    } else if (_ehRedeSocial(abs)) {
      if (!seenExternos.has(abs)) {
        seenExternos.set(abs, { url: abs, anchorText: anchor, source, priority: 50, tipo: 'rede_social' })
      }
    }
  })

  const internos = [...seenInternos.values()].sort((a, b) => b.priority - a.priority)
  const externos_uteis = [...seenExternos.values()]
  return { internos, externos_uteis }
}

/**
 * Extrai conteúdo estruturado de uma página HTML para análise da LLM.
 * Retorna title, meta description, headings, buttons (CTAs), contatos, sections.
 */
function extrairConteudoEstruturadoHtml({ html, url }) {
  if (!html) return null
  const $ = cheerio.load(html)

  const title = ($('title').first().text() || '').trim() || null
  const description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null

  const headings = []
  $('h1, h2, h3').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ')
    if (t && t.length < 300) headings.push(t)
  })

  // Botões / CTAs (texto curto, geralmente comerciais)
  const buttons = []
  $('button, a.btn, a.button, [role="button"], .cta a, .cta button').each((_, el) => {
    const t = $(el).text().trim().replace(/\s+/g, ' ')
    if (t && t.length > 1 && t.length < 80 && !buttons.includes(t)) buttons.push(t)
  })

  // Contatos
  const contacts = {}
  const tels = new Set()
  const emails = new Set()
  const whatsapps = new Set()
  const instagrams = new Set()

  $('a[href^="tel:"]').each((_, el) => tels.add($(el).attr('href').replace('tel:', '').trim()))
  $('a[href^="mailto:"]').each((_, el) => emails.add($(el).attr('href').replace('mailto:', '').replace(/\?.*$/, '').trim()))
  $('a[href]').each((_, el) => {
    const h = $(el).attr('href') || ''
    if (/wa\.me\/|api\.whatsapp\.com\//i.test(h)) {
      const m = h.match(/(?:wa\.me\/|phone=)(\+?\d{8,})/i)
      if (m) whatsapps.add(m[1])
      else whatsapps.add(h)
    }
    if (/instagram\.com\/[^/?#]+/i.test(h)) {
      const m = h.match(/instagram\.com\/([^/?#]+)/i)
      if (m && m[1] && !/^(p|reel|stories|tv|explore)$/i.test(m[1])) instagrams.add('@' + m[1])
    }
  })

  // Fallback: regex no texto para tels/emails que não estão como links
  const textoCompleto = $('body').text() || ''
  const emailRx = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
  const telRx = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4,5}[-.\s]?\d{4}/g
  for (const m of textoCompleto.match(emailRx) || []) emails.add(m.toLowerCase())
  for (const m of textoCompleto.match(telRx) || []) {
    const limpo = m.replace(/\s+/g, ' ').trim()
    if (limpo.length <= 20) tels.add(limpo)
  }

  if (tels.size) contacts.telefones = [...tels].slice(0, 5)
  if (emails.size) contacts.emails = [...emails].slice(0, 5)
  if (whatsapps.size) contacts.whatsapps = [...whatsapps].slice(0, 3)
  if (instagrams.size) contacts.instagrams = [...instagrams].slice(0, 3)

  // Texto limpo
  const $clone = cheerio.load(html)
  $clone('script, style, noscript, iframe, svg').remove()
  const rawText = ($clone('main').text() || $clone('body').text() || '').replace(/\s+/g, ' ').trim()

  return {
    url,
    title,
    description,
    headings,
    buttons,
    contacts,
    rawText: rawText.slice(0, 15000),
  }
}

/**
 * Crawler BFS com depth máx 2 e até 25 páginas, priorizando rotas comerciais.
 * Retorna { paginas: [...], stats: {...} }.
 */
async function crawlSite({ url, log, maxPaginas = MAX_PAGINAS_CRAWL, maxDepth = MAX_DEPTH }) {
  const inicio = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(inicio)) throw new Error('URL inválida.')

  const visitadas = new Set()
  const paginas = []
  const linksExternosUteis = []
  let totalLinksDescobertos = 0

  // Fila ordenada por priority desc (recalculada a cada batch)
  let fila = [{ url: inicio, anchorText: '', source: 'root', priority: 1000, depth: 0 }]

  while (fila.length && visitadas.size < maxPaginas) {
    fila.sort((a, b) => b.priority - a.priority)
    const batch = fila.splice(0, Math.min(5, maxPaginas - visitadas.size))  // 5 paralelas
    const novasPagsResult = await Promise.allSettled(
      batch.map(async (item) => {
        if (visitadas.has(item.url)) return null
        visitadas.add(item.url)
        try {
          const r = await _buscarPaginaUnica(item.url, log)
          const estrut = r.html ? extrairConteudoEstruturadoHtml({ html: r.html, url: item.url }) : null
          return { ...item, ...r, estrut }
        } catch (err) {
          if (log) log.warn({ url: item.url, err: err.message }, '[crawl] página falhou')
          return null
        }
      })
    )

    for (const r of novasPagsResult) {
      if (r.status !== 'fulfilled' || !r.value) continue
      const p = r.value
      paginas.push(p)

      // Descobre links nesta página (só se ainda há orçamento de profundidade)
      if (p.html && p.depth < maxDepth) {
        const { internos, externos_uteis } = descobrirLinksInternosRelevantes(p.html, p.url)
        totalLinksDescobertos += internos.length + externos_uteis.length
        for (const ext of externos_uteis) {
          if (!linksExternosUteis.some((x) => x.url === ext.url)) linksExternosUteis.push(ext)
        }
        for (const link of internos) {
          if (visitadas.has(link.url)) continue
          if (fila.some((x) => x.url === link.url)) continue
          fila.push({ ...link, depth: p.depth + 1 })
        }
      }
    }
  }

  return {
    paginas,
    stats: {
      paginas_lidas: paginas.length,
      links_internos_descobertos: totalLinksDescobertos,
      links_externos_uteis: linksExternosUteis.length,
      profundidade_max: maxDepth,
      teto_paginas: maxPaginas,
    },
    linksExternosUteis,
  }
}

async function buscarConteudoSite(url, log) {
  const { paginas, stats, linksExternosUteis } = await crawlSite({ url, log })
  if (!paginas.length) throw new Error('Não consegui ler nenhuma página do site.')

  const partes = paginas.map((p, i) => {
    const header = i === 0 ? `# ${p.titulo || p.url}` : `\n\n---\n\n## ${p.titulo || p.url}\n[${p.url}]`
    return `${header}\n\n${p.texto}`
  })

  return {
    texto: partes.join(''),
    fonte_render: paginas[0]?.fonte_render || 'cheerio',
    titulo: paginas[0]?.titulo || null,
    paginas_crawladas: paginas.length,
    stats,
    paginas_estruturadas: paginas.map((p) => p.estrut).filter(Boolean),
    links_externos_uteis: linksExternosUteis,
  }
}

function extrairTituloDeMarkdown(md) {
  const m = String(md || '').match(/^#\s+(.+?)$/m)
  return m ? m[1].trim() : null
}

// ─── Persistência de fonte ───────────────────────────────────────────────────

async function criarFonteConhecimento(pool, { empresaId, contextoId, tipo, url, filename, titulo }) {
  if (!empresaId) throw new Error('empresaId obrigatório')
  if (!['site', 'pdf', 'documento', 'texto_manual'].includes(tipo)) throw new Error('tipo inválido')
  const { rows: [r] } = await pool.query(
    `INSERT INTO app.empresa_fontes_conhecimento
       (empresa_id, contexto_id, tipo, url, filename, titulo, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
     RETURNING *`,
    [empresaId, contextoId || null, tipo, url || null, filename || null, titulo || null]
  )
  return r
}

async function atualizarFonteConteudo(pool, fonteId, { conteudo_extraido, titulo, status, erro }) {
  const sets = ['updated_at = NOW()']
  const vals = [fonteId]
  if (conteudo_extraido !== undefined) { vals.push(conteudo_extraido); sets.push(`conteudo_extraido = $${vals.length}`) }
  if (titulo !== undefined) { vals.push(titulo); sets.push(`titulo = $${vals.length}`) }
  if (status !== undefined) { vals.push(status); sets.push(`status = $${vals.length}`) }
  if (erro !== undefined) { vals.push(erro); sets.push(`erro = $${vals.length}`) }
  const { rows: [r] } = await pool.query(
    `UPDATE app.empresa_fontes_conhecimento SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    vals
  )
  return r
}

// ─── Importadores ────────────────────────────────────────────────────────────

async function importarLinkEmpresa(pool, log, { empresaId, contextoId, url }) {
  const fonte = await criarFonteConhecimento(pool, { empresaId, contextoId, tipo: 'site', url })
  try {
    const r = await buscarConteudoSite(url, log)
    const { texto, titulo, paginas_crawladas, stats, paginas_estruturadas, links_externos_uteis } = r
    const { texto: textoCap, truncado } = truncar(texto)
    if (log) log.info({ fonte_id: fonte.id, len: texto.length, truncado, stats }, 'Site importado')
    const tituloFinal = titulo
      ? `${titulo}${paginas_crawladas > 1 ? ` (+${paginas_crawladas - 1} páginas internas)` : ''}`
      : fonte.titulo

    // Guarda metadados de crawl no resumo_json (mesmo antes da análise IA)
    const meta = {
      crawl_stats: stats,
      paginas_estruturadas: (paginas_estruturadas || []).map((p) => ({
        url: p.url, title: p.title, description: p.description,
        headings: p.headings, buttons: p.buttons, contacts: p.contacts,
      })),
      links_externos_uteis: links_externos_uteis || [],
      url_original: url,
      crawl_truncado: truncado,
      texto_chars: texto.length,
    }

    await pool.query(
      `UPDATE app.empresa_fontes_conhecimento
          SET resumo_json = resumo_json || $2::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [fonte.id, JSON.stringify({ meta })]
    )

    return await atualizarFonteConteudo(pool, fonte.id, {
      conteudo_extraido: textoCap,
      titulo: tituloFinal,
      status: 'pendente',
    })
  } catch (err) {
    return await atualizarFonteConteudo(pool, fonte.id, { status: 'erro', erro: String(err.message || err).slice(0, 800) })
  }
}

async function importarDocumentoEmpresa(pool, log, { empresaId, contextoId, buffer, filename, mimetype }) {
  const tipo = (mimetype || '').toLowerCase().includes('pdf') || (filename || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'documento'
  const fonte = await criarFonteConhecimento(pool, { empresaId, contextoId, tipo, filename, titulo: filename })
  try {
    let texto = ''
    if (tipo === 'pdf') {
      texto = await extrairTextoDePdf(buffer)
    } else {
      texto = String(buffer.toString('utf-8') || '').trim()
    }
    if (!texto || texto.length < 30) throw new Error('Documento sem texto extraível.')
    const { texto: textoCap, truncado } = truncar(texto)
    if (truncado && log) log.info({ fonte_id: fonte.id, len: texto.length }, 'Documento truncado em 30k chars')
    return await atualizarFonteConteudo(pool, fonte.id, {
      conteudo_extraido: textoCap,
      status: 'pendente',
    })
  } catch (err) {
    return await atualizarFonteConteudo(pool, fonte.id, { status: 'erro', erro: String(err.message || err).slice(0, 800) })
  }
}

async function importarTextoManual(pool, _log, { empresaId, contextoId, texto, titulo }) {
  const fonte = await criarFonteConhecimento(pool, { empresaId, contextoId, tipo: 'texto_manual', titulo: titulo || 'Texto manual' })
  const { texto: textoCap } = truncar(String(texto || '').trim())
  if (!textoCap) {
    return await atualizarFonteConteudo(pool, fonte.id, { status: 'erro', erro: 'Texto vazio.' })
  }
  return await atualizarFonteConteudo(pool, fonte.id, { conteudo_extraido: textoCap, status: 'pendente' })
}

// ─── Análise IA por fonte ────────────────────────────────────────────────────

const RESUMO_FONTE_SYSTEM = `Você extrai informações comerciais de uma fonte de conhecimento (site, documento ou texto bruto) de uma empresa para alimentar um agente de atendimento por WhatsApp.

REGRAS DURAS:
- NÃO invente dados. Se a fonte não disser, deixe vazio ou "não encontrado".
- URLs: use APENAS URLs que aparecem literalmente no conteúdo. NUNCA emita example.com, localhost, teste.com, site.com, yoursite.com, sample.com, fake.com, dominio.com. Se não encontrou, deixe vazio.
- Preço: copie como apareceu (ex: "R$ 60/mês", "a partir de R$ 300/ano").
- Serviços: liste cada um com nome e descrição curta.
- Conflitos óbvios (dois preços diferentes pro mesmo serviço): listar em conflitos_ou_duvidas.
- Não consolide com Contexto 1 ainda; só extraia desta fonte.

Retorne APENAS JSON válido neste schema:

{
  "nome_empresa": "",
  "tipo_negocio": "",
  "nicho": "",
  "cidade_regiao": "",
  "como_funciona": "",
  "servicos_produtos": "",
  "precos_planos": "",
  "plano_gratuito": "",
  "publico_alvo": "",
  "cliente_ideal": "",
  "diferenciais": "",
  "diferenciais_competitivos": "",
  "proposta_de_valor": "",
  "problemas_que_resolve": "",
  "tom_de_voz": "",
  "horario_atendimento": "",
  "formas_pagamento": "",
  "objecoes_comuns": "",
  "perguntas_frequentes": "",
  "quando_chamar_humano": "",
  "informacoes_extras": "",
  "contatos": {
    "telefone": "",
    "whatsapp": "",
    "email": "",
    "instagram": "",
    "endereco": ""
  },
  "link_principal": "",
  "link_cadastro": "",
  "link_login": "",
  "links_uteis": [
    { "label": "", "url": "", "tipo": "site|cadastro|login|planos|contato|faq|suporte|outro" }
  ],
  "ctas_principais": [],
  "maquinas_modulos_funcionalidades": [],
  "catalogo_de_ofertas": [
    {
      "nome": "", "categoria": "", "descricao": "", "descricao_completa": "",
      "preco": "", "periodicidade": "", "prazo_texto": "",
      "beneficios": [], "publico": [], "problemas_que_resolve": [],
      "perguntas_qualificacao": [], "quando_oferecer": [],
      "sinais_para_nao_recomendar": [],
      "link_relacionado": ""
    }
  ],
  "conflitos_ou_duvidas": []
}`

async function analisarFonteComIA(pool, log, { empresaId, fonteId }) {
  const { rows: [fonte] } = await pool.query(
    `SELECT * FROM app.empresa_fontes_conhecimento WHERE id = $1 AND empresa_id = $2`,
    [fonteId, empresaId]
  )
  if (!fonte) throw new Error('Fonte não encontrada')
  if (!fonte.conteudo_extraido) {
    await atualizarFonteConteudo(pool, fonteId, { status: 'erro', erro: 'Sem conteúdo extraído pra analisar.' })
    throw new Error('Fonte sem conteúdo extraído.')
  }

  await atualizarFonteConteudo(pool, fonteId, { status: 'analisando', erro: null })

  try {
    // Estrutura pra ajudar a IA: passa metadados extraídos do crawl (headings, buttons, contacts, links)
    const meta = fonte.resumo_json?.meta || {}
    const paginasEstrut = Array.isArray(meta.paginas_estruturadas) ? meta.paginas_estruturadas : []
    const linksExternos = Array.isArray(meta.links_externos_uteis) ? meta.links_externos_uteis : []

    const estruturaResumo = paginasEstrut.length
      ? paginasEstrut.slice(0, 25).map((p) => {
          const parts = [`URL: ${p.url}`]
          if (p.title) parts.push(`TITLE: ${p.title}`)
          if (p.description) parts.push(`META_DESC: ${p.description}`)
          if (p.headings?.length) parts.push(`HEADINGS: ${p.headings.slice(0, 12).join(' | ')}`)
          if (p.buttons?.length) parts.push(`BUTTONS/CTAS: ${p.buttons.slice(0, 15).join(' | ')}`)
          if (p.contacts && Object.keys(p.contacts).length) parts.push(`CONTACTS: ${JSON.stringify(p.contacts)}`)
          return parts.join('\n')
        }).join('\n\n---\n\n')
      : ''

    const linksExternosStr = linksExternos.length
      ? `\n\nLINKS EXTERNOS ÚTEIS (redes sociais, contato):\n${linksExternos.map((l) => `- ${l.tipo || 'externo'}: ${l.url} ${l.anchorText ? '("' + l.anchorText + '")' : ''}`).join('\n')}`
      : ''

    const userPrompt = `FONTE (${fonte.tipo}${fonte.url ? ` — ${fonte.url}` : ''}${fonte.filename ? ` — ${fonte.filename}` : ''}):
${estruturaResumo ? `\nDADOS ESTRUTURADOS POR PÁGINA:\n${estruturaResumo}\n` : ''}${linksExternosStr}

TEXTO BRUTO CONSOLIDADO:
${fonte.conteudo_extraido}

Extraia.`

    const result = await aiProvider.generateAIResponse(
      {
        systemPrompt: RESUMO_FONTE_SYSTEM,
        userPrompt,
        task: 'extractKnowledgeSource',
        maxTokens: 4000,
        timeoutMs: 90000,
        empresaId, refType: 'knowledge_source', refId: fonteId,
      },
      pool, log
    )

    const json = _safeJson(result.text)
    const resumo = _normalizeResumo(json, fonte)

    // Preserva o `meta` (crawl_stats etc.) e injeta o resumo IA por baixo
    const resumoComMeta = { ...resumo, meta }

    const { rows: [updated] } = await pool.query(
      `UPDATE app.empresa_fontes_conhecimento
          SET resumo_json = $2::jsonb,
              status = 'analisado',
              erro = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [fonteId, JSON.stringify(resumoComMeta)]
    )
    return updated
  } catch (err) {
    await atualizarFonteConteudo(pool, fonteId, { status: 'erro', erro: String(err.message || err).slice(0, 800) })
    throw err
  }
}

function _safeJson(text) {
  try { return parsearRespostaJsonClaude(text) || {} } catch (_) { return {} }
}

function _normalizeResumo(j, fonte) {
  const { sanitizarUrl, sanitizarListaLinks, ehUrlFalsa } = require('./url-sanitize')
  const out = {}
  // Campos legados (string)
  for (const c of CONTEXTO1_CAMPOS) out[c] = String((j && j[c]) || '').trim()

  // Campos novos string
  for (const k of ['como_funciona', 'plano_gratuito', 'diferenciais_competitivos', 'proposta_de_valor']) {
    out[k] = String((j && j[k]) || '').trim()
  }

  // URLs — sanitiza e usa URL real da fonte como fallback
  const fonteUrl = fonte && fonte.url ? sanitizarUrl(fonte.url, '') : ''
  out.link_principal = sanitizarUrl(j?.link_principal, fonteUrl)
  out.link_cadastro = sanitizarUrl(j?.link_cadastro, '')
  out.link_login = sanitizarUrl(j?.link_login, '')

  // Contatos: salva object E flatten pra campos top-level (formulário edita strings)
  const contatos = j?.contatos && typeof j.contatos === 'object' ? j.contatos : {}
  out.contatos = {
    telefone: String(contatos.telefone || '').trim(),
    whatsapp: String(contatos.whatsapp || '').trim(),
    email: String(contatos.email || '').trim(),
    instagram: String(contatos.instagram || '').trim(),
    endereco: String(contatos.endereco || '').trim(),
  }
  out.telefone = out.contatos.telefone
  out.whatsapp = out.contatos.whatsapp
  out.email = out.contatos.email
  out.instagram = out.contatos.instagram
  out.endereco = out.contatos.endereco

  // Links úteis estruturados
  out.links_uteis_estruturados = sanitizarListaLinks(j?.links_uteis, '')

  // CTAs
  out.ctas_principais = Array.isArray(j?.ctas_principais)
    ? j.ctas_principais.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 12)
    : []

  // Máquinas/módulos
  out.maquinas_modulos_funcionalidades = Array.isArray(j?.maquinas_modulos_funcionalidades)
    ? j.maquinas_modulos_funcionalidades.map((m) => {
        if (typeof m === 'string') return { nome: m, descricao: '' }
        if (m && typeof m === 'object') return {
          nome: String(m.nome || m.name || '').trim(),
          descricao: String(m.descricao || m.description || '').trim(),
        }
        return null
      }).filter((m) => m && m.nome)
    : []

  // Catálogo de ofertas com link_relacionado sanitizado
  out.catalogo_de_ofertas = Array.isArray(j?.catalogo_de_ofertas)
    ? j.catalogo_de_ofertas
        .filter((x) => x && (x.nome || x.descricao || x.preco))
        .map((x) => ({
          nome: String(x.nome || '').trim(),
          categoria: String(x.categoria || x.tipo || '').trim(),
          descricao: String(x.descricao || '').trim(),
          descricao_completa: String(x.descricao_completa || '').trim(),
          preco: String(x.preco || '').trim(),
          periodicidade: String(x.periodicidade || '').trim(),
          prazo_texto: String(x.prazo_texto || x.prazo || '').trim(),
          beneficios: Array.isArray(x.beneficios) ? x.beneficios.filter(Boolean) : [],
          publico: Array.isArray(x.publico) ? x.publico.filter(Boolean) : [],
          problemas_que_resolve: Array.isArray(x.problemas_que_resolve) ? x.problemas_que_resolve.filter(Boolean) : [],
          perguntas_qualificacao: Array.isArray(x.perguntas_qualificacao) ? x.perguntas_qualificacao.filter(Boolean) : [],
          quando_oferecer: Array.isArray(x.quando_oferecer) ? x.quando_oferecer.filter(Boolean) : [],
          sinais_para_nao_recomendar: Array.isArray(x.sinais_para_nao_recomendar) ? x.sinais_para_nao_recomendar.filter(Boolean) : [],
          link_relacionado: sanitizarUrl(x.link_relacionado, ''),
        }))
    : []

  // Conflitos
  out.conflitos_ou_duvidas = Array.isArray(j?.conflitos_ou_duvidas)
    ? j.conflitos_ou_duvidas.filter(Boolean)
    : []

  out.fontes_utilizadas = [{
    fonte_id: fonte.id,
    tipo: fonte.tipo,
    url: fonteUrl || null,
    filename: fonte.filename || null,
    titulo: fonte.titulo || null,
  }]

  // Se IA esqueceu link_principal mas a fonte é site com URL válida, usar URL da fonte
  if (!out.link_principal && fonteUrl && !ehUrlFalsa(fonteUrl)) {
    out.link_principal = fonteUrl
  }

  return out
}

// ─── Sugestão consolidada de Contexto 1 ──────────────────────────────────────

const SUGESTAO_CTX1_SYSTEM = `Você consolida múltiplas fontes de conhecimento (resumos de site, PDF, texto manual) em um único Contexto 1 (cadastro oficial da empresa).

Regras duras:
- DADOS MANUAIS DO USUÁRIO TÊM PRIORIDADE. Se o Contexto 1 atual já tem valor preenchido num campo, mantenha-o; só preencha campos vazios ou complemente sem sobrescrever.
- Não invente. Se nenhuma fonte tem o dado, deixe vazio.
- URLs: use APENAS URLs presentes nas fontes. NUNCA emita example.com, localhost, teste.com, site.com, yoursite.com, sample.com, fake.com, dominio.com.
- Junte serviços de várias fontes em catalogo_de_ofertas sem duplicar.
- Se houver conflito (ex: dois preços diferentes pro mesmo serviço), NÃO escolha: registre em conflitos_ou_duvidas.
- Diferenciais e tom_de_voz: combine em texto único, sem repetição.
- Liste em fontes_utilizadas todas as fontes consideradas.
- Retorne APENAS JSON válido com o mesmo schema do extrator de fonte (incluindo contatos object, link_principal, link_cadastro, link_login, links_uteis array, ctas_principais, maquinas_modulos_funcionalidades, catalogo_de_ofertas com link_relacionado).`

async function sugerirContexto1APartirDasFontes(pool, log, { empresaId, contextoId, aiProvider: aiProviderArg } = {}) {
  const ai = aiProviderArg || aiProvider
  const { rows: [ctx] } = await pool.query(
    `SELECT id, contexto_form_json FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2`,
    [contextoId, empresaId]
  )
  if (!ctx) throw new Error('Contexto não encontrado')

  const { rows: fontes } = await pool.query(
    `SELECT id, tipo, url, filename, titulo, resumo_json
       FROM app.empresa_fontes_conhecimento
      WHERE empresa_id = $1 AND contexto_id = $2 AND status = 'analisado'
      ORDER BY created_at ASC`,
    [empresaId, contextoId]
  )
  if (!fontes.length) throw new Error('Nenhuma fonte analisada disponível.')

  const userPrompt = `CONTEXTO 1 ATUAL (manual do usuário, prioritário):
${JSON.stringify(ctx.contexto_form_json || {}, null, 2)}

RESUMOS DAS FONTES ANALISADAS:
${fontes.map((f, i) => `--- Fonte ${i + 1} (${f.tipo}${f.url ? ' — ' + f.url : ''}${f.filename ? ' — ' + f.filename : ''}):
${JSON.stringify(f.resumo_json || {}, null, 2)}`).join('\n\n')}

Consolide.`

  const result = await ai.generateAIResponse(
    {
      systemPrompt: SUGESTAO_CTX1_SYSTEM,
      userPrompt,
      task: 'mergeContext1FromSources',
      maxTokens: 3500,
      timeoutMs: 60000,
      empresaId, refType: 'context_merge', refId: contextoId,
    },
    pool, log
  )

  const json = _safeJson(result.text)
  const sugestao = _normalizeResumo(json, { id: null, tipo: 'merge', url: null, filename: null, titulo: null })
  sugestao.fontes_utilizadas = fontes.map((f) => ({
    fonte_id: f.id, tipo: f.tipo, url: f.url || null, filename: f.filename || null, titulo: f.titulo || null,
  }))
  return { sugestao, contexto_atual: ctx.contexto_form_json || {} }
}

// ─── Mesclar sugestão aprovada no Contexto 1 ─────────────────────────────────
// modo: 'merge_preserva_manual' (default) — só preenche campos vazios do contexto atual
//       'sobrescrever' — usa tudo da sugestão (apenas se usuário pedir)
function mesclarSugestaoNoContexto1({ contextoAtual, sugestao, modo = 'merge_preserva_manual' }) {
  const out = { ...(contextoAtual || {}) }
  for (const c of CONTEXTO1_CAMPOS) {
    const atual = String((out[c] || '')).trim()
    const novo = String((sugestao && sugestao[c]) || '').trim()
    if (modo === 'sobrescrever') {
      if (novo) out[c] = novo
    } else {
      if (!atual && novo) out[c] = novo
    }
  }
  return out
}

module.exports = {
  // text helpers
  extrairTextoDeHtml,
  extrairTextoDePdf,
  // sources
  buscarConteudoSite,
  criarFonteConhecimento,
  atualizarFonteConteudo,
  importarLinkEmpresa,
  importarDocumentoEmpresa,
  importarTextoManual,
  analisarFonteComIA,
  descobrirLinksInternosRelevantes,
  extrairConteudoEstruturadoHtml,
  _ehUrlIgnoravel,
  _scoreUrl,
  // context 1 merge
  sugerirContexto1APartirDasFontes,
  mesclarSugestaoNoContexto1,
}
