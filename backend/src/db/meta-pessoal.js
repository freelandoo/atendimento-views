'use strict'
/**
 * META PESSOAL — acesso a dados (migrations 111 + 113).
 *
 * A CONFIG (modo, alvo semanal, alvos por canal, dias) mora aqui. O PROGRESSO agora vem de
 * eventos reais — `contarContatos` soma, por empresa+usuário e por dia, as ligações ENCERRADAS
 * (`app.ligacoes`) e os disparos ENVIADOS (`prospectador.lead_disparos`, cobre saudação Evolution
 * e wa.me manual declarado). A sessão do Postgres já está em APP_TIMEZONE (src/db.js), então
 * `criado_em::date` é o dia local — o mesmo "dia operacional" do resto do Banco de Leads.
 * Toda leitura/escrita é escopada por empresa + usuário: a meta é pessoal.
 */
const { pool } = require('../db')

async function obterMeta(empresaId, usuarioId) {
  const { rows } = await pool.query(
    `SELECT modo, alvo_semanal, alvo_ligacoes, alvo_mensagens, dias_semana
       FROM app.meta_pessoal
      WHERE empresa_id = $1 AND usuario_id = $2`,
    [empresaId, usuarioId]
  )
  return rows[0] || null
}

/** Upsert da meta da própria pessoa. `config` já vem normalizada (services/meta-pessoal.js). */
async function salvarMeta(empresaId, usuarioId, config) {
  const { rows } = await pool.query(
    `INSERT INTO app.meta_pessoal (empresa_id, usuario_id, modo, alvo_semanal, alvo_ligacoes, alvo_mensagens, dias_semana)
     VALUES ($1, $2, $3, $4, $5, $6, $7::int[])
     ON CONFLICT (empresa_id, usuario_id)
     DO UPDATE SET modo = EXCLUDED.modo,
                   alvo_semanal   = EXCLUDED.alvo_semanal,
                   alvo_ligacoes  = EXCLUDED.alvo_ligacoes,
                   alvo_mensagens = EXCLUDED.alvo_mensagens,
                   dias_semana    = EXCLUDED.dias_semana,
                   atualizado_em  = NOW()
     RETURNING modo, alvo_semanal, alvo_ligacoes, alvo_mensagens, dias_semana`,
    [empresaId, usuarioId, config.modo, config.alvo_semanal, config.alvo_ligacoes, config.alvo_mensagens, config.dias_semana]
  )
  return rows[0]
}

/**
 * Contatos reais no intervalo [inicio, fim], por dia e no total da semana.
 * Retorna `{ porDia: { 'YYYY-MM-DD': {ligacoes, mensagens} }, semana: {ligacoes, mensagens} }`.
 */
async function contarContatos(empresaId, usuarioId, inicio, fim) {
  const { rows } = await pool.query(
    `SELECT criado_em::date::text AS dia, 'ligacoes' AS fonte, COUNT(*)::int AS n
       FROM app.ligacoes
      WHERE empresa_id = $1 AND usuario_id = $2 AND status = 'encerrada'
        AND criado_em::date BETWEEN $3::date AND $4::date
      GROUP BY 1
     UNION ALL
     SELECT criado_em::date::text, 'mensagens', COUNT(*)::int
       FROM prospectador.lead_disparos
      WHERE empresa_id = $1 AND usuario_id = $2 AND status = 'enviado'
        AND criado_em::date BETWEEN $3::date AND $4::date
      GROUP BY 1`,
    [empresaId, usuarioId, inicio, fim]
  )
  const porDia = {}
  const semana = { ligacoes: 0, mensagens: 0 }
  for (const r of rows) {
    const d = porDia[r.dia] || (porDia[r.dia] = { ligacoes: 0, mensagens: 0 })
    d[r.fonte] = r.n
    semana[r.fonte] += r.n
  }
  return { porDia, semana }
}

module.exports = { obterMeta, salvarMeta, contarContatos }
