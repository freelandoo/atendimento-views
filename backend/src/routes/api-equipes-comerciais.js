'use strict'
// Equipes Comerciais — gestao operacional por nicho.
// Autorizacao: MEMBROS_GERENCIAR. Equipe nao e papel; e organizacao de carteira.

const { Router } = require('express')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES: CAP } = require('../services/acesso-capacidades')
const DB = require('../db/equipes-comerciais')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function envelopeErro(res, err, code = 'EQUIPES_COMERCIAIS_FAILED') {
  const status = err?.statusCode || 500
  logger.error({ err: err?.message, code }, '[api-equipes-comerciais] falha')
  const message = status >= 500 ? 'Não foi possível concluir a operação.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code: err?.code || code, message } })
}

router.use(requireAuth, requireEmpresaAccess, requireCapacidade(CAP.MEMBROS_GERENCIAR))

router.get('/', async (req, res) => {
  try {
    return res.json({ ok: true, data: await DB.listarEquipes(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'EQUIPES_LIST_FAILED') }
})

router.get('/:equipeId', async (req, res) => {
  try {
    const equipe = await DB.equipeComMembros(req.empresa.id, req.params.equipeId)
    if (!equipe) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Equipe não encontrada.' } })
    return res.json({ ok: true, data: equipe })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_GET_FAILED') }
})

router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    const data = await DB.criarEquipe(req.empresa.id, {
      nome: b.nome,
      nicho_id: b.nicho_id,
      descricao: b.descricao,
      usuario_ids: b.usuario_ids,
    }, req.usuario.id)
    return res.status(201).json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_CREATE_FAILED') }
})

router.put('/:equipeId/participantes', async (req, res) => {
  try {
    const data = await DB.definirParticipantes(req.empresa.id, req.params.equipeId, {
      usuario_ids: req.body?.usuario_ids,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_PARTICIPANTES_FAILED') }
})

router.post('/:equipeId/encerrar', async (req, res) => {
  try {
    const data = await DB.encerrarEquipe(req.empresa.id, req.params.equipeId, {
      motivo: req.body?.motivo,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_ENCERRAR_FAILED') }
})

module.exports = router
