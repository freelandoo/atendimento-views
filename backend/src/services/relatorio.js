'use strict'
const { generateReport } = require('../ai-provider')

const TIPOS_VALIDOS = new Set(['geral', 'vendas', 'funil', 'followup', 'leads'])

/**
 * Gera um relatório textual via IA a partir de dados estruturados.
 * @param {object} pool - pg Pool
 * @param {{ empresaId: string, tipo?: string, dados: any, log?: object }} opts
 * @returns {{ texto: string, provider: string, model: string }}
 */
async function gerarRelatorioIA(pool, { empresaId, tipo = 'geral', dados, log }) {
  if (!TIPOS_VALIDOS.has(tipo)) tipo = 'geral'
  const result = await generateReport({ dados, tipo, pool, log, empresaId })
  return { texto: result.text || '', provider: result.provider, model: result.model }
}

/**
 * Busca as métricas completas de uma empresa (conversas, funil, follow-up, uso de IA nos
 * últimos 30 dias e temperatura de leads). Fonte única usada tanto pelo resumo exibido na
 * tela quanto pela análise via IA — antes eram dois conjuntos de query divergentes e a
 * análise via IA (em qualquer seção, inclusive "Leads") nunca recebia temperatura/llm_30d.
 */
async function coletarDadosRelatorio(pool, empresaId) {
  const [conversas, estagios, followups, llm, temperatura] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ativo') AS ativas,
         COUNT(*) FILTER (WHERE venda_fechada = true) AS fechadas,
         COUNT(*) FILTER (WHERE arquivado = true) AS arquivadas,
         COUNT(*) AS total
       FROM vendas.conversas WHERE empresa_id = $1`,
      [empresaId]
    ),
    pool.query(
      `SELECT estagio, COUNT(*) AS total
       FROM vendas.conversas WHERE empresa_id = $1 AND status = 'ativo'
       GROUP BY estagio ORDER BY total DESC`,
      [empresaId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE envio_ok = true) AS enviados,
         COUNT(*) FILTER (WHERE resposta_lead_em IS NOT NULL) AS respondidos
       FROM vendas.followup_envios WHERE empresa_id = $1`,
      [empresaId]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS chamadas,
         SUM(COALESCE(input_tokens, 0)) AS input_tokens,
         SUM(COALESCE(output_tokens, 0)) AS output_tokens,
         AVG(latency_ms)::int AS latencia_media_ms
       FROM vendas.ai_logs
       WHERE empresa_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [empresaId]
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE lp.temperatura_lead = 'quente') AS quente,
         COUNT(*) FILTER (WHERE lp.temperatura_lead = 'morno')  AS morno,
         COUNT(*) FILTER (WHERE lp.temperatura_lead = 'frio')   AS frio,
         COUNT(*) FILTER (WHERE lp.pronto_handoff = true)       AS prontos_handoff
       FROM vendas.lead_profiles lp
       JOIN vendas.conversas c ON c.numero = lp.numero
       WHERE c.empresa_id = $1`,
      [empresaId]
    ),
  ])
  return {
    conversas: conversas.rows[0],
    por_estagio: estagios.rows,
    followups: followups.rows[0],
    llm_30d: llm.rows[0],
    temperatura: temperatura.rows[0],
  }
}

module.exports = { gerarRelatorioIA, coletarDadosRelatorio }
