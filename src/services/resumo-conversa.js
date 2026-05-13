'use strict'
const { summarizeConversation } = require('../ai-provider')

/**
 * Gera e persiste um resumo de conversa em app.conversa_resumos.
 * @returns {string} texto do resumo
 */
async function gerarESalvarResumo(pool, { empresaId, numero, historico, log }) {
  const result = await summarizeConversation({ historico, pool, log })
  const resumo = result.text || ''
  if (!resumo) return resumo

  await pool.query(
    `INSERT INTO app.conversa_resumos (empresa_id, numero, resumo, metadata)
     VALUES ($1, $2, $3, $4)`,
    [
      empresaId,
      numero,
      resumo,
      JSON.stringify({ provider: result.provider, model: result.model }),
    ]
  )
  return resumo
}

/**
 * Retorna o resumo mais recente para um número dentro de uma empresa.
 * @returns {string|null}
 */
async function buscarUltimoResumo(pool, { empresaId, numero }) {
  const { rows } = await pool.query(
    `SELECT resumo FROM app.conversa_resumos
     WHERE empresa_id = $1 AND numero = $2
     ORDER BY criado_em DESC LIMIT 1`,
    [empresaId, numero]
  )
  return rows.length ? rows[0].resumo : null
}

module.exports = { gerarESalvarResumo, buscarUltimoResumo }
