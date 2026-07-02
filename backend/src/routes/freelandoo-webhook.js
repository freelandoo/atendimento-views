'use strict'

// Webhook público da Freelandoo: recebe cada mensagem NOVA (o outro lado falou)
// e responde com o motor de atendimento. Montado com express.raw (corpo cru) para
// validar a assinatura HMAC byte-a-byte. Regras: valida assinatura + anti-replay,
// responde 2xx RÁPIDO (timeout de 10s da Freelandoo) e processa em background,
// com idempotência por message.id_message (retries reprocessam o mesmo evento).
//
// A URL registrada é /freelandoo/webhook/:instanceId — o instanceId identifica a
// conexão (e portanto o webhook_secret) sem precisar adivinhar.

const { Router } = require('express')
const { logger } = require('../logger')
const { verificarAssinaturaWebhook } = require('../freelandoo/crypto')
const { buscarConexaoDescriptografada, registrarEventoRecebido } = require('../db/freelandoo')
const { processarEventoEmBackground } = require('../freelandoo/responder')

const router = Router({ mergeParams: true })

function rawParaString(body) {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  return ''
}

router.post('/:instanceId', async (req, res) => {
  const instanceId = req.params.instanceId
  const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(rawParaString(req.body), 'utf8')
  const ts = req.headers['x-freelandoo-timestamp']
  const sig = req.headers['x-freelandoo-signature']

  let conexao
  try {
    conexao = await buscarConexaoDescriptografada(instanceId)
  } catch (err) {
    logger.error({ err: err.message, instanceId }, 'Freelandoo webhook: erro ao carregar conexão')
    return res.status(500).end()
  }
  if (!conexao || !conexao.webhookSecret) {
    return res.status(404).json({ error: 'conexao_desconhecida' })
  }

  const check = verificarAssinaturaWebhook({
    webhookSecret: conexao.webhookSecret,
    timestamp: ts,
    signature: sig,
    rawBody: rawBuf,
  })
  if (!check.ok) {
    logger.warn({ instanceId, motivo: check.motivo }, 'Freelandoo webhook: assinatura rejeitada')
    return res.status(401).json({ error: 'assinatura_invalida' })
  }

  let payload
  try {
    payload = JSON.parse(rawParaString(rawBuf) || '{}')
  } catch (_) {
    return res.status(400).json({ error: 'json_invalido' })
  }

  // Só nos interessa mensagem recebida de texto. Outros eventos: ack e ignora.
  const evento = payload?.event
  const conversationId = payload?.conversation?.id || null
  const idMessage = payload?.message?.id_message || null
  const kind = payload?.message?.kind || 'text'
  const texto = String(payload?.message?.body || '').trim()

  if (evento !== 'message.received' || !idMessage || !conversationId) {
    return res.status(200).json({ ok: true, ignored: true })
  }

  // Idempotência: registra o evento; retries reencontram o mesmo id_message.
  let reg
  try {
    reg = await registrarEventoRecebido({ idMessage, instanceId, conversationId, payload })
  } catch (err) {
    logger.error({ err: err.message, idMessage }, 'Freelandoo webhook: falha ao registrar evento')
    return res.status(500).end()
  }

  // Responde 2xx JÁ — o processamento segue em background.
  res.status(200).json({ ok: true, received: true })

  if (!reg.novo) {
    logger.info({ idMessage, conversationId }, 'Freelandoo webhook: evento repetido — ignorado (idempotência)')
    return
  }
  if (kind !== 'text' || !texto) {
    logger.info({ idMessage, conversationId, kind }, 'Freelandoo webhook: mensagem sem texto — sem resposta automática')
    return
  }
  processarEventoEmBackground({ idMessage, instanceId, conversationId, mensagemTexto: texto })
})

module.exports = router
