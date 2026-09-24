'use strict'

const crypto = require('node:crypto')

const KEY_PREFIX = 'avls_'
const DEFAULT_SCOPES = Object.freeze(['lead_search:maps:create', 'lead_search:jobs:read'])
const VALID_SCOPES = new Set(DEFAULT_SCOPES)

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function gerarCodigoAcesso() {
  return `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

function hashCodigoAcesso(codigo) {
  const token = String(codigo || '').trim()
  if (!token.startsWith(KEY_PREFIX) || token.length < KEY_PREFIX.length + 20) {
    throw erro('Codigo de acesso invalido.', 401, 'INVALID_API_KEY')
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

function hintCodigoAcesso(codigo) {
  const token = String(codigo || '').trim()
  if (!token) return null
  return `${KEY_PREFIX}...${token.slice(-6)}`
}

function extrairBearer(header) {
  const valor = String(header || '').trim()
  const m = valor.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

function normalizarScopes(valor) {
  const pedidos = Array.isArray(valor) ? valor : DEFAULT_SCOPES
  const scopes = [...new Set(pedidos.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!scopes.length) return [...DEFAULT_SCOPES]
  const invalidos = scopes.filter((s) => !VALID_SCOPES.has(s))
  if (invalidos.length) throw erro(`Escopo invalido: ${invalidos.join(', ')}`, 400, 'INVALID_SCOPE')
  return scopes
}

function normalizarLimiteChave(valor) {
  const n = valor == null || valor === '' ? 100 : Number.parseInt(valor, 10)
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw erro('max_leads_per_job deve ficar entre 1 e 100.', 400, 'INVALID_MAX_LEADS')
  }
  return n
}

function normalizarRateLimit(valor) {
  const n = valor == null || valor === '' ? 10 : Number.parseInt(valor, 10)
  if (!Number.isFinite(n) || n < 1 || n > 60) {
    throw erro('rate_limit_per_minute deve ficar entre 1 e 60.', 400, 'INVALID_RATE_LIMIT')
  }
  return n
}

function normalizarExpiracao(valor) {
  if (valor == null || valor === '') return null
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) throw erro('expires_at invalido.', 400, 'INVALID_EXPIRES_AT')
  return d.toISOString()
}

function criarMaterialChave() {
  const codigo = gerarCodigoAcesso()
  return {
    codigo,
    key_hash: hashCodigoAcesso(codigo),
    key_hint: hintCodigoAcesso(codigo),
  }
}

function apresentarChave(row = {}) {
  return {
    id: row.id,
    empresa_id: row.empresa_id || null,
    nome: row.nome,
    key_hint: row.key_hint,
    scopes: row.scopes || [],
    status: row.status,
    max_leads_per_job: Number(row.max_leads_per_job || 0),
    rate_limit_per_minute: Number(row.rate_limit_per_minute || 0),
    expires_at: row.expires_at || null,
    revoked_at: row.revoked_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

function verificarUsoChave(row, scope) {
  if (!row) throw erro('Codigo de acesso invalido.', 401, 'INVALID_API_KEY')
  if (row.status !== 'active') throw erro('Codigo de acesso revogado.', 401, 'API_KEY_REVOKED')
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw erro('Codigo de acesso expirado.', 401, 'API_KEY_EXPIRED')
  }
  if (scope && !(row.scopes || []).includes(scope)) {
    throw erro('Codigo de acesso sem escopo para esta operacao.', 403, 'API_KEY_SCOPE_DENIED')
  }
  if (!row.empresa_id) {
    throw erro('Codigo de acesso sem empresa associada.', 403, 'API_KEY_WITHOUT_COMPANY')
  }
  return row
}

module.exports = {
  KEY_PREFIX,
  DEFAULT_SCOPES,
  criarMaterialChave,
  gerarCodigoAcesso,
  hashCodigoAcesso,
  hintCodigoAcesso,
  extrairBearer,
  normalizarScopes,
  normalizarLimiteChave,
  normalizarRateLimit,
  normalizarExpiracao,
  apresentarChave,
  verificarUsoChave,
  erro,
}
