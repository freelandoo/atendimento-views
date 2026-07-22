'use strict'

async function cancelarFollowupsAutoPendentes(pool, numero, motivo = 'lead_respondeu') {
  if (!pool) throw new Error('pool obrigatorio')
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!jid) return 0
  const { rows } = await pool.query(
    `
    UPDATE vendas.followup_auto_agendamentos
    SET status = 'cancelado',
        cancelado_em = NOW(),
        motivo_decisao = LEFT(CONCAT(COALESCE(motivo_decisao, ''), CASE WHEN motivo_decisao IS NULL OR motivo_decisao = '' THEN '' ELSE ' | ' END, $2::text), 1000)
    WHERE numero = $1
      AND status = 'agendado'
    RETURNING job_id
    `,
    [jid, motivo]
  )
  const jobIds = rows.map((r) => r.job_id).filter((x) => x != null)
  if (jobIds.length) {
    await pool.query(
      `
      UPDATE vendas.job_queue
      SET status = 'completed',
          last_error = $2,
          locked_at = NULL,
          locked_until = NULL,
          atualizado_em = NOW()
      WHERE id = ANY($1::bigint[])
        AND status = 'pending'
      `,
      [jobIds, `cancelado: ${motivo}`]
    )
  }
  return rows.length
}

module.exports = { cancelarFollowupsAutoPendentes }
