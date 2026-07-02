'use strict'

// Cliente da "API de Atendimento da Freelandoo".
// Fala DIRETO com o backend (sem prefixo /api). Toda chamada usa Bearer <token>.
// Limite: 60 req/min por conexão (HTTP 429 + Retry-After respeitado no erro).
//
// Ids de conversa unificados (sempre com prefixo):
//   dm:<uuid>  → conversa direta 1-a-1
//   os:<uuid>  → chat de uma ordem de serviço

const axios = require('axios')

const BASE_URL_PADRAO =
  process.env.FREELANDOO_BASE_URL ||
  'https://freelandoo-backend-production.up.railway.app/ext/v1'

const TIMEOUT_MS = Math.max(parseInt(process.env.FREELANDOO_TIMEOUT_MS, 10) || 15000, 3000)

class FreelandooError extends Error {
  constructor(message, { status = 0, code = 'FREELANDOO_ERROR', retryAfter = null, data = null } = {}) {
    super(message)
    this.name = 'FreelandooError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.data = data
  }
}

function tipoDaConversa(id) {
  const s = String(id || '')
  if (s.startsWith('dm:')) return 'dm'
  if (s.startsWith('os:')) return 'os'
  return null
}

function extrairMensagemErro(data, fallback) {
  if (!data) return fallback
  if (typeof data === 'string') return data
  return data.error || data.message || fallback
}

function criarCliente({ baseUrl, token } = {}) {
  const base = String(baseUrl || BASE_URL_PADRAO).replace(/\/+$/, '')
  if (!token) throw new FreelandooError('Token da conexão Freelandoo ausente', { code: 'SEM_TOKEN' })

  const http = axios.create({
    baseURL: base,
    timeout: TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    validateStatus: () => true, // tratamos os status manualmente
  })

  async function request(method, url, { data, params } = {}) {
    let resp
    try {
      resp = await http.request({ method, url, data, params })
    } catch (err) {
      throw new FreelandooError(err.message || 'Falha de rede com a Freelandoo', {
        code: 'NETWORK', status: 0,
      })
    }
    const status = resp.status
    if (status >= 200 && status < 300) return resp.data

    if (status === 401) {
      throw new FreelandooError('Token inválido ou revogado (401).', { status, code: 'UNAUTHORIZED', data: resp.data })
    }
    if (status === 403) {
      throw new FreelandooError(extrairMensagemErro(resp.data, 'Fora do escopo ou conversa encerrada (403).'), {
        status, code: 'FORBIDDEN', data: resp.data,
      })
    }
    if (status === 429) {
      const ra = Number(resp.headers?.['retry-after'])
      throw new FreelandooError('Rate limit da Freelandoo (429).', {
        status, code: 'RATE_LIMIT', retryAfter: Number.isFinite(ra) ? ra : 60, data: resp.data,
      })
    }
    throw new FreelandooError(extrairMensagemErro(resp.data, `Erro Freelandoo (HTTP ${status}).`), {
      status, code: 'HTTP_ERROR', data: resp.data,
    })
  }

  return {
    baseUrl: base,

    // GET /me → { connection:{...}, user:{...} }
    me() {
      return request('get', '/me')
    },

    // POST /webhook { url } → { webhook_url, webhook_secret }
    setWebhook(url) {
      return request('post', '/webhook', { data: { url } })
    },

    // GET /conversations?updated_since=&limit= → { items: [...] }
    listConversations({ updatedSince, limit } = {}) {
      const params = {}
      if (updatedSince) params.updated_since = updatedSince
      if (limit) params.limit = Math.min(Math.max(Number(limit) || 0, 1), 100)
      return request('get', '/conversations', { params })
    },

    // GET /conversations/:id/messages — normaliza os DOIS formatos (dm vs os).
    // Retorna { tipo, mensagens:[{ id_message, mine, texto, created_at }], next_cursor, has_more, raw }.
    async listMessages(conversationId, { cursor, limit } = {}) {
      const tipo = tipoDaConversa(conversationId)
      const params = {}
      if (cursor) params.cursor = cursor
      if (limit) params.limit = limit
      const raw = await request('get', `/conversations/${encodeURIComponent(conversationId)}/messages`, { params })

      if (tipo === 'os') {
        // { messages:[{ id_message, sender:"USER"|"PRO", content, sent_via, created_at }], side, response }
        const mensagens = (Array.isArray(raw?.messages) ? raw.messages : []).map((m) => ({
          id_message: m.id_message,
          mine: String(m.sender).toUpperCase() === 'PRO',
          texto: m.content || '',
          created_at: m.created_at,
        }))
        return { tipo: 'os', mensagens, next_cursor: null, has_more: false, raw }
      }
      // dm (default): { items:[{ id_message, body, sent_via, sender_*, created_at }], next_cursor, has_more }
      const mensagens = (Array.isArray(raw?.items) ? raw.items : []).map((m) => ({
        id_message: m.id_message,
        mine: !!m.sent_via, // sent_via só vem no MEU lado (respostas do bot/vendedor)
        texto: m.body || '',
        created_at: m.created_at,
      }))
      return {
        tipo: 'dm',
        mensagens,
        next_cursor: raw?.next_cursor || null,
        has_more: !!raw?.has_more,
        raw,
      }
    },

    // POST /conversations/:id/messages { body } → 201 { message }
    sendMessage(conversationId, body) {
      const texto = String(body || '').slice(0, 4000)
      return request('post', `/conversations/${encodeURIComponent(conversationId)}/messages`, { data: { body: texto } })
    },

    // POST /conversations/:id/read
    markRead(conversationId) {
      return request('post', `/conversations/${encodeURIComponent(conversationId)}/read`)
    },
  }
}

module.exports = { criarCliente, FreelandooError, BASE_URL_PADRAO, tipoDaConversa }
