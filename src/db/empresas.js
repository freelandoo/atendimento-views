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

module.exports = {
  findEmpresaById,
  findEmpresaBySlug,
  findEmpresaByEvolutionInstance,
  usuarioPertenceAEmpresa,
  empresaAgentePausada,
  invalidarCachePauseEmpresa,
}
