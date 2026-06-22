'use strict'
const { verifyJwt } = require('../auth')
const { findEmpresaById, findEmpresaByEvolutionInstance, usuarioPertenceAEmpresa } = require('../db/empresas')
const { findUsuarioById } = require('../db/usuarios')
const { logger } = require('../logger')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

// Extrai Bearer token do header Authorization
function extractToken(req) {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
  return null
}

// Valida JWT e popula req.usuario. Retorna 401 se ausente ou inválido.
async function requireAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token ausente.' } })

  try {
    const payload = verifyJwt(token)
    const usuario = await findUsuarioById(payload.sub)
    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Usuário inativo ou não encontrado.' } })
    }
    req.usuario = usuario
    next()
  } catch {
    return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' } })
  }
}

// Lê empresa_id do parâmetro de rota (:empresaId) e verifica acesso.
// Popula req.empresa. Deve ser usado após requireAuth.
async function requireEmpresaAccess(req, res, next) {
  const empresaId = req.params.empresaId || req.body?.empresa_id || req.query?.empresa_id
  if (!empresaId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'empresa_id ausente.' } })
  }

  const empresa = await findEmpresaById(empresaId)
  if (!empresa) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Empresa não encontrada.' } })
  }

  // superadmin tem acesso a tudo
  if (req.usuario.role !== 'superadmin') {
    const temAcesso = await usuarioPertenceAEmpresa(req.usuario.id, empresa.id)
    if (!temAcesso) {
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Acesso negado a esta empresa.' } })
    }
  }

  req.empresa = empresa
  next()
}

// Resolve empresa a partir da evolution_instance no corpo do webhook.
// Não bloqueia — apenas popula req.empresaId com fallback para PJ Codeworks.
async function resolveEmpresaFromWebhook(req, _res, next) {
  const instanceName =
    req.body?.instance ||
    req.body?.sender ||
    req.headers['x-evolution-instance'] ||
    null
  req.evolutionInstance = instanceName || null

  if (!instanceName) {
    req.empresaId = PJ_EMPRESA_ID
    return next()
  }

  try {
    const empresa = await findEmpresaByEvolutionInstance(instanceName)
    if (empresa) {
      req.empresaId = empresa.id
    } else {
      logger.warn({ instance: instanceName }, 'Webhook: instance sem empresa mapeada — usando empresa padrão do sistema.')
      req.empresaId = PJ_EMPRESA_ID
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Erro ao resolver empresa do webhook — usando fallback.')
    req.empresaId = PJ_EMPRESA_ID
  }

  next()
}

// Exige que req.usuario.role esteja entre os papéis permitidos.
// superadmin sempre passa. Deve rodar após requireAuth.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !req.usuario.role) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } })
    }
    if (req.usuario.role === 'superadmin' || roles.includes(req.usuario.role)) {
      return next()
    }
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Acesso restrito.' } })
  }
}

module.exports = { requireAuth, requireEmpresaAccess, resolveEmpresaFromWebhook, requireRole }
