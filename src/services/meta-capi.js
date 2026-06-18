'use strict'

// Enviador de eventos de conversão para a Meta (Conversions API / Click-to-WhatsApp).
// Manda eventos de funil (Lead, QualifiedLead, Schedule, MeetingCompleted, Purchase) com
// o ctwa_clid do lead → a Meta atribui ao anúncio e otimiza a entrega.
//
// Liga-se SÓ se META_DATASET_ID + META_CAPI_TOKEN estiverem no ambiente (Railway). Sem
// eles, fica desligado (no-op) — nada é enviado. META_CAPI_TEST_CODE: se setado, manda
// como evento de TESTE (aparece em "Testar eventos" do Gerenciador de Eventos).

const axiosDefault = require('axios')

const META_API_VERSION = process.env.META_CAPI_API_VERSION || 'v21.0'

function capiConfigurado() {
  return Boolean(
    String(process.env.META_DATASET_ID || '').trim() &&
    String(process.env.META_CAPI_TOKEN || '').trim()
  )
}

/**
 * Envia UM evento de conversão à Meta. Retorna {ok, status, data} ou {ok:false, ...}.
 * Nunca lança — erro é capturado e devolvido (o chamador registra no ledger).
 */
async function enviarEventoMetaCAPI(evt = {}, deps = {}) {
  const logger = deps.logger || console
  const axios = deps.axios || axiosDefault
  if (!capiConfigurado()) return { ok: false, motivo: 'capi_desligado' }
  if (!evt.ctwaClid) return { ok: false, motivo: 'sem_ctwa_clid' }

  const datasetId = String(process.env.META_DATASET_ID).trim()
  const token = String(process.env.META_CAPI_TOKEN).trim()
  const url = `https://graph.facebook.com/${META_API_VERSION}/${datasetId}/events`

  // CTWA exige page_id OU whatsapp_business_account_id no user_data (subcode 2804116):
  // sem isso a Meta rejeita o evento. page_id é o da Página que roda os anúncios.
  const userData = { ctwa_clid: evt.ctwaClid }
  const pageId = String(process.env.META_PAGE_ID || '').trim()
  const wabaId = String(process.env.META_WABA_ID || '').trim()
  if (pageId) userData.page_id = pageId
  else if (wabaId) userData.whatsapp_business_account_id = wabaId

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
  const testCode = String(process.env.META_CAPI_TEST_CODE || '').trim()
  if (testCode) body.test_event_code = testCode

  try {
    const resp = await axios.post(url, body, { timeout: 15000 })
    return { ok: true, status: resp.status, data: resp.data }
  } catch (e) {
    // Captura o detalhe real do erro da Meta (não só "Invalid parameter"): o motivo
    // específico vem em error_subcode / error_user_title / error_user_msg / error_data.
    // Sem isso, todo erro vira a mensagem genérica e fica impossível diagnosticar.
    const apiErr = e.response?.data?.error
    const erro = apiErr
      ? {
          message: apiErr.message || null,
          type: apiErr.type || null,
          code: apiErr.code ?? null,
          error_subcode: apiErr.error_subcode ?? null,
          error_user_title: apiErr.error_user_title || null,
          error_user_msg: apiErr.error_user_msg || null,
          error_data: apiErr.error_data || null,
          fbtrace_id: apiErr.fbtrace_id || null,
        }
      : (e.response?.data || e.message)
    logger.warn?.({ operation: 'meta_capi', etapa: 'envio_erro', eventName: evt.eventName, erro })
    return { ok: false, motivo: 'erro_api', erro }
  }
}

module.exports = {
  META_API_VERSION,
  capiConfigurado,
  enviarEventoMetaCAPI,
}
