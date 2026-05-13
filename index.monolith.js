const express = require('express')
const axios = require('axios')
const FormData = require('form-data')
const { Pool } = require('pg')
const path = require('path')
const fs = require('fs')

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const linha of linhas) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}

carregarEnvLocal()

const app = express()
app.use(express.json({ limit: '20mb' }))

// Bloqueia acesso direto a arquivos sensíveis antes do static middleware
const PATHS_BLOQUEADOS = ['/index.js', '/package.json', '/package-lock.json', '/dockerfile', '/docker-compose.yml']
const DIRS_BLOQUEADOS = ['/sql', '/prompts', '/knowledge', '/node_modules', '/.env', '/.git']
app.use((req, res, next) => {
  const p = req.path.toLowerCase()
  if (PATHS_BLOQUEADOS.some(b => p === b) || DIRS_BLOQUEADOS.some(d => p === d || p.startsWith(d + '/'))) {
    return res.status(404).end()
  }
  next()
})

app.use(express.static(path.join(__dirname)))

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || 'pjcodeworks123'
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE || 'PJ'
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY
const OPENAI_KEY = process.env.OPENAI_KEY || ''
/** Transcrição de áudios via Whisper local (whisper-service). */
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://whisper-service:9000'
/** Limite aproximado para enviar imagem ao Claude (bytes decodificados). */
const MAX_IMAGEM_BYTES_CLAUDE = 4 * 1024 * 1024
/**
 * Silêncio mínimo após a última mensagem do cliente antes de gerar resposta (agrupa vários envios seguidos).
 * Só em memória deste processo; múltiplas instâncias Node não compartilham o debounce.
 */
const WEBHOOK_REPLY_DEBOUNCE_MS = Math.min(
  Math.max(parseInt(process.env.WEBHOOK_REPLY_DEBOUNCE_MS, 10) || 2500, 200),
  60000
)
/** Se 1/true, remove padrões de CPF na mensagem enviada ao lead (pós-processo de segurança). */
function sanitizarCpfRespostaHabilitado() {
  const v = String(process.env.SANITIZAR_CPF_RESPOSTA ?? '0')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}
const CLAUDE_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 45000, 5000),
  180000
)
/** Web search na API: desative com CLAUDE_WEB_SEARCH=0 se a organização não tiver a ferramenta habilitada. */
function claudeWebSearchHabilitado() {
  const v = String(process.env.CLAUDE_WEB_SEARCH ?? '1').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}
const CLAUDE_WEB_SEARCH_MAX_USES = Math.min(
  Math.max(parseInt(process.env.CLAUDE_WEB_SEARCH_MAX_USES, 10) || 5, 1),
  20
)
const CLAUDE_WEB_SEARCH_PAUSE_MAX = Math.min(
  Math.max(parseInt(process.env.CLAUDE_WEB_SEARCH_PAUSE_MAX, 10) || 8, 1),
  15
)
const CLAUDE_TIMEOUT_COM_BUSCA_MS = Math.min(
  Math.max(
    parseInt(process.env.CLAUDE_WEB_SEARCH_TIMEOUT_MS, 10) || Math.max(CLAUDE_TIMEOUT_MS, 120000),
    CLAUDE_TIMEOUT_MS
  ),
  300000
)
const ALERTA_FALHA_RESPOSTA_DEDUPE_MS = 15 * 60 * 1000
/**
 * Opcional: `OPERATOR_WHATSAPP` e/ou `VICTOR_WHATSAPP` — mesmo formato (DDI+DDD+número ou JID).
 * Alertas de handoff e lacunas vão direto ao WhatsApp dos operadores; comandos (PAUSAR etc.) usam
 * `OPERATOR_WHATSAPP` ou, se ausente, `VICTOR_WHATSAPP`.
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://evolution:evolution@postgres:5432/evolution_api',
  searchPath: ['vendas']
})

/** Carregado em loadSystemPrompt() antes do initDB. */
let SYSTEM_PROMPT_BASE = ''
/** Prompt dedicado a mensagens manuais de follow-up (dashboard). */
let FOLLOWUP_PROMPT_BASE = ''
/** Prompt dedicado a decidir timing/instrucao de follow-up automatico. */
let FOLLOWUP_TIMING_PROMPT_BASE = ''
/** Coach interno + prompt Gamma (dashboard perfil do lead). */
let LEAD_COACH_PROMPT_BASE = ''
/** Conhecimento autorizado: empresa, ICP, prova social, links (prompts/empresa.md). */
let EMPRESA_KNOWLEDGE_BASE = ''
/** Catálogo estruturado de cases (knowledge/cases.json) — uso futuro / consistência. */
let CASES_CATALOG = null

const FOLLOWUP_INSTRUCAO_MAX_CHARS = 2000
/** Follow-up em data explícita (`agendar_followup_auto` no JSON do modelo). */
const FOLLOWUP_EXPLICITO_MIN_MINUTOS = 15
const FOLLOWUP_EXPLICITO_MAX_DIAS = 30
const FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO =
  'Retomada combinada com o lead: checar se o momento mudou; manter tom leve e continuidade natural.'
const FOLLOWUP_LOTE_MAX_ITENS = 50
const FOLLOWUP_SNIPPET_MAX_CHARS = 300
const FOLLOWUP_ERRO_LOG_MAX_CHARS = 500
const LEAD_CONTEXTO_MAX_CHARS = 4000
const LEAD_CONTEXTO_PROMPT_LIMIT = 8
const AUDIO_UPLOAD_MAX_BYTES = 18 * 1024 * 1024
/** Janela para atribuir resposta do lead ao follow-up mais recente ainda aberto. */
const FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS = 30
const JOB_WORKER_POLL_MS = Math.min(
  Math.max(parseInt(process.env.JOB_WORKER_POLL_MS, 10) || 1500, 250),
  30000
)
const JOB_WORKER_LOCK_MS = Math.min(
  Math.max(parseInt(process.env.JOB_WORKER_LOCK_MS, 10) || 120000, 10000),
  600000
)
const JOB_MAX_ATTEMPTS = Math.min(
  Math.max(parseInt(process.env.JOB_MAX_ATTEMPTS, 10) || 5, 1),
  20
)
const SILENCE_WATCHER_INTERVAL_MS = Math.min(
  Math.max(parseInt(process.env.SILENCE_WATCHER_INTERVAL_MS, 10) || 60000, 10000),
  30 * 60 * 1000
)
const SILENCE_TRIGGER_MINUTES = Math.min(
  Math.max(parseInt(process.env.SILENCE_TRIGGER_MINUTES, 10) || 5, 1),
  24 * 60
)
const FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO = Math.min(
  Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PADRAO, 10) || 3, 1),
  10
)
const FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO = {
  primeiro_contato: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PRIMEIRO_CONTATO, 10) || 1, 1), 10),
  proposta_enviada: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_PROPOSTA_ENVIADA, 10) || 5, 1), 10),
  negociacao: Math.min(Math.max(parseInt(process.env.FOLLOWUP_AUTO_SEQ_NEGOCIACAO, 10) || 5, 1), 10),
}
const FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA = 1
const FOLLOWUP_AUTO_BUSINESS_TZ = process.env.FOLLOWUP_AUTO_BUSINESS_TZ || 'America/Sao_Paulo'
const FOLLOWUP_AUTO_BUSINESS_START_HOUR = Math.min(
  Math.max(parseInt(process.env.FOLLOWUP_AUTO_BUSINESS_START_HOUR, 10) || 8, 0),
  23
)
const FOLLOWUP_AUTO_BUSINESS_END_HOUR = Math.min(
  Math.max(
    parseInt(process.env.FOLLOWUP_AUTO_BUSINESS_END_HOUR, 10) || 20,
    FOLLOWUP_AUTO_BUSINESS_START_HOUR + 1
  ),
  24
)
const FOLLOWUP_AUTO_DELAY_HORAS = {
  1: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ1_H) || 2),
  2: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ2_H) || 24),
  3: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ3_H) || 72),
  4: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ4_H) || 120),
  5: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ5_H) || 168),
  6: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ6_H) || 168),
  7: Math.max(0.05, parseFloat(process.env.FOLLOWUP_AUTO_DELAY_SEQ7_H) || 168),
}

/** Campos de `lead_profiles` que o modelo (ou servidor) pode persistir via `atualizarPerfil`. */
const LEAD_PROFILE_CAMPOS_PERMITIDOS = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'plano_sugerido',
  'preco_calculado',
  'entrada',
  'parcela',
  'precificacao_json',
  'pronto_handoff',
  'temperatura_lead',
])
/**
 * Campos diagnósticos rastreados em `campos_coletados` (JSONB).
 * Registramos o timestamp ISO da primeira vez que cada campo recebe valor não-nulo.
 * Estes são os campos que o agente coleta por conversa; campos de motor/sistema são excluídos.
 */
const LEAD_CAMPOS_DIAGNOSTICO = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'temperatura_lead',
])
/** Horas abaixo das quais o follow-up deve soar como continuação natural do fio. */
const FOLLOWUP_HORAS_CONTINUACAO = 6
/** Horas a partir das quais o follow-up deve soar como retomada após tempo sem contato. */
const FOLLOWUP_HORAS_DISTANCIADO = 24

/** Envio em várias bolhas (mensagens_bolhas ou heurística \n\n). */
const BOLHAS_ENVIO_DELAY_MS = 450
const MAX_MENSAGENS_BOLHAS = 4
const MAX_CARACTERES_POR_BOLHA = 500

/** Campos opcionais JSON: lacunas de conhecimento (servidor também trunca). */
const MAX_TEMA_LACUNA_CHARS = 120
const MAX_DETALHE_LACUNA_CHARS = 500
/** Tamanho máximo do trecho de histórico enviado ao coach (caracteres). */
const LEAD_COACH_MAX_TRANSCRIPT_CHARS = 14000

function loadSystemPrompt() {
  const p = path.join(__dirname, 'prompts', 'system.md')
  if (fs.existsSync(p)) {
    SYSTEM_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    console.log('✅ prompts/system.md carregado')
  } else {
    SYSTEM_PROMPT_BASE = ''
    console.warn('⚠️ prompts/system.md não encontrado — usando fallback mínimo no chamarClaude')
  }
}

function loadFollowupPrompt() {
  const p = path.join(__dirname, 'prompts', 'followup.md')
  if (fs.existsSync(p)) {
    FOLLOWUP_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    console.log('✅ prompts/followup.md carregado')
  } else {
    FOLLOWUP_PROMPT_BASE = ''
    console.warn('⚠️ prompts/followup.md não encontrado — usando fallback mínimo no follow-up')
  }
}

function loadFollowupTimingPrompt() {
  const p = path.join(__dirname, 'prompts', 'followup_timing.md')
  if (fs.existsSync(p)) {
    FOLLOWUP_TIMING_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    console.log('prompts/followup_timing.md carregado')
  } else {
    FOLLOWUP_TIMING_PROMPT_BASE = ''
    console.warn('prompts/followup_timing.md nao encontrado - usando fallback de timing')
  }
}

function loadLeadCoachPrompt() {
  const p = path.join(__dirname, 'prompts', 'lead-coach.md')
  if (fs.existsSync(p)) {
    LEAD_COACH_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    console.log('✅ prompts/lead-coach.md carregado')
  } else {
    LEAD_COACH_PROMPT_BASE = ''
    console.warn('⚠️ prompts/lead-coach.md não encontrado — usando fallback mínimo no lead-coach')
  }
}

function loadEmpresaKnowledge() {
  const p = path.join(__dirname, 'prompts', 'empresa.md')
  if (fs.existsSync(p)) {
    EMPRESA_KNOWLEDGE_BASE = fs.readFileSync(p, 'utf8')
    console.log('✅ prompts/empresa.md carregado (conhecimento autorizado)')
  } else {
    EMPRESA_KNOWLEDGE_BASE = ''
    console.warn('⚠️ prompts/empresa.md não encontrado — agente sem bloco de empresa/cases')
  }
}

function loadCasesCatalog() {
  const p = path.join(__dirname, 'knowledge', 'cases.json')
  if (fs.existsSync(p)) {
    try {
      CASES_CATALOG = JSON.parse(fs.readFileSync(p, 'utf8'))
      const n = Array.isArray(CASES_CATALOG?.casos) ? CASES_CATALOG.casos.length : 0
      console.log(`✅ knowledge/cases.json carregado (${n} casos)`)
    } catch (e) {
      CASES_CATALOG = null
      console.warn('⚠️ knowledge/cases.json inválido:', e.message)
    }
  } else {
    CASES_CATALOG = null
    console.warn('⚠️ knowledge/cases.json não encontrado')
  }
}

/**
 * URLs permitidas em links_sugeridos (alinhado a prompts/empresa.md).
 */
function urlAutorizadaConhecimento(raw) {
  try {
    const u = new URL(String(raw).trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'pjcodeworks.com.br' || h === 'www.pjcodeworks.com.br') return true
    if (h === 'instagram.com' || h === 'www.instagram.com') return true
    if (h.endsWith('.vercel.app')) return true
    if (h === 'gurgelclean.com.br' || h === 'www.gurgelclean.com.br') return true
    if (h === '874vidroseesquadrias.com.br' || h === 'www.874vidroseesquadrias.com.br') return true
    if (h === 'geral1914.com.br' || h === 'www.geral1914.com.br') return true
    return false
  } catch {
    return false
  }
}

function filtrarLinksSugeridosParaEnvio(urls, textoJaEnviado) {
  const base = typeof textoJaEnviado === 'string' ? textoJaEnviado : ''
  const out = []
  if (!Array.isArray(urls)) return out
  for (const u of urls) {
    if (typeof u !== 'string') continue
    const t = u.trim()
    if (!t || !urlAutorizadaConhecimento(t)) continue
    if (base.includes(t)) continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= 3) break
  }
  return out
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Estado por JID: debounce de resposta ao webhook (não compartilhado entre réplicas). */
const debounceRespostaPorJid = new Map()
/** Deduplicação em memória para alertas repetidos da mesma falha operacional. */
const alertaFalhaRespostaPorJid = new Map()

function obterEstadoDebounceResposta(numero) {
  if (!debounceRespostaPorJid.has(numero)) {
    debounceRespostaPorJid.set(numero, {
      timer: null,
      visaoLote: null,
      geracaoEmAndamento: false,
      pendenteAposGeracao: false,
    })
  }
  return debounceRespostaPorJid.get(numero)
}

/** Novas mensagens só de usuário foram anexadas ao histórico após o snapshot usado no Claude. */
function historicoCresceuSoComUsers(lenAntes, hDepois) {
  if (!hDepois || hDepois.length <= lenAntes) return false
  for (let i = lenAntes; i < hDepois.length; i++) {
    if (hDepois[i].role !== 'user') return false
  }
  return true
}

function agendarRespostaWebhookDebounced(numero) {
  const st = obterEstadoDebounceResposta(numero)
  if (st.timer) clearTimeout(st.timer)
  st.timer = setTimeout(() => {
    st.timer = null
    enfileirarJobRespostaWebhook(numero).catch((e) =>
      console.error('Erro ao enfileirar resposta webhook:', e.response?.data || e.message)
    )
  }, WEBHOOK_REPLY_DEBOUNCE_MS)
}

/** Cancela timer pendente e snapshot de mídia do debounce para este JID (ex.: intervenção humana). */
function limparDebounceResposta(numero) {
  const st = obterEstadoDebounceResposta(numero)
  if (st.timer) clearTimeout(st.timer)
  st.timer = null
  st.visaoLote = null
  st.pendenteAposGeracao = false
}

async function processarRespostaWebhookDebounced(numero) {
  const st = obterEstadoDebounceResposta(numero)
  const conversa = await buscarConversa(numero)
  if (!conversa || conversa.agente_pausado) {
    st.visaoLote = null
    return
  }

  st.geracaoEmAndamento = true
  try {
    const historico = normalizarHistoricoMensagens(conversa.historico)
    const estagio = conversa.estagio || 'primeiro_contato'
    const visao = st.visaoLote
    st.visaoLote = null

    const ret = await gerarEEnviarRespostaWhatsapp(numero, historico, estagio, conversa, visao)
    if (ret && ret.stale) {
      st.pendenteAposGeracao = false
      agendarRespostaWebhookDebounced(numero)
      return
    }
  } catch (err) {
    if (err && err.leadMessageSent) {
      console.error('❌ Pós-envio webhook:', err.message)
      return
    }
    const falha = classificarErroRespostaWebhook(err)
    console.error(`❌ Debounce webhook [${falha.codigo}]:`, falha.detalhe || falha.resumo)
    try {
      await registrarFalhaResposta(numero, falha)
    } catch (dbErr) {
      console.error('❌ Registrar falha de resposta:', dbErr.message)
    }
    try {
      await alertarFalhaResposta(numero, falha)
    } catch (alertErr) {
      console.error('❌ Alerta de falha de resposta:', alertErr.message)
    }
  } finally {
    st.geracaoEmAndamento = false
    if (st.pendenteAposGeracao) {
      st.pendenteAposGeracao = false
      agendarRespostaWebhookDebounced(numero)
    }
  }
}

async function enfileirarJobRespostaWebhook(numero) {
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!jid) return null
  const dedupe = `webhook_resposta:${jid}`
  const payload = JSON.stringify({ numero: jid })
  const delayMs = Math.max(WEBHOOK_REPLY_DEBOUNCE_MS, 0)
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
    VALUES ('webhook_resposta', $1, $2::jsonb, 'pending', 0, $3, NOW() + ($4::int * INTERVAL '1 millisecond'))
    ON CONFLICT (dedupe_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
      attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
      available_at = GREATEST(vendas.job_queue.available_at, EXCLUDED.available_at),
      atualizado_em = NOW()
    RETURNING id
    `,
    [dedupe, payload, JOB_MAX_ATTEMPTS, delayMs]
  )
  return rows[0]?.id || null
}

function sequenciasComerciaisFollowupPorEstagio(estagio) {
  const key = String(estagio || '').trim().toLowerCase()
  return FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO[key] || FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO
}

function maxSequenciaFollowupAutoPorEstagio(estagio) {
  return sequenciasComerciaisFollowupPorEstagio(estagio) + FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA
}

function isSequenciaEncerramentoFollowup(estagio, sequencia) {
  const seq = Math.max(1, parseInt(sequencia, 10) || 1)
  return seq > sequenciasComerciaisFollowupPorEstagio(estagio)
}

function horasPadraoFollowupAuto(sequencia) {
  const seq = Math.max(1, parseInt(sequencia, 10) || 1)
  return FOLLOWUP_AUTO_DELAY_HORAS[seq] || FOLLOWUP_AUTO_DELAY_HORAS[1]
}

function normalizarTimingOverrideHoras(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(Math.max(n, 0.05), 168)
}

function partesDataEmTimezone(date, timeZone) {
  const dt = date instanceof Date ? date : new Date(date)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = {}
  for (const p of fmt.formatToParts(dt)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  }
}

function utcParaDataLocalEmTimezone({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  for (let i = 0; i < 3; i++) {
    const got = partesDataEmTimezone(new Date(guess), timeZone)
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second, 0)
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0)
    const diff = targetUtc - gotUtc
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

function adicionarDiasLocalEmTimezone(partes, dias) {
  const d = new Date(Date.UTC(partes.year, partes.month - 1, partes.day + dias, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

const FOLLOWUP_JANELAS_OTIMIZADAS = [
  { start: [8, 30], end: [10, 30] },
  { start: [11, 40], end: [13, 15] },
  { start: [14, 30], end: [17, 0] },
  { start: [18, 30], end: [20, 0] },
]

function ajustarParaJanelaComercialFollowup(date, timeZone = FOLLOWUP_AUTO_BUSINESS_TZ) {
  const dt = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(dt.getTime())) return dt
  
  function snapParaInicio(partes, h, m) {
    return utcParaDataLocalEmTimezone(
      { year: partes.year, month: partes.month, day: partes.day, hour: h, minute: m, second: 0 },
      timeZone
    )
  }

  let p
  try {
    p = partesDataEmTimezone(dt, timeZone)
  } catch (e) {
    console.warn(`Timezone invalido para follow-up (${timeZone}); usando horario do servidor:`, e.message)
    const local = new Date(dt)
    const decLocal = local.getHours() + local.getMinutes() / 60
    for (const janela of FOLLOWUP_JANELAS_OTIMIZADAS) {
      const jStart = janela.start[0] + janela.start[1] / 60
      const jEnd = janela.end[0] + janela.end[1] / 60
      if (decLocal < jStart) {
        local.setHours(janela.start[0], janela.start[1], 0, 0)
        return local
      }
      if (decLocal < jEnd) return dt
    }
    const out = new Date(dt)
    out.setDate(out.getDate() + 1)
    out.setHours(FOLLOWUP_JANELAS_OTIMIZADAS[0].start[0], FOLLOWUP_JANELAS_OTIMIZADAS[0].start[1], 0, 0)
    return out
  }

  const decLocal = p.hour + p.minute / 60
  for (const janela of FOLLOWUP_JANELAS_OTIMIZADAS) {
    const jStart = janela.start[0] + janela.start[1] / 60
    const jEnd = janela.end[0] + janela.end[1] / 60
    if (decLocal < jStart) return snapParaInicio(p, janela.start[0], janela.start[1])
    if (decLocal < jEnd) return dt
  }
  const prox = adicionarDiasLocalEmTimezone(p, 1)
  return utcParaDataLocalEmTimezone(
    { ...prox, hour: FOLLOWUP_JANELAS_OTIMIZADAS[0].start[0], minute: FOLLOWUP_JANELAS_OTIMIZADAS[0].start[1], second: 0 },
    timeZone
  )
}

async function enfileirarJobFollowupAuto(agendamentoId, numero, agendadoPara) {
  const id = parseInt(agendamentoId, 10)
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!id || !jid) return null
  const dedupe = `followup_auto:${id}`
  const payload = JSON.stringify({ agendamento_id: id, numero: jid })
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
    VALUES ('followup_auto', $1, $2::jsonb, 'pending', 0, $3, $4::timestamptz)
    ON CONFLICT (dedupe_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
      attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
      available_at = EXCLUDED.available_at,
      atualizado_em = NOW()
    RETURNING id
    `,
    [dedupe, payload, JOB_MAX_ATTEMPTS, agendadoPara]
  )
  return rows[0]?.id || null
}

async function cancelarFollowupsAutoPendentes(numero, motivo = 'lead_respondeu') {
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!jid) return 0
  const { rows } = await pool.query(
    `
    UPDATE vendas.followup_auto_agendamentos
    SET status = 'cancelado',
        cancelado_em = NOW(),
        motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, $2::text), 1000)
    WHERE numero = $1
      AND status = 'agendado'
    RETURNING job_id
    `,
    [jid, motivo]
  )
  const jobIds = rows.map((r) => r.job_id).filter((x) => x != null)
  if (jobIds.length) {
    await pool.query(
      `
      UPDATE vendas.job_queue
      SET status = 'completed',
          last_error = $2,
          locked_at = NULL,
          locked_until = NULL,
          atualizado_em = NOW()
      WHERE id = ANY($1::bigint[])
        AND status = 'pending'
      `,
      [jobIds, `cancelado: ${motivo}`]
    )
  }
  return rows.length
}

async function resumoEventosComerciaisFollowup(numero) {
  const jid = typeof numero === 'string' ? numero.trim() : ''
  const base = {
    pediu_preco: { ocorreu: false, quantidade: 0, ultimo_em: null },
    recebeu_proposta: { ocorreu: false, quantidade: 0, ultimo_em: null },
    respondeu_followup: { ocorreu: false, quantidade: 0, ultimo_em: null },
    recebeu_preview: { ocorreu: false, quantidade: 0, ultimo_em: null },
  }
  if (!jid) return base
  try {
    const { rows } = await pool.query(
      `
      SELECT tipo, COUNT(*)::int AS quantidade, MAX(criado_em) AS ultimo_em
      FROM vendas.eventos_comerciais
      WHERE numero = $1::text
        AND tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview')
      GROUP BY tipo
      `,
      [jid]
    )
    for (const row of rows) {
      if (!Object.prototype.hasOwnProperty.call(base, row.tipo)) continue
      base[row.tipo] = {
        ocorreu: (parseInt(row.quantidade, 10) || 0) > 0,
        quantidade: parseInt(row.quantidade, 10) || 0,
        ultimo_em: row.ultimo_em ? new Date(row.ultimo_em).toISOString() : null,
      }
    }
  } catch (e) {
    console.error('Erro ao resumir eventos comerciais para follow-up:', e.message)
  }
  return base
}

async function analisarTimingEInstrucao({ conversa, perfil, sequencia, silencioMin, ultimaMensagemIa }) {
  const timingPadraoHoras = horasPadraoFollowupAuto(sequencia)
  const encerramentoGentil = isSequenciaEncerramentoFollowup(conversa?.estagio, sequencia)
  const motivosFollowupPermitidos = new Set([
    'pediu_preco_sumiu',
    'proposta_enviada',
    'preview_sem_resposta',
    'demonstrou_interesse',
    'momento_comercial',
    'dor_nao_resolvida',
    'angulo_novo',
    'medo_de_investir',
    'sem_motivo_claro',
  ])
  const fallback = {
    horas: timingPadraoHoras,
    instrucao: encerramentoGentil
      ? 'Encerramento gentil: avise que fica a disposicao, sem pressao, e deixe a porta aberta para retomada futura. Nao tente reabrir com nova pergunta forte.'
      : null,
    motivo: encerramentoGentil
      ? `Fallback por regra fixa: encerramento gentil da sequencia ${sequencia}, ${timingPadraoHoras}h.`
      : `Fallback por regra fixa: sequencia ${sequencia}, ${timingPadraoHoras}h.`,
    motivoFollowup: 'sem_motivo_claro',
    origem: 'regra',
  }
  if (!ANTHROPIC_KEY) return fallback

  const prompt = FOLLOWUP_TIMING_PROMPT_BASE.trim() ||
    'Decida timing e instrucao de follow-up automatico. Responda apenas JSON valido.'
  const eventosComerciais = await resumoEventosComerciaisFollowup(conversa?.numero)
  const payload = {
    sequencia,
    encerramento_gentil: encerramentoGentil,
    timing_padrao_horas: timingPadraoHoras,
    silencio_min: silencioMin,
    temperatura_lead: perfil?.temperatura_lead || null,
    termometro_dor: perfil?.termometro_dor ?? perfil?.score_dor ?? null,
    ultima_mensagem_ia: String(ultimaMensagemIa || '').slice(0, 1200),
    estagio: conversa?.estagio || 'primeiro_contato',
    eventos_comerciais: eventosComerciais,
    perfil: perfilResumidoParaFollowup(perfil),
    hora_atual_sp: (() => {
      try {
        const sp = partesDataEmTimezone(new Date(), FOLLOWUP_AUTO_BUSINESS_TZ)
        return sp.hour + sp.minute / 60
      } catch {
        return null
      }
    })(),
  }

  try {
    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: prompt,
        messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
      },
      {
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout: Math.min(CLAUDE_TIMEOUT_MS, 30000),
      }
    )
    const bruto = resp.data?.content?.[0]?.text || ''
    const parsed = parsearRespostaJsonClaude(bruto)
    if (!parsed || typeof parsed !== 'object') return fallback
    const manter = parsed.manter_timing_padrao !== false
    const override = normalizarTimingOverrideHoras(parsed.timing_override_horas)
    const horas = !manter && override != null ? override : timingPadraoHoras
    const instrucao =
      typeof parsed.instrucao_followup === 'string' && parsed.instrucao_followup.trim()
        ? parsed.instrucao_followup.trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
        : fallback.instrucao
    const motivo =
      typeof parsed.motivo === 'string' && parsed.motivo.trim()
        ? parsed.motivo.trim().slice(0, 1000)
        : fallback.motivo
    const motivoFollowupRaw =
      typeof parsed.motivo_followup === 'string' && parsed.motivo_followup.trim()
        ? parsed.motivo_followup.trim()
        : fallback.motivoFollowup
    const motivoFollowup = motivosFollowupPermitidos.has(motivoFollowupRaw)
      ? motivoFollowupRaw
      : fallback.motivoFollowup
    return {
      horas,
      instrucao,
      motivo,
      motivoFollowup,
      origem: horas !== timingPadraoHoras ? 'claude_override' : 'regra',
    }
  } catch (e) {
    console.error('Erro ao analisar timing de follow-up automatico:', e.response?.data || e.message)
    return fallback
  }
}

async function agendarFollowupAutoParaConversa(row) {
  const numero = row.numero
  const maxSequencia = maxSequenciaFollowupAutoPorEstagio(row.estagio)
  const sequencia = Math.min(maxSequencia, Math.max(1, parseInt(row.sequencia, 10) || 1))
  const silencioMin = Math.max(0, parseInt(row.silencio_min, 10) || SILENCE_TRIGGER_MINUTES)
  const conversa = {
    numero,
    estagio: row.estagio,
    status: row.status,
    historico: row.historico,
  }
  const perfil = {
    numero,
    negocio: row.negocio,
    cidade: row.cidade,
    temperatura_lead: row.temperatura_lead,
    termometro_dor: row.termometro_dor,
    score_dor: row.score_dor,
    plano_sugerido: row.plano_sugerido,
    preco_calculado: row.preco_calculado,
    precificacao_json: row.precificacao_json,
  }
  const analise = await analisarTimingEInstrucao({
    conversa,
    perfil,
    sequencia,
    silencioMin,
    ultimaMensagemIa: row.ultima_mensagem_ia,
  })
  const agendadoPara = ajustarParaJanelaComercialFollowup(
    new Date(Date.now() + analise.horas * 60 * 60 * 1000)
  )
  const horasAjustadas = Math.max(0, (agendadoPara.getTime() - Date.now()) / 3600000)
  const motivoAjustado =
    Math.abs(horasAjustadas - analise.horas) > 0.01
      ? `${analise.motivo} | motivo_followup=${analise.motivoFollowup || 'sem_motivo_claro'} | Ajustado para janela otimizada (${FOLLOWUP_AUTO_BUSINESS_TZ}).`
      : `${analise.motivo} | motivo_followup=${analise.motivoFollowup || 'sem_motivo_claro'}`
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.followup_auto_agendamentos
      (numero, sequencia, silencio_min, agendado_para, instrucao_ia, motivo_decisao, timing_origem)
    VALUES (
      $1::text,
      $2::int,
      $3::int,
      $4::timestamptz,
      $5::text,
      $6::text,
      $7::text
    )
    RETURNING id, agendado_para
    `,
    [numero, sequencia, silencioMin, agendadoPara.toISOString(), analise.instrucao, motivoAjustado, analise.origem]
  )
  const ag = rows[0]
  const jobId = await enfileirarJobFollowupAuto(ag.id, numero, ag.agendado_para)
  await pool.query('UPDATE vendas.followup_auto_agendamentos SET job_id = $2 WHERE id = $1', [ag.id, jobId])
  console.log(`Follow-up automatico agendado para ${numero} seq=${sequencia} em ${horasAjustadas.toFixed(2)}h`)
  return ag.id
}

/**
 * Grava follow-up automático em data/hora explícita (campo `agendar_followup_auto` do modelo).
 * @returns {Promise<number|null>}
 */
async function persistirAgendamentoFollowupExplicito(numero, agendarNorm, estagio) {
  if (!agendarNorm || !numero) return null
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!jid) return null
  await cancelarFollowupsAutoPendentes(jid, 'substituido_agendamento_explicito')
  const agendadoPara = new Date(agendarNorm.agendar_para)
  if (Number.isNaN(agendadoPara.getTime())) return null
  const silencioMin = Math.max(0, Math.floor((agendadoPara.getTime() - Date.now()) / 60000))
  const { rows: cntRows } = await pool.query(
    `
    SELECT COUNT(*)::int AS n
    FROM vendas.followup_auto_agendamentos
    WHERE numero = $1::text AND status IN ('agendado', 'executado')
    `,
    [jid]
  )
  const totalAuto = parseInt(cntRows[0]?.n, 10) || 0
  const seqCap = maxSequenciaFollowupAutoPorEstagio(estagio || 'default')
  const sequencia = Math.min(seqCap, Math.max(1, totalAuto + 1))
  const instrTrim = String(agendarNorm.instrucao_followup || '').trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
  const motivoDecisao = `Agendamento explicito pelo agente | ${instrTrim}`.slice(0, 1000)
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.followup_auto_agendamentos
      (numero, sequencia, silencio_min, agendado_para, instrucao_ia, motivo_decisao, timing_origem)
    VALUES ($1::text, $2::int, $3::int, $4::timestamptz, $5::text, $6::text, $7::text)
    RETURNING id, agendado_para
    `,
    [jid, sequencia, silencioMin, agendadoPara.toISOString(), instrTrim, motivoDecisao, 'regra']
  )
  const ag = rows[0]
  if (!ag) return null
  const jobId = await enfileirarJobFollowupAuto(ag.id, jid, ag.agendado_para)
  await pool.query('UPDATE vendas.followup_auto_agendamentos SET job_id = $2 WHERE id = $1', [ag.id, jobId])
  console.log(`Follow-up explicito agendado para ${jid} em ${ag.agendado_para}`)
  return ag.id
}

let silenceWatcherRodando = false
let silenceWatcherTimer = null

async function silenceWatcherTick() {
  if (silenceWatcherRodando) return
  silenceWatcherRodando = true
  try {
    await pool.query(
      `
      UPDATE vendas.conversas c
      SET status = 'aguardando_handoff',
          atualizado_em = NOW()
      WHERE c.status = 'ativo'
        AND COALESCE(c.agente_pausado, false) = false
        AND COALESCE(c.venda_fechada, false) = false
        AND COALESCE(jsonb_array_length(c.historico), 0) > 0
        AND (c.historico->-1->>'role') = 'assistant'
        AND c.atualizado_em <= NOW() - ($1::int * INTERVAL '1 minute')
        AND (
          SELECT COUNT(*)::int
          FROM vendas.followup_auto_agendamentos fa
          WHERE fa.numero = c.numero
            AND fa.status = 'executado'
        ) >= CASE
          WHEN c.estagio = 'primeiro_contato' THEN $2::int
          WHEN c.estagio IN ('proposta_enviada', 'negociacao') THEN $3::int
          ELSE $4::int
        END
        AND NOT EXISTS (
          SELECT 1
          FROM vendas.followup_auto_agendamentos fa
          WHERE fa.numero = c.numero
            AND fa.status = 'agendado'
        )
      `,
      [
        SILENCE_TRIGGER_MINUTES,
        maxSequenciaFollowupAutoPorEstagio('primeiro_contato'),
        maxSequenciaFollowupAutoPorEstagio('proposta_enviada'),
        maxSequenciaFollowupAutoPorEstagio('default'),
      ]
    )
    const { rows } = await pool.query(
      `
      WITH elegiveis AS (
        SELECT c.numero,
               c.historico,
               c.estagio,
               c.status,
               c.atualizado_em,
               p.negocio,
               p.cidade,
               p.temperatura_lead,
               p.termometro_dor,
               p.score_dor,
               p.plano_sugerido,
               p.preco_calculado,
               p.precificacao_json,
               LEFT(COALESCE(c.historico->-1->>'content', ''), 1200) AS ultima_mensagem_ia,
               GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.atualizado_em)) / 60))::int AS silencio_min,
               (
                 SELECT COUNT(*)::int
                 FROM vendas.followup_auto_agendamentos fa
                 WHERE fa.numero = c.numero
                   AND fa.status IN ('agendado', 'executado')
               ) AS total_auto
        FROM vendas.conversas c
        LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
        WHERE c.status = 'ativo'
          AND COALESCE(c.agente_pausado, false) = false
          AND COALESCE(c.venda_fechada, false) = false
          AND COALESCE(jsonb_array_length(c.historico), 0) > 0
          AND (c.historico->-1->>'role') = 'assistant'
          AND c.atualizado_em <= NOW() - ($1::int * INTERVAL '1 minute')
          AND NOT EXISTS (
            SELECT 1
            FROM vendas.followup_auto_agendamentos fa
            WHERE fa.numero = c.numero
              AND fa.status = 'agendado'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vendas.job_queue q
            WHERE q.tipo = 'followup_auto'
              AND q.status IN ('pending', 'processing')
              AND q.payload->>'numero' = c.numero
          )
        ORDER BY c.atualizado_em ASC
        LIMIT 20
      )
      SELECT *, total_auto + 1 AS sequencia
      FROM elegiveis
      WHERE total_auto < CASE
        WHEN estagio = 'primeiro_contato' THEN $2::int
        WHEN estagio IN ('proposta_enviada', 'negociacao') THEN $3::int
        ELSE $4::int
      END
      `,
      [
        SILENCE_TRIGGER_MINUTES,
        maxSequenciaFollowupAutoPorEstagio('primeiro_contato'),
        maxSequenciaFollowupAutoPorEstagio('proposta_enviada'),
        maxSequenciaFollowupAutoPorEstagio('default'),
      ]
    )
    for (const row of rows) {
      try {
        await agendarFollowupAutoParaConversa(row)
      } catch (e) {
        console.error('Erro ao agendar follow-up automatico:', e.response?.data || e.message)
      }
    }
  } catch (err) {
    console.error('Erro no watcher de silencio:', err.message)
  } finally {
    silenceWatcherRodando = false
  }
}

function iniciarSilenceWatcher() {
  if (silenceWatcherTimer) return
  silenceWatcherTimer = setInterval(() => {
    silenceWatcherTick().catch((e) => console.error('Erro no tick watcher silencio:', e.message))
  }, SILENCE_WATCHER_INTERVAL_MS)
  silenceWatcherTick().catch((e) => console.error('Erro no primeiro tick watcher silencio:', e.message))
}

async function processarFollowupAutoJob(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {}
  const agendamentoId = parseInt(payload.agendamento_id, 10)
  const numero = typeof payload.numero === 'string' ? payload.numero : null
  if (!agendamentoId || !numero) throw new Error('Job followup_auto sem agendamento_id/numero')

  const { rows } = await pool.query(
    `
    SELECT fa.*, c.historico, c.status AS conversa_status, c.venda_fechada, c.agente_pausado
    FROM vendas.followup_auto_agendamentos fa
    JOIN vendas.conversas c ON c.numero = fa.numero
    WHERE fa.id = $1
    `,
    [agendamentoId]
  )
  const ag = rows[0]
  if (!ag || ag.status !== 'agendado') return
  const historico = normalizarHistoricoMensagens(ag.historico)
  const ultima = historico[historico.length - 1]
  const deveCancelar =
    ag.conversa_status !== 'ativo' ||
    ag.venda_fechada === true ||
    ag.agente_pausado === true ||
    !ultima ||
    ultima.role !== 'assistant'

  if (deveCancelar) {
    await pool.query(
      `
      UPDATE vendas.followup_auto_agendamentos
      SET status = 'cancelado',
          cancelado_em = NOW(),
          motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, 'cancelado antes da execucao: conversa mudou'), 1000)
      WHERE id = $1
      `,
      [agendamentoId]
    )
    return
  }

  try {
    await executarFollowupUmNumero(numero, ag.instrucao_ia)
    await pool.query(
      `UPDATE vendas.followup_auto_agendamentos SET status = 'executado', executado_em = NOW() WHERE id = $1`,
      [agendamentoId]
    )
  } catch (e) {
    const attempts = (parseInt(job.attempts, 10) || 0) + 1
    const final = attempts >= (parseInt(job.max_attempts, 10) || JOB_MAX_ATTEMPTS)
    await pool.query(
      `
      UPDATE vendas.followup_auto_agendamentos
      SET status = CASE WHEN $3::boolean THEN 'falhou' ELSE status END,
          motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, $2::text), 1000)
      WHERE id = $1
      `,
      [agendamentoId, `falha ao executar: ${e.message || e}`, final]
    )
    throw e
  }
}

async function reivindicarProximoJob() {
  const { rows } = await pool.query(
    `
    WITH next_job AS (
      SELECT id
      FROM vendas.job_queue
      WHERE (status = 'pending' AND available_at <= NOW())
         OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until < NOW())
      ORDER BY
        CASE
          WHEN tipo = 'webhook_resposta' THEN 0
          WHEN tipo = 'followup_auto' THEN 1
          WHEN tipo LIKE 'prospeccao_%' THEN 2
          ELSE 3
        END ASC,
        available_at ASC,
        id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vendas.job_queue q
    SET status = 'processing',
        locked_at = NOW(),
        locked_until = NOW() + ($1::int * INTERVAL '1 millisecond'),
        atualizado_em = NOW()
    FROM next_job
    WHERE q.id = next_job.id
    RETURNING q.*
    `,
    [JOB_WORKER_LOCK_MS]
  )
  return rows[0] || null
}

async function concluirJob(id) {
  await pool.query(
    `UPDATE vendas.job_queue SET status = 'completed', locked_at = NULL, locked_until = NULL, atualizado_em = NOW() WHERE id = $1`,
    [id]
  )
}

async function falharOuReagendarJob(job, err) {
  const attempts = (parseInt(job.attempts, 10) || 0) + 1
  const maxAttempts = parseInt(job.max_attempts, 10) || JOB_MAX_ATTEMPTS
  const msg = String(err?.message || err || 'erro desconhecido').slice(0, 1000)
  const final = attempts >= maxAttempts
  const delaySec = Math.min(300, Math.max(5, attempts * attempts * 5))
  await pool.query(
    `
    UPDATE vendas.job_queue
    SET status = $2,
        attempts = $3,
        last_error = $4,
        locked_at = NULL,
        locked_until = NULL,
        available_at = CASE WHEN $2 = 'pending' THEN NOW() + ($5::int * INTERVAL '1 second') ELSE available_at END,
        atualizado_em = NOW()
    WHERE id = $1
    `,
    [job.id, final ? 'failed' : 'pending', attempts, msg, delaySec]
  )
}

async function processarJob(job) {
  if (!job) return
  if (job.tipo === 'followup_auto') {
    await processarFollowupAutoJob(job)
    return
  }
  if (job.tipo !== 'webhook_resposta') return
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {}
  const numero = payload.numero
  if (!numero) throw new Error('Job webhook_resposta sem numero')
  await processarRespostaWebhookDebounced(numero)
}

let jobWorkerRodando = false
let jobWorkerTimer = null

async function jobWorkerTick() {
  if (jobWorkerRodando) return
  jobWorkerRodando = true
  try {
    const job = await reivindicarProximoJob()
    if (!job) return
    try {
      await processarJob(job)
      await concluirJob(job.id)
    } catch (err) {
      console.error('Erro no job worker:', err.response?.data || err.message)
      await falharOuReagendarJob(job, err)
    }
  } catch (err) {
    console.error('Erro ao buscar job:', err.message)
  } finally {
    jobWorkerRodando = false
  }
}

function iniciarJobWorker() {
  if (jobWorkerTimer) return
  jobWorkerTimer = setInterval(() => {
    jobWorkerTick().catch((e) => console.error('Erro no tick do worker:', e.message))
  }, JOB_WORKER_POLL_MS)
  jobWorkerTick().catch((e) => console.error('Erro no primeiro tick do worker:', e.message))
}

/** Valida mensagens_bolhas do JSON; retorna null se inválido. */
function normalizarMensagensBolhasArray(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (!t) continue
    out.push(t.length > MAX_CARACTERES_POR_BOLHA ? t.slice(0, MAX_CARACTERES_POR_BOLHA) : t)
    if (out.length >= MAX_MENSAGENS_BOLHAS) break
  }
  return out.length ? out : null
}

/** Sem mensagens_bolhas: divide por parágrafos (\n\n) para vários sendText, no máximo 4 partes. */
function dividirTextoPorQuebrasHeuristico(texto) {
  const t = (texto || '').trim()
  if (!t) return []
  const raw = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  if (raw.length <= 1) return [t]
  return raw.slice(0, MAX_MENSAGENS_BOLHAS)
}

async function enviarSequenciaMensagens(numero, partes) {
  for (let i = 0; i < partes.length; i++) {
    await enviarMensagem(numero, partes[i])
    if (i < partes.length - 1) await sleep(BOLHAS_ENVIO_DELAY_MS)
  }
}

// Camadas futuras (plano "turbinar agente"): RAG com pgvector e tool use / busca controlada — não implementados no backend atual.

// ─── BANCO: INIT ──────────────────────────────────────────────────────────────

async function initDB() {
  const sqlPath = path.join(__dirname, 'sql', 'init.sql')
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8')
    await pool.query(sql)
    console.log('✅ Banco inicializado via sql/init.sql')
  } else {
    // fallback inline mínimo
    await pool.query(`CREATE SCHEMA IF NOT EXISTS vendas`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.conversas (
        id SERIAL PRIMARY KEY, numero TEXT UNIQUE NOT NULL,
        historico JSONB NOT NULL DEFAULT '[]',
        estagio TEXT NOT NULL DEFAULT 'primeiro_contato',
        status TEXT NOT NULL DEFAULT 'ativo',
        agente_pausado BOOLEAN NOT NULL DEFAULT false,
        venda_fechada BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT NOW(), atualizado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.lead_profiles (
        id SERIAL PRIMARY KEY, numero TEXT UNIQUE REFERENCES vendas.conversas(numero),
        negocio TEXT, cidade TEXT, ticket_cliente_final TEXT,
        ja_aparece_google BOOLEAN, concorrentes TEXT[], termometro_dor INT,
        complexidade TEXT, score_dor INT, preco_calculado NUMERIC,
        entrada NUMERIC, parcela NUMERIC, plano_sugerido TEXT,
        pronto_handoff BOOLEAN DEFAULT false,
        temperatura_lead TEXT,
        atualizado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.aprendizado (
        id SERIAL PRIMARY KEY, resumo TEXT NOT NULL, criado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.conhecimento_lacunas (
        id SERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        tema_lacuna TEXT NOT NULL,
        detalhe_lacuna TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW(),
        resolucao_nota TEXT,
        resolvido_em TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.analises_pos_conversa (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
        etapa TEXT NOT NULL DEFAULT 'primeiro_contato',
        status_conversa TEXT,
        resumo_problema TEXT,
        o_que_faltou_para_vender TEXT[] NOT NULL DEFAULT '{}',
        melhorias_para_ia TEXT[] NOT NULL DEFAULT '{}',
        sinais_melhoria_ia TEXT[] NOT NULL DEFAULT '{}',
        acoes_de_preparo TEXT[] NOT NULL DEFAULT '{}',
        confianca_analise TEXT,
        payload_coach JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_criado_em ON vendas.conhecimento_lacunas (criado_em DESC)`
    )
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_tema ON vendas.conhecimento_lacunas (tema_lacuna)`
    )
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_abertas ON vendas.conhecimento_lacunas (criado_em DESC) WHERE resolvido_em IS NULL`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_criado_em
      ON vendas.analises_pos_conversa (numero, criado_em DESC)
    `)
    await pool.query(
      `ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'primeiro_contato'`
    )
    await pool.query(`ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS status_conversa TEXT`)
    await pool.query(
      `ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS sinais_melhoria_ia TEXT[] NOT NULL DEFAULT '{}'`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_etapa_criado_em
      ON vendas.analises_pos_conversa (numero, etapa, criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_etapa_criado_em
      ON vendas.analises_pos_conversa (etapa, criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_criado_em
      ON vendas.analises_pos_conversa (criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_sinais_ia_gin
      ON vendas.analises_pos_conversa USING GIN (sinais_melhoria_ia)
    `)
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS agente_pausado BOOLEAN NOT NULL DEFAULT false`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_codigo TEXT`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_msg TEXT`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_em TIMESTAMP`
    )
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS temperatura_lead TEXT`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS precificacao_json JSONB`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS apelido TEXT`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado BOOLEAN NOT NULL DEFAULT false`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS motivo_arquivamento TEXT`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.lead_contextos (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'contexto_manual',
        conteudo TEXT NOT NULL,
        origem TEXT NOT NULL DEFAULT 'operador',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_contextos_numero_criado
      ON vendas.lead_contextos (numero, criado_em DESC)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.audio_processamentos (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        message_key TEXT UNIQUE,
        web_message_info JSONB,
        mimetype TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        erro TEXT,
        transcricao TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processado_em TIMESTAMPTZ,
        CONSTRAINT audio_processamentos_status_chk CHECK (status IN ('pending', 'processed', 'failed'))
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_processamentos_numero_status
      ON vendas.audio_processamentos (numero, status, criado_em DESC)
    `)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_profiles_temperatura_lead_chk') THEN
          ALTER TABLE vendas.lead_profiles ADD CONSTRAINT lead_profiles_temperatura_lead_chk
            CHECK (temperatura_lead IS NULL OR temperatura_lead IN ('quente', 'morno', 'frio'));
        END IF;
      END $$
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.followup_envios (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        modo TEXT NOT NULL,
        instrucao_snippet TEXT,
        mensagem_preview TEXT,
        envio_ok BOOLEAN NOT NULL DEFAULT true,
        erro TEXT,
        resposta_lead_em TIMESTAMPTZ,
        CONSTRAINT followup_envios_modo_chk CHECK (modo IN ('reengajamento', 'fluxo_funil'))
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_criado ON vendas.followup_envios (numero, criado_em DESC)`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_aberto
      ON vendas.followup_envios (numero)
      WHERE resposta_lead_em IS NULL AND envio_ok = true
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.webhook_messages_processed (
        message_key TEXT PRIMARY KEY,
        numero TEXT NOT NULL,
        processado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_msg_proc_em ON vendas.webhook_messages_processed (processado_em DESC)`
    )
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS resumo_memoria_vendas TEXT`)
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS memoria_vendas_versao INT NOT NULL DEFAULT 0`
    )
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS ia_total_projeto_detectado_ultima_resposta NUMERIC`
    )
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS preco_ia_divergente_motor BOOLEAN NOT NULL DEFAULT false`
    )
    // Rastreio de quais campos diagnósticos já foram coletados (e quando).
    // Formato: { "negocio": "2026-04-24T10:30:00Z", "cidade": "2026-04-24T10:31:00Z", ... }
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS campos_coletados JSONB NOT NULL DEFAULT '{}'::jsonb`
    )
    console.log('✅ Banco inicializado (inline)')
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.eventos_comerciais (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      tipo TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'sistema',
      detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT eventos_comerciais_tipo_chk CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview')),
      CONSTRAINT eventos_comerciais_origem_chk CHECK (origem IN ('sistema', 'operador'))
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_numero_criado ON vendas.eventos_comerciais (numero, criado_em DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_tipo_criado ON vendas.eventos_comerciais (tipo, criado_em DESC)`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.lead_contextos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'contexto_manual',
      conteudo TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'operador',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_contextos_numero_criado
    ON vendas.lead_contextos (numero, criado_em DESC)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.audio_processamentos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      message_key TEXT UNIQUE,
      web_message_info JSONB,
      mimetype TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      erro TEXT,
      transcricao TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processado_em TIMESTAMPTZ,
      CONSTRAINT audio_processamentos_status_chk CHECK (status IN ('pending', 'processed', 'failed'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audio_processamentos_numero_status
    ON vendas.audio_processamentos (numero, status, criado_em DESC)
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'eventos_comerciais_tipo_chk'
      ) THEN
        ALTER TABLE vendas.eventos_comerciais DROP CONSTRAINT eventos_comerciais_tipo_chk;
      END IF;
      ALTER TABLE vendas.eventos_comerciais ADD CONSTRAINT eventos_comerciais_tipo_chk
        CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview'));
    END $$
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.job_queue (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      dedupe_key TEXT UNIQUE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT ${JOB_MAX_ATTEMPTS},
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      locked_until TIMESTAMPTZ,
      last_error TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT job_queue_status_chk CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      CONSTRAINT job_queue_tipo_chk CHECK (tipo IN ('webhook_resposta', 'followup_auto'))
    )
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint co
        JOIN pg_class cl ON cl.oid = co.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        WHERE co.conname = 'job_queue_tipo_chk'
          AND ns.nspname = 'vendas'
          AND cl.relname = 'job_queue'
      ) THEN
        ALTER TABLE vendas.job_queue DROP CONSTRAINT job_queue_tipo_chk;
      END IF;
      ALTER TABLE vendas.job_queue ADD CONSTRAINT job_queue_tipo_chk
        CHECK (tipo IN ('webhook_resposta', 'followup_auto'));
    END $$
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_job_queue_pending ON vendas.job_queue (available_at, id) WHERE status = 'pending'`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.followup_auto_agendamentos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
      sequencia INT NOT NULL DEFAULT 1,
      detectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      silencio_min INT NOT NULL,
      agendado_para TIMESTAMPTZ NOT NULL,
      instrucao_ia TEXT,
      motivo_decisao TEXT,
      timing_origem TEXT NOT NULL DEFAULT 'regra',
      job_id BIGINT,
      status TEXT NOT NULL DEFAULT 'agendado',
      executado_em TIMESTAMPTZ,
      cancelado_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT followup_auto_status_chk CHECK (status IN ('agendado', 'executado', 'cancelado', 'falhou')),
      CONSTRAINT followup_auto_timing_origem_chk CHECK (timing_origem IN ('regra', 'claude_override'))
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_followup_auto_numero_status ON vendas.followup_auto_agendamentos (numero, status, agendado_para)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_followup_auto_agendado ON vendas.followup_auto_agendamentos (agendado_para) WHERE status = 'agendado'`
  )
}

// ─── MOTOR DE PREÇO (código puro, não no prompt) ───────────────────────────────

/** Faixas de preço por plano (min–max em R$). */
const PLANOS_RANGES = {
  iniciante: { min: 200,  max: 600  },
  padrao:    { min: 600,  max: 1000 },
  premium:   { min: 1000, max: 2000 },
}

/** Peso de ROI por ticket do cliente (0 = ROI mínimo, 1 = ROI máximo). */
const TICKET_ROI_PESO = { baixo: 0.0, medio: 0.33, alto: 0.66, premium: 1.0 }

/** Fallback de plano quando plano_sugerido não estiver definido no perfil. */
const COMPLEXIDADE_PARA_PLANO = { landing: 'iniciante', servicos: 'padrao', sistema: 'premium' }

function parcelamento40_60(t) {
  const t0 = Math.round(Number(t) || 0)
  return {
    entrada: Math.round(t0 * 0.4),
    parcela: Math.round((t0 * 0.6) / 3),
  }
}

/** ROI score 0–1: média de fator_ticket e fator_dor. */
function calcularRoiScore(ticket, score_dor) {
  const ticketFator = TICKET_ROI_PESO[ticket] ?? 0.5
  const dorFator = Math.min(1, Math.max(0, (Number(score_dor) || 5) / 10))
  return Math.round((ticketFator + dorFator) / 2 * 100) / 100
}

/** Preço dentro da faixa do plano com base no ROI score. */
function precoDentroDoPlano(plano, roiScore) {
  const range = PLANOS_RANGES[plano] ?? PLANOS_RANGES.padrao
  return Math.round(range.min + roiScore * (range.max - range.min))
}

/** Motor de preço: faixas fixas por plano, valor personalizado por ROI (ticket + score_dor). */
function calcularPreco(perfil) {
  if (!perfil || typeof perfil !== 'object') {
    throw new Error('calcularPreco: perfil ausente ou invalido')
  }

  const plano = PLANOS_RANGES[perfil.plano_sugerido]
    ? perfil.plano_sugerido
    : (COMPLEXIDADE_PARA_PLANO[perfil.complexidade] ?? 'padrao')

  const ticket = perfil.ticket_cliente_final || 'medio'
  const roiScore = calcularRoiScore(ticket, perfil.score_dor)

  const valorPersonalizado = precoDentroDoPlano(plano, roiScore)
  const iniciante_valor    = precoDentroDoPlano('iniciante', roiScore)
  const padrao_valor       = precoDentroDoPlano('padrao',    roiScore)
  const premium_valor      = precoDentroDoPlano('premium',   roiScore)

  if (!Number.isFinite(valorPersonalizado) || valorPersonalizado <= 0) {
    throw new Error(`calcularPreco: valorPersonalizado invalido (${valorPersonalizado})`)
  }

  const range = PLANOS_RANGES[plano]
  const precificacao_json = {
    plano_recomendado: plano,
    roi_score: roiScore,
    valor_personalizado: valorPersonalizado,
    range_min: range.min,
    range_max: range.max,
    iniciante_valor,
    padrao_valor,
    premium_valor,
    parcelamento_recomendado: parcelamento40_60(valorPersonalizado),
    upgrade_iniciante_para_padrao: Math.round(padrao_valor - iniciante_valor * 0.7),
    upgrade_padrao_para_premium:   Math.round(premium_valor - padrao_valor * 0.7),
  }

  for (const [k, v] of Object.entries(precificacao_json)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new Error(`calcularPreco: campo ${k} nao finito (${v})`)
    }
  }

  const ref = parcelamento40_60(valorPersonalizado)
  if (!Number.isFinite(ref?.entrada) || !Number.isFinite(ref?.parcela)) {
    throw new Error(`calcularPreco: parcelamento invalido (entrada=${ref?.entrada}, parcela=${ref?.parcela})`)
  }

  return {
    total: valorPersonalizado,
    entrada: ref.entrada,
    parcela: ref.parcela,
    precificacao_json,
  }
}

/** Smoke: `node index.js --smoke-precificacao` (sem servidor nem DB). */
function runSmokePrecificacao() {
  const errs = []

  // Caso 1: plano_sugerido=padrao, ticket=alto, score_dor=8 → roi=0.73, padrao_valor=892
  const p1 = { plano_sugerido: 'padrao', ticket_cliente_final: 'alto', score_dor: 8, complexidade: 'servicos', negocio: 'teste', cidade: 'teste' }
  const r1 = calcularPreco(p1)
  const pj1 = r1.precificacao_json
  if (pj1.plano_recomendado !== 'padrao') errs.push('caso1: plano_recomendado')
  if (pj1.roi_score !== 0.73) errs.push(`caso1: roi_score esperado 0.73, got ${pj1.roi_score}`)
  const esperado1 = Math.round(600 + 0.73 * 400)
  if (pj1.valor_personalizado !== esperado1) errs.push(`caso1: valor_personalizado esperado ${esperado1}, got ${pj1.valor_personalizado}`)
  if (r1.total !== pj1.valor_personalizado) errs.push('caso1: total !== valor_personalizado')

  // Caso 2: fallback por complexidade (sem plano_sugerido) landing → iniciante
  const p2 = { complexidade: 'landing', ticket_cliente_final: 'baixo', score_dor: 3, negocio: 'teste', cidade: 'teste' }
  const r2 = calcularPreco(p2)
  if (r2.precificacao_json.plano_recomendado !== 'iniciante') errs.push('caso2: fallback complexidade')
  if (r2.total < 200 || r2.total > 600) errs.push(`caso2: total fora da faixa Iniciante (${r2.total})`)

  // Caso 3: premium
  const p3 = { plano_sugerido: 'premium', ticket_cliente_final: 'premium', score_dor: 10, complexidade: 'sistema', negocio: 'teste', cidade: 'teste' }
  const r3 = calcularPreco(p3)
  if (r3.total < 1000 || r3.total > 2000) errs.push(`caso3: total fora da faixa Premium (${r3.total})`)

  // Verifica presença dos três planos em precificacao_json
  for (const c of [pj1]) {
    if (!Number.isFinite(c.iniciante_valor)) errs.push('iniciante_valor ausente')
    if (!Number.isFinite(c.padrao_valor))    errs.push('padrao_valor ausente')
    if (!Number.isFinite(c.premium_valor))   errs.push('premium_valor ausente')
    if (!Number.isFinite(c.parcelamento_recomendado?.entrada)) errs.push('parcelamento ausente')
  }

  if (errs.length) {
    console.error('❌ smoke precificacao:', errs.join('; '))
    process.exit(1)
  }
  console.log('✅ smoke precificacao ok — plano=%s roi=%s valor=R$%d', pj1.plano_recomendado, pj1.roi_score, r1.total)
}

const MOTIVOS_HANDOFF = [
  'lead_pediu_humano',
  'mencionou_pagamento',
  'objecao_repetida_2x',
  'fora_do_icp',
  'ja_tem_site',
  'termometro_baixo_persistente',
  'conversa_longa_sem_avanco',
  'mencao_juridica',
  'aceitou_proposta',
  'roi_baixo_complexidade_alta',
  'pediu_funcionalidade_fora_catalogo',
  'pediu_desconto_fora_padrao',
  'coleta_incompleta',
  'aprovacao_valor',
]

function normalizarMotivoHandoff(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (MOTIVOS_HANDOFF.includes(s)) return s
  console.warn('⚠️ motivo_handoff fora do enum, usando lead_pediu_humano:', raw)
  return 'lead_pediu_humano'
}

function campoTextoPreenchido(s) {
  return typeof s === 'string' && s.trim().length > 0
}

/** Campos mínimos antes de calcular preço. Aceita plano_sugerido ou complexidade para determinar o plano. */
function diagnosticoCompletoParaPreco(perfil) {
  const temPlano =
    Object.keys(PLANOS_RANGES).includes(perfil.plano_sugerido) ||
    ['landing', 'servicos', 'sistema'].includes(perfil.complexidade)
  return (
    campoTextoPreenchido(perfil.negocio) &&
    campoTextoPreenchido(perfil.cidade) &&
    temPlano &&
    ['baixo', 'medio', 'alto', 'premium'].includes(perfil.ticket_cliente_final) &&
    perfil.score_dor != null &&
    Number.isFinite(Number(perfil.score_dor))
  )
}

// ─── BANCO: CRUD ──────────────────────────────────────────────────────────────

async function buscarConversa(numero) {
  const { rows } = await pool.query('SELECT * FROM vendas.conversas WHERE numero = $1', [numero])
  return rows[0] || null
}

/**
 * @param {boolean} [agentePausado] — se definido, grava/atualiza `agente_pausado` na mesma operação.
 */
async function salvarConversa(numero, historico, estagio, status = 'ativo', agentePausado = undefined) {
  const arr = Array.isArray(historico) ? historico : []
  let jsonText
  try {
    jsonText = JSON.stringify(arr)
  } catch (e) {
    throw new Error(`historico não serializável: ${e.message}`)
  }
  if (agentePausado === undefined) {
    await pool.query(
      `
      INSERT INTO vendas.conversas (numero, historico, estagio, status)
      VALUES ($1, $2::jsonb, $3, $4)
      ON CONFLICT (numero) DO UPDATE
      SET historico = $2::jsonb, estagio = $3, status = $4, atualizado_em = NOW()
      `,
      [numero, jsonText, estagio, status]
    )
  } else {
    await pool.query(
      `
      INSERT INTO vendas.conversas (numero, historico, estagio, status, agente_pausado)
      VALUES ($1, $2::jsonb, $3, $4, $5)
      ON CONFLICT (numero) DO UPDATE
      SET historico = $2::jsonb, estagio = $3, status = $4, agente_pausado = $5, atualizado_em = NOW()
      `,
      [numero, jsonText, estagio, status, agentePausado]
    )
  }
}

function resumirTextoOperacional(raw, maxLen = 240) {
  const texto = String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
  if (!texto) return ''
  return texto.length > maxLen ? `${texto.slice(0, maxLen - 1)}…` : texto
}

function classificarErroRespostaWebhook(err) {
  const detalheResposta =
    err?.response?.data == null
      ? ''
      : typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data)
  const detalhe = resumirTextoOperacional(detalheResposta || err?.message || err, 500)
  const msg = resumirTextoOperacional(err?.message || '', 240)
  const url = String(err?.config?.url || '')
  const status = Number.isFinite(Number(err?.response?.status)) ? Number(err.response.status) : null

  if (err?.code === 'ECONNABORTED' && /anthropic\.com\/v1\/messages/i.test(url)) {
    return {
      codigo: 'modelo_timeout',
      resumo: 'timeout ao consultar o modelo',
      detalhe: detalhe || msg || 'A chamada ao modelo excedeu o tempo limite.',
    }
  }
  if (/ANTHROPIC_KEY/i.test(msg)) {
    return {
      codigo: 'configuracao_modelo',
      resumo: 'configuração do modelo ausente',
      detalhe: detalhe || msg || 'ANTHROPIC_KEY não configurada.',
    }
  }
  if (/Histórico vazio|última mensagem precisa ser do usuário|Última mensagem do histórico deve ser do usuário/i.test(msg)) {
    return {
      codigo: 'historico_invalido',
      resumo: 'histórico inválido para responder',
      detalhe: detalhe || msg || 'O histórico não estava em um estado válido para gerar resposta.',
    }
  }
  if (/mensagem utilizável|mensagem vazia|JSON válido com mensagem/i.test(msg)) {
    return {
      codigo: 'modelo_parse',
      resumo: 'modelo retornou conteúdo sem mensagem utilizável',
      detalhe: detalhe || msg || 'A resposta do modelo não pôde ser convertida em mensagem segura para o lead.',
    }
  }
  if (/anthropic\.com\/v1\/messages/i.test(url)) {
    return {
      codigo: status === 429 ? 'modelo_limite' : 'modelo_api',
      resumo: status === 429 ? 'limite temporário do modelo' : 'falha HTTP ao consultar o modelo',
      detalhe: detalhe || msg || (status ? `HTTP ${status} ao consultar o modelo.` : 'Falha ao consultar o modelo.'),
    }
  }
  if (/\/message\/send(Text|Buttons)\//i.test(url) || /Texto vazio para envio ao WhatsApp|Número\/JID inválido para envio/i.test(msg)) {
    return {
      codigo: 'envio_whatsapp',
      resumo: 'falha ao enviar pelo WhatsApp',
      detalhe: detalhe || msg || 'Não foi possível entregar a resposta ao WhatsApp.',
    }
  }
  return {
    codigo: 'resposta_falhou',
    resumo: 'falha ao gerar ou enviar resposta',
    detalhe: detalhe || msg || 'Erro inesperado no fluxo de resposta.',
  }
}

function mensagemFalhaRespostaParaPersistencia(falha) {
  const resumo = resumirTextoOperacional(falha?.resumo || '', 140)
  const detalhe = resumirTextoOperacional(falha?.detalhe || '', 500)
  if (!resumo) return detalhe
  if (!detalhe || detalhe === resumo) return resumo
  return `${resumo}. ${detalhe}`
}

async function registrarFalhaResposta(numero, falha) {
  await pool.query(
    `
    UPDATE vendas.conversas
    SET ultima_falha_resposta_codigo = $2,
        ultima_falha_resposta_msg = $3,
        ultima_falha_resposta_em = NOW()
    WHERE numero = $1
    `,
    [numero, falha.codigo, mensagemFalhaRespostaParaPersistencia(falha)]
  )
}

async function limparFalhaResposta(numero) {
  await pool.query(
    `
    UPDATE vendas.conversas
    SET ultima_falha_resposta_codigo = NULL,
        ultima_falha_resposta_msg = NULL,
        ultima_falha_resposta_em = NULL
    WHERE numero = $1
    `,
    [numero]
  )
}

async function marcarFechada(numero) {
  await pool.query(
    'UPDATE vendas.conversas SET venda_fechada = true, atualizado_em = NOW() WHERE numero = $1',
    [numero]
  )
}

async function buscarPerfil(numero) {
  const { rows } = await pool.query('SELECT * FROM vendas.lead_profiles WHERE numero = $1', [numero])
  return rows[0] || {}
}

function normalizarTipoLeadContexto(tipo) {
  const t = String(tipo || '').trim().toLowerCase()
  if (['audio_reprocessado', 'audio_upload', 'ligacao', 'contexto_manual'].includes(t)) return t
  return 'contexto_manual'
}

function limparConteudoLeadContexto(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, LEAD_CONTEXTO_MAX_CHARS)
}

async function salvarLeadContexto(numero, opts = {}) {
  const conteudo = limparConteudoLeadContexto(opts.conteudo)
  if (!conteudo) throw new Error('Contexto vazio')
  const tipo = normalizarTipoLeadContexto(opts.tipo)
  const origem = String(opts.origem || 'operador').trim().slice(0, 80) || 'operador'
  const metadata = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}
  const { rows } = await pool.query(
    `INSERT INTO vendas.lead_contextos (numero, tipo, conteudo, origem, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, numero, tipo, conteudo, origem, metadata, criado_em`,
    [numero, tipo, conteudo, origem, JSON.stringify(metadata)]
  )
  await pool.query('UPDATE vendas.conversas SET atualizado_em = NOW() WHERE numero = $1', [numero])
  return rows[0]
}

async function buscarLeadContextos(numero, limit = LEAD_CONTEXTO_PROMPT_LIMIT) {
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || LEAD_CONTEXTO_PROMPT_LIMIT))
  const { rows } = await pool.query(
    `SELECT id, numero, tipo, conteudo, origem, metadata, criado_em
     FROM vendas.lead_contextos
     WHERE numero = $1
     ORDER BY criado_em DESC
     LIMIT $2`,
    [numero, lim]
  )
  return rows
}

function montarBlocoContextoInterno(contextos) {
  const rows = Array.isArray(contextos) ? contextos.filter((c) => c && c.conteudo) : []
  if (!rows.length) return ''
  const linhas = rows
    .slice()
    .reverse()
    .map((c, idx) => {
      const tipo = normalizarTipoLeadContexto(c.tipo)
      const origem = c.origem || 'operador'
      const quando = c.criado_em ? new Date(c.criado_em).toISOString() : 'data indisponivel'
      const conteudo = limparConteudoLeadContexto(c.conteudo)
      return `${idx + 1}. [${tipo} | ${origem} | ${quando}]\n${conteudo}`
    })
  return `\n\n--- CONTEXTO INTERNO DO OPERADOR ---\nUse estas notas como contexto operacional real da conversa, sem dizer ao lead que existe uma nota interna. Nao trate como fala literal do lead; use para evitar repetir perguntas e ajustar a resposta.\n${linhas.join('\n\n')}\n`
}

/** Coluna concorrentes é TEXT[]; o modelo costuma mandar string com vírgulas — Postgres rejeita como array literal. */
function normalizarConcorrentes(val) {
  if (val == null || val === '') return undefined
  if (Array.isArray(val)) {
    const arr = val
      .map((item) => {
        if (item == null) return ''
        if (typeof item === 'object') return JSON.stringify(item)
        return String(item).trim()
      })
      .filter(Boolean)
    return arr.length ? arr : undefined
  }
  if (typeof val === 'string') {
    const partes = val.split(',').map((s) => s.trim()).filter(Boolean)
    return partes.length ? partes : undefined
  }
  const u = String(val).trim()
  return u ? [u] : undefined
}

function normalizarTemperaturaLead(val) {
  if (val == null || val === '') return undefined
  const s = String(val).trim().toLowerCase()
  if (s === 'quente' || s === 'morno' || s === 'frio') return s
  return undefined
}

/** Remove chaves desconhecidas do JSON do modelo antes de persistir em `lead_profiles`. */
function filtrarCamposLeadProfile(dados) {
  if (!dados || typeof dados !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(dados)) {
    if (!LEAD_PROFILE_CAMPOS_PERMITIDOS.has(k)) continue
    if (k === 'precificacao_json') {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) out[k] = v
      continue
    }
    if (k === 'temperatura_lead') {
      const t = normalizarTemperaturaLead(v)
      if (t !== undefined) out[k] = t
      continue
    }
    out[k] = v
  }
  return out
}

async function atualizarPerfil(numero, dados) {
  const d = filtrarCamposLeadProfile(dados)
  if (Object.prototype.hasOwnProperty.call(d, 'concorrentes')) {
    const norm = normalizarConcorrentes(d.concorrentes)
    if (norm === undefined) delete d.concorrentes
    else d.concorrentes = norm
  }

  const campos = Object.keys(d)
  if (!campos.length) return {}

  // Monta patch de campos_coletados: registra timestamp ISO da PRIMEIRA coleta
  // de cada campo diagnóstico com valor não-nulo (nunca sobrescreve entrada já existente).
  const agora = new Date().toISOString()
  const patchColetados = {}
  for (const k of campos) {
    if (!LEAD_CAMPOS_DIAGNOSTICO.has(k)) continue
    const v = d[k]
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    patchColetados[k] = agora
  }

  const sets = campos.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const valores = campos.map((k) => d[k])

  await pool.query(
    `
    INSERT INTO vendas.lead_profiles (numero, ${campos.join(', ')})
    VALUES ($1, ${campos.map((_, i) => `$${i + 2}`).join(', ')})
    ON CONFLICT (numero) DO UPDATE SET ${sets}, atualizado_em = NOW()
    `,
    [numero, ...valores]
  )

  // Atualiza campos_coletados: usa jsonb_strip_nulls + coalesce para só gravar novos
  if (Object.keys(patchColetados).length > 0) {
    await pool.query(
      `
      UPDATE vendas.lead_profiles
      SET campos_coletados = (
        SELECT jsonb_object_agg(k, v)
        FROM (
          SELECT key AS k, value AS v FROM jsonb_each(COALESCE(campos_coletados, '{}'::jsonb))
          UNION ALL
          SELECT key AS k, value AS v FROM jsonb_each($2::jsonb)
          WHERE key NOT IN (
            SELECT key FROM jsonb_each(COALESCE(campos_coletados, '{}'::jsonb))
          )
        ) t
      )
      WHERE numero = $1
      `,
      [numero, JSON.stringify(patchColetados)]
    )
  }

  return d
}

// ─── Google Custom Search — enriquecimento de concorrentes reais ──────────────
//
// Substitui alucinação de concorrentes ("Joaquim Vidros", "Vidraçaria Central")
// por nomes reais de quem aparece no Google pra "[segmento] [cidade]".
// Cache no próprio lead_profiles.concorrentes (por conversa) — 1 chamada por lead.
// Sem GOOGLE_CSE_KEY/GOOGLE_CSE_ID configurados, a função é no-op e devolve [].

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'

/**
 * Busca top 3 resultados orgânicos para "[segmento] [cidade]" no Google CSE.
 * Retorna array de { titulo, url, snippet } ou [] se indisponível/erro.
 * Nunca lança: falha silenciosa pra não quebrar o webhook.
 */
async function buscarConcorrentesReais(segmento, cidade) {
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_ID
  if (!key || !cx) return []
  const seg = String(segmento || '').trim()
  const cid = String(cidade || '').trim()
  if (!seg || !cid) return []
  const query = `${seg} ${cid}`
  try {
    const r = await axios.get(GOOGLE_CSE_ENDPOINT, {
      params: { key, cx, q: query, num: 5, gl: 'br', hl: 'pt-BR', safe: 'active' },
      timeout: 7000,
    })
    const items = Array.isArray(r.data?.items) ? r.data.items : []
    const out = []
    for (const it of items) {
      if (out.length >= 3) break
      const titulo = (it?.title || '').trim()
      const url = (it?.link || '').trim()
      // Descarta diretórios genéricos que não são concorrentes diretos (apollo, instagram, facebook, linkedin, google maps, yellow pages)
      const urlLc = url.toLowerCase()
      if (/instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|wikipedia\.org|maps\.google|apollo\.io|guiamais\.com|solucoesindustriais|telelistas/i.test(urlLc)) continue
      if (!titulo || !url) continue
      out.push({ titulo, url, snippet: (it?.snippet || '').trim().slice(0, 160) })
    }
    console.log(`🔎 CSE "${query}": ${out.length} concorrentes (${items.length} crus)`)
    return out
  } catch (e) {
    const status = e?.response?.status
    console.warn(`⚠️ Google CSE falhou para "${query}" (status=${status}): ${e.message}`)
    return []
  }
}

/**
 * Garante que o perfil tem concorrentes reais buscados. Se não tiver e houver
 * segmento+cidade, busca uma vez e persiste em lead_profiles.concorrentes.
 * Retorna o array final de concorrentes (podendo ser vazio).
 */
async function garantirConcorrentesReaisNoPerfil(numero, perfil) {
  try {
    if (!perfil) return []
    // Se já há concorrentes persistidos, respeita (1 chamada por lead).
    if (Array.isArray(perfil.concorrentes) && perfil.concorrentes.length > 0) {
      return perfil.concorrentes
    }
    const seg = perfil.negocio
    const cid = perfil.cidade
    if (!seg || !cid) return []
    const resultados = await buscarConcorrentesReais(seg, cid)
    if (!resultados.length) return []
    // Persiste como array de strings no formato "Titulo — URL" pra caber em TEXT[]
    const comoTexto = resultados.map((r) => `${r.titulo} — ${r.url}`)
    await atualizarPerfil(numero, { concorrentes: comoTexto })
    return comoTexto
  } catch (e) {
    console.warn(`⚠️ garantirConcorrentesReaisNoPerfil(${numero}): ${e.message}`)
    return []
  }
}

/**
 * @param {string} numero JID
 * @param {{ modo: string, instrucao_snippet: string|null, mensagem_preview: string|null, envio_ok: boolean, erro?: string|null }} opts
 */
async function registrarFollowupEnvio(numero, opts) {
  const modo = opts.modo === 'fluxo_funil' ? 'fluxo_funil' : 'reengajamento'
  const ins =
    opts.instrucao_snippet != null && String(opts.instrucao_snippet).trim()
      ? String(opts.instrucao_snippet).trim().slice(0, FOLLOWUP_SNIPPET_MAX_CHARS)
      : null
  const prev =
    opts.mensagem_preview != null && String(opts.mensagem_preview).trim()
      ? String(opts.mensagem_preview).trim().slice(0, FOLLOWUP_SNIPPET_MAX_CHARS)
      : null
  const ok = !!opts.envio_ok
  const erro =
    opts.erro != null && String(opts.erro).trim()
      ? String(opts.erro).trim().slice(0, FOLLOWUP_ERRO_LOG_MAX_CHARS)
      : null
  try {
    await pool.query(
      `
      INSERT INTO vendas.followup_envios
        (numero, modo, instrucao_snippet, mensagem_preview, envio_ok, erro)
      VALUES ($1::text, $2::text, $3::text, $4::text, $5::boolean, $6::text)
      `,
      [numero, modo, ins, prev, ok, erro]
    )
  } catch (e) {
    console.error('❌ registrarFollowupEnvio:', e.message)
  }
}

function textoPedePreco(texto) {
  if (!texto || typeof texto !== 'string') return false
  return /\b(quanto|pre[cç]o|valor|investimento|or[cç]amento|orcamento|custa|custo)\b/i.test(texto)
}

async function registrarEventoComercial(numero, tipo, detalhe = {}, origem = 'sistema') {
  const tipos = new Set(['pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview'])
  if (!tipos.has(tipo)) return false
  const org = origem === 'operador' ? 'operador' : 'sistema'
  let json = '{}'
  try {
    json = JSON.stringify(detalhe && typeof detalhe === 'object' ? detalhe : {})
  } catch (_) {}
  try {
    await pool.query(
      `
      INSERT INTO vendas.eventos_comerciais (numero, tipo, origem, detalhe)
      VALUES ($1::text, $2::text, $3::text, $4::jsonb)
      `,
      [numero, tipo, org, json]
    )
    return true
  } catch (e) {
    console.error('Erro ao registrar evento comercial:', e.message)
    return false
  }
}

/** Primeira mensagem inbound do lead após follow-up: marca o envio aberto mais recente (janela de dias). */
async function marcarRespostaFollowupSeAplicavel(numero) {
  try {
    const r = await pool.query(
      `
      UPDATE vendas.followup_envios f
      SET resposta_lead_em = NOW()
      WHERE f.id = (
        SELECT id FROM vendas.followup_envios
        WHERE numero = $1::text
          AND envio_ok = true
          AND resposta_lead_em IS NULL
          AND criado_em > NOW() - ($2::int * INTERVAL '1 day')
        ORDER BY criado_em DESC
        LIMIT 1
      )
      `,
      [numero, FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS]
    )
    if (r.rowCount > 0) {
      await registrarEventoComercial(numero, 'respondeu_followup', {
        janela_dias: FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS,
      })
    }
  } catch (e) {
    console.error('❌ marcarRespostaFollowupSeAplicavel:', e.message)
  }
}

async function buscarUltimoAprendizado() {
  const { rows } = await pool.query('SELECT resumo FROM vendas.aprendizado ORDER BY criado_em DESC LIMIT 1')
  return rows[0]?.resumo || null
}

function normalizarListaCoachAnalise(val) {
  if (!Array.isArray(val)) return []
  return val
    .map((item) => {
      if (item == null) return ''
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'number' || typeof item === 'boolean') return String(item).trim()
      return ''
    })
    .filter(Boolean)
}

function normalizarSinaisCoach(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {}
  const out = {}
  for (const [k, v] of Object.entries(val)) {
    const key = String(k || '').trim()
    if (!key) continue
    out[key] = v === true
  }
  return out
}

function normalizarLeadCoachPayload(payload) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const confianca = base.confianca != null ? String(base.confianca).trim() : ''
  const confiancaAnalise = base.confianca_analise != null ? String(base.confianca_analise).trim() : ''
  const etapa = base.etapa != null ? String(base.etapa).trim() : ''
  const statusConversa = base.status_conversa != null ? String(base.status_conversa).trim() : ''
  return {
    ...base,
    etapa: etapa || null,
    status_conversa: statusConversa || null,
    decisao_recomendada: base.decisao_recomendada != null ? String(base.decisao_recomendada).trim() : '',
    confianca: confianca || null,
    raciocinio: base.raciocinio != null ? String(base.raciocinio).trim() : '',
    proximos_passos: normalizarListaCoachAnalise(base.proximos_passos),
    riscos: normalizarListaCoachAnalise(base.riscos),
    sinais: normalizarSinaisCoach(base.sinais),
    perguntas_em_aberto: normalizarListaCoachAnalise(base.perguntas_em_aberto),
    resumo_problema: base.resumo_problema != null ? String(base.resumo_problema).trim() : '',
    o_que_faltou_para_vender: normalizarListaCoachAnalise(base.o_que_faltou_para_vender),
    melhorias_para_ia: normalizarListaCoachAnalise(base.melhorias_para_ia),
    sinais_melhoria_ia: normalizarListaCoachAnalise(base.sinais_melhoria_ia),
    acoes_de_preparo: normalizarListaCoachAnalise(base.acoes_de_preparo),
    confianca_analise: confiancaAnalise || confianca || null,
    prompt_gamma_apresentacao: base.prompt_gamma_apresentacao != null ? String(base.prompt_gamma_apresentacao).trim() : '',
  }
}

function hidratarAnalisePosConversa(row) {
  if (!row) return null
  const payload = row.payload_coach && typeof row.payload_coach === 'object' ? row.payload_coach : {}
  return {
    ...row,
    etapa: row.etapa != null ? String(row.etapa).trim() : null,
    status_conversa: row.status_conversa != null ? String(row.status_conversa).trim() : null,
    o_que_faltou_para_vender: Array.isArray(row.o_que_faltou_para_vender) ? row.o_que_faltou_para_vender : [],
    melhorias_para_ia: Array.isArray(row.melhorias_para_ia) ? row.melhorias_para_ia : [],
    sinais_melhoria_ia: Array.isArray(row.sinais_melhoria_ia) ? row.sinais_melhoria_ia : [],
    acoes_de_preparo: Array.isArray(row.acoes_de_preparo) ? row.acoes_de_preparo : [],
    payload_coach: payload,
    coach: normalizarLeadCoachPayload(payload),
  }
}

async function salvarAnalisePosConversa(numero, coachPayload, conversa = null) {
  const coach = normalizarLeadCoachPayload(coachPayload)
  const payload =
    coachPayload && typeof coachPayload === 'object' && !Array.isArray(coachPayload) ? coachPayload : {}
  const etapa = coach.etapa || conversa?.estagio || 'primeiro_contato'
  const statusConversa = coach.status_conversa || conversa?.status || null
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.analises_pos_conversa
      (numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender, melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise, payload_coach)
    VALUES ($1::text, $2::text, $3::text, $4::text, $5::text[], $6::text[], $7::text[], $8::text[], $9::text, $10::jsonb)
    RETURNING
      id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
      melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
      payload_coach, criado_em, atualizado_em
    `,
    [
      numero,
      etapa,
      statusConversa,
      coach.resumo_problema || null,
      coach.o_que_faltou_para_vender,
      coach.melhorias_para_ia,
      coach.sinais_melhoria_ia,
      coach.acoes_de_preparo,
      coach.confianca_analise,
      JSON.stringify(payload),
    ]
  )
  return hidratarAnalisePosConversa(rows[0] || null)
}

async function buscarUltimaAnalisePosConversa(numero, etapa = null) {
  const hasEtapa = etapa != null && String(etapa).trim() !== ''
  const { rows } = await pool.query(
    `
    SELECT
      id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
      melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
      payload_coach, criado_em, atualizado_em
    FROM vendas.analises_pos_conversa
    WHERE numero = $1
      ${hasEtapa ? 'AND etapa = $2' : ''}
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    hasEtapa ? [numero, etapa] : [numero]
  )
  return hidratarAnalisePosConversa(rows[0] || null)
}

async function buscarHistoricoAnalisesPosConversa(numero, limit = 6) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 30)
  const { rows } = await pool.query(
    `
    SELECT
      id, numero, etapa, status_conversa, resumo_problema, o_que_faltou_para_vender,
      melhorias_para_ia, sinais_melhoria_ia, acoes_de_preparo, confianca_analise,
      payload_coach, criado_em, atualizado_em
    FROM vendas.analises_pos_conversa
    WHERE numero = $1
    ORDER BY criado_em DESC
    LIMIT $2
    `,
    [numero, safeLimit]
  )
  return rows.map((row) => hidratarAnalisePosConversa(row)).filter(Boolean)
}

async function salvarAprendizado(resumo) {
  await pool.query('INSERT INTO vendas.aprendizado (resumo) VALUES ($1)', [resumo])
}

async function contarVendasFechadas() {
  const { rows } = await pool.query('SELECT COUNT(*) as total FROM vendas.conversas WHERE venda_fechada = true')
  return parseInt(rows[0].total)
}

async function buscarVendasFechadas() {
  const { rows } = await pool.query(
    'SELECT historico FROM vendas.conversas WHERE venda_fechada = true ORDER BY atualizado_em DESC LIMIT 10'
  )
  return rows
}

// ─── HORÁRIO REDIRECIONAMENTO IMEDIATO AO VICTOR (America/Sao_Paulo) ─────────
// Seg–sex 9h–18h; sáb 9h–15h; domingo sem redirecionamento imediato (Telegram / “em instantes”).

/**
 * @returns {{ weekday: number, minutes: number }} weekday 0=dom … 6=sáb; minutes desde meia-noite no fuso BR
 */
function obterHoraLocalBrasil(dataRef = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = dtf.formatToParts(dataRef)
  let weekdayStr = 'Sun'
  let hour = 0
  let minute = 0
  for (const p of parts) {
    if (p.type === 'weekday') weekdayStr = p.value
    if (p.type === 'hour') hour = parseInt(p.value, 10)
    if (p.type === 'minute') minute = parseInt(p.value, 10)
  }
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const weekday = map[weekdayStr] ?? 0
  return { weekday, minutes: hour * 60 + minute }
}

/** Permite aviso imediato ao Victor (Telegram) e prometer que ele entra “já” na conversa. */
function estaNoHorarioRedirecionamentoImediatoVictor(dataRef = new Date()) {
  const { weekday, minutes } = obterHoraLocalBrasil(dataRef)
  if (weekday === 0) return false
  const inicio = 9 * 60
  const fimSemana = 18 * 60
  const fimSabado = 15 * 60
  if (weekday >= 1 && weekday <= 5) {
    return minutes >= inicio && minutes <= fimSemana
  }
  if (weekday === 6) {
    return minutes >= inicio && minutes <= fimSabado
  }
  return false
}

/** Injetado no system prompt para o modelo alinhar tom (instantes vs. fora do expediente). */
function textoContextoHorarioVictorParaPrompt() {
  const agora = new Date()
  const permitido = estaNoHorarioRedirecionamentoImediatoVictor(agora)
  const horaLegivel = agora.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const linhas = [
    `Data/hora de referência (America/Sao_Paulo): ${horaLegivel}`,
    `Redirecionamento imediato ao Victor permitido AGORA (alerta urgente, prometer que ele entra já nesta conversa): ${permitido ? 'SIM' : 'NÃO'}`,
    'Regras: segunda a sexta 9h–18h; sábado 9h–15h; domingo sem redirecionamento imediato.',
  ]
  if (permitido) {
    linhas.push(
      'Com handoff true: pode dizer que o Victor entra em instantes (ou equivalente curto), conforme os blocos do sistema.'
    )
  } else {
    linhas.push(
      'Com handoff true: NÃO prometa que o Victor entra em instantes nem urgência imediata. Diga com naturalidade que ele pode responder quando tiver um tempinho — inclusive fora do expediente — e que será o mais atencioso possível. Registre handoff normalmente (handoff: true).'
    )
  }
  return linhas.join('\n')
}

// ─── ALERTAS AO VICTOR (WhatsApp + Telegram opcional) ─────────────────────────

/** Handoff: WhatsApp sempre que houver número; Telegram só no horário de redirecionamento imediato (reserva). */
async function alertarHandoff(numero, perfil, preco, motivo, resumoHandoff) {
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')

  const temPreco = preco.total > 0
  const linhaPreco = temPreco
    ? `💰 Preço: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
    : ''
  const linhaPlano = perfil.plano_sugerido ? `📋 Plano: ${perfil.plano_sugerido}\n` : ''
  const linhaTemp = perfil.temperatura_lead ? `🌡️ Temperatura: ${perfil.temperatura_lead}\n` : ''
  const linhaComplexidade = perfil.complexidade ? `🔧 Complexidade: ${perfil.complexidade}\n` : ''
  const linhaDor = perfil.score_dor != null ? `😟 Score dor: ${perfil.score_dor}/10\n` : ''
  const linhaResumo = resumoHandoff ? `\n📝 Resumo:\n${resumoHandoff}\n` : ''
  let linhaPrecificacao = ''
  const pj = perfil.precificacao_json
  if (pj && typeof pj === 'object') {
    linhaPrecificacao =
      `\n📊 Precificação — plano: ${pj.plano_recomendado ?? '?'} | ROI: ${pj.roi_score ?? '?'}\n` +
      `Valor personalizado: R$ ${pj.valor_personalizado ?? '?'} (faixa R$${pj.range_min ?? '?'}–R$${pj.range_max ?? '?'})\n` +
      `Iniciante R$ ${pj.iniciante_valor ?? '?'} · Padrão R$ ${pj.padrao_valor ?? '?'} · Premium R$ ${pj.premium_valor ?? '?'}\n` +
      `Upgrades: Inic→Pad R$ ${pj.upgrade_iniciante_para_padrao ?? '?'} · Pad→Prem R$ ${pj.upgrade_padrao_para_premium ?? '?'}\n`
  }

  const textoWa =
    `🔔 HANDOFF — PJ Codeworks\n` +
    `Lead: ${phone}\n` +
    `Nicho: ${perfil.negocio || '?'} | ${perfil.cidade || '?'}\n` +
    `Motivo: ${motivo}\n` +
    linhaPreco +
    linhaPlano +
    linhaTemp +
    linhaComplexidade +
    linhaDor +
    linhaPrecificacao +
    `🌡️ Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10` +
    linhaResumo

  const enviouWa = await notificarVictorWhatsapp(textoWa)
  if (enviouWa) {
    console.log('📲 Handoff notificado ao Victor (WhatsApp):', motivo)
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  if (!estaNoHorarioRedirecionamentoImediatoVictor()) return

  const linhaPrecoTg = temPreco
    ? `Preço: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
    : ''
  const linhaResumoTg = resumoHandoff ? `\n📝 *Resumo:*\n${resumoHandoff}\n` : ''
  let linhaPrecifTg = ''
  const pjt = perfil.precificacao_json
  if (pjt && typeof pjt === 'object') {
    linhaPrecifTg =
      `\n*Plano:* ${pjt.plano_recomendado ?? '?'} | ROI: ${pjt.roi_score ?? '?'} | Valor: R$ ${pjt.valor_personalizado ?? '?'} (faixa R$${pjt.range_min ?? '?'}–R$${pjt.range_max ?? '?'})\n` +
      `Inic/Pad/Prem: R$ ${pjt.iniciante_valor ?? '?'} / R$ ${pjt.padrao_valor ?? '?'} / R$ ${pjt.premium_valor ?? '?'}\n`
  }

  const texto =
    `🔔 *HANDOFF — PJ Codeworks*\n` +
    `Lead: \`${phone}\`\n` +
    `Nicho: ${perfil.negocio || '?'} | ${perfil.cidade || '?'}\n` +
    `Motivo: ${motivo}\n` +
    linhaPrecoTg +
    linhaPrecifTg +
    (perfil.plano_sugerido ? `Plano: ${perfil.plano_sugerido}\n` : '') +
    (perfil.temperatura_lead ? `Temperatura: ${perfil.temperatura_lead}\n` : '') +
    (perfil.complexidade ? `Complexidade: ${perfil.complexidade}\n` : '') +
    `Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10` +
    linhaResumoTg

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text: texto, parse_mode: 'Markdown' }
  ).catch((e) => console.error('❌ Telegram handoff:', e.message))
}

/** Lacuna: WhatsApp direto; Telegram opcional (mesmo texto, sem duplicar lógica longa). */
async function alertarLacunaConhecimento(numero, tema, detalhe) {
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  const temaLinha = String(tema || '?').trim()
  const det = String(detalhe || '').trim()
  const detCorte = det.length > 400 ? `${det.slice(0, 397)}…` : det
  const textoWa =
    `📌 Lacuna de conhecimento — PJ Codeworks\n` +
    `Tema: ${temaLinha}\n` +
    `Lead: ${phone || '?'}\n` +
    detCorte

  const enviouWa = await notificarVictorWhatsapp(textoWa)
  if (enviouWa) {
    console.log('📲 Lacuna notificada ao Victor (WhatsApp):', temaLinha)
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const texto =
    `📌 *Lacuna — PJ Codeworks*\n` +
    `Tema: \`${String(tema || '?').replace(/`/g, "'")}\`\n` +
    `Lead: \`${phone || '?'}\`\n` +
    detCorte

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text: texto, parse_mode: 'Markdown' }
  ).catch((e) => console.error('❌ Telegram lacuna:', e.message))
}

/**
 * Insere lacuna se não houver registro idêntico (mesmo número + tema) nas últimas 24h.
 * @returns {Promise<number|null>} id inserido ou null (duplicata ou sem inserção)
 */
async function registrarLacunaConhecimento(numero, tema, detalhe) {
  const tRaw = String(tema || '').trim().slice(0, MAX_TEMA_LACUNA_CHARS)
  const dRaw = String(detalhe || '').trim().slice(0, MAX_DETALHE_LACUNA_CHARS)
  if (!tRaw && !dRaw) return null
  const temaF = tRaw || 'geral'
  const detalheF = dRaw || tRaw

  const { rows } = await pool.query(
    `
    INSERT INTO vendas.conhecimento_lacunas (numero, tema_lacuna, detalhe_lacuna)
    SELECT $1::text, $2::text, $3::text
    WHERE NOT EXISTS (
      SELECT 1 FROM vendas.conhecimento_lacunas x
      WHERE x.numero = $1::text
        AND x.tema_lacuna = $2::text
        AND x.criado_em > NOW() - INTERVAL '24 hours'
    )
    RETURNING id
    `,
    [numero, temaF, detalheF]
  )
  return rows[0]?.id != null ? rows[0].id : null
}

// ─── APRENDIZADO AUTOMÁTICO ───────────────────────────────────────────────────

async function gerarAprendizado() {
  const total = await contarVendasFechadas()
  if (total < 3 || total % 3 !== 0) return

  const todasVendas = await buscarVendasFechadas()
  const vendas = todasVendas.slice(-5)
  const historicos = vendas
    .map(v => JSON.stringify(v.historico))
    .join('\n\n---\n\n')
    .slice(0, 8000)

  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: 'Analise conversas de vendas fechadas e extraia padrões de sucesso em até 200 palavras.',
      messages: [{ role: 'user', content: `Analise ${vendas.length} vendas fechadas:\n\n${historicos}` }],
    },
    { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  )

  await salvarAprendizado(resp.data.content[0].text)
  console.log('✅ Aprendizado gerado.')
}

// ─── CLAUDE (resposta JSON estruturada) ───────────────────────────────────────

function limparSaidaTextoClaude(texto) {
  if (!texto || typeof texto !== 'string') return ''
  let s = texto.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  s = s.replace(/^json\s*\n/i, '').trim()
  return s
}

function extrairPrimeiroObjetoJsonBalanceado(texto) {
  const s = limparSaidaTextoClaude(texto)
  const start = s.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      continue
    }
    if (c === '"') inString = !inString
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return ''
}

/** Normaliza saída do modelo (prefixo "json", fences ```) e extrai o primeiro objeto JSON balanceado. */
function parsearRespostaJsonClaude(texto) {
  if (!texto || typeof texto !== 'string') return null
  const s = limparSaidaTextoClaude(texto)
  const candidatos = [s]
  const fenceJson = texto.match(/```json\s*([\s\S]*?)```/i)
  if (fenceJson && fenceJson[1]) candidatos.push(fenceJson[1].trim())
  const balanceado = extrairPrimeiroObjetoJsonBalanceado(s)
  if (balanceado) candidatos.push(balanceado)
  for (const cand of candidatos) {
    if (!cand) continue
    try {
      return JSON.parse(cand)
    } catch (_) {}
  }
  return null
}

/**
 * Remove prefixo de citação estilo WhatsApp (bloco inicial de linhas com ">"),
 * que costuma colar a pergunta anterior do assistente na mensagem do lead.
 */
function stripCitacaoWhatsappTexto(s) {
  if (s == null || typeof s !== 'string') return ''
  let t = s.replace(/^\uFEFF|\u200E/g, '')
  const lines = t.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('>')) {
      i++
      continue
    }
    if (trimmed === '' && i + 1 < lines.length && lines[i + 1].trimStart().startsWith('>')) {
      i++
      continue
    }
    break
  }
  return lines.slice(i).join('\n').trim()
}

function stripCitacaoEmContentMensagem(content) {
  if (typeof content === 'string') return stripCitacaoWhatsappTexto(content)
  if (!Array.isArray(content)) return content
  return content.map((b) => {
    if (!b || typeof b !== 'object') return b
    if (b.type === 'text' && typeof b.text === 'string') return { ...b, text: stripCitacaoWhatsappTexto(b.text) }
    return b
  })
}

/** Mascara CPF no texto enviado ao WhatsApp (somente se SANITIZAR_CPF_RESPOSTA estiver ativo). */
function sanitizarCpfNaSaidaTexto(texto) {
  if (!sanitizarCpfRespostaHabilitado() || !texto || typeof texto !== 'string') return texto
  return texto.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF omitido]')
}

/**
 * Extrai texto plano de um campo `content` (string ou array de blocos).
 * Usado internamente para comparação de eco.
 */
function textoDeContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .trim()
}

/**
 * Remove eco de citação "inline" do WhatsApp: quando o lead usa a função
 * "responder" (reply), alguns clientes e versões da Evolution API entregam
 * o texto do assistente + "\n" + a resposta real do lead numa única string,
 * sem o prefixo ">". Isso polui o contexto do LLM em conversas longas.
 *
 * Estratégia: para cada mensagem `user`, verifica se o conteúdo começa com
 * o texto da última mensagem `assistant` (match completo ou match de linha
 * com ≥ 20 chars). Se sim, descarta o prefixo e fica só com a resposta real.
 *
 * Exemplos do problema real observado em conversas:
 *   "De 0 a 10, quanto você precisa resolver isso AGORA?\n10"
 *   "Legal! E em qual cidade você atende?\nMacaíba rn"
 */
function stripEcoAssistenteNoHistorico(msgs) {
  const out = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role !== 'user') {
      out.push(m)
      continue
    }

    const conteudo = typeof m.content === 'string' ? m.content : textoDeContent(m.content)
    if (!conteudo || conteudo.length < 5) {
      out.push(m)
      continue
    }

    // Encontra a última mensagem do assistente antes desta
    let textoAssistente = null
    for (let j = i - 1; j >= 0; j--) {
      if (msgs[j].role === 'assistant') {
        textoAssistente = textoDeContent(msgs[j].content)
        break
      }
    }

    // Sem assistente anterior suficientemente longo, nada a fazer
    if (!textoAssistente || textoAssistente.length < 20) {
      out.push(m)
      continue
    }

    // Limita a comparação aos primeiros 600 chars do assistente (evita overhead)
    const prefixRef = textoAssistente.slice(0, 600)
    let stripped = null

    // Caso 1: match completo — conteúdo começa com o texto inteiro do assistente
    if (conteudo.startsWith(prefixRef)) {
      const resto = conteudo.slice(prefixRef.length).replace(/^[\r\n\s]+/, '')
      if (resto) stripped = resto
    } else {
      // Caso 2: match de linha — primeira linha do conteúdo do lead coincide
      // com o início do texto do assistente (≥ 20 chars)
      const nlIdx = conteudo.indexOf('\n')
      if (nlIdx >= 20) {
        const primeiraLinha = conteudo.slice(0, nlIdx)
        if (prefixRef.startsWith(primeiraLinha) || primeiraLinha === prefixRef.slice(0, nlIdx)) {
          const resto = conteudo.slice(nlIdx + 1).trim()
          if (resto) stripped = resto
        }
      }
    }

    out.push(stripped ? { ...m, content: stripped } : m)
  }
  return out
}

/** Histórico vindo do pg como string JSON ou formato inesperado. */
function normalizarHistoricoMensagens(raw) {
  if (raw == null) return []
  let h = raw
  if (typeof h === 'string') {
    try {
      h = JSON.parse(h)
    } catch (_) {
      return []
    }
  }
  if (!Array.isArray(h)) return []
  const normalizado = h
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const out = { ...m }
      if (typeof out.content === 'string') {
        out.content = stripCitacaoWhatsappTexto(out.content)
      } else if (Array.isArray(out.content)) {
        out.content = stripCitacaoEmContentMensagem(out.content)
      }
      return out
    })
  // Segunda passagem: remove eco inline (quoted text sem ">")
  return stripEcoAssistenteNoHistorico(normalizado)
}

/** Remove base64 e blocos de imagem do conteúdo de uma mensagem (dashboard / coach). */
function sanitizarContentMensagemDashboard(content) {
  if (content == null) return ''
  if (typeof content === 'string') {
    let s = content
    if (s.length > 6000 && /^[\sA-Za-z0-9+/=]+$/.test(s.slice(0, 400))) return '(possível mídia base64 omitida)'
    s = s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[\sA-Za-z0-9+/=]{80,}/gi, '(imagem base64 omitida)')
    if (s.length > 16000) s = `${s.slice(0, 16000)}…`
    return s
  }
  if (Array.isArray(content)) {
    const parts = []
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'image' || (b.source && typeof b.source === 'object' && b.source.type === 'base64')) {
        parts.push('(imagem)')
        continue
      }
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else if (typeof b.text === 'string') parts.push(b.text)
    }
    const t = parts.join('\n').trim()
    return t || '(conteúdo não textual)'
  }
  return String(content)
}

/** Histórico seguro para o browser (sem vazar base64). */
function sanitizarHistoricoParaRespostaDashboard(historico) {
  const msgs = normalizarHistoricoMensagens(historico)
  const out = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
    out.push({
      role: m.role,
      content: sanitizarContentMensagemDashboard(m.content),
    })
  }
  return out
}

/** Trecho linear do histórico para o prompt do coach (últimos caracteres se exceder limite). */
function historicoParaTextoCoach(historico) {
  const rows = sanitizarHistoricoParaRespostaDashboard(historico)
  const labels = { user: 'Cliente', assistant: 'Agente', operator: 'Operador' }
  const lines = rows.map((r) => `[${labels[r.role] || r.role}]\n${r.content}`)
  let full = lines.join('\n\n---\n\n')
  if (full.length > LEAD_COACH_MAX_TRANSCRIPT_CHARS) {
    full = `…(trecho inicial omitido — últimos ${LEAD_COACH_MAX_TRANSCRIPT_CHARS} caracteres)\n\n${full.slice(-LEAD_COACH_MAX_TRANSCRIPT_CHARS)}`
  }
  return full
}

/**
 * Anthropic exige alternância user/assistant. Webhooks duplicados ou falhas geram dois "user" seguidos e a API falha.
 * @param {null|{ media_type: string, data: string }} visaoUltimaMensagem — imagem (base64 cru) só na última mensagem user.
 */
function historicoParaClaude(historico, visaoUltimaMensagem = null) {
  // Limita a 12 mensagens brutas mais recentes antes de normalizar, reduzindo tokens de contexto
  const msgs = normalizarHistoricoMensagens(historico).slice(-12)
  /** @type {{ kind: 'client'|'operator'|'assistant', text: string }[]} */
  const expanded = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
    let text = m.content
    if (typeof text !== 'string') {
      if (text == null) text = ''
      else if (Array.isArray(text)) {
        text = text
          .map((b) => (b && typeof b === 'object' && 'text' in b ? b.text : JSON.stringify(b)))
          .join('')
      } else text = String(text)
    }
    if (m.role === 'operator') expanded.push({ kind: 'operator', text })
    else if (m.role === 'user') expanded.push({ kind: 'client', text })
    else expanded.push({ kind: 'assistant', text })
  }

  const out = []
  for (const e of expanded) {
    if (e.kind === 'client') {
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._mergeKind === 'client') {
        last.content = `${last.content}\n\n${e.text}`.trim()
      } else {
        out.push({ role: 'user', content: e.text, _mergeKind: 'client' })
      }
    } else if (e.kind === 'operator') {
      const block = `[Operador humano]: ${e.text}`
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._mergeKind === 'operator') {
        last.content = `${last.content}\n\n${block}`.trim()
      } else {
        out.push({ role: 'user', content: block, _mergeKind: 'operator' })
      }
    } else {
      const last = out[out.length - 1]
      if (last && last.role === 'assistant') {
        last.content = `${last.content}\n\n${e.text}`.trim()
      } else {
        out.push({ role: 'assistant', content: e.text })
      }
    }
  }
  for (const row of out) {
    delete row._mergeKind
  }

  while (out.length > 0 && out[0].role === 'assistant') out.shift()
  const v = visaoUltimaMensagem
  if (
    v &&
    v.data &&
    v.media_type &&
    out.length > 0 &&
    out[out.length - 1].role === 'user'
  ) {
    const lastUser = out[out.length - 1]
    const t = typeof lastUser.content === 'string' ? lastUser.content.trim() : String(lastUser.content || '')
    const blocoOperador =
      typeof t === 'string' && t.startsWith('[Operador humano]:')
    const placeholderImagem = blocoOperador ? '(Operador enviou uma imagem.)' : '(Cliente enviou uma imagem.)'
    lastUser.content = [
      { type: 'text', text: t || placeholderImagem },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: v.media_type,
          data: v.data,
        },
      },
    ]
  }
  return out
}

/**
 * Conta quantas vezes o lead pediu preco/valor/investimento de forma explicita
 * nas mensagens dele (nao do agente). Usado para acionar a regra "preco sob pressao"
 * do prompt (system.md regra 14): a partir da 2a solicitacao, dar o numero em vez de desviar.
 */
function perfilJsonParaPromptSemDuplicarMemoria(perfil) {
  if (!perfil || typeof perfil !== 'object') return {}
  // Remove campos operacionais/internos que não devem aparecer no JSON do perfil
  // enviado ao modelo: resumo de memória (tem bloco próprio) e campos_coletados
  // (tem bloco próprio via montarBlocoColetados).
  const { resumo_memoria_vendas: _r, campos_coletados: _c, ...rest } = perfil
  return rest
}

function montarResumoMemoriaVendas(historico, perfil, estagio) {
  const msgs = normalizarHistoricoMensagens(historico).slice(-8)
  const linhas = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
    const label = m.role === 'assistant' ? 'IA' : m.role === 'operator' ? 'Op' : 'Lead'
    let t =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((b) => (b && typeof b === 'object' && b.text ? b.text : '')).join(' ')
          : ''
    t = t.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (t) linhas.push(`${label}: ${t}`)
  }
  const bits = [
    estagio && `Etapa: ${estagio}`,
    perfil.negocio && `Negocio: ${perfil.negocio}`,
    perfil.cidade && `Cidade: ${perfil.cidade}`,
    perfil.preco_calculado != null && `V_motor: R$ ${perfil.preco_calculado}`,
    perfil.termometro_dor != null && `Termometro: ${perfil.termometro_dor}`,
    perfil.temperatura_lead && `Temperatura: ${perfil.temperatura_lead}`,
  ].filter(Boolean)
  const body = [...bits, '---', ...linhas].join('\n')
  return body.length > 2400 ? `${body.slice(0, 2399)}…` : body
}

function extrairValoresReaisDoTextoBrasil(texto) {
  if (!texto || typeof texto !== 'string') return []
  const re = /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)\b/gi
  const out = []
  let m
  while ((m = re.exec(texto)) !== null) {
    const raw = m[1].replace(/\./g, '').replace(',', '.')
    const v = parseFloat(raw)
    if (Number.isFinite(v) && v > 0) out.push(v)
  }
  return out
}

/**
 * Compara valores monetários citados na última resposta da IA com o motor (preco_calculado).
 * Ignora faixas típicas de plano mensal e valores próximos de entrada/parcela.
 */
function avaliarDivergenciaPrecoIaNoTexto(perfil, textoEnviado) {
  const V = Number(perfil && perfil.preco_calculado)
  if (!Number.isFinite(V) || V <= 0) {
    return { totalDetectado: null, divergente: false }
  }
  const mensalTipicos = new Set([60, 150, 300, 600])
  const ent = Number(perfil.entrada)
  const par = Number(perfil.parcela)
  const amounts = extrairValoresReaisDoTextoBrasil(textoEnviado)
  let candidato = null
  for (const n of amounts) {
    const arred = Math.round(n)
    if (mensalTipicos.has(arred)) continue
    if (Number.isFinite(ent) && ent > 0 && Math.abs(n - ent) / V <= 0.07) continue
    if (Number.isFinite(par) && par > 0 && Math.abs(n - par) / V <= 0.07) continue
    if (n < 250) continue
    if (n >= V * 0.35 && n <= V * 1.25) {
      if (candidato == null || Math.abs(n - V) < Math.abs(candidato - V)) candidato = n
    }
  }
  if (candidato == null) return { totalDetectado: null, divergente: false }
  const divergente = Math.abs(candidato - V) / V > 0.06
  return { totalDetectado: Math.round(candidato), divergente }
}

async function atualizarCamadaMemoriaVendasPosResposta(numero, historico, perfil, estagio, textoEnviado) {
  const resumo = montarResumoMemoriaVendas(historico, perfil, estagio)
  const { totalDetectado, divergente } = avaliarDivergenciaPrecoIaNoTexto(perfil, textoEnviado)
  await pool.query(
    `
    INSERT INTO vendas.lead_profiles (numero, resumo_memoria_vendas, memoria_vendas_versao, ia_total_projeto_detectado_ultima_resposta, preco_ia_divergente_motor)
    VALUES ($1, $2, 1, $3, $4)
    ON CONFLICT (numero) DO UPDATE SET
      resumo_memoria_vendas = EXCLUDED.resumo_memoria_vendas,
      memoria_vendas_versao = COALESCE(vendas.lead_profiles.memoria_vendas_versao, 0) + 1,
      ia_total_projeto_detectado_ultima_resposta = EXCLUDED.ia_total_projeto_detectado_ultima_resposta,
      preco_ia_divergente_motor = EXCLUDED.preco_ia_divergente_motor,
      atualizado_em = NOW()
    `,
    [numero, resumo, totalDetectado, divergente]
  )
}

function contarPedidosPrecoDoLead(historico) {
  if (!Array.isArray(historico)) return 0
  const padraoPreco = /(quanto\s+(custa|fica|sai|e|\u00e9|vai\s+sair)|qual\s+(o\s+)?(pre\u00e7o|valor|investimento|custo)|me\s+(fala|diz|manda|passa)\s+(o\s+)?(pre\u00e7o|valor)|me\s+passa\s+(um\s+)?or\u00e7amento|vc\s+cobra\s+quanto|voc\u00ea\s+cobra\s+quanto|cobra\s+quanto|valor\s+(ai|a\u00ed|disso)|pre\u00e7o\s+(ai|a\u00ed|disso)|quanto\s+t\u00e1|quanto\s+ta)/i
  let count = 0
  for (const msg of historico) {
    // Considera apenas mensagens do lead: role "user" ou sem campo role, e que nao sejam do Operador.
    const role = msg?.role || 'user'
    if (role !== 'user') continue
    const texto = typeof msg?.content === 'string'
      ? msg.content
      : (typeof msg?.text === 'string' ? msg.text : '')
    if (!texto) continue
    if (texto.startsWith('[Operador humano]:')) continue
    if (padraoPreco.test(texto)) count++
  }
  return count
}

/**
 * Gera um bloco de texto conciso que lista quais campos diagnósticos já foram
 * coletados do lead (via campos_coletados) e quais ainda estão pendentes.
 *
 * Isso permite ao modelo não repetir perguntas já respondidas — um dos padrões
 * de falha mais frequentes identificados na análise de conversas reais (padrão 13).
 *
 * Exemplo de saída:
 *   --- COLETA DE DADOS DO LEAD ---
 *   Ja coletado (NAO repita): negocio, cidade
 *   Pendente (pode perguntar): ticket_cliente_final, ja_aparece_google, termometro_dor, complexidade, score_dor
 */
function montarBlocoColetados(perfil) {
  if (!perfil || typeof perfil !== 'object') return ''

  // campos_coletados pode vir do banco como objeto ou string JSON
  let coletadosObj = {}
  const raw = perfil.campos_coletados
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    coletadosObj = raw
  } else if (typeof raw === 'string') {
    try { coletadosObj = JSON.parse(raw) } catch (_) { /* ignora */ }
  }

  const coletados = []
  const pendentes = []
  for (const campo of LEAD_CAMPOS_DIAGNOSTICO) {
    if (coletadosObj[campo]) coletados.push(campo)
    else pendentes.push(campo)
  }

  // Só injeta o bloco se houver pelo menos um campo já coletado
  if (coletados.length === 0) return ''

  const linhas = [`\n--- COLETA DE DADOS DO LEAD ---`]
  linhas.push(`Ja coletado (NAO repita perguntas sobre): ${coletados.join(', ')}`)
  if (pendentes.length > 0) {
    linhas.push(`Pendente (pode perguntar quando relevante): ${pendentes.join(', ')}`)
  }
  return linhas.join('\n') + '\n'
}

function montarSystemPromptDinamico(estagio, perfil, aprendizado, flags = {}) {
  const base =
    SYSTEM_PROMPT_BASE.trim() ||
    `Voce e o assistente de vendas da PJ Codeworks. Responda APENAS com um objeto JSON valido com mensagem_pro_lead, atualizar_perfil, etapa_proxima, solicitar_calculo_preco, solicitar_classificacao_nicho, handoff, motivo_handoff.`
  const empresa = EMPRESA_KNOWLEDGE_BASE.trim()
  const blocoEmpresa = empresa ? `\n\n---\n\n${empresa}\n` : ''
  const ctxHorario = textoContextoHorarioVictorParaPrompt()
  const blocoEstatico = `${base}${blocoEmpresa}`

  // Flags de pressao/instrucao-dinamica: sinalizam ao modelo quando acionar regras de prompt.
  const linhasFlags = []
  const pedidosPreco = Number(flags.pedidosPreco) || 0
  const temPrecoCalculado = !!flags.temPrecoCalculado
  if (pedidosPreco >= 2 && !temPrecoCalculado) {
    linhasFlags.push(
      `- LEAD_PEDIU_PRECO_${pedidosPreco}X: o lead pediu preco/valor ${pedidosPreco} vezes explicitamente e ainda nao recebeu. Acione a regra 14 (Bloco 1) do system.md: va direto ao Passo B da proposta, marque solicitar_calculo_preco: true no JSON de resposta.`
    )
  }
  if (flags.concorrentesReais && Array.isArray(flags.concorrentesReais) && flags.concorrentesReais.length > 0) {
    linhasFlags.push(
      `- CONCORRENTES_REAIS (busca autorizada): use APENAS estes nomes se for citar concorrentes; nao invente outros — ${flags.concorrentesReais.map((c) => (typeof c === 'string' ? c : c?.titulo || '')).filter(Boolean).slice(0, 3).join(' | ')}`
    )
  }
  if (flags.jaRecebeuPreview) {
    linhasFlags.push(
      `- JA_RECEBEU_PREVIEW: a previa visual ja foi enviada para este lead. NUNCA marque solicitar_preview_site: true. NUNCA diga que a previa "esta sendo gerada" ou "esta sendo montada". Continue a conversa com base no modelo ja enviado.`
    )
  }
  const blocoFlags = linhasFlags.length > 0
    ? `\n\n--- FLAGS DINAMICAS DO TURNO ATUAL (obedeca) ---\n${linhasFlags.join('\n')}`
    : ''

  const memRaw = perfil && typeof perfil.resumo_memoria_vendas === 'string' ? perfil.resumo_memoria_vendas.trim() : ''
  const blocoMemoria = memRaw
    ? `\n\n--- RESUMO MEMORIA VENDAS (sintese operacional; nao substitui o historico de mensagens) ---\n${memRaw}\n`
    : ''

  // Bloco de coleta: informa ao modelo quais campos diagnósticos JÁ foram coletados
  // para que ele não repita perguntas que o lead já respondeu.
  const blocoColetados = montarBlocoColetados(perfil)
  const blocoContextoInterno = montarBlocoContextoInterno(flags.contextosInternos)

  const perfilJson = JSON.stringify(perfilJsonParaPromptSemDuplicarMemoria(perfil), null, 2)
  const blocodinamico = `\n\n---\n\nCONTEXTO DINAMICO (obedeca as regras acima):\n\n--- HORARIO E REDIRECIONAMENTO AO VICTOR ---\n${ctxHorario}\n\nETAPA ATUAL: ${estagio}\n${blocoMemoria}${blocoColetados}${blocoContextoInterno}\nPERFIL DO LEAD:\n${perfilJson}\n${aprendizado ? `\nAPRENDIZADO DAS ULTIMAS VENDAS FECHADAS:\n${aprendizado}\n` : ''}${blocoFlags}`
  return [
    { type: 'text', text: blocoEstatico, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: blocodinamico },
  ]
}

/**
 * Normaliza o objeto opcional `agendar_followup_auto` do JSON do modelo.
 * @param {unknown} raw
 * @param {Date} [agora]
 * @returns {{ agendar_para: string, instrucao_followup: string } | null}
 */
function normalizarAgendarFollowupAuto(raw, agora = new Date()) {
  if (raw == null || raw === false) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const agendarParaStr = typeof raw.agendar_para === 'string' ? raw.agendar_para.trim() : ''
  if (!agendarParaStr) return null
  const dt = new Date(agendarParaStr)
  if (Number.isNaN(dt.getTime())) return null
  const nowMs = agora.getTime()
  const minMs = nowMs + FOLLOWUP_EXPLICITO_MIN_MINUTOS * 60 * 1000
  const maxMs = nowMs + FOLLOWUP_EXPLICITO_MAX_DIAS * 24 * 60 * 60 * 1000
  let t = dt.getTime()
  if (t > maxMs) return null
  if (t < minMs) t = minMs
  let out = new Date(t)
  out = ajustarParaJanelaComercialFollowup(out)
  if (out.getTime() < nowMs + 8 * 60 * 1000) {
    out = ajustarParaJanelaComercialFollowup(new Date(minMs))
  }
  if (out.getTime() < nowMs || out.getTime() > maxMs) return null
  const instrucaoRaw = typeof raw.instrucao_followup === 'string' ? raw.instrucao_followup.trim() : ''
  const instrucao_followup = instrucaoRaw
    ? instrucaoRaw.slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
    : FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO
  return { agendar_para: out.toISOString(), instrucao_followup }
}

function resultadoParseadoParaObjeto(parsed, estagio) {
  const linksRaw = Array.isArray(parsed.links_sugeridos) ? parsed.links_sugeridos : []
  const links_sugeridos = linksRaw
    .filter((u) => typeof u === 'string')
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 3)
  const bolhasNorm = normalizarMensagensBolhasArray(parsed.mensagens_bolhas)
  let mensagem_pro_lead = typeof parsed.mensagem_pro_lead === 'string' ? parsed.mensagem_pro_lead.trim() : ''
  if (bolhasNorm && bolhasNorm.length) {
    mensagem_pro_lead = bolhasNorm.join('\n\n')
  }
  const tema_lacuna =
    typeof parsed.tema_lacuna === 'string'
      ? parsed.tema_lacuna.trim().slice(0, MAX_TEMA_LACUNA_CHARS)
      : ''
  const detalhe_lacuna =
    typeof parsed.detalhe_lacuna === 'string'
      ? parsed.detalhe_lacuna.trim().slice(0, MAX_DETALHE_LACUNA_CHARS)
      : ''

  const resumo_handoff =
    typeof parsed.resumo_handoff === 'string' && parsed.resumo_handoff.trim()
      ? parsed.resumo_handoff.trim()
      : null
  const enviar_print =
    typeof parsed.enviar_print === 'string' && parsed.enviar_print.trim()
      ? parsed.enviar_print.trim()
      : null
  const preview_site_modelo =
    typeof parsed.preview_site_modelo === 'string' && parsed.preview_site_modelo.trim()
      ? parsed.preview_site_modelo.trim().toLowerCase()
      : null
  const agendar_followup_auto = normalizarAgendarFollowupAuto(parsed.agendar_followup_auto)

  return {
    mensagem_pro_lead,
    mensagens_bolhas: bolhasNorm,
    atualizar_perfil: parsed.atualizar_perfil && typeof parsed.atualizar_perfil === 'object' ? parsed.atualizar_perfil : {},
    etapa_proxima: parsed.etapa_proxima || estagio,
    solicitar_calculo_preco: !!parsed.solicitar_calculo_preco,
    solicitar_classificacao_nicho: !!parsed.solicitar_classificacao_nicho,
    handoff: !!parsed.handoff,
    motivo_handoff: parsed.motivo_handoff ?? null,
    links_sugeridos,
    registrar_lacuna: parsed.registrar_lacuna === true,
    tema_lacuna,
    detalhe_lacuna,
    resumo_handoff,
    enviar_print,
    solicitar_preview_site: parsed.solicitar_preview_site === true,
    preview_site_modelo: PREVIEW_SITE_MODELOS.has(preview_site_modelo) ? preview_site_modelo : null,
    agendar_followup_auto,
  }
}

/**
 * Modelo às vezes usa chave errada; copia para mensagem_pro_lead se estiver vazio.
 */
function normalizarParsedRespostaVendas(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed
  const m = parsed.mensagem_pro_lead
  if (typeof m === 'string' && m.trim()) return parsed
  const alts = ['mensagem', 'texto', 'resposta', 'mensagem_para_lead', 'msg']
  for (const k of alts) {
    const v = parsed[k]
    if (typeof v === 'string' && v.trim()) {
      return { ...parsed, mensagem_pro_lead: v.trim() }
    }
  }
  return parsed
}

function extrairCampoStringJsonManual(texto, chaves) {
  if (!texto || typeof texto !== 'string') return ''
  const lista = Array.isArray(chaves) ? chaves : [chaves]
  for (const chave of lista) {
    const key = `"${String(chave || '').trim()}"`
    if (!key || key === '""') continue
    let i = texto.indexOf(key)
    if (i === -1) continue
    i = texto.indexOf(':', i + key.length)
    if (i === -1) continue
    i++
    while (i < texto.length && /\s/.test(texto[i])) i++
    if (texto[i] !== '"') continue
    i++
    let out = ''
    while (i < texto.length) {
      const c = texto[i]
      if (c === '\\') {
        const n = texto[i + 1]
        if (n === 'n') {
          out += '\n'
          i += 2
          continue
        }
        if (n === 'r') {
          out += '\r'
          i += 2
          continue
        }
        if (n === 't') {
          out += '\t'
          i += 2
          continue
        }
        if (n === '"') {
          out += '"'
          i += 2
          continue
        }
        if (n === '\\') {
          out += '\\'
          i += 2
          continue
        }
        if (n === 'u' && /^[0-9a-fA-F]{4}/.test(texto.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(texto.slice(i + 2, i + 6), 16))
          i += 6
          continue
        }
        if (n) {
          out += n
          i += 2
          continue
        }
      }
      if (c === '"') return out
      out += c
      i++
    }
  }
  return ''
}

/**
 * Extrai o valor string de campos esperados no texto bruto (escapes JSON).
 * Usado quando o parse falha em parte ou o fallback anterior enviava o JSON inteiro ao WhatsApp.
 */
function extrairMensagemProLeadStringManual(texto) {
  return extrairCampoStringJsonManual(texto, [
    'mensagem_pro_lead',
    'mensagem',
    'texto',
    'resposta',
    'mensagem_para_lead',
    'msg',
  ])
}

function extrairTextoLivreSeguroDoModelo(texto) {
  const s = limparSaidaTextoClaude(texto)
  if (!s) return ''
  if (/[{}[\]]/.test(s)) return ''
  if (/^(mensagem_pro_lead|mensagem|texto|resposta)\s*:/i.test(s)) return ''
  return resumirTextoOperacional(s, 2000)
}

function temTextoEnviavelResultadoVendas(r) {
  if (!r || typeof r !== 'object') return false
  if (Array.isArray(r.mensagens_bolhas) && r.mensagens_bolhas.length > 0) return true
  const t = r.mensagem_pro_lead
  return typeof t === 'string' && t.trim().length > 0
}

function montarFerramentasWebSearchAnthropic() {
  return [{ type: 'web_search_20250305', name: 'web_search', max_uses: CLAUDE_WEB_SEARCH_MAX_USES }]
}

/** Junta blocos `type: text` da resposta da Messages API (web_search, citações, etc.). */
function textoBrutoDosBlocosAssistantAnthropic(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const partes = []
  for (const bloco of content) {
    if (bloco && typeof bloco === 'object' && bloco.type === 'text' && typeof bloco.text === 'string') {
      partes.push(bloco.text)
    }
  }
  return partes.join('')
}

/**
 * POST /v1/messages com server tool web_search; se `stop_reason` for `pause_turn`, continua o turno (doc server-tools).
 */
async function anthropicMessagesComWebSearch({ system, messages, max_tokens, model }) {
  const headers = {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31,web-search-2025-03-05',
    'content-type': 'application/json',
  }
  const tools = montarFerramentasWebSearchAnthropic()
  const bodyBase = { model, max_tokens, system, tools }
  let conversation = messages.map((m) => ({ role: m.role, content: m.content }))
  let data = null
  for (let i = 0; i < CLAUDE_WEB_SEARCH_PAUSE_MAX; i++) {
    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { ...bodyBase, messages: conversation },
      { headers, timeout: CLAUDE_TIMEOUT_COM_BUSCA_MS }
    )
    data = resp.data
    if (data.stop_reason !== 'pause_turn') break
    conversation = [...conversation, { role: 'assistant', content: data.content }]
  }
  if (data && data.stop_reason === 'pause_turn') {
    console.warn(
      '⚠️ Claude web_search: stop_reason pause_turn após',
      CLAUDE_WEB_SEARCH_PAUSE_MAX,
      'continuações — resposta pode estar incompleta'
    )
  }
  return data
}

async function chamarClaude(historico, estagio, perfil, visaoUltimaMensagem = null) {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_KEY não configurada')
  }

  const mensagensApi = historicoParaClaude(historico, visaoUltimaMensagem)
  if (mensagensApi.length === 0) {
    throw new Error('Histórico vazio após normalização')
  }
  const ult = mensagensApi[mensagensApi.length - 1]
  if (ult.role !== 'user') {
    throw new Error('A última mensagem precisa ser do usuário (verifique duplicatas no histórico)')
  }

  const aprendizado = await buscarUltimoAprendizado()
  const contextosInternos = perfil?.numero ? await buscarLeadContextos(perfil.numero, LEAD_CONTEXTO_PROMPT_LIMIT) : []
  const jaRecebeuPreviewRes = perfil?.numero
    ? await pool.query(
      'SELECT 1 FROM vendas.eventos_comerciais WHERE numero = $1 AND tipo = $2 LIMIT 1',
      [perfil.numero, 'recebeu_preview']
    )
    : { rows: [] }
  // Flags que acionam regras dinamicas do prompt (preco sob pressao, concorrentes reais, etc)
  const flags = {
    pedidosPreco: contarPedidosPrecoDoLead(historico),
    temPrecoCalculado: !!(perfil && perfil.precificacao_json),
    concorrentesReais: Array.isArray(perfil?.concorrentes) ? perfil.concorrentes : [],
    contextosInternos,
    jaRecebeuPreview: jaRecebeuPreviewRes.rows.length > 0,
  }
  const systemPrompt = montarSystemPromptDinamico(estagio, perfil, aprendizado, flags)

  let data
  if (claudeWebSearchHabilitado() && estagio === 'diagnostico') {
    data = await anthropicMessagesComWebSearch({
      system: systemPrompt,
      messages: mensagensApi,
      max_tokens: 1200,
      model: 'claude-sonnet-4-6',
    })
  } else {
    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: mensagensApi,
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'content-type': 'application/json',
        },
        timeout: CLAUDE_TIMEOUT_MS,
      }
    )
    data = resp.data
  }

  const bruto =
    textoBrutoDosBlocosAssistantAnthropic(data.content) ||
    (data.content && data.content[0] && data.content[0].text) ||
    ''
  if (!String(bruto || '').trim()) {
    throw new Error('Resposta vazia da API Anthropic após normalização dos blocos de texto')
  }
  const parsedRaw = parsearRespostaJsonClaude(bruto)
  if (parsedRaw && typeof parsedRaw === 'object') {
    const camposObrigatorios = ['etapa_proxima', 'solicitar_calculo_preco', 'handoff', 'motivo_handoff']
    for (const campo of camposObrigatorios) {
      if (!(campo in parsedRaw)) {
        console.warn(`[schema-violation] campo obrigatorio ausente: ${campo}`, { telefone, estagio })
      }
    }
    if (parsedRaw.handoff && !parsedRaw.motivo_handoff) {
      console.warn('[schema-violation] handoff:true sem motivo_handoff', { telefone, estagio })
    }
  }
  const parsed =
    parsedRaw && typeof parsedRaw === 'object' ? normalizarParsedRespostaVendas(parsedRaw) : null

  if (parsed) {
    const resultado = resultadoParseadoParaObjeto(parsed, estagio)
    if (temTextoEnviavelResultadoVendas(resultado)) return resultado
    const manual = extrairMensagemProLeadStringManual(bruto)
    if (manual && manual.trim()) {
      resultado.mensagem_pro_lead = manual.trim()
      return resultado
    }
    throw new Error('Modelo retornou JSON sem mensagem utilizável para o lead (mensagem_pro_lead vazio)')
  }

  const manualSozinho = extrairMensagemProLeadStringManual(bruto)
  if (manualSozinho && manualSozinho.trim()) {
    return resultadoParseadoParaObjeto(
      {
        mensagem_pro_lead: manualSozinho.trim(),
        handoff: false,
        motivo_handoff: null,
        atualizar_perfil: {},
      },
      estagio
    )
  }

  const textoLivre = extrairTextoLivreSeguroDoModelo(bruto)
  if (textoLivre) {
    return resultadoParseadoParaObjeto(
      {
        mensagem_pro_lead: textoLivre,
        handoff: false,
        motivo_handoff: null,
        atualizar_perfil: {},
      },
      estagio
    )
  }

  throw new Error('Modelo não retornou JSON válido com mensagem para o lead')
}

/**
 * Coach interno (dashboard): decisão operacional + prompt para Gamma; não envia mensagem ao lead.
 */
async function chamarClaudeLeadCoach({ numero, conversa, perfil }) {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_KEY não configurada')
  }
  const aprendizado = await buscarUltimoAprendizado()
  const historicoTexto = historicoParaTextoCoach(conversa.historico)
  const coachBase =
    LEAD_COACH_PROMPT_BASE.trim() ||
    `Voce e coach interno da PJ Codeworks (uso exclusivo do operador). Responda APENAS com JSON valido, sem markdown, com as chaves:
etapa (string), status_conversa (string),
decisao_recomendada (string), confianca (string: baixa|media|alta), raciocinio (string),
proximos_passos (array de strings), riscos (array de strings),
sinais (objeto com flags booleanas opcionais: handoff, fechar_negocio, coletar_mais_dados),
perguntas_em_aberto (array de strings),
resumo_problema (string curta), o_que_faltou_para_vender (array de strings),
melhorias_para_ia (array de strings), sinais_melhoria_ia (array de strings), acoes_de_preparo (array de strings),
confianca_analise (string: baixa|media|alta),
prompt_gamma_apresentacao (string longa em portugues, pronta para colar no Gamma para gerar slides da proposta; estrutura de slides; sem inventar precos ou promessas que nao estejam no contexto; use placeholders se faltar dado).`

  const system = [
    { type: 'text', text: coachBase, cache_control: { type: 'ephemeral' } },
  ]

  const userPayload = {
    numero_lead: numero,
    estagio: conversa.estagio,
    status: conversa.status,
    venda_fechada: conversa.venda_fechada,
    agente_pausado: conversa.agente_pausado,
    perfil_lead: perfil && typeof perfil === 'object' && Object.keys(perfil).length ? perfil : {},
    aprendizado_vendas_fechadas: aprendizado || null,
    historico_conversa: historicoTexto || '(historico vazio apos sanitizacao)',
  }

  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: [
        {
          role: 'user',
          content:
            'Analise o contexto JSON abaixo e responda APENAS com o objeto JSON solicitado no system. ' +
            'O objeto deve comecar com { e terminar com }; sem markdown, sem texto antes ou depois.\n\n' +
            JSON.stringify(userPayload),
        },
      ],
    },
    { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'content-type': 'application/json' } }
  )

  const content = resp.data?.content
  if (!Array.isArray(content) || !content[0] || typeof content[0].text !== 'string') {
    throw new Error(
      `Resposta inesperada da API Anthropic: ${JSON.stringify(resp.data).slice(0, 300)}`
    )
  }

  const stopReason = resp.data.stop_reason
  if (stopReason === 'max_tokens') {
    throw new Error(
      'Resposta do modelo foi cortada (max_tokens atingido) — JSON incompleto; tente reduzir o histórico da conversa'
    )
  }

  const bruto = String(content[0].text).trim()
  const parsed = parsearRespostaJsonClaude(bruto)
  if (!parsed || typeof parsed !== 'object') {
    console.error('❌ coach — texto bruto não parseável (primeiros 600 chars):', bruto.slice(0, 600))
    throw new Error('Modelo não retornou JSON parseável para o coach')
  }
  return {
    ...parsed,
    etapa: parsed.etapa != null && String(parsed.etapa).trim() ? String(parsed.etapa).trim() : conversa.estagio || 'primeiro_contato',
    status_conversa:
      parsed.status_conversa != null && String(parsed.status_conversa).trim()
        ? String(parsed.status_conversa).trim()
        : conversa.status || 'ativo',
  }
}

// ─── PREVIA VISUAL DE SITE (HTML TEMPORARIO -> IMAGEM) ───────────────────────

const PREVIEW_SITE_MODELOS = new Set(['iniciante', 'padrao', 'premium'])

function caseDeReferenciaPorNicho(negocio) {
  const n = String(negocio || '').toLowerCase()
  if (/(vidro|vidrac|esquadria)/i.test(n)) {
    return { nome: '874 Vidros', cidade: 'Petrolina-PE', dado: '+93,8% de crescimento em acessos no Google em 30 dias' }
  }
  if (/(barber|barbearia|barbear)/i.test(n)) {
    return { nome: 'Hokage Barber', cidade: 'Sao Bernardo-SP', dado: 'agendamento pelo WhatsApp ativo' }
  }
  if (/(foto|fotografi)/i.test(n)) {
    return { nome: 'Mirelly Fotografias', cidade: '', dado: 'portfolio completo com galeria' }
  }
  if (/limpeza/i.test(n)) {
    return { nome: 'Gurgel Clean', cidade: 'BH', dado: 'presenca profissional no Google' }
  }
  return { nome: '874 Vidros', cidade: 'Petrolina-PE', dado: '+93,8% de crescimento em acessos no Google em 30 dias' }
}

function montarPreviewSiteCaption(dados) {
  const negocio = textoCurto(dados?.negocio || 'seu negocio', 70)
  const ref = caseDeReferenciaPorNicho(negocio)
  const cidade = ref.cidade ? `, em ${ref.cidade},` : ''
  return [
    'Pra ficar claro: isso aqui e so um rascunho da ideia, nao e o site final.',
    `O objetivo e te mostrar como ${negocio} poderia ser apresentado online pra atrair cliente e chamar no WhatsApp.`,
    `O site real fica com nivel de acabamento profissional, igual aos projetos que ja entregamos. Um exemplo e a ${ref.nome}${cidade} que teve ${ref.dado}.`,
    'Posso te mandar o link pra voce ver na pratica e nao ficar so na promessa?',
  ].join('\n')
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeXml(s) {
  return escapeHtml(s)
}

function textoCurto(raw, max = 80) {
  const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trim()}...` : t
}

function moedaPtBr(valor) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `R$ ${Math.round(n).toLocaleString('pt-BR')}`
}

function modeloPreviewSite(perfil, opcoes = {}) {
  const raw = String(opcoes.modelo || perfil?.plano_sugerido || perfil?.precificacao_json?.plano_recomendado || 'padrao')
    .trim()
    .toLowerCase()
  return PREVIEW_SITE_MODELOS.has(raw) ? raw : 'padrao'
}

function extrairServicosDoHistorico(historico, perfil) {
  const base = []
  const negocio = String(perfil?.negocio || '').toLowerCase()
  const mapa = [
    ['vidro', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],
    ['vidrac', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],
    ['esquadria', ['Esquadrias sob medida', 'Portas e janelas', 'Projetos em aluminio']],
    ['pintura', ['Pintura residencial', 'Pintura predial', 'Acabamento profissional']],
    ['barbear', ['Cortes masculinos', 'Barba completa', 'Agendamento pelo WhatsApp']],
    ['estet', ['Procedimentos esteticos', 'Avaliacao personalizada', 'Atendimento com hora marcada']],
    ['dent', ['Consultas odontologicas', 'Tratamentos esteticos', 'Agendamento rapido']],
    ['veterin', ['Consultas veterinarias', 'Vacinas e exames', 'Atendimento com carinho']],
    ['foto', ['Ensaios fotograficos', 'Eventos', 'Portfolio profissional']],
    ['limpeza', ['Higienizacao de estofados', 'Limpeza residencial', 'Orcamento pelo WhatsApp']],
  ]
  for (const [needle, servs] of mapa) {
    if (negocio.includes(needle)) base.push(...servs)
  }

  const texto = normalizarHistoricoMensagens(historico)
    .filter((m) => m.role === 'user')
    .slice(-8)
    .map((m) => textoDeContent(m.content))
    .join(' ')
    .toLowerCase()

  const candidatos = [
    'landing page',
    'site institucional',
    'orcamento pelo whatsapp',
    'agendamento',
    'google',
    'servicos',
    'produtos',
    'portfolio',
  ]
  for (const c of candidatos) {
    if (texto.includes(c)) base.push(c.replace(/\b\w/g, (x) => x.toUpperCase()))
  }

  const limpos = [...new Set(base.map((s) => textoCurto(s, 42)).filter(Boolean))]
  return limpos.length ? limpos.slice(0, 4) : ['Servicos principais', 'Fotos dos trabalhos', 'Botao direto para WhatsApp']
}

function dadosPreviewSite(numero, perfil, historico, opcoes = {}) {
  const modelo = modeloPreviewSite(perfil, opcoes)
  const negocio = textoCurto(perfil?.negocio || opcoes.negocio || 'Seu negocio', 48)
  const cidade = textoCurto(perfil?.cidade || opcoes.cidade || 'sua cidade', 48)
  const servicos = Array.isArray(opcoes.servicos) && opcoes.servicos.length
    ? opcoes.servicos.map((s) => textoCurto(s, 42)).filter(Boolean).slice(0, 4)
    : extrairServicosDoHistorico(historico, perfil)
  const total = moedaPtBr(perfil?.preco_calculado)
  const entrada = moedaPtBr(perfil?.entrada)
  const parcela = moedaPtBr(perfil?.parcela)
  const phone = String(numero || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  const imagens = Array.isArray(opcoes.imagens)
    ? opcoes.imagens
        .filter((img) => img && typeof img.data === 'string' && img.data.trim())
        .map((img) => ({
          media_type: mimeImagemParaClaude(img.media_type || img.mimetype || 'image/jpeg') || 'image/jpeg',
          data: limparBase64String(img.data),
        }))
        .filter((img) => img.data)
        .slice(0, 4)
    : []
  return { modelo, negocio, cidade, servicos, total, entrada, parcela, phone, imagens }
}

function montarPromptWireframe(dados, estilo = 'lapis') {
  const servicos = dados.servicos.slice(0, 4).join(', ')
  const neg = dados.negocio
  const cid = dados.cidade

  const base = `Website prototype wireframe for a Brazilian business.
Business: "${neg}", city: ${cid}.
Services: ${servicos}.
Layout (top to bottom):
1. Navigation bar: logo "${neg}" + 3 menu links (Servicos, Projetos, Contato)
2. Dark hero section: large heading "${neg} em ${cid}", subtitle about professional online presence, CTA button "Chamar no WhatsApp"
3. Social proof bar: 5 stars + "31 clientes atendidos"
4. Two columns: left = service list (${servicos}); right = 3 photo placeholder boxes with X marks
5. Footer: "PJCodeworks" brand
Portrait format 1024x1536.`

  if (estilo === 'lapis') {
    return `${base}
Style: hand-drawn pencil sketch on white paper, rough uneven lines, gray shading, no color fills, imperfect borders. Rotated stamp reading "RASCUNHO" in red. Looks like a quick paper mockup, clearly not a finished design.`
  }

  return `${base}
Style: clean digital wireframe, thin gray lines, solid gray placeholder boxes, minimal typography markers, white background. "DEMONSTRACAO" label at bottom. Professional low-fidelity prototype aesthetic.`
}

function escolherEstiloWireframe(dados, opcoes = {}) {
  if (opcoes.estilo === 'clean' || opcoes.estilo === 'lapis') return opcoes.estilo
  return 'lapis'
}

function montarPreviewSiteHtml(d) {
  const modeloNome = d.modelo === 'premium' ? 'Premium' : d.modelo === 'iniciante' ? 'Iniciante' : 'Padrao'
  const tema =
    d.modelo === 'premium'
      ? { bg: '#101820', accent: '#35d07f', soft: '#e9fff3' }
      : d.modelo === 'iniciante'
        ? { bg: '#16312b', accent: '#f0c85a', soft: '#fff7dc' }
        : { bg: '#18212f', accent: '#38bdf8', soft: '#e7f7ff' }
  const preco = d.total
    ? `<div class="price">Modelo ${escapeHtml(modeloNome)} a partir de <b>${escapeHtml(d.total)}</b></div>`
    : `<div class="price">Modelo ${escapeHtml(modeloNome)} - previa visual</div>`
  const parcelamento = d.entrada && d.parcela ? `<span>${escapeHtml(d.entrada)} + 3x ${escapeHtml(d.parcela)}</span>` : ''
  const fotos = d.imagens.length
    ? d.imagens.map((img, i) => `<div class="photo"><img alt="Foto ${i + 1}" src="data:${img.media_type};base64,${img.data}"></div>`).join('')
    : '<div class="photo placeholder">Foto do trabalho</div><div class="photo placeholder">Antes e depois</div><div class="photo placeholder">Equipe ou produto</div>'
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;font-family:'Inter',Arial,Helvetica,sans-serif;color:#172033}.wrap{width:1080px;height:1350px;background:#fff;overflow:hidden;position:relative}.hero{height:760px;padding:54px 76px 54px;background:linear-gradient(135deg,rgba(255,255,255,.20),rgba(255,255,255,0) 46%),${tema.bg};color:#fff;position:relative}.nav{height:58px;display:flex;align-items:center;justify-content:space-between;margin-bottom:58px}.logo{display:flex;align-items:center;gap:14px;font-size:23px;font-weight:900}.logo-mark{width:42px;height:42px;border-radius:12px;background:${tema.accent};box-shadow:0 14px 40px rgba(0,0,0,.18)}.menu{display:flex;gap:28px;color:#d7e0ec;font-size:20px;font-weight:700}.kicker{font-size:25px;text-transform:uppercase;letter-spacing:3px;color:${tema.accent};font-weight:800}.h1{font-size:74px;line-height:1;font-weight:900;max-width:830px;margin:24px 0 24px}.sub{font-size:31px;line-height:1.25;max-width:790px;color:#d7e0ec}.cta{display:inline-flex;align-items:center;gap:14px;margin-top:36px;background:${tema.accent};color:#07130f;border-radius:18px;padding:24px 32px;font-size:30px;font-weight:900}.badge{position:absolute;right:70px;top:150px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24);border-radius:22px;padding:18px 22px;font-size:24px}.proof{height:88px;display:flex;align-items:center;gap:20px;padding:0 76px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:27px;font-weight:900;color:#172033}.stars{color:#f59e0b;letter-spacing:2px}.content{padding:44px 76px 0}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:36px}.card{border:1px solid #dce3ec;border-radius:18px;padding:28px;background:#fff}.card h2{margin:0 0 18px;font-size:34px}.services{display:grid;gap:13px}.service{font-size:26px;padding:18px 20px;background:${tema.soft};border-radius:14px;font-weight:800}.photos{display:grid;grid-template-columns:1fr 1fr;gap:14px}.photo{height:170px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#172033,#475569);display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-size:23px;font-weight:800;text-align:center;padding:18px}.photo:first-child{grid-column:span 2;height:210px}.photo img{width:100%;height:100%;object-fit:cover}.price{margin-top:28px;font-size:30px;font-weight:800}.price b{color:${tema.bg}}.demo-stamp{position:absolute;left:58px;bottom:102px;transform:rotate(-6deg);background:#f59e0b;color:#111827;border:4px solid #111827;border-radius:12px;padding:18px 24px;font-size:31px;font-weight:900;letter-spacing:1px;box-shadow:0 16px 32px rgba(15,23,42,.22)}.foot{position:absolute;left:0;right:0;bottom:0;height:78px;display:flex;justify-content:space-between;align-items:center;padding:0 76px;background:#101820;color:#e5e7eb;font-size:22px}.brand-foot{font-weight:900;color:#fff}.whats{color:#35d07f;font-weight:900}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <div class="nav">
      <div class="logo"><span class="logo-mark"></span><span>${escapeHtml(d.negocio)}</span></div>
      <div class="menu"><span>Servicos</span><span>Projetos</span><span>Contato</span></div>
    </div>
    <div class="badge">Modelo ${escapeHtml(modeloNome)}</div>
    <div class="kicker">${escapeHtml(d.cidade)}</div>
    <div class="h1">${escapeHtml(d.negocio)} com presenca profissional no Google</div>
    <div class="sub">Uma pagina clara para mostrar seus servicos, passar confianca e levar o cliente direto para o WhatsApp.</div>
    <div class="cta">Chamar no WhatsApp</div>
  </section>
  <section class="proof"><span class="stars">★★★★★</span><span>31 clientes atendidos · Aparece no Google</span></section>
  <section class="content">
    <div class="grid">
      <div class="card">
        <h2>O que entraria na primeira versao</h2>
        <div class="services">${d.servicos.map((s) => `<div class="service">${escapeHtml(s)}</div>`).join('')}</div>
        ${preco}
        ${parcelamento}
      </div>
      <div class="card">
        <h2>Fotos e prova visual</h2>
        <div class="photos">${fotos}</div>
      </div>
    </div>
  </section>
  <div class="demo-stamp">MODELO DE DEMONSTRACAO</div>
  <div class="foot"><span class="brand-foot">PJ Codeworks</span><span>Este e um modelo. O site real fica com o mesmo nivel de acabamento.</span><span class="whats">${escapeHtml(d.phone ? `WhatsApp ${d.phone}` : 'Botao WhatsApp')}</span></div>
</main>
</body>
</html>`
}

function quebrarLinhaSvg(texto, maxChars, maxLinhas) {
  const words = String(texto || '').split(/\s+/).filter(Boolean)
  const linhas = []
  let atual = ''
  for (const w of words) {
    const cand = atual ? `${atual} ${w}` : w
    if (cand.length > maxChars && atual) {
      linhas.push(atual)
      atual = w
    } else {
      atual = cand
    }
    if (linhas.length >= maxLinhas) break
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual)
  return linhas
}

function montarPreviewSiteSvg(d) {
  const modeloNome = d.modelo === 'premium' ? 'Premium' : d.modelo === 'iniciante' ? 'Iniciante' : 'Padrao'
  const bg = d.modelo === 'premium' ? '#101820' : d.modelo === 'iniciante' ? '#16312b' : '#18212f'
  const accent = d.modelo === 'premium' ? '#35d07f' : d.modelo === 'iniciante' ? '#f0c85a' : '#38bdf8'
  const soft = d.modelo === 'premium' ? '#e9fff3' : d.modelo === 'iniciante' ? '#fff7dc' : '#e7f7ff'
  const h1 = quebrarLinhaSvg(`${d.negocio} com presenca profissional no Google`, 18, 4)
  const sub = quebrarLinhaSvg('Uma pagina clara para mostrar seus servicos, passar confianca e levar o cliente direto para o WhatsApp.', 55, 3)
  const servs = d.servicos.slice(0, 4)
  const imgTags = d.imagens.slice(0, 3).map((img, i) => {
    const x = i === 0 ? 604 : i === 1 ? 604 : 822
    const y = i === 0 ? 998 : 1148
    const w = i === 0 ? 436 : 204
    const h = i === 0 ? 132 : 104
    return `<image href="data:${escapeXml(img.media_type)};base64,${img.data}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${i})"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="none" stroke="#dce3ec"/>`
  }).join('')
  const placeholderTags = d.imagens.length ? '' : `
    <rect x="604" y="998" width="436" height="132" rx="18" fill="url(#photoGrad)"/><text x="822" y="1072" text-anchor="middle" font-size="24" font-weight="700" fill="#e2e8f0">Foto do trabalho</text>
    <rect x="604" y="1148" width="204" height="104" rx="18" fill="url(#photoGrad)"/><text x="706" y="1207" text-anchor="middle" font-size="22" font-weight="700" fill="#e2e8f0">Antes</text>
    <rect x="822" y="1148" width="218" height="104" rx="18" fill="url(#photoGrad)"/><text x="931" y="1207" text-anchor="middle" font-size="22" font-weight="700" fill="#e2e8f0">Depois</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="heroGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/><stop offset="48%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
    <linearGradient id="photoGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#172033"/><stop offset="100%" stop-color="#475569"/></linearGradient>
    <clipPath id="clip0"><rect x="604" y="998" width="436" height="132" rx="18"/></clipPath>
    <clipPath id="clip1"><rect x="604" y="1148" width="204" height="104" rx="18"/></clipPath>
    <clipPath id="clip2"><rect x="822" y="1148" width="218" height="104" rx="18"/></clipPath>
  </defs>
  <rect width="1080" height="1350" fill="#ffffff"/>
  <rect width="1080" height="760" fill="${bg}"/>
  <rect width="1080" height="760" fill="url(#heroGlow)"/>
  <rect x="76" y="54" width="42" height="42" rx="12" fill="${accent}"/>
  <text x="132" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#ffffff">${escapeXml(d.negocio)}</text>
  <text x="684" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Servicos</text>
  <text x="796" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Projetos</text>
  <text x="914" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Contato</text>
  <rect x="782" y="150" width="228" height="66" rx="22" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.28"/>
  <text x="896" y="192" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="24" fill="#ffffff">Modelo ${escapeXml(modeloNome)}</text>
  <text x="76" y="166" font-family="Inter, Arial, Helvetica, sans-serif" font-size="25" letter-spacing="3" font-weight="700" fill="${accent}">${escapeXml(d.cidade.toUpperCase())}</text>
  ${h1.map((line, i) => `<text x="76" y="${256 + i * 76}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="76" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`).join('')}
  ${sub.map((line, i) => `<text x="76" y="${590 + i * 40}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="31" fill="#d7e0ec">${escapeXml(line)}</text>`).join('')}
  <rect x="76" y="650" width="338" height="78" rx="18" fill="${accent}"/>
  <text x="245" y="700" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="30" font-weight="900" fill="#07130f">Chamar no WhatsApp</text>
  <rect x="0" y="760" width="1080" height="88" fill="#f8fafc"/>
  <line x1="0" y1="848" x2="1080" y2="848" stroke="#e2e8f0"/>
  <text x="76" y="816" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="900" fill="#f59e0b">★★★★★</text>
  <text x="244" y="816" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="900" fill="#172033">31 clientes atendidos · Aparece no Google</text>
  <rect x="76" y="892" width="492" height="394" rx="18" fill="#ffffff" stroke="#dce3ec"/>
  <text x="104" y="960" font-family="Inter, Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#172033">O que entraria</text>
  ${servs.map((s, i) => `<rect x="104" y="${996 + i * 66}" width="436" height="54" rx="14" fill="${soft}"/><text x="126" y="${1031 + i * 66}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#172033">${escapeXml(s)}</text>`).join('')}
  <text x="104" y="1244" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="800" fill="#172033">${escapeXml(d.total ? `Modelo ${modeloNome}: ${d.total}` : `Modelo ${modeloNome}: previa visual`)}</text>
  ${d.entrada && d.parcela ? `<text x="104" y="1274" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" fill="#566579">${escapeXml(`${d.entrada} + 3x ${d.parcela}`)}</text>` : ''}
  <rect x="576" y="892" width="492" height="394" rx="18" fill="#ffffff" stroke="#dce3ec"/>
  <text x="604" y="960" font-family="Inter, Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#172033">Fotos e prova visual</text>
  ${imgTags || placeholderTags}
  <g transform="translate(58 1200) rotate(-6)">
    <rect x="0" y="0" width="445" height="70" rx="12" fill="#f59e0b" stroke="#111827" stroke-width="4"/>
    <text x="222" y="47" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="29" font-weight="900" fill="#111827">MODELO DE DEMONSTRACAO</text>
  </g>
  <rect x="0" y="1272" width="1080" height="78" fill="#101820"/>
  <text x="76" y="1322" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#ffffff">PJ Codeworks</text>
  <text x="252" y="1322" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" fill="#e5e7eb">Este e um modelo. O site real fica com o mesmo nivel de acabamento.</text>
  <text x="1004" y="1322" text-anchor="end" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#35d07f">${escapeXml(d.phone ? `WhatsApp ${d.phone}` : 'Botao WhatsApp')}</text>
</svg>`
}

function carregarPlaywrightOpcional() {
  try {
    return require('playwright')
  } catch (_) {
    return null
  }
}

async function renderizarPreviewSiteImagem(html, svgFallback) {
  const pw = carregarPlaywrightOpcional()
  if (!pw || !pw.chromium) {
    return {
      b64: Buffer.from(svgFallback, 'utf8').toString('base64'),
      mimetype: 'image/svg+xml',
      renderer: 'svg-fallback',
    }
  }
  let browser = null
  try {
    browser = await pw.chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'networkidle' })
    const buf = await page.screenshot({ type: 'png', fullPage: false })
    return { b64: buf.toString('base64'), mimetype: 'image/png', renderer: 'playwright' }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

async function gerarWireframeComGPT(dados, estilo = 'lapis') {
  if (!OPENAI_KEY) throw new Error('OPENAI_KEY nao configurada')
  const prompt = montarPromptWireframe(dados, estilo)
  const { data } = await axios.post(
    'https://api.openai.com/v1/images/generations',
    {
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1536',
      quality: 'medium',
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }
  )
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('gpt-image-2 nao retornou imagem')
  return { b64, mimetype: 'image/png', renderer: `gpt-image-2-${estilo}` }
}

async function gerarPreviewSite(numero, perfil, historico, opcoes = {}) {
  const dados = dadosPreviewSite(numero, perfil, historico, opcoes)
  if (OPENAI_KEY) {
    try {
      const estilo = escolherEstiloWireframe(dados, opcoes)
      const imagem = await gerarWireframeComGPT(dados, estilo)
      return { ...imagem, html: null, dados }
    } catch (err) {
      console.error('gpt-image-2 falhou, usando fallback HTML:', err.message)
    }
  } else {
    console.warn('OPENAI_KEY ausente; preview de site usando fallback HTML/SVG')
  }

  const html = montarPreviewSiteHtml(dados)
  const svg = montarPreviewSiteSvg(dados)
  const imagem = await renderizarPreviewSiteImagem(html, svg)
  return { ...imagem, html, dados }
}

async function enviarImagemBase64(numero, b64, mimetype, legenda, rotulo = 'imagem') {
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  if (!phone || !b64) throw new Error(`Imagem invalida para envio (${rotulo})`)
  const { data } = await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
    {
      number: phone,
      mediatype: 'image',
      mimetype: mimetype || 'image/png',
      media: b64,
      caption: legenda || '',
    },
    { headers: { apikey: EVOLUTION_KEY } }
  )
  assertEvolutionEnvioOk(data, `sendMedia(${rotulo})`)
  return true
}

async function gerarEEnviarPreviewSite(numero, perfil, historico, opcoes = {}) {
  const preview = await gerarPreviewSite(numero, perfil, historico, opcoes)
  await enviarImagemBase64(numero, preview.b64, preview.mimetype, null, 'preview-site')
  await registrarEventoComercial(numero, 'recebeu_preview', {
    modelo: preview.dados.modelo,
    renderer: preview.renderer,
    com_fotos: preview.dados.imagens.length > 0,
  })
  const msgPosPreview = gerarMensagemPosPreview(perfil)
  if (msgPosPreview) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await enviarMensagem(numero, msgPosPreview)
    } catch (err) {
      console.error('Falha ao enviar mensagem pos-preview:', err?.message || err)
    }
  }
  console.log(`Preview de site enviado para ${String(numero).slice(0, 24)} (${preview.renderer})`)
  return preview
}

function gerarMensagemPosPreview(perfil = {}) {
  const negocio = String(perfil?.negocio || '').trim().toLowerCase()
  if (negocio.includes('pint')) {
    return 'Essa e a direcao da sua presenca online. O que voce achou? Ficou claro seu servico e o caminho pro cliente chamar no WhatsApp?'
  }
  return 'Essa e a direcao. O que voce achou? Ficou claro o que voce faz e como o cliente chama no WhatsApp?'
}

// ─── MÍDIA WHATSAPP (Evolution + Claude / Whisper) ─────────────────────────────

function limparBase64String(s) {
  if (!s || typeof s !== 'string') return ''
  const u = s.trim()
  const m = u.match(/^data:[^;]+;base64,(.+)$/is)
  return (m ? m[1] : u).replace(/\s/g, '')
}

function extrairBase64DaRespostaEvolution(data) {
  if (data == null) return null
  if (typeof data === 'string') return data
  if (typeof data.base64 === 'string') return data.base64
  if (data.data != null && typeof data.data === 'string') return data.data
  return null
}

/** Tipos aceitos pela API Anthropic para imagens. */
function mimeImagemParaClaude(mimetype) {
  if (!mimetype || typeof mimetype !== 'string') return 'image/jpeg'
  const base = mimetype.split(';')[0].trim().toLowerCase()
  if (base === 'image/jpg') return 'image/jpeg'
  const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (ok.includes(base)) return base
  return null
}

async function evolutionObterBase64Midia(webMessageInfo) {
  const url = `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${INSTANCE_NAME}`
  const { data } = await axios.post(
    url,
    { message: webMessageInfo, convertToMp4: false },
    { headers: { apikey: EVOLUTION_KEY }, timeout: 120000 }
  )
  assertEvolutionEnvioOk(data, 'getBase64FromMediaMessage')
  const b64 = extrairBase64DaRespostaEvolution(data)
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Resposta Evolution sem base64')
  }
  return b64
}

async function transcreverAudioLocal(buffer, filename, mimetype) {
  const form = new FormData()
  form.append('file', buffer, { filename, contentType: mimetype || 'application/octet-stream' })
  const { data } = await axios.post(`${WHISPER_SERVICE_URL}/transcribe`, form, {
    headers: form.getHeaders(),
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })
  return typeof data?.text === 'string' ? data.text : ''
}

function localizarAudioPartMensagem(msg) {
  return msg?.message?.audioMessage || null
}

async function registrarAudioProcessamento(numero, messageKey, msg, audioPart, patch = {}) {
  const status = ['pending', 'processed', 'failed'].includes(patch.status) ? patch.status : 'pending'
  const erro = patch.erro ? resumirTextoOperacional(patch.erro, 800) : null
  const transcricao = typeof patch.transcricao === 'string' && patch.transcricao.trim() ? patch.transcricao.trim() : null
  const mimetype = patch.mimetype || audioPart?.mimetype || null
  const payload = msg && typeof msg === 'object' ? JSON.stringify(msg) : null
  const key = messageKey || null
  const { rows } = await pool.query(
    `INSERT INTO vendas.audio_processamentos
       (numero, message_key, web_message_info, mimetype, status, attempts, erro, transcricao, processado_em)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, CASE WHEN $5 = 'processed' THEN NOW() ELSE NULL END)
     ON CONFLICT (message_key) DO UPDATE
     SET web_message_info = COALESCE(EXCLUDED.web_message_info, vendas.audio_processamentos.web_message_info),
         mimetype = COALESCE(EXCLUDED.mimetype, vendas.audio_processamentos.mimetype),
         status = EXCLUDED.status,
         attempts = vendas.audio_processamentos.attempts + EXCLUDED.attempts,
         erro = EXCLUDED.erro,
         transcricao = COALESCE(EXCLUDED.transcricao, vendas.audio_processamentos.transcricao),
         processado_em = CASE WHEN EXCLUDED.status = 'processed' THEN NOW() ELSE vendas.audio_processamentos.processado_em END,
         atualizado_em = NOW()
     RETURNING id, numero, message_key, status, attempts, erro, transcricao, criado_em, atualizado_em, processado_em`,
    [numero, key, payload, mimetype, status, patch.incrementAttempt ? 1 : 0, erro, transcricao]
  )
  return rows[0]
}

async function baixarETranscreverAudioMensagem(msg, audioPart) {
  if (!audioPart) throw new Error('Mensagem sem audioMessage')
  const b64 = await evolutionObterBase64Midia(msg)
  const rawB64 = limparBase64String(b64)
  if (!rawB64) throw new Error('Audio sem base64 retornado pela Evolution')
  const buf = Buffer.from(rawB64, 'base64')
  const mimeFull = (audioPart.mimetype || 'audio/ogg').split(';')[0].trim()
  const ext =
    /mp4|m4a/i.test(mimeFull) ? 'm4a' : /mpeg|mp3/i.test(mimeFull) ? 'mp3' : 'ogg'
  const transcricao = await transcreverAudioLocal(buf, `audio.${ext}`, mimeFull)
  if (!transcricao || !transcricao.trim()) throw new Error('Whisper retornou transcricao vazia')
  return { transcricao: transcricao.trim(), mimetype: mimeFull, bytes: buf.length }
}

async function processarImagemWebhook(msg, part, textoBase, isSticker, remetenteCliente = true) {
  const caption = (part.caption || '').trim()
  const partes = [textoBase, caption].filter((s) => s && s.length)
  const fallbackSticker = remetenteCliente ? 'O cliente enviou uma figurinha.' : 'O operador enviou uma figurinha.'
  const fallbackImage = remetenteCliente ? 'O cliente enviou uma imagem.' : 'O operador enviou uma imagem.'
  let texto = partes.join('\n\n') || (isSticker ? fallbackSticker : fallbackImage)
  const mimeRaw = (part.mimetype || 'image/jpeg').split(';')[0].trim()
  const mime = mimeImagemParaClaude(mimeRaw)
  if (!mime) {
    texto += `\n\n[Imagem em formato não suportado para análise automática: ${mimeRaw}]`
    return { texto: texto.trim(), visao: null }
  }
  let rawB64 = ''
  try {
    const b64 = await evolutionObterBase64Midia(msg)
    rawB64 = limparBase64String(b64)
  } catch (e) {
    console.error('Imagem Evolution:', e.message)
    texto += '\n\n[Não foi possível baixar a imagem para análise.]'
    return { texto: texto.trim(), visao: null }
  }
  if (!rawB64) {
    texto += '\n\n[Mídia vazia.]'
    return { texto: texto.trim(), visao: null }
  }
  let bufLen = 0
  try {
    bufLen = Buffer.from(rawB64, 'base64').length
  } catch (_) {}
  if (bufLen > MAX_IMAGEM_BYTES_CLAUDE) {
    texto += `\n\n[Imagem muito grande (${Math.round(bufLen / 1024)} KB) para análise automática.]`
    return { texto: texto.trim(), visao: null }
  }
  return { texto: texto.trim(), visao: { media_type: mime, data: rawB64 } }
}

async function processarAudioWebhook(msg, audioPart, textoBase, remetenteCliente = true) {
  const numeroAudio = canonicoRemoteJidParaConversa(msg?.key) || msg?.key?.remoteJid || null
  const messageKeyAudio = construirChaveIdempotenciaWebhookMensagem(msg)
  const fallbackAudio =
    remetenteCliente
      ? '[Audio recebido - nao foi possivel baixar/transcrever. Peca ao cliente para repetir ou enviar em texto.]'
      : '[Audio recebido - nao foi possivel baixar/transcrever. Peca ao operador para repetir ou enviar em texto.]'
  try {
    const rAudio = await baixarETranscreverAudioMensagem(msg, audioPart)
    if (numeroAudio) {
      await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
        status: 'processed',
        transcricao: rAudio.transcricao,
        mimetype: rAudio.mimetype,
        incrementAttempt: true,
      }).catch((e) => console.warn('Audio processado nao registrado:', e.message))
    }
    const linhasAudio = []
    if (textoBase) linhasAudio.push(textoBase)
    linhasAudio.push(`[Audio transcrito] ${rAudio.transcricao}`)
    return { texto: linhasAudio.filter(Boolean).join('\n\n'), visao: null }
  } catch (eAudio) {
    console.error('Audio/Whisper:', eAudio.response?.data || eAudio.message)
    if (numeroAudio) {
      await registrarAudioProcessamento(numeroAudio, messageKeyAudio, msg, audioPart, {
        status: 'pending',
        erro: eAudio.message || String(eAudio),
        incrementAttempt: true,
      }).catch((e2) => console.warn('Audio pendente nao registrado:', e2.message))
    }
    return { texto: textoBase || fallbackAudio, visao: null }
  }
  let rawB64 = ''
  try {
    const b64 = await evolutionObterBase64Midia(msg)
    rawB64 = limparBase64String(b64)
  } catch (e) {
    console.error('Áudio Evolution:', e.message)
    const fallback =
      remetenteCliente
        ? '[Áudio recebido — não foi possível baixar. Peça ao cliente para repetir ou enviar em texto.]'
        : '[Áudio recebido — não foi possível baixar. Peça ao operador para repetir ou enviar em texto.]'
    const texto = textoBase || fallback
    return { texto, visao: null }
  }
  if (!rawB64) {
    const texto = textoBase || '[Áudio recebido — mídia vazia.]'
    return { texto, visao: null }
  }
  const buf = Buffer.from(rawB64, 'base64')
  const mimeFull = (audioPart.mimetype || 'audio/ogg').split(';')[0].trim()
  const ext =
    /mp4|m4a/i.test(mimeFull) ? 'm4a' : /mpeg|mp3/i.test(mimeFull) ? 'mp3' : 'ogg'

  let transcricao = ''
  try {
    transcricao = await transcreverAudioLocal(buf, `audio.${ext}`, mimeFull)
  } catch (e) {
    console.error('Whisper local:', e.response?.data || e.message)
  }

  const linhas = []
  if (textoBase) linhas.push(textoBase)
  if (transcricao.trim()) {
    linhas.push(`[Áudio transcrito] ${transcricao.trim()}`)
  } else {
    linhas.push('[Áudio recebido — não foi possível transcrever.]')
  }
  return { texto: linhas.filter(Boolean).join('\n\n'), visao: null }
}

/**
 * Texto para persistir no histórico + visão opcional para o último turno no Claude.
 * @param {object} [opts]
 * @param {boolean} [opts.remetenteCliente=true] — false quando a mídia vem do operador (fromMe) no chat com o lead.
 */
/**
 * Extrai o texto de respostas interativas (list message e button response).
 * Retorna o rowId/buttonId como texto, ou null se não for interativo.
 * Isso permite que a lógica de roteamento do operador (1–6) funcione
 * tanto para mensagens digitadas quanto para toques em botões/listas.
 */
function extrairTextoInterativo(m) {
  if (!m) return null
  // Resposta de lista (List Message) — usuário tocou num item
  const rowId =
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.listResponseMessage?.selectedRowId
  if (rowId) return String(rowId)
  // Resposta de botão (Button Message / Template) — usuário tocou num botão
  const btnId =
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId
  if (btnId) return String(btnId)
  return null
}

async function extrairTextoEMidiaDoWebhook(msg, opts = {}) {
  const remetenteCliente = opts.remetenteCliente !== false
  const m = msg?.message
  if (!m) {
    return { texto: null, visao: null }
  }

  // Interações com lista ou botões têm prioridade sobre texto livre
  const textoInterativo = extrairTextoInterativo(m)
  if (textoInterativo) return { texto: textoInterativo, visao: null }

  const textoBase = stripCitacaoWhatsappTexto(
    (m.conversation || m.extendedTextMessage?.text || '').trim()
  )

  if (m.imageMessage) {
    return processarImagemWebhook(msg, m.imageMessage, textoBase, false, remetenteCliente)
  }
  if (m.stickerMessage) {
    return processarImagemWebhook(msg, m.stickerMessage, textoBase, true, remetenteCliente)
  }
  if (m.documentMessage?.mimetype?.startsWith('image/')) {
    return processarImagemWebhook(msg, m.documentMessage, textoBase, false, remetenteCliente)
  }
  if (m.audioMessage) {
    return processarAudioWebhook(msg, m.audioMessage, textoBase, remetenteCliente)
  }

  if (textoBase) return { texto: textoBase, visao: null }
  return { texto: null, visao: null }
}

// ─── EVOLUTION API ────────────────────────────────────────────────────────────

/** Quando `exists: false`, o WhatsApp não reconhece o número (inválido, sem app ou checagem falhou). */
function evolutionDetalheNumeroInexistente(data) {
  if (!data || typeof data !== 'object') return null
  const arr = data.response?.message
  if (!Array.isArray(arr)) return null
  return arr.find((x) => x && x.exists === false) || null
}

/** Evolution costuma responder HTTP 200 com `{ success: false }` no corpo — tratar como falha. */
function evolutionCorpoIndicaFalha(data) {
  return data != null && typeof data === 'object' && data.success === false
}

function evolutionMensagemErroDoCorpo(data) {
  if (!data || typeof data !== 'object') return 'success:false'
  const m = data.message || data.error || data.msg
  if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 400)
  try {
    return JSON.stringify(data).slice(0, 500)
  } catch (_) {
    return 'success:false'
  }
}

function assertEvolutionEnvioOk(data, rotulo) {
  if (evolutionCorpoIndicaFalha(data)) {
    throw new Error(`${rotulo}: Evolution retornou success:false — ${evolutionMensagemErroDoCorpo(data)}`)
  }
}

async function enviarMensagem(numero, texto) {
  const t = (texto || '').trim()
  if (!t) throw new Error('Texto vazio para envio ao WhatsApp')
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  if (!phone) throw new Error('Número/JID inválido para envio')
  try {
    const r = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
      { number: phone, text: t },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(r.data, 'sendText')
    return r.data
  } catch (e) {
    const det = e.response?.data
    console.error('❌ Evolution sendText:', e.response?.status, typeof det === 'object' ? JSON.stringify(det) : det)
    throw e
  }
}

/**
 * Mapa de prints autorizados para envio automático ao lead.
 * Chave = valor do campo `enviar_print` no JSON da IA.
 * Valor = caminho relativo a partir da raiz do projeto.
 */
const PRINTS_AUTORIZADOS = {
  '874-analytics': 'knowledge/prints/874-analytics-30d.png',
  'modelos-site': 'knowledge/prints/modelos-site-3-tiers.png',
  'planos-mensais': 'knowledge/prints/planos-mensais.png',
}

/**
 * Envia uma imagem local ao lead via Evolution API (sendMedia base64).
 * Retorna true se enviou, false se o arquivo não existir (sem lançar erro).
 */
async function enviarPrintLocal(numero, chave, legenda) {
  const caminho = PRINTS_AUTORIZADOS[chave]
  if (!caminho) {
    console.warn(`⚠️ enviar_print: chave não reconhecida "${chave}"`)
    return false
  }
  const caminhoAbs = require('path').resolve(__dirname, caminho)
  const fs = require('fs')
  if (!fs.existsSync(caminhoAbs)) {
    console.warn(`⚠️ enviar_print: arquivo não encontrado em ${caminhoAbs} — ignorando envio de imagem`)
    return false
  }
  const b64 = fs.readFileSync(caminhoAbs).toString('base64')
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  try {
    const { data } = await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
      {
        number: phone,
        mediatype: 'image',
        mimetype: 'image/png',
        media: b64,
        caption: legenda || '',
      },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(data, 'sendMedia(print)')
    console.log(`🖼️ Print "${chave}" enviado ao lead ${phone}`)
    return true
  } catch (e) {
    const det = e.response?.data
    console.error('❌ Evolution sendMedia (print):', e.response?.status, typeof det === 'object' ? JSON.stringify(det) : det)
    return false
  }
}

/**
 * Envia texto ao WhatsApp do Victor (VICTOR_WHATSAPP ou OPERATOR_WHATSAPP).
 * @returns {Promise<boolean>} true se enviou
 */
async function notificarVictorWhatsapp(texto) {
  const jid = jidVictorParaNotificacoes()
  if (!jid) return false
  const t = String(texto || '').trim()
  if (!t) return false
  try {
    await enviarMensagem(jid, t)
    return true
  } catch (e) {
    console.error('❌ WhatsApp Victor (alerta):', e.message)
    return false
  }
}

function deveAlertarFalhaResposta(numero, falha) {
  const assinatura = `${falha?.codigo || 'desconhecido'}|${mensagemFalhaRespostaParaPersistencia(falha) || ''}`
  const atual = Date.now()
  const prev = alertaFalhaRespostaPorJid.get(numero)
  if (prev && prev.assinatura === assinatura && atual - prev.timestamp < ALERTA_FALHA_RESPOSTA_DEDUPE_MS) {
    return false
  }
  alertaFalhaRespostaPorJid.set(numero, { assinatura, timestamp: atual })
  return true
}

async function alertarFalhaResposta(numero, falha) {
  if (!deveAlertarFalhaResposta(numero, falha)) return false
  const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  const detalhe = resumirTextoOperacional(falha?.detalhe || falha?.resumo || '', 280)
  const texto =
    `⚠️ Falha de resposta automática — PJ Codeworks\n` +
    `Lead: ${phone || numero}\n` +
    `Código: ${falha?.codigo || 'resposta_falhou'}\n` +
    `Resumo: ${falha?.resumo || 'falha ao gerar ou enviar resposta'}\n` +
    `Detalhe: ${detalhe || 'sem detalhe adicional'}\n` +
    `Ação sugerida: revisar no dashboard e usar Reenviar resposta se fizer sentido.`
  const enviou = await notificarVictorWhatsapp(texto)
  if (enviou) {
    console.log('📲 Falha de resposta notificada ao Victor (WhatsApp):', falha?.codigo || 'resposta_falhou')
  }
  return enviou
}

function extrairBotoes(texto) {
  const fraseCurta = texto.match(/\b(pix|cartão|segunda|quinta|suporte|crescimento|essa semana|semana que vem|entrada|parcel\w+)\b.{0,30}\bou\b.{0,30}\b(pix|cartão|segunda|quinta|suporte|crescimento|essa semana|semana que vem|entrada|parcel\w+)\b/i)
  if (fraseCurta) {
    const partes = fraseCurta[0].split(/\bou\b/i)
    if (partes.length === 2) {
      const op1 = partes[0].trim().replace(/[^a-zA-ZÀ-ú\s]/g, '').trim().substring(0, 20)
      const op2 = partes[1].trim().replace(/[^a-zA-ZÀ-ú\s]/g, '').trim().substring(0, 20)
      if (op1.length > 2 && op2.length > 2) return [op1, op2]
    }
  }
  return null
}

async function enviarComBotoes(numero, texto, botoes) {
  const numLimpo = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  const t = (texto || '').trim()
  if (!numLimpo || !t) throw new Error('Número ou texto inválido para envio com botões')
  const r0 = await axios.post(
    `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
    { number: numLimpo, text: t },
    { headers: { apikey: EVOLUTION_KEY } }
  )
  assertEvolutionEnvioOk(r0.data, 'sendText(botoes)')
  try {
    const r1 = await axios.post(
      `${EVOLUTION_URL}/message/sendButtons/${INSTANCE_NAME}`,
      {
        number: numLimpo,
        title: 'Escolha uma opção',
        description: 'Toque para responder',
        footer: 'PJ Codeworks',
        buttons: botoes.map((b, i) => ({ type: 'reply', displayText: b, id: `opt_${i + 1}` }))
      },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(r1.data, 'sendButtons')
    console.log('✅ Botões enviados:', botoes)
  } catch (_) {
    console.log('⚠️  Botões não suportados, texto já enviado')
  }
}

function reprocessarAutorizado(req) {
  // REPROCESS_SECRET é garantido pelo validarSecretsBoot — se ausente, processo aborta no boot.
  // Antes permitia fallback "return true" se secret faltasse; removido em 2026-04-23 porque
  // abria o dashboard inteiro quando admin esquecesse de configurar.
  const secret = process.env.REPROCESS_SECRET
  if (!secret) return false
  return req.headers['x-reprocess-secret'] === secret
}

function webhookAutorizado(req) {
  return reprocessarAutorizado(req)
}

/** Atualizar apelido de um lead (dashboard). */
app.post('/dashboard/apelido', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  const apelidoRaw = typeof req.body?.apelido === 'string' ? req.body.apelido.trim() : ''
  if (apelidoRaw.length > 80) {
    return res.status(400).json({ ok: false, erro: 'Apelido deve ter no maximo 80 caracteres' })
  }
  const apelido = apelidoRaw || null
  
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const { rows } = await pool.query(
      `INSERT INTO vendas.lead_profiles (numero, apelido, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (numero) DO UPDATE
       SET apelido = EXCLUDED.apelido,
           atualizado_em = NOW()
       RETURNING numero, apelido`,
      [jid, apelido]
    )
    res.json({ ok: true, numero: rows[0].numero, apelido: rows[0].apelido })
  } catch (err) {
    console.error('[Dashboard] Erro ao atualizar apelido:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados' })
  }
})

/** Arquivar ou desarquivar conversa (dashboard). */
app.post('/dashboard/arquivar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  const arquivado = !!req.body?.arquivado
  const motivoRaw = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : ''
  const motivo = arquivado ? (motivoRaw || 'arquivado_manual') : null
  if (motivo && motivo.length > 120) {
    return res.status(400).json({ ok: false, erro: 'Motivo de arquivamento muito longo' })
  }
  
  try {
    const { rows } = await pool.query(
      `UPDATE vendas.conversas
       SET arquivado = $1,
           motivo_arquivamento = $2,
           arquivado_em = CASE WHEN $1 THEN NOW() ELSE NULL END,
           atualizado_em = NOW()
       WHERE numero = $3
       RETURNING numero, arquivado, motivo_arquivamento, arquivado_em`,
      [arquivado, motivo, jid]
    )
    if (!rows.length) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    res.json({ ok: true, conversa: rows[0] })
  } catch (err) {
    console.error('[Dashboard] Erro ao arquivar conversa:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados' })
  }
})

/** Excluir conversa e perfil de lead permanentemente (dashboard). */
app.delete('/dashboard/conversas', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  
  try {
    // Apaga do lead_profiles primeiro (para evitar erro de FK caso ON DELETE CASCADE não esteja configurado corretamente)
    await pool.query('DELETE FROM vendas.lead_profiles WHERE numero = $1', [jid])
    // Apaga de outras tabelas dependentes
    await pool.query('DELETE FROM vendas.analises_pos_conversa WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.conhecimento_lacunas WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.followup_envios WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.eventos_comerciais WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.webhook_messages_processed WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.lead_contextos WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.audio_processamentos WHERE numero = $1', [jid])
    // Apaga a conversa
    await pool.query('DELETE FROM vendas.conversas WHERE numero = $1', [jid])
    
    res.json({ ok: true })
  } catch (err) {
    console.error('[Dashboard] Erro ao excluir conversa:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados ao excluir' })
  }
})

/** Pausar ou reativar respostas automáticas do webhook para um número (dashboard). */
app.post('/dashboard/agente-pausar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.body?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  const pausado = !!req.body?.pausado
  try {
    const { rows } = await pool.query(
      `UPDATE vendas.conversas SET agente_pausado = $2, atualizado_em = NOW() WHERE numero = $1 RETURNING numero, agente_pausado`,
      [jid, pausado]
    )
    if (!rows.length) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada (ainda não há histórico com esse número)' })
    }
    if (pausado) await cancelarFollowupsAutoPendentes(jid, 'agente_pausado')
    res.json({ ok: true, numero: rows[0].numero, agente_pausado: rows[0].agente_pausado })
  } catch (err) {
    console.error('❌ agente-pausar:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * User part pode vir como `5511999999999` ou `5511999999999:8` (índice de dispositivo).
 * Só o trecho antes do primeiro `:` é o telefone.
 */
/** Disparo manual de previa visual pelo operador. Auth: x-reprocess-secret. */
app.post('/api/operador/preview-site', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const modeloRaw = req.body?.modelo == null || req.body.modelo === '' ? null : String(req.body.modelo).trim().toLowerCase()
  const modelo = PREVIEW_SITE_MODELOS.has(modeloRaw) ? modeloRaw : null
  const estiloRaw = req.body?.estilo == null || req.body.estilo === '' ? null : String(req.body.estilo).trim().toLowerCase()
  const estilo = estiloRaw === 'clean' || estiloRaw === 'lapis' ? estiloRaw : null
  try {
    const [conversa, perfil] = await Promise.all([buscarConversa(jid), buscarPerfil(jid)])
    if (!conversa) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const historico = normalizarHistoricoMensagens(conversa.historico)
    const preview = await gerarEEnviarPreviewSite(jid, perfil, historico, { modelo, estilo })
    res.json({ ok: true, modelo_usado: preview.dados.modelo, renderer: preview.renderer })
  } catch (err) {
    console.error('[Operador] preview-site:', err.response?.data || err.message)
    res.status(500).json({ ok: false, erro: err.message || 'Falha ao enviar previa' })
  }
})

function parteTelefoneDoUserJid(local) {
  if (!local || typeof local !== 'string') return ''
  const i = local.indexOf(':')
  return i === -1 ? local : local.slice(0, i)
}

/**
 * Aceita JID completo ou apenas dígitos; alinha ao formato armazenado (ex.: 5511...@s.whatsapp.net).
 * Números BR sem DDI (10–11 dígitos) recebem prefixo 55.
 */
function normalizarNumeroParaJid(raw) {
  if (raw == null || typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  let digits
  if (/@s\.whatsapp\.net/i.test(s)) {
    const local = s.split('@')[0] || ''
    digits = parteTelefoneDoUserJid(local).replace(/\D/g, '')
  } else {
    digits = s.replace(/\D/g, '')
  }
  if (!digits) return null
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = `55${digits}`
  }
  return `${digits}@s.whatsapp.net`
}

/** JID do operador principal para alertas de áudio/handoff: primeiro número de OPERATOR_WHATSAPP. */
function jidOperadorDoEnv() {
  return jidOperadoresDoEnv()[0] ?? null
}

/**
 * Parseia as entradas de OPERATOR_WHATSAPP no formato "número" ou "número:Nome".
 * Retorna array de { jid, nome }.
 * Exemplo: "5511987309724:Victor,5511888888888:Joãozinho"
 */
function _parsearEntradasOperadores() {
  const raw = process.env.OPERATOR_WHATSAPP || process.env.VICTOR_WHATSAPP || ''
  return raw
    .split(',')
    .map(s => {
      const [numPart, ...nomeParts] = s.trim().split(':')
      const jid = normalizarNumeroParaJid(numPart.trim())
      const nome = nomeParts.join(':').trim() || null
      return jid ? { jid, nome } : null
    })
    .filter(Boolean)
}

/**
 * Lista de JIDs de todos os operadores autorizados.
 * Suporta múltiplos números separados por vírgula em OPERATOR_WHATSAPP:
 *   OPERATOR_WHATSAPP="5511999999999,5511888888888"
 *   OPERATOR_WHATSAPP="5511999999999:Victor,5511888888888:Joãozinho"
 */
function jidOperadoresDoEnv() {
  return _parsearEntradasOperadores().map(e => e.jid)
}

/**
 * Retorna o nome configurado para o JID do operador.
 * Se não configurado com "número:Nome", retorna null (cai pro pushName do WhatsApp).
 */
function nomeOperadorPorJid(jid) {
  const entrada = _parsearEntradasOperadores().find(e => jidIgual(e.jid, jid))
  return entrada?.nome ?? null
}

/** JID para alertas escritos (handoff, lacunas): `VICTOR_WHATSAPP` ou fallback `OPERATOR_WHATSAPP`. */
function jidVictorParaNotificacoes() {
  const raw = process.env.VICTOR_WHATSAPP || process.env.OPERATOR_WHATSAPP
  if (raw == null || typeof raw !== 'string' || !raw.trim()) return null
  return normalizarNumeroParaJid(raw.trim())
}

function jidIgual(a, b) {
  const ja = normalizarNumeroParaJid(String(a || '').trim())
  const jb = normalizarNumeroParaJid(String(b || '').trim())
  return ja != null && jb != null && ja === jb
}

/**
 * WhatsApp pode enviar `remoteJid` como `...@lid`; o JID de telefone vem em `remoteJidAlt` (Baileys 6.8+).
 * Sem isso, o backend não bate com `vendas.conversas.numero` nem com OPERATOR_WHATSAPP.
 */
/** Garante `5511...@s.whatsapp.net` sem sufixo `:device` (Evolution/Baileys às vezes envia). */
function jidTelefoneSemSufixoDispositivo(jid) {
  if (!jid || typeof jid !== 'string') return null
  if (!/@s\.whatsapp\.net$/i.test(jid)) return jid
  const local = jid.split('@')[0] || ''
  const digits = parteTelefoneDoUserJid(local).replace(/\D/g, '')
  if (!digits) return jid
  let d = digits
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) d = `55${d}`
  return `${d}@s.whatsapp.net`
}

function canonicoRemoteJidParaConversa(key) {
  if (!key || typeof key !== 'object') return null
  const jid = key.remoteJid
  const alt = key.remoteJidAlt
  if (typeof jid === 'string' && /@s\.whatsapp\.net$/i.test(jid)) return jidTelefoneSemSufixoDispositivo(jid)
  if (typeof alt === 'string' && /@s\.whatsapp\.net$/i.test(alt)) return jidTelefoneSemSufixoDispositivo(alt)
  if (typeof jid === 'string') return jid
  return null
}

/** Conversa 1:1 com lead (exclui grupos e broadcast). Inclui `@lid` quando ainda não há PN no evento. */
function isConversaLeadUmAUm(remoteJid) {
  if (!remoteJid || typeof remoteJid !== 'string') return false
  if (/@g\.us$/i.test(remoteJid) || /@broadcast$/i.test(remoteJid)) return false
  return /@s\.whatsapp\.net$/i.test(remoteJid) || /@lid$/i.test(remoteJid)
}

/**
 * @returns {null | { tipo: 'pausar'|'retomar'|'instrucao', jidLead: string, instrucao?: string }}
 */
function parseComandoOperadorWhatsApp(texto) {
  const t = (texto || '').trim()
  if (!t) return null
  let mInstr = t.match(/^([\d\s]+?)\s+NUMERO\s+INSTRUÇÃO:\s*([\s\S]+)$/i)
  if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+NUMERO\s+INTRUÇÃO:\s*([\s\S]+)$/i)
  if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+INSTRUÇÃO:\s*([\s\S]+)$/i)
  if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+INTRUÇÃO:\s*([\s\S]+)$/i)
  if (mInstr) {
    const jidLead = normalizarNumeroParaJid(mInstr[1].trim())
    const instrucao = (mInstr[2] || '').trim()
    if (!jidLead || !instrucao) return null
    return { tipo: 'instrucao', jidLead, instrucao }
  }
  const mPausa = t.match(/^([\d\s]+?)\s+PAUSAR\s*$/i)
  if (mPausa) {
    const jidLead = normalizarNumeroParaJid(mPausa[1].trim())
    if (!jidLead) return null
    return { tipo: 'pausar', jidLead }
  }
  const mRetoma = t.match(/^([\d\s]+?)\s+RETOMAR\s*$/i)
  if (mRetoma) {
    const jidLead = normalizarNumeroParaJid(mRetoma[1].trim())
    if (!jidLead) return null
    return { tipo: 'retomar', jidLead }
  }
  const mApres = t.match(/^([\d\s]+?)\s+APRESENTA[CÇ][AÃ]O\s*$/i)
  if (mApres) {
    const jidLead = normalizarNumeroParaJid(mApres[1].trim())
    if (!jidLead) return null
    return { tipo: 'apresentacao', jidLead }
  }
  return null
}

/**
 * Normaliza texto para comparação de eco: lowercase, colapsa whitespace, trim.
 * Garante que pequenas variações de espaço/quebra de linha não quebrem a detecção.
 */
function normalizarParaComparacaoEco(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detecta se uma mensagem "fromMe" recebida pelo webhook é eco da própria
 * mensagem que o agente acabou de enviar. Evolution às vezes reenvia como
 * webhook o que a gente próprio mandou; sem este filtro, cada turno do agente
 * era gravado duas vezes no histórico (uma como assistant, outra como operator)
 * E o agente ficava auto-pausado sem motivo.
 *
 * Critério: texto normalizado bate exato com alguma das últimas N mensagens
 * assistant do histórico (janela pequena — mensagens muito antigas não contam).
 */
function ehEcoDoAgente(textoIncoming, historico) {
  if (!textoIncoming || !Array.isArray(historico) || historico.length === 0) return false
  const alvo = normalizarParaComparacaoEco(textoIncoming)
  if (!alvo) return false
  const JANELA = 6
  const ultimas = historico.slice(-JANELA)
  for (const m of ultimas) {
    if (!m || m.role !== 'assistant') continue
    const c = normalizarParaComparacaoEco(m.content)
    if (!c) continue
    if (c === alvo) return true
    // Tolerância: uma das strings contém a outra completamente (caso de bolhas enviadas
    // concatenadas no assistant mas recebidas como bolha única em webhook ou vice-versa)
    if (c.length > 20 && alvo.length > 20 && (c.includes(alvo) || alvo.includes(c))) return true
  }
  return false
}

async function processarIntervencaoOperadorNoLead(msg, numero) {
  const { texto } = await extrairTextoEMidiaDoWebhook(msg, { remetenteCliente: false })
  const textoHistorico =
    texto || (msg.message?.imageMessage || msg.message?.audioMessage ? '(Operador enviou mídia.)' : null)
  if (!textoHistorico) return

  // Carrega historico primeiro para checar se é eco do proprio agente
  let conversa = await buscarConversa(numero)
  let historico = normalizarHistoricoMensagens(conversa?.historico)

  if (texto && ehEcoDoAgente(texto, historico)) {
    console.log(`🔁 Ignorado eco do agente em ${numero} (fromMe bate com último assistant do histórico)`)
    return
  }

  const logLinha = textoHistorico.length > 200 ? `${textoHistorico.slice(0, 200)}…` : textoHistorico
  console.log(`👤 [operador→lead] ${numero}: ${logLinha}`)

  let estagio = conversa?.estagio || 'primeiro_contato'
  historico.push({ role: 'operator', content: textoHistorico })
  if (historico.length > 40) historico = historico.slice(-40)

  await salvarConversa(numero, historico, estagio, conversa?.status || 'ativo', true)
  await cancelarFollowupsAutoPendentes(numero, 'operador_interveio')
  limparDebounceResposta(numero)
  console.log(`⏸️ Agente pausado automaticamente após intervenção em ${numero}`)
}

/** Regex que detecta cumprimentos e mensagens de abertura de conversa. */
const REGEX_CUMPRIMENTO_OPERADOR =
  /^(oi|olá|ola|oioi|opa|e aí|eae|eaê|eai|hey|hello|hi|bom dia|boa tarde|boa noite|tudo bem|tudo bom|me responde|alô|alo|salve|fala|falou|menu|opções|opcoes|ajuda|help)\b/i

/** Monta o texto do menu de 6 ações do operador (fallback texto plano). */
function montarMenuOperador(nome) {
  return [
    `Oi, ${nome}! O que você quer fazer agora? 👇`,
    '',
    '1️⃣ Responder lead — orientar o agente',
    '2️⃣ Enviar apresentação — modelos + planos para lead',
    '3️⃣ Agendamentos — ver reuniões marcadas',
    '4️⃣ Simular abordagem — treinar o script',
    '5️⃣ Relatório do dia — resumo de leads',
    '6️⃣ Ajustar configuração — regras e scripts',
    '',
    'Responda com o número da opção desejada 👆',
  ].join('\n')
}

/**
 * Envia o menu de ações como lista interativa (botão "Ver opções").
 * Se a API não suportar sendList (ex.: número com @lid), cai em texto plano.
 */
async function enviarMenuListaOperador(jidOperador, nome) {
  const numLimpo = String(jidOperador).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')

  // sendList e sendButtons são bloqueados pelo WhatsApp em conexões Baileys (API não oficial).
  // Menu em texto numerado é o único formato confiável.
  await enviarMensagem(jidOperador, montarMenuOperador(nome))
}

/** Consulta DB e retorna texto com agendamentos dos leads em estágio handoff. */
async function textoAgendamentosOperador() {
  try {
    const res = await pool.query(
      `SELECT c.numero, c.estagio, c.atualizado_em,
              p.negocio, p.cidade, p.temperatura_lead
       FROM vendas.conversas c
       LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
       WHERE c.estagio IN ('handoff', 'proposta_enviada', 'negociacao')
         AND c.status = 'ativo'
       ORDER BY c.atualizado_em DESC
       LIMIT 10`
    )
    if (res.rows.length === 0) return '📅 Nenhum lead em etapa de reunião/proposta no momento.'
    const linhas = res.rows.map(r => {
      const num = String(r.numero).replace(/@s\.whatsapp\.net$/i, '')
      const neg = r.negocio || 'sem info'
      const cid = r.cidade || ''
      const temp = r.temperatura_lead ? ` 🌡️ ${r.temperatura_lead}` : ''
      const data = r.atualizado_em ? new Date(r.atualizado_em).toLocaleDateString('pt-BR') : ''
      return `• ${neg}${cid ? ` | ${cid}` : ''}${temp} — ${num} (${data})`
    })
    return `📅 *Leads em reunião/proposta (${res.rows.length}):*\n\n${linhas.join('\n')}`
  } catch (e) {
    console.error('❌ Agendamentos operador:', e.message)
    return '❌ Não foi possível consultar os agendamentos agora.'
  }
}

/** Consulta DB e retorna texto com relatório do dia. */
async function textoRelatorioOperador() {
  try {
    const res = await pool.query(
      `SELECT c.numero, c.estagio, c.status, c.venda_fechada, c.agente_pausado,
              c.atualizado_em, p.negocio, p.cidade, p.temperatura_lead,
              p.termometro_dor, p.score_dor
       FROM vendas.conversas c
       LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
       WHERE c.atualizado_em >= NOW() - INTERVAL '24 hours'
       ORDER BY c.atualizado_em DESC
       LIMIT 15`
    )
    if (res.rows.length === 0) return '📊 Nenhuma conversa atualizada nas últimas 24h.'
    const fechados = res.rows.filter(r => r.venda_fechada)
    const ativos = res.rows.filter(r => !r.venda_fechada && r.status === 'ativo')
    const pausados = res.rows.filter(r => r.agente_pausado)

    const linhaLead = r => {
      const num = String(r.numero).replace(/@s\.whatsapp\.net$/i, '')
      const neg = r.negocio ? `${r.negocio}${r.cidade ? ` | ${r.cidade}` : ''}` : num
      const temp = r.temperatura_lead ? ` 🌡️ ${r.temperatura_lead}` : ''
      const dor = r.termometro_dor != null ? ` dor:${r.termometro_dor}/10` : ''
      return `  • ${neg}${temp}${dor}`
    }

    const partes = [`📊 *Relatório — últimas 24h (${res.rows.length} leads):*`]
    if (fechados.length) partes.push(`\n✅ *Vendas fechadas (${fechados.length}):*\n${fechados.map(linhaLead).join('\n')}`)
    if (pausados.length) partes.push(`\n⏸️ *Pausados (${pausados.length}):*\n${pausados.map(linhaLead).join('\n')}`)
    if (ativos.length) partes.push(`\n🔥 *Ativos (${ativos.length}):*\n${ativos.map(linhaLead).join('\n')}`)
    return partes.join('\n')
  } catch (e) {
    console.error('❌ Relatório operador:', e.message)
    return '❌ Não foi possível gerar o relatório agora.'
  }
}

/**
 * Executa a opção selecionada pelo operador no menu (1–6).
 */
async function executarOpcaoOperador(opcao, msg, jidOperador) {
  const nome = nomeOperadorPorJid(jidOperador) || (msg.pushName || '').trim() || 'parceiro'
  try {
    switch (opcao) {
      case 1:
        await enviarMensagem(jidOperador,
          '✍️ *Responder lead*\n\nUse o formato:\n`5511999999999 INSTRUÇÃO: seu texto`\n\nO agente vai incluir sua orientação na próxima resposta ao lead.'
        )
        break
      case 2:
        await enviarMensagem(jidOperador,
          '📸 *Enviar apresentação*\n\nUse o formato:\n`5511999999999 APRESENTAÇÃO`\n\nO agente envia as imagens de modelos + planos com mensagem complementar para o lead.'
        )
        break
      case 3: {
        const texto = await textoAgendamentosOperador()
        await enviarMensagem(jidOperador, texto)
        break
      }
      case 4:
        await enviarMensagem(jidOperador,
          '🎯 *Simular abordagem*\n\nMe descreva o perfil do lead e eu respondo como se fosse ele:\n\nEx: "Simula lead: pintor de paredes em São Paulo, não aparece no Google, ticket R$500"\n\nVou jogar o papel do lead para você treinar o script.'
        )
        break
      case 5: {
        const texto = await textoRelatorioOperador()
        await enviarMensagem(jidOperador, texto)
        break
      }
      case 6:
        await enviarMensagem(jidOperador,
          '⚙️ *Ajustar configuração*\n\nPara ajustar scripts, preços ou regras do agente, acesse o painel ou fale diretamente com o Victor.\n\nPara comandos rápidos:\n`5511999999999 INSTRUÇÃO: novo contexto para o agente`'
        )
        break
      default:
        await enviarMenuListaOperador(jidOperador, nome)
    }
  } catch (e) {
    console.error('❌ Opção operador:', e.message)
  }
}

/**
 * Responde ao operador de forma contextual:
 * - Cumprimentos / "menu" → menu completo com 6 opções
 * - Número 1–6 → executa a opção selecionada
 * - Outras mensagens → Claude Haiku responde com contexto de operador
 */
async function processarMensagemLivreOperador(msg, jidOperador) {
  const nomeConfig = nomeOperadorPorJid(jidOperador)
  const nome = nomeConfig || (msg.pushName || '').trim() || 'parceiro'
  const textoInterativo = extrairTextoInterativo(msg.message)
  const texto = (
    textoInterativo ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim()

  try {
    // Seleção numerada do menu (aceita "1", "1.", "1)" etc.)
    const mOpcao = texto.match(/^([1-6])[.):\s]?\s*$/)
    if (mOpcao) {
      await executarOpcaoOperador(parseInt(mOpcao[1]), msg, jidOperador)
      return
    }

    // Verificar se é modo de simulação de lead
    if (/^simula\b/i.test(texto)) {
      await executarSimulacaoLead(texto, jidOperador, nome)
      return
    }

    if (!texto || REGEX_CUMPRIMENTO_OPERADOR.test(texto)) {
      // Cumprimento, "menu", "opções" → menu completo
      await enviarMenuListaOperador(jidOperador, nome)
    } else {
      // Pergunta livre → Claude Haiku responde com contexto de operador
      const resposta = await chamarClaudeAssistenteOperador(texto, nome)
      if (resposta) {
        await enviarMensagem(jidOperador, resposta)
      } else {
        await enviarMenuListaOperador(jidOperador, nome)
      }
    }
  } catch (e) {
    console.error('❌ Menu operador:', e.message)
  }
}

/**
 * Modo de simulação: Claude joga o papel de um lead baseado na descrição do operador.
 */
async function executarSimulacaoLead(descricao, jidOperador, nomeOperador) {
  if (!ANTHROPIC_KEY) {
    await enviarMensagem(jidOperador, '❌ ANTHROPIC_KEY não configurada.')
    return
  }
  const system = [
    `Você é um lead (cliente em potencial) de pequeno negócio no Brasil.`,
    `Responda APENAS como o lead responderia — curto, direto, natural, como em WhatsApp.`,
    `Perfil descrito pelo operador: ${descricao}`,
    `Não quebre o personagem. Não explique que é uma simulação. Se o operador enviar uma abordagem de vendas, responda como o lead reagiria.`,
  ].join(' ')
  try {
    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: `[Início da simulação. O operador vai te abordar agora. Primeiro, apresente-se brevemente como o lead.]` }],
      },
      {
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout: 15000,
      }
    )
    const fala = resp.data?.content?.[0]?.text?.trim() || ''
    await enviarMensagem(jidOperador, `🎯 *Simulação iniciada!*\n\nPerfil: ${descricao}\n\n_Lead diz:_\n${fala}\n\n_(Responda normalmente para continuar o roleplay)_`)
  } catch (e) {
    console.error('❌ Simulação lead:', e.message)
    await enviarMensagem(jidOperador, '❌ Não foi possível iniciar a simulação agora.')
  }
}

/**
 * Chama Claude Haiku com prompt leve para responder perguntas conversacionais do operador.
 */
async function chamarClaudeAssistenteOperador(pergunta, nomeOperador) {
  if (!ANTHROPIC_KEY) return null
  const system = [
    `Assistente interno da PJ Codeworks respondendo ao operador ${nomeOperador}.`,
    `Funcionalidades disponíveis no chat:`,
    `1 - Responder lead: [número] INSTRUÇÃO: texto`,
    `2 - Enviar apresentação: [número] APRESENTAÇÃO`,
    `3 - Agendamentos: responder "3" no menu`,
    `4 - Simular abordagem: "Simula lead: [descrição]"`,
    `5 - Relatório do dia: responder "5" no menu`,
    `6 - Ajustar configuração: contato com Victor`,
    `Responda em português, direto, máximo 3 frases. Não invente funcionalidades.`,
  ].join(' ')
  try {
    const resp = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: pergunta }],
      },
      {
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout: 15000,
      }
    )
    return resp.data?.content?.[0]?.text?.trim() || null
  } catch (e) {
    console.error('❌ Assistente operador:', e.message)
    return null
  }
}

async function processarComandosOperadorChat(msg, jidOperador) {
  // Suporte a respostas interativas (lista / botões) além de texto livre
  const textoInterativo = extrairTextoInterativo(msg.message)
  const texto = (
    textoInterativo ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim()
  if (!texto) return

  const parsed = parseComandoOperadorWhatsApp(texto)
  if (!parsed) {
    // Seleção do menu (1–6): encaminha para processarMensagemLivreOperador que executa a opção
    const mOpcaoMenu = texto.match(/^([1-6])[.):\s]?\s*$/)
    if (mOpcaoMenu) {
      await processarMensagemLivreOperador(msg, jidOperador)
      return
    }
    if (/^\s*\d{5,}/.test(texto)) {
      // Parece um comando com número de lead mas está mal formatado — mostra o formato correto
      try {
        await enviarMensagem(
          jidOperador,
          'Formato:\n5511999999999 PAUSAR\n5511999999999 RETOMAR\n5511999999999 INSTRUÇÃO: texto\n5511999999999 APRESENTAÇÃO'
        )
      } catch (e) {
        console.error('❌ Aviso ao operador:', e.message)
      }
    } else {
      // Mensagem conversacional — saudação, pergunta ou seleção de menu
      await processarMensagemLivreOperador(msg, jidOperador)
    }
    return
  }

  const { jidLead, tipo } = parsed

  // APRESENTAÇÃO não requer conversa prévia
  if (tipo === 'apresentacao') {
    try {
      const num = String(jidLead).replace(/@s\.whatsapp\.net$/i, '')
      await enviarMensagem(jidLead, 'Deixa eu te mostrar como funciona na prática — aqui vai uma visão completa do que a gente entrega. 👇')
      await enviarPrintLocal(jidLead, 'modelos-site',
        'Esses são os modelos que a gente trabalha — cada um pensado pra um perfil de negócio. Temos opções pra quem tá começando e pra quem quer se posicionar forte no mercado. O Victor te ajuda a escolher o que encaixa melhor no seu caso.')
      await enviarPrintLocal(jidLead, 'planos-mensais',
        'E pra manter tudo funcionando depois que o site tiver no ar, a gente tem planos a partir de R$ 150/mês — desde o básico pra deixar seguro e atualizado até o Aceleração, onde a gente opera tudo por você. A maioria dos clientes começa pelo Crescimento. 🚀')
      await enviarMensagem(jidLead, 'Algum modelo chamou mais atenção? O Victor te passa os detalhes do projeto — qual horário fica melhor pra você?')
      await enviarMensagem(jidOperador, `✅ Apresentação enviada ao lead ${num}.`)
    } catch (e) {
      console.error('❌ Apresentação ao lead:', e.message)
      try { await enviarMensagem(jidOperador, `❌ Erro ao enviar apresentação: ${e.message}`) } catch (_) {}
    }
    return
  }

  const conversa = await buscarConversa(jidLead)
  if (!conversa) {
    try {
      await enviarMensagem(jidOperador, `Não há conversa salva para ${jidLead}.`)
    } catch (e) {
      console.error('❌ Aviso ao operador:', e.message)
    }
    return
  }

  try {
    if (tipo === 'pausar') {
      await pool.query(
        `UPDATE vendas.conversas SET agente_pausado = true, atualizado_em = NOW() WHERE numero = $1`,
        [jidLead]
      )
      await enviarMensagem(jidOperador, `✅ Agente pausado para ${jidLead}`)
      return
    }
    if (tipo === 'retomar') {
      await pool.query(
        `UPDATE vendas.conversas SET agente_pausado = false, atualizado_em = NOW() WHERE numero = $1`,
        [jidLead]
      )
      await enviarMensagem(jidOperador, `✅ Agente retomado para ${jidLead}`)
      return
    }
    let historico = normalizarHistoricoMensagens(conversa.historico)
    historico.push({ role: 'operator', content: parsed.instrucao })
    if (historico.length > 40) historico = historico.slice(-40)
    await salvarConversa(jidLead, historico, conversa.estagio || 'primeiro_contato', conversa.status || 'ativo')
    try {
      const { trecho_resposta } = await executarFollowupUmNumero(jidLead, parsed.instrucao)
      const preview = trecho_resposta
        ? `\n\nTrecho enviado ao lead:\n${trecho_resposta}${trecho_resposta.length >= 200 ? '…' : ''}`
        : ''
      await enviarMensagem(
        jidOperador,
        `✅ Instrução registrada e mensagem enviada ao lead ${jidLead}.${preview}`
      )
    } catch (eFollowup) {
      console.error('❌ Follow-up após INSTRUÇÃO:', eFollowup.message)
      try {
        await enviarMensagem(
          jidOperador,
          `⚠️ Instrução salva no histórico, mas não foi possível enviar a mensagem ao lead: ${eFollowup.message}`
        )
      } catch (_) {}
    }
  } catch (e) {
    console.error('❌ Comando operador:', e.message)
    try {
      await enviarMensagem(jidOperador, `Erro: ${e.message}`)
    } catch (_) {}
  }
}

function perfilResumidoParaFollowup(perfil) {
  if (!perfil || typeof perfil !== 'object') return {}
  const { id: _id, ...rest } = perfil
  const out = {}
  for (const [k, v] of Object.entries(rest)) {
    if (v != null && v !== '') out[k] = v
  }
  return out
}

/**
 * Texto curto em português para o intervalo desde `atualizado_em` até agora.
 * @param {number} diffMs
 */
function formatarIntervaloAproximadoPt(diffMs) {
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'tempo indisponível'
  const minutos = Math.floor(diffMs / 60000)
  if (minutos < 1) return 'menos de 1 minuto'
  if (minutos < 60) {
    return minutos === 1 ? 'cerca de 1 minuto' : `cerca de ${minutos} minutos`
  }
  const horas = Math.round(diffMs / 3600000)
  if (horas < 24) {
    return horas <= 1 ? 'cerca de 1 hora' : `cerca de ${horas} horas`
  }
  const dias = Math.round(diffMs / 86400000)
  return dias <= 1 ? 'cerca de 1 dia' : `cerca de ${dias} dias`
}

/**
 * Contexto de tempo para o prompt de follow-up manual (usa `atualizado_em` da conversa).
 * @param {Date|string|null|undefined} atualizadoEm
 * @param {unknown[]} historicoNormalizado resultado de `normalizarHistoricoMensagens`
 */
function contextoTempoFollowup(atualizadoEm, historicoNormalizado) {
  const agora = new Date().toISOString()
  const msgs = Array.isArray(historicoNormalizado) ? historicoNormalizado : []
  const ultimo = msgs.length ? msgs[msgs.length - 1] : null
  let ultima_mensagem_no_historico = 'desconhecido'
  if (ultimo && typeof ultimo.role === 'string') {
    if (ultimo.role === 'user') ultima_mensagem_no_historico = 'user'
    else if (ultimo.role === 'assistant') ultima_mensagem_no_historico = 'assistant'
    else if (ultimo.role === 'operator') ultima_mensagem_no_historico = 'operator'
  }

  let ultima_atualizacao_conversa = null
  let intervalo_aproximado = 'tempo indisponível'
  /** @type {'continuacao'|'continuacao_leve'|'followup_retomada'|'neutro'} */
  let tom_sugerido = 'neutro'

  const t =
    atualizadoEm instanceof Date
      ? atualizadoEm
      : atualizadoEm != null && String(atualizadoEm).trim() !== ''
        ? new Date(atualizadoEm)
        : null

  if (t && !Number.isNaN(t.getTime())) {
    ultima_atualizacao_conversa = t.toISOString()
    let diffMs = Date.now() - t.getTime()
    if (diffMs < 0) diffMs = 0
    intervalo_aproximado = formatarIntervaloAproximadoPt(diffMs)
    const horas = diffMs / 3600000
    if (horas < FOLLOWUP_HORAS_CONTINUACAO) tom_sugerido = 'continuacao'
    else if (horas < FOLLOWUP_HORAS_DISTANCIADO) tom_sugerido = 'continuacao_leve'
    else tom_sugerido = 'followup_retomada'
  }

  return {
    agora,
    ultima_atualizacao_conversa,
    intervalo_aproximado,
    ultima_mensagem_no_historico,
    tom_sugerido,
  }
}

/**
 * Bloco de texto injetado no user message do follow-up (português, uso interno do modelo).
 * @param {ReturnType<typeof contextoTempoFollowup>|null|undefined} ctx
 */
function textoBlocoContextoTempoFollowup(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    return `\n\n--- CONTEXTO DE TEMPO (uso interno; não copie labels ao lead) ---
Tempo desde a última atualização da conversa: indisponível. Tom neutro e natural.
Última mensagem no histórico: desconhecido.\n`
  }
  const ultMsg = ctx.ultima_mensagem_no_historico || 'desconhecido'
  const ultAt =
    ctx.ultima_atualizacao_conversa != null ? String(ctx.ultima_atualizacao_conversa) : 'indisponível'
  return `\n\n--- CONTEXTO DE TEMPO (uso interno; não copie labels ao lead) ---
Referência de agora (UTC): ${ctx.agora}
Última atualização gravada da conversa (aprox. último evento): ${ultAt}
Intervalo aproximado desde então: ${ctx.intervalo_aproximado}
Quem falou por último no histórico: ${ultMsg} (user=cliente, assistant=assistente, operator=operador)
Tom sugerido (siga as regras do sistema): ${ctx.tom_sugerido}\n`
}

/** Lembrete curto no user message do follow-up quando há motor de precificação no perfil. */
function textoBlocoPrecificacaoFollowup(perfil) {
  const raw = perfil && perfil.precificacao_json
  if (raw == null) return ''
  let pj = raw
  if (typeof pj === 'string') {
    try {
      pj = JSON.parse(pj)
    } catch (_) {
      return ''
    }
  }
  if (!pj || typeof pj !== 'object' || Array.isArray(pj)) return ''
  const vp = pj.valor_personalizado
  if (vp == null || !Number.isFinite(Number(vp))) return ''
  const sIni  = Number.isFinite(Number(pj.iniciante_valor)) ? `R$ ${pj.iniciante_valor}` : '?'
  const sPad  = Number.isFinite(Number(pj.padrao_valor))    ? `R$ ${pj.padrao_valor}`    : '?'
  const sPrem = Number.isFinite(Number(pj.premium_valor))   ? `R$ ${pj.premium_valor}`   : '?'
  const sEnt  = Number.isFinite(Number(pj.parcelamento_recomendado?.entrada)) ? `R$ ${pj.parcelamento_recomendado.entrada}` : '?'
  const sPar  = Number.isFinite(Number(pj.parcelamento_recomendado?.parcela)) ? `R$ ${pj.parcelamento_recomendado.parcela}` : '?'
  return `\n\n---\nPrecificação já calculada no perfil: plano=${pj.plano_recomendado ?? '?'} | ROI=${pj.roi_score ?? '?'} | valor_personalizado=R$ ${vp} (faixa R$${pj.range_min ?? '?'}–R$${pj.range_max ?? '?'}); parcelamento: entrada ${sEnt} + 3x ${sPar}. Três planos (mesmo ROI): Iniciante ${sIni} / Padrão ${sPad} / Premium ${sPrem}. Upgrades: Inic→Pad R$ ${pj.upgrade_iniciante_para_padrao ?? '?'} · Pad→Prem R$ ${pj.upgrade_padrao_para_premium ?? '?'}. Use só estes números; não invente cifras.\n`
}

async function chamarClaudeFollowup(historico, estagio, perfil, opcoes = {}) {
  if (!ANTHROPIC_KEY) {
    throw new Error('ANTHROPIC_KEY não configurada')
  }
  const instrucao =
    opcoes &&
    typeof opcoes.instrucao === 'string' &&
    opcoes.instrucao.trim().length > 0
      ? opcoes.instrucao.trim()
      : null
  if (instrucao && instrucao.length > FOLLOWUP_INSTRUCAO_MAX_CHARS) {
    throw new Error(`Instrução excede ${FOLLOWUP_INSTRUCAO_MAX_CHARS} caracteres`)
  }
  const msgs = normalizarHistoricoMensagens(historico)
  const trechos = msgs.slice(-30).map((m) => {
    const role =
      m.role === 'user'
        ? 'Cliente'
        : m.role === 'assistant'
          ? 'Assistente'
          : m.role === 'operator'
            ? 'Operador'
            : m.role
    let text = m.content
    if (typeof text !== 'string') {
      if (text == null) text = ''
      else if (Array.isArray(text)) {
        text = text
          .map((b) => (b && typeof b === 'object' && 'text' in b ? b.text : JSON.stringify(b)))
          .join('')
      } else text = String(text)
    }
    return `${role}: ${text}`
  })
  const historicoTexto = trechos.length ? trechos.join('\n\n') : '(Sem mensagens no histórico.)'

  const baseFollow = FOLLOWUP_PROMPT_BASE.trim() ||
    `Escreva uma mensagem curta de follow-up para WhatsApp. Responda APENAS com JSON: {"mensagem":"..."}`

  const blocoDirecionamento = instrucao
    ? `\n\n---\nDIRECIONAMENTO DO OPERADOR (não envie este texto ao lead; integre o foco de forma natural na mensagem final, sem citar que foi instrução interna):\n${instrucao}\n`
    : ''

  const ctxTempo =
    opcoes && opcoes.contextoTempo != null && typeof opcoes.contextoTempo === 'object'
      ? opcoes.contextoTempo
      : null
  const blocoContextoTempo = textoBlocoContextoTempoFollowup(ctxTempo)
  const blocoPrecificacao = textoBlocoPrecificacaoFollowup(perfil)
  const contextosInternosFollowup = perfil?.numero ? await buscarLeadContextos(perfil.numero, LEAD_CONTEXTO_PROMPT_LIMIT) : []
  const blocoContextoInternoFollowup = montarBlocoContextoInterno(contextosInternosFollowup)

  const userContent = `HISTÓRICO DA CONVERSA:\n${historicoTexto}\n\n---\nESTÁGIO ATUAL NO FUNIL: ${estagio}\n\nPERFIL DO LEAD (JSON):\n${JSON.stringify(perfilResumidoParaFollowup(perfil), null, 2)}${blocoPrecificacao}${blocoDirecionamento}${blocoContextoTempo}\nGere a mensagem de follow-up conforme as instruções do sistema. Responda APENAS com um JSON válido: {"mensagem":"..."}`

  const userContentFinal = userContent.replace(
    `${blocoPrecificacao}${blocoDirecionamento}`,
    `${blocoPrecificacao}${blocoContextoInternoFollowup}${blocoDirecionamento}`
  )

  const systemFollowup = [
    { type: 'text', text: baseFollow, cache_control: { type: 'ephemeral' } },
  ]

  const resp = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemFollowup,
      messages: [{ role: 'user', content: userContentFinal }],
    },
    { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31', 'content-type': 'application/json' } }
  )

  const bruto = resp.data.content[0].text
  const parsed = parsearRespostaJsonClaude(bruto)
  let texto = parsed && typeof parsed.mensagem === 'string' ? parsed.mensagem.trim() : ''
  if (!texto) {
    texto = (bruto || '').trim()
  }
  if (!texto) {
    throw new Error('Modelo retornou mensagem de follow-up vazia')
  }
  return texto
}

/**
 * Follow-up manual para um JID: se a última mensagem for do cliente, usa o mesmo fluxo do webhook (funil + system.md);
 * caso contrário, mensagem curta via followup.md (reengajamento).
 * @param {string} numero JID normalizado
 * @param {string|null} instrucao texto opcional de direcionamento do operador (já validado no handler)
 */
async function executarFollowupUmNumero(numero, instrucao) {
  const conversa = await buscarConversa(numero)
  if (!conversa) {
    throw new Error('Conversa não encontrada para este número.')
  }
  const instrTrim = instrucao && String(instrucao).trim() ? String(instrucao).trim() : null
  const snippetInstr = instrTrim ? instrTrim.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS) : null
  const historicoBruto = normalizarHistoricoMensagens(conversa.historico)
  const ultima = historicoBruto[historicoBruto.length - 1]
  const modo = ultima && ultima.role === 'user' ? 'fluxo_funil' : 'reengajamento'
  const estagio = conversa.estagio || 'primeiro_contato'

  const funnelOpcoes =
    instrTrim
      ? { instrucaoOperador: instrTrim }
      : {}

  try {
    if (ultima && ultima.role === 'user') {
      let info = await gerarEEnviarRespostaWhatsapp(
        numero,
        historicoBruto,
        estagio,
        conversa,
        null,
        funnelOpcoes
      )
      if (info && info.stale) {
        const c2 = await buscarConversa(numero)
        if (!c2) {
          throw new Error('Conversa não encontrada para este número.')
        }
        const h2 = normalizarHistoricoMensagens(c2.historico)
        info = await gerarEEnviarRespostaWhatsapp(
          numero,
          h2,
          c2.estagio || 'primeiro_contato',
          c2,
          null,
          funnelOpcoes
        )
      }
      if (info && info.stale) {
        throw new Error('Histórico mudou durante a geração; tente novamente.')
      }
      const preview =
        (info && typeof info.texto_metrica_followup === 'string' && info.texto_metrica_followup) ||
        (info && typeof info.trecho_resposta === 'string' && info.trecho_resposta) ||
        ''
      await registrarFollowupEnvio(numero, {
        modo: 'fluxo_funil',
        instrucao_snippet: snippetInstr,
        mensagem_preview: preview.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
        envio_ok: true,
        erro: null,
      })
      return info
    }

    const perfil = await buscarPerfil(numero)
    if (!perfil.numero) perfil.numero = numero
    const contextoTempo = contextoTempoFollowup(conversa.atualizado_em, historicoBruto)
    const opcoesFollow = { contextoTempo, ...(instrTrim ? { instrucao: instrTrim } : {}) }
    const textoFollowup = await chamarClaudeFollowup(historicoBruto, estagio, perfil, opcoesFollow)
    await enviarMensagem(numero, textoFollowup)

    let historicoNovo = [...historicoBruto, { role: 'assistant', content: textoFollowup }]
    if (historicoNovo.length > 40) historicoNovo = historicoNovo.slice(-40)

    await salvarConversa(numero, historicoNovo, estagio, conversa.status || 'ativo')

    await registrarFollowupEnvio(numero, {
      modo: 'reengajamento',
      instrucao_snippet: snippetInstr,
      mensagem_preview: textoFollowup.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
      envio_ok: true,
      erro: null,
    })

    const destino = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    return { destino, trecho_resposta: textoFollowup.slice(0, 200) }
  } catch (e) {
    const msg = (e && e.message) || String(e)
    await registrarFollowupEnvio(numero, {
      modo,
      instrucao_snippet: snippetInstr,
      mensagem_preview: null,
      envio_ok: false,
      erro: msg,
    })
    throw e
  }
}

/**
 * Cópia do histórico com nota interna na última mensagem do cliente (só para o Claude; não persistir).
 */
function historicoComInstrucaoOperadorParaClaude(historico, instrucao) {
  const ins = typeof instrucao === 'string' ? instrucao.trim() : ''
  if (!ins) return historico
  const h = normalizarHistoricoMensagens(historico)
  if (!h.length) return h
  const last = h[h.length - 1]
  if (!last || last.role !== 'user') return h
  const base =
    typeof last.content === 'string' ? last.content : String(last.content ?? '')
  const nota =
    `\n\n---\nDirecionamento do operador (não envie este bloco ao lead; integre o foco na resposta JSON):\n${ins}`
  return [...h.slice(0, -1), { role: 'user', content: `${base}${nota}` }]
}

/**
 * Histórico já deve estar persistido terminando em mensagem do user.
 * Só grava a resposta do assistente no BD depois do envio ao WhatsApp (permite reprocessar se falhar antes).
 * @param {null|{ instrucaoOperador?: string }} [opcoes] — instrução do dashboard; enriquece só o input do Claude.
 * @returns {Promise<{ destino: string, trecho_resposta: string }|{ stale: true }>}
 */
async function gerarEEnviarRespostaWhatsapp(
  numero,
  historicoBruto,
  estagio,
  conversa,
  visaoUltimaMensagem = null,
  opcoes = null
) {
  const conversaLive = await buscarConversa(numero)
  const historico = normalizarHistoricoMensagens(conversaLive?.historico ?? historicoBruto)
  const estagioLive = conversaLive?.estagio || estagio || 'primeiro_contato'
  const conversaUsada = conversaLive || conversa
  let respostaEnviadaAoLead = false

  const ultima = historico[historico.length - 1]
  if (!ultima || ultima.role !== 'user') {
    throw new Error('Última mensagem do histórico deve ser do usuário')
  }
  let perfil = await buscarPerfil(numero)
  if (!perfil.numero) perfil = { ...perfil, numero }

  // Enriquece perfil com concorrentes reais via Google CSE (1x por lead, idempotente).
  // No-op se GOOGLE_CSE_KEY/ID não configurados ou se o perfil já tem concorrentes.
  // Fica fora do caminho crítico: se falhar, a conversa segue sem concorrentes reais.
  try {
    const reais = await garantirConcorrentesReaisNoPerfil(numero, perfil)
    if (Array.isArray(reais) && reais.length > 0 && (!perfil.concorrentes || perfil.concorrentes.length === 0)) {
      perfil = { ...perfil, concorrentes: reais }
    }
  } catch (_) { /* defensivo */ }

  // Pre-calcula o preço antes de chamar o Claude para que ele já tenha precificacao_json
  // disponível e possa apresentar os valores diretamente (sem dizer "o Victor vai calcular").
  if (diagnosticoCompletoParaPreco(perfil) && !perfil.preco_calculado) {
    try {
      const preco = calcularPreco(perfil)
      const aplicadoPrecoAntecipado = await atualizarPerfil(numero, {
        preco_calculado: preco.total,
        entrada: preco.entrada,
        parcela: preco.parcela,
        precificacao_json: preco.precificacao_json,
      })
      perfil = { ...perfil, ...preco, ...aplicadoPrecoAntecipado }
      console.log(
        `💰 [pre-calc] Plano: ${preco.precificacao_json.plano_recomendado} | ROI: ${preco.precificacao_json.roi_score} | R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})`
      )
    } catch (e) {
      console.warn('⚠️ Pre-cálculo de preço falhou:', e.message)
    }
  }

  const instr =
    opcoes && typeof opcoes === 'object' && typeof opcoes.instrucaoOperador === 'string'
      ? opcoes.instrucaoOperador.trim()
      : ''
  const historicoParaClaude = instr
    ? historicoComInstrucaoOperadorParaClaude(historico, instr)
    : historico

  const historicoPreClaudeLen = historico.length
  const resultado = await chamarClaude(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem)

  const conversaPosClaude = await buscarConversa(numero)
  const historicoPos = normalizarHistoricoMensagens(conversaPosClaude?.historico || [])
  if (historicoCresceuSoComUsers(historicoPreClaudeLen, historicoPos)) {
    return { stale: true }
  }

  if (Object.keys(resultado.atualizar_perfil || {}).length > 0) {
    const aplicadoPerfil = await atualizarPerfil(numero, resultado.atualizar_perfil)
    perfil = { ...perfil, ...aplicadoPerfil }
  }

  const motivoNorm = normalizarMotivoHandoff(resultado.motivo_handoff)

  // Permite recalcular quando o bot muda explicitamente de plano via atualizar_perfil
  const planoMudou =
    resultado.atualizar_perfil?.plano_sugerido &&
    resultado.atualizar_perfil.plano_sugerido !== perfil.precificacao_json?.plano_recomendado

  const podeCalcularPreco =
    diagnosticoCompletoParaPreco(perfil) &&
    (!perfil.preco_calculado || planoMudou) &&
    resultado.solicitar_calculo_preco !== false

  let precoCalculadoNestaResposta = null
  if (podeCalcularPreco) {
    const preco = calcularPreco(perfil)
    precoCalculadoNestaResposta = preco
    const aplicadoPreco = await atualizarPerfil(numero, {
      preco_calculado: preco.total,
      entrada: preco.entrada,
      parcela: preco.parcela,
      precificacao_json: preco.precificacao_json,
    })
    perfil = { ...perfil, ...preco, ...aplicadoPreco }
    console.log(
      `💰 Plano: ${preco.precificacao_json.plano_recomendado} | ROI: ${preco.precificacao_json.roi_score} | R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})`
    )
  }

  const textoRespostaBruto = (resultado.mensagem_pro_lead || '').trim()
  if (!textoRespostaBruto) {
    throw new Error('Modelo retornou mensagem vazia para o lead')
  }
  const textoResposta = sanitizarCpfNaSaidaTexto(textoRespostaBruto)

  const bolhasSanitizadas =
    Array.isArray(resultado.mensagens_bolhas) && resultado.mensagens_bolhas.length > 0
      ? resultado.mensagens_bolhas
          .map((x) => sanitizarCpfNaSaidaTexto(String(x || '').trim()))
          .filter((x) => x.length > 0)
      : null

  if (typeof resultado.enviar_print === 'string' && resultado.enviar_print.trim()) {
    await enviarPrintLocal(numero, resultado.enviar_print.trim(), '').catch(
      (e) => console.error('❌ enviar_print falhou:', e.message)
    )
  }

  const linksExtra = filtrarLinksSugeridosParaEnvio(resultado.links_sugeridos, textoResposta)
  const textoHistoricoAssist =
    linksExtra.length > 0 ? `${textoResposta}\n\n${linksExtra.join('\n')}` : textoResposta

  let historicoNovo = [...historico, { role: 'assistant', content: textoHistoricoAssist }]
  if (historicoNovo.length > 40) historicoNovo = historicoNovo.slice(-40)

  const precisaHandoff = !!resultado.handoff
  const novoStatus = precisaHandoff ? 'aguardando_handoff' : (conversaUsada?.status || 'ativo')

  /**
   * Se motivo é aprovacao_valor, NÃO enviar a mensagem ao lead agora.
   * A mensagem fica salva no histórico mas o envio real ao WhatsApp é bloqueado.
   * O Victor recebe o preview e, ao aprovar, o operador envia manualmente ou retoma.
   */
  const reterMensagemParaAprovacao = precisaHandoff && motivoNorm === 'aprovacao_valor'

  if (!reterMensagemParaAprovacao) {
    const botoes = extrairBotoes(textoRespostaBruto)
    const bolhasModelo = bolhasSanitizadas && bolhasSanitizadas.length > 0

    if (botoes) {
      await enviarComBotoes(numero, textoResposta, botoes)
      if (linksExtra.length > 0) {
        await enviarMensagem(numero, linksExtra.join('\n'))
      }
    } else if (bolhasModelo) {
      await enviarSequenciaMensagens(numero, bolhasSanitizadas)
      if (linksExtra.length > 0) {
        await enviarMensagem(numero, linksExtra.join('\n'))
      }
    } else {
      const partesHeur = dividirTextoPorQuebrasHeuristico(textoResposta)
      if (partesHeur.length > 1) {
        await enviarSequenciaMensagens(numero, partesHeur)
        if (linksExtra.length > 0) {
          await enviarMensagem(numero, linksExtra.join('\n'))
        }
      } else {
        await enviarMensagem(numero, textoHistoricoAssist)
      }
    }
    respostaEnviadaAoLead = true
    const precoEvento = precoCalculadoNestaResposta || (
      perfil && perfil.preco_calculado
        ? { total: perfil.preco_calculado, entrada: perfil.entrada, parcela: perfil.parcela }
        : null
    )
    if (precoEvento && extrairValoresReaisDoTextoBrasil(textoHistoricoAssist).length > 0) {
      await registrarEventoComercial(numero, 'recebeu_proposta', {
        total: Number(precoEvento.total) || null,
        entrada: Number(precoEvento.entrada) || null,
        parcela: Number(precoEvento.parcela) || null,
        etapa: resultado.etapa_proxima || estagioLive,
      })
    }
    if (resultado.solicitar_preview_site) {
      const jaRecebeu = await pool.query(
        'SELECT 1 FROM vendas.eventos_comerciais WHERE numero = $1 AND tipo = $2 LIMIT 1',
        [numero, 'recebeu_preview']
      )
      if (jaRecebeu.rows.length > 0) {
        console.log(`⚠️ Preview ja enviado para este lead — ignorando solicitar_preview_site`)
      } else {
        try {
          const imagensPreview = visaoUltimaMensagem ? [visaoUltimaMensagem] : []
          await gerarEEnviarPreviewSite(numero, perfil, historico, {
            modelo: resultado.preview_site_modelo || perfil?.plano_sugerido || null,
            imagens: imagensPreview,
          })
        } catch (e) {
          console.error('Preview de site falhou:', e.response?.data || e.message)
          await enviarMensagem(
            numero,
            'Tentei montar a previa visual agora, mas nao consegui gerar a imagem nesse momento. Vamos continuar a conversa normalmente.'
          ).catch(() => {})
        }
      }
    }
  } else {
    console.log(`⏸️  Mensagem retida (aprovacao_valor) — aguardando OK do Operador`)
    respostaEnviadaAoLead = false
  }
  try {
    console.log(`✉️  [${resultado.etapa_proxima || estagioLive}] Resposta enviada`)

    await salvarConversa(numero, historicoNovo, resultado.etapa_proxima || estagioLive, novoStatus)
    await limparFalhaResposta(numero)

    if (respostaEnviadaAoLead && !precisaHandoff && resultado.agendar_followup_auto) {
      try {
        await persistirAgendamentoFollowupExplicito(
          numero,
          resultado.agendar_followup_auto,
          resultado.etapa_proxima || estagioLive
        )
      } catch (e) {
        console.error('Erro ao agendar follow-up explicito:', e.message)
      }
    }

    try {
      await atualizarCamadaMemoriaVendasPosResposta(
        numero,
        historicoNovo,
        perfil,
        resultado.etapa_proxima || estagioLive,
        textoHistoricoAssist
      )
    } catch (e) {
      console.warn('⚠️ Camada memória vendas:', e.message)
    }

    if (
      resultado.registrar_lacuna &&
      (resultado.tema_lacuna || resultado.detalhe_lacuna)
    ) {
      try {
        const lacunaId = await registrarLacunaConhecimento(
          numero,
          resultado.tema_lacuna,
          resultado.detalhe_lacuna
        )
        if (lacunaId != null) {
          const temaAlerta = resultado.tema_lacuna?.trim() || 'geral'
          const detAlerta =
            resultado.detalhe_lacuna?.trim() || resultado.tema_lacuna?.trim() || ''
          await alertarLacunaConhecimento(numero, temaAlerta, detAlerta)
          console.log(`📌 Lacuna de conhecimento registrada (id ${lacunaId})`)
        }
      } catch (e) {
        console.error('❌ Lacuna de conhecimento:', e.message)
      }
    }

    if (precisaHandoff && motivoNorm === 'aceitou_proposta') {
      await marcarFechada(numero)
      console.log(`🎉 Venda fechada (aceitou_proposta): ${numero}`)
      gerarAprendizado().catch(e => console.error('Aprendizado erro:', e.message))
    }

    if (precisaHandoff && motivoNorm === 'aprovacao_valor') {
      const preco = {
        total:   perfil.preco_calculado || 0,
        entrada: perfil.entrada || 0,
        parcela: perfil.parcela || 0,
      }
      const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
      const previewValor =
        `[PREVIEW DE VALOR — AGUARDANDO APROVAÇÃO]\n` +
        `Lead: ${phone} | ${perfil.negocio || '?'} — ${perfil.cidade || '?'}\n` +
        `Plano sugerido: ${perfil.plano_sugerido || '?'}\n` +
        (preco.total > 0
          ? `Valor total: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
          : `Valor: a calcular\n`) +
        `Temperatura: ${perfil.temperatura_lead || '?'} | Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10\n` +
        `✅ Responda OK para confirmar e eu envio ao lead, ou ajuste o valor.`
      await notificarVictorWhatsapp(previewValor)
      console.log(`💬 Preview de valor enviado ao Victor para aprovação: ${phone}`)
    }

    if (precisaHandoff) {
      const preco = {
        total:   perfil.preco_calculado || 0,
        entrada: perfil.entrada || 0,
        parcela: perfil.parcela || 0,
      }
      const resumoHandoff = typeof resultado.resumo_handoff === 'string' && resultado.resumo_handoff.trim()
        ? resultado.resumo_handoff.trim()
        : null
      await alertarHandoff(numero, perfil, preco, motivoNorm || 'handoff', resumoHandoff)
    }

    const destino = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    return {
      destino,
      trecho_resposta: textoHistoricoAssist.slice(0, 200),
      texto_metrica_followup: textoHistoricoAssist.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
    }
  } catch (err) {
    if (respostaEnviadaAoLead) err.leadMessageSent = true
    throw err
  }
}

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

/** Chave estável por mensagem WhatsApp (Evolution pode reenviar o mesmo evento). */
function construirChaveIdempotenciaWebhookMensagem(msg) {
  const id = msg?.key?.id
  if (id == null || id === '') return null
  const rj = String(msg.key.remoteJid || msg.key.participant || '')
  return `${rj}|${id}`
}

async function webhookMensagemDeveSerProcessada(messageKey, numero) {
  if (!messageKey) return true
  try {
    const r = await pool.query(
      `INSERT INTO vendas.webhook_messages_processed (message_key, numero) VALUES ($1, $2)
       ON CONFLICT (message_key) DO NOTHING RETURNING message_key`,
      [messageKey, numero]
    )
    return r.rowCount > 0
  } catch (e) {
    console.warn('⚠️ Idempotência webhook (fail-open):', e.message)
    return true
  }
}

app.post('/webhook', async (req, res) => {
  if (!webhookAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  res.json({ ok: true })

  try {
    const event = req.body?.event
    if (event !== 'messages.upsert') return

    const msg = req.body?.data?.messages?.[0] || req.body?.data
    if (!msg) return

    const numero = canonicoRemoteJidParaConversa(msg.key) || msg.key?.remoteJid
    if (!numero) return
    if (/@lid$/i.test(numero) && !msg.key?.remoteJidAlt) {
      console.warn(
        '⚠️ Webhook: conversa só com @lid e sem remoteJidAlt — atualize a Evolution API ou aguarde evento com JID de telefone; comandos/DB podem falhar.'
      )
    }

    const fromMe = !!msg.key?.fromMe

    // Verifica se o remetente é qualquer operador autorizado (suporta lista separada por vírgula)
    const jidRemetente = jidOperadoresDoEnv().find(j => jidIgual(numero, j)) ?? null
    if (jidRemetente && !fromMe) {
      await processarComandosOperadorChat(msg, jidRemetente)
      return
    }

    if (fromMe) {
      if (isConversaLeadUmAUm(numero)) {
        await processarIntervencaoOperadorNoLead(msg, numero)
      }
      return
    }

    const chaveEvtPreMedia = construirChaveIdempotenciaWebhookMensagem(msg)
    if (!(await webhookMensagemDeveSerProcessada(chaveEvtPreMedia, numero))) {
      console.log(`Webhook ignorado (duplicata): ${String(chaveEvtPreMedia).slice(0, 72)}`)
      return
    }

    const { texto, visao } = await extrairTextoEMidiaDoWebhook(msg)
    if (!texto && !visao) return

    const chaveEvt = construirChaveIdempotenciaWebhookMensagem(msg)
    if (false && !(await webhookMensagemDeveSerProcessada(chaveEvt, numero))) {
      console.log(`↩️ Webhook ignorado (duplicata): ${String(chaveEvt).slice(0, 72)}`)
      return
    }

    const textoHistorico = texto || '(Cliente enviou conteúdo de mídia.)'
    const logLinha = textoHistorico.length > 200 ? `${textoHistorico.slice(0, 200)}…` : textoHistorico
    console.log(`📩 ${numero}: ${visao ? '[imagem] ' : ''}${logLinha}`)

    let conversa = await buscarConversa(numero)
    let historico = normalizarHistoricoMensagens(conversa?.historico)
    let estagio = conversa?.estagio || 'primeiro_contato'

    historico.push({ role: 'user', content: textoHistorico })
    await salvarConversa(numero, historico, estagio, conversa?.status || 'ativo')
    await cancelarFollowupsAutoPendentes(numero, 'lead_respondeu')
    if (textoPedePreco(textoHistorico)) {
      await registrarEventoComercial(numero, 'pediu_preco', {
        trecho: textoHistorico.slice(0, 200),
      })
    }
    await marcarRespostaFollowupSeAplicavel(numero)

    if (conversa?.agente_pausado) {
      console.log(`⏸️ Agente pausado para ${numero} — mensagem registrada, sem resposta automática.`)
      return
    }

    const stDeb = obterEstadoDebounceResposta(numero)
    if (visao) stDeb.visaoLote = visao
    if (stDeb.geracaoEmAndamento) {
      stDeb.pendenteAposGeracao = true
      return
    }
    await enfileirarJobRespostaWebhook(numero)
  } catch (err) {
    console.error('❌ Erro webhook:', err.response?.data || err.message)
  }
})

// ─── DASHBOARD API ────────────────────────────────────────────────────────────

const DASHBOARD_CONVERSA_SELECT = `
      SELECT c.numero, c.estagio, c.status, c.venda_fechada, c.agente_pausado, c.arquivado,
             c.motivo_arquivamento, c.arquivado_em,
             jsonb_array_length(c.historico) AS mensagens, c.criado_em, c.atualizado_em,
             c.ultima_falha_resposta_codigo, c.ultima_falha_resposta_msg, c.ultima_falha_resposta_em,
             p.negocio, p.apelido, p.cidade, p.preco_calculado, p.termometro_dor, p.temperatura_lead,
             COALESCE(p.preco_ia_divergente_motor, false) AS preco_ia_divergente_motor,
             p.ia_total_projeto_detectado_ultima_resposta,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN c.historico->-1->>'role'
                  ELSE NULL
             END AS ultima_role,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN LEFT(REGEXP_REPLACE(COALESCE(c.historico->-1->>'content', ''), '\\s+', ' ', 'g'), 180)
                  ELSE ''
             END AS ultima_preview,
             (
               SELECT MIN(fa.agendado_para)
               FROM vendas.followup_auto_agendamentos fa
               WHERE fa.numero = c.numero
                 AND fa.status = 'agendado'
             ) AS followup_auto_em,
             (
               SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (MIN(fa.agendado_para) - NOW())) / 60))::int
               FROM vendas.followup_auto_agendamentos fa
               WHERE fa.numero = c.numero
                 AND fa.status = 'agendado'
             ) AS followup_auto_minutos,
             GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.atualizado_em)) / 60))::int AS idade_minutos,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN (c.historico->-1->>'role') = 'user'
                  ELSE false
             END AS resposta_pendente,
             (c.ultima_falha_resposta_em IS NOT NULL) AS erro_resposta_pendente,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                       AND (c.historico->-1->>'role') = 'user'
                       AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                       AND (c.historico->-1->>'content')
                         ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                       AND (p.precificacao_json IS NULL)
                       AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                  THEN true ELSE false
             END AS lead_fila_preco_sem_calculo,
             CASE
               WHEN c.ultima_falha_resposta_em IS NOT NULL THEN 'falha_resposta'
               WHEN c.status = 'aguardando_handoff' THEN 'handoff'
               WHEN COALESCE(p.preco_ia_divergente_motor, false) = true THEN 'preco_divergente'
               WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                    AND (c.historico->-1->>'role') = 'user'
                    AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                    AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                    AND (p.precificacao_json IS NULL)
                    AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                 THEN 'fila_preco'
               WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                    AND (c.historico->-1->>'role') = 'user'
                 THEN 'precisa_responder'
               WHEN c.agente_pausado = true THEN 'agente_pausado'
               ELSE 'acompanhamento'
             END AS prioridade_operacional,
             ARRAY_REMOVE(ARRAY[
               CASE WHEN c.ultima_falha_resposta_em IS NOT NULL THEN 'Falha na resposta' END,
               CASE WHEN c.status = 'aguardando_handoff' THEN 'Handoff/aprovação' END,
               CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                         AND (c.historico->-1->>'role') = 'user'
                    THEN 'Precisa responder' END,
               CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                         AND (c.historico->-1->>'role') = 'user'
                         AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                         AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                         AND (p.precificacao_json IS NULL)
                         AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                    THEN 'Fila de preço' END,
               CASE WHEN COALESCE(p.preco_ia_divergente_motor, false) = true THEN 'Preço divergente' END,
               CASE WHEN c.agente_pausado = true THEN 'Agente pausado' END
             ], NULL) AS motivos_prioridade
      FROM vendas.conversas c
      LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
`

function parseDashboardListQuery(req, opts) {
  const q = req.query || {}
  const maxLimit = opts && typeof opts.maxLimit === 'number' ? opts.maxLimit : 500
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), maxLimit)
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0)
  const estagioRaw = q.estagio != null && String(q.estagio).trim() !== '' ? String(q.estagio).trim() : null
  const estagio = estagioRaw === 'todos' || estagioRaw === '' ? null : estagioRaw
  const desde = q.desde != null && String(q.desde).trim() !== '' ? String(q.desde).trim().slice(0, 10) : null
  const ate = q.ate != null && String(q.ate).trim() !== '' ? String(q.ate).trim().slice(0, 10) : null
  const ordenar = q.ordenar === 'criado' ? 'criado' : 'atualizado'
  const direcao = q.direcao === 'asc' ? 'asc' : 'desc'
  const filaPreco =
    q.fila_preco === '1' ||
    q.fila_preco === 'true' ||
    String(q.fila_preco || '')
      .trim()
      .toLowerCase() === 'sim'
  const precoDivergente =
    q.preco_divergente === '1' ||
    q.preco_divergente === 'true' ||
    String(q.preco_divergente || '')
      .trim()
      .toLowerCase() === 'sim'
  const busca = q.busca != null ? String(q.busca).trim() : null
  const motivo = q.motivo != null ? String(q.motivo).trim() : null
  const temperatura = q.temperatura != null ? String(q.temperatura).trim() : null
  const arquivado = q.arquivado === '1' || q.arquivado === 'true'
  return { limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente, busca, motivo, temperatura, arquivado }
}

/** WHERE para listagem/export; estagio === 'fechado' filtra vendas fechadas. */
function buildWhereConversasFiltros(estagio, desde, ate, extras = {}) {
  const parts = []
  const params = []
  let i = 1
  if (estagio === 'fechado') {
    parts.push('c.venda_fechada = true')
  } else if (estagio) {
    parts.push(`(c.venda_fechada = false AND c.estagio = $${i})`)
    params.push(estagio)
    i++
  }
  if (desde) {
    parts.push(`c.atualizado_em >= $${i}::date`)
    params.push(desde)
    i++
  }
  if (ate) {
    parts.push(`c.atualizado_em < ($${i}::date + interval '1 day')`)
    params.push(ate)
    i++
  }
  if (extras && extras.busca) {
    parts.push(`(c.numero ILIKE $${i} OR p.negocio ILIKE $${i} OR p.apelido ILIKE $${i})`)
    params.push(`%${extras.busca}%`)
    i++
  }
  if (extras && extras.temperatura) {
    parts.push(`p.temperatura_lead = $${i}`)
    params.push(extras.temperatura)
    i++
  }
  if (extras && extras.motivo) {
    // A coluna prioridade_operacional é calculada no SELECT, mas no WHERE usamos a lógica original
    const mot = extras.motivo
    if (mot === 'falha_resposta') parts.push('c.ultima_falha_resposta_em IS NOT NULL')
    else if (mot === 'handoff') parts.push("c.status = 'aguardando_handoff'")
    else if (mot === 'preco_divergente') parts.push('COALESCE(p.preco_ia_divergente_motor, false) = true')
    else if (mot === 'agente_pausado') parts.push('c.agente_pausado = true')
    else if (mot === 'acompanhamento') {
        parts.push(`(
            c.ultima_falha_resposta_em IS NULL AND 
            c.status != 'aguardando_handoff' AND 
            COALESCE(p.preco_ia_divergente_motor, false) = false AND 
            c.agente_pausado = false AND
            NOT (COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')
        )`)
    }
    else if (mot === 'precisa_responder') {
        parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')`)
    }
    else if (mot === 'fila_preco') {
        parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0
          AND (c.historico->-1->>'role') = 'user'
          AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
          AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
          AND (p.precificacao_json IS NULL)
          AND (p.preco_calculado IS NULL OR p.preco_calculado = 0))`)
    }
  }
  if (extras && extras.filaPreco) {
    parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0
      AND (c.historico->-1->>'role') = 'user'
      AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
      AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
      AND (p.precificacao_json IS NULL)
      AND (p.preco_calculado IS NULL OR p.preco_calculado = 0))`)
  }
  if (extras && extras.precoDivergente) {
    parts.push('COALESCE(p.preco_ia_divergente_motor, false) = true')
  }
  if (extras && extras.arquivado) {
    parts.push('c.arquivado = true')
  } else {
    parts.push('c.arquivado = false')
  }
  const where = parts.length ? parts.join(' AND ') : 'TRUE'
  return { where, params, nextParamIndex: i }
}

function csvEscapeCell(val) {
  if (val == null) return ''
  const s = String(val)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function parseDashboardAnalisesQuery(req) {
  const q = req.query || {}
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200)
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0)
  const numero = q.numero != null && String(q.numero).trim() !== '' ? normalizarNumeroParaJid(String(q.numero).trim()) : null
  const etapa = q.etapa != null && String(q.etapa).trim() !== '' ? String(q.etapa).trim().slice(0, 120) : null
  const sinalIa =
    q.sinal_ia != null && String(q.sinal_ia).trim() !== '' ? String(q.sinal_ia).trim().slice(0, 120) : null
  const desde = q.desde != null && String(q.desde).trim() !== '' ? String(q.desde).trim().slice(0, 10) : null
  const ate = q.ate != null && String(q.ate).trim() !== '' ? String(q.ate).trim().slice(0, 10) : null
  return { limit, offset, numero, etapa, sinalIa, desde, ate }
}

function buildWhereAnalisesFiltros(numero, etapa, sinalIa, desde, ate) {
  const parts = []
  const params = []
  let i = 1
  if (numero) {
    parts.push(`a.numero = $${i}`)
    params.push(numero)
    i++
  }
  if (etapa) {
    parts.push(`a.etapa = $${i}`)
    params.push(etapa)
    i++
  }
  if (sinalIa) {
    parts.push(`$${i} = ANY(COALESCE(a.sinais_melhoria_ia, '{}'::text[]))`)
    params.push(sinalIa)
    i++
  }
  if (desde) {
    parts.push(`a.criado_em >= $${i}::date`)
    params.push(desde)
    i++
  }
  if (ate) {
    parts.push(`a.criado_em < ($${i}::date + interval '1 day')`)
    params.push(ate)
    i++
  }
  return { where: parts.length ? parts.join(' AND ') : 'TRUE', params }
}

/** Detalhe de uma conversa para o dashboard (perfil do lead). Auth: x-reprocess-secret se REPROCESS_SECRET definido. */
app.get('/dashboard/conversa-detalhe', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.query?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({
      ok: false,
      erro: 'Parâmetro query "numero" (telefone ou JID) é obrigatório',
    })
  }
  try {
    const conversa = await buscarConversa(jid)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }
    const [
      { rows: perfilRows },
      { rows: lacunas },
      { rows: sugEstRows },
      analise_conversa,
      historico_analises,
      contextos,
      { rows: audioPendentes },
    ] = await Promise.all([
      pool.query('SELECT * FROM vendas.lead_profiles WHERE numero = $1', [jid]),
      pool.query(
        `SELECT id, tema_lacuna, detalhe_lacuna, criado_em, resolucao_nota, resolvido_em
         FROM vendas.conhecimento_lacunas WHERE numero = $1 ORDER BY criado_em DESC LIMIT 20`,
        [jid]
      ),
      pool.query(`SELECT DISTINCT estagio FROM vendas.conversas ORDER BY estagio ASC LIMIT 60`),
      buscarUltimaAnalisePosConversa(jid, conversa.estagio),
      buscarHistoricoAnalisesPosConversa(jid, 8),
      buscarLeadContextos(jid, 20),
      pool.query(
        `SELECT id, numero, message_key, mimetype, status, attempts, erro, transcricao, criado_em, atualizado_em, processado_em
         FROM vendas.audio_processamentos
         WHERE numero = $1 AND status <> 'processed'
         ORDER BY criado_em DESC
         LIMIT 20`,
        [jid]
      ),
    ])
    const perfil = perfilRows[0] || null
    const estagios_sugeridos = sugEstRows.map((r) => r.estagio).filter((e) => e != null && String(e).trim() !== '')
    const {
      numero,
      estagio,
      status,
      venda_fechada,
      agente_pausado,
      arquivado,
      motivo_arquivamento,
      arquivado_em,
      ultima_falha_resposta_codigo,
      ultima_falha_resposta_msg,
      ultima_falha_resposta_em,
      criado_em,
      atualizado_em,
    } = conversa
    res.json({
      ok: true,
      numero,
      estagio,
      status,
      venda_fechada,
      agente_pausado,
      arquivado,
      motivo_arquivamento,
      arquivado_em,
      erro_resposta_codigo: ultima_falha_resposta_codigo,
      erro_resposta_msg: ultima_falha_resposta_msg,
      erro_resposta_em: ultima_falha_resposta_em,
      criado_em,
      atualizado_em,
      perfil,
      lacunas,
      contextos,
      audio_pendentes: audioPendentes,
      analise_conversa,
      historico_analises,
      historico: sanitizarHistoricoParaRespostaDashboard(conversa.historico),
      estagios_sugeridos,
    })
  } catch (err) {
    console.error('❌ conversa-detalhe:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

const CONVERSA_META_STATUS = ['ativo', 'aguardando_handoff']

/**
 * Corrige metadados do funil (venda fechada, estágio, status) sem alterar histórico.
 * Auth: x-reprocess-secret se REPROCESS_SECRET definido.
 */
app.patch('/dashboard/conversa-meta', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  try {
    const conv = await buscarConversa(jid)
    if (!conv) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }

    const parts = []
    const vals = []

    if (Object.prototype.hasOwnProperty.call(req.body, 'venda_fechada')) {
      parts.push(`venda_fechada = $${vals.length + 1}`)
      vals.push(!!req.body.venda_fechada)
    }
    if (typeof req.body.estagio === 'string') {
      const raw = req.body.estagio.trim()
      if (raw.length > 0) {
        if (raw.length > 120 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw)) {
          return res.status(400).json({ ok: false, erro: 'Valor de estagio inválido' })
        }
        parts.push(`estagio = $${vals.length + 1}`)
        vals.push(raw.slice(0, 120))
      }
    }
    if (typeof req.body.status === 'string') {
      const st = req.body.status.trim()
      if (!CONVERSA_META_STATUS.includes(st)) {
        return res.status(400).json({
          ok: false,
          erro: `status deve ser um de: ${CONVERSA_META_STATUS.join(', ')}`,
        })
      }
      parts.push(`status = $${vals.length + 1}`)
      vals.push(st)
    }

    if (parts.length === 0) {
      return res.status(400).json({
        ok: false,
        erro: 'Envie ao menos um de: venda_fechada, estagio (texto não vazio), status',
      })
    }

    parts.push('atualizado_em = NOW()')
    vals.push(jid)
    const sql = `UPDATE vendas.conversas SET ${parts.join(', ')} WHERE numero = $${vals.length}`
    await pool.query(sql, vals)
    const c2 = await buscarConversa(jid)
    res.json({
      ok: true,
      numero: c2.numero,
      estagio: c2.estagio,
      status: c2.status,
      venda_fechada: c2.venda_fechada,
    })
  } catch (err) {
    console.error('❌ conversa-meta:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * Gera análise interna (coach + prompt Gamma). Auth: x-reprocess-secret se REPROCESS_SECRET definido.
 */
app.post('/dashboard/lead-coach', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.body?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ ok: false, erro: 'ANTHROPIC_KEY não configurada no servidor' })
  }
  try {
    const conversa = await buscarConversa(jid)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }
    const perfil = await buscarPerfil(jid)
    const coach = await chamarClaudeLeadCoach({ numero: jid, conversa, perfil })
    const analise = await salvarAnalisePosConversa(jid, coach, conversa)
    res.json({ ok: true, coach: analise?.coach || normalizarLeadCoachPayload(coach), analise })
  } catch (err) {
    console.error('❌ lead-coach:', err.response?.data || err.message)
    const msg =
      (err.response && err.response.data && err.response.data.error && err.response.data.error.message) ||
      err.message ||
      String(err)
    let code = 500
    if (String(msg).includes('ANTHROPIC_KEY')) code = 503
    else if (err.response && err.response.status === 429) code = 429
    else if (err.response && err.response.status >= 400 && err.response.status < 500) code = 502
    res.status(code).json({ ok: false, erro: msg })
  }
})

app.post('/dashboard/lead-contexto', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const conteudo = limparConteudoLeadContexto(req.body?.conteudo)
  if (!conteudo) return res.status(400).json({ ok: false, erro: 'Contexto vazio' })
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const contexto = await salvarLeadContexto(jid, {
      tipo: req.body?.tipo || 'contexto_manual',
      conteudo,
      origem: 'operador',
    })
    res.json({ ok: true, contexto })
  } catch (err) {
    console.error('POST lead-contexto:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.get('/dashboard/audio-pendentes', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.query?.numero === 'string' ? normalizarNumeroParaJid(req.query.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Parametro "numero" e obrigatorio' })
  try {
    const { rows } = await pool.query(
      `SELECT id, numero, message_key, mimetype, status, attempts, erro, criado_em, atualizado_em
       FROM vendas.audio_processamentos
       WHERE numero = $1 AND status <> 'processed'
       ORDER BY criado_em DESC
       LIMIT 50`,
      [jid]
    )
    res.json({ ok: true, audio_pendentes: rows })
  } catch (err) {
    console.error('GET audio-pendentes:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/audio-reprocessar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const id = parseInt(req.body?.id, 10)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, erro: 'Campo "id" invalido' })
  try {
    const { rows } = await pool.query('SELECT * FROM vendas.audio_processamentos WHERE id = $1', [id])
    const row = rows[0]
    if (!row) return res.status(404).json({ ok: false, erro: 'Audio pendente nao encontrado' })
    if (!row.web_message_info) {
      return res.status(422).json({ ok: false, erro: 'Audio antigo sem payload salvo; use upload manual no perfil do lead.' })
    }
    const msg = row.web_message_info
    const audioPart = localizarAudioPartMensagem(msg)
    const rAudio = await baixarETranscreverAudioMensagem(msg, audioPart)
    const contexto = await salvarLeadContexto(row.numero, {
      tipo: 'audio_reprocessado',
      origem: 'audio_reprocessado',
      conteudo: `[Audio antigo reprocessado]\n[Audio transcrito] ${rAudio.transcricao}`,
      metadata: { audio_processamento_id: row.id, message_key: row.message_key },
    })
    await pool.query(
      `UPDATE vendas.audio_processamentos
       SET status = 'processed', attempts = attempts + 1, erro = NULL, transcricao = $2,
           processado_em = NOW(), atualizado_em = NOW()
       WHERE id = $1`,
      [row.id, rAudio.transcricao]
    )
    res.json({ ok: true, contexto, transcricao: rAudio.transcricao })
  } catch (err) {
    console.error('POST audio-reprocessar:', err.response?.data || err.message)
    await pool.query(
      `UPDATE vendas.audio_processamentos
       SET status = 'pending', attempts = attempts + 1, erro = $2, atualizado_em = NOW()
       WHERE id = $1`,
      [id, resumirTextoOperacional(err.message || String(err), 800)]
    ).catch(() => {})
    res.status(500).json({ ok: false, erro: err.message || String(err) })
  }
})

app.post('/dashboard/audio-upload-contexto', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const rawB64 = limparBase64String(String(req.body?.base64 || ''))
  if (!rawB64) return res.status(400).json({ ok: false, erro: 'Arquivo de audio ausente' })
  let buffer
  try {
    buffer = Buffer.from(rawB64, 'base64')
  } catch (_) {
    return res.status(400).json({ ok: false, erro: 'Audio em base64 invalido' })
  }
  if (!buffer.length) return res.status(400).json({ ok: false, erro: 'Arquivo de audio vazio' })
  if (buffer.length > AUDIO_UPLOAD_MAX_BYTES) {
    return res.status(413).json({ ok: false, erro: 'Audio muito grande para upload manual' })
  }
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const mimetype = String(req.body?.mimetype || 'audio/ogg').split(';')[0].trim() || 'audio/ogg'
    const filename = String(req.body?.filename || 'audio-upload').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'audio-upload'
    const transcricao = await transcreverAudioLocal(buffer, filename, mimetype)
    if (!transcricao || !transcricao.trim()) throw new Error('Whisper retornou transcricao vazia')
    const contexto = await salvarLeadContexto(jid, {
      tipo: 'audio_upload',
      origem: 'operador_upload',
      conteudo: `[Audio anexado manualmente pelo operador: ${filename}]\n[Audio transcrito] ${transcricao.trim()}`,
      metadata: { filename, mimetype, bytes: buffer.length },
    })
    res.json({ ok: true, contexto, transcricao: transcricao.trim() })
  } catch (err) {
    console.error('POST audio-upload-contexto:', err.response?.data || err.message)
    res.status(500).json({ ok: false, erro: err.message || String(err) })
  }
})

app.get('/dashboard/data', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const { limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente, busca, motivo, temperatura, arquivado } =
      parseDashboardListQuery(req)
    const { where, params: wparams } = buildWhereConversasFiltros(estagio, desde, ate, {
      filaPreco,
      precoDivergente,
      busca,
      motivo,
      temperatura,
      arquivado,
    })
    const orderCol = ordenar === 'criado' ? 'c.criado_em' : 'c.atualizado_em'
    const orderDir = direcao === 'asc' ? 'ASC' : 'DESC'

    const listParams = [...wparams, limit, offset]
    const listSql = `
      ${DASHBOARD_CONVERSA_SELECT}
      WHERE ${where}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${wparams.length + 1} OFFSET $${wparams.length + 2}
    `
    const countSql = `
      SELECT COUNT(*)::bigint AS n
      FROM vendas.conversas c
      LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
      WHERE ${where}
    `

    const [
      { rows: conversas },
      { rows: countRows },
      { rows: totais },
      { rows: estagioRows },
      aprendizado,
      { rows: lacunasAbertas },
    ] = await Promise.all([
      pool.query(listSql, listParams),
      pool.query(countSql, wparams),
      pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN venda_fechada THEN 1 ELSE 0 END) as fechadas,
             SUM(CASE WHEN status = 'aguardando_handoff' THEN 1 ELSE 0 END) as handoffs
      FROM vendas.conversas
    `),
      pool.query(`
      SELECT DISTINCT estagio FROM vendas.conversas WHERE venda_fechada = false ORDER BY estagio
    `),
      buscarUltimoAprendizado(),
      pool.query(`
      SELECT l.id, l.numero, l.tema_lacuna, l.detalhe_lacuna, l.criado_em, p.negocio AS negocio_lead
      FROM vendas.conhecimento_lacunas l
      LEFT JOIN vendas.lead_profiles p ON p.numero = l.numero
      WHERE l.resolvido_em IS NULL
      ORDER BY l.criado_em DESC
      LIMIT 15
    `),
    ])

    const totalFiltrado = parseInt(countRows[0].n, 10)
    const estagios_disponiveis = ['fechado', ...estagioRows.map((r) => r.estagio)]

    res.json({
      total: parseInt(totais[0].total, 10),
      fechadas: parseInt(totais[0].fechadas, 10),
      handoffs: parseInt(totais[0].handoffs, 10),
      taxa_conversao:
        totais[0].total > 0 ? ((totais[0].fechadas / totais[0].total) * 100).toFixed(1) : '0.0',
      conversas,
      aprendizado,
      filtro: {
        estagio: estagio || null,
        desde: desde || null,
        ate: ate || null,
        busca: busca || null,
        motivo: motivo || null,
        temperatura: temperatura || null,
        limit,
        offset,
        ordenar,
        direcao,
        total_filtrado: totalFiltrado,
        fila_preco: !!filaPreco,
        preco_divergente: !!precoDivergente,
        arquivado: !!arquivado,
      },
      estagios_disponiveis,
      lacunas_abertas_recentes: lacunasAbertas,
    })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

function parseDashboardDiasQuery(req) {
  const raw = req.query && req.query.dias != null ? parseInt(String(req.query.dias), 10) : NaN
  return Math.min(366, Math.max(1, Number.isFinite(raw) ? raw : 30))
}

/** USD por 1M tokens (entrada/saída). Opcional: LLM_USD_BRL para estimativa em reais. */
function parseLlmPricingEnv() {
  const inPerM = parseFloat(String(process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD || '').trim())
  const outPerM = parseFloat(String(process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD || '').trim())
  const usdBrl = parseFloat(String(process.env.LLM_USD_BRL || '').trim())
  const ok =
    Number.isFinite(inPerM) && inPerM >= 0 && Number.isFinite(outPerM) && outPerM >= 0
  return {
    ok,
    inPerM: ok ? inPerM : 0,
    outPerM: ok ? outPerM : 0,
    usdBrl: Number.isFinite(usdBrl) && usdBrl > 0 ? usdBrl : null,
  }
}

function estimativaCustoLlm(inputTokens, outputTokens, pricing) {
  const inT = Number(inputTokens) || 0
  const outT = Number(outputTokens) || 0
  if (!pricing || !pricing.ok) return null
  const usd = (inT / 1e6) * pricing.inPerM + (outT / 1e6) * pricing.outPerM
  const out = { usd }
  if (pricing.usdBrl != null) out.brl = usd * pricing.usdBrl
  return out
}

/** Série diária: novas conversas (criação) e fechadas (atualização com venda_fechada). Auth: x-reprocess-secret. */
app.get('/dashboard/stats/diario', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  try {
    const { rows } = await pool.query(
      `
      WITH bounds AS (
        SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1
      ),
      days AS (
        SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
        FROM bounds b
      ),
      novas AS (
        SELECT date_trunc('day', c.criado_em)::date AS dia, COUNT(*)::int AS n
        FROM vendas.conversas c, bounds b
        WHERE c.criado_em::date >= b.d0 AND c.criado_em::date <= b.d1
        GROUP BY 1
      ),
      fechadas AS (
        SELECT date_trunc('day', c.atualizado_em)::date AS dia, COUNT(*)::int AS n
        FROM vendas.conversas c, bounds b
        WHERE c.venda_fechada = true
          AND c.atualizado_em::date >= b.d0 AND c.atualizado_em::date <= b.d1
        GROUP BY 1
      )
      SELECT d.dia::text AS dia, COALESCE(n.n, 0) AS novas, COALESCE(f.n, 0) AS fechadas
      FROM days d
      LEFT JOIN novas n ON n.dia = d.dia
      LEFT JOIN fechadas f ON f.dia = d.dia
      ORDER BY d.dia
      `,
      [dias]
    )
    res.json({
      serie: rows.map((r) => ({ dia: r.dia, novas: r.novas, fechadas: r.fechadas })),
      nota_fechadas_diario:
        'Fechadas: contagem por dia de atualizado_em com venda_fechada = true (aproxima o dia em que a venda foi marcada).',
    })
  } catch (err) {
    console.error('❌ GET stats/diario:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Métricas agregadas e série diária de follow-ups manuais. Auth: x-reprocess-secret. */
app.get('/dashboard/stats/followup', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  try {
    const [{ rows: sumRows }, { rows: serieRows }] = await Promise.all([
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT
          COUNT(*) FILTER (WHERE f.envio_ok) AS enviados_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.resposta_lead_em IS NOT NULL) AS com_resposta,
          COUNT(*) FILTER (WHERE NOT f.envio_ok) AS falhas_envio,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'reengajamento') AS rej_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'reengajamento' AND f.resposta_lead_em IS NOT NULL) AS rej_resp,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'fluxo_funil') AS fun_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'fluxo_funil' AND f.resposta_lead_em IS NOT NULL) AS fun_resp
        FROM vendas.followup_envios f, bounds b
        WHERE f.criado_em::date >= b.d0 AND f.criado_em::date <= b.d1
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1),
        days AS (
          SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
          FROM bounds b
        ),
        agg AS (
          SELECT date_trunc('day', f.criado_em)::date AS dia,
                 COUNT(*) FILTER (WHERE f.envio_ok)::int AS enviados_ok,
                 COUNT(*) FILTER (WHERE f.envio_ok AND f.resposta_lead_em IS NOT NULL)::int AS com_resposta
          FROM vendas.followup_envios f, bounds b
          WHERE f.criado_em::date >= b.d0 AND f.criado_em::date <= b.d1
          GROUP BY 1
        )
        SELECT d.dia::text AS dia, COALESCE(a.enviados_ok, 0) AS enviados_ok, COALESCE(a.com_resposta, 0) AS com_resposta
        FROM days d
        LEFT JOIN agg a ON a.dia = d.dia
        ORDER BY d.dia
        `,
        [dias]
      ),
    ])
    const s = sumRows[0] || {}
    const envOk = parseInt(s.enviados_ok, 10) || 0
    const comResp = parseInt(s.com_resposta, 10) || 0
    const taxa =
      envOk > 0 ? Math.round((10000 * comResp) / envOk) / 100 : 0
    res.json({
      ok: true,
      resumo: {
        enviados_ok: envOk,
        com_resposta: comResp,
        taxa_resposta_pct: taxa,
        falhas_envio: parseInt(s.falhas_envio, 10) || 0,
        por_modo: {
          reengajamento: {
            enviados_ok: parseInt(s.rej_ok, 10) || 0,
            com_resposta: parseInt(s.rej_resp, 10) || 0,
          },
          fluxo_funil: {
            enviados_ok: parseInt(s.fun_ok, 10) || 0,
            com_resposta: parseInt(s.fun_resp, 10) || 0,
          },
        },
      },
      serie_diaria: serieRows.map((r) => ({
        dia: r.dia,
        enviados_ok: r.enviados_ok,
        com_resposta: r.com_resposta,
      })),
      nota:
        'Taxa de resposta = com_resposta / enviados_ok no período (só envios com envio_ok). ' +
        'Reengajamento: última mensagem era assistente/operador. Continuar no funil: última mensagem era do lead.',
    })
  } catch (err) {
    console.error('❌ GET stats/followup:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * Uso agregado de chamadas LLM (vendas.llm_chamadas): tokens, séries e breakdown.
 * Estimativa em USD/BRL opcional via LLM_ESTIMATE_INPUT_PER_MTOK_USD, LLM_ESTIMATE_OUTPUT_PER_MTOK_USD, LLM_USD_BRL.
 * Auth: x-reprocess-secret.
 */
app.get('/dashboard/stats/llm-uso', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  const pricing = parseLlmPricingEnv()
  try {
    const [
      { rows: periodoRows },
      { rows: totaisRows },
      { rows: serieRows },
      { rows: tipoRows },
      { rows: modelRows },
    ] = await Promise.all([
      pool.query(
        `SELECT (CURRENT_DATE - ($1::int - 1))::date::text AS d0, CURRENT_DATE::date::text AS d1`,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT
          COUNT(*)::bigint AS chamadas,
          COUNT(*) FILTER (WHERE NOT l.http_ok)::bigint AS chamadas_erro,
          COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'cache_creation_input_tokens')::bigint, 0)), 0)::text AS cache_creation_input_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'cache_read_input_tokens')::bigint, 0)), 0)::text AS cache_read_input_tokens,
          COALESCE(AVG(l.duration_ms) FILTER (WHERE l.duration_ms IS NOT NULL), 0)::numeric AS avg_duration_ms
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1),
        days AS (
          SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
          FROM bounds b
        ),
        agg AS (
          SELECT date_trunc('day', l.criado_em)::date AS dia,
                 COUNT(*)::int AS chamadas,
                 COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
                 COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
          FROM vendas.llm_chamadas l, bounds b
          WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
          GROUP BY 1
        )
        SELECT d.dia::text AS dia,
               COALESCE(a.chamadas, 0) AS chamadas,
               COALESCE(a.input_tokens, '0') AS input_tokens,
               COALESCE(a.output_tokens, '0') AS output_tokens
        FROM days d
        LEFT JOIN agg a ON a.dia = d.dia
        ORDER BY d.dia
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT COALESCE(l.tipo, '') AS tipo,
               COUNT(*)::bigint AS chamadas,
               COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
               COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        GROUP BY l.tipo
        ORDER BY chamadas DESC
        LIMIT 80
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT COALESCE(l.model, '') AS model,
               COUNT(*)::bigint AS chamadas,
               COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
               COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        GROUP BY l.model
        ORDER BY chamadas DESC
        LIMIT 80
        `,
        [dias]
      ),
    ])

    const p0 = periodoRows[0] || {}
    const t0 = totaisRows[0] || {}
    const inputTokens = parseInt(String(t0.input_tokens || '0'), 10) || 0
    const outputTokens = parseInt(String(t0.output_tokens || '0'), 10) || 0
    const estimativa = estimativaCustoLlm(inputTokens, outputTokens, pricing)

    res.json({
      ok: true,
      periodo: { dias, d0: p0.d0 || null, d1: p0.d1 || null },
      totais: {
        chamadas: parseInt(String(t0.chamadas || '0'), 10) || 0,
        chamadas_erro: parseInt(String(t0.chamadas_erro || '0'), 10) || 0,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: parseInt(String(t0.cache_creation_input_tokens || '0'), 10) || 0,
        cache_read_input_tokens: parseInt(String(t0.cache_read_input_tokens || '0'), 10) || 0,
        avg_duration_ms: t0.avg_duration_ms != null ? Number(t0.avg_duration_ms) : 0,
      },
      estimativa,
      precificacao_env_configurada: pricing.ok,
      serie_diaria: serieRows.map((r) => ({
        dia: r.dia,
        chamadas: r.chamadas,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      por_tipo: tipoRows.map((r) => ({
        tipo: r.tipo,
        chamadas: parseInt(String(r.chamadas || '0'), 10) || 0,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      por_model: modelRows.map((r) => ({
        model: r.model,
        chamadas: parseInt(String(r.chamadas || '0'), 10) || 0,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      nota:
        'Tokens somados a partir do JSON usage gravado em cada chamada. Estimativa em USD/BRL só aparece se LLM_ESTIMATE_INPUT_PER_MTOK_USD e LLM_ESTIMATE_OUTPUT_PER_MTOK_USD estiverem definidos; LLM_USD_BRL é opcional.',
    })
  } catch (err) {
    console.error('❌ GET stats/llm-uso:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Últimos registros de follow-up manual. Auth: x-reprocess-secret. */
app.get('/dashboard/followup-recentes', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const lim = Math.min(500, Math.max(1, parseInt(String(req.query?.limit || '40'), 10) || 40))
  try {
    const { rows } = await pool.query(
      `
      SELECT criado_em, numero, modo, envio_ok, resposta_lead_em, mensagem_preview
      FROM vendas.followup_envios
      ORDER BY criado_em DESC
      LIMIT $1
      `,
      [lim]
    )
    res.json({
      ok: true,
      itens: rows.map((r) => ({
        criado_em: r.criado_em,
        numero: r.numero,
        modo: r.modo,
        envio_ok: r.envio_ok,
        resposta_lead_em: r.resposta_lead_em,
        mensagem_preview: r.mensagem_preview,
      })),
    })
  } catch (err) {
    console.error('❌ GET followup-recentes:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Exporta conversas filtradas como CSV (mesmos filtros que /dashboard/data). Auth: x-reprocess-secret. */
app.get('/dashboard/export.csv', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const { limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente } =
      parseDashboardListQuery(req, {
        maxLimit: 20000,
      })
    const { where, params: wparams } = buildWhereConversasFiltros(estagio, desde, ate, {
      filaPreco,
      precoDivergente,
    })
    const orderCol = ordenar === 'criado' ? 'c.criado_em' : 'c.atualizado_em'
    const orderDir = direcao === 'asc' ? 'ASC' : 'DESC'
    const listParams = [...wparams, limit, offset]
    const listSql = `
      ${DASHBOARD_CONVERSA_SELECT}
      WHERE ${where}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${wparams.length + 1} OFFSET $${wparams.length + 2}
    `
    const { rows } = await pool.query(listSql, listParams)
    const cols = [
      'numero',
      'estagio',
      'status',
      'venda_fechada',
      'agente_pausado',
      'mensagens',
      'criado_em',
      'atualizado_em',
      'negocio',
      'cidade',
      'preco_calculado',
      'termometro_dor',
      'temperatura_lead',
      'preco_ia_divergente_motor',
      'ia_total_projeto_detectado_ultima_resposta',
      'lead_fila_preco_sem_calculo',
      'resposta_pendente',
      'erro_resposta_pendente',
      'ultima_falha_resposta_codigo',
      'ultima_falha_resposta_msg',
      'ultima_falha_resposta_em',
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="conversas-dashboard.csv"')
    res.write(cols.join(',') + '\n')
    for (const row of rows) {
      const line =
        cols
          .map((k) => csvEscapeCell(row[k]))
          .join(',') + '\n'
      res.write(line)
    }
    res.end()
  } catch (err) {
    console.error('❌ GET export.csv:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ ok: false, erro: err.message })
    } else {
      res.end()
    }
  }
})

/** Lista análises por etapa com filtros úteis para revisão operacional. */
app.get('/dashboard/analises-etapas', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const { limit, offset, numero, etapa, sinalIa, desde, ate } = parseDashboardAnalisesQuery(req)
    const { where, params } = buildWhereAnalisesFiltros(numero, etapa, sinalIa, desde, ate)
    const listParams = [...params, limit, offset]
    const [
      { rows },
      { rows: countRows },
      { rows: etapasRows },
      { rows: sinaisRows },
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          a.id, a.numero, a.etapa, a.status_conversa, a.resumo_problema,
          a.o_que_faltou_para_vender, a.melhorias_para_ia, a.sinais_melhoria_ia,
          a.acoes_de_preparo, a.confianca_analise, a.criado_em, a.atualizado_em,
          p.negocio, p.cidade
        FROM vendas.analises_pos_conversa a
        LEFT JOIN vendas.lead_profiles p ON p.numero = a.numero
        WHERE ${where}
        ORDER BY a.criado_em DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        listParams
      ),
      pool.query(`SELECT COUNT(*)::bigint AS n FROM vendas.analises_pos_conversa a WHERE ${where}`, params),
      pool.query(`SELECT DISTINCT etapa FROM vendas.analises_pos_conversa ORDER BY etapa ASC LIMIT 100`),
      pool.query(
        `
        SELECT DISTINCT unnest(COALESCE(sinais_melhoria_ia, '{}'::text[])) AS sinal
        FROM vendas.analises_pos_conversa
        WHERE COALESCE(array_length(sinais_melhoria_ia, 1), 0) > 0
        ORDER BY sinal ASC
        LIMIT 100
        `
      ),
    ])

    res.json({
      ok: true,
      analises: rows.map((row) => hidratarAnalisePosConversa(row)),
      filtro: {
        numero,
        etapa,
        sinal_ia: sinalIa,
        desde,
        ate,
        limit,
        offset,
        total_filtrado: parseInt(countRows[0]?.n || '0', 10),
      },
      etapas_disponiveis: etapasRows.map((r) => r.etapa).filter(Boolean),
      sinais_ia_disponiveis: sinaisRows.map((r) => r.sinal).filter(Boolean),
    })
  } catch (err) {
    console.error('❌ GET analises-etapas:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── FOLLOW-UP MANUAL (dashboard) ─────────────────────────────────────────────

/**
 * POST /dashboard/followup
 * Body: { numero: string } ou { numeros: string[] } para lote, + instrucao opcional.
 */
app.post('/dashboard/followup', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const instrucao =
    typeof req.body.instrucao === 'string' && req.body.instrucao.trim()
      ? req.body.instrucao.trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
      : null

  // Lote
  if (Array.isArray(req.body.numeros) && req.body.numeros.length > 0) {
    const numeros = req.body.numeros
      .map((n) => normalizarNumeroParaJid(n))
      .filter(Boolean)
      .slice(0, FOLLOWUP_LOTE_MAX_ITENS)
    if (numeros.length === 0) {
      return res.status(400).json({ ok: false, erro: 'Nenhum número válido no lote.' })
    }
    const resultados = []
    let enviados = 0
    let falhas = 0
    for (const num of numeros) {
      try {
        const info = await executarFollowupUmNumero(num, instrucao)
        resultados.push({ numero: num, ok: true, trecho: (info && info.trecho_resposta) || '' })
        enviados++
      } catch (e) {
        resultados.push({ numero: num, ok: false, erro: (e && e.message) || String(e) })
        falhas++
      }
    }
    return res.json({ ok: true, resultados, resumo: { enviados, falhas, total: numeros.length } })
  }

  // Único
  const numero = normalizarNumeroParaJid(req.body.numero)
  if (!numero) {
    return res.status(400).json({ ok: false, erro: 'Parâmetro "numero" inválido ou ausente.' })
  }
  try {
    const info = await executarFollowupUmNumero(numero, instrucao)
    res.json({ ok: true, trecho: (info && info.trecho_resposta) || '' })
  } catch (err) {
    console.error('❌ POST followup:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── REPROCESSAR (dashboard) ──────────────────────────────────────────────────

/**
 * POST /dashboard/reprocessar — reenvia a última resposta do agente para um JID.
 * Útil quando o envio ao WhatsApp falhou mas o histórico já tem a resposta.
 */
app.post('/dashboard/reprocessar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const numero = normalizarNumeroParaJid(req.body.numero)
  if (!numero) {
    return res.status(400).json({ ok: false, erro: 'Parâmetro "numero" inválido ou ausente.' })
  }
  try {
    const conversa = await buscarConversa(numero)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada.' })
    }
    const historicoBruto = normalizarHistoricoMensagens(conversa.historico)
    const estagio = conversa.estagio || 'primeiro_contato'
    const info = await gerarEEnviarRespostaWhatsapp(
      numero,
      historicoBruto,
      estagio,
      conversa,
      null
    )
    await limparFalhaResposta(numero)
    res.json({ ok: true, trecho: (info && info.trecho_resposta) || '' })
  } catch (err) {
    const errData = err.response?.data
    console.error('❌ POST reprocessar:', err.message, errData ? JSON.stringify(errData) : '')
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// NOTE: rota PATCH /dashboard/conversa-meta canônica está definida acima (~linha 3369)
// com validação de whitelist de status, limite de tamanho em estagio e retorno da conversa atualizada.
// Esta versão duplicada foi removida em 2026-04-23 (era dead code — Express registra na ordem,
// então só a primeira rota respondia).

/**
 * Lista lacunas de conhecimento (opcional: só abertas). Auth: x-reprocess-secret se REPROCESS_SECRET estiver definido.
 */
app.get('/dashboard/lacunas-conhecimento', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const soAbertas =
    req.query.abertas === '1' ||
    req.query.abertas === 'true' ||
    req.query.abertas === 1
  try {
    const where = soAbertas ? 'WHERE l.resolvido_em IS NULL' : ''
    const { rows } = await pool.query(
      `
      SELECT l.id, l.numero, l.tema_lacuna, l.detalhe_lacuna,
             l.criado_em, l.resolucao_nota, l.resolvido_em,
             p.negocio AS negocio_lead
      FROM vendas.conhecimento_lacunas l
      LEFT JOIN vendas.lead_profiles p ON p.numero = l.numero
      ${where}
      ORDER BY l.criado_em DESC
      LIMIT $1
      `,
      [limit]
    )
    res.json({ ok: true, lacunas: rows })
  } catch (err) {
    console.error('❌ GET lacunas-conhecimento:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── BOOT ─────────────────────────────────────────────────────────────────────

if (process.argv.includes('--smoke-precificacao')) {
  runSmokePrecificacao()
  process.exit(0)
}

// ─── Validação de secrets obrigatórios no boot ───────────────────────────────
// Falhar rapido se configuração crítica estiver ausente — melhor que rodar
// em produção com dashboard aberto ou sem chave Anthropic.
function validarSecretsBoot() {
  const faltando = []
  if (!process.env.REPROCESS_SECRET || String(process.env.REPROCESS_SECRET).trim().length < 8) {
    faltando.push('REPROCESS_SECRET (mínimo 8 caracteres — protege /dashboard/*)')
  }
  if (!process.env.ANTHROPIC_KEY) {
    faltando.push('ANTHROPIC_KEY (obrigatória para o agente responder)')
  }
  if (faltando.length > 0) {
    console.error('❌ Boot abortado: variáveis de ambiente obrigatórias ausentes:')
    for (const f of faltando) console.error(`   - ${f}`)
    console.error('Configure em .env ou docker-compose.yml e reinicie.')
    process.exit(1)
  }
}

function iniciarServidor() {
  validarSecretsBoot()

  loadSystemPrompt()
  loadFollowupPrompt()
  loadFollowupTimingPrompt()
  loadLeadCoachPrompt()
  loadEmpresaKnowledge()
  loadCasesCatalog()

  initDB()
    .then(() => {
      iniciarJobWorker()
      iniciarSilenceWatcher()
      const PORT = process.env.PORT || 3000
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 PJ Codeworks Agent rodando na porta ${PORT}`)
      })
    })
    .catch((err) => {
      console.error('❌ Falha ao iniciar banco:', err.message)
      process.exit(1)
    })
}

if (require.main === module) {
  iniciarServidor()
}

module.exports = {
  app,
  calcularPreco,
  diagnosticoCompletoParaPreco,
  contarPedidosPrecoDoLead,
  parsearRespostaJsonClaude,
  normalizarParsedRespostaVendas,
  resultadoParseadoParaObjeto,
  normalizarAgendarFollowupAuto,
  textoPedePreco,
  reprocessarAutorizado,
  webhookAutorizado,
  buildWhereConversasFiltros,
  montarBlocoContextoInterno,
  dadosPreviewSite,
  montarPromptWireframe,
  escolherEstiloWireframe,
  gerarWireframeComGPT,
  caseDeReferenciaPorNicho,
  montarPreviewSiteCaption,
  montarPreviewSiteHtml,
  montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup,
}



