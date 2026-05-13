'use strict'
const { pool } = require('../db')

async function findEmpresaById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE id = $1 AND ativo = true',
    [id]
  )
  return rows[0] || null
}

async function findEmpresaBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE slug = $1 AND ativo = true',
    [slug]
  )
  return rows[0] || null
}

async function findEmpresaByEvolutionInstance(instanceName) {
  const { rows } = await pool.query(
    `SELECT e.*
     FROM app.empresas e
     JOIN app.empresa_whatsapp_instances ewi ON ewi.empresa_id = e.id
     WHERE ewi.evolution_instance = $1 AND ewi.ativo = true AND e.ativo = true`,
    [instanceName]
  )
  return rows[0] || null
}

async function usuarioPertenceAEmpresa(usuario_id, empresa_id) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app.usuarios_empresas
     WHERE usuario_id = $1 AND empresa_id = $2 AND ativo = true`,
    [usuario_id, empresa_id]
  )
  return rows.length > 0
}

module.exports = {
  findEmpresaById,
  findEmpresaBySlug,
  findEmpresaByEvolutionInstance,
  usuarioPertenceAEmpresa,
}
