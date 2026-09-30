'use strict'
/**
 * META PESSOAL — acesso a dados (migration 111).
 *
 * Só a CONFIG mora aqui (alvo semanal + dias). O progresso (feito hoje / na semana) é contado
 * sobre `app.plano_dia_itens` reusando `db/plano-dia.resumoPeriodo` — não há SQL de contagem
 * novo. Toda leitura/escrita é escopada por empresa + usuário: a meta é pessoal.
 */
const { pool } = require('../db')

async function obterMeta(empresaId, usuarioId) {
  const { rows } = await pool.query(
    `SELECT alvo_semanal, dias_semana
       FROM app.meta_pessoal
      WHERE empresa_id = $1 AND usuario_id = $2`,
    [empresaId, usuarioId]
  )
  return rows[0] || null
}

/** Upsert da meta da própria pessoa. `config` já vem normalizada (services/meta-pessoal.js). */
async function salvarMeta(empresaId, usuarioId, config) {
  const { rows } = await pool.query(
    `INSERT INTO app.meta_pessoal (empresa_id, usuario_id, alvo_semanal, dias_semana)
     VALUES ($1, $2, $3, $4::int[])
     ON CONFLICT (empresa_id, usuario_id)
     DO UPDATE SET alvo_semanal = EXCLUDED.alvo_semanal,
                   dias_semana  = EXCLUDED.dias_semana,
                   atualizado_em = NOW()
     RETURNING alvo_semanal, dias_semana`,
    [empresaId, usuarioId, config.alvo_semanal, config.dias_semana]
  )
  return rows[0]
}

module.exports = { obterMeta, salvarMeta }
