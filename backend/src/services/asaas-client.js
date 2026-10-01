'use strict'
// Cliente OUTBOUND da ASAAS (cobranca recorrente). Cria cliente + assinatura e busca a 1a cobranca
// pra devolver a URL de checkout. Le config do ambiente (ASAAS_API_KEY / ASAAS_BASE_URL). Auth por
// header `access_token` (= a API Key). Nunca loga a chave nem PII.
//
// ⚠️ A verificacao AO VIVO (sandbox) ainda nao foi feita: os campos da resposta (sub.id,
// payment.invoiceUrl) seguem a doc da ASAAS; confirmar numa chamada real antes de ligar em prod.
const axios = require('axios')

const BASE_URL_PADRAO = 'https://api-sandbox.asaas.com/v3'
const TIMEOUT_MS = 15000

class AsaasError extends Error {
  constructor(message, { status = 0, code = 'ASAAS_ERROR', data = null } = {}) {
    super(message)
    this.name = 'AsaasError'
    this.status = status
    this.code = code
    this.data = data
  }
}

function cliente() {
  const apiKey = process.env.ASAAS_API_KEY
  if (!apiKey) throw new AsaasError('ASAAS_API_KEY ausente no ambiente', { code: 'SEM_API_KEY' })
  const baseURL = String(process.env.ASAAS_BASE_URL || BASE_URL_PADRAO).replace(/\/+$/, '')
  return axios.create({
    baseURL,
    timeout: TIMEOUT_MS,
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  })
}

function msgErro(data, fallback) {
  if (!data) return fallback
  if (Array.isArray(data.errors) && data.errors[0]) return data.errors[0].description || fallback
  return data.message || fallback
}

function lancar(err, fallback) {
  const r = err.response
  if (err instanceof AsaasError) throw err
  throw new AsaasError(msgErro(r && r.data, fallback), { status: (r && r.status) || 0, data: r && r.data })
}

// Cria (ou a ASAAS reaproveita) o cliente. cpfCnpj e' OBRIGATORIO pela ASAAS.
async function criarCustomer({ nome, cpfCnpj, email, telefone }) {
  try {
    const { data } = await cliente().post('/customers', {
      name: nome,
      cpfCnpj,
      email: email || undefined,
      mobilePhone: telefone || undefined,
    })
    return data // { id, ... }
  } catch (err) {
    lancar(err, 'Falha ao criar cliente na ASAAS')
  }
}

// Assinatura recorrente mensal. billingType UNDEFINED → o cliente escolhe Pix/boleto/cartao no
// checkout. 1a cobranca amanha (a conta nasceu no trial; aqui e' a conversao para pago).
async function criarAssinatura({ customerId, valor, descricao }) {
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  try {
    const { data } = await cliente().post('/subscriptions', {
      customer: customerId,
      billingType: 'UNDEFINED',
      value: valor,
      nextDueDate: amanha,
      cycle: 'MONTHLY',
      description: descricao,
    })
    return data // { id, ... }
  } catch (err) {
    lancar(err, 'Falha ao criar assinatura na ASAAS')
  }
}

// URL de pagamento da 1a cobranca da assinatura (pra redirecionar o cliente ao checkout).
async function urlCheckoutDaAssinatura(subscriptionId) {
  try {
    const { data } = await cliente().get(`/subscriptions/${subscriptionId}/payments`)
    const primeira = data && Array.isArray(data.data) ? data.data[0] : null
    return primeira ? primeira.invoiceUrl || null : null
  } catch (err) {
    lancar(err, 'Falha ao obter a cobranca da assinatura')
  }
}

module.exports = { AsaasError, criarCustomer, criarAssinatura, urlCheckoutDaAssinatura }
