'use strict'

/**
 * Limpeza do backlog do sistema ANTIGO de prospecção + ativação segura do novo
 * sistema diário (prospeccao_configuracoes + prospeccao_fila_diaria).
 *
 * Escopo (autorizado por Victor em 2026-05-27 — "apagar só backlog antigo"):
 *  - Apaga jobs prospeccao_* pendentes/falhos do caminho antigo (sem fila_id).
 *  - Marca como 'failed' os send_attempts 'scheduled' órfãos (jobs deletados),
 *    liberando os números para o novo sistema (não fazem mais parte da fila).
 *  - Desliga a config antiga (auto_prospeccao_config.enabled = false).
 *  - Ajusta horário de início do sistema novo para 09:00 (era 05:00).
 *  - Ressincroniza as sequences (defesa contra duplicate key pós-restore).
 *
 * PRESERVA: send_attempts 'sent' (histórico real), todos os prospects,
 * e os jobs já 'completed'.
 *
 * Uso:
 *   node scripts/cleanup-prospeccao-legado.js          (dry-run: só mostra)
 *   node scripts/cleanup-prospeccao-legado.js --apply   (efetiva em transação)
 */

const fs = require('fs')
const path = require('path')

// Carrega .env local (igual ao index.js) para que DATABASE_URL seja resolvido
// quando o script roda fora do ambiente Railway.
;(function carregarEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    process.env[key] = val
  }
})()

const { pool } = require('../src/db')

const APPLY = process.argv.includes('--apply')

async function contar(sql, params = []) {
  const { rows } = await pool.query(sql, params)
  return Number(rows[0]?.total || 0)
}

async function main() {
  const info = await pool.query(`SELECT current_database() AS db, inet_server_port() AS port`)
  console.log(`Banco: ${info.rows[0].db} (porta ${info.rows[0].port})`)
  console.log(`Modo: ${APPLY ? 'APPLY (efetiva alterações)' : 'DRY-RUN (somente leitura)'}\n`)

  const jobsBacklog = await contar(
    `SELECT COUNT(*)::int AS total FROM vendas.job_queue
     WHERE tipo LIKE 'prospeccao%' AND status IN ('pending','failed')
       AND COALESCE(payload->>'fila_id','') = ''`
  )
  const sendScheduled = await contar(
    `SELECT COUNT(*)::int AS total FROM prospectador.send_attempts WHERE status = 'scheduled'`
  )
  const sentMantidos = await contar(
    `SELECT COUNT(*)::int AS total FROM prospectador.send_attempts WHERE status = 'sent'`
  )
  const jobsCompleted = await contar(
    `SELECT COUNT(*)::int AS total FROM vendas.job_queue WHERE tipo LIKE 'prospeccao%' AND status = 'completed'`
  )

  console.log('Antes:')
  console.log(`  - jobs antigos a apagar (pending/failed, sem fila_id): ${jobsBacklog}`)
  console.log(`  - send_attempts 'scheduled' órfãos a marcar failed:    ${sendScheduled}`)
  console.log(`  - send_attempts 'sent' PRESERVADOS (histórico):         ${sentMantidos}`)
  console.log(`  - jobs 'completed' PRESERVADOS:                         ${jobsCompleted}\n`)

  if (!APPLY) {
    console.log('DRY-RUN: nada foi alterado. Rode com --apply para efetivar.')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const delJobs = await client.query(
      `DELETE FROM vendas.job_queue
       WHERE tipo LIKE 'prospeccao%' AND status IN ('pending','failed')
         AND COALESCE(payload->>'fila_id','') = ''`
    )

    const updSend = await client.query(
      `UPDATE prospectador.send_attempts
       SET status = 'failed',
           erro = COALESCE(NULLIF(erro, ''), 'cancelado_migracao_sistema_diario'),
           updated_at = NOW()
       WHERE status = 'scheduled'`
    )

    const updAuto = await client.query(
      `UPDATE prospectador.auto_prospeccao_config
       SET enabled = false, updated_at = NOW()
       WHERE singleton_id = true`
    )

    const updCfg = await client.query(
      `UPDATE prospectador.prospeccao_configuracoes
       SET horario_inicio = '09:00', atualizado_em = NOW()
       WHERE singleton_id = true`
    )

    await client.query(
      `SELECT setval('prospectador.prospect_events_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prospectador.prospect_events))`
    )
    await client.query(
      `SELECT setval('prospectador.send_attempts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prospectador.send_attempts))`
    )

    await client.query('COMMIT')

    console.log('APPLY concluído (transação commitada):')
    console.log(`  - jobs antigos apagados:            ${delJobs.rowCount}`)
    console.log(`  - send_attempts marcados failed:    ${updSend.rowCount}`)
    console.log(`  - auto_prospeccao_config desligada: ${updAuto.rowCount} linha(s)`)
    console.log(`  - horário do sistema novo -> 09:00: ${updCfg.rowCount} linha(s)`)
    console.log(`  - sequences ressincronizadas.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('ERRO — rollback aplicado, nada foi alterado:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Falha geral:', err.message)
  process.exitCode = 1
})
