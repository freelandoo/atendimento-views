'use strict'
const { Router } = require('express')
const { verifyPassword, signJwt } = require('../auth')
const { findUsuarioByEmail, findUsuarioById, updateUltimoLogin, listEmpresasDoUsuario } = require('../db/usuarios')
const { requireAuth } = require('../middleware/tenant')

const router = Router()

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'email e password obrigatórios.' } })
  }

  const usuario = await findUsuarioByEmail(email).catch(() => null)
  if (!usuario) {
    return res.status(401).json({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas.' } })
  }

  const ok = await verifyPassword(password, usuario.password_hash)
  if (!ok) {
    return res.status(401).json({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas.' } })
  }

  await updateUltimoLogin(usuario.id).catch(() => null)

  const token = signJwt({ sub: usuario.id, role: usuario.role })
  const empresas = await listEmpresasDoUsuario(usuario.id).catch(() => [])

  return res.json({
    ok: true,
    data: {
      token,
      usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome, role: usuario.role },
      empresas,
    },
  })
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const empresas = await listEmpresasDoUsuario(req.usuario.id).catch(() => [])
  return res.json({
    ok: true,
    data: {
      usuario: { id: req.usuario.id, email: req.usuario.email, nome: req.usuario.nome, role: req.usuario.role },
      empresas,
    },
  })
})

module.exports = router
