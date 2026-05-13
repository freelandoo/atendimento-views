'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { gerarESalvarResumo, buscarUltimoResumo } = require('../services/resumo-conversa')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/conversas?page=1&limit=50&status=ativo
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
  const offset = (page - 1) * limit
  const { status, estagio } = req.query

  const conds = ['c.empresa_id = $1']
  const vals = [req.empresa.id]

  if (status) { conds.push(`c.status = $${vals.push(status)}`); }
  if (estagio) { conds.push(`c.estagio = $${vals.push(estagio)}`); }

  const where = conds.join(' AND ')

  const [{ rows }, { rows: [cnt] }] = await Promise.all([
    pool.query(
      `SELECT c.*, lp.negocio, lp.temperatura_lead, lp.score_dor
       FROM vendas.conversas c
       LEFT JOIN vendas.lead_profiles lp ON lp.numero = c.numero
       WHERE ${where}
       ORDER BY c.atualizado_em DESC
       LIMIT $${vals.push(limit)} OFFSET $${vals.push(offset)}`,
      vals
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM vendas.conversas c WHERE ${where}`,
      vals.slice(0, vals.length - 2)
    ),
  ])

  return res.json({
    ok: true,
    data: rows,
    meta: { total: parseInt(cnt.total, 10), page, limit },
  })
})

// GET /api/empresas/:empresaId/conversas/:numero
router.get('/:numero', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [conversa] } = await pool.query(
    `SELECT c.*, lp.*
     FROM vendas.conversas c
     LEFT JOIN vendas.lead_profiles lp ON lp.numero = c.numero
     WHERE c.empresa_id = $1 AND c.numero = $2`,
    [req.empresa.id, req.params.numero]
  )
  if (!conversa) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
  return res.json({ ok: true, data: conversa })
})

// DELETE /api/empresas/:empresaId/conversas/:numero
// Remove o contato inteiro (conversa + lead_profile + lead_insights).
router.delete('/:numero', requireAuth, requireEmpresaAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM app.lead_insights WHERE empresa_id = $1 AND numero = $2`,
      [req.empresa.id, req.params.numero]
    )
    await client.query(
      `DELETE FROM vendas.lead_profiles WHERE numero = $1`,
      [req.params.numero]
    )
    const { rowCount } = await client.query(
      `DELETE FROM vendas.conversas WHERE empresa_id = $1 AND numero = $2`,
      [req.empresa.id, req.params.numero]
    )
    await client.query('COMMIT')
    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
    }
    return res.json({ ok: true, data: { numero: req.params.numero, deleted: true } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return res.status(500).json({ ok: false, error: { code: 'DELETE_FAILED', message: err.message } })
  } finally {
    client.release()
  }
})

// DELETE /api/empresas/:empresaId/conversas/:numero/historico
// Limpa o histórico de mensagens da conversa (mantém a linha — reset agente_pausado e estagio).
router.delete('/:numero/historico', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [c] } = await pool.query(
    `UPDATE vendas.conversas
        SET historico = '[]'::jsonb,
            estagio = 'primeiro_contato',
            agente_pausado = false,
            atualizado_em = NOW()
      WHERE empresa_id = $1 AND numero = $2
      RETURNING numero, estagio, status, agente_pausado`,
    [req.empresa.id, req.params.numero]
  )
  if (!c) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
  // Limpa também lead_insights desta conversa (mensagens analíticas do playbook runtime)
  await pool.query(
    `DELETE FROM app.lead_insights
      WHERE empresa_id = $1 AND numero = $2 AND tipo = 'playbook_runtime'`,
    [req.empresa.id, req.params.numero]
  ).catch(() => {})
  return res.json({ ok: true, data: c })
})

// GET /api/empresas/:empresaId/conversas/:numero/resumo
router.get('/:numero/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const resumo = await buscarUltimoResumo(pool, {
    empresaId: req.empresa.id,
    numero: req.params.numero,
  })
  if (!resumo) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Nenhum resumo encontrado.' } })
  return res.json({ ok: true, data: { resumo } })
})

// POST /api/empresas/:empresaId/conversas/:numero/resumo
// Body: { historico: [...] }
router.post('/:numero/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { historico } = req.body || {}
  if (!Array.isArray(historico) || historico.length === 0) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'historico obrigatório.' } })
  }
  const resumo = await gerarESalvarResumo(pool, {
    empresaId: req.empresa.id,
    numero: req.params.numero,
    historico,
    log: logger,
  })
  return res.status(201).json({ ok: true, data: { resumo } })
})

module.exports = router
