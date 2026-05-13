'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { listEmpresasDoUsuario } = require('../db/usuarios')

const router = Router()

// GET /api/empresas — empresas do usuário autenticado
router.get('/', requireAuth, async (req, res) => {
  const empresas = await listEmpresasDoUsuario(req.usuario.id).catch(() => [])
  return res.json({ ok: true, data: empresas })
})

// GET /api/empresas/:empresaId
router.get('/:empresaId', requireAuth, requireEmpresaAccess, (req, res) => {
  return res.json({ ok: true, data: req.empresa })
})

// PUT /api/empresas/:empresaId
router.put('/:empresaId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome, config } = req.body || {}
  const sets = []
  const vals = []
  if (nome) { sets.push(`nome = $${vals.push(nome)}`); }
  if (config) { sets.push(`config = $${vals.push(JSON.stringify(config))}`); }
  if (sets.length === 0) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nenhum campo para atualizar.' } })
  }
  sets.push(`atualizado_em = NOW()`)
  vals.push(req.empresa.id)
  const { rows: [empresa] } = await pool.query(
    `UPDATE app.empresas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals
  )
  return res.json({ ok: true, data: empresa })
})

module.exports = router
