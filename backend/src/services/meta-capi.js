'use strict'

// Enviador de UM evento de conversão para a Meta (Conversions API / Click-to-WhatsApp).
//
// MUDANÇA ESTRUTURAL (integração multitenant): este módulo NÃO lê mais
// META_DATASET_ID / META_CAPI_TOKEN / META_PAGE_ID do processo. Ele recebe a `config`
// da EMPRESA dona do evento como argumento. Enquanto a credencial vinha do ambiente,
// não havia como um segundo tenant existir sem que a conversão dele fosse parar no
// dataset do primeiro — que é exatamente o vazamento que esta integração corrige.
//
// Continua sendo transporte puro: não decide o que enviar, não lê banco, não deduplica.
// Quem decide é meta-conversao.js (regras) + meta-dispatch.js (orquestração).

const axiosDefault = require('axios')

const META_API_VERSION = process.env.META_CAPI_API_VERSION || 'v21.0'

/**
 * A configuração de uma empresa é utilizável?
 * @param {object} config { datasetId, token, pageId, wabaId }
 */
function configValida(config = {}) {
  const dataset = String(config.datasetId || '').trim()
  const token = String(config.token || '').trim()
  const destino = String(config.pageId || '').trim() || String(config.wabaId || '').trim()
  return Boolean(dataset && token && destino)
}

/**
 * Envia UM evento à Meta. NUNCA lança: devolve { ok, ... } e o chamador grava a
 * tentativa no ledger. O erro vem estruturado (código/subcódigo/fbtrace) porque é
 * disso que sai a mensagem que o operador lê na tela — a mensagem genérica da Meta
 * ("Invalid parameter") não diz nada a ninguém.
 *
 * @param {object} config { datasetId, token, pageId, wabaId, testEventCode, apiVersion }
 * @param {object} evt    { eventName, eventId, ctwaClid, eventTime, value, currency }
 * @param {object} deps   { axios, logger }
 */
async function enviarEventoMetaCAPI(config = {}, evt = {}, deps = {}) {
  const logger = deps.logger || console
  const axios = deps.axios || axiosDefault

  if (!configValida(config)) return { ok: false, motivo: 'config_invalida' }
  if (!evt.ctwaClid) return { ok: false, motivo: 'sem_ctwa_clid' }
  if (!evt.eventName) return { ok: false, motivo: 'sem_event_name' }

  const apiVersion = String(config.apiVersion || META_API_VERSION).trim()
  const datasetId = String(config.datasetId).trim()
  const token = String(config.token).trim()
  const url = `https://graph.facebook.com/${apiVersion}/${datasetId}/events`

  // CTWA exige page_id OU whatsapp_business_account_id no user_data (subcode 2804116).
  // Para WhatsApp a documentação pede o WABA; page_id serve o caminho Messenger. Por
  // isso o WABA tem precedência quando os dois estiverem preenchidos.
  const userData = { ctwa_clid: evt.ctwaClid }
  const wabaId = String(config.wabaId || '').trim()
  const pageId = String(config.pageId || '').trim()
  if (wabaId) userData.whatsapp_business_account_id = wabaId
  else if (pageId) userData.page_id = pageId

  const evento = {
    event_name: evt.eventName,
    event_time: evt.eventTime || Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    event_id: evt.eventId,
    user_data: userData,
  }
  if (evt.value != null && Number.isFinite(Number(evt.value))) {
    evento.custom_data = { value: Number(evt.value), currency: evt.currency || 'BRL' }
  }

  const body = { data: [evento], access_token: token }
  // Modo teste POR EMPRESA: os eventos aparecem em "Testar eventos" do Gerenciador e
  // não entram na otimização. Antes isso era um env global — um tenant não conseguia
  // testar sem contaminar os outros.
  const testCode = String(config.testEventCode || '').trim()
  if (testCode) body.test_event_code = testCode

  const inicio = Date.now()
  try {
    const resp = await axios.post(url, body, { timeout: 15000 })
    return { ok: true, status: resp.status, duracaoMs: Date.now() - inicio, data: resp.data }
  } catch (e) {
    const apiErr = e.response?.data?.error || null
    const erro = {
      codigo: apiErr?.code ?? null,
      subcodigo: apiErr?.error_subcode ?? null,
      fbtraceId: apiErr?.fbtrace_id || null,
      // Título/mensagem "user" da Meta são os campos pensados para exibição; ainda
      // assim eles NÃO vão para a tela crus (meta-conversao.mensagemDeErro traduz a
      // partir do código). Ficam aqui só para o diagnóstico do log.
      titulo: apiErr?.error_user_title || null,
      tipo: apiErr?.type || null,
    }
    // Log sem token, sem ctwa_clid, sem telefone e sem o corpo cru da resposta — a
    // resposta da Meta pode ecoar o que foi enviado, e o que foi enviado identifica
    // uma pessoa.
    logger.warn?.({
      operation: 'meta_capi',
      etapa: 'envio_erro',
      event_name: evt.eventName,
      http_status: e.response?.status ?? null,
      erro_codigo: erro.codigo,
      erro_subcodigo: erro.subcodigo,
      fbtrace_id: erro.fbtraceId,
    })
    return {
      ok: false,
      motivo: 'erro_api',
      status: e.response?.status ?? null,
      duracaoMs: Date.now() - inicio,
      erro,
    }
  }
}

module.exports = {
  META_API_VERSION,
  configValida,
  enviarEventoMetaCAPI,
}
