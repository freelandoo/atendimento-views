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
// Timeout default para chamadas Evolution. Antes ausente -> axios default = 0
// = infinito, podia pendurar worker indefinidamente quando Evolution travasse.
const EVOLUTION_DEFAULT_TIMEOUT_MS = Math.max(
  parseInt(process.env.EVOLUTION_TIMEOUT_MS, 10) || 15000,
  3000
)

async function getInstanceNameForUser(userId) {
  if (!userId) return INSTANCE_NAME
  try {
    const { pool } = require('./db')
    const { rows } = await pool.query(
      `SELECT instance_name FROM vendas.whatsapp_connections
       WHERE user_id = $1 AND status = 'connected' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`, [userId]
    )
    return rows[0]?.instance_name || INSTANCE_NAME
  } catch (_) {
    return INSTANCE_NAME
  }
}

function normalizarEvolutionInstanceName(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) {
    throw new Error('Evolution instance invalida para envio')
  }
  return raw
}

async function getInstanceNameForConversation(numero) {
  const jid = String(numero || '').trim()
  if (!jid) return ''
  try {
    const { pool } = require('./db')
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(BTRIM(c.evolution_instance), ''), ewi.evolution_instance) AS evolution_instance
         FROM vendas.conversas c
         LEFT JOIN LATERAL (
           SELECT evolution_instance
             FROM app.empresa_whatsapp_instances
            WHERE empresa_id = c.empresa_id
              AND ativo = true
            ORDER BY atualizado_em DESC, criado_em DESC
            LIMIT 1
         ) ewi ON true
        WHERE c.numero = $1
        LIMIT 1`,
      [jid]
    )
    return normalizarEvolutionInstanceName(rows[0]?.evolution_instance || '')
  } catch (_) {
    return ''
  }
}

async function instanceNameParaEnvio(numero, opts = {}) {
  const explicit = typeof opts === 'string'
    ? opts
    : (opts && typeof opts === 'object' ? opts.instanceName : '')
  return (
    normalizarEvolutionInstanceName(explicit) ||
    await getInstanceNameForConversation(numero) ||
    normalizarEvolutionInstanceName(INSTANCE_NAME)
  )
}

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
  const instanceName = normalizarEvolutionInstanceName(INSTANCE_NAME)
  const url = `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`
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

async function enviarImagemBase64(numero, b64, mimetype, legenda, rotulo = 'imagem', opts = {}) {
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone || !b64) throw new Error(`Imagem invalida para envio (${rotulo})`)
  const instanceName = await instanceNameParaEnvio(numero, opts)
  const { data } = await axios.post(
    `${EVOLUTION_URL}/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      number: phone,
      mediatype: 'image',
      mimetype: mimetype || 'image/png',
      media: b64,
      caption: legenda || '',
    },
    { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
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

/**
 * Classifica erros da Evolution API em tipos com flag retryable.
 * Retorna { tipo, retryable, motivo }.
 */
function classificarErroEvolution(err) {
  const status = err.response?.status
  const msgRaw = err.response?.data?.response?.message || err.response?.data?.message || err.message || ''
  const msg = String(Array.isArray(msgRaw) ? msgRaw.join(' ') : msgRaw).toLowerCase()
  const code = String(err.code || '')

  if (msg.includes('connection closed') || msg.includes('conexão fechada')) {
    return { tipo: 'instance_disconnected', retryable: true, motivo: 'Evolution instance connection closed' }
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return { tipo: 'transient', retryable: true, motivo: `Network error: ${code}` }
  }
  if (status === 502 || status === 503 || status === 504) {
    return { tipo: 'transient', retryable: true, motivo: `HTTP ${status} gateway error` }
  }
  if (status === 400 || status === 422) {
    // Antes de classificar como invalid_payload generico, checa se o WhatsApp
    // respondeu exists:false (numero nao tem conta WhatsApp). Visto em producao
    // como ~95% das falhas: numeros fixos sem WhatsApp Business.
    const detalheNumeroInexistente = evolutionDetalheNumeroInexistente(err.response?.data)
    if (detalheNumeroInexistente) {
      return {
        tipo: 'numero_inexistente',
        retryable: false,
        motivo: 'Numero nao tem conta WhatsApp (Evolution exists:false)',
        jid: detalheNumeroInexistente.jid || null,
        number: detalheNumeroInexistente.number || null,
      }
    }
    return { tipo: 'invalid_payload', retryable: false, motivo: `HTTP ${status} invalid payload` }
  }
  if (status === 401 || status === 403) {
    return { tipo: 'auth_error', retryable: false, motivo: `HTTP ${status} authentication error` }
  }
  if (status === 500) {
    return { tipo: 'transient', retryable: true, motivo: 'HTTP 500 internal server error' }
  }
  return { tipo: 'unknown', retryable: false, motivo: `Unexpected error: ${String(err.message || 'unknown').slice(0, 200)}` }
}

/**
 * Verifica se a instância pj-dashboard-1 está conectada na Evolution API.
 * Retorna { ok, instance, connected, state } ou erro estruturado.
 * Nunca lança — falha silenciosa se o endpoint não existir.
 */
async function verificarStatusInstanciaEvolution() {
  const instanceName = normalizarEvolutionInstanceName(INSTANCE_NAME)
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return { ok: true, instance: INSTANCE_NAME, connected: null, state: 'unknown', motivo: 'Evolution não configurada' }
  }
  try {
    const r = await axios.get(
      `${EVOLUTION_URL}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: { apikey: EVOLUTION_KEY }, timeout: 5000 }
    )
    const state = r.data?.instance?.state || r.data?.state || 'unknown'
    const connected = state === 'open'
    return {
      ok: connected,
      instance: instanceName,
      connected,
      state,
      last_checked_at: new Date().toISOString(),
      ...(connected ? {} : {
        tipo: 'instance_disconnected',
        retryable: true,
        motivo: `Instância WhatsApp não conectada (state: ${state})`,
      }),
    }
  } catch (e) {
    logger.warn({ err: serializeError(e), instance: instanceName }, 'verificarStatusInstanciaEvolution falhou')
    return { ok: true, instance: instanceName, connected: null, state: 'unknown', last_checked_at: new Date().toISOString() }
  }
}

function numeroEnvioWhatsapp(numero) {
  const raw = String(numero || '').trim()
  if (!raw) return ''
  if (/@g\.us$/i.test(raw) || /@broadcast$/i.test(raw)) return ''
  if (/@/.test(raw) && !/@s\.whatsapp\.net$/i.test(raw)) return ''
  return raw.replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
}

async function enviarMensagem(numero, texto, opts = {}) {
  const t = (texto || '').trim()
  if (!t) throw new Error('Texto vazio para envio ao WhatsApp')
  const phone = numeroEnvioWhatsapp(numero)
  if (!phone) throw new Error('Número/JID inválido para envio')

  // Evolution API v2.3.7: /message/sendText requires property "text"
  // Simple format: number (digits only) + text (message content)
  const payload = {
    number: phone,  // ← Apenas dígitos, sem @s.whatsapp.net
    text: t         // ← Campo text (requerido pela API Evolution)
  }

  const instanceName = await instanceNameParaEnvio(numero, opts)

  try {
    const r = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(instanceName)}`,
      payload,
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r.data, 'sendText')
    return r.data
  } catch (e) {
    const classificacao = classificarErroEvolution(e)
    const errCtx = {
      ...evolutionErrorContext(e, 'sendText', phone),
      endpoint: `/message/sendText/${instanceName}`,
      payload_keys: Object.keys(payload),
      text_length: t.length,
      instance: instanceName,
      http_status: e.response?.status,
      response_data: e.response?.data,
      response_message: e.response?.data?.response?.message,
      axios_code: e.code,
      tipo_erro: classificacao.tipo,
      retryable: classificacao.retryable,
      motivo: classificacao.motivo,
    }
    if (classificacao.retryable) {
      logger.warn(errCtx, 'Evolution sendText failed (retryable)')
    } else {
      logger.error(errCtx, 'Evolution sendText failed')
    }
    e.evolutionClassificacao = classificacao
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
async function enviarPrintLocal(numero, chave, legenda, opts = {}) {
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
  const instanceName = await instanceNameParaEnvio(numero, opts)
  try {
    const { data } = await axios.post(
      `${EVOLUTION_URL}/message/sendMedia/${encodeURIComponent(instanceName)}`,
      {
        number: phone,
        mediatype: 'image',
        mimetype: 'image/png',
        media: b64,
        caption: legenda || '',
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(data, 'sendMedia(print)')
    logger.info({ chave, numero: redactPhone(phone) }, 'Print enviado ao lead')
    return true
  } catch (e) {
    logger.error(evolutionErrorContext(e, 'sendMedia(print)', phone), 'Evolution sendMedia print failed')
    return false
  }
}

async function enviarComBotoes(numero, texto, botoes, opts = {}) {
  const numLimpo = numeroEnvioWhatsapp(numero)
  const t = (texto || '').trim()
  if (!numLimpo || !t) throw new Error('Número ou texto inválido para envio com botões')

  const instanceName = await instanceNameParaEnvio(numero, opts)

  try {
    // Evolution API v2.3.7: sendText requires { number, text }
    const r0 = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        number: numLimpo,  // ← Apenas dígitos
        text: t            // ← Campo requerido pela API
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r0.data, 'sendText(botoes)')

    const r1 = await axios.post(
      `${EVOLUTION_URL}/message/sendButtons/${encodeURIComponent(instanceName)}`,
      {
        number: numLimpo,  // ← Apenas dígitos
        title: 'Escolha uma opção',
        description: 'Toque para responder',
        footer: 'PJ Codeworks',
        buttons: botoes.map((b, i) => ({ type: 'reply', displayText: b, id: `opt_${i + 1}` }))
      },
      { headers: { apikey: EVOLUTION_KEY }, timeout: EVOLUTION_DEFAULT_TIMEOUT_MS }
    )
    assertEvolutionEnvioOk(r1.data, 'sendButtons')
    logger.info({ botoes }, 'Botoes enviados')
  } catch (_) {
    logger.info('Botoes nao suportados; texto ja enviado')
  }
}

async function enviarSequenciaMensagens(numero, partes, opts = {}) {
  const instanceName = await instanceNameParaEnvio(numero, opts)
  for (let i = 0; i < partes.length; i++) {
    await enviarMensagem(numero, partes[i], { instanceName })
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
  classificarErroEvolution,
  verificarStatusInstanciaEvolution,
  numeroEnvioWhatsapp,
  enviarMensagem,
  enviarPrintLocal,
  enviarComBotoes,
  enviarSequenciaMensagens,
  getInstanceNameForUser,
  normalizarEvolutionInstanceName,
  getInstanceNameForConversation,
  instanceNameParaEnvio,
}
