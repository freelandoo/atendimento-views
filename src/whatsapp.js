'use strict'
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { logger, redactPhone, serializeError } = require('./logger')
const ROOT = path.join(__dirname, '..')

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE || 'PJ'

const BOLHAS_ENVIO_DELAY_MS = 450

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extrairBase64DaRespostaEvolution(data) {
  if (data == null) return null
  if (typeof data === 'string') return data
  if (typeof data.base64 === 'string') return data.base64
  if (data.data != null && typeof data.data === 'string') return data.data
  return null
}

async function evolutionObterBase64Midia(webMessageInfo) {
  const url = `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${INSTANCE_NAME}`
  const { data } = await axios.post(
    url,
    { message: webMessageInfo, convertToMp4: false },
    { headers: { apikey: EVOLUTION_KEY }, timeout: 120000 }
  )
  assertEvolutionEnvioOk(data, 'getBase64FromMediaMessage')
  const b64 = extrairBase64DaRespostaEvolution(data)
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Resposta Evolution sem base64')
  }
  return b64
}

async function enviarImagemBase64(numero, b64, mimetype, legenda, rotulo = 'imagem') {
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone || !b64) throw new Error(`Imagem invalida para envio (${rotulo})`)
  const { data } = await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
    {
      number: phone,
      mediatype: 'image',
      mimetype: mimetype || 'image/png',
      media: b64,
      caption: legenda || '',
    },
    { headers: { apikey: EVOLUTION_KEY } }
  )
  assertEvolutionEnvioOk(data, `sendMedia(${rotulo})`)
  return true
}

// ─── EVOLUTION API ────────────────────────────────────────────────────────────

/** Quando `exists: false`, o WhatsApp não reconhece o número (inválido, sem app ou checagem falhou). */
function evolutionDetalheNumeroInexistente(data) {
  if (!data || typeof data !== 'object') return null
  const arr = data.response?.message
  if (!Array.isArray(arr)) return null
  return arr.find((x) => x && x.exists === false) || null
}

/** Evolution costuma responder HTTP 200 com `{ success: false }` no corpo — tratar como falha. */
function evolutionCorpoIndicaFalha(data) {
  return data != null && typeof data === 'object' && data.success === false
}

function evolutionMensagemErroDoCorpo(data) {
  if (!data || typeof data !== 'object') return 'success:false'
  const m = data.message || data.error || data.msg
  if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 400)
  try {
    return JSON.stringify(data).slice(0, 500)
  } catch (_) {
    return 'success:false'
  }
}

function assertEvolutionEnvioOk(data, rotulo) {
  if (evolutionCorpoIndicaFalha(data)) {
    throw new Error(`${rotulo}: Evolution retornou success:false — ${evolutionMensagemErroDoCorpo(data)}`)
  }
}

function evolutionErrorContext(e, operation, numero) {
  return {
    err: serializeError(e),
    operation,
    http_status: e.response?.status || null,
    numero: redactPhone(numero),
  }
}

function numeroEnvioWhatsapp(numero) {
  const raw = String(numero || '').trim()
  if (!raw) return ''
  if (/@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) return ''
  if (/@/.test(raw) && !/@s\.whatsapp\.net$/i.test(raw)) return ''
  return raw.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
}

async function enviarMensagem(numero, texto) {
  const t = (texto || '').trim()
  if (!t) throw new Error('Texto vazio para envio ao WhatsApp')
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone) throw new Error('Número/JID inválido para envio')
  try {
    const r = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
      { number: phone, text: t },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(r.data, 'sendText')
    return r.data
  } catch (e) {
    logger.error(evolutionErrorContext(e, 'sendText', phone), 'Evolution sendText failed')
    throw e
  }
}

/**
 * Mapa de prints autorizados para envio automático ao lead.
 * Chave = valor do campo `enviar_print` no JSON da IA.
 * Valor = caminho relativo a partir da raiz do projeto.
 */
const PRINTS_AUTORIZADOS = {
  '874-analytics': 'knowledge/prints/874-analytics-30d.png',
  'modelos-site': 'knowledge/prints/modelos-site-3-tiers.png',
  'planos-mensais': 'knowledge/prints/planos-mensais.png',
  'operacao-digital': 'knowledge/prints/operacao-digital.png',
}

/**
 * Envia uma imagem local ao lead via Evolution API (sendMedia base64).
 * Retorna true se enviou, false se o arquivo não existir (sem lançar erro).
 */
async function enviarPrintLocal(numero, chave, legenda) {
  const caminho = PRINTS_AUTORIZADOS[chave]
  if (!caminho) {
    logger.warn({ chave }, 'enviar_print chave nao reconhecida')
    return false
  }
  const caminhoAbs = require('path').resolve(ROOT, caminho)
  const fs = require('fs')
  if (!fs.existsSync(caminhoAbs)) {
    logger.warn({ chave, caminho: caminhoAbs }, 'enviar_print arquivo nao encontrado; ignorando envio de imagem')
    return false
  }
  const b64 = fs.readFileSync(caminhoAbs).toString('base64')
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone) {
    logger.warn({ chave, numero: redactPhone(numero) }, 'enviar_print numero/JID invalido; ignorando envio de imagem')
    return false
  }
  try {
    const { data } = await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
      {
        number: phone,
        mediatype: 'image',
        mimetype: 'image/png',
        media: b64,
        caption: legenda || '',
      },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(data, 'sendMedia(print)')
    logger.info({ chave, numero: redactPhone(phone) }, 'Print enviado ao lead')
    return true
  } catch (e) {
    logger.error(evolutionErrorContext(e, 'sendMedia(print)', phone), 'Evolution sendMedia print failed')
    return false
  }
}

async function enviarComBotoes(numero, texto, botoes) {
  const numLimpo = numeroEnvioWhatsapp(numero)
  const t = (texto || '').trim()
  if (!numLimpo || !t) throw new Error('Número ou texto inválido para envio com botões')
  const r0 = await axios.post(
    `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
    { number: numLimpo, text: t },
    { headers: { apikey: EVOLUTION_KEY } }
  )
  assertEvolutionEnvioOk(r0.data, 'sendText(botoes)')
  try {
    const r1 = await axios.post(
      `${EVOLUTION_URL}/message/sendButtons/${INSTANCE_NAME}`,
      {
        number: numLimpo,
        title: 'Escolha uma opção',
        description: 'Toque para responder',
        footer: 'PJ Codeworks',
        buttons: botoes.map((b, i) => ({ type: 'reply', displayText: b, id: `opt_${i + 1}` }))
      },
      { headers: { apikey: EVOLUTION_KEY } }
    )
    assertEvolutionEnvioOk(r1.data, 'sendButtons')
    logger.info({ botoes }, 'Botoes enviados')
  } catch (_) {
    logger.info('Botoes nao suportados; texto ja enviado')
  }
}

async function enviarSequenciaMensagens(numero, partes) {
  for (let i = 0; i < partes.length; i++) {
    await enviarMensagem(numero, partes[i])
    if (i < partes.length - 1) await sleep(BOLHAS_ENVIO_DELAY_MS)
  }
}

module.exports = {
  EVOLUTION_URL,
  EVOLUTION_KEY,
  INSTANCE_NAME,
  BOLHAS_ENVIO_DELAY_MS,
  sleep,
  extrairBase64DaRespostaEvolution,
  evolutionObterBase64Midia,
  enviarImagemBase64,
  evolutionDetalheNumeroInexistente,
  evolutionCorpoIndicaFalha,
  evolutionMensagemErroDoCorpo,
  assertEvolutionEnvioOk,
  numeroEnvioWhatsapp,
  enviarMensagem,
  enviarPrintLocal,
  enviarComBotoes,
  enviarSequenciaMensagens,
}
