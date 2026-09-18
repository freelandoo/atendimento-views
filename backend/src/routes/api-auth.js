'use strict'
const { Router } = require('express')
const { verifyPassword, signJwt, hashPassword } = require('../auth')
const { findUsuarioByEmail, findUsuarioById, updateUltimoLogin, listEmpresasDoUsuario, existsEmail, signupUsuario } = require('../db/usuarios')
const { requireAuth } = require('../middleware/tenant')
const { capacidadesDoVinculo } = require('../services/acesso-capacidades')
const { avaliarAcesso: avaliarAcessoPrograma } = require('../services/programa-aceite')
const { VERSAO: TERMO_VERSAO } = require('../services/programa-termo')
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
// GET /me — sessão + empresas do usuário, agora com as CAPACIDADES por empresa.
//
// A tela precisa saber o que esconder, e **não pode conhecer a matriz**: quem decide é o módulo
// PURO `services/acesso-capacidades.js`, e aqui só se traduz o veredito (mesmo contrato de
// `frontend/lib/site-rotulos.js`). `permissoes` NÃO é devolvido cru de propósito — o que a tela
// precisa é a lista efetiva, e expor as concessões separadas convidaria o front a recombiná-las.
//
// Campos ADITIVOS: `role_usuario` já existia; `papel_empresa` e `capacidades` são novos. Nenhum
// consumidor anterior muda de comportamento.
router.get('/me', requireAuth, async (req, res) => {
  const empresas = await listEmpresasDoUsuario(req.usuario.id).catch(() => [])
  return res.json({
    ok: true,
    data: {
      usuario: { id: req.usuario.id, email: req.usuario.email, nome: req.usuario.nome, role: req.usuario.role },
      empresas: empresas.map(({ permissoes, aceite_versao, aceite_em, ...empresa }) => ({
        ...empresa,
        papel_empresa: empresa.role_usuario,
        capacidades: capacidadesDoVinculo({
          papel: empresa.role_usuario,
          permissoes,
          papelPlataforma: req.usuario.role,
        }),
        // OPERAÇÃO COMERCIAL, Etapa 1. Campo ADITIVO: nenhum consumidor anterior muda.
        // Quem compara a versão gravada com a vigente é o módulo PURO — a tela recebe o
        // veredito pronto, exatamente como recebe `capacidades`, e nunca a versão crua para
        // recombinar. `aceite_versao` sai do payload de propósito (ver o destructuring acima).
        programa_aceite: avaliarAcessoPrograma({
          papel: empresa.role_usuario,
          papelPlataforma: req.usuario.role,
          aceite: aceite_versao ? { versao: aceite_versao, em: aceite_em } : null,
        }, TERMO_VERSAO),
      })),
    },
  })
})

module.exports = router
