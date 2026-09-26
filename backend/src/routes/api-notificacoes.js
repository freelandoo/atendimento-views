'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const {
  listarNotificacoes,
  definirEstadoNotificacao,
  restaurarNotificacao,
} = require('../services/notificacoes-centro')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err) {
  logger.error({ err: err?.message }, '[api-notificacoes] falha')
  const status = err?.statusCode || 500
  return res.status(status).json({
    ok: false,
    error: {
      code: 'NOTIFICACOES_FAILED',
      message: status >= 500 ? 'Nao foi possivel carregar as notificacoes.' : err.message,
    },
  })
}

// GET /api/empresas/:empresaId/notificacoes?estado=ativas|arquivadas
//
// Central de notificacoes CALCULADA: le as fontes oficiais (follow-ups, agenda, ligacoes e
// instancias) e aplica o estado pessoal de arquivamento/apagamento da central.
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await listarNotificacoes(pool, req, { estado: req.query.estado })
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err)
  }
})

// POST /api/empresas/:empresaId/notificacoes/:id/arquivar
router.post('/:id/arquivar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await definirEstadoNotificacao(pool, req, req.params.id, 'arquivada')
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err)
  }
})

// POST /api/empresas/:empresaId/notificacoes/:id/restaurar
router.post('/:id/restaurar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await restaurarNotificacao(pool, req, req.params.id)
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err)
  }
})

// DELETE /api/empresas/:empresaId/notificacoes/:id
//
// Apaga da central de notificacoes do usuario. Nao apaga follow-up, reuniao, lead, ligacao
// ou instancia: e apenas a decisao de ocultar aquele agrupamento da central.
router.delete('/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await definirEstadoNotificacao(pool, req, req.params.id, 'apagada')
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err)
  }
})

module.exports = router
