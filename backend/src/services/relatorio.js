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
 * Busca dados de resumo de uma empresa para gerar relatório de vendas.
 * Retorna objeto com métricas brutas — use em conjunto com gerarRelatorioIA.
 */
async function coletarDadosRelatorio(pool, empresaId) {
  const [conversas, estagios, followups] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ativo') AS ativas,
         COUNT(*) FILTER (WHERE venda_fechada = true) AS fechadas,
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
  ])
  return {
    conversas: conversas.rows[0],
    por_estagio: estagios.rows,
    followups: followups.rows[0],
  }
}

module.exports = { gerarRelatorioIA, coletarDadosRelatorio }
