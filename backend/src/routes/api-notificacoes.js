'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { listarNotificacoes } = require('../services/notificacoes-centro')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err) {
  logger.error({ err: err?.message }, '[api-notificacoes] falha')
  return res.status(500).json({
    ok: false,
    error: { code: 'NOTIFICACOES_FAILED', message: 'Nao foi possivel carregar as notificacoes.' },
  })
}

// GET /api/empresas/:empresaId/notificacoes
//
// Central de notificacoes CALCULADA: le as fontes oficiais (follow-ups, agenda, ligacoes e
// instancias) e devolve lembretes atuais. Nesta fase nao persiste "lido"; resolver o item na
// origem faz a notificacao sumir naturalmente.
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await listarNotificacoes(pool, req)
    return res.json({ ok: true, data })
  } catch (err) {
    return erro(res, err)
  }
})

module.exports = router
