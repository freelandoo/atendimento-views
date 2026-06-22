'use strict'
const fs = require('fs')
const path = require('path')
const { logger } = require('./logger')
const ROOT = path.join(__dirname, '..')

let SYSTEM_PROMPT_BASE = ''
let SYSTEM_CORE_BASE = ''
let SYSTEM_PRIMEIRO_CONTATO_BASE = ''
let SYSTEM_DIAGNOSTICO_BASE = ''
let SYSTEM_PROPOSTA_BASE = ''
let SYSTEM_OBJECAO_BASE = ''
let SYSTEM_FECHAMENTO_BASE = ''
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
/** Classificador de intenção via IA (prompts/classificador-intencao.md). */
let CLASSIFICADOR_INTENCAO_BASE = ''
/**
 * Tom de referência compartilhado por TODOS os prompts de etapa.
 * Bloco curto com 1-2 exemplos validados pela equipe — anexado em runtime
 * via `withTomReferencia()`. Mantemos UM unico arquivo pra evitar inflar
 * cada system prompt individualmente.
 */
let TOM_REFERENCIA_BASE = ''

function loadSystemPrompt() {
  const p = path.join(ROOT, 'prompts', 'system.md')
  if (fs.existsSync(p)) {
    SYSTEM_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    logger.info('✅ prompts/system.md carregado')
  } else {
    SYSTEM_PROMPT_BASE = ''
    logger.warn('⚠️ prompts/system.md não encontrado — usando fallback mínimo no chamarClaude')
  }
}

function loadFollowupPrompt() {
  const p = path.join(ROOT, 'prompts', 'followup.md')
  if (fs.existsSync(p)) {
    FOLLOWUP_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    logger.info('✅ prompts/followup.md carregado')
  } else {
    FOLLOWUP_PROMPT_BASE = ''
    logger.warn('⚠️ prompts/followup.md não encontrado — usando fallback mínimo no follow-up')
  }
}

function loadFollowupTimingPrompt() {
  const p = path.join(ROOT, 'prompts', 'followup_timing.md')
  if (fs.existsSync(p)) {
    FOLLOWUP_TIMING_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    logger.info('prompts/followup_timing.md carregado')
  } else {
    FOLLOWUP_TIMING_PROMPT_BASE = ''
    logger.warn('prompts/followup_timing.md nao encontrado - usando fallback de timing')
  }
}

function loadLeadCoachPrompt() {
  const p = path.join(ROOT, 'prompts', 'lead-coach.md')
  if (fs.existsSync(p)) {
    LEAD_COACH_PROMPT_BASE = fs.readFileSync(p, 'utf8')
    logger.info('✅ prompts/lead-coach.md carregado')
  } else {
    LEAD_COACH_PROMPT_BASE = ''
    logger.warn('⚠️ prompts/lead-coach.md não encontrado — usando fallback mínimo no lead-coach')
  }
}

function loadEmpresaKnowledge() {
  const p = path.join(ROOT, 'prompts', 'empresa.md')
  if (fs.existsSync(p)) {
    EMPRESA_KNOWLEDGE_BASE = fs.readFileSync(p, 'utf8')
    logger.info('✅ prompts/empresa.md carregado (conhecimento autorizado)')
  } else {
    EMPRESA_KNOWLEDGE_BASE = ''
    logger.warn('⚠️ prompts/empresa.md não encontrado — agente sem bloco de empresa/cases')
  }
}

function loadSystemCorePrompt() {
  const p = path.join(ROOT, 'prompts', 'system-core.md')
  if (fs.existsSync(p)) { SYSTEM_CORE_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-core.md carregado') }
  else { SYSTEM_CORE_BASE = ''; logger.warn('⚠️ prompts/system-core.md não encontrado') }
}

function loadSystemPrimeiroContatoPrompt() {
  const p = path.join(ROOT, 'prompts', 'system-primeiro-contato.md')
  if (fs.existsSync(p)) { SYSTEM_PRIMEIRO_CONTATO_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-primeiro-contato.md carregado') }
  else { SYSTEM_PRIMEIRO_CONTATO_BASE = ''; logger.warn('⚠️ prompts/system-primeiro-contato.md não encontrado') }
}

function loadSystemDiagnosticoPrompt() {
  const p = path.join(ROOT, 'prompts', 'system-diagnostico.md')
  if (fs.existsSync(p)) { SYSTEM_DIAGNOSTICO_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-diagnostico.md carregado') }
  else { SYSTEM_DIAGNOSTICO_BASE = ''; logger.warn('⚠️ prompts/system-diagnostico.md não encontrado') }
}

function loadSystemPropostaPrompt() {
  const p = path.join(ROOT, 'prompts', 'system-proposta.md')
  if (fs.existsSync(p)) { SYSTEM_PROPOSTA_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-proposta.md carregado') }
  else { SYSTEM_PROPOSTA_BASE = ''; logger.warn('⚠️ prompts/system-proposta.md não encontrado') }
}

function loadSystemObjecaoPrompt() {
  const p = path.join(ROOT, 'prompts', 'system-objecao.md')
  if (fs.existsSync(p)) { SYSTEM_OBJECAO_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-objecao.md carregado') }
  else { SYSTEM_OBJECAO_BASE = ''; logger.warn('⚠️ prompts/system-objecao.md não encontrado') }
}

function loadSystemFechamentoPrompt() {
  const p = path.join(ROOT, 'prompts', 'system-fechamento.md')
  if (fs.existsSync(p)) { SYSTEM_FECHAMENTO_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/system-fechamento.md carregado') }
  else { SYSTEM_FECHAMENTO_BASE = ''; logger.warn('⚠️ prompts/system-fechamento.md não encontrado') }
}

function loadClassificadorIntencao() {
  const p = path.join(ROOT, 'prompts', 'classificador-intencao.md')
  if (fs.existsSync(p)) { CLASSIFICADOR_INTENCAO_BASE = fs.readFileSync(p, 'utf8'); logger.info('✅ prompts/classificador-intencao.md carregado') }
  else { CLASSIFICADOR_INTENCAO_BASE = ''; logger.warn('⚠️ prompts/classificador-intencao.md não encontrado') }
}

function loadTomReferenciaPrompt() {
  const p = path.join(ROOT, 'prompts', 'tom-referencia.md')
  if (fs.existsSync(p)) {
    TOM_REFERENCIA_BASE = fs.readFileSync(p, 'utf8')
    logger.info('✅ prompts/tom-referencia.md carregado (few-shot compartilhado)')
  } else {
    TOM_REFERENCIA_BASE = ''
    logger.warn('⚠️ prompts/tom-referencia.md não encontrado — bot sem few-shot de tom')
  }
}

/**
 * Anexa o bloco de tom-referencia ao final de qualquer prompt de etapa.
 * Mantemos um separador visual claro para o modelo entender que sao
 * exemplos de tom, nao regras adicionais. Idempotente.
 */
function withTomReferencia(base) {
  const conteudo = String(base || '')
  if (!TOM_REFERENCIA_BASE) return conteudo
  if (conteudo.includes('# Tom de referência —')) return conteudo
  return `${conteudo}\n\n---\n\n${TOM_REFERENCIA_BASE}`
}

function loadCasesCatalog() {
  const p = path.join(ROOT, 'knowledge', 'cases.json')
  if (fs.existsSync(p)) {
    try {
      CASES_CATALOG = JSON.parse(fs.readFileSync(p, 'utf8'))
      const n = Array.isArray(CASES_CATALOG?.casos) ? CASES_CATALOG.casos.length : 0
      logger.info(`✅ knowledge/cases.json carregado (${n} casos)`)
    } catch (e) {
      CASES_CATALOG = null
      logger.warn('⚠️ knowledge/cases.json inválido:', e.message)
    }
  } else {
    CASES_CATALOG = null
    logger.warn('⚠️ knowledge/cases.json não encontrado')
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

/** Chaves permitidas para overlay em vendas.prompt_overlays (alinhado aos arquivos prompts/*.md). */
const CHAVES_PERMITIDAS = [
  'system', 'empresa', 'followup', 'followup_timing', 'lead-coach',
  'system-core', 'system-primeiro-contato', 'system-diagnostico',
  'system-proposta', 'system-objecao', 'system-fechamento',
]

const PROMPT_OVERLAY_MAX_BYTES = 65536

function normalizarChavePrompt(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return ''
  const mapLegacy = { 'follow-up': 'followup', followuptiming: 'followup_timing' }
  if (mapLegacy[s]) return mapLegacy[s]
  return CHAVES_PERMITIDAS.includes(s) ? s : ''
}

function aplicarMemoriaPrompt(chave, texto) {
  const t = typeof texto === 'string' ? texto : ''
  switch (chave) {
    case 'system':
      SYSTEM_PROMPT_BASE = t
      break
    case 'empresa':
      EMPRESA_KNOWLEDGE_BASE = t
      break
    case 'followup':
      FOLLOWUP_PROMPT_BASE = t
      break
    case 'followup_timing':
      FOLLOWUP_TIMING_PROMPT_BASE = t
      break
    case 'lead-coach':
      LEAD_COACH_PROMPT_BASE = t
      break
    case 'system-core':
      SYSTEM_CORE_BASE = t
      break
    case 'system-primeiro-contato':
      SYSTEM_PRIMEIRO_CONTATO_BASE = t
      break
    case 'system-diagnostico':
      SYSTEM_DIAGNOSTICO_BASE = t
      break
    case 'system-proposta':
      SYSTEM_PROPOSTA_BASE = t
      break
    case 'system-objecao':
      SYSTEM_OBJECAO_BASE = t
      break
    case 'system-fechamento':
      SYSTEM_FECHAMENTO_BASE = t
      break
    default:
      break
  }
}

function lerMemoriaPrompt(chave) {
  switch (chave) {
    case 'system':
      return SYSTEM_PROMPT_BASE
    case 'empresa':
      return EMPRESA_KNOWLEDGE_BASE
    case 'followup':
      return FOLLOWUP_PROMPT_BASE
    case 'followup_timing':
      return FOLLOWUP_TIMING_PROMPT_BASE
    case 'lead-coach':
      return LEAD_COACH_PROMPT_BASE
    case 'system-core':
      return SYSTEM_CORE_BASE
    case 'system-primeiro-contato':
      return SYSTEM_PRIMEIRO_CONTATO_BASE
    case 'system-diagnostico':
      return SYSTEM_DIAGNOSTICO_BASE
    case 'system-proposta':
      return SYSTEM_PROPOSTA_BASE
    case 'system-objecao':
      return SYSTEM_OBJECAO_BASE
    case 'system-fechamento':
      return SYSTEM_FECHAMENTO_BASE
    default:
      return ''
  }
}

/**
 * Após carregar arquivos .md, aplica overlays ativos do banco (initDB deve ter criado a tabela).
 * @param {import('pg').Pool} pool
 */
async function loadOverlaysFromDb(pool) {
  if (!pool || typeof pool.query !== 'function') return
  for (const chave of CHAVES_PERMITIDAS) {
    try {
      const { rows } = await pool.query(
        `SELECT conteudo FROM vendas.prompt_overlays WHERE chave = $1 AND ativo = true LIMIT 1`,
        [chave]
      )
      if (rows.length && typeof rows[0].conteudo === 'string') {
        aplicarMemoriaPrompt(chave, rows[0].conteudo)
        logger.info(`✅ prompt overlay ativo aplicado: ${chave}`)
      }
    } catch (e) {
      logger.warn(`⚠️ loadOverlaysFromDb(${chave}):`, e.message)
    }
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} chaveRaw
 */
async function getPromptAtual(pool, chaveRaw) {
  const chave = normalizarChavePrompt(chaveRaw)
  if (!chave) {
    const err = new Error('Chave de prompt inválida')
    err.code = 'CHAVE_INVALIDA'
    throw err
  }
  const conteudo = lerMemoriaPrompt(chave)
  const base = {
    chave,
    conteudo,
    origem: 'arquivo',
    id: null,
    version: null,
    autor: null,
    criado_em: null,
  }
  if (!pool || typeof pool.query !== 'function') return base
  const { rows } = await pool.query(
    `SELECT id, version, autor, criado_em FROM vendas.prompt_overlays WHERE chave = $1 AND ativo = true LIMIT 1`,
    [chave]
  )
  if (!rows.length) return base
  return {
    chave,
    conteudo,
    origem: 'banco',
    id: rows[0].id,
    version: rows[0].version,
    autor: rows[0].autor,
    criado_em: rows[0].criado_em,
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} chaveRaw
 * @param {number} [limite]
 */
async function listarHistoricoOverlay(pool, chaveRaw, limite = 20) {
  const chave = normalizarChavePrompt(chaveRaw)
  if (!chave) {
    const err = new Error('Chave de prompt inválida')
    err.code = 'CHAVE_INVALIDA'
    throw err
  }
  const lim = Math.min(Math.max(parseInt(limite, 10) || 20, 1), 50)
  const { rows } = await pool.query(
    `SELECT id, version, autor, criado_em, ativo,
            LEFT(conteudo, 160) AS snippet
     FROM vendas.prompt_overlays
     WHERE chave = $1
     ORDER BY version DESC
     LIMIT $2`,
    [chave, lim]
  )
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    autor: r.autor,
    criado_em: r.criado_em,
    ativo: r.ativo,
    snippet: r.snippet || '',
  }))
}

function _logPromptDisk(chave, conteudo, version, autor, operacao) {
  try {
    const dir = path.join(ROOT, 'logs', 'prompts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${chave}.current.md`), conteudo, 'utf8')
    const snippet = conteudo.slice(0, 120).replace(/\n/g, ' ')
    const linha = `${new Date().toISOString()} | ${chave} | v${version} | ${autor || '—'} | ${operacao} | ${snippet}\n`
    fs.appendFileSync(path.join(dir, 'history.log'), linha, 'utf8')
  } catch (err) {
    logger.warn('⚠️  log prompt disk:', err.message)
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} chaveRaw
 * @param {string} conteudo
 * @param {string} [autor]
 */
async function setOverlay(pool, chaveRaw, conteudo, autor) {
  const chave = normalizarChavePrompt(chaveRaw)
  if (!chave) {
    const err = new Error('Chave de prompt inválida')
    err.code = 'CHAVE_INVALIDA'
    throw err
  }
  const texto = typeof conteudo === 'string' ? conteudo : ''
  if (!texto.trim()) {
    const err = new Error('Conteúdo do prompt não pode ser vazio')
    err.code = 'CONTEUDO_VAZIO'
    throw err
  }
  const buf = Buffer.byteLength(texto, 'utf8')
  if (buf > PROMPT_OVERLAY_MAX_BYTES) {
    const err = new Error(`Conteúdo excede ${PROMPT_OVERLAY_MAX_BYTES} bytes`)
    err.code = 'CONTEUDO_GRANDE'
    throw err
  }
  const autorTrim =
    typeof autor === 'string' && autor.trim() ? autor.trim().slice(0, 120) : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS m FROM vendas.prompt_overlays WHERE chave = $1`,
      [chave]
    )
    const nextV = (Number(maxRows[0].m) || 0) + 1
    await client.query(`UPDATE vendas.prompt_overlays SET ativo = false WHERE chave = $1`, [chave])
    await client.query(
      `INSERT INTO vendas.prompt_overlays (chave, version, conteudo, ativo, origem, autor)
       VALUES ($1, $2, $3, true, 'dashboard', $4)`,
      [chave, nextV, texto, autorTrim]
    )
    await client.query('COMMIT')
    aplicarMemoriaPrompt(chave, texto)
    _logPromptDisk(chave, texto, nextV, autorTrim, 'save')
    return getPromptAtual(pool, chave)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} chaveRaw
 * @param {number|string} versionId id da linha em prompt_overlays
 */
async function reverterOverlay(pool, chaveRaw, versionId) {
  const chave = normalizarChavePrompt(chaveRaw)
  if (!chave) {
    const err = new Error('Chave de prompt inválida')
    err.code = 'CHAVE_INVALIDA'
    throw err
  }
  const id = typeof versionId === 'string' ? parseInt(versionId, 10) : Number(versionId)
  if (!id || id < 1) {
    const err = new Error('versionId inválido')
    err.code = 'VERSION_ID'
    throw err
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, conteudo, chave, version FROM vendas.prompt_overlays WHERE id = $1 AND chave = $2`,
      [id, chave]
    )
    if (!rows.length) {
      const err = new Error('Versão não encontrada')
      err.code = 'NAO_ENCONTRADO'
      throw err
    }
    await client.query(`UPDATE vendas.prompt_overlays SET ativo = false WHERE chave = $1`, [chave])
    await client.query(`UPDATE vendas.prompt_overlays SET ativo = true WHERE id = $1`, [id])
    await client.query('COMMIT')
    aplicarMemoriaPrompt(chave, rows[0].conteudo)
    _logPromptDisk(chave, rows[0].conteudo, rows[0].version, null, 'revert')
    return getPromptAtual(pool, chave)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = {
  loadSystemPrompt,
  loadSystemCorePrompt,
  loadClassificadorIntencao,
  loadTomReferenciaPrompt,
  withTomReferencia,
  loadSystemPrimeiroContatoPrompt,
  loadSystemDiagnosticoPrompt,
  loadSystemPropostaPrompt,
  loadSystemObjecaoPrompt,
  loadSystemFechamentoPrompt,
  loadFollowupPrompt,
  loadFollowupTimingPrompt,
  loadLeadCoachPrompt,
  loadEmpresaKnowledge,
  loadCasesCatalog,
  urlAutorizadaConhecimento,
  filtrarLinksSugeridosParaEnvio,
  get SYSTEM_PROMPT_BASE() {
    return SYSTEM_PROMPT_BASE
  },
  get SYSTEM_CORE_BASE() {
    return SYSTEM_CORE_BASE
  },
  get SYSTEM_PRIMEIRO_CONTATO_BASE() {
    return SYSTEM_PRIMEIRO_CONTATO_BASE
  },
  get SYSTEM_DIAGNOSTICO_BASE() {
    return SYSTEM_DIAGNOSTICO_BASE
  },
  get SYSTEM_PROPOSTA_BASE() {
    return SYSTEM_PROPOSTA_BASE
  },
  get SYSTEM_OBJECAO_BASE() {
    return SYSTEM_OBJECAO_BASE
  },
  get SYSTEM_FECHAMENTO_BASE() {
    return SYSTEM_FECHAMENTO_BASE
  },
  get FOLLOWUP_PROMPT_BASE() {
    return FOLLOWUP_PROMPT_BASE
  },
  get FOLLOWUP_TIMING_PROMPT_BASE() {
    return FOLLOWUP_TIMING_PROMPT_BASE
  },
  get LEAD_COACH_PROMPT_BASE() {
    return LEAD_COACH_PROMPT_BASE
  },
  get EMPRESA_KNOWLEDGE_BASE() {
    return EMPRESA_KNOWLEDGE_BASE
  },
  get CASES_CATALOG() {
    return CASES_CATALOG
  },
  get CLASSIFICADOR_INTENCAO_BASE() {
    return CLASSIFICADOR_INTENCAO_BASE
  },
  get TOM_REFERENCIA_BASE() {
    return TOM_REFERENCIA_BASE
  },
  CHAVES_PERMITIDAS,
  PROMPT_OVERLAY_MAX_BYTES,
  normalizarChavePrompt,
  loadOverlaysFromDb,
  getPromptAtual,
  listarHistoricoOverlay,
  setOverlay,
  reverterOverlay,
}
