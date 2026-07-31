'use strict'
// Campanhas comerciais — API multi-tenant, admin-only (mount em index.js aplica
// requireAuth + requireRole('admin')). Cada rota reforca requireEmpresaAccess; o db
// (src/db/campanhas.js) filtra empresa_id e valida FKs same-tenant.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const C = require('../db/campanhas')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err, code = 'CAMPANHA_FAILED', status = err?.statusCode || 500) {
  logger.error({ err: err?.message, code }, '[api-campanhas] falha')
  const message = status >= 500 ? 'Nao foi possivel concluir a operacao de campanha.' : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}
function reqId(res, v, nome) {
  const s = String(v || '').trim()
  if (!s) { res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: `${nome} e obrigatorio.` } }); return null }
  return s
}

// --- CAMPANHAS --------------------------------------------------------------------
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try { return res.json({ ok: true, data: await C.listarCampanhas(pool, req.empresa.id) }) }
  catch (err) { return erro(res, err, 'CAMPANHAS_LIST_FAILED') }
})

router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await C.criarCampanha(pool, req.empresa.id, {
      nome: b.nome, objetivo: b.objetivo, hipotese: b.hipotese, nicho_id: b.nicho_id,
      roteiro_versao_id: b.roteiro_versao_id, data_inicio: b.data_inicio, data_fim: b.data_fim,
      status: b.status, meta_ligacoes: b.meta_ligacoes, meta_reunioes: b.meta_reunioes, criadoPor: req.usuario?.id,
    })
    return res.status(201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'CAMPANHA_CREATE_FAILED') }
})

router.get('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    const data = await C.obterCampanha(pool, req.empresa.id, id)
    if (!data) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Campanha nao encontrada.' } })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'CAMPANHA_GET_FAILED') }
})

router.put('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.atualizarCampanha(pool, req.empresa.id, id, req.body || {}) })
  } catch (err) { return erro(res, err, 'CAMPANHA_UPDATE_FAILED') }
})

router.put('/:id/responsaveis', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.definirResponsaveis(pool, req.empresa.id, id, req.body?.usuario_ids) })
  } catch (err) { return erro(res, err, 'RESPONSAVEIS_FAILED') }
})

// --- LEADS DA CAMPANHA ------------------------------------------------------------
router.post('/:id/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.adicionarLeads(pool, req.empresa.id, id, req.body?.prospect_ids) })
  } catch (err) { return erro(res, err, 'CAMPANHA_LEADS_ADD_FAILED') }
})

router.get('/:id/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.listarLeadsDaCampanha(pool, req.empresa.id, id, { status: req.query.status }) })
  } catch (err) { return erro(res, err, 'CAMPANHA_LEADS_LIST_FAILED') }
})

// GET /:id/fila — fila de trabalho da Central de Ligacoes (leads nao finalizados, priorizados).
router.get('/:id/fila', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.filaDeTrabalho(pool, req.empresa.id, id, { limit: req.query.limit }) })
  } catch (err) { return erro(res, err, 'CAMPANHA_FILA_FAILED') }
})

// GET /:id/funil — onde as ligacoes estao parando (etapa alcancada / perda de interesse).
router.get('/:id/funil', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.id, 'id'); if (!id) return
    return res.json({ ok: true, data: await C.funilEtapas(pool, req.empresa.id, id) })
  } catch (err) { return erro(res, err, 'CAMPANHA_FUNIL_FAILED') }
})

router.put('/leads/:campanhaLeadId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.campanhaLeadId, 'campanhaLeadId'); if (!id) return
    return res.json({ ok: true, data: await C.atualizarLead(pool, req.empresa.id, id, req.body || {}) })
  } catch (err) { return erro(res, err, 'CAMPANHA_LEAD_UPDATE_FAILED') }
})

router.delete('/leads/:campanhaLeadId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = reqId(res, req.params.campanhaLeadId, 'campanhaLeadId'); if (!id) return
    return res.json({ ok: true, data: await C.removerLead(pool, req.empresa.id, id) })
  } catch (err) { return erro(res, err, 'CAMPANHA_LEAD_DELETE_FAILED') }
})

module.exports = router
