'use strict'

const LS = require('../services/lead-search')

async function withTx(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

function json(valor) {
  return JSON.stringify(valor == null ? null : valor)
}

async function criarJobMaps(pool, {
  empresaId,
  usuarioId = null,
  apiKeyId = null,
  channel = 'internal',
  endpoint = 'POST /lead-search/maps',
  request,
  requestedLimit,
}) {
  return withTx(pool, async (client) => {
    const { rows: [job] } = await client.query(
      `INSERT INTO app.lead_search_jobs
         (empresa_id, usuario_id, api_key_id, entry_source, request, requested_limit)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [empresaId, usuarioId, apiKeyId, LS.ENTRY_SOURCE.MAPS, json(request), requestedLimit]
    )
    await client.query(
      `INSERT INTO app.lead_search_job_sources
         (job_id, source, source_state, records_requested)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (job_id, source) DO NOTHING`,
      [job.id, LS.SOURCES.GOOGLE_MAPS, LS.SOURCE_STATE.NOT_CHECKED, requestedLimit]
    )
    await registrarEventoUso(client, {
      empresaId,
      usuarioId,
      apiKeyId,
      jobId: job.id,
      channel,
      eventType: 'job_created',
      endpoint,
      requestSummary: request,
      status: 'accepted',
      recordsRequested: requestedLimit,
    })
    return carregarJob(client, { empresaId, jobId: job.id })
  })
}

async function carregarJob(exec, { empresaId, jobId }) {
  const { rows: jobs } = await exec.query(
    `SELECT *
       FROM app.lead_search_jobs
      WHERE empresa_id = $1 AND id = $2::uuid
      LIMIT 1`,
    [empresaId, jobId]
  )
  const job = jobs[0]
  if (!job) return null
  const { rows: sources } = await exec.query(
    `SELECT *
       FROM app.lead_search_job_sources
      WHERE job_id = $1::uuid
      ORDER BY source ASC`,
    [job.id]
  )
  return { job, sources }
}

async function carregarJobPorId(exec, jobId) {
  const { rows: jobs } = await exec.query(
    `SELECT *
       FROM app.lead_search_jobs
      WHERE id = $1::uuid
      LIMIT 1`,
    [jobId]
  )
  return jobs[0] || null
}

async function carregarJobPorApiKey(exec, { apiKeyId, jobId }) {
  const { rows: jobs } = await exec.query(
    `SELECT *
       FROM app.lead_search_jobs
      WHERE id = $1::uuid
        AND api_key_id = $2::uuid
      LIMIT 1`,
    [jobId, apiKeyId]
  )
  const job = jobs[0]
  if (!job) return null
  const { rows: sources } = await exec.query(
    `SELECT *
       FROM app.lead_search_job_sources
      WHERE job_id = $1::uuid
      ORDER BY source ASC`,
    [job.id]
  )
  return { job, sources }
}

async function carregarFonte(exec, jobId, source = LS.SOURCES.GOOGLE_MAPS) {
  const { rows } = await exec.query(
    `SELECT *
       FROM app.lead_search_job_sources
      WHERE job_id = $1::uuid AND source = $2
      LIMIT 1`,
    [jobId, source]
  )
  return rows[0] || null
}

async function claimProximoJobMaps(pool) {
  return withTx(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM app.lead_search_jobs
        WHERE entry_source = $1
          AND status IN ($2,$3)
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [LS.ENTRY_SOURCE.MAPS, LS.JOB_STATUS.QUEUED, LS.JOB_STATUS.RUNNING]
    )
    const job = rows[0]
    if (!job) return null
    if (job.status === LS.JOB_STATUS.QUEUED) {
      const { rows: atualizados } = await client.query(
        `UPDATE app.lead_search_jobs
            SET status = $2,
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1::uuid
          RETURNING *`,
        [job.id, LS.JOB_STATUS.RUNNING]
      )
      return atualizados[0]
    }
    return job
  })
}

async function iniciarJobMaps(pool, jobId) {
  const { rows } = await pool.query(
    `UPDATE app.lead_search_jobs
        SET status = CASE WHEN status = $2 THEN $3 ELSE status END,
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
      WHERE id = $1::uuid
        AND entry_source = $4
        AND status IN ($2,$3)
      RETURNING *`,
    [jobId, LS.JOB_STATUS.QUEUED, LS.JOB_STATUS.RUNNING, LS.ENTRY_SOURCE.MAPS]
  )
  return rows[0] || null
}

async function registrarTriggerMaps(pool, { jobId, snapshotId, providerStatus = 'triggered', rawProgress = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO app.lead_search_job_sources
       (job_id, source, source_state, provider_status, external_snapshot_id, raw_progress, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (job_id, source) DO UPDATE
        SET provider_status = EXCLUDED.provider_status,
            external_snapshot_id = EXCLUDED.external_snapshot_id,
            raw_progress = EXCLUDED.raw_progress,
            started_at = COALESCE(app.lead_search_job_sources.started_at, NOW()),
            updated_at = NOW()
     RETURNING *`,
    [jobId, LS.SOURCES.GOOGLE_MAPS, LS.SOURCE_STATE.NOT_CHECKED, providerStatus, snapshotId, json(rawProgress)]
  )
  return rows[0] || null
}

async function registrarProgressoFonte(pool, { jobId, providerStatus, rawProgress = {} }) {
  const { rows } = await pool.query(
    `UPDATE app.lead_search_job_sources
        SET provider_status = $2,
            raw_progress = $3,
            updated_at = NOW()
      WHERE job_id = $1::uuid AND source = $4
      RETURNING *`,
    [jobId, providerStatus, json(rawProgress), LS.SOURCES.GOOGLE_MAPS]
  )
  return rows[0] || null
}

async function marcarProviderFailed(pool, { jobId, errorType = 'provider_failed', errorMessage }) {
  return withTx(pool, async (client) => {
    await client.query(
      `UPDATE app.lead_search_job_sources
          SET source_state = $2,
              provider_status = COALESCE(provider_status, 'failed'),
              error_type = $3,
              error_message = $4,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE job_id = $1::uuid AND source = $5`,
      [jobId, LS.SOURCE_STATE.PROVIDER_FAILED, errorType, errorMessage || null, LS.SOURCES.GOOGLE_MAPS]
    )
    const { rows: jobs } = await client.query(
      `UPDATE app.lead_search_jobs
          SET status = $2,
              error_message = $3,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING *`,
      [jobId, LS.JOB_STATUS.FAILED, errorMessage || null]
    )
    const job = jobs[0]
    if (job) {
      await registrarEventoUso(client, {
        empresaId: job.empresa_id,
        usuarioId: job.usuario_id,
        jobId,
        channel: 'internal',
        eventType: 'provider_failed',
        endpoint: 'worker:lead-search',
        requestSummary: job.request || {},
        status: 'provider_failed',
        recordsRequested: job.requested_limit,
        errorCode: errorType,
        contexto: { source: LS.SOURCES.GOOGLE_MAPS },
      })
    }
    return job || null
  })
}

async function salvarResultadosMaps(pool, { jobId, registros }) {
  return withTx(pool, async (client) => {
    const job = await carregarJobPorId(client, jobId)
    if (!job) return null
    const fonte = await carregarFonte(client, jobId, LS.SOURCES.GOOGLE_MAPS)
    const recebidos = Array.isArray(registros) ? registros : []
    const limite = Math.min(Number(job.requested_limit || LS.MAX_LEADS_PER_JOB), LS.MAX_LEADS_PER_JOB)

    await client.query(`DELETE FROM app.lead_search_dossiers WHERE job_id = $1::uuid AND primary_source = $2`, [jobId, LS.SOURCES.GOOGLE_MAPS])
    await client.query(`DELETE FROM app.lead_search_raw_refs WHERE job_id = $1::uuid AND source = $2`, [jobId, LS.SOURCES.GOOGLE_MAPS])

    const rawRows = []
    for (let i = 0; i < recebidos.length; i += 1) {
      const registro = recebidos[i]
      const externalId = registro && typeof registro === 'object'
        ? (registro.place_id || registro.cid || registro.url || null)
        : null
      const { rows: [raw] } = await client.query(
        `INSERT INTO app.lead_search_raw_refs
           (job_id, source_id, source, item_index, external_id, raw_path, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, source, item_index, raw_path`,
        [jobId, fonte?.id || null, LS.SOURCES.GOOGLE_MAPS, i, externalId, 'payload', json(registro)]
      )
      rawRows.push(raw)
    }

    let retornados = 0
    for (let i = 0; i < recebidos.length && retornados < limite; i += 1) {
      const registro = recebidos[i]
      if (!registro || typeof registro !== 'object') continue
      const dossier = LS.montarDossierMaps(registro, rawRows[i])
      if (!dossier.external_ref && !dossier.canonical?.business?.name) continue
      await client.query(
        `INSERT INTO app.lead_search_dossiers
           (job_id, empresa_id, primary_source, external_ref, canonical, source_status, source_data, raw_refs, verification)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (job_id, primary_source, external_ref)
           WHERE external_ref IS NOT NULL
           DO UPDATE SET
             canonical = EXCLUDED.canonical,
             source_status = EXCLUDED.source_status,
             source_data = EXCLUDED.source_data,
             raw_refs = EXCLUDED.raw_refs,
             verification = EXCLUDED.verification,
             updated_at = NOW()`,
        [
          jobId,
          job.empresa_id,
          dossier.primary_source,
          dossier.external_ref,
          json(dossier.canonical),
          json(dossier.source_status),
          json(dossier.source_data),
          json(dossier.raw_refs),
          json(dossier.verification),
        ]
      )
      retornados += 1
    }

    const sourceState = retornados > 0 ? LS.SOURCE_STATE.FOUND : LS.SOURCE_STATE.NOT_FOUND
    await client.query(
      `UPDATE app.lead_search_job_sources
          SET source_state = $2,
              provider_status = 'ready',
              records_returned = $3,
              cost_records = $4,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE job_id = $1::uuid AND source = $5`,
      [jobId, sourceState, recebidos.length, recebidos.length, LS.SOURCES.GOOGLE_MAPS]
    )
    const { rows: jobs } = await client.query(
      `UPDATE app.lead_search_jobs
          SET status = $2,
              returned_count = $3,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING *`,
      [jobId, LS.JOB_STATUS.COMPLETED, retornados]
    )
    await registrarEventoUso(client, {
      empresaId: job.empresa_id,
      usuarioId: job.usuario_id,
      jobId,
      channel: 'internal',
      eventType: 'job_completed',
      endpoint: 'worker:lead-search',
      requestSummary: job.request || {},
      status: 'completed',
      recordsRequested: job.requested_limit,
      recordsReturned: retornados,
      contexto: { source: LS.SOURCES.GOOGLE_MAPS, raw_records: recebidos.length },
    })
    return jobs[0] || null
  })
}

async function listarDossiers(pool, { empresaId, jobId, limit = 50, offset = 0 }) {
  const limite = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  const deslocamento = Math.max(Number.parseInt(offset, 10) || 0, 0)
  const { rows } = await pool.query(
    `SELECT d.*
       FROM app.lead_search_dossiers d
       JOIN app.lead_search_jobs j ON j.id = d.job_id
      WHERE d.job_id = $1::uuid
        AND d.empresa_id = $2
        AND j.empresa_id = $2
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $3 OFFSET $4`,
    [jobId, empresaId, limite, deslocamento]
  )
  return rows
}

async function listarDossiersPorApiKey(pool, { apiKeyId, jobId, limit = 50, offset = 0 }) {
  const limite = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100)
  const deslocamento = Math.max(Number.parseInt(offset, 10) || 0, 0)
  const { rows } = await pool.query(
    `SELECT d.*
       FROM app.lead_search_dossiers d
       JOIN app.lead_search_jobs j ON j.id = d.job_id
      WHERE d.job_id = $1::uuid
        AND j.api_key_id = $2::uuid
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $3 OFFSET $4`,
    [jobId, apiKeyId, limite, deslocamento]
  )
  return rows
}

async function registrarEventoUso(exec, {
  empresaId = null,
  usuarioId = null,
  apiKeyId = null,
  jobId = null,
  channel = 'internal',
  eventType,
  endpoint = null,
  requestSummary = {},
  status,
  recordsRequested = 0,
  recordsReturned = 0,
  errorCode = null,
  contexto = {},
}) {
  await exec.query(
    `INSERT INTO app.lead_search_usage_events
       (empresa_id, usuario_id, api_key_id, job_id, channel, event_type, endpoint,
        request_summary, status, records_requested, records_returned, error_code, contexto)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      empresaId,
      usuarioId,
      apiKeyId,
      jobId,
      channel,
      eventType,
      endpoint,
      json(requestSummary),
      status,
      recordsRequested,
      recordsReturned,
      errorCode,
      json(contexto),
    ]
  )
}

module.exports = {
  criarJobMaps,
  carregarJob,
  carregarJobPorId,
  carregarJobPorApiKey,
  carregarFonte,
  claimProximoJobMaps,
  iniciarJobMaps,
  registrarTriggerMaps,
  registrarProgressoFonte,
  marcarProviderFailed,
  salvarResultadosMaps,
  listarDossiers,
  listarDossiersPorApiKey,
  registrarEventoUso,
}
