'use strict'

const KEY = require('../services/lead-search-keys')

function json(valor) {
  return JSON.stringify(valor == null ? null : valor)
}

async function listarChaves(pool, { empresaId = null, status = null, limit = 100 } = {}) {
  const params = []
  const where = []
  if (empresaId) { params.push(empresaId); where.push(`empresa_id = $${params.length}`) }
  if (status) { params.push(status); where.push(`status = $${params.length}`) }
  params.push(Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 200))
  const { rows } = await pool.query(
    `SELECT id, empresa_id, nome, key_hint, scopes, status, max_leads_per_job,
            rate_limit_per_minute, expires_at, revoked_at, created_at, updated_at
       FROM app.lead_search_api_keys
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

async function criarChave(pool, {
  empresaId,
  nome,
  scopes,
  expiresAt = null,
  maxLeadsPerJob,
  rateLimitPerMinute,
  createdByUsuarioId = null,
}) {
  const nomeLimpo = String(nome || '').trim()
  if (!nomeLimpo) throw KEY.erro('Informe um nome para o codigo de acesso.', 400, 'MISSING_NAME')
  const material = KEY.criarMaterialChave()
  const scopesNormalizados = KEY.normalizarScopes(scopes)
  const limite = KEY.normalizarLimiteChave(maxLeadsPerJob)
  const rate = KEY.normalizarRateLimit(rateLimitPerMinute)
  const expiracao = KEY.normalizarExpiracao(expiresAt)

  const { rows: [row] } = await pool.query(
    `INSERT INTO app.lead_search_api_keys
       (empresa_id, nome, key_hash, key_hint, scopes, max_leads_per_job,
        rate_limit_per_minute, expires_at, created_by_usuario_id)
     VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9)
     RETURNING id, empresa_id, nome, key_hint, scopes, status, max_leads_per_job,
               rate_limit_per_minute, expires_at, revoked_at, created_at, updated_at`,
    [
      empresaId || null,
      nomeLimpo,
      material.key_hash,
      material.key_hint,
      scopesNormalizados,
      limite,
      rate,
      expiracao,
      createdByUsuarioId,
    ]
  )
  return { chave: row, codigo: material.codigo }
}

async function revogarChave(pool, { keyId, usuarioId = null }) {
  const { rows: [row] } = await pool.query(
    `UPDATE app.lead_search_api_keys
        SET status = 'revoked',
            revoked_by_usuario_id = $2,
            revoked_at = COALESCE(revoked_at, NOW()),
            updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, empresa_id, nome, key_hint, scopes, status, max_leads_per_job,
                rate_limit_per_minute, expires_at, revoked_at, created_at, updated_at`,
    [keyId, usuarioId]
  )
  return row || null
}

async function rotacionarChave(pool, { keyId, usuarioId = null }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [atual] } = await client.query(
      `SELECT empresa_id, nome, scopes, max_leads_per_job, rate_limit_per_minute, expires_at
         FROM app.lead_search_api_keys
        WHERE id = $1::uuid
        FOR UPDATE`,
      [keyId]
    )
    if (!atual) {
      await client.query('ROLLBACK')
      return null
    }
    await revogarChave(client, { keyId, usuarioId })
    const nova = await criarChave(client, {
      empresaId: atual.empresa_id,
      nome: `${atual.nome} (rotacionada)`,
      scopes: atual.scopes,
      expiresAt: atual.expires_at,
      maxLeadsPerJob: atual.max_leads_per_job,
      rateLimitPerMinute: atual.rate_limit_per_minute,
      createdByUsuarioId: usuarioId,
    })
    await client.query('COMMIT')
    return nova
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function buscarPorCodigo(pool, codigo) {
  const keyHash = KEY.hashCodigoAcesso(codigo)
  const { rows } = await pool.query(
    `SELECT id, empresa_id, nome, key_hint, scopes, status, max_leads_per_job,
            rate_limit_per_minute, expires_at, revoked_at, created_at, updated_at
       FROM app.lead_search_api_keys
      WHERE key_hash = $1
      LIMIT 1`,
    [keyHash]
  )
  return rows[0] || null
}

async function autenticarCodigo(pool, codigo, { scope } = {}) {
  const row = await buscarPorCodigo(pool, codigo)
  return KEY.verificarUsoChave(row, scope)
}

async function contarCriacoesRecentes(pool, apiKeyId) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM app.lead_search_usage_events
      WHERE api_key_id = $1::uuid
        AND event_type = 'job_created'
        AND status = 'accepted'
        AND created_at >= NOW() - INTERVAL '1 minute'`,
    [apiKeyId]
  )
  return Number(r?.total || 0)
}

async function registrarBloqueio(pool, { chave, endpoint, requestSummary = {}, errorCode }) {
  await pool.query(
    `INSERT INTO app.lead_search_usage_events
       (empresa_id, api_key_id, job_id, channel, event_type, endpoint, request_summary,
        status, records_requested, records_returned, error_code, contexto)
     VALUES ($1,$2,NULL,'external','request_blocked',$3,$4,'blocked',0,0,$5,$6)`,
    [
      chave?.empresa_id || null,
      chave?.id || null,
      endpoint,
      json(requestSummary),
      errorCode,
      json({ key_hint: chave?.key_hint || null }),
    ]
  )
}

module.exports = {
  listarChaves,
  criarChave,
  revogarChave,
  rotacionarChave,
  buscarPorCodigo,
  autenticarCodigo,
  contarCriacoesRecentes,
  registrarBloqueio,
}
