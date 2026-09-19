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

// ⚠️ DECLARADA ANTES de `/:equipeId`, senao "elegiveis" viraria um id de equipe — o mesmo cuidado
// de `GET /agenda/responsaveis`.
//
// Somente leitura: nao cria equipe, nao move ninguem e nao chama IA. Serve o seletor de membros,
// que precisa avisar "esta pessoa ja' esta no Time Solar" ANTES de submeter. Sem isso o gestor so'
// descobre no 409, cuja mensagem fala de "uma das pessoas" sem dizer qual.
router.get('/elegiveis', async (req, res) => {
  try {
    return res.json({ ok: true, data: await DB.membrosElegiveis(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'EQUIPES_ELEGIVEIS_FAILED') }
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

// PATCH /:equipeId — renomear a equipe. SO' nome e descricao.
//
// ⚠️ `nicho_id` e' RECUSADO explicitamente, nao ignorado em silencio: e' o nicho que recorta o
// Banco de Leads dos membros, entao trocá-lo aqui moveria a carteira de varias pessoas de uma
// vez. Recusar diz ao chamador o que aconteceu; ignorar faria a tela achar que salvou.
// Trocar de nicho e' encerrar a equipe e criar outra — o caminho que deixa rastro.
router.patch('/:equipeId', async (req, res) => {
  try {
    const b = req.body || {}
    if (b.nicho_id !== undefined) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'NICHO_NAO_EDITAVEL',
          message: 'O nicho de uma equipe não pode ser trocado: ele recorta a carteira de todos os membros. Encerre esta equipe e crie outra.',
        },
      })
    }
    const data = await DB.atualizarEquipe(req.empresa.id, req.params.equipeId, {
      nome: b.nome,
      descricao: b.descricao,
    }, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EQUIPE_UPDATE_FAILED') }
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
