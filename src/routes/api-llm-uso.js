'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')

const router = Router({ mergeParams: true })

function parseDate(s, fallback) {
  if (!s) return fallback
  const d = new Date(s)
  return isNaN(d.getTime()) ? fallback : d
}

// GET /api/empresas/:empresaId/llm/uso?from=&to=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const now = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const from = parseDate(req.query.from, monthAgo)
  const to = parseDate(req.query.to, now)

  const baseWhere = `WHERE empresa_id = $1 AND created_at >= $2 AND created_at < $3`
  const baseWhereL = `WHERE l.empresa_id = $1 AND l.created_at >= $2 AND l.created_at < $3`
  const args = [req.empresa.id, from, to]

  const [totaisR, porTipoR, porClienteR, porContextoR, porModeloR, recentesR] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS chamadas,
         COUNT(*) FILTER (WHERE success)::int AS sucesso,
         COUNT(*) FILTER (WHERE NOT success)::int AS erros,
         COALESCE(SUM(input_tokens), 0)::bigint  AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(cost_usd), 0)::numeric(14,6) AS cost_usd
       FROM vendas.ai_logs ${baseWhere}`,
      args
    ),
    pool.query(
      `SELECT COALESCE(ref_type, task, 'outros') AS tipo,
              COUNT(*)::int AS chamadas,
              COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
              COALESCE(SUM(cost_usd),0)::numeric(14,6) AS cost_usd
       FROM vendas.ai_logs ${baseWhere}
       GROUP BY 1
       ORDER BY cost_usd DESC`,
      args
    ),
    pool.query(
      `SELECT client_numero,
              COUNT(*)::int AS chamadas,
              COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
              COALESCE(SUM(cost_usd),0)::numeric(14,6) AS cost_usd,
              MAX(created_at) AS ultima_em
       FROM vendas.ai_logs ${baseWhere} AND client_numero IS NOT NULL
       GROUP BY client_numero
       ORDER BY cost_usd DESC NULLS LAST
       LIMIT 100`,
      args
    ),
    pool.query(
      `SELECT l.ref_id AS contexto_id,
              c.nome AS contexto_nome,
              COUNT(*)::int AS chamadas,
              COALESCE(SUM(l.input_tokens),0)::bigint  AS input_tokens,
              COALESCE(SUM(l.output_tokens),0)::bigint AS output_tokens,
              COALESCE(SUM(l.cost_usd),0)::numeric(14,6) AS cost_usd,
              MAX(l.created_at) AS ultima_em
       FROM vendas.ai_logs l
       LEFT JOIN app.empresa_contextos c ON c.id::text = l.ref_id
       ${baseWhereL} AND l.ref_type = 'contexto'
       GROUP BY l.ref_id, c.nome
       ORDER BY cost_usd DESC NULLS LAST
       LIMIT 100`,
      args
    ),
    pool.query(
      `SELECT provider, model,
              COUNT(*)::int AS chamadas,
              COALESCE(SUM(input_tokens),0)::bigint  AS input_tokens,
              COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
              COALESCE(SUM(cost_usd),0)::numeric(14,6) AS cost_usd
       FROM vendas.ai_logs ${baseWhere}
       GROUP BY provider, model
       ORDER BY cost_usd DESC`,
      args
    ),
    pool.query(
      `SELECT id, created_at, provider, model, task, ref_type, ref_id, client_numero,
              success, input_tokens, output_tokens, cost_usd
       FROM vendas.ai_logs ${baseWhere}
       ORDER BY created_at DESC
       LIMIT 50`,
      args
    ),
  ])

  return res.json({
    ok: true,
    data: {
      filtro: { from, to },
      totais: totaisR.rows[0],
      por_tipo: porTipoR.rows,
      por_cliente: porClienteR.rows,
      por_contexto: porContextoR.rows,
      por_modelo: porModeloR.rows,
      recentes: recentesR.rows,
    },
  })
})

module.exports = router
