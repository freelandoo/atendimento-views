'use strict'
// Catalogo de nichos por empresa (modulo Prospeccao & Inteligencia Comercial). Acesso a
// banco ISOLADO por tenant: toda query filtra empresa_id. Compat com prospects.nicho
// (texto): o catalogo casa com os leads pelo NOME (lower).
const PG_UNIQUE_VIOLATION = '23505'

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function normalizarPatch(patch = {}, { criar = false } = {}) {
  const out = {}
  if (criar || patch.nome !== undefined) {
    const nome = String(patch.nome || '').trim()
    if (criar && !nome) throw erroEntrada('nome e obrigatorio.')
    if (patch.nome !== undefined && !nome) throw erroEntrada('nome nao pode ser vazio.')
    if (nome) out.nome = nome.slice(0, 120)
  }
  if (patch.descricao !== undefined) {
    out.descricao = patch.descricao == null || String(patch.descricao).trim() === '' ? null : String(patch.descricao).slice(0, 2000)
  }
  if (patch.criterios !== undefined) {
    if (patch.criterios != null && typeof patch.criterios !== 'object') throw erroEntrada('criterios deve ser um objeto.')
    out.criterios = patch.criterios || {}
  }
  if (patch.ativo !== undefined) {
    if (typeof patch.ativo !== 'boolean') throw erroEntrada('ativo deve ser booleano.')
    out.ativo = patch.ativo
  }
  return out
}

// Lista os nichos do catalogo + quantos leads (prospects) casam pelo nome.
async function listarNichos(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT n.id, n.nome, n.descricao, n.criterios_json, n.ativo, n.criado_em, n.atualizado_em,
            (SELECT COUNT(*)::int FROM prospectador.prospects p
              WHERE p.empresa_id = n.empresa_id AND lower(p.nicho) = lower(n.nome)) AS total_leads
       FROM app.nichos n
      WHERE n.empresa_id = $1
      ORDER BY n.ativo DESC, n.nome ASC`,
    [empresaId]
  )
  return rows
}

// Nichos DISTINTOS presentes nos leads (texto), com contagem e flag "ja no catalogo".
// Alimenta a migracao gradual: o operador ve os nichos usados e promove ao catalogo.
async function nichosDosLeads(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT p.nicho AS nome, COUNT(*)::int AS total_leads,
            EXISTS (SELECT 1 FROM app.nichos n
                     WHERE n.empresa_id = $1 AND lower(n.nome) = lower(p.nicho)) AS no_catalogo
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1 AND NULLIF(TRIM(p.nicho), '') IS NOT NULL
      GROUP BY p.nicho
      ORDER BY total_leads DESC
      LIMIT 200`,
    [empresaId]
  )
  return rows
}

async function criarNicho(pool, empresaId, patch = {}) {
  const v = normalizarPatch(patch, { criar: true })
  try {
    const { rows } = await pool.query(
      `INSERT INTO app.nichos (empresa_id, nome, descricao, criterios_json, criado_por)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, nome, descricao, criterios_json, ativo, criado_em`,
      [empresaId, v.nome, v.descricao ?? null, JSON.stringify(v.criterios ?? {}), patch.criadoPor || null]
    )
    return rows[0]
  } catch (e) {
    if (e.code === PG_UNIQUE_VIOLATION) throw erroEntrada('Ja existe um nicho com esse nome.', 409)
    throw e
  }
}

async function atualizarNicho(pool, empresaId, id, patch = {}) {
  const v = normalizarPatch(patch, { criar: false })
  const campos = []
  const params = [id, empresaId]
  if (v.nome !== undefined) { params.push(v.nome); campos.push(`nome = $${params.length}`) }
  if (v.descricao !== undefined) { params.push(v.descricao); campos.push(`descricao = $${params.length}`) }
  if (v.criterios !== undefined) { params.push(JSON.stringify(v.criterios)); campos.push(`criterios_json = $${params.length}::jsonb`) }
  if (v.ativo !== undefined) { params.push(v.ativo); campos.push(`ativo = $${params.length}`) }
  if (!campos.length) throw erroEntrada('Nada para atualizar.')
  try {
    const { rows } = await pool.query(
      `UPDATE app.nichos SET ${campos.join(', ')}, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, nome, descricao, criterios_json, ativo, atualizado_em`,
      params
    )
    if (!rows[0]) throw erroEntrada('Nicho nao encontrado.', 404)
    return rows[0]
  } catch (e) {
    if (e.code === PG_UNIQUE_VIOLATION) throw erroEntrada('Ja existe um nicho com esse nome.', 409)
    throw e
  }
}

module.exports = { normalizarPatch, listarNichos, nichosDosLeads, criarNicho, atualizarNicho }
