'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/relatorios/resumo
router.get('/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const id = req.empresa.id

  const [conversas, estagios, followups, llm] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ativo') AS ativas,
         COUNT(*) FILTER (WHERE venda_fechada = true) AS fechadas,
         COUNT(*) FILTER (WHERE arquivado = true) AS arquivadas,
         COUNT(*) AS total
       FROM vendas.conversas WHERE empresa_id = $1`,
      [id]
    ),
    pool.query(
      `SELECT estagio, COUNT(*) AS total
       FROM vendas.conversas WHERE empresa_id = $1 AND status = 'ativo'
       GROUP BY estagio ORDER BY total DESC`,
      [id]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE envio_ok = true) AS enviados,
         COUNT(*) FILTER (WHERE resposta_lead_em IS NOT NULL) AS respondidos
       FROM vendas.followup_envios WHERE empresa_id = $1`,
      [id]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS chamadas,
         SUM(COALESCE((usage->>'input_tokens')::int, 0)) AS input_tokens,
         SUM(COALESCE((usage->>'output_tokens')::int, 0)) AS output_tokens,
         AVG(duration_ms)::int AS latencia_media_ms
       FROM vendas.llm_chamadas
       WHERE numero IN (SELECT numero FROM vendas.conversas WHERE empresa_id = $1)
         AND criado_em >= NOW() - INTERVAL '30 days'`,
      [id]
    ),
  ])

  return res.json({
    ok: true,
    data: {
      conversas: conversas.rows[0],
      por_estagio: estagios.rows,
      followups: followups.rows[0],
      llm_30d: llm.rows[0],
    },
  })
})

module.exports = router
