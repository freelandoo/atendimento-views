'use strict'
// Leitura ANALITICA de ligacoes (Fatia G). Le SEMPRE da view app.vw_ligacoes_analiticas
// (fonte oficial: so encerradas). Nao reimplementa o filtro `status='encerrada'` — a regra
// central vive na view. Base para dashboards/IA futuros (fora do escopo desta fatia).
async function listarLigacoesEncerradas(pool, empresaId, { campanhaId, prospectId, limit = 100 } = {}) {
  const params = [empresaId]
  const conds = ['empresa_id = $1']
  if (campanhaId) { params.push(campanhaId); conds.push(`campanha_id = $${params.length}`) }
  if (prospectId) { params.push(prospectId); conds.push(`prospect_id = $${params.length}`) }
  params.push(Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500))
  const { rows } = await pool.query(
    `SELECT * FROM app.vw_ligacoes_analiticas WHERE ${conds.join(' AND ')}
      ORDER BY encerrada_em DESC LIMIT $${params.length}`,
    params)
  return rows
}

module.exports = { listarLigacoesEncerradas }
