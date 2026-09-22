'use strict'
// Acesso ao ledger de consumo do Apify (migration 091).
//
// A REGRA de orcamento vive em `services/apify-orcamento.js` (modulo PURO). Aqui so' ha' o I/O.

const { pool } = require('../db')
const { logger } = require('../logger')

/**
 * Registra consumo REAL. NUNCA lanca: contabilidade quebrada nao pode derrubar leads que ja
 * foram pagos — a falha vai para o log, e a unica consequencia e' o teto ficar mais frouxo do
 * que deveria (mesma disciplina de `db/brightdata-consumo.js`).
 */
async function registrarConsumo({
  empresaId = null,
  actorId,
  runId = null,
  resultados,
  contexto = null,
} = {}) {
  const n = Number.parseInt(resultados, 10)
  if (!actorId || !Number.isFinite(n) || n < 0) {
    logger.warn({ actorId, resultados }, '[apify] consumo ignorado: entrada invalida')
    return false
  }
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO prospectador.apify_consumo (empresa_id, actor_id, run_id, resultados, contexto)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING`,
      [empresaId, actorId, runId, n, contexto ? JSON.stringify(contexto) : null]
    )
    return rowCount > 0
  } catch (err) {
    logger.error({ err: err.message, actorId, runId }, '[apify] falha ao registrar consumo')
    return false
  }
}

/** Resultados consumidos hoje, na conta inteira. `actorId` opcional restringe o recorte. */
async function consumidoHoje(actorId = null) {
  const filtro = actorId ? 'AND actor_id = $1' : ''
  const params = actorId ? [actorId] : []
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(resultados), 0)::int AS total
       FROM prospectador.apify_consumo
      WHERE criado_em >= date_trunc('day', NOW()) ${filtro}`,
    params
  )
  return Number(rows[0]?.total || 0)
}

module.exports = {
  registrarConsumo,
  consumidoHoje,
}
