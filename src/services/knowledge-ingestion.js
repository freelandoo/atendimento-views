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
const MAX_PAGINAS_CRAWL = 6  // raiz + até 5 internas
const PAGINAS_PRIORIDADE = [
  /(quem[-\s]somos|sobre|about)/i,
  /(planos?|pre[çc]os?|pricing)/i,
  /(como[-\s]funciona|funcionalidades|features|servi[cç]os)/i,
  /(faq|d[uú]vidas|ajuda|help|suporte|support)/i,
  /(cadastr|sign[-\s]?up|registr|criar[-\s]?conta)/i,
  /(termos|privacidade|terms|privacy)/i,
  /(contato|contact|fale[-\s]?conosco)/i,
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

async function _buscarPaginaUnica(url, log) {
  // 1. Jina Reader: renderiza JS e devolve markdown limpo. Sem auth.
  try {
    const r = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: JINA_TIMEOUT_MS,
      headers: { 'X-Return-Format': 'markdown' },
      maxContentLength: 5 * 1024 * 1024,
      responseType: 'text',
    })
    const md = String(r.data || '').trim()
    if (md.length > 200) {
      return { texto: md, fonte_render: 'jina', titulo: extrairTituloDeMarkdown(md), html: null }
    }
  } catch (err) {
    if (log) log.warn({ url, err: err.message }, 'Jina falhou, tentando fallback HTML')
  }

  // 2. Fallback: GET cru via cheerio.
  const r = await axios.get(url, {
    timeout: HTTP_TIMEOUT_MS,
    maxContentLength: 5 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PJCodeworksBot/1.0)' },
    responseType: 'text',
  })
  const texto = extrairTextoDeHtml(r.data)
  if (!texto || texto.length < 100) throw new Error('Página sem conteúdo útil.')
  const $ = cheerio.load(r.data)
  return { texto, fonte_render: 'cheerio', titulo: $('title').first().text().trim() || null, html: r.data }
}

// Extrai links internos de uma página (HTML ou markdown), prioriza páginas comerciais.
function _extrairLinksInternos({ html, markdown, baseUrl }) {
  const base = new URL(baseUrl)
  const set = new Set()

  if (html) {
    const $ = cheerio.load(html)
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      try {
        const abs = new URL(href, baseUrl)
        if (abs.host !== base.host) return
        if (abs.hash) abs.hash = ''
        if (abs.href !== baseUrl) set.add(abs.href.replace(/\/$/, ''))
      } catch (_) { /* skip */ }
    })
  }
  if (markdown) {
    const re = /\]\((https?:\/\/[^)]+)\)/g
    let m
    while ((m = re.exec(markdown))) {
      try {
        const abs = new URL(m[1])
        if (abs.host !== base.host) continue
        if (abs.hash) abs.hash = ''
        if (abs.href !== baseUrl) set.add(abs.href.replace(/\/$/, ''))
      } catch (_) { /* skip */ }
    }
  }

  const todos = [...set]
  const prioritarios = []
  const restantes = []
  for (const u of todos) {
    if (PAGINAS_PRIORIDADE.some((rx) => rx.test(u))) prioritarios.push(u)
    else restantes.push(u)
  }
  return [...prioritarios, ...restantes]
}

async function buscarConteudoSite(url, log) {
  const safeUrl = String(url || '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//i.test(safeUrl)) throw new Error('URL inválida (precisa começar com http:// ou https://)')

  // 1. Raiz
  const principal = await _buscarPaginaUnica(safeUrl, log)
  const partes = [`# ${principal.titulo || safeUrl}\n\n${principal.texto}`]
  const visitadas = new Set([safeUrl])

  // 2. Coleta links internos prioritários (rodapé, sobre, planos, faq, etc.)
  const candidatos = _extrairLinksInternos({
    html: principal.html,
    markdown: principal.fonte_render === 'jina' ? principal.texto : null,
    baseUrl: safeUrl,
  })
    .filter((u) => !visitadas.has(u))
    .slice(0, MAX_PAGINAS_CRAWL - 1)

  if (log) log.info({ url: safeUrl, candidatos: candidatos.length, prioritarios: candidatos.slice(0, 3) }, 'Crawl de páginas internas')

  // 3. Crawl em paralelo (com limite). Falhas individuais são silenciosas.
  const resultados = await Promise.allSettled(
    candidatos.map((u) => _buscarPaginaUnica(u, log).then((r) => ({ url: u, ...r })))
  )
  for (const r of resultados) {
    if (r.status === 'fulfilled' && r.value?.texto && r.value.texto.length > 200) {
      partes.push(`\n\n---\n\n## ${r.value.titulo || r.value.url}\n[${r.value.url}]\n\n${r.value.texto}`)
      visitadas.add(r.value.url)
    }
  }

  return {
    texto: partes.join(''),
    fonte_render: principal.fonte_render,
    titulo: principal.titulo,
    paginas_crawladas: visitadas.size,
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
    const { texto, titulo, paginas_crawladas } = await buscarConteudoSite(url, log)
    const { texto: textoCap, truncado } = truncar(texto)
    if (log) log.info({ fonte_id: fonte.id, len: texto.length, truncado, paginas_crawladas }, 'Site importado')
    const tituloFinal = titulo
      ? `${titulo}${paginas_crawladas > 1 ? ` (+${paginas_crawladas - 1} páginas internas)` : ''}`
      : fonte.titulo
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

Regras:
- NÃO invente dados. Se a fonte não disser, deixe vazio.
- Não consolide ainda; só extraia o que está nesta fonte.
- Para preço, use o que estiver escrito (ex: "R$ 60/mês", "a partir de R$ 300/ano").
- Para serviços, liste cada um com nome e descrição curta.
- Identifique conflitos óbvios (ex: dois preços diferentes para o mesmo serviço).
- Retorne APENAS JSON válido neste schema:

{
  "nome_empresa": "",
  "tipo_negocio": "",
  "nicho": "",
  "cidade_regiao": "",
  "servicos_produtos": "",
  "precos_planos": "",
  "publico_alvo": "",
  "cliente_ideal": "",
  "diferenciais": "",
  "problemas_que_resolve": "",
  "tom_de_voz": "",
  "horario_atendimento": "",
  "formas_pagamento": "",
  "objecoes_comuns": "",
  "perguntas_frequentes": "",
  "quando_chamar_humano": "",
  "links_uteis": "",
  "informacoes_extras": "",
  "catalogo_de_ofertas": [
    { "nome": "", "descricao": "", "preco": "", "beneficios": [], "publico": [], "quando_oferecer": [] }
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
    const userPrompt = `FONTE (${fonte.tipo}${fonte.url ? ` — ${fonte.url}` : ''}${fonte.filename ? ` — ${fonte.filename}` : ''}):

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

    const { rows: [updated] } = await pool.query(
      `UPDATE app.empresa_fontes_conhecimento
          SET resumo_json = $2::jsonb,
              status = 'analisado',
              erro = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [fonteId, JSON.stringify(resumo)]
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
  const out = {}
  for (const c of CONTEXTO1_CAMPOS) out[c] = String((j && j[c]) || '').trim()
  out.catalogo_de_ofertas = Array.isArray(j?.catalogo_de_ofertas)
    ? j.catalogo_de_ofertas.filter((x) => x && (x.nome || x.descricao || x.preco))
    : []
  out.conflitos_ou_duvidas = Array.isArray(j?.conflitos_ou_duvidas) ? j.conflitos_ou_duvidas.filter(Boolean) : []
  out.fontes_utilizadas = [{
    fonte_id: fonte.id,
    tipo: fonte.tipo,
    url: fonte.url || null,
    filename: fonte.filename || null,
    titulo: fonte.titulo || null,
  }]
  return out
}

// ─── Sugestão consolidada de Contexto 1 ──────────────────────────────────────

const SUGESTAO_CTX1_SYSTEM = `Você consolida múltiplas fontes de conhecimento (resumos de site, PDF, texto manual) em um único Contexto 1 (cadastro oficial da empresa).

Regras:
- DADOS MANUAIS DO USUÁRIO TÊM PRIORIDADE. Se o Contexto 1 atual já tem valor preenchido num campo, mantenha-o; só preencha campos vazios ou complemente sem sobrescrever.
- Não invente. Se nenhuma fonte tem o dado, deixe vazio.
- Junte serviços de várias fontes em catalogo_de_ofertas sem duplicar.
- Se houver conflito (ex: dois preços diferentes pro mesmo serviço), NÃO escolha: registre em conflitos_ou_duvidas.
- Diferenciais e tom_de_voz: combine em texto único, sem repetição.
- Liste em fontes_utilizadas todas as fontes consideradas.
- Retorne APENAS JSON válido com o mesmo schema do extrator de fonte.`

async function sugerirContexto1APartirDasFontes(pool, log, { empresaId, contextoId }) {
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

  const result = await aiProvider.generateAIResponse(
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
  // context 1 merge
  sugerirContexto1APartirDasFontes,
  mesclarSugestaoNoContexto1,
}
