// @ts-check
'use strict'

// Webhook da ASAAS — regras PURAS. Mapeia o evento recebido para a transicao de status do plano,
// valida o token de origem e extrai a chave de idempotencia e as referencias. Nao le banco, HTTP
// nem env. O transporte/idempotencia vive em routes/asaas-webhook.js + db/empresa-plano.js.
//
// A ASAAS valida origem por um TOKEN compartilhado no header `asaas-access-token` (que NOS
// definimos no painel = ASAAS_WEBHOOK_TOKEN), NAO por HMAC do corpo — por isso o endpoint nao
// precisa de raw body. Entrega "at least once": o mesmo evento chega varias vezes.

const { STATUS } = require('./plano-definicao')

// Evento ASAAS -> status de empresa_plano. Evento fora do mapa = null (ignora, ack 200).
// Confirmado/recebido = pagou (ativa/renova); vencido/estorno = atrasado; assinatura/pagamento
// apagado = cancelado. O vocabulario de status e' o de plano-definicao (anti-drift abaixo).
const EVENTO_PARA_STATUS = Object.freeze({
  PAYMENT_CONFIRMED: 'ativo',
  PAYMENT_RECEIVED: 'ativo',
  PAYMENT_OVERDUE: 'atrasado',
  PAYMENT_REFUNDED: 'atrasado',
  PAYMENT_CHARGEBACK_REQUESTED: 'atrasado',
  PAYMENT_DELETED: 'cancelado',
  SUBSCRIPTION_DELETED: 'cancelado',
})

function statusDoEvento(evento) {
  const s = EVENTO_PARA_STATUS[evento] || null
  return s && STATUS.includes(s) ? s : null
}

// Comparacao de token em tempo ~constante. Tamanho diferente retorna cedo (nao vaza o conteudo);
// token configurado vazio NUNCA valida (senao um ambiente sem o segredo aceitaria qualquer chamada).
function validarToken(recebido, configurado) {
  if (typeof recebido !== 'string' || typeof configurado !== 'string') return false
  if (configurado.length === 0) return false
  if (recebido.length !== configurado.length) return false
  let diff = 0
  for (let i = 0; i < configurado.length; i++) {
    diff |= recebido.charCodeAt(i) ^ configurado.charCodeAt(i)
  }
  return diff === 0
}

// Chave de idempotencia: evento + id do pagamento/assinatura. null quando nao da' pra identificar.
function chaveEvento(body) {
  if (!body || typeof body !== 'object') return null
  const evento = body.event
  const id = (body.payment && body.payment.id) || (body.subscription && body.subscription.id) || null
  if (!evento || !id) return null
  return `${evento}:${id}`
}

// Ids ASAAS para casar com empresa_plano (asaas_subscription_id / asaas_customer_id).
function referenciasAsaas(body) {
  const pay = (body && body.payment) || {}
  const sub = (body && body.subscription) || {}
  return {
    subscriptionId: pay.subscription || sub.id || null,
    customerId: pay.customer || sub.customer || null,
  }
}

module.exports = { EVENTO_PARA_STATUS, statusDoEvento, validarToken, chaveEvento, referenciasAsaas }
