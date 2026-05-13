'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { generateContextPlan } = require('../ai-provider')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// GET /api/empresas/:empresaId/contextos
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresa_contextos WHERE empresa_id = $1 ORDER BY criado_em DESC',
    [req.empresa.id]
  )
  return res.json({ ok: true, data: rows })
})

// POST /api/empresas/:empresaId/contextos
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome = 'Contexto Principal', conteudo = '' } = req.body || {}
  const { rows: [ctx] } = await pool.query(
    `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.empresa.id, nome, conteudo]
  )
  return res.status(201).json({ ok: true, data: ctx })
})

// PUT /api/empresas/:empresaId/contextos/:contextoId
router.put('/:contextoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome, conteudo } = req.body || {}
  const sets = []
  const vals = []
  if (nome !== undefined) sets.push(`nome = $${vals.push(nome)}`)
  if (conteudo !== undefined) sets.push(`conteudo = $${vals.push(conteudo)}`)
  if (sets.length === 0) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nenhum campo para atualizar.' } })
  }
  sets.push(`atualizado_em = NOW()`)
  vals.push(req.empresa.id, req.params.contextoId)
  const { rows: [ctx] } = await pool.query(
    `UPDATE app.empresa_contextos SET ${sets.join(', ')}
     WHERE empresa_id = $${vals.length - 1} AND id = $${vals.length} RETURNING *`,
    vals
  )
  if (!ctx) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
  return res.json({ ok: true, data: ctx })
})

// GET /api/empresas/:empresaId/contextos/:contextoId/versoes
router.get('/:contextoId/versoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM app.empresa_contexto_versoes
     WHERE empresa_id = $1 AND contexto_id = $2 ORDER BY versao DESC`,
    [req.empresa.id, req.params.contextoId]
  )
  return res.json({ ok: true, data: rows })
})

// POST /api/empresas/:empresaId/contextos/:contextoId/versoes
router.post('/:contextoId/versoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { conteudo_json = {}, gerado_por = 'usuario' } = req.body || {}
  const { rows: [last] } = await pool.query(
    `SELECT COALESCE(MAX(versao), 0) AS max_versao FROM app.empresa_contexto_versoes
     WHERE contexto_id = $1`,
    [req.params.contextoId]
  )
  const versao = last.max_versao + 1
  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes (contexto_id, empresa_id, versao, conteudo_json, gerado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.contextoId, req.empresa.id, versao, JSON.stringify(conteudo_json), gerado_por]
  )
  return res.status(201).json({ ok: true, data: v })
})

// POST /api/empresas/:empresaId/contextos/:contextoId/gerar-plano
// Lê o conteudo do contexto, chama IA, salva versão rascunho e retorna
router.post('/:contextoId/gerar-plano', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [ctx] } = await pool.query(
    'SELECT * FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
    [req.params.contextoId, req.empresa.id]
  )
  if (!ctx) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
  }
  if (!ctx.conteudo || ctx.conteudo.trim().length < 20) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Contexto 1 muito curto para gerar plano.' } })
  }

  let planoJson
  try {
    const result = await generateContextPlan({ contexto1: ctx.conteudo, pool, log: logger })
    planoJson = result.json || result.text
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao gerar plano de contexto')
    return res.status(502).json({ ok: false, error: { code: 'AI_ERROR', message: 'Falha ao chamar IA: ' + err.message } })
  }

  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(versao), 0) AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1',
    [ctx.id]
  )
  const versao = last.max_versao + 1
  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes (contexto_id, empresa_id, versao, conteudo_json, gerado_por, status)
     VALUES ($1, $2, $3, $4, 'ia', 'rascunho') RETURNING *`,
    [ctx.id, req.empresa.id, versao, JSON.stringify(planoJson)]
  )
  return res.status(201).json({ ok: true, data: v })
})

// POST /api/empresas/:empresaId/contextos/:contextoId/versoes/:versaoId/ativar
router.post('/:contextoId/versoes/:versaoId/ativar', requireAuth, requireEmpresaAccess, async (req, res) => {
  await pool.query(
    `UPDATE app.empresa_contexto_versoes SET status = 'arquivado'
     WHERE contexto_id = $1 AND status = 'ativo'`,
    [req.params.contextoId]
  )
  const { rows: [v] } = await pool.query(
    `UPDATE app.empresa_contexto_versoes SET status = 'ativo', ativado_em = NOW()
     WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [req.params.versaoId, req.empresa.id]
  )
  if (!v) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Versão não encontrada.' } })
  return res.json({ ok: true, data: v })
})

module.exports = router
