'use strict'
const { pool } = require('../db')
const { gerarSlugEmpresa } = require('../string-utils')

async function findUsuarioByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM app.usuarios WHERE email = $1 AND ativo = true',
    [email]
  )
  return rows[0] || null
}

async function findUsuarioById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, nome, role, ativo, ultimo_login_em, criado_em FROM app.usuarios WHERE id = $1',
    [id]
  )
  return rows[0] || null
}

async function updateUltimoLogin(id) {
  await pool.query(
    'UPDATE app.usuarios SET ultimo_login_em = NOW() WHERE id = $1',
    [id]
  )
}

async function listEmpresasDoUsuario(usuario_id) {
  const { rows } = await pool.query(
    `SELECT e.*, ue.role AS role_usuario
     FROM app.empresas e
     JOIN app.usuarios_empresas ue ON ue.empresa_id = e.id
     WHERE ue.usuario_id = $1 AND ue.ativo = true AND e.ativo = true
     ORDER BY e.nome`,
    [usuario_id]
  )
  return rows
}

async function existsEmail(email) {
  const { rows } = await pool.query('SELECT 1 FROM app.usuarios WHERE email = $1', [email])
  return rows.length > 0
}

// Cria usuário (role 'user') + empresa própria + vínculo owner, numa transação.
// Retorna { usuario, empresa }.
async function signupUsuario({ email, nome, password_hash }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [usuario] } = await client.query(
      `INSERT INTO app.usuarios (email, nome, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, nome, role`,
      [email, nome, password_hash]
    )
    let empresa = null
    for (let i = 0; i < 5 && !empresa; i++) {
      const slug = gerarSlugEmpresa(nome)
      try {
        const { rows: [e] } = await client.query(
          `INSERT INTO app.empresas (nome, slug, criada_por)
           VALUES ($1, $2, $3) RETURNING *`,
          [nome, slug, usuario.id]
        )
        empresa = e
      } catch (err) {
        if (err.code !== '23505') throw err // unique_violation no slug → tenta de novo
      }
    }
    if (!empresa) throw new Error('Não foi possível gerar slug único de empresa.')

    await client.query(
      `INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role)
       VALUES ($1, $2, 'owner')`,
      [usuario.id, empresa.id]
    )
    await client.query('COMMIT')
    return { usuario, empresa }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listUsuarios() {
  const { rows } = await pool.query(
    `SELECT id, email, nome, role, ativo, plano, assinatura_status, onboarding_completo,
            ultimo_login_em, criado_em
     FROM app.usuarios ORDER BY criado_em DESC`
  )
  return rows
}

// Criação por superadmin: role pode ser 'user' ou 'admin'.
async function createUsuarioPorAdmin({ email, nome, password_hash, role }) {
  const roleFinal = role === 'admin' ? 'admin' : 'user'
  const { rows: [u] } = await pool.query(
    `INSERT INTO app.usuarios (email, nome, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, nome, role, ativo`,
    [email, nome, password_hash, roleFinal]
  )
  return u
}

async function updateUsuarioRole(id, role) {
  if (!['user', 'admin', 'superadmin'].includes(role)) throw new Error('Role inválido.')
  const { rows: [u] } = await pool.query(
    `UPDATE app.usuarios SET role = $2, atualizado_em = NOW()
     WHERE id = $1 RETURNING id, email, nome, role, ativo`,
    [id, role]
  )
  return u || null
}

async function setUsuarioAtivo(id, ativo) {
  const { rows: [u] } = await pool.query(
    `UPDATE app.usuarios SET ativo = $2, atualizado_em = NOW()
     WHERE id = $1 RETURNING id, email, nome, role, ativo`,
    [id, !!ativo]
  )
  return u || null
}

// Marca onboarding como completo se a empresa já tem >=1 instância ativa e >=1 contexto.
async function marcarOnboardingCompleto(usuario_id, empresa_id) {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM app.empresa_whatsapp_instances WHERE empresa_id = $1 AND ativo = true) AS inst,
       (SELECT COUNT(*) FROM app.empresa_contextos WHERE empresa_id = $1 AND ativo = true) AS ctx`,
    [empresa_id]
  )
  if (Number(r.inst) > 0 && Number(r.ctx) > 0) {
    await pool.query('UPDATE app.usuarios SET onboarding_completo = true WHERE id = $1', [usuario_id])
    return true
  }
  return false
}

module.exports = {
  findUsuarioByEmail,
  findUsuarioById,
  updateUltimoLogin,
  listEmpresasDoUsuario,
  existsEmail,
  signupUsuario,
  listUsuarios,
  createUsuarioPorAdmin,
  updateUsuarioRole,
  setUsuarioAtivo,
  marcarOnboardingCompleto,
}
