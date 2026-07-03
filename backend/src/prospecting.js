'use strict'

const axios = require('axios')
const crypto = require('crypto')
const { pool } = require('./db')
const aiProvider = require('./ai-provider')
const { enviarMensagem, classificarErroEvolution, verificarStatusInstanciaEvolution } = require('./whatsapp')
const { registrarEnvioNoHistorico } = require('./services/historico-envio')
const { calcularScoreCadastroPlaces, montarJsonApresentacaoPlaces } = require('./services/lead-score-cadastro')
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
const { prospectingIntelligenceEnabled } = require('./config')
const {
  obterConfiguracaoProspeccao,
  salvarConfiguracaoProspeccao,
  montarAgendaPainelProspeccao,
} = require('./services/prospecting-settings')
const { buscaProspeccaoDevePreencher } = require('./services/prospecting-search-scheduler')
const {
  canProspectLead,
} = require('./services/prospecting-eligibility')
const { extrairEmailDeUrl } = require('./services/social-contact-extract')
const {
  criarFilaDiariaSimulada,
  listarExecucoesDiarias,
  obterPainelFilaDiaria,
  cancelarItemFilaDiaria,
  pausarExecucaoDiaria,
  listarBloqueiosProspeccao,
} = require('./services/prospecting-daily-queue')
const {
  simularFilaDiariaComPlaces,
} = require('./services/prospecting-places-queue')
const {
  gerarMensagemParaItemFila,
  editarMensagemItemFila,
} = require('./services/prospecting-message-generation')
const {
  processarEnvioFilaAgendado,
  prepararItemFilaParaJobEnvio,
  marcarJobAgendadoNaFila,
} = require('./services/prospecting-send-worker')
const {
  gerarRelatorioDiarioProspeccao,
  obterRelatorioDiarioProspeccao,
  enviarRelatorioDiarioOperadores,
} = require('./services/prospecting-daily-report')
const {
  obterDashboardEstrategicoProspeccao,
} = require('./services/prospecting-performance-analytics')

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
  // Pontuação de cadastro (lead-score-cadastro): fotos e horário de funcionamento.
  // Ambos dentro dos SKUs já usados (Pro/Enterprise) — não muda o tier de cobrança.
  'places.photos',
  'places.regularOpeningHours',
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
  // Alvo total de resultados; a busca pagina em páginas de até 20 (limite da API).
  return normalizarInteiro(v, 10, 1, 60)
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

function normalizarNumeroWhatsapp(numero) {
  let digits = normalizarTelefone(String(numero == null ? '' : numero).replace(/@s\.whatsapp\.net$/i, ''))
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) digits = `55${digits}`
  return digits
}

function mascararNumero(numero) {
  const n = normalizarNumeroWhatsapp(numero)
  if (!n) return ''
  return `${n.slice(0, 2)}***${n.slice(-4)}`
}

/**
 * Gera as variações plausíveis de um número BR (só dígitos) para casar telefones
 * armazenados em formatos diferentes: com/sem 9º dígito móvel e com/sem prefixo 55.
 * Usado no match prospect↔webhook, onde o JID nem sempre bate exato com o telefone
 * vindo do Places. Match por igualdade em QUALQUER candidato (escopo: prospects
 * já enviados → risco de falso-positivo baixíssimo).
 */
function candidatosTelefoneBR(numero) {
  let d = normalizarTelefone(String(numero == null ? '' : numero).replace(/@s\.whatsapp\.net$/i, ''))
  if (!d) return []
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) d = `55${d}`
  const set = new Set([d])
  if (d.length === 13 && d.charAt(4) === '9') set.add(d.slice(0, 4) + d.slice(5)) // remove 9º dígito
  if (d.length === 12) set.add(`${d.slice(0, 4)}9${d.slice(4)}`)                   // adiciona 9º dígito
  for (const v of [...set]) if (v.startsWith('55')) set.add(v.slice(2))            // variante sem 55
  return [...set].filter(Boolean)
}

function hashMensagem(mensagem) {
  return crypto.createHash('sha256').update(String(mensagem || '')).digest('hex').slice(0, 16)
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

// ── Fase 1: esteira inteligente ───────────────────────────────────────────────

/**
 * Score multidimensional V2 (0-100).
 * Aceita tanto um objeto bruto do Places quanto um prospect já persistido.
 * Compatível com flag desligada: pode ser chamada mesmo sem PROSPECTING_INTELLIGENCE_ENABLED.
 */
function calcularScoreV2(prospect) {
  const motivos = []

  // ── presenca_digital (0-25) ──────────────────────────────────────────────
  let presenca_digital = 0
  const temSite = !!(prospect.websiteUri || prospect.site || prospect.tem_site)
  if (!temSite) {
    presenca_digital = 25
    motivos.push('sem presenca digital propria')
  } else {
    // Tem site mas pode ser básico (inferência simples sem scraping)
    presenca_digital = 5
    motivos.push('tem site (oportunidade de melhoria)')
  }

  // ── reputacao (0-25) ─────────────────────────────────────────────────────
  let reputacao = 0
  const rating = Number(prospect.rating || 0)
  const reviews = Number(prospect.userRatingCount || prospect.avaliacoes || 0)
  if (rating >= 4.5 && reviews >= 50) {
    reputacao = 25
    motivos.push(`reputacao consolidada (${rating} com ${reviews} reviews)`)
  } else if (rating >= 4.5) {
    reputacao = 18
    motivos.push(`nota excelente ${rating}`)
  } else if (rating >= 4.0) {
    reputacao = 13
    motivos.push(`boa nota ${rating}`)
  } else if (rating >= 3.5) {
    reputacao = 7
    motivos.push(`nota razoavel ${rating}`)
  } else if (rating > 0) {
    reputacao = 3
    motivos.push(`nota baixa ${rating}`)
  }
  if (reviews >= 100) {
    reputacao = Math.min(25, reputacao + 5)
    motivos.push(`${reviews} reviews (alto volume)`)
  } else if (reviews >= 20) {
    reputacao = Math.min(25, reputacao + 3)
  }

  // ── potencial_conversao (0-20) ────────────────────────────────────────────
  let potencial_conversao = 0
  const temTelefone = !!(
    prospect.internationalPhoneNumber ||
    prospect.nationalPhoneNumber ||
    prospect.telefone
  )
  if (temTelefone) {
    potencial_conversao += 12
    motivos.push('telefone disponivel')
  }
  const tipos = Array.isArray(prospect.types) ? prospect.types : []
  const categoriaPrimaria = String(
    (prospect.primaryTypeDisplayName && (prospect.primaryTypeDisplayName.text || prospect.primaryTypeDisplayName)) ||
    prospect.categoria ||
    ''
  ).toLowerCase()
  const nichoLocal = prospect.nicho ? String(prospect.nicho).toLowerCase() : ''
  const NICHOS_ALTA_DEMANDA = [
    'restaurant', 'beauty_salon', 'hair_care', 'gym', 'dentist',
    'lawyer', 'real_estate', 'contractor', 'plumber', 'electrician',
    'clinic', 'health', 'auto_repair', 'barber', 'spa',
    'barbearia', 'salao', 'clinica', 'dentista', 'advocacia',
    'imobiliaria', 'eletricista', 'mecanica', 'academia', 'restaurante',
    'pizzaria', 'hamburgueria', 'estetica', 'pet', 'oficina',
  ]
  const ehNichoAlta =
    NICHOS_ALTA_DEMANDA.some((n) => categoriaPrimaria.includes(n)) ||
    NICHOS_ALTA_DEMANDA.some((n) => nichoLocal.includes(n)) ||
    tipos.some((t) => NICHOS_ALTA_DEMANDA.some((n) => String(t).toLowerCase().includes(n)))
  if (ehNichoAlta) {
    potencial_conversao += 8
    motivos.push('nicho com alta demanda digital')
  }

  // ── urgencia (0-20) ───────────────────────────────────────────────────────
  let urgencia = 0
  // businessStatus pode vir do Places (bruto) ou do raw_json em prospects persistidos
  const rawBusinessStatus =
    prospect.businessStatus ||
    (prospect.raw_json && typeof prospect.raw_json === 'object' ? prospect.raw_json.businessStatus : '') ||
    ''
  const operacional = !rawBusinessStatus || rawBusinessStatus === 'OPERATIONAL'
  if (operacional) {
    urgencia += 10
  } else {
    motivos.push('negocio nao operacional (penalidade)')
  }
  // Nicho performante vindo da base (campo opcional injetado pelo caller)
  if (prospect._nicho_performante === true) {
    urgencia += 10
    motivos.push('nicho com historico de conversao')
  }

  // ── fit_solucao (0-10) ────────────────────────────────────────────────────
  let fit_solucao = 0
  const SOLUCOES_CONHECIDAS = [
    'barbearia', 'salao', 'clinica', 'dentista', 'advocacia', 'imobiliaria',
    'eletricista', 'mecanica', 'academia', 'restaurante', 'pizzaria',
    'hamburgueria', 'estetica', 'pet shop', 'oficina', 'construtora',
    'pintor', 'encanador', 'marcenaria', 'serralheria', 'vidracaria',
    'farmacia', 'laboratorio', 'psicologo', 'fisioterapia', 'nutricionista',
    'contador', 'escola', 'creche', 'autoescola',
  ]
  if (SOLUCOES_CONHECIDAS.some((s) => nichoLocal.includes(s) || categoriaPrimaria.includes(s))) {
    fit_solucao = 10
    motivos.push('nicho com solucao mapeada pela {{empresa}}')
  } else if (categoriaPrimaria && categoriaPrimaria !== 'establishment' && categoriaPrimaria !== 'point_of_interest') {
    fit_solucao = 5
    motivos.push('categoria primaria identificada')
  }

  // ── penalidade global ─────────────────────────────────────────────────────
  const penalidade = operacional ? 0 : 30

  const score_v2 = Math.max(
    0,
    Math.min(100, presenca_digital + reputacao + potencial_conversao + urgencia + fit_solucao - penalidade)
  )

  let classificacao
  if (score_v2 >= 80) classificacao = 'alto'
  else if (score_v2 >= 60) classificacao = 'medio'
  else if (score_v2 >= 40) classificacao = 'baixo'
  else classificacao = 'desqualificado'

  return {
    score_v2,
    score_dimensoes: {
      presenca_digital,
      reputacao,
      potencial_conversao,
      urgencia,
      fit_solucao,
    },
    classificacao,
    motivos,
  }
}

/**
 * Acrescenta uma entrada no decision_log do prospect (append-only).
 * Nunca sobrescreve entradas existentes.
 */
async function registrarDecisionLog(prospectId, entrada) {
  const safeId = typeof prospectId === 'string' ? prospectId.trim() : null
  if (!safeId) return

  const entradaSafe = {
    acao: String(entrada?.acao || 'desconhecida'),
    origem: entrada?.origem === 'operador' ? 'operador' : 'sistema',
    operador_ou_sistema: String(entrada?.operador_ou_sistema || 'sistema'),
    ts: entrada?.ts || new Date().toISOString(),
    contexto: entrada?.contexto && typeof entrada.contexto === 'object' ? entrada.contexto : {},
  }

  await pool.query(
    `
    UPDATE prospectador.prospects
    SET decision_log = COALESCE(decision_log, '[]'::jsonb) || $2::jsonb,
        updated_at = NOW()
    WHERE id = $1::uuid
    `,
    [safeId, JSON.stringify([entradaSafe])]
  )
}

/**
 * Valida se um prospect pode ser enviado.
 * Quando prospectingIntelligenceEnabled() = false, retorna { ok: true } imediatamente.
 * Quando habilitado, aplica todas as regras da nova esteira.
 */
async function validarProspectAntesDoEnvio(prospect, diagnostico) {
  if (!prospectingIntelligenceEnabled()) {
    return { ok: true }
  }

  const erros = []

  // 1. Status aprovado
  if (prospect?.status !== 'aprovado') {
    erros.push('status_nao_aprovado')
  }

  // 2. Aprovação humana no decision_log — requer acao='aprovacao_humana' e origem='operador'
  const decisionLog = Array.isArray(prospect?.decision_log) ? prospect.decision_log : []
  const temAprovacaoHumana = decisionLog.some(
    (e) => e?.acao === 'aprovacao_humana' && e?.origem === 'operador'
  )
  if (!temAprovacaoHumana) {
    erros.push('sem_aprovacao_humana_no_decision_log')
  }

  // 3. diagnostico_json presente (quando flag ativa, exige diagnóstico estruturado)
  if (!diagnostico?.diagnostico_json && !diagnostico?.dor_principal) {
    erros.push('sem_diagnostico')
  }

  // 4. Telefone existe
  const telefone = normalizarTelefone(prospect?.telefone)
  if (!telefone) {
    erros.push('sem_telefone')
  }

  // 5. Opt-out
  if (telefone) {
    try {
      const { rows } = await pool.query(
        `SELECT opt_out FROM prospectador.contato_politicas WHERE regexp_replace(telefone, '\\D', '', 'g') = $1 LIMIT 1`,
        [telefone]
      )
      if (rows[0]?.opt_out === true) {
        erros.push('opt_out')
      }
    } catch (_) {
      // Tabela pode não existir em ambiente de teste — ignora silenciosamente
    }
  }

  // 6. Sem envio anterior (idempotência)
  if (prospect?.id && telefone) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM prospectador.send_attempts WHERE prospect_id = $1::uuid AND status = 'sent' LIMIT 1`,
        [prospect.id]
      )
      if (rows.length > 0) {
        erros.push('ja_enviado_anteriormente')
      }
    } catch (_) {}
  }

  // 7. Número não está ativo no funil
  if (telefone) {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM vendas.conversas WHERE numero = $1 AND status != 'encerrado' LIMIT 1`,
        [telefone]
      )
      if (rows.length > 0) {
        erros.push('numero_ativo_no_funil')
      }
    } catch (_) {
      // Tabela pode não existir em testes — ignora silenciosamente
    }
  }

  if (erros.length > 0) {
    logger.warn({
      operation: 'PROSPECTING_INTELLIGENCE',
      etapa: 'validar_antes_do_envio',
      prospect_id: prospect?.id || null,
      flag_enabled: true,
      decisao: 'bloqueado',
      motivo: erros,
      score_v2: prospect?.score_v2 ?? null,
      oferta_recomendada: prospect?.oferta_recomendada ?? null,
    })
    return { ok: false, erros }
  }

  logger.info({
    operation: 'PROSPECTING_INTELLIGENCE',
    etapa: 'validar_antes_do_envio',
    prospect_id: prospect?.id || null,
    flag_enabled: true,
    decisao: 'liberado',
    score_v2: prospect?.score_v2 ?? null,
    oferta_recomendada: prospect?.oferta_recomendada ?? null,
  })
  return { ok: true }
}

// ── Fase 2: pipeline de diagnóstico inteligente ──────────────────────────────

const DIAGNOSTIC_PROMPT_VERSION = 'prospecting_diagnostic_v2_2026_05'
const MESSAGE_PROMPT_VERSION = 'prospecting_message_v2_2026_05'
const OFERTAS_VALIDAS_V2 = new Set([
  'site_profissional', 'redesign', 'seo_local', 'site_sistema', 'automacao_agente', 'plano_inicial',
])
const MOTIVOS_REJEICAO_V2 = new Set([
  'fora_do_perfil', 'ja_tem_site_bom', 'sem_potencial',
  'nicho_saturado', 'telefone_invalido', 'duplicado', 'outros',
])

// Nichos que indicam agendamento ou serviço recorrente → site_sistema
const NICHOS_AGENDAMENTO_V2 = [
  'salao', 'barbearia', 'clinica', 'estetica', 'odontologia', 'petshop', 'pet shop',
  'oficina', 'academia', 'fisioterapia', 'psicologo', 'nutricionista', 'medic', 'dent',
  'tattoo', 'manicure', 'depilacao', 'podolog', 'quiroprax',
]

// Nichos de alto volume de atendimento repetitivo → automacao_agente
const NICHOS_AUTOMACAO_V2 = [
  'restaurante', 'pizzaria', 'hamburgueria', 'lanchonete', 'delivery', 'distribuidora',
  'imobiliaria', 'seguradora', 'advocacia', 'contabilidade', 'escola', 'autoescola',
  'concessionaria', 'farmacia', 'laboratorio', 'suporte', 'manutencao', 'conserto',
]

/**
 * Persiste score_v2 e score_dimensoes no banco após salvar um prospect.
 * Registra entrada no decision_log. No-op quando flag desligada.
 */
async function persistirScoreV2Prospect(prospectId, prospectOriginal) {
  if (!prospectId || !prospectingIntelligenceEnabled()) return null
  try {
    const scoreResult = calcularScoreV2(prospectOriginal)
    await pool.query(
      `UPDATE prospectador.prospects SET score_v2=$1, score_dimensoes=$2::jsonb, updated_at=NOW() WHERE id=$3::uuid`,
      [scoreResult.score_v2, JSON.stringify(scoreResult.score_dimensoes), prospectId]
    )
    await registrarDecisionLog(prospectId, {
      acao: 'score_v2_calculado',
      origem: 'sistema',
      operador_ou_sistema: 'prospecting_intelligence',
      ts: new Date().toISOString(),
      contexto: {
        score_v2: scoreResult.score_v2,
        classificacao: scoreResult.classificacao,
        motivos: scoreResult.motivos,
        score_dimensoes: scoreResult.score_dimensoes,
      },
    })
    logger.info({
      operation: 'PROSPECTING_INTELLIGENCE',
      etapa: 'score_v2_calculado',
      prospect_id: prospectId,
      flag_enabled: true,
      decisao: 'score_calculado',
      score_v2: scoreResult.score_v2,
      oferta_recomendada: null,
    })
    return scoreResult
  } catch (err) {
    logger.warn({
      operation: 'PROSPECTING_INTELLIGENCE',
      etapa: 'score_v2_persist_erro',
      prospect_id: prospectId,
      erro: err.message,
    })
    return null
  }
}

/** Diagnóstico estruturado fallback (sem chamada de IA). */
function fallbackDiagnosticoEstruturado(prospect) {
  const temSite = !!(prospect.websiteUri || prospect.site || prospect.tem_site)
  const rating = Number(prospect.rating || 0)
  const reviews = Number(prospect.avaliacoes || prospect.userRatingCount || 0)
  return {
    segmento: normalizarTexto(prospect.nicho || 'negocio local', 80),
    perfil_digital: temSite ? 'basico' : 'ausente',
    dores_identificadas: [
      temSite ? 'site sem conversao digital clara' : 'ausencia de presenca digital propria',
    ],
    sinais_positivos: [
      ...(rating >= 4.0 ? [`nota ${rating} no Google`] : []),
      ...(reviews >= 20 ? [`${reviews} avaliacoes`] : []),
    ],
    oportunidade_principal: temSite
      ? 'melhorar conversao digital e visibilidade local'
      : 'criar canal digital de captacao de clientes',
    oferta_sugerida: 'site_profissional',
    motivo_oferta: 'sem dados suficientes para diagnostico completo',
    nivel_urgencia: 'media',
    confianca: 0.4,
    prompt_version: DIAGNOSTIC_PROMPT_VERSION,
    metadata_json: { provider: 'heuristico', fallback: true },
  }
}

/** Parseia e valida o JSON estruturado retornado pela IA. Retorna null se inválido. */
function parsearJsonDiagnosticoEstruturado(texto) {
  try {
    const raw = String(texto || '')
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.segmento !== 'string') return null
    if (!OFERTAS_VALIDAS_V2.has(parsed.oferta_sugerida)) return null
    if (!['ausente', 'basico', 'intermediario', 'avancado'].includes(parsed.perfil_digital)) return null
    if (!['alta', 'media', 'baixa'].includes(parsed.nivel_urgencia)) return null
    return parsed
  } catch (_) {
    return null
  }
}

/**
 * Gera diagnóstico TÉCNICO estruturado via IA (sem mensagem comercial).
 * Salvar resultado é responsabilidade do pipeline; esta função só retorna o objeto.
 */
async function gerarDiagnosticoEstruturado(prospect) {
  const fallback = fallbackDiagnosticoEstruturado(prospect)
  if (!process.env.ANTHROPIC_KEY) return fallback

  const temSite = !!(prospect.websiteUri || prospect.site || prospect.tem_site)
  const systemPrompt =
    'Voce e um analista de negocios digitais da {{empresa}}. ' +
    'Avalie o perfil digital do negocio local abaixo e retorne APENAS JSON valido sem markdown.'

  const userPrompt =
    `Analise o negocio local e retorne um diagnostico tecnico em JSON.\n\n` +
    `DADOS:\n` +
    `- nome: ${prospect.nome || ''}\n` +
    `- nicho: ${prospect.nicho || ''}\n` +
    `- cidade: ${prospect.cidade || ''}\n` +
    `- tem_site: ${temSite ? 'sim' : 'nao'}\n` +
    `- site: ${prospect.site || prospect.websiteUri || 'nao informado'}\n` +
    `- rating_google: ${prospect.rating ?? 'sem dados'}\n` +
    `- total_avaliacoes: ${prospect.avaliacoes ?? prospect.userRatingCount ?? 'sem dados'}\n` +
    `- endereco: ${prospect.endereco || ''}\n\n` +
    `CONTEXTO: A {{empresa}} oferece sites profissionais, SEO local, sistemas de agendamento, automacoes e agentes de IA para PMEs locais no Brasil.\n\n` +
    `RETORNE SOMENTE este JSON (sem texto fora do JSON):\n` +
    `{"segmento":"categoria em 1-3 palavras","perfil_digital":"ausente|basico|intermediario|avancado","dores_identificadas":["dor1","dor2"],"sinais_positivos":["sinal1"],"oportunidade_principal":"1 frase","oferta_sugerida":"site_profissional|redesign|seo_local|site_sistema|automacao_agente|plano_inicial","motivo_oferta":"1 frase","nivel_urgencia":"alta|media|baixa","confianca":0.0}\n\n` +
    `REGRAS:\n` +
    `- Baseie-se APENAS nos dados acima. Nao invente.\n` +
    `- perfil_digital: "ausente" se sem site; "basico" se site simples/desatualizado.\n` +
    `- confianca: 0.4 a 0.9 tipicamente.\n` +
    `- Nao mencione valores monetarios.`

  try {
    const aiResult = await aiProvider.generateAIResponse(
      { systemPrompt, userPrompt, task: 'prospeccao_diagnostico_v2', temperature: 0.2, maxTokens: 600, timeoutMs: 25000, responseFormatJson: true },
      pool,
      null
    )
    const parsed = parsearJsonDiagnosticoEstruturado(aiResult.text)
    if (!parsed) {
      logger.warn({ operation: 'PROSPECTING_INTELLIGENCE', etapa: 'diagnostico_v2_json_invalido', prospect_id: prospect.id || null })
      return fallback
    }
    return {
      segmento: normalizarTexto(parsed.segmento, 80) || fallback.segmento,
      perfil_digital: parsed.perfil_digital,
      dores_identificadas: Array.isArray(parsed.dores_identificadas)
        ? parsed.dores_identificadas.slice(0, 5).map((d) => normalizarTexto(d, 200)).filter(Boolean)
        : fallback.dores_identificadas,
      sinais_positivos: Array.isArray(parsed.sinais_positivos)
        ? parsed.sinais_positivos.slice(0, 5).map((s) => normalizarTexto(s, 200)).filter(Boolean)
        : fallback.sinais_positivos,
      oportunidade_principal: normalizarTexto(parsed.oportunidade_principal, 300) || fallback.oportunidade_principal,
      oferta_sugerida: OFERTAS_VALIDAS_V2.has(parsed.oferta_sugerida) ? parsed.oferta_sugerida : fallback.oferta_sugerida,
      motivo_oferta: normalizarTexto(parsed.motivo_oferta, 300) || fallback.motivo_oferta,
      nivel_urgencia: parsed.nivel_urgencia,
      confianca: Math.max(0, Math.min(1, Number(parsed.confianca) || 0.5)),
      prompt_version: DIAGNOSTIC_PROMPT_VERSION,
      metadata_json: { provider: aiResult.provider, model: aiResult.model },
    }
  } catch (err) {
    logger.warn({ operation: 'PROSPECTING_INTELLIGENCE', etapa: 'diagnostico_v2_erro', erro: err.message, prospect_id: prospect.id || null })
    return fallback
  }
}

/**
 * Roteia a oferta da {{empresa}} com lógica determinística.
 * A sugestão da IA é usada apenas quando nenhuma regra determinística se aplica.
 */
function rotearOferta(prospect, diagnosticoJson, scoreV2) {
  const nicho = String(prospect.nicho || '').toLowerCase()
  const temSite = !!(prospect.tem_site || prospect.site || prospect.websiteUri)
  const ofertaIA = diagnosticoJson?.oferta_sugerida || null
  const perfilDigital = diagnosticoJson?.perfil_digital || null
  const dores = Array.isArray(diagnosticoJson?.dores_identificadas) ? diagnosticoJson.dores_identificadas : []
  const score = Number(scoreV2 || 0)
  const confirmaIA = (oferta) => (ofertaIA === oferta ? 'ia_confirmada' : 'deterministica')

  // R1: sem site + score >= 60 → site_profissional
  if (!temSite && score >= 60) {
    return { oferta_recomendada: 'site_profissional', motivo_rota: 'sem_site_score_alto', fonte: confirmaIA('site_profissional') }
  }

  // R2: tem site + perfil básico → redesign
  if (temSite && perfilDigital === 'basico') {
    return { oferta_recomendada: 'redesign', motivo_rota: 'site_perfil_basico', fonte: confirmaIA('redesign') }
  }

  // R3: tem site + dor de baixa presença local/Google → seo_local
  const dorPresenca = dores.some((d) => /google|local|maps|busca|encontrar|aparecer|visibilidade/i.test(String(d)))
  if (temSite && dorPresenca) {
    return { oferta_recomendada: 'seo_local', motivo_rota: 'dor_presenca_local', fonte: confirmaIA('seo_local') }
  }

  // R4: nicho de agendamento / serviço recorrente → site_sistema
  if (NICHOS_AGENDAMENTO_V2.some((n) => nicho.includes(n))) {
    return { oferta_recomendada: 'site_sistema', motivo_rota: 'nicho_agendamento_ou_servico_recorrente', fonte: confirmaIA('site_sistema') }
  }

  // R5: nicho de alto volume / atendimento repetitivo → automacao_agente
  if (NICHOS_AUTOMACAO_V2.some((n) => nicho.includes(n))) {
    return { oferta_recomendada: 'automacao_agente', motivo_rota: 'nicho_volume_alto_ou_atendimento_repetitivo', fonte: confirmaIA('automacao_agente') }
  }

  // R6: score entre 40–59 → plano_inicial
  if (score >= 40 && score < 60) {
    return { oferta_recomendada: 'plano_inicial', motivo_rota: 'score_baixo_40_59', fonte: confirmaIA('plano_inicial') }
  }

  // Fallback: sugestão da IA se válida
  if (ofertaIA && OFERTAS_VALIDAS_V2.has(ofertaIA)) {
    return { oferta_recomendada: ofertaIA, motivo_rota: 'ia_sem_regra_deterministica', fonte: 'ia_confirmada' }
  }

  return { oferta_recomendada: 'site_profissional', motivo_rota: 'fallback_padrao', fonte: 'fallback' }
}

/** Mensagem de fallback sem chamada de IA. */
function montarMensagemComercialV2Fallback(prospect, diagnosticoJson, ofertaRecomendada) {
  const nome = prospect.nome || 'sua empresa'
  const nicho = prospect.nicho || 'seu segmento'
  const temSite = !!(prospect.tem_site || prospect.site || prospect.websiteUri)
  const sinal = (diagnosticoJson?.sinais_positivos || [])[0] || ''
  const dor = (diagnosticoJson?.dores_identificadas || [])[0] ||
    (temSite ? 'conversao digital abaixo do potencial' : 'ausencia de presenca digital')

  const parteOferta = {
    site_profissional: 'Temos uma estrutura de site profissional que pode ajudar a converter essa procura em contatos reais.',
    redesign: 'Podemos revisar o site atual para melhorar conversao e autoridade digital.',
    seo_local: 'Podemos trabalhar o posicionamento no Google Maps e nas buscas locais.',
    site_sistema: 'Temos uma solucao de site com agendamento integrado, ideal para esse segmento.',
    automacao_agente: 'Podemos estruturar automacao de atendimento para nao perder contatos no WhatsApp.',
    plano_inicial: 'Temos uma solucao acessivel para dar o primeiro passo na presenca digital.',
  }

  const intro = sinal
    ? `Opa, tudo bem? Sou da {{empresa}}. Vi a ${nome} no Google e notei ${sinal.toLowerCase()}.`
    : `Opa, tudo bem? Sou da {{empresa}}. Vi a ${nome} no Google — ${nicho}.`

  return (
    `${intro} ` +
    `Empresas de ${nicho} costumam ter desafio com ${dor}. ` +
    `${parteOferta[ofertaRecomendada] || parteOferta.site_profissional} ` +
    `Preparei uma analise rapida sobre a presenca digital de voces. Posso te mandar?`
  ).slice(0, 600)
}

/**
 * Gera a mensagem comercial de WhatsApp (Fase 2).
 * Função separada do diagnóstico técnico.
 * Posiciona a {{empresa}} como empresa de soluções digitais completas.
 */
async function gerarMensagemComercialV2(prospect, diagnosticoJson, ofertaRecomendada) {
  const fallbackMsg = montarMensagemComercialV2Fallback(prospect, diagnosticoJson, ofertaRecomendada)
  if (!process.env.ANTHROPIC_KEY) {
    return { mensagem: fallbackMsg, prompt_version: MESSAGE_PROMPT_VERSION, provider: 'heuristico' }
  }

  const temSite = !!(prospect.tem_site || prospect.site || prospect.websiteUri)
  const rating = prospect.rating ? `nota ${prospect.rating}` : ''
  const reviews = Number(prospect.avaliacoes || prospect.userRatingCount || 0)
  const dor = (diagnosticoJson?.dores_identificadas || [])[0] ||
    (temSite ? 'site sem conversao digital clara' : 'ausencia de presenca digital')
  const sinal = (diagnosticoJson?.sinais_positivos || [])[0] ||
    (reviews >= 20 ? `${reviews} avaliacoes no Google` : '')

  const OFERTA_LABEL = {
    site_profissional: 'site profissional para converter visitantes em clientes',
    redesign: 'modernizacao do site atual para melhorar conversao',
    seo_local: 'posicionamento no Google Maps e busca local',
    site_sistema: 'site integrado com sistema de agendamento',
    automacao_agente: 'automacao de atendimento para nao perder contatos no WhatsApp',
    plano_inicial: 'solucao inicial acessivel para comecar a presenca digital',
  }

  const systemPrompt =
    'Voce escreve mensagens de WhatsApp em nome da {{empresa}}, empresa de solucoes digitais ' +
    '(sites, SEO local, automacoes, sistemas e agentes de IA) para PMEs locais no Brasil. ' +
    'Tom: humano, consultivo, nao-invasivo. Nunca prometa resultados. Nunca mencione valores.'

  const userPrompt =
    `Escreva uma mensagem de primeiro contato via WhatsApp.\n\n` +
    `PROSPECT:\n` +
    `- empresa: ${prospect.nome || 'empresa'} (${prospect.nicho || 'negocio'} em ${prospect.cidade || 'sua cidade'})\n` +
    `- tem site: ${temSite ? 'sim' : 'nao'}\n` +
    (rating ? `- reputacao: ${rating}${reviews >= 20 ? ` com ${reviews} avaliacoes` : ''}\n` : '') +
    `- dor principal: ${dor}\n` +
    (sinal ? `- sinal positivo: ${sinal}\n` : '') +
    `- solucao recomendada: ${OFERTA_LABEL[ofertaRecomendada] || ofertaRecomendada}\n\n` +
    `REGRAS ABSOLUTAS:\n` +
    `1. Diga "Sou da {{empresa}}" na abertura.\n` +
    `2. Maximo 500 caracteres. Prefira 350-480.\n` +
    `3. Sem bullets, sem listas, texto corrido.\n` +
    `4. Estrutura: saudacao + referencia real ao prospect + dor do nicho + mencao a analise preparada + pedido de permissao.\n` +
    `5. NUNCA: prometer crescimento, citar preco, pedir reuniao/ligacao, mais de 1 emoji, placeholders entre [].\n` +
    `6. Termine com "Posso te mandar?" ou variacao.\n\n` +
    `Retorne APENAS o texto da mensagem, sem aspas, sem JSON.`

  try {
    const aiResult = await aiProvider.generateAIResponse(
      { systemPrompt, userPrompt, task: 'prospeccao_mensagem_v2', temperature: 0.4, maxTokens: 220, timeoutMs: 20000 },
      pool,
      null
    )
    const mensagem = normalizarTexto(aiResult.text.trim(), 600)
    if (!mensagem || mensagem.length < 30) {
      return { mensagem: fallbackMsg, prompt_version: MESSAGE_PROMPT_VERSION, provider: 'fallback' }
    }
    return { mensagem, prompt_version: MESSAGE_PROMPT_VERSION, provider: aiResult.provider, model: aiResult.model }
  } catch (err) {
    logger.warn({ operation: 'PROSPECTING_INTELLIGENCE', etapa: 'mensagem_v2_erro', erro: err.message, prospect_id: prospect.id || null })
    return { mensagem: fallbackMsg, prompt_version: MESSAGE_PROMPT_VERSION, provider: 'fallback' }
  }
}

/** Salva um diagnóstico V2 com diagnostico_json e prompt_version. */
async function salvarDiagnosticoV2(prospectId, dados) {
  const safeId = normalizarId(prospectId)
  if (!safeId) {
    const err = new Error('Prospect invalido para diagnostico V2.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.diagnosticos (
      prospect_id, dor_principal, perda_estimada, mensagem_gerada, metadata_json,
      diagnostico_json, prompt_version
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
    RETURNING *
    `,
    [
      safeId,
      normalizarTexto(dados?.dor_principal, 500) || null,
      Number(dados?.perda_estimada) || null,
      normalizarTexto(dados?.mensagem_gerada, 4000) || null,
      JSON.stringify(dados?.metadata_json || {}),
      dados?.diagnostico_json != null ? JSON.stringify(dados.diagnostico_json) : null,
      dados?.prompt_version || null,
    ]
  )
  return diagnosticoPersistido(rows[0])
}

/**
 * Orquestra o pipeline completo de diagnóstico V2:
 * score → diagnóstico técnico → roteamento de oferta → mensagem comercial → persistência.
 * O prospect permanece em status 'aguardando' (sem aprovação automática).
 */
async function gerarPipelineDiagnosticoV2(prospect) {
  const prospectId = prospect.id

  // 1. Score V2: calcula e persiste somente se ainda não estava salvo
  const scoreAtual = prospect.score_v2
  let scoreResult = calcularScoreV2(prospect)
  if (scoreAtual === null || scoreAtual === undefined) {
    try {
      await pool.query(
        `UPDATE prospectador.prospects SET score_v2=$1, score_dimensoes=$2::jsonb, updated_at=NOW() WHERE id=$3::uuid`,
        [scoreResult.score_v2, JSON.stringify(scoreResult.score_dimensoes), prospectId]
      )
      await registrarDecisionLog(prospectId, {
        acao: 'score_v2_calculado',
        origem: 'sistema',
        operador_ou_sistema: 'prospecting_intelligence',
        ts: new Date().toISOString(),
        contexto: {
          score_v2: scoreResult.score_v2,
          classificacao: scoreResult.classificacao,
          motivos: scoreResult.motivos,
          score_dimensoes: scoreResult.score_dimensoes,
        },
      })
    } catch (e) {
      logger.warn({ operation: 'PROSPECTING_INTELLIGENCE', etapa: 'score_v2_persist_erro', erro: e.message })
    }
  } else {
    scoreResult = { ...scoreResult, score_v2: Number(scoreAtual) }
  }

  // 2. Diagnóstico técnico estruturado (sem mensagem comercial)
  const diagnosticoJson = await gerarDiagnosticoEstruturado(prospect)

  // 3. Roteamento determinístico de oferta
  const rota = rotearOferta(prospect, diagnosticoJson, scoreResult.score_v2)

  // 4. Persiste oferta roteada e registra decision_log
  try {
    await pool.query(
      `UPDATE prospectador.prospects SET oferta_recomendada=$1, updated_at=NOW() WHERE id=$2::uuid`,
      [rota.oferta_recomendada, prospectId]
    )
    await registrarDecisionLog(prospectId, {
      acao: 'oferta_roteada',
      origem: 'sistema',
      operador_ou_sistema: 'prospecting_intelligence',
      ts: new Date().toISOString(),
      contexto: {
        oferta_recomendada: rota.oferta_recomendada,
        motivo_rota: rota.motivo_rota,
        oferta_sugerida_ia: diagnosticoJson.oferta_sugerida,
      },
    })
  } catch (e) {
    logger.warn({ operation: 'PROSPECTING_INTELLIGENCE', etapa: 'oferta_persist_erro', erro: e.message })
  }

  // 5. Mensagem comercial V2 (chamada separada do diagnóstico)
  const msgResult = await gerarMensagemComercialV2(prospect, diagnosticoJson, rota.oferta_recomendada)

  // 6. Persiste diagnóstico V2 completo
  const perdaEstimada = calcularPerdaEstimadaProspect(prospect)
  const salvo = await salvarDiagnosticoV2(prospectId, {
    dor_principal: diagnosticoJson.dores_identificadas?.[0] || diagnosticoJson.oportunidade_principal || 'baixa conversao digital',
    perda_estimada: perdaEstimada,
    mensagem_gerada: msgResult.mensagem,
    metadata_json: {
      provider: diagnosticoJson.metadata_json?.provider || msgResult.provider,
      model: diagnosticoJson.metadata_json?.model || null,
      oferta: rota.oferta_recomendada,
      rota_fonte: rota.fonte,
    },
    diagnostico_json: diagnosticoJson,
    prompt_version: diagnosticoJson.prompt_version,
  })

  await registrarProspectEvent(prospectId, 'diagnosticado_v2', {
    provider: diagnosticoJson.metadata_json?.provider || 'heuristico',
    oferta: rota.oferta_recomendada,
    score_v2: scoreResult.score_v2,
  }).catch(() => {})

  logger.info({
    operation: 'PROSPECTING_INTELLIGENCE',
    etapa: 'pipeline_diagnostico_v2_concluido',
    prospect_id: prospectId,
    flag_enabled: true,
    decisao: 'diagnostico_gerado',
    score_v2: scoreResult.score_v2,
    oferta_recomendada: rota.oferta_recomendada,
  })

  // Retorna objeto enriquecido; prospect permanece em status 'aguardando' (sem mudança de status)
  return {
    ...salvo,
    score_v2: scoreResult.score_v2,
    score_dimensoes: scoreResult.score_dimensoes,
    oferta_recomendada: rota.oferta_recomendada,
    diagnostico_json: diagnosticoJson,
    prompt_version: diagnosticoJson.prompt_version,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
  // empresa_id vem do contexto CRU (não passa pelo schema, que o descartaria);
  // fallback para a empresa padrão {{empresa}} quando não informado.
  const empresaId = (contexto && (contexto.empresaId || contexto.empresa_id)) || '00000000-0000-0000-0000-000000000001'
  return {
    empresa_id: empresaId,
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
      site, maps_url, place_id, origem, score, motivo_score, raw_json, empresa_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15::jsonb, $16
    )
    ON CONFLICT (empresa_id, place_id) DO UPDATE
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
      p.empresa_id,
    ]
  )
  return prospectPersistido(rows[0])
}

async function salvarProspects(prospects, contexto = {}) {
  const salvos = []
  for (const prospect of Array.isArray(prospects) ? prospects : []) {
    const salvo = await salvarProspect(prospect, contexto)
    if (salvo) {
      salvos.push(salvo)
      // Fase 2: persiste score_v2 usando dados originais do Places (têm businessStatus, websiteUri, etc.)
      await persistirScoreV2Prospect(salvo.id, prospect).catch(() => {})
    }
  }
  // Best-effort: tenta achar o e-mail no site do lead (não bloqueia a coleta se falhar).
  await enriquecerEmailPorSite(salvos).catch(() => {})
  return salvos
}

// Liga/desliga a extração automática de e-mail a partir do site do lead (default ON).
function extrairEmailSiteAtivo() {
  return String(process.env.PROSPEC_EXTRAIR_EMAIL_SITE || 'on').toLowerCase() !== 'off'
}

// Para cada lead salvo que tem site mas não tem e-mail, raspa o site atrás de um e-mail
// e grava (só se ainda estiver vazio). Concorrência limitada para proteger tempo/recursos.
async function enriquecerEmailPorSite(prospectsSalvos) {
  if (!extrairEmailSiteAtivo()) return
  const alvos = (Array.isArray(prospectsSalvos) ? prospectsSalvos : [])
    .filter((p) => p && p.id && p.site && !p.email)
  const CONCORRENCIA = 4
  for (let i = 0; i < alvos.length; i += CONCORRENCIA) {
    const lote = alvos.slice(i, i + CONCORRENCIA)
    await Promise.all(lote.map(async (p) => {
      try {
        const email = await extrairEmailDeUrl(p.site)
        if (!email) return
        await pool.query(
          `UPDATE prospectador.prospects SET email = $2, updated_at = NOW()
            WHERE id = $1::uuid AND email IS NULL`,
          [p.id, email]
        )
        p.email = email
      } catch { /* best-effort: ignora falha de fetch/parse */ }
    }))
  }
}

const RX_EMAIL_VALIDO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

// Atualiza (ou limpa, com string vazia) o e-mail de um lead. Escopo por empresa.
async function atualizarEmailProspect(empresaId, id, emailBruto) {
  const email = String(emailBruto == null ? '' : emailBruto).trim().toLowerCase()
  if (email && !RX_EMAIL_VALIDO.test(email)) {
    const e = new Error('E-mail inválido.'); e.statusCode = 400; throw e
  }
  const { rows } = await pool.query(
    `UPDATE prospectador.prospects SET email = $3, updated_at = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid
      RETURNING id, email`,
    [empresaId, id, email || null]
  )
  if (!rows[0]) { const e = new Error('Lead não encontrado.'); e.statusCode = 404; throw e }
  return rows[0]
}

async function listarProspects(filtros = {}) {
  const where = []
  const params = []
  // Escopo multiempresa: quando informado, lista só os prospects da empresa.
  if (filtros.empresaId) {
    params.push(filtros.empresaId)
    where.push(`p.empresa_id = $${params.length}`)
  }
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
  // Anexa a pontuação de CADASTRO (0-100, completude da presença digital) e o
  // JSON de apresentação (prompt unificado pro bot) — computados na leitura,
  // usando as colunas + raw_json (fotos/horário vêm do Places).
  return rows.map((row) => {
    const p = prospectPersistido(row)
    const cad = calcularScoreCadastroPlaces(row)
    return {
      ...p,
      score_cadastro: cad.score,
      score_cadastro_max: cad.maximo,
      score_cadastro_criterios: cad.criterios,
      json_apresentacao: montarJsonApresentacaoPlaces(row, cad),
    }
  })
}

async function atualizarStatusProspect(id, status, empresaId = null) {
  const safeId = normalizarId(id)
  const safeStatus = normalizarStatusProspect(status)
  if (!safeId || !['aprovado', 'rejeitado'].includes(safeStatus)) {
    const err = new Error('Status de prospect invalido.')
    err.statusCode = 400
    throw err
  }
  // Isolamento por tenant: quando empresaId é passado, só altera prospect DESTA empresa.
  const filtroEmpresa = empresaId ? ' AND empresa_id = $3' : ''
  const params = empresaId ? [safeId, safeStatus, empresaId] : [safeId, safeStatus]
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospects
    SET status = $2,
        updated_at = NOW()
    WHERE id = $1${filtroEmpresa}
    RETURNING *
    `,
    params
  )
  if (!rows[0]) {
    const err = new Error('Prospect nao encontrado.')
    err.statusCode = 404
    throw err
  }
  return prospectPersistido(rows[0])
}

async function atualizarStatusProspectsLote(ids, status, empresaId = null) {
  const safeStatus = normalizarStatusProspect(status)
  const safeIds = normalizarArrayIds(ids)
  if (!safeIds.length || !['aprovado', 'rejeitado'].includes(safeStatus)) {
    const err = new Error('Parametros invalidos para atualizacao em lote.')
    err.statusCode = 400
    throw err
  }
  // Isolamento por tenant: quando empresaId é passado, só altera prospects DESTA empresa.
  const filtroEmpresa = empresaId ? ' AND empresa_id = $3' : ''
  const params = empresaId ? [safeIds, safeStatus, empresaId] : [safeIds, safeStatus]
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospects
    SET status = $2,
        updated_at = NOW()
    WHERE id = ANY($1::uuid[])${filtroEmpresa}
    RETURNING *
    `,
    params
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
      `Opa, tudo bem? Sou da {{empresa}}. Vi a ${nome} no Google e gostei bastante da reputacao de voces em ${cidade}. ` +
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
  if (!process.env.ANTHROPIC_KEY) {
    return { ...montarMensagemDiagnosticoFallback(prospect, perdaEstimada), perda_estimada: perdaEstimada }
  }
  const systemPrompt =
    'Você é um especialista em diagnóstico de negócios locais para a {{empresa}}. ' +
    'Retorne APENAS JSON válido com as chaves solicitadas. Sem markdown, sem texto fora do JSON.'
  const userPrompt =
    `Voce escreve em nome da {{empresa}} (empresa de sites e presenca no Google para pequenos negocios) numa primeira mensagem fria de WhatsApp para um prospect captado no Google Maps.\n` +
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
    `1. Identidade: assine como "{{empresa}}" no corpo da mensagem ("Sou da {{empresa}}"). NUNCA escreva placeholders entre colchetes — proibido [Empresa], [Sua Empresa], [Nome da Empresa], [Nome], [Cidade], [Nicho] ou qualquer texto entre [ ]. Use diretamente os dados do prospect.\n` +
    `2. Tom consultivo, profissional, com cara de WhatsApp humano (NAO vendedor agressivo).\n` +
    `3. Comprimento: ate 4 linhas, no maximo 480 caracteres no total. Sem listas, sem bullets.\n` +
    `4. Estrutura obrigatoria em sequencia, sem misturar ideias:\n` +
    `   (a) saudacao curta + apresentacao "Sou da {{empresa}}";\n` +
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
        responseFormatJson: true,
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
  const porId = new Map(rows.map((r) => [r.id, r]))
  const saida = []
  for (const id of ids) {
    const row = porId.get(id)
    if (!row) continue
    const prospect = prospectPersistido(row)
    // Injeta colunas V2 do row bruto no prospect para que o pipeline as enxergue
    const prospectComV2 = {
      ...prospect,
      score_v2: row.score_v2 ?? null,
      score_dimensoes: row.score_dimensoes ?? null,
      oferta_recomendada: row.oferta_recomendada ?? null,
      decision_log: Array.isArray(row.decision_log) ? row.decision_log : [],
      raw_json: row.raw_json && typeof row.raw_json === 'object' ? row.raw_json : {},
    }
    if (prospectingIntelligenceEnabled()) {
      // Fase 2: pipeline completo — diagnóstico técnico, roteamento, mensagem separada
      const resultado = await gerarPipelineDiagnosticoV2(prospectComV2)
      saida.push(resultado)
    } else {
      // Fluxo V1 inalterado
      const diag = await gerarDiagnosticoComClaude(prospect)
      const salvo = await salvarDiagnosticoProspect(id, diag)
      await registrarProspectEvent(id, 'diagnosticado', { provider: salvo.metadata_json?.provider || 'heuristico' })
      saida.push(salvo)
    }
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

  if (prospectingIntelligenceEnabled()) {
    await registrarDecisionLog(safeId, {
      acao: 'mensagem_editada',
      origem: 'operador',
      operador_ou_sistema: 'dashboard',
      ts: new Date().toISOString(),
      contexto: { tamanho_anterior: 0, tamanho_novo: mensagem.length },
    }).catch(() => {})
  }

  return diagnosticoPersistido(rows[0])
}

async function registrarProspectEvent(prospectId, tipoEvento, detalhe = {}) {
  if (!prospectId) return
  // Log de evento é auxiliar: nunca deve quebrar o fluxo de envio/aprovação.
  // Em bases restauradas de backup, a sequence pode ficar atrás do MAX(id) e
  // gerar duplicate key (prospect_events_pkey). Engolimos o erro e tentamos
  // ressincronizar a sequence uma vez para que a próxima inserção funcione.
  try {
    await pool.query(
      `
      INSERT INTO prospectador.prospect_events (prospect_id, tipo_evento, detalhe)
      VALUES ($1, $2, $3::jsonb)
      `,
      [prospectId, tipoEvento, JSON.stringify(detalhe || {})]
    )
  } catch (err) {
    if (err && err.code === '23505') {
      try {
        await pool.query(
          `SELECT setval('prospectador.prospect_events_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prospectador.prospect_events))`
        )
      } catch (_) {}
    }
    logger.warn({
      operation: 'registrar_prospect_event_falhou',
      prospect_id: prospectId,
      tipo_evento: tipoEvento,
      erro: err.message,
    })
  }
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
  return texto.replace(PLACEHOLDER_EMPRESA_REGEX, '{{empresa}}')
}

function temPlaceholderResidual(texto) {
  if (!texto || typeof texto !== 'string') return false
  return PLACEHOLDER_RESIDUAL_REGEX.test(texto)
}

const TIPO_MENSAGEM_ABORDAGEM_INICIAL = 'abordagem_inicial'
const CANAL_WHATSAPP = 'whatsapp'
const STATUS_ENVIO_BLOQUEANTES = ['processing', 'sent']

async function registrarTentativaEnvio({
  prospectId,
  mensagem,
  idempotencyKey,
  status,
  erro,
  evolutionResposta,
  numeroNormalizado = null,
  jobId = null,
  tipoMensagem = TIPO_MENSAGEM_ABORDAGEM_INICIAL,
  canal = CANAL_WHATSAPP,
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.send_attempts (
      prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta,
      tipo_mensagem, canal, numero_normalizado, job_id, tentativas, enviado_em
    ) VALUES (
      $1, $2, md5($3), $4, $5, $6::jsonb,
      $7, $8, $9, $10, 1, CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET status = EXCLUDED.status,
        erro = EXCLUDED.erro,
        evolution_resposta = EXCLUDED.evolution_resposta,
        mensagem_hash = EXCLUDED.mensagem_hash,
        numero_normalizado = COALESCE(EXCLUDED.numero_normalizado, prospectador.send_attempts.numero_normalizado),
        job_id = COALESCE(EXCLUDED.job_id, prospectador.send_attempts.job_id),
        tentativas = prospectador.send_attempts.tentativas + 1,
        enviado_em = CASE WHEN EXCLUDED.status = 'sent' THEN NOW() ELSE prospectador.send_attempts.enviado_em END,
        updated_at = NOW()
    RETURNING *
    `,
    [
      prospectId,
      idempotencyKey,
      mensagem,
      status,
      erro || null,
      JSON.stringify(evolutionResposta || {}),
      tipoMensagem,
      canal,
      numeroNormalizado,
      jobId,
    ]
  )
  return rows[0]
}

function idempotencyKeyAbordagemInicial(prospectId) {
  return `prospeccao:${TIPO_MENSAGEM_ABORDAGEM_INICIAL}:${CANAL_WHATSAPP}:${prospectId}`
}

async function reservarEnvioInicialProspeccao({ prospect, mensagem, jobId = null }) {
  const prospectId = prospect?.id
  const numeroNormalizado = normalizarNumeroWhatsapp(prospect?.telefone)
  const idempotencyKey = idempotencyKeyAbordagemInicial(prospectId)
  const existentes = await pool.query(
    `
    SELECT id, prospect_id, status, idempotency_key, numero_normalizado
    FROM prospectador.send_attempts
    WHERE tipo_mensagem = $1
      AND canal = $2
      AND status = ANY($3::text[])
      AND (
        prospect_id = $4
        OR (numero_normalizado IS NOT NULL AND numero_normalizado = $5)
      )
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [TIPO_MENSAGEM_ABORDAGEM_INICIAL, CANAL_WHATSAPP, STATUS_ENVIO_BLOQUEANTES, prospectId, numeroNormalizado]
  )
  if (existentes.rows[0]) {
    logger.info({
      operation: 'prospeccao_envio_bloqueado',
      reason: 'mensagem_inicial_ja_enviada',
      prospect_id: prospectId,
      numero_masked: mascararNumero(numeroNormalizado),
      idempotency_key: existentes.rows[0].idempotency_key,
      status_existente: existentes.rows[0].status,
    })
    return { reservado: false, motivo: 'mensagem_inicial_ja_enviada', existente: existentes.rows[0], idempotencyKey, numeroNormalizado }
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO prospectador.send_attempts (
        prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta,
        tipo_mensagem, canal, numero_normalizado, job_id, tentativas
      ) VALUES (
        $1, $2, md5($3), 'processing', NULL, '{}'::jsonb,
        $4, $5, $6, $7, 0
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET status = 'processing',
          erro = NULL,
          mensagem_hash = EXCLUDED.mensagem_hash,
          numero_normalizado = COALESCE(EXCLUDED.numero_normalizado, prospectador.send_attempts.numero_normalizado),
          job_id = COALESCE(EXCLUDED.job_id, prospectador.send_attempts.job_id),
          updated_at = NOW()
      WHERE prospectador.send_attempts.status IN ('failed', 'scheduled')
      RETURNING *
      `,
      [prospectId, idempotencyKey, mensagem, TIPO_MENSAGEM_ABORDAGEM_INICIAL, CANAL_WHATSAPP, numeroNormalizado, jobId]
    )
    if (!rows[0]) {
      return { reservado: false, motivo: 'mensagem_inicial_ja_enviada', idempotencyKey, numeroNormalizado }
    }
    return { reservado: true, tentativa: rows[0], idempotencyKey, numeroNormalizado }
  } catch (err) {
    if (err?.code === '23505') {
      logger.info({
        operation: 'prospeccao_envio_bloqueado',
        reason: 'numero_normalizado_ja_reservado',
        prospect_id: prospectId,
        numero_masked: mascararNumero(numeroNormalizado),
        idempotency_key: idempotencyKey,
      })
      return { reservado: false, motivo: 'mensagem_inicial_ja_enviada', idempotencyKey, numeroNormalizado }
    }
    throw err
  }
}

async function reservarAgendamentoEnvioInicial({ prospectId, numero, mensagem = '', jobId = null }) {
  const idempotencyKey = idempotencyKeyAbordagemInicial(prospectId)
  const numeroNormalizado = normalizarNumeroWhatsapp(numero)
  try {
    const { rows } = await pool.query(
      `
      INSERT INTO prospectador.send_attempts (
        prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta,
        tipo_mensagem, canal, numero_normalizado, job_id, tentativas
      ) VALUES (
        $1, $2, md5($3), 'scheduled', NULL, '{}'::jsonb,
        $4, $5, $6, $7, 0
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
      `,
      [prospectId, idempotencyKey, mensagem, TIPO_MENSAGEM_ABORDAGEM_INICIAL, CANAL_WHATSAPP, numeroNormalizado, jobId]
    )
    return { reservado: !!rows[0], idempotencyKey, numeroNormalizado }
  } catch (err) {
    if (err?.code === '23505') {
      return { reservado: false, idempotencyKey, numeroNormalizado, motivo: 'numero_normalizado_ja_reservado' }
    }
    throw err
  }
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
  const enviarMensagemFn = typeof input.enviarMensagemFn === 'function' ? input.enviarMensagemFn : enviarMensagem
  const jobId = input.job_id || input.jobId || null
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
    const telefone = normalizarNumeroWhatsapp(p.telefone)
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

    // ── Fase 1: validação da esteira inteligente (flag-guarded) ──────────────
    // Propaga decision_log e score_v2 do row bruto para o objeto de validação.
    // prospectPersistido() pode não conhecer as colunas novas — mesclamos aqui.
    const pParaValidacao = {
      ...p,
      decision_log: Array.isArray(row.decision_log) ? row.decision_log : [],
      score_v2: row.score_v2 ?? null,
      oferta_recomendada: row.oferta_recomendada ?? null,
    }
    const validacao = await validarProspectAntesDoEnvio(pParaValidacao, diagnostico)
    if (!validacao.ok) {
      saida.push({
        prospect_id: p.id,
        ok: false,
        erro: `validacao_inteligente: ${(validacao.erros || []).join(', ')}`,
      })
      continue
    }
    // ─────────────────────────────────────────────────────────────────────────

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
    const reserva = await reservarEnvioInicialProspeccao({ prospect: p, mensagem, jobId })
    if (!reserva.reservado) {
      saida.push({ prospect_id: p.id, ok: true, deduplicado: true, motivo: reserva.motivo })
      continue
    }
    let ultimoErro = null
    let respostaEnvio = null
    try {
      respostaEnvio = await enviarMensagemFn(telefone, mensagem)
      await registrarTentativaEnvio({
        prospectId: p.id,
        mensagem,
        idempotencyKey: reserva.idempotencyKey,
        status: 'sent',
        erro: null,
        evolutionResposta: respostaEnvio,
        numeroNormalizado: reserva.numeroNormalizado,
        jobId,
      })
      await pool.query(
        `
        UPDATE prospectador.prospects
        SET status = 'enviado',
            updated_at = NOW()
        WHERE id = $1
          AND status = 'aprovado'
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
      logger.info({
        operation: 'prospeccao_envio_inicial',
        prospect_id: p.id,
        numero_masked: mascararNumero(telefone),
        job_id: jobId,
        status_anterior: p.status,
        status_novo: 'enviado',
        idempotency_key: reserva.idempotencyKey,
        worker_id: process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || process.pid,
        message_hash: hashMensagem(mensagem),
      })
      await registrarProspectEvent(p.id, 'enviado', { tentativa: 1, idempotency_key: reserva.idempotencyKey })
      // Espelha a 1ª mensagem da prospecção no histórico da conversa (painel
      // Conversas). Best-effort: falha aqui não desfaz o envio já feito.
      await registrarEnvioNoHistorico(pool, {
        respostaEnvio,
        numero: telefone,
        texto: mensagem,
        tipo: 'prospeccao_inicial',
        empresaId: row.empresa_id || null,
        meta: { prospect_id: p.id },
      }).catch((err) => logger.warn({ prospect_id: p.id, err: err.message }, 'registrarEnvioNoHistorico (prospecção) falhou'))
      ultimoErro = null
    } catch (err) {
      ultimoErro = err
      const classificacao = err.evolutionClassificacao || classificarErroEvolution(err)
      const erroEstruturado = {
        message: err.message || 'falha_envio',
        tipo: classificacao.tipo,
        retryable: classificacao.retryable,
        motivo: classificacao.motivo,
        http_status: err.response?.status || null,
      }
      await registrarTentativaEnvio({
        prospectId: p.id,
        mensagem,
        idempotencyKey: reserva.idempotencyKey,
        status: 'failed',
        erro: JSON.stringify(erroEstruturado),
        evolutionResposta: err.response?.data || {},
        numeroNormalizado: reserva.numeroNormalizado,
        jobId,
      })
      ultimoErro._classificacao = classificacao
    }
    if (ultimoErro) {
      const cls = ultimoErro._classificacao || { tipo: 'unknown', retryable: false, motivo: ultimoErro.message }
      await registrarProspectEvent(p.id, 'erro_envio', {
        erro: ultimoErro.message || 'falha',
        tipo_erro: cls.tipo,
        retryable: cls.retryable,
        motivo: cls.motivo,
      })
      saida.push({
        prospect_id: p.id,
        ok: false,
        erro: ultimoErro.message || 'falha ao enviar',
        tipo_erro: cls.tipo,
        retryable: cls.retryable,
        motivo: cls.motivo,
      })
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
  const cfg = await obterConfiguracaoProspeccao(pool)
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

/** Resolve pares nicho/cidade priorizados para alimentar o painel de prospecção (sem chamar Places). */
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
  const { rows: prospectsRows } = await pool.query(
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
  const prospectsPorId = new Map(prospectsRows.map((row) => [String(row.id), row]))
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
    const row = prospectsPorId.get(String(id))
    const p = prospectPersistido(row || null)
    if (!p || p.status !== 'aprovado') {
      agendamentos.push({ prospect_id: id, ok: false, erro: 'Prospect fora do status aprovado.' })
      continue
    }
    const telefone = normalizarNumeroWhatsapp(p.telefone)
    if (!telefone) {
      agendamentos.push({ prospect_id: id, ok: false, erro: 'Prospect sem telefone valido.' })
      continue
    }
    const reserva = await reservarAgendamentoEnvioInicial({
      prospectId: id,
      numero: telefone,
      mensagem: mensagemParaEnvio(row?.diagnostico || {}),
      jobId: null,
    })
    if (!reserva.reservado) {
      logger.info({
        operation: 'prospeccao_envio_bloqueado',
        reason: reserva.motivo || 'mensagem_inicial_ja_enviada',
        prospect_id: id,
        numero_masked: mascararNumero(telefone),
        idempotency_key: reserva.idempotencyKey,
      })
      agendamentos.push({ prospect_id: id, ok: true, deduplicado: true })
      continue
    }
    const job = await enfileirarJobProspeccao(
      'prospeccao_envio_agendado',
      { prospect_id: id },
      `prospeccao_envio:${id}`,
      proximo.toISOString()
    )
    await pool.query(
      `
      UPDATE prospectador.send_attempts
      SET job_id = $2,
          updated_at = NOW()
      WHERE idempotency_key = $1
        AND status = 'scheduled'
      `,
      [reserva.idempotencyKey, job.id]
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

  return {
    agendados: agendamentos.filter((item) => item.ok && item.agendado_para && !item.deduplicado).length,
    detalhes: agendamentos,
  }
}

async function marcarProspectComoRespondeuPorNumero(numero) {
  const candidatos = candidatosTelefoneBR(numero)
  const telefone = normalizarNumeroWhatsapp(numero)
  // 1) Caminho rápido: casa o prospect pelo telefone cru (variações BR de 8/9 dígitos).
  let prospectRow = null
  if (candidatos.length) {
    const { rows } = await pool.query(
      `
      UPDATE prospectador.prospects p
      SET status = 'respondeu',
          updated_at = NOW()
      WHERE p.id = (
        SELECT p2.id
        FROM prospectador.prospects p2
        WHERE regexp_replace(COALESCE(p2.telefone, ''), '\D', '', 'g') = ANY($1::text[])
          AND p2.status = 'enviado'
        ORDER BY p2.updated_at DESC, p2.created_at DESC
        LIMIT 1
      )
      RETURNING *
      `,
      [candidatos]
    )
    prospectRow = rows[0] || null
  }
  // 2) Marca a fila do dia (casa por telefone_normalizado — chave confiável) e captura o
  // prospect_id de lá.
  const filaRow = await marcarFilaProspeccaoRespondidaPorNumero(telefone, prospectRow?.id || null).catch(() => null)
  // 3) Fallback robusto (fim do P10 "respostas invisíveis"): se o telefone cru não casou o
  // prospect mas a fila apontou um prospect_id, marca o prospect por ESSE id. A fila usa uma
  // coluna de telefone já normalizada e linka o prospect — chave confiável vs. o regex frágil.
  if (!prospectRow && filaRow?.prospect_id) {
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects
       SET status = 'respondeu', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'enviado'
       RETURNING *`,
      [filaRow.prospect_id]
    )
    prospectRow = rows[0] || null
  }
  const prospectIdFinal = prospectRow?.id || filaRow?.prospect_id || null
  await bloquearProspeccaoPorRespostaLead(telefone, prospectIdFinal).catch(() => null)
  if (!prospectRow) return null
  const prospect = prospectPersistido(prospectRow)
  await registrarProspectEvent(prospect.id, 'respondeu', { telefone })
  return prospect
}

async function marcarFilaProspeccaoRespondidaPorNumero(numero, prospectId = null) {
  const telefone = normalizarNumeroWhatsapp(numero)
  if (!telefone && !prospectId) return null
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria f
    SET status = 'respondido',
        atualizado_em = NOW(),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $3::jsonb
    WHERE f.id = (
      SELECT f2.id
      FROM prospectador.prospeccao_fila_diaria f2
      WHERE f2.status IN ('enviado', 'enviando', 'agendado', 'simulado')
        AND (
          f2.telefone_normalizado = $1
          OR ($2::uuid IS NOT NULL AND f2.prospect_id = $2::uuid)
        )
      ORDER BY f2.atualizado_em DESC, f2.criado_em DESC
      LIMIT 1
    )
    RETURNING *
    `,
    [
      telefone || null,
      prospectId || null,
      JSON.stringify({
        resposta_lead: {
          respondido_em: new Date().toISOString(),
          telefone,
        },
      }),
    ]
  )
  return rows[0] || null
}

async function bloquearProspeccaoPorRespostaLead(numero, prospectId = null) {
  const telefone = normalizarNumeroWhatsapp(numero)
  if (!telefone && !prospectId) return null
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_bloqueios (
      telefone_normalizado, prospect_id, motivo, origem, ativo, criado_em, atualizado_em
    )
    SELECT $1, $2::uuid, 'lead_respondeu', 'webhook', true, NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM prospectador.prospeccao_bloqueios b
      WHERE b.ativo = true
        AND b.motivo = 'lead_respondeu'
        AND (
          ($1 IS NOT NULL AND b.telefone_normalizado = $1)
          OR ($2::uuid IS NOT NULL AND b.prospect_id = $2::uuid)
        )
    )
    RETURNING *
    `,
    [telefone || null, prospectId || null]
  )
  return rows[0] || null
}

async function buscarContextoProspeccao(numero) {
  const candidatos = candidatosTelefoneBR(numero)
  if (!candidatos.length) return null
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
      ) AS diagnostico,
      (
        SELECT row_to_json(f.*)
        FROM (
          SELECT *
          FROM prospectador.prospeccao_fila_diaria
          WHERE (
            telefone_normalizado = ANY($1::text[])
            OR prospect_id = p.id
          )
            AND status IN ('enviado', 'respondido')
          ORDER BY atualizado_em DESC, criado_em DESC
          LIMIT 1
        ) f
      ) AS fila
    FROM prospectador.prospects p
    WHERE regexp_replace(COALESCE(p.telefone, ''), '\D', '', 'g') = ANY($1::text[])
      AND p.status IN ('enviado', 'respondeu')
    ORDER BY p.updated_at DESC, p.created_at DESC
    LIMIT 1
    `,
    [candidatos]
  )
  if (!rows[0]) return null
  const prospect = prospectPersistido(rows[0])
  const diagnostico = rows[0]?.diagnostico ? diagnosticoPersistido(rows[0].diagnostico) : null
  const fila = rows[0]?.fila && typeof rows[0].fila === 'object' ? rows[0].fila : null
  const mensagemEnviada = String(
    fila?.mensagem_editada ||
    fila?.mensagem_gerada ||
    diagnostico?.mensagem_editada ||
    diagnostico?.mensagem_gerada ||
    ''
  ).trim()
  const contextoVendas = montarContextoVendasProspeccao({ prospect, diagnostico, fila, mensagemEnviada })
  return { prospect, diagnostico, fila, mensagem_enviada: mensagemEnviada, contexto_vendas: contextoVendas }
}

function valorTextoContexto(...valores) {
  for (const valor of valores) {
    if (valor == null) continue
    const texto = String(valor).trim()
    if (texto) return texto
  }
  return ''
}

function valorNumeroContexto(...valores) {
  for (const valor of valores) {
    if (valor == null || valor === '') continue
    const n = Number(valor)
    if (Number.isFinite(n)) return n
  }
  return null
}

function montarContextoVendasProspeccao({ prospect, diagnostico, fila, mensagemEnviada } = {}) {
  const p = prospect && typeof prospect === 'object' ? prospect : {}
  const d = diagnostico && typeof diagnostico === 'object' ? diagnostico : {}
  const f = fila && typeof fila === 'object' ? fila : {}
  const meta = f.metadata_json && typeof f.metadata_json === 'object' ? f.metadata_json : {}
  const candidato = meta.candidato && typeof meta.candidato === 'object' ? meta.candidato : {}

  const nicho = valorTextoContexto(f.categoria, p.nicho, p.categoria, candidato.categoria, candidato.nicho)
  const cidade = valorTextoContexto(f.cidade, p.cidade, candidato.cidade)
  const estado = valorTextoContexto(f.estado, candidato.estado)
  const endereco = valorTextoContexto(p.endereco, candidato.endereco, candidato.formattedAddress)
  const regiaoAtendimento = valorTextoContexto(
    meta.regiao,
    meta.regiao_padrao,
    meta.regiao_atendimento,
    candidato.regiao,
    candidato.regiao_atendimento,
    estado && cidade ? `${cidade}/${estado}` : ''
  )

  return {
    origem: 'prospeccao',
    prospect_id: p.id || f.prospect_id || null,
    fila_id: f.id || null,
    slot_envio: f.slot_envio || null,
    nome: valorTextoContexto(p.nome, f.nome_lead, candidato.nome),
    telefone: valorTextoContexto(p.telefone, f.telefone_normalizado, candidato.telefone),
    nicho,
    categoria: nicho,
    cidade,
    estado,
    endereco,
    regiao_atendimento: regiaoAtendimento,
    tem_site: !!p.tem_site,
    site: valorTextoContexto(p.site, candidato.site),
    maps_url: valorTextoContexto(p.maps_url, candidato.maps_url),
    place_id: valorTextoContexto(p.place_id, candidato.place_id),
    rating: valorNumeroContexto(p.rating, candidato.rating),
    avaliacoes: valorNumeroContexto(p.avaliacoes, candidato.avaliacoes, candidato.reviews),
    score: valorNumeroContexto(p.score, p.score_v2, candidato.score),
    motivo_score: valorTextoContexto(p.motivo_score, candidato.motivo_score),
    dor_principal: valorTextoContexto(d.dor_principal),
    perda_estimada: d.perda_estimada == null ? null : Number(d.perda_estimada),
    mensagem_enviada: valorTextoContexto(mensagemEnviada, d.mensagem_editada, d.mensagem_gerada, f.mensagem_editada, f.mensagem_gerada),
  }
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

// ── Sistema diário (novo): config → fila do dia → mensagem IA → envios agendados ─

/**
 * Converte um slot_envio local de São Paulo ("YYYY-MM-DDTHH:mm:00", sem fuso)
 * para um instante absoluto correto. Sem isso, o banco (UTC) interpretaria
 * o horário local como UTC e agendaria 3h adiantado.
 */
function slotEnvioParaInstante(slotEnvio) {
  const texto = String(slotEnvio || '').trim()
  const m = texto.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return null
  try {
    return parseDataHoraSaoPaulo(m[1], `${m[2]}:${m[3]}`)
  } catch (_) {
    return null
  }
}

/**
 * Garante mensagem (IA com fallback) e agenda o envio real de um item da fila diária
 * no horário do seu slot. Usa o mesmo worker da fila (processarEnvioFilaAgendado).
 */
async function agendarEnvioItemFilaDiaria(item) {
  const filaId = normalizarId(item?.id)
  if (!filaId) return { ok: false, motivo: 'sem_fila_id' }

  const temMensagem = String(item?.mensagem_editada || item?.mensagem_gerada || '').trim()
  if (!temMensagem) {
    try {
      await gerarMensagemParaItemFila(pool, filaId, { aiProvider, logger })
    } catch (e) {
      logger.warn({ operation: 'prospeccao_diaria', etapa: 'gerar_mensagem_erro', fila_id: filaId, erro: e.message })
    }
  }

  let preparado
  try {
    preparado = await prepararItemFilaParaJobEnvio(pool, filaId)
  } catch (e) {
    return { ok: false, fila_id: filaId, motivo: e.message }
  }

  const instante = slotEnvioParaInstante(preparado.slot_envio)
  const availableAt = instante ? instante.toISOString() : preparado.slot_envio
  const job = await enfileirarJobProspeccao(
    'prospeccao_envio_agendado',
    { fila_id: filaId },
    `prospeccao_fila_envio:${filaId}`,
    availableAt
  )
  await marcarJobAgendadoNaFila(pool, filaId, job.id)
  return { ok: true, fila_id: filaId, job_id: job.id, available_at: availableAt }
}

/**
 * Escolhe o mercado (nicho + cidade) da rodada do dia a partir do histórico real
 * de prospecção. Rankeia por resultado (respostas) e, sem sinal, pelo mercado
 * MENOS recentemente prospectado — espalha a cobertura e maximiza leads frescos
 * (fora da janela de re-prospecção). Cai no padrão da config se não houver histórico.
 * Fonte: prospectador.prospects (buscas reais), ignorando ruído (combos com <3
 * registros ou texto muito longo, típico de extrações conversacionais).
 */
// Nichos-semente: pequenos negócios locais que costumam NÃO ter site, decidem rápido e
// têm orçamento. Ponto de partida — a IA pode propor nichos novos além desta lista.
const PROSPEC_SEED_NICHOS = [
  'eletricista', 'encanador', 'pintor residencial', 'marceneiro', 'serralheiro',
  'dentista', 'clínica de estética', 'fisioterapeuta', 'pet shop', 'banho e tosa',
  'oficina mecânica', 'funilaria e pintura automotiva', 'personal trainer',
  'dedetizadora', 'instalação de ar-condicionado', 'chaveiro', 'jardinagem',
]

// Raio-x dos mercados já prospectados (nicho×cidade): volume + última busca. É o que dá
// à IA a consciência de "onde já fui / onde esgotou" para escolher um lugar fresco.
async function resumoMercadosProspeccao(poolRef, limite = 60, empresaId = null) {
  try {
    const params = [limite]
    let filtroEmpresa = ''
    if (empresaId) {
      params.push(empresaId)
      filtroEmpresa = ` AND empresa_id = $${params.length}`
    }
    const { rows } = await poolRef.query(
      `
      SELECT nicho, cidade, COUNT(*)::int AS total, MAX(created_at) AS ultimo
      FROM prospectador.prospects
      WHERE COALESCE(nicho, '') <> '' AND COALESCE(cidade, '') <> ''${filtroEmpresa}
      GROUP BY nicho, cidade
      ORDER BY MAX(created_at) DESC
      LIMIT $1
      `,
      params
    )
    return rows.map((r) => ({
      nicho: r.nicho,
      cidade: r.cidade,
      total: Number(r.total) || 0,
      ultimo: r.ultimo ? new Date(r.ultimo).toISOString().slice(0, 10) : null,
    }))
  } catch (e) {
    logger.warn({ operation: 'prospeccao_diaria', etapa: 'resumo_mercados_erro', erro: e.message })
    return []
  }
}

// Seletor de mercado por IA (autônomo, data-aware): a IA recebe o que já foi prospectado
// e escolhe UM nicho + UMA cidade frescos para hoje. SÓ decide nicho/cidade — a busca no
// Places e o resto continuam programáticos. Modelo barato (estratégia, não texto pro
// cliente). SEMPRE ligado. NÃO há fallback para a rotação heurística: a IA tem RETRY
// (PROSPEC_MERCADO_IA_RETRIES, default 3 tentativas) e, se todas falharem, o erro fica
// REGISTRADO no log do Railway (logger.error) e a função retorna null — o chamador
// aborta a rodada do dia (não usa mercado burro).
async function selecionarMercadoDiarioIA(poolRef, config = {}, deps = {}) {
  const ai = deps.aiProvider || aiProvider
  const maxTentativas = Math.max(
    1,
    Number(deps.maxTentativas) || parseInt(process.env.PROSPEC_MERCADO_IA_RETRIES, 10) || 3
  )
  const mercados = await resumoMercadosProspeccao(poolRef, 60, deps.empresaId || null)
  const jaTocados = mercados.length
    ? mercados.map((m) => `- ${m.nicho} / ${m.cidade} (${m.total} contatos, último ${m.ultimo || '?'})`).join('\n')
    : '(nenhum ainda)'
  const systemPrompt =
    'Voce e o estrategista de prospeccao da {{empresa}}, que vende SITES para pequenos ' +
    'negocios locais no Brasil inteiro. Tarefa: escolher UM mercado (um nicho + uma cidade ' +
    'brasileira) para prospectar HOJE.\n' +
    'Regras:\n' +
    '1. Escolha uma combinacao FRESCA — evite os mercados ja esgotados/recentes da lista (os ' +
    'que ja tem muitos contatos). Nao repita nicho+cidade ja muito explorado.\n' +
    '2. Priorize cidades brasileiras com bastante pequeno negocio e demanda por site, variando ' +
    'regioes do pais (nao fique so em SP).\n' +
    '3. Prefira nichos de servico local que costumam NAO ter site e decidem rapido; pode usar a ' +
    'semente OU propor um nicho novo relevante.\n' +
    'Responda SOMENTE um JSON: {"nicho":"...","cidade":"Cidade - UF","motivo":"..."}'
  const userPrompt =
    `Nichos-semente: ${PROSPEC_SEED_NICHOS.join(', ')}.\n\n` +
    `Mercados JA prospectados (evite os esgotados/recentes):\n${jaTocados}\n\n` +
    'Escolha o melhor proximo mercado fresco para hoje.'

  let ultimoErro = null
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    try {
      const aiResult = await ai.generateAIResponse(
        {
          systemPrompt,
          userPrompt,
          task: 'prospeccao_selecao_mercado',
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 200,
          timeoutMs: 20000,
          responseFormatJson: true,
        },
        poolRef,
        null
      )
      const txt = String(aiResult?.text || '').trim().replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim()
      const parsed = JSON.parse(txt)
      const nicho = normalizarTexto(parsed?.nicho, 60)
      const cidade = normalizarTexto(parsed?.cidade, 60)
      if (!nicho || !cidade) throw new Error('IA devolveu nicho/cidade vazio')
      const motivo = normalizarTexto(parsed?.motivo, 200) || null
      logger.info({ operation: 'prospeccao_diaria', etapa: 'mercado_ia', tentativa, nicho, cidade, motivo })
      return { nicho, cidade, origem: 'ia', motivo }
    } catch (e) {
      ultimoErro = e
      logger.warn({ operation: 'prospeccao_diaria', etapa: 'mercado_ia_retry', tentativa, de: maxTentativas, erro: e.message })
    }
  }
  // Todas as tentativas falharam — registra o erro VISÍVEL no Railway. Sem fallback.
  logger.error({
    operation: 'prospeccao_diaria',
    etapa: 'mercado_ia_falhou',
    tentativas: maxTentativas,
    erro: ultimoErro?.message || 'desconhecido',
  })
  return null
}

async function selecionarMercadoDiario(poolRef, config = {}) {
  const fallback = {
    nicho: config.categoria_padrao || config.categoria || null,
    cidade: config.cidade_padrao || config.regiao_padrao || null,
    origem: 'config_padrao',
  }
  try {
    const { rows } = await poolRef.query(
      `
      SELECT nicho, cidade
      FROM (
        SELECT
          nicho,
          cidade,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'respondeu') AS respostas,
          MAX(created_at) AS ultimo
        FROM prospectador.prospects
        WHERE COALESCE(nicho, '') <> '' AND COALESCE(cidade, '') <> ''
          AND char_length(nicho) <= 60 AND char_length(cidade) <= 40
        GROUP BY nicho, cidade
        HAVING COUNT(*) >= 3
      ) m
      ORDER BY respostas DESC, ultimo ASC
      LIMIT 1
      `
    )
    const row = rows[0]
    if (row && row.nicho && row.cidade) {
      return { nicho: row.nicho, cidade: row.cidade, origem: 'rotacao_historico' }
    }
  } catch (e) {
    logger.warn({ operation: 'prospeccao_diaria', etapa: 'selecionar_mercado_erro', erro: e.message })
  }
  return fallback
}

/**
 * Orquestra a rodada diária de prospecção do SISTEMA NOVO (prospeccao_configuracoes
 * + prospeccao_fila_diaria). Chamada a cada tick do worker; idempotente por dia.
 * Fluxo: valida janela/dia → monta fila via Google Places → gera mensagem IA →
 * agenda 1 job de envio por item no horário do slot. O envio real é feito depois
 * pelo worker (processarEnvioFilaAgendado), que reaplica elegibilidade.
 */
// Cancela itens da fila diária que ficaram "presos" (simulado/agendado/aguardando) com
// slot/criação no passado e nunca foram enviados — limpeza de estados órfãos.
async function expirarItensFilaPresos(poolRef) {
  try {
    const { rowCount } = await poolRef.query(
      `UPDATE prospectador.prospeccao_fila_diaria
       SET status = 'cancelado',
           atualizado_em = NOW(),
           metadata_json = COALESCE(metadata_json, '{}'::jsonb) || '{"motivo_cancelamento":"expirado_sem_envio"}'::jsonb
       WHERE status IN ('simulado', 'agendado', 'aguardando_agendamento')
         AND COALESCE(slot_envio, criado_em) < NOW() - interval '12 hours'`
    )
    if (rowCount) logger.info({ operation: 'prospeccao_diaria', etapa: 'fila_presos_expirados', total: rowCount })
    return rowCount || 0
  } catch (e) {
    logger.warn({ operation: 'prospeccao_diaria', etapa: 'expirar_presos_erro', erro: e.message })
    return 0
  }
}

const PJ_EMPRESA_ID_PROSPEC = '00000000-0000-0000-0000-000000000001'

// Rodada diária de prospecção para UMA empresa (núcleo). O loop multiempresa fica
// em verificarAgendaDiariaProspeccao. empresaId default = PJ (compatibilidade).
async function _rodadaDiariaProspeccaoEmpresa(empresaId = PJ_EMPRESA_ID_PROSPEC, now = new Date()) {
  let cfg
  try {
    cfg = await obterConfiguracaoProspeccao(pool, empresaId)
  } catch (e) {
    return { ok: false, enfileirado: false, motivo: 'config_indisponivel', erro: e.message }
  }
  if (!cfg || !cfg.ativo) return { ok: true, enfileirado: false, motivo: 'desabilitado' }

  const agora = now instanceof Date ? now : new Date(now)
  const dataStr = isoDateBrasil(agora)
  const weekday = partesDataBrasil(agora).weekday
  const dias = Array.isArray(cfg.dias_semana_ativos) && cfg.dias_semana_ativos.length
    ? cfg.dias_semana_ativos
    : [1, 2, 3, 4, 5]
  if (!dias.includes(weekday)) {
    return { ok: true, enfileirado: false, motivo: 'dia_nao_ativo', data: dataStr, weekday }
  }

  const inicio = parseDataHoraSaoPaulo(dataStr, cfg.horario_inicio || '09:00')
  if (agora < inicio) {
    return { ok: true, enfileirado: false, motivo: 'antes_do_horario', proximo: inicio.toISOString() }
  }

  // Idempotência: uma execução por dia POR EMPRESA. Se já há execução não-cancelada hoje, sai.
  const existente = await pool.query(
    `SELECT id, status FROM prospectador.prospeccao_execucoes_diarias WHERE data_execucao = $1::date AND empresa_id = $2 LIMIT 1`,
    [dataStr, empresaId]
  )
  if (existente.rows[0] && existente.rows[0].status !== 'cancelada') {
    return { ok: true, enfileirado: false, motivo: 'ja_processado_hoje', data: dataStr, execucao_id: existente.rows[0].id }
  }

  // Higiene: expira itens da fila de dias anteriores que ficaram presos sem envio
  // (simulado/agendado/aguardando com slot/criação no passado) — evita acúmulo.
  await expirarItensFilaPresos(pool)

  // Seletor autônomo por IA (com retry interno). SEM fallback para a rotação antiga: se a
  // IA falhar de vez, o erro já foi logado (logger.error) e a rodada do dia é ABORTADA —
  // marca a execução como 'falhou' para não re-tentar a cada tick (re-tenta amanhã).
  const mercado = await selecionarMercadoDiarioIA(pool, cfg, { empresaId })
  if (!mercado || !mercado.nicho || !mercado.cidade) {
    logger.error({ operation: 'prospeccao_diaria', etapa: 'abortada_sem_mercado', data: dataStr })
    await pool.query(
      `INSERT INTO prospectador.prospeccao_execucoes_diarias (data_execucao, empresa_id, modo, status)
       VALUES ($1::date, $2, 'automatico', 'falhou')
       ON CONFLICT (data_execucao, empresa_id) DO UPDATE SET status = 'falhou', atualizado_em = NOW()`,
      [dataStr, empresaId]
    ).catch(() => {})
    return { ok: false, enfileirado: false, motivo: 'mercado_ia_falhou', data: dataStr }
  }

  let fila
  try {
    fila = await simularFilaDiariaComPlaces(
      pool,
      {
        data_execucao: dataStr,
        empresaId,
        config: cfg,
        origem: 'automatico',
        nicho: mercado.nicho,
        cidade: mercado.cidade,
        mercado_origem: mercado.origem || null,
        mercado_motivo: mercado.motivo || null,
        // Rodada automática drena o backlog (prospects já descobertos e não enviados)
        // junto com o que o Places trouxer fresco — até o limite de slots/dia.
        incluirBacklog: true,
      },
      { pesquisarPlacesFn: pesquisarPlaces }
    )
  } catch (e) {
    logger.error({ operation: 'prospeccao_diaria', etapa: 'montar_fila_erro', data: dataStr, erro: e.message })
    return { ok: false, enfileirado: false, motivo: 'falha_montar_fila', erro: e.message }
  }

  const itens = (Array.isArray(fila.itens) ? fila.itens : [])
    .filter((it) => it && it.slot_envio && it.status === 'simulado')

  const agendados = []
  if (cfg.envio_real_habilitado) {
    for (const item of itens) {
      try {
        agendados.push(await agendarEnvioItemFilaDiaria(item))
      } catch (e) {
        logger.warn({ operation: 'prospeccao_diaria', etapa: 'agendar_item_erro', fila_id: item.id, erro: e.message })
        agendados.push({ ok: false, fila_id: item.id, motivo: e.message })
      }
    }
    await pool.query(
      `UPDATE prospectador.prospeccao_execucoes_diarias
       SET status = 'concluida', total_agendados = $2, atualizado_em = NOW()
       WHERE id = $1::uuid`,
      [fila.execucao?.id, agendados.filter((a) => a.ok).length]
    ).catch(() => {})
  }

  const okCount = agendados.filter((a) => a.ok).length
  logger.info({
    operation: 'prospeccao_diaria',
    etapa: 'rodada_concluida',
    data: dataStr,
    execucao_id: fila.execucao?.id || null,
    mercado: `${mercado.nicho} / ${mercado.cidade}`,
    mercado_origem: mercado.origem,
    total_candidatos: fila.total_candidatos,
    total_backlog_adicionado: fila.total_backlog_adicionado || 0,
    total_elegiveis: fila.total_elegiveis,
    total_simulados: fila.total_simulados,
    total_bloqueados: fila.total_bloqueados,
    agendados: okCount,
    envio_real: !!cfg.envio_real_habilitado,
  })

  // Observabilidade: gera e persiste o relatório do dia (não-fatal). Sem isso a
  // tabela prospeccao_relatorios_diarios fica vazia e o painel não mostra resultado.
  try {
    await gerarRelatorioDiarioProspeccao(pool, { data: dataStr, empresaId })
  } catch (e) {
    logger.warn({ operation: 'prospeccao_diaria', etapa: 'gerar_relatorio_erro', data: dataStr, erro: e.message })
  }

  return {
    ok: true,
    enfileirado: cfg.envio_real_habilitado ? okCount > 0 : false,
    data: dataStr,
    execucao_id: fila.execucao?.id || null,
    mercado: { nicho: mercado.nicho, cidade: mercado.cidade, origem: mercado.origem },
    total_simulados: fila.total_simulados,
    total_bloqueados: fila.total_bloqueados,
    agendados: okCount,
    envio_real: !!cfg.envio_real_habilitado,
  }
}

// Tick diário multiempresa: roda a rodada para CADA empresa com config ativa.
// Mantém o comportamento da PJ (que entra no loop se sua config estiver ativa) e
// degrada por empresa — uma falha numa empresa não derruba as outras.
async function verificarAgendaDiariaProspeccao(now = new Date()) {
  let empresas
  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM prospectador.prospeccao_configuracoes WHERE ativo = true`
    )
    empresas = rows.map((r) => r.empresa_id).filter(Boolean)
  } catch (e) {
    return { ok: false, enfileirado: false, motivo: 'config_indisponivel', erro: e.message }
  }
  if (!empresas.length) return { ok: true, enfileirado: false, motivo: 'desabilitado', empresas: 0 }

  const resultados = []
  for (const empresaId of empresas) {
    try {
      resultados.push({ empresa_id: empresaId, ...(await _rodadaDiariaProspeccaoEmpresa(empresaId, now)) })
    } catch (e) {
      logger.error({ operation: 'prospeccao_diaria', etapa: 'empresa_erro', empresa_id: empresaId, erro: e.message })
      resultados.push({ empresa_id: empresaId, ok: false, motivo: 'erro', erro: e.message })
    }
  }
  return { ok: true, empresas: empresas.length, resultados }
}

// "Agenda" da Aquisição (Google Places): re-roda a BUSCA a cada X horas para as
// empresas com agendamento_busca_ativo. Decisão pura em prospecting-search-scheduler;
// aqui só o I/O (busca + marca ultima_busca_em). Chamada no tick periódico (gate 60s).
// Independente da rodada diária de ENVIO (_rodadaDiariaProspeccaoEmpresa).
async function verificarAgendaBuscaRecorrenteProspeccao(now = new Date()) {
  let empresas
  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM prospectador.prospeccao_configuracoes WHERE agendamento_busca_ativo = true`
    )
    empresas = rows.map((r) => r.empresa_id).filter(Boolean)
  } catch (e) {
    return { ok: false, disparadas: 0, motivo: 'config_indisponivel', erro: e.message }
  }
  if (!empresas.length) return { ok: true, disparadas: 0, motivo: 'desabilitado' }

  let disparadas = 0
  for (const empresaId of empresas) {
    try {
      const cfg = await obterConfiguracaoProspeccao(pool, empresaId)
      if (!buscaProspeccaoDevePreencher(cfg, now)) continue
      const local = [cfg.cidade_padrao, cfg.estado_padrao].filter(Boolean).join(', ')
      await pesquisarPlaces({
        nicho: cfg.categoria_padrao,
        local,
        quantidade: cfg.limite_diario || 20,
        // 'automatico' é o único valor permitido para origem não-manual no CHECK
        // de prospectador.prospects (manual|automatico|instagram|linkedin).
        origem: 'automatico',
        empresaId,
      })
      await pool.query(
        `UPDATE prospectador.prospeccao_configuracoes SET ultima_busca_em = NOW(), atualizado_em = NOW() WHERE empresa_id = $1`,
        [empresaId]
      )
      disparadas += 1
    } catch (e) {
      logger.warn({ operation: 'prospeccao_busca_recorrente', empresa_id: empresaId, erro: e.message }, 'busca agendada pulada')
    }
  }
  if (disparadas) logger.info({ operation: 'prospeccao_busca_recorrente', disparadas }, 'buscas agendadas disparadas')
  return { ok: true, disparadas, empresas: empresas.length }
}

async function enfileirarJobProspeccao(tipo, payload = {}, dedupeKey = null, availableAt = null) {
  const safeTipo = String(tipo || '').trim()
  if (!['prospeccao_nichos_sync', 'prospeccao_completo', 'prospeccao_envio_agendado'].includes(safeTipo)) {
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
        atualizado_em = NOW()
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
  if (tipo === 'prospeccao_envio_agendado') {
    const filaId = normalizarId(payload.fila_id)
    if (filaId) {
      const resultado = await processarEnvioFilaAgendado(pool, filaId, {
        jobId: job.id,
        enviarMensagemFn: enviarMensagem,
      })
      // Observabilidade: registra o envio no histórico do prospect (não-fatal).
      if (resultado?.ok && resultado.status === 'enviado' && resultado.prospect_id) {
        await registrarProspectEvent(resultado.prospect_id, 'enviado', {
          origem: 'fila_diaria',
          fila_id: filaId,
          job_id: job.id,
        }).catch(() => {})
      }
      return resultado
    }
    const prospectId = normalizarId(payload.prospect_id)
    if (!prospectId) throw new Error('Job de envio agendado sem prospect_id.')
    const resultado = await enviarProspectsAprovados({ prospect_ids: [prospectId], job_id: job.id })
    const item = Array.isArray(resultado) ? resultado[0] || null : null

    // Se houve falha retryable de WhatsApp, relançar para que o job consumer agende novo attempt
    if (item && !item.ok && !item.deduplicado && item.retryable) {
      const err = new Error(item.motivo || item.erro || 'falha_envio_whatsapp_retryable')
      err.evolutionRetryable = true
      err.evolutionTipo = item.tipo_erro
      throw err
    }

    // Só limpar agendado_para quando o envio foi bem-sucedido ou falha definitiva (não vai tentar mais)
    if (!item || item.ok || !item.retryable) {
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
    }
    return { tipo, resultado: item }
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
        AND tipo IN ('prospeccao_nichos_sync', 'prospeccao_completo', 'prospeccao_envio_agendado')
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
      const tentativa = Number(job.attempts)
      const maxTentativas = Number(job.max_attempts)
      const failed = tentativa >= maxTentativas
      const backoffSeg = tentativa <= 1 ? 300 : tentativa === 2 ? 900 : 3600
      const nextAvailable = new Date(Date.now() + backoffSeg * 1000).toISOString()
      const lastError = JSON.stringify({
        message: String(err.message || 'erro_job').slice(0, 800),
        tipo: err.evolutionTipo || null,
        retryable: err.evolutionRetryable || false,
      })
      await pool.query(
        `
        UPDATE vendas.job_queue
        SET status = $2,
            locked_at = NULL,
            locked_until = NULL,
            last_error = $3,
            available_at = CASE WHEN $2 = 'pending' THEN $4::timestamptz ELSE available_at END,
            updated_at = NOW()
        WHERE id = $1
        `,
        [job.id, failed ? 'failed' : 'pending', lastError, nextAvailable]
      )
      resultados.push({ id: job.id, ok: false, tipo: job.tipo, erro: err.message || 'erro_job', retryable: err.evolutionRetryable || false })
    }
  }
  return resultados
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

// ── Fase 3: fila de aprovação humana ─────────────────────────────────────────

async function buscarFilaAprovacao(filtros = {}) {
  const where = []
  const params = []

  const statusFiltro = normalizarStatusProspect(filtros.status) || 'aguardando'
  params.push(statusFiltro)
  where.push(`p.status = $${params.length}`)

  const minScore = Math.max(0, parseInt(filtros.min_score, 10) || 40)
  params.push(minScore)
  where.push(`p.score_v2 >= $${params.length}`)

  if (filtros.max_score != null && !Number.isNaN(parseInt(filtros.max_score, 10))) {
    params.push(Math.min(100, parseInt(filtros.max_score, 10)))
    where.push(`p.score_v2 <= $${params.length}`)
  }

  if (filtros.classificacao) {
    const cl = String(filtros.classificacao).toLowerCase()
    if (cl === 'alto') where.push(`p.score_v2 >= 80`)
    else if (cl === 'medio') where.push(`p.score_v2 >= 60 AND p.score_v2 < 80`)
    else if (cl === 'baixo') where.push(`p.score_v2 >= 40 AND p.score_v2 < 60`)
  }

  if (filtros.oferta_recomendada && OFERTAS_VALIDAS_V2.has(String(filtros.oferta_recomendada))) {
    params.push(String(filtros.oferta_recomendada))
    where.push(`p.oferta_recomendada = $${params.length}`)
  }

  const nicho = normalizarTexto(filtros.nicho, 160)
  if (nicho) {
    params.push(`%${nicho}%`)
    where.push(`p.nicho ILIKE $${params.length}`)
  }

  const cidade = normalizarTexto(filtros.cidade || filtros.local, 160)
  if (cidade) {
    params.push(`%${cidade}%`)
    where.push(`p.cidade ILIKE $${params.length}`)
  }

  const limit = Math.min(Math.max(parseInt(filtros.limit, 10) || 20, 1), 100)
  const offset = Math.max(parseInt(filtros.offset, 10) || 0, 0)
  const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT
         p.id, p.nome, p.telefone, p.nicho, p.cidade, p.endereco,
         p.rating, p.avaliacoes, p.tem_site, p.site, p.maps_url,
         p.status, p.score, p.score_v2, p.score_dimensoes, p.oferta_recomendada,
         p.decision_log, p.created_at, p.updated_at,
         CASE
           WHEN p.score_v2 >= 80 THEN 'alto'
           WHEN p.score_v2 >= 60 THEN 'medio'
           WHEN p.score_v2 >= 40 THEN 'baixo'
           ELSE 'desqualificado'
         END AS classificacao,
         d.dor_principal,
         d.mensagem_gerada,
         d.mensagem_editada,
         d.diagnostico_json,
         d.prompt_version
       FROM prospectador.prospects p
       LEFT JOIN LATERAL (
         SELECT dor_principal, mensagem_gerada, mensagem_editada, diagnostico_json, prompt_version
         FROM prospectador.diagnosticos
         WHERE prospect_id = p.id
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1
       ) d ON true
       ${whereStr}
       ORDER BY p.score_v2 DESC NULLS LAST, p.updated_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM prospectador.prospects p ${whereStr}`,
      params
    ),
  ])

  const calcClassificacao = (sv2) => {
    const n = Number(sv2)
    if (!sv2 || !Number.isFinite(n)) return null
    if (n >= 80) return 'alto'
    if (n >= 60) return 'medio'
    if (n >= 40) return 'baixo'
    return 'desqualificado'
  }

  const items = dataRes.rows.map((row) => ({
    id: row.id,
    nome: row.nome,
    telefone: row.telefone || '',
    nicho: row.nicho || '',
    cidade: row.cidade || '',
    rating: row.rating == null ? null : Number(row.rating),
    avaliacoes: row.avaliacoes == null ? null : Number(row.avaliacoes),
    tem_site: !!row.tem_site,
    site: row.site || null,
    maps_url: row.maps_url || null,
    score: row.score == null ? null : Number(row.score),
    score_v2: row.score_v2 == null ? null : Number(row.score_v2),
    score_dimensoes: row.score_dimensoes || null,
    classificacao: row.classificacao || calcClassificacao(row.score_v2),
    oferta_recomendada: row.oferta_recomendada || null,
    diagnostico_json: row.diagnostico_json || null,
    dor_principal: row.dor_principal || null,
    mensagem_gerada: row.mensagem_gerada || null,
    mensagem_editada: row.mensagem_editada || null,
    prompt_version: row.prompt_version || null,
    decision_log: Array.isArray(row.decision_log) ? row.decision_log : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return { items, total: Number(countRes.rows[0]?.total || 0), limit, offset }
}

async function obterMetricasFilaAprovacao() {
  const [baseRes, ofertaRes, diagRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'aguardando' AND score_v2 >= 40)::int       AS aguardando_aprovacao,
         COUNT(*) FILTER (WHERE status = 'aguardando' AND score_v2 >= 80)::int       AS score_alto,
         COUNT(*) FILTER (WHERE status = 'aguardando' AND score_v2 >= 60 AND score_v2 < 80)::int AS score_medio,
         COUNT(*) FILTER (WHERE status = 'aguardando' AND score_v2 >= 40 AND score_v2 < 60)::int AS score_baixo,
         COUNT(*) FILTER (WHERE status = 'aguardando' AND score_v2 >= 40
                          AND (telefone IS NULL OR TRIM(telefone) = ''))::int        AS sem_telefone
       FROM prospectador.prospects`
    ),
    pool.query(
      `SELECT oferta_recomendada, COUNT(*)::int AS total
       FROM prospectador.prospects
       WHERE status = 'aguardando' AND score_v2 >= 40 AND oferta_recomendada IS NOT NULL
       GROUP BY oferta_recomendada`
    ),
    pool.query(
      `SELECT COUNT(p.id)::int AS total
       FROM prospectador.prospects p
       WHERE p.status = 'aguardando' AND p.score_v2 >= 40
         AND NOT EXISTS (
           SELECT 1 FROM prospectador.diagnosticos d WHERE d.prospect_id = p.id
         )`
    ),
  ])

  const base = baseRes.rows[0] || {}
  const porOferta = {
    site_profissional: 0, redesign: 0, seo_local: 0,
    site_sistema: 0, automacao_agente: 0, plano_inicial: 0,
  }
  for (const r of ofertaRes.rows) {
    if (r.oferta_recomendada && r.oferta_recomendada in porOferta) {
      porOferta[r.oferta_recomendada] = Number(r.total || 0)
    }
  }

  return {
    aguardando_aprovacao: Number(base.aguardando_aprovacao || 0),
    score_alto: Number(base.score_alto || 0),
    score_medio: Number(base.score_medio || 0),
    score_baixo: Number(base.score_baixo || 0),
    por_oferta: porOferta,
    sem_diagnostico: Number(diagRes.rows[0]?.total || 0),
    sem_telefone: Number(base.sem_telefone || 0),
  }
}

async function aprovarProspectComOferta(id, payload = {}) {
  const safeId = normalizarId(id)
  if (!safeId) {
    const err = new Error('ID de prospect inválido.')
    err.statusCode = 400
    throw err
  }

  if (!prospectingIntelligenceEnabled()) {
    const prospect = await atualizarStatusProspect(safeId, 'aprovado')
    await registrarProspectEvent(safeId, 'aprovado', { origem: 'painel' })
    return { ok: true, prospect_id: safeId, status: 'aprovado', oferta_recomendada: prospect.oferta_recomendada || null, mensagem_final: null }
  }

  const oferta = payload.oferta_recomendada ? String(payload.oferta_recomendada).trim().toLowerCase() : null
  if (oferta && !OFERTAS_VALIDAS_V2.has(oferta)) {
    const err = new Error('oferta_recomendada inválida.')
    err.statusCode = 400
    throw err
  }
  const mensagemEditada = normalizarTexto(payload.mensagem_editada, 4000)
  const observacao = normalizarTexto(payload.observacao, 500)

  const { rows } = await pool.query(
    `SELECT p.id, p.status, p.telefone, p.score_v2, p.oferta_recomendada, p.decision_log,
            d.id AS diag_id, d.diagnostico_json, d.dor_principal, d.mensagem_gerada, d.mensagem_editada AS diag_msg_editada
     FROM prospectador.prospects p
     LEFT JOIN LATERAL (
       SELECT id, diagnostico_json, dor_principal, mensagem_gerada, mensagem_editada
       FROM prospectador.diagnosticos
       WHERE prospect_id = p.id
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1
     ) d ON true
     WHERE p.id = $1::uuid`,
    [safeId]
  )
  const row = rows[0]
  if (!row) {
    const err = new Error('Prospect não encontrado.')
    err.statusCode = 404
    throw err
  }

  if (row.status === 'enviado' || row.status === 'respondeu') {
    const err = new Error('Prospect já foi enviado.')
    err.statusCode = 400
    throw err
  }

  if (row.score_v2 == null) {
    const err = new Error('Prospect sem score_v2. Gere o diagnóstico inteligente antes de aprovar.')
    err.statusCode = 400
    throw err
  }

  if (Number(row.score_v2) < 40) {
    const err = new Error('score_v2 abaixo do mínimo (40) para aprovação.')
    err.statusCode = 400
    throw err
  }

  if (!row.diagnostico_json && !row.dor_principal) {
    const err = new Error('Prospect sem diagnóstico. Gere o diagnóstico antes de aprovar.')
    err.statusCode = 400
    throw err
  }

  const telefone = normalizarTelefone(row.telefone)
  if (!telefone) {
    const err = new Error('Prospect sem telefone válido.')
    err.statusCode = 400
    throw err
  }

  await pool.query(
    `UPDATE prospectador.prospects
     SET status = 'aprovado',
         oferta_recomendada = COALESCE($2, oferta_recomendada),
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [safeId, oferta]
  )

  if (mensagemEditada && row.diag_id) {
    await pool.query(
      `UPDATE prospectador.diagnosticos SET mensagem_editada = $2, updated_at = NOW() WHERE id = $1::uuid`,
      [row.diag_id, mensagemEditada]
    )
  }

  await registrarDecisionLog(safeId, {
    acao: 'aprovacao_humana',
    origem: 'operador',
    operador_ou_sistema: 'dashboard',
    ts: new Date().toISOString(),
    contexto: {
      oferta_confirmada: oferta || row.oferta_recomendada || null,
      mensagem_editada: !!mensagemEditada,
      observacao: observacao || null,
    },
  })

  await registrarProspectEvent(safeId, 'aprovado', { origem: 'aprovacao_humana_v2' })

  return {
    ok: true,
    prospect_id: safeId,
    status: 'aprovado',
    oferta_recomendada: oferta || row.oferta_recomendada || null,
    mensagem_final: mensagemEditada || row.diag_msg_editada || row.mensagem_gerada || null,
  }
}

async function rejeitarProspectComMotivo(id, payload = {}) {
  const safeId = normalizarId(id)
  if (!safeId) {
    const err = new Error('ID de prospect inválido.')
    err.statusCode = 400
    throw err
  }

  const motivoRaw = normalizarTexto(payload.motivo, 100)
  if (!motivoRaw) {
    const err = new Error('motivo é obrigatório para rejeição.')
    err.statusCode = 400
    throw err
  }
  const motivo = String(motivoRaw).toLowerCase().replace(/\s+/g, '_')
  if (!MOTIVOS_REJEICAO_V2.has(motivo)) {
    const err = new Error(`motivo inválido. Permitidos: ${[...MOTIVOS_REJEICAO_V2].join(', ')}.`)
    err.statusCode = 400
    throw err
  }
  const observacao = normalizarTexto(payload.observacao, 500)

  const { rows } = await pool.query(
    `SELECT id FROM prospectador.prospects WHERE id = $1::uuid`,
    [safeId]
  )
  if (!rows[0]) {
    const err = new Error('Prospect não encontrado.')
    err.statusCode = 404
    throw err
  }

  await pool.query(
    `UPDATE prospectador.prospects SET status = 'rejeitado', updated_at = NOW() WHERE id = $1::uuid`,
    [safeId]
  )

  await registrarDecisionLog(safeId, {
    acao: 'rejeicao_humana',
    origem: 'operador',
    operador_ou_sistema: 'dashboard',
    ts: new Date().toISOString(),
    contexto: { motivo, observacao: observacao || null },
  })

  await registrarProspectEvent(safeId, 'rejeitado', { origem: 'rejeicao_humana_v2', motivo })

  return { ok: true, prospect_id: safeId, status: 'rejeitado', motivo }
}

async function alterarOfertaProspect(id, payload = {}) {
  const safeId = normalizarId(id)
  if (!safeId) {
    const err = new Error('ID de prospect inválido.')
    err.statusCode = 400
    throw err
  }

  const ofertaNova = payload.oferta_recomendada ? String(payload.oferta_recomendada).trim().toLowerCase() : null
  if (!ofertaNova || !OFERTAS_VALIDAS_V2.has(ofertaNova)) {
    const err = new Error('oferta_recomendada inválida.')
    err.statusCode = 400
    throw err
  }
  const motivo = normalizarTexto(payload.motivo, 500)

  const { rows } = await pool.query(
    `SELECT id, oferta_recomendada FROM prospectador.prospects WHERE id = $1::uuid`,
    [safeId]
  )
  if (!rows[0]) {
    const err = new Error('Prospect não encontrado.')
    err.statusCode = 404
    throw err
  }
  const ofertaAnterior = rows[0].oferta_recomendada || null

  await pool.query(
    `UPDATE prospectador.prospects SET oferta_recomendada = $2, updated_at = NOW() WHERE id = $1::uuid`,
    [safeId, ofertaNova]
  )

  await registrarDecisionLog(safeId, {
    acao: 'oferta_alterada',
    origem: 'operador',
    operador_ou_sistema: 'dashboard',
    ts: new Date().toISOString(),
    contexto: { oferta_anterior: ofertaAnterior, oferta_nova: ofertaNova, motivo: motivo || null },
  })

  return { ok: true, prospect_id: safeId, oferta_anterior: ofertaAnterior, oferta_recomendada: ofertaNova }
}

async function pesquisarPlaces({ nicho, local, quantidade, origem = 'manual', empresaId = null }) {
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

  const alvo = normalizarQuantidade(quantidade)
  const textQuery = `${queryNicho} em ${queryLocal}`

  // Paginação: a API v1 devolve no máx. 20/página; usamos nextPageToken até
  // atingir o alvo (até 60). Falha numa página seguinte não descarta as anteriores.
  const places = []
  let pageToken = null
  do {
    const body = {
      textQuery,
      maxResultCount: Math.min(20, alvo - places.length),
      languageCode: 'pt-BR',
      regionCode: 'BR',
    }
    if (pageToken) body.pageToken = pageToken

    let data
    try {
      ({ data } = await axios.post(PLACES_TEXT_SEARCH_URL, body, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': `${DEFAULT_FIELD_MASK},nextPageToken`,
        },
      }))
    } catch (err) {
      if (places.length === 0) throw err
      break
    }

    if (Array.isArray(data?.places)) places.push(...data.places)
    pageToken = data?.nextPageToken || null
  } while (pageToken && places.length < alvo)

  const prospects = places.map(mapearPlace)
  const salvos = await salvarProspects(prospects, {
    nicho: queryNicho,
    cidade: queryLocal,
    origem,
    empresaId,
  })

  return {
    consulta: textQuery,
    quantidade_solicitada: alvo,
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
      // Fase 2: quando flag ativa, cada item já traz score_v2, diagnostico_json, oferta_recomendada, etc.
      res.json({ diagnosticos, inteligencia_ativa: prospectingIntelligenceEnabled() })
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

  app.get('/dashboard/prospeccao/whatsapp/status', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const status = await verificarStatusInstanciaEvolution()
      res.json(status)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/disparos/enviar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const prospectIds = req.body?.prospect_ids
      const cfg = await obterConfiguracaoProspeccao(pool)
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
      const deduplicados = resultados.filter((r) => r.deduplicado)
      const enviados = resultados.filter((r) => r.ok && !r.deduplicado)
      const falhasTemporarias = resultados.filter((r) => !r.ok && !r.deduplicado && r.retryable)
      const falhasDefinitivas = resultados.filter((r) => !r.ok && !r.deduplicado && !r.retryable)
      const detalhes = resultados.map((r) => ({
        prospect_id: r.prospect_id,
        status: r.ok ? (r.deduplicado ? 'deduplicado' : 'enviado') : (r.retryable ? 'retry_agendado' : 'falha_definitiva'),
        motivo: r.motivo || r.erro || null,
        retryable: r.retryable || false,
      }))

      // Limpar agendado_para apenas dos enviados com sucesso (falhas retryable serão reagendadas pelo job)
      const idsEnviados = enviados.map((r) => r.prospect_id).filter(Boolean)
      if (idsEnviados.length) {
        await pool.query(
          `UPDATE prospectador.diagnosticos SET agendado_para = NULL, updated_at = NOW()
           WHERE prospect_id = ANY($1::uuid[])`,
          [idsEnviados]
        )
      }

      res.json({
        ok: falhasDefinitivas.length === 0 && falhasTemporarias.length === 0,
        enviados: enviados.length,
        deduplicados: deduplicados.length,
        falhas_temporarias: falhasTemporarias.length,
        falhas_definitivas: falhasDefinitivas.length,
        detalhes,
      })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/configuracao', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const config = await obterConfiguracaoProspeccao(pool)
      const limite = config?.limite_diario || config?.limit || 80
      const planejamento_busca = await resolverPlanejamentoBuscaAuto({
        limit: limite,
        categoria: config?.categoria_padrao || config?.categoria || null,
      })
      res.json({
        ok: true,
        config,
        agenda: montarAgendaPainelProspeccao(config),
        planejamento_busca,
      })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.put('/dashboard/prospeccao/configuracao', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const config = await salvarConfiguracaoProspeccao(pool, req.body || {})
      const limite = config?.limite_diario || config?.limit || 80
      const planejamento_busca = await resolverPlanejamentoBuscaAuto({
        limit: limite,
        categoria: config?.categoria_padrao || config?.categoria || null,
      })
      res.json({
        ok: true,
        config,
        agenda: montarAgendaPainelProspeccao(config),
        planejamento_busca,
      })
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/fila-diaria/simular', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await criarFilaDiariaSimulada(pool, req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/fila-diaria/simular-places', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await simularFilaDiariaComPlaces(pool, req.body || {}, { pesquisarPlacesFn: pesquisarPlaces })
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/fila-diaria', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await obterPainelFilaDiaria(pool, req.query || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/execucoes', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await listarExecucoesDiarias(pool, req.query || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/bloqueios', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await listarBloqueiosProspeccao(pool, req.query || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/relatorio-diario', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await obterRelatorioDiarioProspeccao(pool, req.query || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/relatorio-diario/gerar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await gerarRelatorioDiarioProspeccao(pool, req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/relatorio-diario/enviar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await enviarRelatorioDiarioOperadores(pool, req.body || {}, { enviarMensagemFn: enviarMensagem })
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.get('/dashboard/prospeccao/analytics', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await obterDashboardEstrategicoProspeccao(pool, req.query || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/fila-diaria/:id/gerar-mensagem', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await gerarMensagemParaItemFila(pool, req.params.id, { aiProvider, logger })
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.patch('/dashboard/prospeccao/fila-diaria/:id/mensagem', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await editarMensagemItemFila(pool, req.params.id, req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/fila-diaria/:id/cancelar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await cancelarItemFilaDiaria(pool, req.params.id, req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/execucoes/:id/pausar', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const resultado = await pausarExecucaoDiaria(pool, req.params.id, req.body || {})
      res.json(resultado)
    } catch (err) {
      const e = erroHttp(err)
      res.status(e.status).json({ erro: e.erro })
    }
  })

  app.post('/dashboard/prospeccao/fila-diaria/:id/agendar-envio', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ erro: 'Nao autorizado' })
    try {
      const preparado = await prepararItemFilaParaJobEnvio(pool, req.params.id)
      const job = await enfileirarJobProspeccao(
        'prospeccao_envio_agendado',
        { fila_id: preparado.fila_id },
        `prospeccao_fila_envio:${preparado.fila_id}`,
        preparado.slot_envio
      )
      const item = await marcarJobAgendadoNaFila(pool, preparado.fila_id, job.id)
      res.json({
        ok: true,
        fila_id: preparado.fila_id,
        job,
        item,
        envio_real_habilitado: true,
        aguardando_worker: true,
      })
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
  atualizarEmailProspect,
  atualizarStatusProspect,
  atualizarStatusProspectsLote,
  calcularScoreProspect,
  canProspectLead,
  criarFilaDiariaSimulada,
  listarExecucoesDiarias,
  obterPainelFilaDiaria,
  cancelarItemFilaDiaria,
  pausarExecucaoDiaria,
  listarBloqueiosProspeccao,
  gerarRelatorioDiarioProspeccao,
  obterRelatorioDiarioProspeccao,
  enviarRelatorioDiarioOperadores,
  obterDashboardEstrategicoProspeccao,
  simularFilaDiariaComPlaces,
  gerarMensagemParaItemFila,
  editarMensagemItemFila,
  processarEnvioFilaAgendado,
  prepararItemFilaParaJobEnvio,
  marcarJobAgendadoNaFila,
  calcularScoreV2,
  registrarDecisionLog,
  validarProspectAntesDoEnvio,
  persistirScoreV2Prospect,
  fallbackDiagnosticoEstruturado,
  parsearJsonDiagnosticoEstruturado,
  gerarDiagnosticoEstruturado,
  rotearOferta,
  gerarMensagemComercialV2,
  montarMensagemComercialV2Fallback,
  salvarDiagnosticoV2,
  gerarPipelineDiagnosticoV2,
  consumirJobsProspeccao,
  enfileirarJobProspeccao,
  enviarProspectsAprovados,
  processarFluxoCompleto,
  gerarDiagnosticos,
  buscarContextoProspeccao,
  listarProspects,
  marcarProspectComoRespondeuPorNumero,
  marcarFilaProspeccaoRespondidaPorNumero,
  bloquearProspeccaoPorRespostaLead,
  mapearPlace,
  normalizarNumeroWhatsapp,
  normalizarProspectParaPersistencia,
  executarJobProspeccao,
  obterMetricasProspeccao,
  buscarFilaAprovacao,
  obterMetricasFilaAprovacao,
  aprovarProspectComOferta,
  rejeitarProspectComMotivo,
  alterarOfertaProspect,
  obterConfiguracaoProspeccao,
  obterJanelaSemanal,
  montarAgendaPainelAutoProspeccao,
  pesquisarPlaces,
  proximoSlotComercial,
  registerProspectingRoutes,
  resolverPlanejamentoBuscaAuto,
  salvarConfiguracaoProspeccao,
  salvarProspect,
  salvarProspects,
  selecionarMercadoDiario,
  sincronizarNichosPerformantes,
  substituirPlaceholderEmpresa,
  temPlaceholderResidual,
  verificarAgendaDiariaProspeccao,
  verificarAgendaBuscaRecorrenteProspeccao,
  selecionarMercadoDiarioIA,
  resumoMercadosProspeccao,
  agendarEnvioItemFilaDiaria,
  slotEnvioParaInstante,
}
