'use strict'
// Auditoria (append-only) — Fatia G. registrarAuditoria e' BEST-EFFORT: uma falha aqui
// NUNCA deve quebrar a acao principal (por isso engole o erro e apenas loga). Nao e' fonte
// de dashboards (a analitica sai de app.vw_ligacoes_analiticas).
const { logger } = require('../logger')

async function registrarAuditoria(pool, empresaId, ev = {}) {
  try {
    if (!empresaId || !ev.entidadeTipo || !ev.acao) return null
    const { rows } = await pool.query(
      `INSERT INTO app.auditoria_eventos
         (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto, client_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, ocorrido_em`,
      [empresaId, ev.usuarioId || null, ev.entidadeTipo, ev.entidadeId || null, ev.acao,
        ev.estadoAnterior || null, ev.estadoNovo || null,
        ev.contexto != null ? JSON.stringify(ev.contexto) : null, ev.clientEventId || null])
    return rows[0] || null
  } catch (e) {
    logger.warn({ err: e && e.message, acao: ev.acao }, '[auditoria] falha ao registrar (best-effort, ignorado)')
    return null
  }
}

// Historico de auditoria de uma entidade (ex.: uma ligacao). Isolado por empresa.
async function listarAuditoria(pool, empresaId, { entidadeTipo, entidadeId, limit = 100 } = {}) {
  const params = [empresaId]
  const conds = ['empresa_id = $1']
  if (entidadeTipo) { params.push(entidadeTipo); conds.push(`entidade_tipo = $${params.length}`) }
  if (entidadeId) { params.push(entidadeId); conds.push(`entidade_id = $${params.length}`) }
  params.push(Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500))
  const { rows } = await pool.query(
    `SELECT id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto, client_event_id, ocorrido_em
       FROM app.auditoria_eventos WHERE ${conds.join(' AND ')} ORDER BY ocorrido_em DESC LIMIT $${params.length}`,
    params)
  return rows
}

module.exports = { registrarAuditoria, listarAuditoria }
