'use strict'

const axios = require('axios')
const { pool } = require('./db')
const aiProvider = require('./ai-provider')
const { enviarMensagem } = require('./whatsapp')
const { logger } = require('./logger')
const { dashboardAutorizado: dashboardSessionAutorizado } = require('./dashboardAuth')
const {
  TIMEZONE,
  adicionarDiasLocalEmTimezone,
  isoDateBrasil,
  parseDataHoraSaoPaulo,
  partesDataEmTimezone,
  partesDataBrasil,
  timezoneOperacional,
} = require('./date-utils')
const {
  normalizarDiagnosticoPersistido,
  normalizarProspectPersistido,
  validarJobQueuePayload,
  validarProspectInput,
} = require('./domainSchemas')

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const DEFAULT_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'places.types',
].join(',')

function dashboardAutorizado(req) {
  if (dashboardSessionAutorizado(req)) return true
  const secret = String(process.env.REPROCESS_SECRET || '').trim()
  if (!secret) return false
  const header = String(req.headers['x-reprocess-secret'] || '').trim()
  return header && header === secret
}

function normalizarTexto(v, max = 120) {
  return String(v == null ? '' : v).trim().slice(0, max)
}

function normalizarInteiro(v, fallback, min, max) {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(n, max))
}

function normalizarQuantidade(v) {
  return normalizarInteiro(v, 10, 1, 20)
}

function normalizarOrigem(v) {
  const origem = String(v || '').trim().toLowerCase()
  return origem === 'automatico' ? 'automatico' : 'manual'
}

function normalizarOrigemFiltro(v) {
  const origem = String(v || '').trim().toLowerCase()
  if (!origem) return ''
  return origem === 'automatico' ? 'automatico' : 'manual'
}

function normalizarStatusProspect(v) {
  const status = String(v || '').trim().toLowerCase()
  return ['aguardando', 'aprovado', 'rejeitado', 'enviado', 'respondeu'].includes(status)
    ? status
    : ''
}

function normalizarCategoria(v) {
  return normalizarTexto(v, 160)
}

function normalizarModoProspeccao(v) {
  const modo = String(v == null ? '' : v).trim().toLowerCase()
  if (['manual', 'semi_automatico', 'automatico'].includes(modo)) return modo
  return 'manual'
}

function normalizarConfiguracaoAutoProspeccao(input = {}) {
  const categoria = normalizarCategoria(input.categoria)
  return {
    enabled: !!input.enabled,
    modo: normalizarModoProspeccao(input.modo),
    rodada_diaria: input.rodada_diaria === undefined ? true : !!input.rodada_diaria,
    weekday: normalizarInteiro(input.weekday, 1, 0, 6),
    hour: normalizarInteiro(input.hour, 9, 0, 23),
    minute: normalizarInteiro(input.minute, 0, 0, 59),
    limit: normalizarInteiro(input.limit, 40, 1, 200),
    intervalo_envio_minutos: normalizarInteiro(input.intervalo_envio_minutos, 30, 5, 1440),
    categoria: categoria || null,
  }
}

function configAutoProspeccaoPersistida(row) {
  if (!row) return null
  return {
    enabled: !!row.enabled,
    modo: normalizarModoProspeccao(row.modo),
    rodada_diaria: row.rodada_diaria !== false,
    weekday: Number(row.weekday || 1),
    hour: Number(row.hour || 9),
    minute: Number(row.minute || 0),
    limit: Number(row.weekly_limit || 40),
    intervalo_envio_minutos: Number(row.intervalo_envio_minutos || 30),
    categoria: row.categoria || null,
    last_enqueued_window_start: row.last_enqueued_window_start || null,
    last_enqueued_date: row.last_enqueued_date || null,
    last_enqueued_at: row.last_enqueued_at || null,
    weekly_sent: Number(row.weekly_sent || 0),
    weekly_sent_reset_date: row.weekly_sent_reset_date || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

function obterJanelaSemanal(cfg = {}, now = new Date()) {
  const weekday = normalizarInteiro(cfg.weekday, 1, 0, 6)
  const hour = normalizarInteiro(cfg.hour, 9, 0, 23)
  const minute = normalizarInteiro(cfg.minute, 0, 0, 59)
  const tz = String(process.env.AUTO_PROSPECCAO_TIMEZONE || timezoneOperacional() || TIMEZONE).trim()
  const agora = now instanceof Date ? now : new Date(now)
  const partes = partesDataEmTimezone(agora, tz)
  const atual = partesDataBrasil(agora).weekday
  const diff = (atual - weekday + 7) % 7
  let diaInicio = adicionarDiasLocalEmTimezone({ year: partes.year, month: partes.month, day: partes.day }, -diff)
  let inicio = parseDataHoraSaoPaulo(`${diaInicio.year}-${String(diaInicio.month).padStart(2, '0')}-${String(diaInicio.day).padStart(2, '0')}`, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  if (inicio > agora) {
    diaInicio = adicionarDiasLocalEmTimezone(diaInicio, -7)
    inicio = parseDataHoraSaoPaulo(`${diaInicio.year}-${String(diaInicio.month).padStart(2, '0')}-${String(diaInicio.day).padStart(2, '0')}`, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }
  const diaFim = adicionarDiasLocalEmTimezone(diaInicio, 7)
  const fim = parseDataHoraSaoPaulo(`${diaFim.year}-${String(diaFim.month).padStart(2, '0')}-${String(diaFim.day).padStart(2, '0')}`, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  return { inicio, fim }
}

function obterJanelaDiaria(cfg = {}, now = new Date()) {
  const hour = normalizarInteiro(cfg.hour, 9, 0, 23)
  const minute = normalizarInteiro(cfg.minute, 0, 0, 59)
  const agora = now instanceof Date ? now : new Date(now)
  const dataStr = isoDateBrasil(agora)
  const inicio = parseDataHoraSaoPaulo(dataStr, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  return { inicio, dataStr }
}

function calcularLimiteDiario(cfg = {}, now = new Date()) {
  const semanal = cfg.limit || 40
  const agora = now instanceof Date ? now : new Date(now)
  const diaSemana = partesDataBrasil(agora).weekday
  const diasUteisRestantes = [1, 2, 3, 4, 5].filter((d) => d >= diaSemana).length || 1
  const jaEnviado = cfg.weekly_sent || 0
  const restante = Math.max(0, semanal - jaEnviado)
  return Math.ceil(restante / diasUteisRestantes)
}

/** Dados para o painel. */
function montarAgendaPainelAutoProspeccao(config, now = new Date()) {
  if (!config) return null
  const agora = now instanceof Date ? now : new Date(now)
  const timezone = String(process.env.AUTO_PROSPECCAO_TIMEZONE || process.env.TZ || '').trim() || null
  if (config.rodada_diaria) {
    const { inicio, dataStr } = obterJanelaDiaria(config, agora)
    const dentro = agora >= inicio
    return {
      timezone,
      modo_diario: true,
      data_hoje: dataStr,
      horario_inicio: inicio.toISOString(),
      dentro_da_janela_enfileiramento: dentro,
    }
  }
  const janela = obterJanelaSemanal(config, agora)
  const dentro = agora >= janela.inicio && agora < janela.fim
  return {
    timezone,
    modo_diario: false,
    janela_inicio: janela.inicio.toISOString(),
    janela_fim: janela.fim.toISOString(),
    dentro_da_janela_enfileiramento: dentro,
  }
}

function normalizarTelefone(v) {
  return String(v == null ? '' : v).replace(/\D/g, '')
}

function normalizarArrayIds(v) {
  if (!Array.isArray(v)) return []
  return v.map((id) => normalizarId(id)).filter(Boolean)
}

function normalizarId(v) {
  return String(v == null ? '' : v).trim()
}

function textoDisplayName(displayName) {
  if (!displayName) return ''
  if (typeof displayName === 'string') return displayName
  return displayName.text || ''
}

function textoPrimaryType(primaryTypeDisplayName) {
  if (!primaryTypeDisplayName) return ''
  if (typeof primaryTypeDisplayName === 'string') return primaryTypeDisplayName
  return primaryTypeDisplayName.text || ''
}

function calcularScoreProspect(place) {
  let score = 50
  const rating = Number(place.rating || 0)
  const reviews = Number(place.userRatingCount || 0)
  const temSite = !!place.websiteUri
  const temTelefone = !!(place.internationalPhoneNumber || place.nationalPhoneNumber)

  if (!temSite) score += 22
  if (temTelefone) score += 10
  if (rating >= 4.3) score += 8
  if (reviews >= 20) score += 6
  if (reviews >= 100) score += 4
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') score -= 30

  return Math.max(0, Math.min(100, score))
}

function motivoScore(place) {
  const partes = []
  if (!place.websiteUri) partes.push('sem site visivel')
  if (place.rating) partes.push(`nota ${place.rating}`)
  if (place.userRatingCount) partes.push(`${place.userRatingCount} reviews`)
  if (place.internationalPhoneNumber || place.nationalPhoneNumber) partes.push('telefone disponivel')
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') partes.push('status nao operacional')
  return partes.join(' | ') || 'dados basicos encontrados'
}

function mapearPlace(place) {
  return {
    place_id: place.id || '',
    nome: textoDisplayName(place.displayName),
    endereco: place.formattedAddress || '',
    telefone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
    site: place.websiteUri || '',
    maps_url: place.googleMapsUri || '',
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? null,
    status: place.businessStatus || '',
    categoria: textoPrimaryType(place.primaryTypeDisplayName),
    tipos: Array.isArray(place.types) ? place.types : [],
    score: calcularScoreProspect(place),
    motivo_score: motivoScore(place),
    tem_site: !!place.websiteUri,
    raw_json: place && typeof place === 'object' ? place : {},
  }
}

function prospectPersistido(row) {
  return normalizarProspectPersistido(row)
}

function diagnosticoPersistido(row) {
  return normalizarDiagnosticoPersistido(row)
}

function normalizarProspectParaPersistencia(prospect, contexto = {}) {
  const schema = validarProspectInput(prospect, contexto)
  const pIn = schema.value.prospect
  const ctx = schema.value.contexto
  const nicho = normalizarTexto(ctx.nicho || pIn.nicho, 160)
  const cidade = normalizarTexto(ctx.cidade || ctx.local || pIn.cidade, 160)
  const placeId = normalizarTexto(pIn.place_id, 240)
  const nome = normalizarTexto(pIn.nome, 240)
  if (!placeId || !nome || !nicho || !cidade) return null
  return {
    nome,
    telefone: normalizarTexto(pIn.telefone, 80) || null,
    nicho,
    cidade,
    endereco: normalizarTexto(pIn.endereco, 500) || null,
    avaliacoes: pIn.reviews == null ? null : parseInt(pIn.reviews, 10),
    rating: pIn.rating == null ? null : Number(pIn.rating),
    tem_site: !!(pIn.tem_site || pIn.site),
    site: normalizarTexto(pIn.site, 500) || null,
    maps_url: normalizarTexto(pIn.maps_url, 500) || null,
    place_id: placeId,
    origem: normalizarOrigem(ctx.origem),
    score: pIn.score == null ? null : parseInt(pIn.score, 10),
    motivo_score: normalizarTexto(pIn.motivo_score, 1000) || null,
    raw_json: pIn.raw_json && typeof pIn.raw_json === 'object' ? pIn.raw_json : {},
  }
}

async function salvarProspect(prospect, contexto = {}) {
  const p = normalizarProspectParaPersistencia(prospect, contexto)
  if (!p) return null
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospects (
      nome, telefone, nicho, cidade, endereco, avaliacoes, rating, tem_site,
      site, maps_url, place_id, origem, score, motivo_score, raw_json
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15::jsonb
    )
    ON CONFLICT (place_id) DO UPDATE
    SET nome = EXCLUDED.nome,
        telefone = COALESCE(EXCLUDED.telefone, prospectador.prospects.telefone),
        nicho = EXCLUDED.nicho,
        cidade = EXCLUDED.cidade,
        endereco = COALESCE(EXCLUDED.endereco, prospectador.prospects.endereco),
        avaliacoes = COALESCE(EXCLUDED.avaliacoes, prospectador.prospects.avaliacoes),
        rating = COALESCE(EXCLUDED.rating, prospectador.prospects.rating),
        tem_site = EXCLUDED.tem_site,
        site = COALESCE(EXCLUDED.site, prospectador.prospects.site),
        maps_url = COALESCE(EXCLUDED.maps_url, prospectador.prospects.maps_url),
        origem = CASE
          WHEN prospectador.prospects.origem = 'automatico' THEN prospectador.prospects.origem
          ELSE EXCLUDED.origem
        END,
        score = COALESCE(EXCLUDED.score, prospectador.prospects.score),
        motivo_score = COALESCE(EXCLUDED.motivo_score, prospectador.prospects.motivo_score),
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
    RETURNING *
    `,
    [
      p.nome,
      p.telefone,
      p.nicho,
      p.cidade,
      p.endereco,
      Number.isFinite(p.avaliacoes) ? p.avaliacoes : null,
      Number.isFinite(p.rating) ? p.rating : null,
      p.tem_site,
      p.site,
      p.maps_url,
      p.place_id,
      p.origem,
      Number.isFinite(p.score) ? p.score : null,
      p.motivo_score,
      JSON.stringify(p.raw_json),
    ]
  )
  return prospectPersistido(rows[0])
}

async function salvarProspects(prospects, contexto = {}) {
  const salvos = []
  for (const prospect of Array.isArray(prospects) ? prospects : []) {
    const salvo = await salvarProspect(prospect, contexto)
    if (salvo) salvos.push(salvo)
  }
  return salvos
}

async function listarProspects(filtros = {}) {
  const where = []
  const params = []
  const status = normalizarStatusProspect(filtros.status)
  const nicho = normalizarTexto(filtros.nicho, 160)
  const cidade = normalizarTexto(filtros.cidade || filtros.local, 160)
  const busca = normalizarTexto(filtros.busca, 160)
  if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (nicho) {
    params.push(`%${nicho}%`)
    where.push(`nicho ILIKE $${params.length}`)
  }
  if (cidade) {
    params.push(`%${cidade}%`)
    where.push(`cidade ILIKE $${params.length}`)
  }
  if (busca) {
    params.push(`%${busca}%`)
    where.push(`(nome ILIKE $${params.length} OR telefone ILIKE $${params.length} OR endereco ILIKE $${params.length})`)
  }
  const origem = normalizarOrigemFiltro(filtros.origem)
  if (origem) {
    params.push(origem)
    where.push(`origem = $${params.length}`)
  }
  const limit = Math.min(Math.max(parseInt(filtros.limit, 10) || 80, 1), 200)
  params.push(limit)
  const { rows } = await pool.query(
    `
    SELECT p.*,
      (
        SELECT jsonb_build_object(
          'id', d.id,
          'prospect_id', d.prospect_id,
          'dor_principal', d.dor_principal,
          'perda_estimada', d.perda_estimada,
          'mensagem_gerada', d.mensagem_gerada,
          'mensagem_editada', d.mensagem_editada,
          'aprovado_em', d.aprovado_em,
          'enviado_em', d.enviado_em,
          'agendado_para', d.agendado_para,
          'metadata_json', d.metadata_json,
          'created_at', d.created_at,
          'updated_at', d.updated_at
        )
        FROM prospectador.diagnosticos d
        WHERE d.prospect_id = p.id
        ORDER BY d.updated_at DESC, d.created_at DESC
        LIMIT 1
      ) AS diagnostico
    FROM prospectador.prospects p
    LEFT JOIN LATERAL (
      SELECT d2.agendado_para, d2.enviado_em
      FROM prospectador.diagnosticos d2
      WHERE d2.prospect_id = p.id
      ORDER BY d2.updated_at DESC, d2.created_at DESC
      LIMIT 1
    ) d_last ON true
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE
        WHEN p.status IN ('enviado', 'respondeu') THEN 2
        WHEN p.status = 'aprovado' AND d_last.agendado_para IS NOT NULL THEN 0
        ELSE 1
      END ASC,
      CASE WHEN p.status = 'aprovado' AND d_last.agendado_para IS NOT NULL THEN d_last.agendado_para END ASC NULLS LAST,
      p.updated_at DESC,
      p.created_at DESC
    LIMIT $${params.length}
    `,
    params
  )
  return rows.map(prospectPersistido)
}

async function atualizarStatusProspect(id, status) {
  const safeId = normalizarId(id)
  const safeStatus = normalizarStatusProspect(status)
  if (!safeId || !['aprovado', 'rejeitado'].includes(safeStatus)) {
    const err = new Error('Status de prospect invalido.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospects
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [safeId, safeStatus]
  )
  if (!rows[0]) {
    const err = new Error('Prospect nao encontrado.')
    err.statusCode = 404
    throw err
  }
  return prospectPersistido(rows[0])
}

async function atualizarStatusProspectsLote(ids, status) {
  const safeStatus = normalizarStatusProspect(status)
  const safeIds = normalizarArrayIds(ids)
  if (!safeIds.length || !['aprovado', 'rejeitado'].includes(safeStatus)) {
    const err = new Error('Parametros invalidos para atualizacao em lote.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospects
    SET status = $2,
        updated_at = NOW()
    WHERE id = ANY($1::uuid[])
    RETURNING *
    `,
    [safeIds, safeStatus]
  )
  return rows.map(prospectPersistido)
}

function calcularPerdaEstimadaProspect(prospect) {
  const reviews = Number(prospect.avaliacoes || 0)
  const rating = Number(prospect.rating || 0)
  const base = prospect.tem_site ? 650 : 1200
  const bonusReviews = Math.min(1500, reviews * 12)
  const bonusRating = rating >= 4.3 ? 800 : rating >= 4 ? 450 : 200
  return Math.max(300, Math.round(base + bonusReviews + bonusRating))
}

function montarMensagemDiagnosticoFallback(prospect, perdaEstimada) {
  void perdaEstimada
  const nome = prospect.nome || 'sua empresa'
  const cidade = prospect.cidade || 'sua regiao'
  const nicho = prospect.nicho || 'seu segmento'
  const dor = prospect.tem_site
    ? 'site sem direcionamento comercial claro'
    : 'ausencia de uma estrutura digital propria que capte os interessados'
  return {
    dor_principal: dor,
    mensagem_gerada:
      `Opa, tudo bem? Sou da PJ Codeworks. Vi a ${nome} no Google e gostei bastante da reputacao de voces em ${cidade}. ` +
      `Costumo notar que negocios de ${nicho} recebem boa procura online, mas perdem contato porque falta uma estrutura simples para virar agendamento no WhatsApp. ` +
      `Hoje voces recebem mais cliente por indicacao, Instagram ou ja tem algum canal direto pelo WhatsApp?`,
    metadata_json: {
      provider: 'heuristico',
      fallback: true,
    },
  }
}

async function gerarDiagnosticoComClaude(prospect) {
  const perdaEstimada = calcularPerdaEstimadaProspect(prospect)
  const systemPrompt =
    'Você é um especialista em diagnóstico de negócios locais para a PJ Codeworks. ' +
    'Retorne APENAS JSON válido com as chaves solicitadas. Sem markdown, sem texto fora do JSON.'
  const userPrompt =
    `Voce escreve em nome da PJ Codeworks (empresa de sites e presenca no Google para pequenos negocios) numa primeira mensagem fria de WhatsApp para um prospect captado no Google Maps.\n` +
    `Retorne APENAS JSON valido com chaves: dor_principal, perda_estimada, mensagem_gerada. Sem markdown, sem texto fora do JSON.\n\n` +
    `Dados do prospect:\n` +
    `- nome: ${prospect.nome}\n` +
    `- nicho: ${prospect.nicho}\n` +
    `- cidade: ${prospect.cidade}\n` +
    `- endereco: ${prospect.endereco || ''}\n` +
    `- rating: ${prospect.rating == null ? '' : prospect.rating}\n` +
    `- avaliacoes: ${prospect.avaliacoes == null ? '' : prospect.avaliacoes}\n` +
    `- tem_site: ${prospect.tem_site ? 'sim' : 'nao'}\n` +
    `- site: ${prospect.site || ''}\n\n` +
    `REGRAS OBRIGATORIAS para mensagem_gerada (1a mensagem ao lead):\n` +
    `1. Identidade: assine como "PJ Codeworks" no corpo da mensagem ("Sou da PJ Codeworks"). NUNCA escreva placeholders entre colchetes — proibido [Empresa], [Sua Empresa], [Nome da Empresa], [Nome], [Cidade], [Nicho] ou qualquer texto entre [ ]. Use diretamente os dados do prospect.\n` +
    `2. Tom consultivo, profissional, com cara de WhatsApp humano (NAO vendedor agressivo).\n` +
    `3. Comprimento: ate 4 linhas, no maximo 480 caracteres no total. Sem listas, sem bullets.\n` +
    `4. Estrutura obrigatoria em sequencia, sem misturar ideias:\n` +
    `   (a) saudacao curta + apresentacao "Sou da PJ Codeworks";\n` +
    `   (b) referencia REAL ao prospect: cite o nome da empresa, a cidade e — se rating e avaliacoes existirem — elogie a reputacao de forma natural (ex.: "vi a ${prospect.nome || 'sua empresa'} no Google e achei forte a reputacao de voces, principalmente pelas avaliacoes");\n` +
    `   (c) observacao consultiva sobre o problema GENERICO do nicho/${prospect.nicho || 'segmento'} (ex.: muita procura online sem estrutura para converter em WhatsApp);\n` +
    `   (d) UMA pergunta leve sobre canal de aquisicao/agendamento (Instagram, WhatsApp, sistema, indicacao).\n` +
    `5. PROIBICOES ABSOLUTAS:\n` +
    `   - NUNCA prometer percentual de faturamento, crescimento garantido ou ranking no Google ("aumentando o faturamento em X%", "primeiro lugar no Google", "+25%" e qualquer numero de resultado).\n` +
    `   - NUNCA citar valor em reais, faixa de preco, ROI numerico ou perda estimada nesta primeira mensagem.\n` +
    `   - NUNCA pedir reuniao, ligacao, agenda ou call.\n` +
    `   - NUNCA usar emojis em excesso (no maximo 1).\n` +
    `   - NUNCA inventar dado que nao esta nos campos acima.\n` +
    `6. Termine SEMPRE com pergunta aberta e leve, nao com convite/CTA.\n\n` +
    `Para dor_principal: 1 frase curta (ate 200 chars) descrevendo o gargalo provavel sem promessa.\n` +
    `Para perda_estimada: numero inteiro em reais (uso interno; nao citar na mensagem).`
  try {
    const aiResult = await aiProvider.generateAIResponse(
      {
        systemPrompt,
        userPrompt,
        task: 'prospeccao_diagnostico',
        temperature: 0.3,
        maxTokens: 500,
        timeoutMs: 20000,
      },
      pool,
      null
    )
    const txt = aiResult.text.trim()
    const rawJson = txt.replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(rawJson)
    return {
      dor_principal: normalizarTexto(parsed?.dor_principal, 500) || 'baixa conversao digital local',
      perda_estimada: Number(parsed?.perda_estimada) || perdaEstimada,
      mensagem_gerada: normalizarTexto(parsed?.mensagem_gerada, 4000) || montarMensagemDiagnosticoFallback(prospect, perdaEstimada).mensagem_gerada,
      metadata_json: {
        provider: aiResult.provider,
        model: aiResult.model,
      },
    }
  } catch (_) {
    return { ...montarMensagemDiagnosticoFallback(prospect, perdaEstimada), perda_estimada: perdaEstimada }
  }
}

async function salvarDiagnosticoProspect(prospectId, diagnostico) {
  const safeId = normalizarId(prospectId)
  if (!safeId) {
    const err = new Error('Prospect invalido para diagnostico.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.diagnosticos (
      prospect_id, dor_principal, perda_estimada, mensagem_gerada, metadata_json
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING *
    `,
    [
      safeId,
      normalizarTexto(diagnostico?.dor_principal, 500) || null,
      Number(diagnostico?.perda_estimada) || null,
      normalizarTexto(diagnostico?.mensagem_gerada, 4000) || null,
      JSON.stringify(diagnostico?.metadata_json || {}),
    ]
  )
  return diagnosticoPersistido(rows[0])
}

async function gerarDiagnosticos(input = {}) {
  const ids = normalizarArrayIds(input.prospect_ids?.length ? input.prospect_ids : [input.prospect_id])
  if (!ids.length) {
    const err = new Error('Informe ao menos um prospect_id.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(`SELECT * FROM prospectador.prospects WHERE id = ANY($1::uuid[])`, [ids])
  const porId = new Map(rows.map((r) => [r.id, prospectPersistido(r)]))
  const saida = []
  for (const id of ids) {
    const prospect = porId.get(id)
    if (!prospect) continue
    const diag = await gerarDiagnosticoComClaude(prospect)
    const salvo = await salvarDiagnosticoProspect(id, diag)
    await registrarProspectEvent(id, 'diagnosticado', { provider: salvo.metadata_json?.provider || 'heuristico' })
    saida.push(salvo)
  }
  return saida
}

async function atualizarMensagemEditada(prospectId, payload = {}) {
  const safeId = normalizarId(prospectId)
  const mensagem = normalizarTexto(payload.mensagem_editada, 4000)
  if (!safeId || !mensagem) {
    const err = new Error('Prospect e mensagem_editada sao obrigatorios.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    UPDATE prospectador.diagnosticos d
    SET mensagem_editada = $2,
        updated_at = NOW()
    WHERE d.id = (
      SELECT id
      FROM prospectador.diagnosticos
      WHERE prospect_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    )
    RETURNING *
    `,
    [safeId, mensagem]
  )
  if (!rows[0]) {
    const err = new Error('Diagnostico nao encontrado para esse prospect.')
    err.statusCode = 404
    throw err
  }
  return diagnosticoPersistido(rows[0])
}

async function registrarProspectEvent(prospectId, tipoEvento, detalhe = {}) {
  await pool.query(
    `
    INSERT INTO prospectador.prospect_events (prospect_id, tipo_evento, detalhe)
    VALUES ($1, $2, $3::jsonb)
    `,
    [prospectId, tipoEvento, JSON.stringify(detalhe || {})]
  )
}

async function obterDiagnosticoAtual(prospectId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM prospectador.diagnosticos
    WHERE prospect_id = $1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
    `,
    [prospectId]
  )
  return diagnosticoPersistido(rows[0] || null)
}

function mensagemParaEnvio(diagnostico) {
  return substituirPlaceholderEmpresa((diagnostico?.mensagem_editada || diagnostico?.mensagem_gerada || '').trim())
}

const PLACEHOLDER_EMPRESA_REGEX = /\[\s*(empresa|sua empresa|nome da empresa|nome empresa|nome da minha empresa|minha empresa)\s*\]/gi
const PLACEHOLDER_RESIDUAL_REGEX = /\[[^\[\]\n]{1,80}\]/

function substituirPlaceholderEmpresa(texto) {
  if (!texto || typeof texto !== 'string') return ''
  return texto.replace(PLACEHOLDER_EMPRESA_REGEX, 'PJ Codeworks')
}

function temPlaceholderResidual(texto) {
  if (!texto || typeof texto !== 'string') return false
  return PLACEHOLDER_RESIDUAL_REGEX.test(texto)
}

async function registrarTentativaEnvio({ prospectId, mensagem, idempotencyKey, status, erro, evolutionResposta }) {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.send_attempts (
      prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta
    ) VALUES (
      $1, $2, md5($3), $4, $5, $6::jsonb
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET status = EXCLUDED.status,
        erro = EXCLUDED.erro,
        evolution_resposta = EXCLUDED.evolution_resposta,
        updated_at = NOW()
    RETURNING *
    `,
    [prospectId, idempotencyKey, mensagem, status, erro || null, JSON.stringify(evolutionResposta || {})]
  )
  return rows[0]
}

async function avaliarPoliticaContato(telefone) {
  const telefoneLimpo = normalizarTelefone(telefone)
  if (!telefoneLimpo) return { ok: false, erro: 'Prospect sem telefone valido.' }
  const [policy, volume] = await Promise.all([
    pool.query(
      `
      SELECT opt_out, quiet_hours_inicio, quiet_hours_fim, limite_diario
      FROM prospectador.contato_politicas
      WHERE regexp_replace(telefone, '\D', '', 'g') = $1
      LIMIT 1
      `,
      [telefoneLimpo]
    ),
    pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM prospectador.send_attempts sa
      JOIN prospectador.prospects p ON p.id = sa.prospect_id
      WHERE sa.status = 'sent'
        AND regexp_replace(COALESCE(p.telefone, ''), '\D', '', 'g') = $1
        AND sa.created_at >= date_trunc('day', NOW())
      `,
      [telefoneLimpo]
    ),
  ])
  const politica = policy.rows[0] || null
  if (!politica) return { ok: true }
  if (politica.opt_out) return { ok: false, erro: 'Contato em opt-out.' }

  const limiteDiario = Number(politica.limite_diario || 0)
  const enviadosHoje = Number(volume.rows[0]?.total || 0)
  if (limiteDiario > 0 && enviadosHoje >= limiteDiario) {
    return { ok: false, erro: 'Limite diario de envios atingido para este contato.' }
  }

  const inicio = Number(politica.quiet_hours_inicio)
  const fim = Number(politica.quiet_hours_fim)
  if (Number.isInteger(inicio) && Number.isInteger(fim) && inicio !== fim) {
    const hora = new Date().getHours()
    const emQuietHours = inicio < fim
      ? hora >= inicio && hora < fim
      : hora >= inicio || hora < fim
    if (emQuietHours) return { ok: false, erro: 'Contato em janela de silencio.' }
  }
  return { ok: true }
}

async function enviarProspectsAprovados(input = {}) {
  const ids = normalizarArrayIds(input.prospect_ids)
  if (!ids.length) {
    const err = new Error('Informe prospect_ids para envio.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    SELECT p.*,
      (
        SELECT row_to_json(d.*)
        FROM (
          SELECT *
          FROM prospectador.diagnosticos
          WHERE prospect_id = p.id
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        ) d
      ) AS diagnostico
    FROM prospectador.prospects p
    WHERE p.id = ANY($1::uuid[])
    `,
    [ids]
  )
  const saida = []
  for (const row of rows) {
    const p = prospectPersistido(row)
    const telefone = normalizarTelefone(p.telefone)
    if (p.status !== 'aprovado') {
      saida.push({ prospect_id: p.id, ok: false, erro: 'Prospect fora do status aprovado.' })
      continue
    }
    if (!telefone) {
      saida.push({ prospect_id: p.id, ok: false, erro: 'Prospect sem telefone valido.' })
      continue
    }
    const politicaContato = await avaliarPoliticaContato(telefone)
    if (!politicaContato.ok) {
      saida.push({ prospect_id: p.id, ok: false, erro: politicaContato.erro })
      continue
    }
    const diagnostico = row?.diagnostico || await obterDiagnosticoAtual(p.id)
    const mensagem = mensagemParaEnvio(diagnostico)
    if (!mensagem) {
      saida.push({ prospect_id: p.id, ok: false, erro: 'Sem mensagem para envio.' })
      continue
    }
    if (temPlaceholderResidual(mensagem)) {
      const trecho = (mensagem.match(PLACEHOLDER_RESIDUAL_REGEX) || ['?'])[0]
      await registrarProspectEvent(p.id, 'erro_envio', {
        motivo: 'mensagem_com_placeholder',
        trecho,
      }).catch(() => {})
      saida.push({
        prospect_id: p.id,
        ok: false,
        erro: `Mensagem com placeholder nao substituido (${trecho}). Edite o diagnostico antes de enviar.`,
      })
      continue
    }
    const janela = new Date()
    janela.setMinutes(0, 0, 0)
    const idempotencyKey = `prospect-send:${p.id}:${Buffer.from(mensagem).toString('base64').slice(0, 24)}:${janela.toISOString()}`
    const jaEnviado = await pool.query(
      `SELECT 1 FROM prospectador.send_attempts WHERE idempotency_key = $1 AND status = 'sent' LIMIT 1`,
      [idempotencyKey]
    )
    if (jaEnviado.rows[0]) {
      saida.push({ prospect_id: p.id, ok: true, deduplicado: true })
      continue
    }
    let tentativa = 0
    let ultimoErro = null
    let respostaEnvio = null
    while (tentativa < 3) {
      tentativa += 1
      try {
        respostaEnvio = await enviarMensagem(telefone, mensagem)
        await registrarTentativaEnvio({
          prospectId: p.id,
          mensagem,
          idempotencyKey,
          status: 'sent',
          erro: null,
          evolutionResposta: respostaEnvio,
        })
        await pool.query(
          `
          UPDATE prospectador.prospects
          SET status = 'enviado',
              updated_at = NOW()
          WHERE id = $1
          `,
          [p.id]
        )
        await pool.query(
          `
          UPDATE prospectador.diagnosticos
          SET enviado_em = NOW(), updated_at = NOW()
          WHERE id = (
            SELECT id
            FROM prospectador.diagnosticos
            WHERE prospect_id = $1
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
          )
          `,
          [p.id]
        )
        await registrarProspectEvent(p.id, 'enviado', { tentativa })
        ultimoErro = null
        break
      } catch (err) {
        ultimoErro = err
        await registrarTentativaEnvio({
          prospectId: p.id,
          mensagem,
          idempotencyKey,
          status: 'failed',
          erro: err.message || 'falha_envio',
          evolutionResposta: err.response?.data || {},
        })
        if (tentativa < 3) {
          await new Promise((resolve) => setTimeout(resolve, 400 * tentativa))
        }
      }
    }
    if (ultimoErro) {
      await registrarProspectEvent(p.id, 'erro_envio', { erro: ultimoErro.message || 'falha' })
      saida.push({ prospect_id: p.id, ok: false, erro: ultimoErro.message || 'falha ao enviar' })
    } else {
      saida.push({ prospect_id: p.id, ok: true, status: 'enviado', evolution: respostaEnvio || null })
    }
  }
  return saida
}

async function processarFluxoCompleto(prospectIds, limite = null) {
  const ids = normalizarArrayIds(prospectIds)
  if (!ids.length) {
    const err = new Error('Informe prospect_ids para processamento completo.')
    err.statusCode = 400
    throw err
  }
  const diagnosticos = await gerarDiagnosticos({ prospect_ids: ids })
  const idsDiagnosticados = diagnosticos.map((d) => d.prospect_id).filter(Boolean)
  const aprovados = await atualizarStatusProspectsLote(idsDiagnosticados, 'aprovado')
  await Promise.all(aprovados.map((p) => registrarProspectEvent(p.id, 'aprovado', { origem: 'fluxo_completo' })))
  const idsAprovados = aprovados.map((p) => p.id).filter(Boolean)
  const limiteNum = limite == null ? null : normalizarInteiro(limite, idsAprovados.length || 1, 1, 200)
  const idsParaEnviar = limiteNum == null ? idsAprovados : idsAprovados.slice(0, limiteNum)
  const cfg = await obterConfiguracaoAutoProspeccao()
  const envios = idsParaEnviar.length
    ? await agendarEnvios(idsParaEnviar, cfg?.intervalo_envio_minutos || 30)
    : { agendados: 0, detalhes: [] }
  const falhas = (envios.detalhes || []).filter((item) => !item.ok)
  return {
    diagnosticados: idsDiagnosticados.length,
    aprovados: idsAprovados.length,
    agendados: Number(envios.agendados || 0),
    falhas,
  }
}

/**
 * Próximo instante válido na grade comercial (múltiplos de granularidadeMin),
 * janela [inicioHora:00, fimHora:00) no fuso local do processo.
 */
function proximoSlotComercial(base, opts = {}) {
  const inicioHora = Number.isFinite(opts.inicioHora)
    ? opts.inicioHora
    : parseInt(process.env.PROSPECCAO_COMERCIAL_INICIO || '8', 10) || 8
  const fimHora = Number.isFinite(opts.fimHora)
    ? opts.fimHora
    : parseInt(process.env.PROSPECCAO_COMERCIAL_FIM || '20', 10) || 20
  const g = Number.isFinite(opts.granularidadeMin) ? opts.granularidadeMin : 15

  const dt = new Date(base.getTime())
  const startMin = inicioHora * 60
  const endMin = fimHora * 60
  let M = dt.getHours() * 60 + dt.getMinutes()
  if (base.getSeconds() > 0 || base.getMilliseconds() > 0) M += 1

  const pularParaManha = () => {
    dt.setDate(dt.getDate() + 1)
    dt.setHours(inicioHora, 0, 0, 0)
    return dt
  }

  if (M >= endMin) {
    return pularParaManha()
  }
  if (M < startMin) {
    M = startMin
  } else {
    const offset = M - startMin
    const rem = offset % g
    if (rem !== 0) M += g - rem
    if (M >= endMin) {
      return pularParaManha()
    }
  }

  dt.setHours(Math.floor(M / 60), M % 60, 0, 0)
  return dt
}

function limiteBuscaPlacesParaConfig(cfg) {
  if (!cfg) return 5
  const raw = cfg.rodada_diaria !== false ? (calcularLimiteDiario(cfg) || cfg.limit) : cfg.limit
  return normalizarInteiro(raw, 5, 1, 20)
}

/** Mesma lógica de pares nicho/cidade que o job prospeccao_places_auto (sem chamar Places). */
async function resolverPlanejamentoBuscaAuto({ limit, categoria } = {}) {
  const lim = normalizarInteiro(limit, 5, 1, 20)
  const cat = normalizarCategoria(categoria)
  let top
  if (cat) {
    top = await pool.query(
      `
      SELECT DISTINCT cidade
      FROM prospectador.nichos_performantes
      WHERE total_conversas > 0
      ORDER BY cidade ASC
      LIMIT $1
      `,
      [lim]
    )
  } else {
    top = await pool.query(
      `
      SELECT nicho, cidade
      FROM prospectador.nichos_performantes
      WHERE total_conversas > 0
      ORDER BY taxa_conversao DESC, total_fechamentos DESC, total_conversas DESC
      LIMIT $1
      `,
      [lim]
    )
  }
  const itens = top.rows.map((item) => ({
    nicho: cat || item.nicho,
    cidade: item.cidade,
  }))
  return {
    fonte: 'nichos_performantes_atual',
    categoria_aplicada: cat || null,
    itens,
  }
}

async function agendarEnvios(prospectIds, intervaloMin = 30) {
  const ids = normalizarArrayIds(prospectIds)
  if (!ids.length) {
    const err = new Error('Informe prospect_ids para envio.')
    err.statusCode = 400
    throw err
  }
  const intervalo = normalizarInteiro(intervaloMin, 30, 5, 1440)
  const ultimoAgendado = await pool.query(
    `
    SELECT MAX(available_at) AS last_at
    FROM vendas.job_queue
    WHERE tipo = 'prospeccao_envio_agendado'
      AND status = 'pending'
    `
  )
  const lastAt = ultimoAgendado.rows[0]?.last_at ? new Date(ultimoAgendado.rows[0].last_at) : null
  const base = lastAt && Number.isFinite(lastAt.getTime())
    ? new Date(Math.max(lastAt.getTime(), Date.now()))
    : new Date()

  let proximo = proximoSlotComercial(new Date(base.getTime() + intervalo * 60000))
  const agendamentos = []
  for (const id of ids) {
    await enfileirarJobProspeccao(
      'prospeccao_envio_agendado',
      { prospect_id: id },
      `prospeccao_envio:${id}`,
      proximo.toISOString()
    )
    await pool.query(
      `
      UPDATE prospectador.diagnosticos
      SET agendado_para = $1,
          updated_at = NOW()
      WHERE id = (
        SELECT d.id
        FROM prospectador.diagnosticos d
        WHERE d.prospect_id = $2
          AND d.agendado_para IS NULL
        ORDER BY d.updated_at DESC, d.created_at DESC
        LIMIT 1
      )
      `,
      [proximo.toISOString(), id]
    )
    agendamentos.push({ prospect_id: id, ok: true, agendado_para: proximo.toISOString() })
    proximo = proximoSlotComercial(new Date(proximo.getTime() + intervalo * 60000))
  }

  return { agendados: agendamentos.length, detalhes: agendamentos }
}

async function marcarProspectComoRespondeuPorNumero(numero) {
  const telefone = normalizarTelefone(numero)
  if (!telefone) return null
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospects p
    SET status = 'respondeu',
        updated_at = NOW()
    WHERE p.id = (
      SELECT p2.id
      FROM prospectador.prospects p2
      WHERE regexp_replace(COALESCE(p2.telefone, ''), '\D', '', 'g') = $1
        AND p2.status = 'enviado'
      ORDER BY p2.updated_at DESC, p2.created_at DESC
      LIMIT 1
    )
    RETURNING *
    `,
    [telefone]
  )
  if (!rows[0]) return null
  const prospect = prospectPersistido(rows[0])
  await registrarProspectEvent(prospect.id, 'respondeu', { telefone })
  return prospect
}

async function buscarContextoProspeccao(numero) {
  const telefone = normalizarTelefone(numero)
  if (!telefone) return null
  const { rows } = await pool.query(
    `
    SELECT p.*,
      (
        SELECT row_to_json(d.*)
        FROM (
          SELECT *
          FROM prospectador.diagnosticos
          WHERE prospect_id = p.id
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        ) d
      ) AS diagnostico
    FROM prospectador.prospects p
    WHERE regexp_replace(COALESCE(p.telefone, ''), '\D', '', 'g') = $1
      AND p.status IN ('enviado', 'respondeu')
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT 1
    `,
    [telefone]
  )
  if (!rows[0]) return null
  const prospect = prospectPersistido(rows[0])
  const diagnostico = rows[0]?.diagnostico ? diagnosticoPersistido(rows[0].diagnostico) : null
  return { prospect, diagnostico }
}

async function sincronizarNichosPerformantes() {
  const { rows } = await pool.query(
    `
    WITH base AS (
      SELECT
        lower(trim(COALESCE(lp.negocio, ''))) AS nicho,
        lower(trim(COALESCE(lp.cidade, ''))) AS cidade,
        COUNT(*)::int AS total_conversas,
        COUNT(*) FILTER (WHERE COALESCE(c.venda_fechada, false))::int AS total_fechamentos
      FROM vendas.lead_profiles lp
      JOIN vendas.conversas c ON c.numero = lp.numero
      WHERE COALESCE(lp.negocio, '') <> '' AND COALESCE(lp.cidade, '') <> ''
      GROUP BY 1, 2
    )
    INSERT INTO prospectador.nichos_performantes (
      nicho, cidade, total_conversas, total_fechamentos, taxa_conversao, ultima_atualizacao
    )
    SELECT
      nicho,
      cidade,
      total_conversas,
      total_fechamentos,
      CASE WHEN total_conversas > 0 THEN total_fechamentos::numeric / total_conversas::numeric ELSE 0 END AS taxa_conversao,
      NOW()
    FROM base
    ON CONFLICT (nicho, cidade) DO UPDATE
    SET total_conversas = EXCLUDED.total_conversas,
        total_fechamentos = EXCLUDED.total_fechamentos,
        taxa_conversao = EXCLUDED.taxa_conversao,
        ultima_atualizacao = NOW()
    RETURNING *
    `
  )
  return rows
}

async function obterConfiguracaoAutoProspeccao() {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.auto_prospeccao_config (
      singleton_id, enabled, modo, weekday, hour, minute, weekly_limit, intervalo_envio_minutos, categoria, rodada_diaria
    )
    VALUES (true, false, 'manual', 1, 9, 0, 40, 30, NULL, true)
    ON CONFLICT (singleton_id) DO NOTHING
    `
  )
  void rows
  const result = await pool.query(
    `
    SELECT singleton_id, enabled, modo, weekday, hour, minute, weekly_limit, intervalo_envio_minutos, categoria,
      rodada_diaria, last_enqueued_window_start, last_enqueued_date, last_enqueued_at,
      weekly_sent, weekly_sent_reset_date, created_at, updated_at
    FROM prospectador.auto_prospeccao_config
    WHERE singleton_id = true
    LIMIT 1
    `
  )
  return configAutoProspeccaoPersistida(result.rows[0] || null)
}

async function salvarConfiguracaoAutoProspeccao(payload = {}) {
  const cfg = normalizarConfiguracaoAutoProspeccao(payload)
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.auto_prospeccao_config (
      singleton_id, enabled, modo, weekday, hour, minute, weekly_limit, intervalo_envio_minutos, categoria, rodada_diaria
    )
    VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (singleton_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        modo = EXCLUDED.modo,
        weekday = EXCLUDED.weekday,
        hour = EXCLUDED.hour,
        minute = EXCLUDED.minute,
        weekly_limit = EXCLUDED.weekly_limit,
        intervalo_envio_minutos = EXCLUDED.intervalo_envio_minutos,
        categoria = EXCLUDED.categoria,
        rodada_diaria = EXCLUDED.rodada_diaria,
        updated_at = NOW()
    RETURNING *
    `,
    [cfg.enabled, cfg.modo, cfg.weekday, cfg.hour, cfg.minute, cfg.limit, cfg.intervalo_envio_minutos, cfg.categoria, cfg.rodada_diaria]
  )
  return configAutoProspeccaoPersistida(rows[0] || null)
}

async function verificarAgendaAutoProspeccao(now = new Date()) {
  const cfg = await obterConfiguracaoAutoProspeccao()
  if (!cfg || !cfg.enabled) return { ok: true, enfileirado: false, motivo: 'desabilitado' }

  if (cfg.rodada_diaria) {
    const { inicio, dataStr } = obterJanelaDiaria(cfg, now)
    const agora = now instanceof Date ? now : new Date(now)
    if (agora < inicio) {
      return { ok: true, enfileirado: false, motivo: 'antes_do_horario', proximo: inicio.toISOString() }
    }
    if (cfg.last_enqueued_date === dataStr) {
      return { ok: true, enfileirado: false, motivo: 'ja_processado_hoje', data: dataStr }
    }
    const diaSemana = inicio.getDay()
    let weeklySentAtual = cfg.weekly_sent || 0
    const ehSegunda = diaSemana === 1
    const resetouEssaSemana = cfg.weekly_sent_reset_date === dataStr
    if (ehSegunda && !resetouEssaSemana) {
      weeklySentAtual = 0
    }
    const limiteDiario = calcularLimiteDiario({ ...cfg, weekly_sent: weeklySentAtual }, agora)
    if (limiteDiario <= 0) {
      return { ok: true, enfileirado: false, motivo: 'limite_semanal_atingido', weekly_sent: weeklySentAtual, limit: cfg.limit }
    }
    const dedupeBase = `prospeccao_auto_diario:${dataStr}`
    await enfileirarJobProspeccao(
      'prospeccao_nichos_sync',
      { trigger: 'auto-diario', data: dataStr },
      `${dedupeBase}:sync`
    )
    await enfileirarJobProspeccao(
      'prospeccao_places_auto',
      { trigger: 'auto-diario', limit: limiteDiario, categoria: cfg.categoria || null, data: dataStr },
      `${dedupeBase}:places`
    )
    await pool.query(
      `
      UPDATE prospectador.auto_prospeccao_config
      SET last_enqueued_date = $1,
          last_enqueued_at = NOW(),
          weekly_sent = $2,
          weekly_sent_reset_date = CASE WHEN $3 = true THEN $1 ELSE weekly_sent_reset_date END,
          updated_at = NOW()
      WHERE singleton_id = true
      `,
      [dataStr, weeklySentAtual + limiteDiario, ehSegunda && !resetouEssaSemana]
    )
    return { ok: true, enfileirado: true, data: dataStr, limite_diario: limiteDiario }
  }

  // Modo semanal (rodada_diaria = false)
  const janela = obterJanelaSemanal(cfg, now)
  const agora = now instanceof Date ? now : new Date(now)
  if (agora < janela.inicio || agora >= janela.fim) {
    return { ok: true, enfileirado: false, motivo: 'fora_janela', janela_inicio: janela.inicio.toISOString() }
  }
  const last = cfg.last_enqueued_window_start ? new Date(cfg.last_enqueued_window_start) : null
  if (last && last.getTime() >= janela.inicio.getTime()) {
    return { ok: true, enfileirado: false, motivo: 'janela_ja_processada', janela_inicio: janela.inicio.toISOString() }
  }
  const dedupeBase = `prospeccao_auto_semanal:${janela.inicio.toISOString()}`
  await enfileirarJobProspeccao(
    'prospeccao_nichos_sync',
    { trigger: 'auto-semanal', window_start: janela.inicio.toISOString() },
    `${dedupeBase}:sync`
  )
  await enfileirarJobProspeccao(
    'prospeccao_places_auto',
    {
      trigger: 'auto-semanal',
      limit: cfg.limit,
      categoria: cfg.categoria || null,
      window_start: janela.inicio.toISOString(),
    },
    `${dedupeBase}:places`
  )
  await pool.query(
    `
    UPDATE prospectador.auto_prospeccao_config
    SET last_enqueued_window_start = $1,
        last_enqueued_at = NOW(),
        updated_at = NOW()
    WHERE singleton_id = true
    `,
    [janela.inicio.toISOString()]
  )
  return { ok: true, enfileirado: true, janela_inicio: janela.inicio.toISOString() }
}

async function enfileirarJobProspeccao(tipo, payload = {}, dedupeKey = null, availableAt = null) {
  const safeTipo = String(tipo || '').trim()
  if (!['prospeccao_nichos_sync', 'prospeccao_places_auto', 'prospeccao_completo', 'prospeccao_envio_agendado'].includes(safeTipo)) {
    const err = new Error('Tipo de job de prospeccao invalido.')
    err.statusCode = 400
    throw err
  }
  const schemaPayload = validarJobQueuePayload(safeTipo, payload || {})
  if (schemaPayload.issues.length) {
    logger.warn('[schema-violation] payload de job de prospeccao fora do contrato', {
      tipo: safeTipo,
      issues: schemaPayload.issues,
    })
  }
  const safePayload = schemaPayload.value || {}
  const dedupe = dedupeKey || `${safeTipo}:${JSON.stringify(safePayload)}`.slice(0, 200)
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
    VALUES ($1, $2, $3::jsonb, 'pending', 0, 5, COALESCE($4::timestamptz, NOW()))
    ON CONFLICT (dedupe_key) DO UPDATE
    SET status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
        attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
        available_at = COALESCE($4::timestamptz, NOW()),
        updated_at = NOW()
    RETURNING *
    `,
    [safeTipo, dedupe, JSON.stringify(safePayload), availableAt]
  )
  return rows[0]
}

async function executarJobProspeccao(job) {
  const tipo = String(job?.tipo || '')
  const payloadSchema = validarJobQueuePayload(tipo, job?.payload || {})
  if (payloadSchema.issues.length) {
    logger.warn('[schema-violation] payload de job reivindicado fora do contrato', {
      id: job?.id || null,
      tipo,
      issues: payloadSchema.issues,
    })
  }
  const payload = payloadSchema.value || {}
  if (tipo === 'prospeccao_completo') {
    return processarFluxoCompleto(payload.prospect_ids || [], payload.limite ?? null)
  }
  if (tipo === 'prospeccao_nichos_sync') {
    const rows = await sincronizarNichosPerformantes()
    return { tipo, atualizados: rows.length }
  }
  if (tipo === 'prospeccao_places_auto') {
    const limit = normalizarInteiro(payload.limit, 5, 1, 20)
    const categoria = normalizarCategoria(payload.categoria)
    const plano = await resolverPlanejamentoBuscaAuto({ limit, categoria })
    const execs = []
    const idsNovos = []
    for (const item of plano.itens) {
      const nichoBusca = item.nicho
      const r = await pesquisarPlaces({ nicho: nichoBusca, local: item.cidade, quantidade: 10 })
      const idsProspects = (r.prospects || []).map((p) => p.id).filter(Boolean)
      idsNovos.push(...idsProspects)
      await Promise.all(
        (r.prospects || []).map((p) =>
          pool.query(
            `UPDATE prospectador.prospects SET origem = 'automatico', updated_at = NOW() WHERE id = $1`,
            [p.id]
          )
        )
      )
      execs.push({ nicho: nichoBusca, cidade: item.cidade, encontrados: (r.prospects || []).length })
    }
    const cfg = await obterConfiguracaoAutoProspeccao()
    if (cfg?.modo === 'automatico' && idsNovos.length) {
      await enfileirarJobProspeccao(
        'prospeccao_completo',
        { prospect_ids: idsNovos, limite: cfg.limit || null },
        `prospeccao_completo:auto:${job.id}`
      )
    }
    return { tipo, categoria: categoria || null, processados: execs }
  }
  if (tipo === 'prospeccao_envio_agendado') {
    const prospectId = normalizarId(payload.prospect_id)
    if (!prospectId) throw new Error('Job de envio agendado sem prospect_id.')
    const resultado = await enviarProspectsAprovados({ prospect_ids: [prospectId] })
    await pool.query(
      `
      UPDATE prospectador.diagnosticos
      SET agendado_para = NULL,
          updated_at = NOW()
      WHERE id = (
        SELECT d.id
        FROM prospectador.diagnosticos d
        WHERE d.prospect_id = $1
        ORDER BY d.updated_at DESC, d.created_at DESC
        LIMIT 1
      )
      `,
      [prospectId]
    )
    return { tipo, resultado: Array.isArray(resultado) ? resultado[0] || null : null }
  }
  throw new Error(`Tipo de job nao suportado: ${tipo}`)
}

async function consumirJobsProspeccao(limit = 5) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20)
  const { rows } = await pool.query(
    `
    WITH cte AS (
      SELECT id
      FROM vendas.job_queue
      WHERE status = 'pending'
        AND tipo IN ('prospeccao_nichos_sync', 'prospeccao_places_auto', 'prospeccao_completo', 'prospeccao_envio_agendado')
        AND available_at <= NOW()
      ORDER BY available_at ASC, id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vendas.job_queue q
    SET status = 'processing',
        attempts = q.attempts + 1,
        locked_at = NOW(),
        locked_until = NOW() + INTERVAL '90 seconds',
        updated_at = NOW()
    FROM cte
    WHERE q.id = cte.id
    RETURNING q.*
    `,
    [n]
  )
  const resultados = []
  for (const job of rows) {
    try {
      const result = await executarJobProspeccao(job)
      await pool.query(
        `
        UPDATE vendas.job_queue
        SET status = 'completed',
            locked_at = NULL,
            locked_until = NULL,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [job.id]
      )
      resultados.push({ id: job.id, ok: true, tipo: job.tipo, result })
    } catch (err) {
      const failed = Number(job.attempts) >= Number(job.max_attempts)
      await pool.query(
        `
        UPDATE vendas.job_queue
        SET status = $2,
            locked_at = NULL,
            locked_until = NULL,
            last_error = $3,
            updated_at = NOW()
        WHERE id = $1
        `,
        [job.id, failed ? 'failed' : 'pending', String(err.message || 'erro_job').slice(0, 900)]
      )
      resultados.push({ id: job.id, ok: false, tipo: job.tipo, erro: err.message || 'erro_job' })
    }
  }
  return resultados
}

async function obterStatusJobsProspeccao() {
  const [counts, ultimo] = await Promise.all([
    pool.query(
      `
      SELECT status, COUNT(*)::int AS total
      FROM vendas.job_queue
      WHERE tipo LIKE 'prospeccao%'
      GROUP BY status
      `
    ),
    pool.query(
      `
      SELECT MAX(updated_at) AS ultimo_completado_em
      FROM vendas.job_queue
      WHERE tipo LIKE 'prospeccao%'
        AND status = 'completed'
      `
    ),
  ])
  const mapa = Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.total || 0)]))
  return {
    pendentes: mapa.pending || 0,
    processando: mapa.processing || 0,
    falhas_recentes: mapa.failed || 0,
    ultimo_completado_em: ultimo.rows[0]?.ultimo_completado_em || null,
  }
}

async function obterMetricasProspeccao() {
  const [statusRows, diagRows, envRows, convRows] = await Promise.all([
    pool.query(
      `
      SELECT status, COUNT(*)::int AS total
      FROM prospectador.prospects
      GROUP BY status
      `
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM prospectador.diagnosticos`),
    pool.query(`SELECT COUNT(*)::int AS total FROM prospectador.send_attempts WHERE status = 'sent'`),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'respondeu')::int AS respondeu,
        COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviado
      FROM prospectador.prospects
      `
    ),
  ])
  const porStatus = {}
  for (const r of statusRows.rows) porStatus[r.status] = Number(r.total || 0)
  const enviados = Number(envRows.rows[0]?.total || 0)
  const respondeu = Number(convRows.rows[0]?.respondeu || 0)
  return {
    totals: porStatus,
    diagnosticos_total: Number(diagRows.rows[0]?.total || 0),
    enviados_total: enviados,
    taxa_resposta: enviados > 0 ? Number((respondeu / enviados).toFixed(4)) : 0,
  }
}

async function pesquisarPlaces({ nicho, local, quantidade }) {
  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim()
  if (!apiKey) {
    const err = new Error('GOOGLE_PLACES_API_KEY ausente no ambiente do servidor.')
    err.statusCode = 500
    throw err
  }

  const queryNicho = normalizarTexto(nicho)
  const queryLocal = normalizarTexto(local)
  if (!queryNicho || !queryLocal) {
    const err = new Error('Informe nicho e cidade/regiao para pesquisar.')
    err.statusCode = 400
    throw err
  }

  const maxResultCount = normalizarQuantidade(quantidade)
  const textQuery = `${queryNicho} em ${queryLocal}`

  const { data } = await axios.post(
    PLACES_TEXT_SEARCH_URL,
    {
      textQuery,
      maxResultCount,
      languageCode: 'pt-BR',
      regionCode: 'BR',
    },
    {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DEFAULT_FIELD_MASK,
      },
    }
  )

  const prospects = Array.isArray(data?.places) ? data.places.map(mapearPlace) : []
  const salvos = await salvarProspects(prospects, {
    nicho: queryNicho,
    cidade: queryLocal,
    origem: 'manual',
  })

  return {
    consulta: textQuery,
    quantidade_solicitada: maxResultCount,
    prospects: salvos,
  }
}

function erroHttp(err) {
  const statusGoogle = err?.response?.status
  const msgGoogle = err?.response?.data?.error?.message
  const status = err.statusCode || (statusGoogle === 400 ? 400 : statusGoogle === 403 ? 502 : 500)
  return {
    status,
    erro: msgGoogle || err.message || 'Falha ao pesquisar no Google Places.',
  }
}

function registerProspectingRoutes(app) {
  app.get('/dashboard/prospeccao/prospects', async (req, res) => {
    if (!dashboardAutorizado(req)) {
      return res.status(401).json({ erro: 'Nao autorizado' })
    }

    try {
      const prospects = await listarProspects(req.query || {})
      res.json({ prospects })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/places-search', async (req, res) => {
    if (!dashboardAutorizado(req)) {
      return res.status(401).json({ erro: 'Nao autorizado' })
    }

    try {
      const resultado = await pesquisarPlaces(req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/places-search-completo', async (req, res) => {
    if (!dashboardAutorizado(req)) {
      return res.status(401).json({ erro: 'Nao autorizado' })
    }
    try {
      const resultado = await pesquisarPlaces(req.body || {})
      const ids = (resultado.prospects || []).map((p) => p.id).filter(Boolean)
      const job = await enfileirarJobProspeccao(
        'prospeccao_completo',
        { prospect_ids: ids, limite: null },
        `prospeccao_completo:manual:${Date.now()}`
      )
      res.json({ prospects_encontrados: ids.length, job_id: job.id })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/prospects/lote/aprovar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const prospects = await atualizarStatusProspectsLote(req.body?.prospect_ids, 'aprovado')
      await Promise.all(prospects.map((p) => registrarProspectEvent(p.id, 'aprovado', { origem: 'lote' })))
      res.json({ prospects })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/prospects/lote/rejeitar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const prospects = await atualizarStatusProspectsLote(req.body?.prospect_ids, 'rejeitado')
      await Promise.all(prospects.map((p) => registrarProspectEvent(p.id, 'rejeitado', { origem: 'lote' })))
      res.json({ prospects })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/prospects/:id/aprovar', async (req, res) => {
    if (!dashboardAutorizado(req)) {
      return res.status(401).json({ erro: 'Nao autorizado' })
    }
    try {
      const prospect = await atualizarStatusProspect(req.params.id, 'aprovado')
      await registrarProspectEvent(prospect.id, 'aprovado', { origem: 'painel' })
      res.json({ prospect })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/prospects/:id/rejeitar', async (req, res) => {
    if (!dashboardAutorizado(req)) {
      return res.status(401).json({ erro: 'Nao autorizado' })
    }
    try {
      const prospect = await atualizarStatusProspect(req.params.id, 'rejeitado')
      await registrarProspectEvent(prospect.id, 'rejeitado', { origem: 'painel' })
      res.json({ prospect })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/diagnosticos/gerar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const diagnosticos = await gerarDiagnosticos(req.body || {})
      res.json({ diagnosticos })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.patch('/dashboard/prospeccao/diagnosticos/:prospect_id', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const diagnostico = await atualizarMensagemEditada(req.params.prospect_id, req.body || {})
      res.json({ diagnostico })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/disparos/enviar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const prospectIds = req.body?.prospect_ids
      const cfg = await obterConfiguracaoAutoProspeccao()
      const resultado = await agendarEnvios(prospectIds, cfg?.intervalo_envio_minutos || 30)
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/disparos/forcar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const body = req.body || {}
      const ids = normalizarArrayIds(body.prospect_ids)
      const idUnico = normalizarId(body.prospect_id || body.id)
      if (idUnico) ids.push(idUnico)
      if (!ids.length) {
        return res.status(400).json({ erro: 'Informe prospect_id ou prospect_ids para forcar envio.' })
      }
      const resultados = await enviarProspectsAprovados({ prospect_ids: ids })
      await pool.query(
        `
        UPDATE prospectador.diagnosticos
        SET agendado_para = NULL,
            updated_at = NOW()
        WHERE prospect_id = ANY($1::uuid[])
        `,
        [ids]
      )
      res.json({ resultados })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/jobs/sync-nichos', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const job = await enfileirarJobProspeccao('prospeccao_nichos_sync', { trigger: 'manual' }, 'prospeccao_nichos_sync:manual')
      res.json({ job })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/jobs/buscar-automatico', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const payload = { limit: req.body?.limit || 5, trigger: 'manual' }
      const job = await enfileirarJobProspeccao('prospeccao_places_auto', payload)
      res.json({ job })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/jobs/consumir', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultados = await consumirJobsProspeccao(req.body?.limit || 5)
      res.json({ resultados })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/jobs/status', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const status = await obterStatusJobsProspeccao()
      res.json(status)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/auto-config', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const config = await obterConfiguracaoAutoProspeccao()
      const limite = limiteBuscaPlacesParaConfig(config)
      const planejamento_busca = await resolverPlanejamentoBuscaAuto({
        limit: limite,
        categoria: config?.categoria || null,
      })
      res.json({ config, agenda: montarAgendaPainelAutoProspeccao(config), planejamento_busca })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.put('/dashboard/prospeccao/auto-config', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const config = await salvarConfiguracaoAutoProspeccao(req.body || {})
      const limite = limiteBuscaPlacesParaConfig(config)
      const planejamento_busca = await resolverPlanejamentoBuscaAuto({
        limit: limite,
        categoria: config?.categoria || null,
      })
      res.json({ config, agenda: montarAgendaPainelAutoProspeccao(config), planejamento_busca })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/auto-config/run-now', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const config = await obterConfiguracaoAutoProspeccao()
      if (!config) throw new Error('Configuracao de auto-prospeccao indisponivel.')
      const limite = config.rodada_diaria ? (calcularLimiteDiario(config) || config.limit) : config.limit
      const dedupeBase = `prospeccao_auto_manual:${Date.now()}`
      await enfileirarJobProspeccao('prospeccao_nichos_sync', { trigger: 'manual-auto' }, `${dedupeBase}:sync`)
      await enfileirarJobProspeccao(
        'prospeccao_places_auto',
        { trigger: 'manual-auto', limit: limite, categoria: config.categoria || null },
        `${dedupeBase}:places`
      )
      res.json({ ok: true, limite_usado: limite })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/metricas', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const metricas = await obterMetricasProspeccao()
      res.json({ metricas })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })
}

module.exports = {
  DEFAULT_FIELD_MASK,
  atualizarMensagemEditada,
  atualizarStatusProspect,
  atualizarStatusProspectsLote,
  calcularScoreProspect,
  consumirJobsProspeccao,
  enfileirarJobProspeccao,
  enviarProspectsAprovados,
  processarFluxoCompleto,
  gerarDiagnosticos,
  buscarContextoProspeccao,
  listarProspects,
  marcarProspectComoRespondeuPorNumero,
  mapearPlace,
  normalizarProspectParaPersistencia,
  executarJobProspeccao,
  obterMetricasProspeccao,
  obterConfiguracaoAutoProspeccao,
  obterJanelaSemanal,
  montarAgendaPainelAutoProspeccao,
  obterStatusJobsProspeccao,
  pesquisarPlaces,
  proximoSlotComercial,
  registerProspectingRoutes,
  resolverPlanejamentoBuscaAuto,
  salvarConfiguracaoAutoProspeccao,
  salvarProspect,
  salvarProspects,
  sincronizarNichosPerformantes,
  substituirPlaceholderEmpresa,
  temPlaceholderResidual,
  verificarAgendaAutoProspeccao,
}
