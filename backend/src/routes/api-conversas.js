'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { gerarESalvarResumo, buscarUltimoResumo } = require('../services/resumo-conversa')
const { logger } = require('../logger')
const { enviarMensagem } = require('../whatsapp')
const { calcularScoreInteresseLead } = require('../services/lead-interest-score')

const router = Router({ mergeParams: true })

const LEAD_PROFILE_JOIN = `
       LEFT JOIN LATERAL (
         SELECT lp.*
           FROM vendas.lead_profiles lp
          WHERE lp.numero = c.numero
            AND (lp.empresa_id = c.empresa_id OR lp.empresa_id IS NULL)
          ORDER BY CASE WHEN lp.empresa_id = c.empresa_id THEN 0 ELSE 1 END,
                   lp.atualizado_em DESC NULLS LAST
          LIMIT 1
       ) lp ON true`

function anexarScoreInteresse(conversa) {
  const interesse = calcularScoreInteresseLead(conversa, {
    historico: conversa?.historico,
    estagio: conversa?.estagio,
    atualizadoEm: conversa?.atualizado_em,
  })
  return {
    ...conversa,
    score_interesse: interesse.score,
    score_interesse_faixa: interesse.faixa,
    score_interesse_label: interesse.label,
    score_interesse_resumo: interesse.resumo,
    score_interesse_criterios: interesse.criterios,
    score_interesse_mensagens_lead: interesse.mensagens_lead,
  }
}

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
      `SELECT c.*, lp.negocio, lp.cidade, lp.temperatura_lead, lp.score_dor, lp.score_lead,
              lp.dor_principal, lp.ja_aparece_google, lp.precisa_sistema,
              lp.produto_sugerido, lp.intencao_principal, lp.insights_lead,
              lp.reuniao_proposta
       FROM vendas.conversas c
       ${LEAD_PROFILE_JOIN}
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
    data: rows.map(anexarScoreInteresse),
    meta: { total: parseInt(cnt.total, 10), page, limit },
  })
})

// GET /api/empresas/:empresaId/conversas/:numero
router.get('/:numero', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [conversa] } = await pool.query(
    `SELECT c.*, lp.*, c.numero AS numero, c.empresa_id AS empresa_id, c.atualizado_em AS atualizado_em
     FROM vendas.conversas c
     ${LEAD_PROFILE_JOIN}
     WHERE c.empresa_id = $1 AND c.numero = $2`,
    [req.empresa.id, req.params.numero]
  )
  if (!conversa) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa não encontrada.' } })
  return res.json({ ok: true, data: anexarScoreInteresse(conversa) })
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

// POST /api/empresas/:empresaId/conversas/:numero/reprocessar
// Reenvia a ultima resposta do agente quando ela ja esta no historico, mas nao chegou no WhatsApp.
router.post('/:numero/reprocessar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [conversa] } = await pool.query(
    `SELECT numero, historico, evolution_instance
       FROM vendas.conversas
      WHERE empresa_id = $1 AND numero = $2`,
    [req.empresa.id, req.params.numero]
  )
  if (!conversa) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Conversa nao encontrada.' } })

  const historico = Array.isArray(conversa.historico) ? conversa.historico : []
  const ultimaResposta = historico[historico.length - 1]
  if (!ultimaResposta || ultimaResposta.role !== 'assistant') {
    return res.status(400).json({ ok: false, error: { code: 'LAST_MESSAGE_NOT_ASSISTANT', message: 'A ultima mensagem do historico nao e uma resposta do agente.' } })
  }
  const texto = String(ultimaResposta?.content || ultimaResposta?.text || '').trim()
  if (!texto) {
    return res.status(400).json({ ok: false, error: { code: 'NO_ASSISTANT_MESSAGE', message: 'Nenhuma resposta do agente para reenviar.' } })
  }

  try {
    await enviarMensagem(
      conversa.numero,
      texto,
      conversa.evolution_instance ? { instanceName: conversa.evolution_instance } : {}
    )
    await pool.query(
      `UPDATE vendas.conversas
          SET ultima_falha_resposta_codigo = NULL,
              ultima_falha_resposta_msg = NULL,
              ultima_falha_resposta_em = NULL,
              atualizado_em = NOW()
        WHERE empresa_id = $1 AND numero = $2`,
      [req.empresa.id, conversa.numero]
    )
    return res.json({ ok: true, data: { numero: conversa.numero, reenviado: true, trecho: texto.slice(0, 200) } })
  } catch (err) {
    logger.error({ err: err.message, numero: conversa.numero }, 'Reprocessar conversa falhou')
    return res.status(502).json({ ok: false, error: { code: 'WHATSAPP_SEND_FAILED', message: err.message || 'Falha ao reenviar WhatsApp.' } })
  }
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
