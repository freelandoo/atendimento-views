'use strict'
const { Router } = require('express')
const axios = require('axios')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')

const router = Router({ mergeParams: true })

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

// GET /api/empresas/:empresaId/whatsapp
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresa_whatsapp_instances WHERE empresa_id = $1 ORDER BY criado_em DESC',
    [req.empresa.id]
  )
  return res.json({ ok: true, data: rows })
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

  try {
    await axios.post(
      `${EVOLUTION_URL}/instance/create`,
      { instanceName: evolution_instance, integration: 'WHATSAPP-BAILEYS', qrcode: true },
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

  try {
    const { rows: [inst] } = await pool.query(
      `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.empresa.id, evolution_instance, nome || null, JSON.stringify(config_json)]
    )
    return res.status(201).json({ ok: true, data: inst })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Já existe uma instância com esse nome técnico.' } })
    }
    throw err
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
    'SELECT id, evolution_instance FROM app.empresa_whatsapp_instances WHERE id = $1 AND empresa_id = $2',
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
  return res.json({ ok: true, data: { id: inst.id, deleted: true } })
})

module.exports = router
