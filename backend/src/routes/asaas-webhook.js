'use strict'
// Webhook INBOUND da ASAAS. Publico (sem auth JWT) — a origem e' provada pelo header
// `asaas-access-token` (= ASAAS_WEBHOOK_TOKEN). Montado DEPOIS do express.json (nao usa HMAC, so'
// header), ao contrario do Freelandoo. Responde 2xx rapido; idempotente; sem PII no log.
const express = require('express')
const router = express.Router()
const { logger } = require('../logger')
const { statusDoEvento, validarToken, chaveEvento, referenciasAsaas } = require('../services/asaas-eventos')
const { processarEventoAsaas } = require('../db/empresa-plano')

router.post('/', async (req, res) => {
  if (!validarToken(req.headers['asaas-access-token'], process.env.ASAAS_WEBHOOK_TOKEN || '')) {
    // 401: a ASAAS so' manda com o token certo. Chamada sem/errado nao e' legitima.
    return res.status(401).json({ ok: false, error: { code: 'TOKEN_INVALIDO' } })
  }

  const body = req.body || {}
  const evento = body.event
  const status = statusDoEvento(evento)
  // Evento que nao muda o plano (created, updated, etc.) → ack sem processar.
  if (!status) return res.status(200).json({ ok: true, ignorado: true })

  const chave = chaveEvento(body)
  if (!chave) {
    logger.warn({ evento }, '[asaas] evento sem id para idempotencia; ack sem processar')
    return res.status(200).json({ ok: true, ignorado: true })
  }

  try {
    const { subscriptionId, customerId } = referenciasAsaas(body)
    const { novo, empresaId } = await processarEventoAsaas({ chave, tipo: evento, status, subscriptionId, customerId })
    // Sem PII: so' tipo do evento e booleanos.
    logger.info({ evento, status, novo, casou: Boolean(empresaId) }, '[asaas] webhook processado')
    return res.status(200).json({ ok: true })
  } catch (err) {
    // 500 → a ASAAS reenvia (at least once). A transacao e' atomica: nada foi gravado.
    logger.error({ evento, err: err.message }, '[asaas] falha ao processar webhook')
    return res.status(500).json({ ok: false })
  }
})

module.exports = router
