'use strict'
const { pool } = require('../db')

async function findEmpresaById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE id = $1 AND ativo = true',
    [id]
  )
  return rows[0] || null
}

async function findEmpresaBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE slug = $1 AND ativo = true',
    [slug]
  )
  return rows[0] || null
}

async function findEmpresaByEvolutionInstance(instanceName) {
  const { rows } = await pool.query(
    `SELECT e.*
     FROM app.empresas e
     JOIN app.empresa_whatsapp_instances ewi ON ewi.empresa_id = e.id
     WHERE ewi.evolution_instance = $1 AND ewi.ativo = true AND e.ativo = true`,
    [instanceName]
  )
  return rows[0] || null
}

async function usuarioPertenceAEmpresa(usuario_id, empresa_id) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app.usuarios_empresas
     WHERE usuario_id = $1 AND empresa_id = $2 AND ativo = true`,
    [usuario_id, empresa_id]
  )
  return rows.length > 0
}

// ─── Pause global do agente por empresa (config.agente_pausado) ────────────────
// Lido no caminho de resposta (core-funnel). Cache curto pra não bater no banco a
// cada mensagem; o toggle na API invalida o cache para efeito imediato. Fail-open:
// erro de leitura NUNCA bloqueia resposta.
const _pauseCache = new Map() // empresaId -> { paused, at }
const PAUSE_TTL_MS = 30_000

async function empresaAgentePausada(empresaId) {
  if (!empresaId) return false
  const c = _pauseCache.get(empresaId)
  if (c && Date.now() - c.at < PAUSE_TTL_MS) return c.paused
  try {
    const { rows } = await pool.query('SELECT config FROM app.empresas WHERE id = $1', [empresaId])
    const paused = !!(rows[0]?.config?.agente_pausado)
    _pauseCache.set(empresaId, { paused, at: Date.now() })
    return paused
  } catch {
    return false
  }
}

function invalidarCachePauseEmpresa(empresaId) {
  if (empresaId) _pauseCache.delete(empresaId)
  else _pauseCache.clear()
}

// ─── Nome de exibição da empresa (para mensagens automáticas/lembretes) ─────────
// Resolve app.empresas.nome com cache curto. Fallback (empresa nula/desconhecida)
// = EMPRESA_NOME_PADRAO. EM PRODUÇÃO defina EMPRESA_NOME_PADRAO com a marca real:
// aí {{empresa}} e qualquer "PJ Codeworks" legado viram essa marca em TODA saída e
// em todo prompt, sem depender de cada empresa. O default de código 'PJ Codeworks'
// é só o último recurso (nunca aparece quando a empresa resolve ou a env está setada).
const NOME_PADRAO = process.env.EMPRESA_NOME_PADRAO || 'nossa empresa'
const _nomeCache = new Map() // empresaId -> { nome, at }
const NOME_TTL_MS = 60_000

async function nomeEmpresa(empresaId) {
  if (!empresaId) return NOME_PADRAO
  const c = _nomeCache.get(empresaId)
  if (c && Date.now() - c.at < NOME_TTL_MS) return c.nome
  try {
    const { rows } = await pool.query('SELECT nome FROM app.empresas WHERE id = $1', [empresaId])
    const nome = (rows[0]?.nome || '').trim() || NOME_PADRAO
    _nomeCache.set(empresaId, { nome, at: Date.now() })
    return nome
  } catch {
    return NOME_PADRAO
  }
}

function invalidarCacheNomeEmpresa(empresaId) {
  if (empresaId) _nomeCache.delete(empresaId)
  else _nomeCache.clear()
}

// ─── Protocolo de abertura por empresa (config.opener_protocolo) ───────────────
// Sequência fixa e determinística dos primeiros turnos (saudação → 1 pergunta de
// qualificação → CTA por caminho), lida no caminho de resposta (core-funnel) para
// NÃO deixar a IA improvisar/interrogar na abertura. Opt-in: só empresas que
// configuram isto entram no fluxo; as demais seguem 100% pela IA (comportamento
// atual). Cache curto; fail-open (erro/nulo => '' e o caller cai pra IA).
// Formato esperado: { saudacao, pergunta, cta_provedor, cta_cliente } (strings).
const _openerCache = new Map() // empresaId -> { data, at }
const OPENER_TTL_MS = 30_000

async function openerProtocolo(empresaId) {
  if (!empresaId) return null
  const c = _openerCache.get(empresaId)
  if (c && Date.now() - c.at < OPENER_TTL_MS) return c.data
  let data = null
  try {
    const { rows } = await pool.query('SELECT config FROM app.empresas WHERE id = $1', [empresaId])
    const op = rows[0]?.config?.opener_protocolo
    if (op && typeof op === 'object' && !Array.isArray(op)) {
      const s = (k) => (typeof op[k] === 'string' ? op[k].trim() : '')
      const out = { saudacao: s('saudacao'), pergunta: s('pergunta'), cta_provedor: s('cta_provedor'), cta_cliente: s('cta_cliente') }
      // Só vale como protocolo se houver ao menos a saudação ou um CTA configurado.
      if (out.saudacao || out.cta_provedor || out.cta_cliente) data = out
    }
  } catch { data = null }
  _openerCache.set(empresaId, { data, at: Date.now() })
  return data
}

function invalidarCacheOpener(empresaId) {
  if (empresaId) _openerCache.delete(empresaId)
  else _openerCache.clear()
}

module.exports = {
  findEmpresaById,
  findEmpresaBySlug,
  findEmpresaByEvolutionInstance,
  usuarioPertenceAEmpresa,
  empresaAgentePausada,
  invalidarCachePauseEmpresa,
  nomeEmpresa,
  NOME_PADRAO,
  invalidarCacheNomeEmpresa,
  openerProtocolo,
  invalidarCacheOpener,
}
