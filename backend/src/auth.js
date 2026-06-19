'use strict'
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { pool } = require('./db')
const { logger } = require('./logger')

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'
const PASSWORD_KEYLEN = 64
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

// ─── Senha ────────────────────────────────────────────────────────────────────

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function hashPassword(password, salt = randomToken(16)) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), salt, PASSWORD_KEYLEN, (err, key) => {
      if (err) return reject(err)
      resolve(`scrypt$${salt}$${key.toString('base64url')}`)
    })
  })
}

async function verifyPassword(password, hash) {
  try {
    const [, salt] = hash.split('$')
    const expected = await hashPassword(password, salt)
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  } catch {
    return false
  }
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

function signJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET)
}

// ─── Seed admin ───────────────────────────────────────────────────────────────

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL || process.env.DASHBOARD_ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD || process.env.DASHBOARD_ADMIN_PASSWORD
  const nome = process.env.ADMIN_NOME || 'Admin'

  if (!email || !password) {
    logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD não configurados — seed de admin SaaS pulado.')
    return
  }

  try {
    const { rows } = await pool.query(
      'SELECT id FROM app.usuarios WHERE email = $1',
      [email]
    )
    if (rows.length > 0) return

    const hash = await hashPassword(password)
    const { rows: [user] } = await pool.query(
      `INSERT INTO app.usuarios (email, nome, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email, nome, hash]
    )

    if (!user) return

    await pool.query(
      `INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (usuario_id, empresa_id) DO NOTHING`,
      [user.id, PJ_EMPRESA_ID]
    )

    logger.info({ email }, '✅ Usuário admin SaaS criado e associado à empresa padrão.')
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao criar admin SaaS — continuando boot.')
  }
}

module.exports = { hashPassword, verifyPassword, signJwt, verifyJwt, seedAdminUser }
