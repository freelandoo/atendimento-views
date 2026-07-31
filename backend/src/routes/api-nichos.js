'use strict'
// Nichos (catalogo por empresa) — API multi-tenant, admin-only (mount em index.js aplica
// requireAuth + requireRole('admin')). Cada rota reforca requireEmpresaAccess; o db filtra
// empresa_id. Regras de negocio ficam no db (src/db/nichos.js).
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const N = require('../db/nichos')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err, code = 'NICHO_FAILED', status = err?.statusCode || 500) {
  logger.error({ err: err?.message, code }, '[api-nichos] falha')
  const message = status >= 500 ? 'Nao foi possivel concluir a operacao de nicho.' : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

// GET / — catalogo de nichos (+ contagem de leads que casam pelo nome).
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await N.listarNichos(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'NICHOS_LIST_FAILED') }
})

// GET /dos-leads — nichos DISTINTOS presentes nos leads (texto), p/ migracao gradual.
router.get('/dos-leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await N.nichosDosLeads(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'NICHOS_LEADS_FAILED') }
})

// POST / — cria nicho. { nome, descricao?, criterios? }
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await N.criarNicho(pool, req.empresa.id, {
      nome: b.nome, descricao: b.descricao, criterios: b.criterios, criadoPor: req.usuario?.id,
    })
    return res.status(201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'NICHO_CREATE_FAILED') }
})

// PUT /:id — atualiza nicho (nome/descricao/criterios/ativo, parcial).
router.put('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'id e obrigatorio.' } })
    const b = req.body || {}
    const data = await N.atualizarNicho(pool, req.empresa.id, id, {
      nome: b.nome, descricao: b.descricao, criterios: b.criterios, ativo: b.ativo,
    })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'NICHO_UPDATE_FAILED') }
})

module.exports = router
