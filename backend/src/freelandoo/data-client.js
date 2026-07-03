'use strict'

// Cliente da "API de Dados da Freelandoo" (READ-ONLY).
// Diferente do canal de atendimento (src/freelandoo/client.js, prefixo /ext/v1):
// aqui o prefixo é /ext/v1/data e o token é do tipo `flnd_data_...`.
// Só faz GET; serve para montar o Playbook de Atendimento de um vendedor.
//
// Toda chamada usa Bearer <token>. Limite: 60 req/min (HTTP 429 + Retry-After).
// Reutiliza o FreelandooError do cliente de atendimento para manter a semântica
// de erro (401 = token inválido, 403 = escopo/recurso desligado, 429 = rate limit).

const axios = require('axios')
const { FreelandooError } = require('./client')

// Raiz do backend da Freelandoo (SEM o /ext/v1). Deriva do env já existente
// FREELANDOO_BASE_URL (que aponta para .../ext/v1) removendo o sufixo, e permite
// override explícito por FREELANDOO_DATA_BASE_URL. Sem nada, cai no domínio de prod.
function baseDadosPadrao() {
  const explicit = process.env.FREELANDOO_DATA_BASE_URL
  if (explicit) return `${String(explicit).replace(/\/+$/, '')}/ext/v1/data`
  const atendimento = process.env.FREELANDOO_BASE_URL ||
    'https://freelandoo-backend-production.up.railway.app/ext/v1'
  const raiz = String(atendimento).replace(/\/+$/, '').replace(/\/ext\/v1$/i, '')
  return `${raiz}/ext/v1/data`
}

const TIMEOUT_MS = Math.max(parseInt(process.env.FREELANDOO_TIMEOUT_MS, 10) || 15000, 3000)

const TOKEN_PREFIXO = 'flnd_data_'

function extrairMensagemErro(data, fallback) {
  if (!data) return fallback
  if (typeof data === 'string') return data
  return data.error || data.message || fallback
}

// Cria um cliente para uma conta. `baseUrl`, se vier do usuário, é a RAIZ do
// backend (ex.: https://backend-da-freelandoo) — anexamos /ext/v1/data.
function criarDataClient({ baseUrl, token } = {}) {
  if (!token) throw new FreelandooError('Token da API de Dados ausente', { code: 'SEM_TOKEN' })
  if (!String(token).startsWith(TOKEN_PREFIXO)) {
    throw new FreelandooError(`Token inválido: precisa começar com "${TOKEN_PREFIXO}".`, {
      code: 'TOKEN_FORMATO', status: 400,
    })
  }

  let base
  if (baseUrl) {
    const raiz = String(baseUrl).replace(/\/+$/, '').replace(/\/ext\/v1(\/data)?$/i, '')
    base = `${raiz}/ext/v1/data`
  } else {
    base = baseDadosPadrao()
  }

  const http = axios.create({
    baseURL: base,
    timeout: TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    validateStatus: () => true, // tratamos os status manualmente
  })

  async function get(path) {
    let resp
    try {
      resp = await http.request({ method: 'get', url: path })
    } catch (err) {
      throw new FreelandooError(err.message || 'Falha de rede com a Freelandoo', { code: 'NETWORK', status: 0 })
    }
    const status = resp.status
    if (status >= 200 && status < 300) return resp.data

    if (status === 401) {
      throw new FreelandooError('Token inválido ou revogado (401).', { status, code: 'UNAUTHORIZED' })
    }
    if (status === 403) {
      throw new FreelandooError(extrairMensagemErro(resp.data, 'Recurso desligado ou token do tipo errado (403).'), {
        status, code: 'FORBIDDEN', data: resp.data,
      })
    }
    if (status === 429) {
      const ra = Number(resp.headers?.['retry-after'])
      throw new FreelandooError('Limite de requisições atingido (429).', {
        status, code: 'RATE_LIMIT', retryAfter: Number.isFinite(ra) ? ra : 60, data: resp.data,
      })
    }
    throw new FreelandooError(extrairMensagemErro(resp.data, `Erro Freelandoo (HTTP ${status}).`), {
      status, code: 'HTTP_ERROR', data: resp.data,
    })
  }

  return {
    baseUrl: base,
    me() { return get('/me') },
    profiles() { return get('/profiles') },
    services() { return get('/services') },
    products() { return get('/products') },
    social() { return get('/social') },
    courses() { return get('/courses') },
    metrics() { return get('/metrics') },
  }
}

module.exports = { criarDataClient, baseDadosPadrao, TOKEN_PREFIXO }
