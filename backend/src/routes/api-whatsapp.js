'use strict'
const { Router } = require('express')
const axios = require('axios')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { marcarOnboardingCompleto } = require('../db/usuarios')
const { invalidarCacheEmpresa } = require('../services/contexto-empresa')

const router = Router({ mergeParams: true })

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL || ''
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''

function webhookConfigForInstance() {
  if (!PUBLIC_BACKEND_URL) return null
  return {
    enabled: true,
    url: `${PUBLIC_BACKEND_URL.replace(/\/+$/, '')}/webhook`,
    byEvents: false,
    base64: false,
    headers: WEBHOOK_SECRET ? { 'x-webhook-secret': WEBHOOK_SECRET } : undefined,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
  }
}

async function aplicarWebhookEvolution(instanceName) {
  const wh = webhookConfigForInstance()
  if (!wh) return
  try {
    await axios.post(
      `${EVOLUTION_URL}/webhook/set/${encodeURIComponent(instanceName)}`,
      { webhook: wh },
      { headers: { apikey: EVOLUTION_KEY }, timeout: 10000 }
    )
  } catch (_) {}
}

// Cada instância é dona de um Contexto 1:1. Cria um contexto vazio e devolve {id, nome}.
// Recebe um client (pode estar dentro de transação) para garantir atomicidade com a instância.
async function criarContextoParaInstancia(client, empresaId, nome) {
  const { rows: [ctx] } = await client.query(
    `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
     VALUES ($1, $2, '', '{}'::jsonb) RETURNING id, nome`,
    [empresaId, nome]
  )
  return ctx
}

// GET /api/empresas/:empresaId/whatsapp
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ewi.*, c.nome AS contexto_nome
       FROM app.empresa_whatsapp_instances ewi
       LEFT JOIN app.empresa_contextos c ON c.id = ewi.contexto_id
      WHERE ewi.empresa_id = $1
      ORDER BY ewi.criado_em DESC`,
    [req.empresa.id]
  )
  return res.json({ ok: true, data: rows })
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId — instância única (com contexto vinculado).
// Garante o invariante 1:1: se a instância (legado) ainda não tem contexto, cria um na hora.
router.get('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    `SELECT ewi.*, c.nome AS contexto_nome
       FROM app.empresa_whatsapp_instances ewi
       LEFT JOIN app.empresa_contextos c ON c.id = ewi.contexto_id
      WHERE ewi.id = $1 AND ewi.empresa_id = $2`,
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  if (!inst.contexto_id) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const ctx = await criarContextoParaInstancia(client, req.empresa.id, inst.nome || inst.evolution_instance)
      await client.query(
        `UPDATE app.empresa_whatsapp_instances SET contexto_id = $1, atualizado_em = NOW() WHERE id = $2`,
        [ctx.id, inst.id]
      )
      await client.query('COMMIT')
      inst.contexto_id = ctx.id
      inst.contexto_nome = ctx.nome
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
  return res.json({ ok: true, data: inst })
})

// PATCH /api/empresas/:empresaId/whatsapp/:instanceId — atualiza link de contexto (e nome opcional)
router.patch('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { contexto_id, nome } = req.body || {}
  const sets = []
  const vals = []
  if (contexto_id !== undefined) {
    if (contexto_id === null || contexto_id === '') {
      sets.push(`contexto_id = NULL`)
    } else {
      // Garante que o contexto pertence à empresa
      const { rows } = await pool.query(
        'SELECT id FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
        [contexto_id, req.empresa.id]
      )
      if (!rows.length) {
        return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Contexto inválido.' } })
      }
      sets.push(`contexto_id = $${vals.push(contexto_id)}`)
    }
  }
  if (nome !== undefined) sets.push(`nome = $${vals.push(nome)}`)
  // Liga/desliga o número: instância inativa não resolve a empresa no webhook (db/empresas.js).
  if (typeof req.body?.ativo === 'boolean') sets.push(`ativo = $${vals.push(req.body.ativo)}`)
  if (!sets.length) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nada para atualizar.' } })
  }
  sets.push(`atualizado_em = NOW()`)
  vals.push(req.params.instanceId, req.empresa.id)
  const { rows: [inst] } = await pool.query(
    `UPDATE app.empresa_whatsapp_instances SET ${sets.join(', ')}
     WHERE id = $${vals.length - 1} AND empresa_id = $${vals.length}
     RETURNING *`,
    vals
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  return res.json({ ok: true, data: inst })
})

// POST /api/empresas/:empresaId/whatsapp
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { evolution_instance, nome, config_json = {} } = req.body || {}
  if (!evolution_instance) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'evolution_instance obrigatório.' } })
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(evolution_instance)) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'evolution_instance só aceita letras, números, _ e -.' } })
  }

  const webhookCfg = webhookConfigForInstance()
  const createPayload = {
    instanceName: evolution_instance,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    ...(webhookCfg ? { webhook: webhookCfg } : {}),
  }
  try {
    await axios.post(
      `${EVOLUTION_URL}/instance/create`,
      createPayload,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
  } catch (err) {
    const status = err.response?.status
    const msg = err.response?.data?.response?.message || err.response?.data?.message || err.message
    const alreadyExists = status === 403 || status === 409 ||
      (Array.isArray(msg) ? msg.some((m) => /already in use|exists/i.test(String(m))) : /already in use|exists/i.test(String(msg)))
    if (!alreadyExists) {
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_CREATE_FAILED', message: Array.isArray(msg) ? msg.join('; ') : String(msg || 'Falha ao criar instância no Evolution.') } })
    }
  }

  // Garante webhook configurado (idempotente — funciona mesmo se a instância já existia)
  await aplicarWebhookEvolution(evolution_instance)

  // Cria a instância + o contexto dela (1:1) na mesma transação — sem contexto órfão se algo falhar.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ctx = await criarContextoParaInstancia(client, req.empresa.id, nome || evolution_instance)
    const { rows: [inst] } = await client.query(
      `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json, contexto_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.empresa.id, evolution_instance, nome || null, JSON.stringify(config_json), ctx.id]
    )
    await client.query('COMMIT')
    inst.contexto_nome = ctx.nome
    marcarOnboardingCompleto(req.usuario.id, req.empresa.id).catch(() => {})
    return res.status(201).json({ ok: true, data: inst })
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Já existe uma instância com esse nome técnico.' } })
    }
    throw err
  } finally {
    client.release()
  }
})

// GET /api/empresas/:empresaId/whatsapp/:instanceId/qrcode
router.get('/:instanceId/qrcode', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    'SELECT evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2',
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  try {
    const { data } = await axios.get(
      `${EVOLUTION_URL}/instance/connect/${encodeURIComponent(inst.evolution_instance)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
    if (data?.instance?.state === 'open') {
      return res.json({ ok: true, data: { connected: true, instance: inst.evolution_instance } })
    }
    const base64 = data?.base64 || (data?.qrcode?.base64) || null
    const pairingCode = data?.pairingCode || data?.code || null
    if (!base64 && !pairingCode) {
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_NO_QR', message: 'Evolution não retornou QR Code.' } })
    }
    return res.json({ ok: true, data: { connected: false, instance: inst.evolution_instance, base64, pairingCode } })
  } catch (err) {
    const status = err.response?.status || 502
    const message = err.response?.data?.message || err.message || 'Falha ao conectar com Evolution.'
    return res.status(status === 404 ? 404 : 502).json({ ok: false, error: { code: 'EVOLUTION_ERROR', message } })
  }
})

// DELETE /api/empresas/:empresaId/whatsapp/:instanceId
// Remove do Evolution e apaga do banco (hard delete — sincronia)
router.delete('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    'SELECT id, evolution_instance, contexto_id FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2',
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })

  try {
    await axios.delete(
      `${EVOLUTION_URL}/instance/delete/${encodeURIComponent(inst.evolution_instance)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 15000 }
    )
  } catch (err) {
    if (err.response?.status !== 404) {
      const msg = err.response?.data?.message || err.message
      return res.status(502).json({ ok: false, error: { code: 'EVOLUTION_DELETE_FAILED', message: String(msg) } })
    }
  }

  await pool.query('DELETE FROM app.empresa_whatsapp_instances WHERE id = $1', [inst.id])
  // Contexto é 1:1 com a instância — apaga o contexto dela (CASCADE leva versões/fontes junto).
  if (inst.contexto_id) {
    await pool.query('DELETE FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2', [inst.contexto_id, req.empresa.id])
    invalidarCacheEmpresa(req.empresa.id)
  }
  return res.json({ ok: true, data: { id: inst.id, deleted: true } })
})

module.exports = router
