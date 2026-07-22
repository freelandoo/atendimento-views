'use strict'

const STATUS_REVISAO = new Set(['ia_preencheu', 'revisado', 'precisa_revisao'])
const CONFIANCA = new Set(['baixa', 'media', 'alta'])
const ORIGEM = new Set(['ia', 'manual', 'freelandoo', 'importado'])

function str(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ').trim()
  if (typeof v === 'object') {
    const o = v
    const preferidos = ['nome', 'titulo', 'label', 'descricao', 'description', 'texto', 'valor', 'url']
    const valores = preferidos.map((k) => str(o[k])).filter(Boolean)
    if (valores.length) return [...new Set(valores)].join(' - ').trim()
    return Object.entries(o).map(([k, val]) => `${k}: ${str(val)}`).filter((x) => !x.endsWith(': ')).join(' | ').trim()
  }
  return String(v).trim()
}

function arr(v) {
  if (!v) return []
  const src = Array.isArray(v) ? v : [v]
  return src.map((x) => str(x)).filter(Boolean).slice(0, 20)
}

function slugify(input) {
  const s = str(input)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 80) || 'servico'
}

function pickLinkValido(arrInput) {
  const { ehUrlFalsa } = require('./url-sanitize')
  for (const v of arrInput || []) {
    if (!v) continue
    const matches = String(v).match(/https?:\/\/[^\s)>\]]+/gi) || []
    for (const u of matches) {
      const limpo = u.replace(/[.,;:!?)>\]]+$/, '').trim()
      if (limpo && !ehUrlFalsa(limpo)) return limpo
    }
  }
  return ''
}

function juntarTexto(...partes) {
  return partes.map(str).filter(Boolean).join('\n').trim()
}

function servicoTemLacunas(s) {
  return !s.descricao_curta || (!s.beneficios.length && !s.problemas_que_resolve.length) || (!s.perguntas_qualificacao.length && !s.sinais_para_recomendar.length)
}

function normalizarServico(input = {}, index = 0) {
  const nome = str(input.nome || input.name || input.titulo || input.servico)
  const descricao = str(input.descricao || input.descricao_curta || input.description)
  const preco = str(input.preco_texto || input.preco || input.valor || input.price)
  const prazo = str(input.prazo_texto || input.prazo || input.duracao || input.tempo)
  const link = pickLinkValido([input.link_relacionado, input.link, input.url])
  const out = {
    slug: slugify(input.slug || nome),
    nome,
    categoria: str(input.categoria || input.tipo),
    descricao_curta: str(input.descricao_curta || descricao).slice(0, 700),
    descricao_completa: str(input.descricao_completa || descricao),
    indicado_para: arr(input.indicado_para || input.publico || input.publico_alvo),
    problemas_que_resolve: arr(input.problemas_que_resolve || input.dores || input.problemas),
    beneficios: arr(input.beneficios || input.vantagens),
    perguntas_qualificacao: arr(input.perguntas_qualificacao || input.perguntas || input.perguntas_para_qualificar),
    sinais_para_recomendar: arr(input.sinais_para_recomendar || input.quando_oferecer || input.quando_recomendar),
    sinais_para_nao_recomendar: arr(input.sinais_para_nao_recomendar || input.nao_oferecer_quando),
    preco_texto: preco,
    prazo_texto: prazo,
    link_relacionado: link,
    origem: ORIGEM.has(input.origem) ? input.origem : 'ia',
    fontes_json: Array.isArray(input.fontes_json) ? input.fontes_json : arr(input.fontes).map((fonte) => ({ fonte })),
    conflitos_json: Array.isArray(input.conflitos_json) ? input.conflitos_json : arr(input.conflitos_ou_duvidas || input.conflitos),
    confianca: CONFIANCA.has(input.confianca) ? input.confianca : 'media',
    status_revisao: STATUS_REVISAO.has(input.status_revisao) ? input.status_revisao : 'ia_preencheu',
    ativo: input.ativo === undefined ? true : !!input.ativo,
    ordem: Number.isFinite(Number(input.ordem)) ? Number(input.ordem) : index,
  }
  if (servicoTemLacunas(out) && out.status_revisao !== 'revisado') out.status_revisao = 'precisa_revisao'
  return out.nome ? out : null
}

function fallbackServicosDoTexto(texto) {
  const s = str(texto)
  if (!s) return []
  return s
    .split(/\n|;|,(?!\s*(?:ltda|sa)\b)|\s+ e \s+/i)
    .map((x) => str(x).replace(/^[-*•]\s*/, ''))
    .filter((x) => x.length >= 3 && x.length <= 80)
    .slice(0, 20)
    .map((nome, i) => normalizarServico({ nome, descricao: '', confianca: 'baixa' }, i))
    .filter(Boolean)
}

function catalogoDasFontes(fontes = []) {
  const out = []
  for (const fonte of fontes) {
    const resumo = fonte.resumo_json || {}
    const catalogo = Array.isArray(resumo.catalogo_de_ofertas) ? resumo.catalogo_de_ofertas : []
    const fonteRef = {
      fonte_id: fonte.id || null,
      tipo: fonte.tipo || null,
      url: fonte.url || null,
      filename: fonte.filename || null,
      titulo: fonte.titulo || null,
    }
    for (const item of catalogo) {
      const s = normalizarServico({
        ...item,
        preco_texto: item.preco || item.preco_texto,
        descricao_curta: item.descricao || item.descricao_curta,
        descricao_completa: item.descricao_completa || item.descricao,
        indicado_para: item.publico || item.indicado_para,
        problemas_que_resolve: item.problemas_que_resolve,
        perguntas_qualificacao: item.perguntas_qualificacao,
        sinais_para_recomendar: item.quando_oferecer || item.sinais_para_recomendar,
        sinais_para_nao_recomendar: item.sinais_para_nao_recomendar,
        fontes_json: [fonteRef],
      }, out.length)
      if (s) out.push(s)
    }
  }
  return dedupeServicos(out)
}

function dedupeServicos(servicos = []) {
  const porSlug = new Map()
  for (const raw of servicos) {
    const s = normalizarServico(raw, porSlug.size)
    if (!s) continue
    const prev = porSlug.get(s.slug)
    if (!prev) {
      porSlug.set(s.slug, s)
      continue
    }
    porSlug.set(s.slug, {
      ...prev,
      descricao_curta: prev.descricao_curta || s.descricao_curta,
      descricao_completa: prev.descricao_completa || s.descricao_completa,
      indicado_para: [...new Set([...prev.indicado_para, ...s.indicado_para])],
      problemas_que_resolve: [...new Set([...prev.problemas_que_resolve, ...s.problemas_que_resolve])],
      beneficios: [...new Set([...prev.beneficios, ...s.beneficios])],
      perguntas_qualificacao: [...new Set([...prev.perguntas_qualificacao, ...s.perguntas_qualificacao])],
      sinais_para_recomendar: [...new Set([...prev.sinais_para_recomendar, ...s.sinais_para_recomendar])],
      sinais_para_nao_recomendar: [...new Set([...prev.sinais_para_nao_recomendar, ...s.sinais_para_nao_recomendar])],
      preco_texto: prev.preco_texto || s.preco_texto,
      prazo_texto: prev.prazo_texto || s.prazo_texto,
      link_relacionado: prev.link_relacionado || s.link_relacionado,
      fontes_json: [...(prev.fontes_json || []), ...(s.fontes_json || [])],
      conflitos_json: [...(prev.conflitos_json || []), ...(s.conflitos_json || [])],
      status_revisao: prev.status_revisao === 'precisa_revisao' || s.status_revisao === 'precisa_revisao' ? 'precisa_revisao' : prev.status_revisao,
    })
  }
  return [...porSlug.values()].map((s, i) => ({ ...s, ordem: i }))
}

async function listarServicosContexto(pool, empresaId, contextoId, { somenteAtivos = false } = {}) {
  const params = [empresaId, contextoId]
  const filtroAtivo = somenteAtivos ? 'AND ativo = true' : ''
  const { rows } = await pool.query(
    `SELECT *
       FROM app.contexto_servicos
      WHERE empresa_id = $1 AND contexto_id = $2 ${filtroAtivo}
      ORDER BY ativo DESC, ordem ASC, nome ASC`,
    params
  )
  return rows
}

function valoresPersistencia(s) {
  return [
    s.slug, s.nome, s.categoria, s.descricao_curta, s.descricao_completa,
    JSON.stringify(s.indicado_para), JSON.stringify(s.problemas_que_resolve),
    JSON.stringify(s.beneficios), JSON.stringify(s.perguntas_qualificacao),
    JSON.stringify(s.sinais_para_recomendar), JSON.stringify(s.sinais_para_nao_recomendar),
    s.preco_texto, s.prazo_texto, s.link_relacionado, s.origem,
    JSON.stringify(s.fontes_json || []), JSON.stringify(s.conflitos_json || []),
    s.confianca, s.status_revisao, s.ativo, s.ordem,
  ]
}

async function salvarCatalogoGerado(pool, empresaId, contextoId, servicos) {
  const normalizados = dedupeServicos(servicos)
  if (!normalizados.length) return await listarServicosContexto(pool, empresaId, contextoId)

  const existentes = await listarServicosContexto(pool, empresaId, contextoId)
  const porSlug = new Map(existentes.map((s) => [s.slug, s]))

  for (const s of normalizados) {
    const atual = porSlug.get(s.slug)
    if (!atual) {
      await pool.query(
        `INSERT INTO app.contexto_servicos
          (empresa_id, contexto_id, slug, nome, categoria, descricao_curta, descricao_completa,
           indicado_para, problemas_que_resolve, beneficios, perguntas_qualificacao,
           sinais_para_recomendar, sinais_para_nao_recomendar, preco_texto, prazo_texto,
           link_relacionado, origem, fontes_json, conflitos_json, confianca, status_revisao,
           ativo, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
                 $12::jsonb,$13::jsonb,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23)
         ON CONFLICT (contexto_id, slug) DO NOTHING`,
        [empresaId, contextoId, ...valoresPersistencia(s)]
      )
      continue
    }

    if (atual.status_revisao === 'revisado') {
      await pool.query(
        `UPDATE app.contexto_servicos
            SET fontes_json = COALESCE(fontes_json, '[]'::jsonb) || $3::jsonb,
                conflitos_json = COALESCE(conflitos_json, '[]'::jsonb) || $4::jsonb,
                atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2`,
        [atual.id, empresaId, JSON.stringify(s.fontes_json || []), JSON.stringify(s.conflitos_json || [])]
      )
      continue
    }

    const merged = normalizarServico({
      ...s,
      nome: atual.nome || s.nome,
      categoria: atual.categoria || s.categoria,
      descricao_curta: s.descricao_curta || atual.descricao_curta,
      descricao_completa: s.descricao_completa || atual.descricao_completa,
      indicado_para: [...arr(atual.indicado_para), ...s.indicado_para],
      problemas_que_resolve: [...arr(atual.problemas_que_resolve), ...s.problemas_que_resolve],
      beneficios: [...arr(atual.beneficios), ...s.beneficios],
      perguntas_qualificacao: [...arr(atual.perguntas_qualificacao), ...s.perguntas_qualificacao],
      sinais_para_recomendar: [...arr(atual.sinais_para_recomendar), ...s.sinais_para_recomendar],
      sinais_para_nao_recomendar: [...arr(atual.sinais_para_nao_recomendar), ...s.sinais_para_nao_recomendar],
      preco_texto: s.preco_texto || atual.preco_texto,
      prazo_texto: s.prazo_texto || atual.prazo_texto,
      link_relacionado: s.link_relacionado || atual.link_relacionado,
      fontes_json: [...(Array.isArray(atual.fontes_json) ? atual.fontes_json : []), ...(s.fontes_json || [])],
      conflitos_json: [...(Array.isArray(atual.conflitos_json) ? atual.conflitos_json : []), ...(s.conflitos_json || [])],
      ativo: atual.ativo,
      ordem: atual.ordem,
    }, atual.ordem)

    await pool.query(
      `UPDATE app.contexto_servicos
          SET nome = $3, categoria = $4, descricao_curta = $5, descricao_completa = $6,
              indicado_para = $7::jsonb, problemas_que_resolve = $8::jsonb,
              beneficios = $9::jsonb, perguntas_qualificacao = $10::jsonb,
              sinais_para_recomendar = $11::jsonb, sinais_para_nao_recomendar = $12::jsonb,
              preco_texto = $13, prazo_texto = $14, link_relacionado = $15,
              fontes_json = $16::jsonb, conflitos_json = $17::jsonb,
              confianca = $18, status_revisao = $19, ativo = $20,
              atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2`,
      [
        atual.id, empresaId, merged.nome, merged.categoria, merged.descricao_curta,
        merged.descricao_completa, JSON.stringify([...new Set(merged.indicado_para)]),
        JSON.stringify([...new Set(merged.problemas_que_resolve)]), JSON.stringify([...new Set(merged.beneficios)]),
        JSON.stringify([...new Set(merged.perguntas_qualificacao)]), JSON.stringify([...new Set(merged.sinais_para_recomendar)]),
        JSON.stringify([...new Set(merged.sinais_para_nao_recomendar)]), merged.preco_texto,
        merged.prazo_texto, merged.link_relacionado, JSON.stringify(merged.fontes_json || []),
        JSON.stringify(merged.conflitos_json || []), merged.confianca, merged.status_revisao,
        merged.ativo,
      ]
    )
  }

  return await listarServicosContexto(pool, empresaId, contextoId)
}

async function gerarServicosDoContexto({ pool, empresaId, contextoId, contexto1 }) {
  let contextoBase = contexto1
  if (!contextoBase || typeof contextoBase !== 'object' || Object.keys(contextoBase).length === 0) {
    const { rows: [ctx] } = await pool.query(
      `SELECT contexto_form_json FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2`,
      [contextoId, empresaId]
    )
    contextoBase = ctx?.contexto_form_json || {}
  }
  const { rows: fontes } = await pool.query(
    `SELECT id, tipo, url, filename, titulo, resumo_json
       FROM app.empresa_fontes_conhecimento
      WHERE empresa_id = $1 AND contexto_id = $2 AND status = 'analisado'
      ORDER BY created_at ASC`,
    [empresaId, contextoId]
  )
  let servicos = catalogoDasFontes(fontes)
  if (!servicos.length) servicos = fallbackServicosDoTexto(contextoBase?.servicos_produtos)
  return await salvarCatalogoGerado(pool, empresaId, contextoId, servicos)
}

async function atualizarServicoContexto(pool, empresaId, contextoId, servicoId, patch) {
  const s = normalizarServico({ ...(patch || {}), status_revisao: patch?.status_revisao || 'revisado' })
  if (!s) throw new Error('Servico invalido')
  const { rows: [row] } = await pool.query(
    `UPDATE app.contexto_servicos
        SET slug = $4, nome = $5, categoria = $6, descricao_curta = $7,
            descricao_completa = $8, indicado_para = $9::jsonb,
            problemas_que_resolve = $10::jsonb, beneficios = $11::jsonb,
            perguntas_qualificacao = $12::jsonb, sinais_para_recomendar = $13::jsonb,
            sinais_para_nao_recomendar = $14::jsonb, preco_texto = $15,
            prazo_texto = $16, link_relacionado = $17, origem = $18,
            conflitos_json = $19::jsonb, confianca = $20, status_revisao = $21,
            ativo = $22, ordem = $23, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND contexto_id = $3
      RETURNING *`,
    [
      servicoId, empresaId, contextoId, s.slug, s.nome, s.categoria,
      s.descricao_curta, s.descricao_completa, JSON.stringify(s.indicado_para),
      JSON.stringify(s.problemas_que_resolve), JSON.stringify(s.beneficios),
      JSON.stringify(s.perguntas_qualificacao), JSON.stringify(s.sinais_para_recomendar),
      JSON.stringify(s.sinais_para_nao_recomendar), s.preco_texto, s.prazo_texto,
      s.link_relacionado, patch?.origem && ORIGEM.has(patch.origem) ? patch.origem : 'manual',
      JSON.stringify(s.conflitos_json || []), s.confianca, s.status_revisao,
      s.ativo, s.ordem,
    ]
  )
  return row || null
}

async function criarServicoContexto(pool, empresaId, contextoId, input) {
  const s = normalizarServico({ ...(input || {}), origem: 'manual', status_revisao: 'revisado' })
  if (!s) throw new Error('Servico invalido')
  const { rows: [row] } = await pool.query(
    `INSERT INTO app.contexto_servicos
      (empresa_id, contexto_id, slug, nome, categoria, descricao_curta, descricao_completa,
       indicado_para, problemas_que_resolve, beneficios, perguntas_qualificacao,
       sinais_para_recomendar, sinais_para_nao_recomendar, preco_texto, prazo_texto,
       link_relacionado, origem, fontes_json, conflitos_json, confianca, status_revisao,
       ativo, ordem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
             $12::jsonb,$13::jsonb,$14,$15,$16,'manual','[]'::jsonb,$17::jsonb,$18,$19,$20,$21)
     ON CONFLICT (contexto_id, slug) DO UPDATE SET
       nome = EXCLUDED.nome,
       atualizado_em = NOW()
     RETURNING *`,
    [
      empresaId, contextoId, s.slug, s.nome, s.categoria, s.descricao_curta,
      s.descricao_completa, JSON.stringify(s.indicado_para),
      JSON.stringify(s.problemas_que_resolve), JSON.stringify(s.beneficios),
      JSON.stringify(s.perguntas_qualificacao), JSON.stringify(s.sinais_para_recomendar),
      JSON.stringify(s.sinais_para_nao_recomendar), s.preco_texto, s.prazo_texto,
      s.link_relacionado, JSON.stringify(s.conflitos_json || []), s.confianca,
      s.status_revisao, s.ativo, s.ordem,
    ]
  )
  return row
}

function servicosParaPlaybook(servicos = []) {
  return servicos
    .filter((s) => s && s.ativo !== false)
    .map((s) => ({
      id: s.id || null,
      slug: s.slug,
      nome: s.nome,
      categoria: s.categoria || '',
      descricao_curta: s.descricao_curta || '',
      descricao_completa: s.descricao_completa || '',
      indicado_para: arr(s.indicado_para),
      problemas_que_resolve: arr(s.problemas_que_resolve),
      beneficios: arr(s.beneficios),
      perguntas_qualificacao: arr(s.perguntas_qualificacao),
      sinais_para_recomendar: arr(s.sinais_para_recomendar),
      sinais_para_nao_recomendar: arr(s.sinais_para_nao_recomendar),
      preco_texto: s.preco_texto || '',
      prazo_texto: s.prazo_texto || '',
      link_relacionado: s.link_relacionado || '',
      status_revisao: s.status_revisao || 'ia_preencheu',
      confianca: s.confianca || 'media',
    }))
}

function resumoServicosParaTexto(servicos = []) {
  return servicosParaPlaybook(servicos).map((s) => {
    const detalhes = [
      s.descricao_curta,
      s.preco_texto ? `Preco: ${s.preco_texto}` : '',
      s.prazo_texto ? `Prazo: ${s.prazo_texto}` : '',
      s.beneficios.length ? `Beneficios: ${s.beneficios.join(', ')}` : '',
      s.indicado_para.length ? `Indicado para: ${s.indicado_para.join(', ')}` : '',
      s.sinais_para_recomendar.length ? `Quando recomendar: ${s.sinais_para_recomendar.join(', ')}` : '',
    ].filter(Boolean).join(' | ')
    return `- ${s.nome}${detalhes ? `: ${detalhes}` : ''}`
  }).join('\n')
}

module.exports = {
  normalizarServico,
  dedupeServicos,
  fallbackServicosDoTexto,
  catalogoDasFontes,
  listarServicosContexto,
  salvarCatalogoGerado,
  gerarServicosDoContexto,
  atualizarServicoContexto,
  criarServicoContexto,
  servicosParaPlaybook,
  resumoServicosParaTexto,
  slugify,
}
