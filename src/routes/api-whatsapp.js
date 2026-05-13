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
  const { rows: [inst] } = await pool.query(
    `INSERT INTO app.empresa_whatsapp_instances (empresa_id, evolution_instance, nome, config_json)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.empresa.id, evolution_instance, nome || null, JSON.stringify(config_json)]
  )
  return res.status(201).json({ ok: true, data: inst })
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

// DELETE /api/empresas/:empresaId/whatsapp/:instanceId (desativa — não apaga)
router.delete('/:instanceId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [inst] } = await pool.query(
    `UPDATE app.empresa_whatsapp_instances SET ativo = false, atualizado_em = NOW()
     WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [req.params.instanceId, req.empresa.id]
  )
  if (!inst) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Instância não encontrada.' } })
  return res.json({ ok: true, data: inst })
})

module.exports = router
