'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { listEmpresasDoUsuario } = require('../db/usuarios')
const { invalidarCachePauseEmpresa, invalidarCacheAgendaEmpresa } = require('../db/empresas')

const router = Router()

function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// GET /api/empresas — empresas do usuário autenticado
router.get('/', requireAuth, async (req, res) => {
  const empresas = await listEmpresasDoUsuario(req.usuario.id).catch(() => [])
  return res.json({ ok: true, data: empresas })
})

// POST /api/empresas — cria nova empresa e vincula ao usuário autenticado como owner
router.post('/', requireAuth, async (req, res) => {
  const { nome, slug, plano = 'free' } = req.body || {}
  if (!nome || String(nome).trim().length < 2) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nome obrigatório (mínimo 2 caracteres).' } })
  }
  const slugFinal = slug ? slugify(slug) : slugify(nome)
  if (!slugFinal) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Slug inválido.' } })
  }
  try {
    const { rows: [empresa] } = await pool.query(
      `INSERT INTO app.empresas (nome, slug, plano, ativo)
       VALUES ($1, $2, $3, true) RETURNING *`,
      [String(nome).trim(), slugFinal, ['free', 'starter', 'pro', 'enterprise'].includes(plano) ? plano : 'free']
    )
    // Vincula usuário como owner
    await pool.query(
      `INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role, ativo)
       VALUES ($1, $2, 'owner', true)
       ON CONFLICT DO NOTHING`,
      [req.usuario.id, empresa.id]
    )
    // Cria Contexto 1 vazio inicial pra empresa
    await pool.query(
      `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
       VALUES ($1, 'Contexto Principal', '', '{}'::jsonb)`,
      [empresa.id]
    )
    return res.status(201).json({ ok: true, data: empresa })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Já existe empresa com esse slug.' } })
    }
    throw err
  }
})

// GET /api/empresas/:empresaId
router.get('/:empresaId', requireAuth, requireEmpresaAccess, (req, res) => {
  return res.json({ ok: true, data: req.empresa })
})

// GET /api/empresas/:empresaId/agente — retorna estado global do agente
router.get('/:empresaId/agente', requireAuth, requireEmpresaAccess, async (req, res) => {
  const pausado = !!(req.empresa?.config?.agente_pausado)
  // Default LIGADO: só desliga quando explicitamente gravado como false.
  const usa_agenda = req.empresa?.config?.usa_agenda !== false
  return res.json({ ok: true, data: { pausado, usa_agenda } })
})

// PATCH /api/empresas/:empresaId/agenda { usa_agenda: true/false }
// Decide se o agente DESTA empresa tenta agendar reunião (impacta geração de
// contexto e runtime). Default ligado; gravar false desativa toda a agenda.
router.patch('/:empresaId/agenda', requireAuth, requireEmpresaAccess, async (req, res) => {
  const usa_agenda = req.body?.usa_agenda !== false
  const { rows: [empresa] } = await pool.query(
    `UPDATE app.empresas
        SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('usa_agenda', $2::boolean),
            atualizado_em = NOW()
      WHERE id = $1
      RETURNING id, nome, config`,
    [req.empresa.id, usa_agenda]
  )
  invalidarCacheAgendaEmpresa(req.empresa.id)
  return res.json({ ok: true, data: { usa_agenda: empresa.config?.usa_agenda !== false } })
})

// PATCH /api/empresas/:empresaId/agente { pausado: true/false }
router.patch('/:empresaId/agente', requireAuth, requireEmpresaAccess, async (req, res) => {
  const pausado = !!(req.body?.pausado)
  const { rows: [empresa] } = await pool.query(
    `UPDATE app.empresas
        SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('agente_pausado', $2::boolean),
            atualizado_em = NOW()
      WHERE id = $1
      RETURNING id, nome, config`,
    [req.empresa.id, pausado]
  )
  invalidarCachePauseEmpresa(req.empresa.id)
  return res.json({ ok: true, data: { pausado: !!(empresa.config?.agente_pausado) } })
})

// PUT /api/empresas/:empresaId
router.put('/:empresaId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome, config } = req.body || {}
  const sets = []
  const vals = []
  if (nome) { sets.push(`nome = $${vals.push(nome)}`); }
  if (config) { sets.push(`config = $${vals.push(JSON.stringify(config))}`); }
  if (sets.length === 0) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nenhum campo para atualizar.' } })
  }
  sets.push(`atualizado_em = NOW()`)
  vals.push(req.empresa.id)
  const { rows: [empresa] } = await pool.query(
    `UPDATE app.empresas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals
  )
  if (config) { invalidarCachePauseEmpresa(req.empresa.id); invalidarCacheAgendaEmpresa(req.empresa.id) }
  return res.json({ ok: true, data: empresa })
})

module.exports = router
