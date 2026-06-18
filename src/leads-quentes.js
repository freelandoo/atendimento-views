'use strict'

// Worklist da carteira QUENTE: leads que ja qualificaram (score >= LIMIAR) OU ja
// receberam oferta de reuniao, mas NAO compraram, NAO tem reuniao futura e seguem
// ativos — ranqueados para o operador "colher" de cima pra baixo. Read-only.
//
// Prioridade (mais perto da venda primeiro):
//   1) lead aguardando NOSSA resposta (ultima msg foi do lead);
//   2) ja recebeu oferta de reuniao (so falta marcar);
//   3) maior score;
//   4) mais recente.

const { dashboardAutorizado } = require('./dashboardAuth')
const { pool } = require('./db')
const { logger } = require('./logger')
const { QUALIFIED_LEAD_MIN } = require('./services/meta-attribution')

async function listarLeadsQuentesParaTrabalhar(poolRef, { limite = 150, diasAtivo = 45, empresaId = null } = {}) {
  const lim = Math.min(500, Math.max(1, parseInt(limite, 10) || 150))
  const dias = Math.min(180, Math.max(1, parseInt(diasAtivo, 10) || 45))
  const params = [QUALIFIED_LEAD_MIN, lim, dias]
  // Escopo multiempresa opcional: quando empresaId é informado (rota /api JWT),
  // filtra a carteira por aquela empresa; sem ele, mantém o comportamento global.
  const empresaCond = empresaId ? `AND c.empresa_id = $${params.push(empresaId)}` : ''
  const { rows } = await poolRef.query(
    `
    WITH base AS (
      SELECT
        c.numero,
        c.atualizado_em,
        p.negocio, p.cidade, p.score_lead, p.temperatura_lead, p.dor_principal, p.produto_sugerido,
        CASE WHEN p.origem='meta_ads' THEN 'meta'
             WHEN p.origem='prospeccao' THEN 'prospeccao'
             ELSE 'inbound' END AS canal,
        (COALESCE(p.reuniao_proposta,'{}'::jsonb) <> '{}'::jsonb) AS ofereceu_reuniao,
        (CASE WHEN jsonb_typeof(c.historico)='array' AND jsonb_array_length(c.historico) > 0
              THEN c.historico->-1->>'role' END) = 'user' AS aguardando_resposta
      FROM vendas.conversas c
      JOIN vendas.lead_profiles p ON p.numero = c.numero
      WHERE c.atualizado_em > NOW() - ($3::int * INTERVAL '1 day')
        AND c.venda_fechada IS NOT TRUE
        AND c.arquivado IS NOT TRUE
        ${empresaCond}
        AND (p.score_lead >= $1 OR COALESCE(p.reuniao_proposta,'{}'::jsonb) <> '{}'::jsonb)
        AND NOT EXISTS (
          SELECT 1 FROM vendas.agenda_eventos e
          WHERE e.tipo='reuniao' AND e.excluido_em IS NULL AND e.data_inicio > NOW()
            AND regexp_replace(COALESCE(e.metadata->>'lead_numero',''),'\\D','','g') = regexp_replace(c.numero,'\\D','','g')
        )
    )
    SELECT * FROM base
    ORDER BY aguardando_resposta DESC, ofereceu_reuniao DESC, score_lead DESC NULLS LAST, atualizado_em DESC
    LIMIT $2
    `,
    params
  )
  const iso = (d) => (d ? new Date(d).toISOString() : null)
  return rows.map((r) => ({
    numero: r.numero,
    canal: r.canal,
    negocio: r.negocio || null,
    cidade: r.cidade || null,
    score: r.score_lead == null ? null : Number(r.score_lead),
    temperatura: r.temperatura_lead || null,
    dor: r.dor_principal || null,
    produto: r.produto_sugerido || null,
    ofereceu_reuniao: r.ofereceu_reuniao === true,
    aguardando_resposta: r.aguardando_resposta === true,
    ultima_atividade: iso(r.atualizado_em),
  }))
}

function registerLeadsQuentesRoutes(app) {
  app.get('/dashboard/leads-quentes', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ ok: false, erro: 'Nao autorizado' })
    try {
      const leads = await listarLeadsQuentesParaTrabalhar(pool, {
        limite: req.query?.limite,
        diasAtivo: req.query?.dias,
      })
      res.json({ ok: true, total: leads.length, leads })
    } catch (err) {
      logger.error('GET /dashboard/leads-quentes:', err.message)
      res.status(500).json({ ok: false, erro: 'Falha ao carregar a carteira quente' })
    }
  })
}

module.exports = { listarLeadsQuentesParaTrabalhar, registerLeadsQuentesRoutes }
