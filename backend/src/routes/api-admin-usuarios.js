'use strict'
const { Router } = require('express')
const { hashPassword } = require('../auth')
const { requireAuth, requireRole } = require('../middleware/tenant')
const {
  listUsuarios, createUsuarioPorAdmin, updateUsuarioRole, setUsuarioAtivo, existsEmail,
} = require('../db/usuarios')

const router = Router()
router.use(requireAuth, requireRole('superadmin'))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GET /api/admin/usuarios
router.get('/usuarios', async (_req, res) => {
  try {
    return res.json({ ok: true, data: await listUsuarios() })
  } catch {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao listar usuários.' } })
  }
})

// POST /api/admin/usuarios  { email, nome, password, role }
router.post('/usuarios', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const nome = String(req.body?.nome || '').trim()
  const password = String(req.body?.password || '')
  const role = req.body?.role === 'admin' ? 'admin' : 'user'

  if (!EMAIL_RE.test(email) || !nome || password.length < 8) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Email, nome e senha (≥8) obrigatórios.' } })
  }
  try {
    if (await existsEmail(email)) {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    const password_hash = await hashPassword(password)
    const u = await createUsuarioPorAdmin({ email, nome, password_hash, role })
    return res.status(201).json({ ok: true, data: u })
  } catch {
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao criar conta.' } })
  }
})

// PATCH /api/admin/usuarios/:id  { role?, ativo? }
router.patch('/usuarios/:id', async (req, res) => {
  const { id } = req.params
  try {
    let atual = null
    if (typeof req.body?.role === 'string') {
      atual = await updateUsuarioRole(id, req.body.role)
    }
    if (typeof req.body?.ativo === 'boolean') {
      atual = await setUsuarioAtivo(id, req.body.ativo)
    }
    if (!atual) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Usuário não encontrado ou nada a alterar.' } })
    return res.json({ ok: true, data: atual })
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: err.message } })
  }
})

function registerAdminUsuariosRoutes(app) {
  app.use('/api/admin', router)
}

module.exports = { registerAdminUsuariosRoutes, router }
