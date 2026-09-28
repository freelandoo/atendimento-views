'use strict'

const { Router } = require('express')
const { pool } = require('../db')
const REUNIOES = require('../db/reuniao-salas')
const { logger } = require('../logger')

const router = Router()

function tratarErro(res, err, fallbackCode, contexto) {
  const status = err.statusCode || 500
  if (status >= 500) logger.error(`${contexto}:`, err.message)
  return res.status(status).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message },
  })
}

function eventoPublico(sala) {
  return {
    provider: sala.provider,
    provider_domain: sala.provider_domain,
    room_name: sala.room_name,
    status_presenca: sala.status_presenca,
    data_inicio: sala.evento?.data_inicio || null,
    data_fim: sala.evento?.data_fim || null,
    titulo: sala.evento?.titulo || 'Reunião',
    lead_nome: sala.evento?.lead_nome || null,
    aguardo_lead_minutos: REUNIOES.AGUARDO_LEAD_MIN,
  }
}

router.get('/:token', async (req, res) => {
  try {
    const sala = await REUNIOES.obterSalaPorToken(pool, req.params.token)
    if (!sala) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Reunião não encontrada.' } })
    return res.json({ ok: true, data: eventoPublico(sala) })
  } catch (err) {
    return tratarErro(res, err, 'REUNIAO_PUBLICA_GET_FAILED', 'GET reunioes/:token')
  }
})

router.post('/:token/presenca', async (req, res) => {
  try {
    const corpo = req.body || {}
    const sala = await REUNIOES.registrarPresenca(pool, {
      token: req.params.token,
      papel: 'lead',
      evento: corpo.evento || 'entrou',
      participanteId: corpo.participante_id || corpo.participanteId || null,
      displayName: corpo.display_name || corpo.displayName || null,
    })
    return res.json({ ok: true, data: eventoPublico(sala) })
  } catch (err) {
    return tratarErro(res, err, 'REUNIAO_PUBLICA_PRESENCA_FAILED', 'POST reunioes/:token/presenca')
  }
})

module.exports = router
