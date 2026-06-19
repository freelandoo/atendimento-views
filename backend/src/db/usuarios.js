'use strict'
const { pool } = require('../db')

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

module.exports = { findUsuarioByEmail, findUsuarioById, updateUltimoLogin, listEmpresasDoUsuario }
