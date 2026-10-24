// @ts-check
'use strict'

/**
 * Único produtor do job de transcrição. Reusar uma linha concluída é seguro: a chave aponta
 * para a mídia original e o worker só agenda resposta após substituir o marcador no histórico.
 */
/**
 * @param {any} pool
 * @param {unknown} audioId
 * @param {{ maxAttempts?: number, requestId?: string | null }} [opcoes]
 */
async function enfileirarTranscricaoAudio(pool, audioId, { maxAttempts, requestId = null } = {}) {
  const id = Number(audioId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Áudio inválido para a fila de transcrição')
  const tentativas = Math.max(1, Number(maxAttempts) || 5)
  const dedupe = `audio_transcricao:${id}`
  const { rows } = await pool.query(
    `INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
     VALUES ('audio_transcricao', $1, $2::jsonb, 'pending', 0, $3, NOW())
     ON CONFLICT (dedupe_key) DO UPDATE SET
       status = 'pending', attempts = 0, last_error = NULL, available_at = NOW(),
       locked_at = NULL, locked_until = NULL, atualizado_em = NOW()
     RETURNING id`,
    [dedupe, JSON.stringify({ audio_processamento_id: id, request_id: requestId || null }), tentativas]
  )
  await pool.query(
    `UPDATE vendas.audio_processamentos
        SET job_id = $2, status = 'pending', erro = NULL, proxima_tentativa_em = NOW(), atualizado_em = NOW()
      WHERE id = $1 AND status <> 'completed'`,
    [id, rows[0]?.id || null]
  )
  return rows[0]?.id || null
}

module.exports = { enfileirarTranscricaoAudio }
