'use strict'
const { Router } = require('express')
const { verifyPassword, signJwt, hashPassword } = require('../auth')
const { findUsuarioByEmail, findUsuarioById, updateUltimoLogin, listEmpresasDoUsuario, existsEmail, signupUsuario } = require('../db/usuarios')
const { requireAuth } = require('../middleware/tenant')
const { validarSignup } = require('../auth-validation')
const { signupLimiter, loginLimiter } = require('../rate-limit')

const router = Router()

// POST /api/auth/signup — cadastro público (cria usuário 'user' + empresa própria)
router.post('/signup', signupLimiter, async (req, res) => {
  const v = validarSignup(req.body || {})
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error })

  try {
    if (await existsEmail(v.data.email)) {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    const password_hash = await hashPassword(v.data.password)
    const { usuario, empresa } = await signupUsuario({
      email: v.data.email, nome: v.data.nome, password_hash,
    })
    const token = signJwt({ sub: usuario.id, role: usuario.role })
    return res.status(201).json({
      ok: true,
      data: {
        token,
        usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome, role: usuario.role },
        empresas: [{ ...empresa, role_usuario: 'owner' }],
      },
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'EMAIL_EXISTS', message: 'Email já cadastrado.' } })
    }
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Falha ao criar conta.' } })
  }
})

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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
