'use strict'
// Auto-lock de leads rodados: quando a conversa morre (sem resposta há N dias) ou dá
// sinal de rejeição (status 'rejeitado'), o lead fica bloqueado por LEAD_LOCK_DIAS dias
// — ninguém consegue "rodar" de novo nesse período. O bloqueio reabre sozinho quando a
// data passa (a checagem do disparo compara bloqueado_ate > NOW()).
//
// Escopo: só afeta leads que JÁ foram rodados manualmente (têm prospectador.lead_disparos),
// pra não interferir no pipeline automático de prospecção.
const { logger } = require('../logger')

const LOCK_DIAS = Math.max(1, parseInt(process.env.LEAD_LOCK_DIAS, 10) || 15)
const MORTA_DIAS = Math.max(1, parseInt(process.env.LEAD_MORTA_DIAS, 10) || 5)
const WORKER_MS = Math.max(60_000, parseInt(process.env.LEAD_LOCK_WORKER_MS, 10) || 3_600_000)

async function aplicarBloqueiosAutomaticos(pool) {
  // 1) Rejeição: lead rodado virou 'rejeitado' e ainda não está bloqueado.
  const rej = await pool.query(
    `UPDATE prospectador.prospects p
        SET bloqueado_ate = NOW() + make_interval(days => $1),
            bloqueio_motivo = 'rejeicao',
            updated_at = NOW()
      WHERE p.status = 'rejeitado'
        AND p.bloqueado_ate IS NULL
        AND EXISTS (SELECT 1 FROM prospectador.lead_disparos d WHERE d.prospect_id = p.id)`,
    [LOCK_DIAS]
  )

  // 2) Conversa morta: rodado (status 'enviado'), sem resposta, e o último disparo
  //    enviado foi há mais de MORTA_DIAS dias.
  const morta = await pool.query(
    `UPDATE prospectador.prospects p
        SET bloqueado_ate = NOW() + make_interval(days => $1),
            bloqueio_motivo = 'sem_resposta',
            updated_at = NOW()
      WHERE p.status = 'enviado'
        AND p.bloqueado_ate IS NULL
        AND (
          SELECT MAX(d.criado_em) FROM prospectador.lead_disparos d
           WHERE d.prospect_id = p.id AND d.status = 'enviado'
        ) < NOW() - make_interval(days => $2)`,
    [LOCK_DIAS, MORTA_DIAS]
  )

  const total = (rej.rowCount || 0) + (morta.rowCount || 0)
  if (total > 0) {
    logger.info({ rejeicao: rej.rowCount, sem_resposta: morta.rowCount }, '[lead-lock] leads bloqueados (15d)')
  }
  return { rejeicao: rej.rowCount || 0, sem_resposta: morta.rowCount || 0 }
}

function iniciarLeadLockWorker(pool) {
  const tick = () => {
    aplicarBloqueiosAutomaticos(pool).catch((err) =>
      logger.error({ err: err.message }, '[lead-lock] tick falhou')
    )
  }
  // Primeiro tick logo após o boot, depois a cada WORKER_MS.
  setTimeout(tick, 30_000)
  const timer = setInterval(tick, WORKER_MS)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info({ intervalo_ms: WORKER_MS, lock_dias: LOCK_DIAS, morta_dias: MORTA_DIAS }, '[lead-lock] worker iniciado')
  return timer
}

module.exports = { aplicarBloqueiosAutomaticos, iniciarLeadLockWorker, LOCK_DIAS, MORTA_DIAS }
