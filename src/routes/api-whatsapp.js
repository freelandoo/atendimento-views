'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')

const router = Router({ mergeParams: true })

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
