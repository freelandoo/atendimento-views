'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')
const {
  normalizarContexto1,
  gerarContexto2Playbook,
  ativarContexto2,
  buscarContexto2Ativo,
  registrarSugestaoAprendizadoContexto,
  validarContexto2Playbook,
  invalidarCacheEmpresa,
  aplicarSugestaoComoDraft,
} = require('../services/contexto-empresa')
const {
  processarMensagemComPlaybook,
} = require('../services/contexto2-runtime')

// Compat com call legado (Contexto 2 simples)
const { generateContextPlan } = require('../ai-provider')

const router = Router({ mergeParams: true })

// ─── Contexto 1 ──────────────────────────────────────────────────────────────
// GET /api/empresas/:empresaId/contextos
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresa_contextos WHERE empresa_id = $1 ORDER BY criado_em DESC',
    [req.empresa.id]
  )
  return res.json({ ok: true, data: rows })
})

// POST /api/empresas/:empresaId/contextos — aceita {nome, conteudo} OU {nome, contexto_form_json}
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome = 'Contexto Principal', conteudo, contexto_form_json } = req.body || {}
  let formJson = null
  let conteudoTexto = ''
  if (contexto_form_json && typeof contexto_form_json === 'object') {
    const n = normalizarContexto1(contexto_form_json)
    formJson = n.contexto_form_json
    conteudoTexto = n.contexto_bruto
  } else if (typeof conteudo === 'string') {
    conteudoTexto = conteudo
  }
  const { rows: [ctx] } = await pool.query(
    `INSERT INTO app.empresa_contextos (empresa_id, nome, conteudo, contexto_form_json)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.empresa.id, nome, conteudoTexto, JSON.stringify(formJson || {})]
  )
  return res.status(201).json({ ok: true, data: ctx })
})

// DELETE /api/empresas/:empresaId/contextos/:contextoId — remove Contexto 1 + todas as versões (CASCADE)
router.delete('/:contextoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
    [req.params.contextoId, req.empresa.id]
  )
  if (rowCount === 0) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
  }
  invalidarCacheEmpresa(req.empresa.id)
  return res.json({ ok: true, data: { id: req.params.contextoId, deleted: true } })
})

// PUT /api/empresas/:empresaId/contextos/:contextoId — edita Contexto 1
router.put('/:contextoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { nome, conteudo, contexto_form_json } = req.body || {}
  const sets = []
  const vals = []
  if (nome !== undefined) sets.push(`nome = $${vals.push(nome)}`)
  if (contexto_form_json !== undefined) {
    const n = normalizarContexto1(contexto_form_json)
    sets.push(`contexto_form_json = $${vals.push(JSON.stringify(n.contexto_form_json))}`)
    sets.push(`conteudo = $${vals.push(n.contexto_bruto)}`)
  } else if (conteudo !== undefined) {
    sets.push(`conteudo = $${vals.push(conteudo)}`)
  }
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

// ─── Contexto 2 (versões/playbook) ───────────────────────────────────────────
// GET /api/empresas/:empresaId/contextos/:contextoId/versoes
router.get('/:contextoId/versoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM app.empresa_contexto_versoes
     WHERE empresa_id = $1 AND contexto_id = $2 ORDER BY versao DESC`,
    [req.empresa.id, req.params.contextoId]
  )
  return res.json({ ok: true, data: rows })
})

// GET /api/empresas/:empresaId/contextos/versoes/:versaoId
router.get('/versoes/:versaoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [v] } = await pool.query(
    `SELECT * FROM app.empresa_contexto_versoes WHERE id = $1 AND empresa_id = $2`,
    [req.params.versaoId, req.empresa.id]
  )
  if (!v) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Versão não encontrada.' } })
  return res.json({ ok: true, data: v })
})

// PUT /api/empresas/:empresaId/contextos/versoes/:versaoId — edita markdown e/ou json
router.put('/versoes/:versaoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { conteudo_markdown, conteudo_json } = req.body || {}
  const sets = []
  const vals = []
  if (conteudo_markdown !== undefined) sets.push(`conteudo_markdown = $${vals.push(String(conteudo_markdown))}`)
  if (conteudo_json !== undefined) {
    const validado = validarContexto2Playbook(conteudo_json)
    sets.push(`conteudo_json = $${vals.push(JSON.stringify(validado))}`)
  }
  if (!sets.length) return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Nada para atualizar.' } })
  vals.push(req.params.versaoId, req.empresa.id)
  const { rows: [v] } = await pool.query(
    `UPDATE app.empresa_contexto_versoes SET ${sets.join(', ')}
     WHERE id = $${vals.length - 1} AND empresa_id = $${vals.length} RETURNING *`,
    vals
  )
  if (!v) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Versão não encontrada.' } })
  invalidarCacheEmpresa(req.empresa.id)
  return res.json({ ok: true, data: v })
})

// POST /api/empresas/:empresaId/contextos/:contextoId/gerar-playbook (novo)
router.post('/:contextoId/gerar-playbook', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const r = await gerarContexto2Playbook({
      pool, log: logger,
      empresaId: req.empresa.id,
      contextoId: req.params.contextoId,
      userId: req.user?.id,
    })
    return res.status(201).json({ ok: true, data: r })
  } catch (err) {
    logger.error({ err: err.message }, 'gerar-playbook falhou')
    return res.status(502).json({ ok: false, error: { code: 'AI_ERROR', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/contextos/:contextoId/gerar-plano (legado — mantém)
router.post('/:contextoId/gerar-plano', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [ctx] } = await pool.query(
    'SELECT * FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
    [req.params.contextoId, req.empresa.id]
  )
  if (!ctx) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
  if (!ctx.conteudo || ctx.conteudo.trim().length < 20) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Contexto 1 muito curto.' } })
  }
  let planoJson
  try {
    const result = await generateContextPlan({
      contexto1: ctx.conteudo, pool, log: logger,
      empresaId: req.empresa.id, refId: ctx.id,
    })
    planoJson = result.json || result.text
  } catch (err) {
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

// POST /api/empresas/:empresaId/contextos/:contextoId/versoes/:versaoId/ativar (legado)
// POST /api/empresas/:empresaId/contextos/versoes/:versaoId/ativar (novo)
async function ativarHandler(req, res) {
  try {
    const ativada = await ativarContexto2({
      pool, empresaId: req.empresa.id, versaoId: req.params.versaoId, userId: req.user?.id,
    })
    return res.json({ ok: true, data: ativada })
  } catch (err) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: err.message } })
  }
}
router.post('/:contextoId/versoes/:versaoId/ativar', requireAuth, requireEmpresaAccess, ativarHandler)
router.post('/versoes/:versaoId/ativar', requireAuth, requireEmpresaAccess, ativarHandler)

// POST /api/empresas/:empresaId/contextos/versoes/:versaoId/testar
router.post('/versoes/:versaoId/testar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { mensagem, historico = [] } = req.body || {}
  if (!mensagem || typeof mensagem !== 'string') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'mensagem obrigatória.' } })
  }
  const { rows: [v] } = await pool.query(
    `SELECT id, conteudo_json, conteudo_markdown FROM app.empresa_contexto_versoes
     WHERE id = $1 AND empresa_id = $2`,
    [req.params.versaoId, req.empresa.id]
  )
  if (!v) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Versão não encontrada.' } })

  // Carrega o playbook em formato esperado pelo runtime
  const playbook = { versao_id: v.id, json: v.conteudo_json, markdown: v.conteudo_markdown }
  const { extrairDadosDaMensagem, decidirRespostaComPlaybook } = require('../services/contexto2-runtime')

  try {
    const extracao = await extrairDadosDaMensagem({
      pool, log: logger, playbook,
      historico, mensagem, leadInsights: {},
      empresaId: req.empresa.id,
      conversaId: 'simulacao', leadPhone: '+5500000000000',
    })
    const decisao = await decidirRespostaComPlaybook({
      pool, log: logger, playbook,
      historico, mensagem, leadInsights: {}, extracao,
      empresaId: req.empresa.id,
      conversaId: 'simulacao', leadPhone: '+5500000000000',
    })
    return res.json({ ok: true, data: { extracao, decisao } })
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: 'AI_ERROR', message: err.message } })
  }
})

// ─── Sugestões de aprendizado ─────────────────────────────────────────────────
// GET /api/empresas/:empresaId/contextos/sugestoes
router.get('/sugestoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  const status = String(req.query.status || 'pendente')
  const { rows } = await pool.query(
    `SELECT * FROM app.empresa_contexto_sugestoes
     WHERE empresa_id = $1 AND status = $2
     ORDER BY created_at DESC LIMIT 200`,
    [req.empresa.id, status]
  )
  return res.json({ ok: true, data: rows })
})

// POST /api/empresas/:empresaId/contextos/sugestoes/:sugestaoId/aprovar
router.post('/sugestoes/:sugestaoId/aprovar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [s] } = await pool.query(
    `UPDATE app.empresa_contexto_sugestoes
       SET status = 'aprovada', reviewed_at = NOW(), reviewed_by = $3
     WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [req.params.sugestaoId, req.empresa.id, req.user?.id || null]
  )
  if (!s) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Sugestão não encontrada.' } })
  return res.json({ ok: true, data: s })
})

// POST /api/empresas/:empresaId/contextos/sugestoes/:sugestaoId/aplicar
// Gera novo DRAFT a partir do playbook ativo + sugestão. NÃO ativa.
router.post('/sugestoes/:sugestaoId/aplicar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const r = await aplicarSugestaoComoDraft({
      pool, log: logger,
      empresaId: req.empresa.id,
      sugestaoId: req.params.sugestaoId,
      userId: req.user?.id,
    })
    return res.status(201).json({ ok: true, data: r })
  } catch (err) {
    return res.status(400).json({ ok: false, error: { code: 'APPLY_FAILED', message: err.message } })
  }
})

// POST /api/empresas/:empresaId/contextos/sugestoes/:sugestaoId/rejeitar
router.post('/sugestoes/:sugestaoId/rejeitar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rows: [s] } = await pool.query(
    `UPDATE app.empresa_contexto_sugestoes
       SET status = 'rejeitada', reviewed_at = NOW(), reviewed_by = $3
     WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [req.params.sugestaoId, req.empresa.id, req.user?.id || null]
  )
  if (!s) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Sugestão não encontrada.' } })
  return res.json({ ok: true, data: s })
})

// GET /api/empresas/:empresaId/contextos/ativo — atalho útil
router.get('/ativo', requireAuth, requireEmpresaAccess, async (req, res) => {
  const ativo = await buscarContexto2Ativo(pool, req.empresa.id)
  return res.json({ ok: true, data: ativo })
})

// Compat com fluxo antigo de versões POST (criar versão manualmente)
router.post('/:contextoId/versoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { conteudo_json = {}, conteudo_markdown = '', gerado_por = 'usuario' } = req.body || {}
  const validado = validarContexto2Playbook(conteudo_json)
  const { rows: [last] } = await pool.query(
    `SELECT COALESCE(MAX(versao), 0) AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1`,
    [req.params.contextoId]
  )
  const versao = last.max_versao + 1
  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes
      (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown, gerado_por, status, playbook_schema_version)
     VALUES ($1, $2, $3, $4, $5, $6, 'rascunho', 'contexto2.playbook.v1')
     RETURNING *`,
    [req.params.contextoId, req.empresa.id, versao, JSON.stringify(validado), conteudo_markdown, gerado_por]
  )
  return res.status(201).json({ ok: true, data: v })
})

module.exports = router
