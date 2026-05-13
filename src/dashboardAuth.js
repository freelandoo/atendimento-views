'use strict'

const crypto = require('crypto')
const { pool } = require('./db')
const { logger } = require('./logger')

const COOKIE_NAME = 'pj_dashboard_session'
const SESSION_TTL_MS = Math.max(parseInt(process.env.DASHBOARD_SESSION_TTL_MS, 10) || 8 * 60 * 60 * 1000, 15 * 60 * 1000)
const PASSWORD_KEYLEN = 64

function nowPlusSessionTtl() {
  return new Date(Date.now() + SESSION_TTL_MS)
}

function parseCookies(header) {
  const out = {}
  if (!header || typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const key = part.slice(0, i).trim()
    const value = part.slice(i + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch (_) {
      out[key] = value
    }
  }
  return out
}

function sessionCookie(value, expires) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value || '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (expires) parts.push(`Expires=${expires.toUTCString()}`)
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

function clearSessionCookie() {
  return sessionCookie('', new Date(0))
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function hashPassword(password, salt = randomToken(16)) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), salt, PASSWORD_KEYLEN, (err, derivedKey) => {
      if (err) return reject(err)
      resolve(`scrypt$${salt}$${derivedKey.toString('base64url')}`)
    })
  })
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const expected = Buffer.from(parts[2], 'base64url')
  const candidate = await new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), parts[1], expected.length, (err, derivedKey) => {
      if (err) return reject(err)
      resolve(derivedKey)
    })
  })
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
}

function auditMetadata(req, extra) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const metadata = {
    ...extra,
  }
  for (const key of ['numero', 'jid', 'chave', 'id', 'prospect_id', 'acao', 'status']) {
    if (body[key] != null) metadata[key] = String(body[key]).slice(0, 160)
  }
  return metadata
}

async function registrarAuditoria(req, action, metadata) {
  try {
    await pool.query(
      `INSERT INTO vendas.dashboard_audit_log
        (user_id, action, method, path, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        req.dashboardUser?.id || null,
        action,
        req.method,
        req.originalUrl || req.url,
        clientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 500),
        JSON.stringify(metadata || {}),
      ]
    )
  } catch (err) {
    logger.warn('dashboard audit falhou:', err.message)
  }
}

async function ensureDashboardAuthReady() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS vendas`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.dashboard_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nome TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      password_hash TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      ultimo_login_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT dashboard_users_role_chk CHECK (role IN ('admin'))
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.dashboard_sessions (
      id TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES vendas.dashboard_users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip TEXT,
      user_agent TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ultimo_uso_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user_active ON vendas.dashboard_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.dashboard_audit_log (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES vendas.dashboard_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      method TEXT,
      path TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dashboard_audit_user_criado ON vendas.dashboard_audit_log (user_id, criado_em DESC)`)

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM vendas.dashboard_users WHERE ativo = true`)
  if (rows[0]?.total > 0) return

  const email = String(process.env.DASHBOARD_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.DASHBOARD_ADMIN_PASSWORD || '')
  if (!email || !password) {
    throw new Error('DASHBOARD_ADMIN_EMAIL e DASHBOARD_ADMIN_PASSWORD sao obrigatorios para criar o primeiro admin')
  }
  if (password.length < 12) {
    throw new Error('DASHBOARD_ADMIN_PASSWORD precisa ter ao menos 12 caracteres')
  }
  const passwordHash = await hashPassword(password)
  await pool.query(
    `INSERT INTO vendas.dashboard_users (email, nome, role, password_hash, ativo)
     VALUES ($1, $2, 'admin', $3, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       ativo = true,
       role = 'admin',
       atualizado_em = NOW()`,
    [email, email, passwordHash]
  )
}

async function loadSession(req) {
  const cookies = parseCookies(req.headers.cookie)
  const sessionId = cookies[COOKIE_NAME]
  if (!sessionId) return null
  const { rows } = await pool.query(
    `SELECT s.id, s.csrf_token, s.expires_at, u.id AS user_id, u.email, u.nome, u.role
     FROM vendas.dashboard_sessions s
     JOIN vendas.dashboard_users u ON u.id = s.user_id
     WHERE s.id = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.ativo = true
       AND u.role = 'admin'
     LIMIT 1`,
    [sessionId]
  )
  const row = rows[0]
  if (!row) return null
  await pool.query(`UPDATE vendas.dashboard_sessions SET ultimo_uso_em = NOW() WHERE id = $1`, [sessionId])
  return {
    sessionId: row.id,
    csrfToken: row.csrf_token,
    user: {
      id: row.user_id,
      email: row.email,
      nome: row.nome,
      role: row.role,
    },
  }
}

async function requireDashboardAuth(req, res, next) {
  try {
    const loaded = await loadSession(req)
    if (!loaded) return res.status(401).json({ ok: false, erro: 'Nao autenticado' })
    req.dashboardSessionId = loaded.sessionId
    req.dashboardCsrfToken = loaded.csrfToken
    req.dashboardUser = loaded.user

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = String(req.headers['x-csrf-token'] || '')
      if (!csrf || csrf !== loaded.csrfToken) {
        await registrarAuditoria(req, 'csrf_rejeitado', auditMetadata(req))
        return res.status(403).json({ ok: false, erro: 'CSRF invalido' })
      }
      await registrarAuditoria(req, 'dashboard_mutation', auditMetadata(req))
    }
    next()
  } catch (err) {
    logger.error('dashboard auth:', err.message)
    res.status(500).json({ ok: false, erro: 'Falha de autenticacao' })
  }
}

function registerDashboardAuthRoutes(app) {
  app.post('/dashboard/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    try {
      const { rows } = await pool.query(
        `SELECT id, email, nome, role, password_hash
         FROM vendas.dashboard_users
         WHERE email = $1 AND ativo = true AND role = 'admin'
         LIMIT 1`,
        [email]
      )
      const user = rows[0]
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await registrarAuditoria(req, 'login_failed', { email })
        return res.status(401).json({ ok: false, erro: 'Credenciais invalidas' })
      }
      const sessionId = randomToken(32)
      const csrfToken = randomToken(32)
      const expiresAt = nowPlusSessionTtl()
      await pool.query(
        `INSERT INTO vendas.dashboard_sessions (id, user_id, csrf_token, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, user.id, csrfToken, expiresAt, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 500)]
      )
      await pool.query(`UPDATE vendas.dashboard_users SET ultimo_login_em = NOW(), atualizado_em = NOW() WHERE id = $1`, [user.id])
      req.dashboardUser = { id: user.id, email: user.email, nome: user.nome, role: user.role }
      res.setHeader('Set-Cookie', sessionCookie(sessionId, expiresAt))
      await registrarAuditoria(req, 'login_success', { email })
      res.json({
        ok: true,
        csrfToken,
        expiresAt: expiresAt.toISOString(),
        user: { email: user.email, nome: user.nome, role: user.role },
      })
    } catch (err) {
      logger.error('dashboard login:', err.message)
      res.status(500).json({ ok: false, erro: 'Falha no login' })
    }
  })

  app.post('/dashboard/auth/logout', requireDashboardAuth, async (req, res) => {
    await pool.query(`UPDATE vendas.dashboard_sessions SET revoked_at = NOW() WHERE id = $1`, [req.dashboardSessionId])
    await registrarAuditoria(req, 'logout', {})
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.json({ ok: true })
  })

  app.get('/dashboard/auth/session', async (req, res) => {
    const loaded = await loadSession(req)
    if (!loaded) return res.status(401).json({ ok: false, erro: 'Nao autenticado' })
    res.json({
      ok: true,
      csrfToken: loaded.csrfToken,
      user: loaded.user,
    })
  })
}

function dashboardAutorizado(req) {
  return Boolean(req.dashboardUser && req.dashboardUser.role === 'admin')
}

module.exports = {
  COOKIE_NAME,
  clearSessionCookie,
  dashboardAutorizado,
  ensureDashboardAuthReady,
  hashPassword,
  parseCookies,
  registerDashboardAuthRoutes,
  requireDashboardAuth,
  registrarAuditoria,
  verifyPassword,
}
