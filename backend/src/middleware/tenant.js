'use strict'
const { verifyJwt } = require('../auth')
const { findEmpresaById, findEmpresaEInstanciaPorEvolution, usuarioPertenceAEmpresa } = require('../db/empresas')
const { findUsuarioById } = require('../db/usuarios')
const { logger } = require('../logger')
const { resolverTenantWebhook } = require('../services/webhook-quarentena')

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

// Resolve a empresa a partir da evolution_instance no corpo do webhook.
//
// NÃO EXISTE MAIS FALLBACK PARA A PJ. Antes, os três casos em que a origem não podia ser
// provada (payload sem instância, instância não mapeada, erro de consulta) devolviam o
// `empresa_id` da PJ Codeworks, e o atendimento seguia gravando conversa, perfil de lead e
// evento comercial sob a PJ — dado de um negócio que não é a PJ, dentro do tenant da PJ.
// Medido em produção em 2026-08-08: das 6 conversas marcadas como PJ, apenas 1 era PJ.
//
// Agora esses três casos deixam `req.empresaId` NULO e publicam `req.tenantPendencia`.
// Quem decide o que fazer com isso é o webhook (`webhook-handler.js`), que barra o fluxo
// inteiro e registra a pendência em `app.webhook_quarentena`. O middleware continua sem
// bloquear a requisição — quem responde 2xx rápido ao Evolution é a rota.
//
// O que este middleware publica:
//   - `req.empresaId`        — a empresa PROVADA, ou null. Nunca uma empresa "padrão".
//   - `req.empresaOrigem`    — como a empresa foi (ou não foi) resolvida. Só `instancia`
//                              comprova; ver `services/webhook-quarentena.js`.
//   - `req.whatsappInstanciaId` — o id (uuid) de app.empresa_whatsapp_instances, o
//                              identificador confiável da instância. O NOME sozinho não
//                              serve como chave: pode ser renomeado/recriado e é texto
//                              vindo do payload.
//   - `req.tenantPendencia`  — a pendência a registrar, ou null quando há dono provado.
async function resolveEmpresaFromWebhook(req, _res, next) {
  const instanceName =
    req.body?.instance ||
    req.body?.sender ||
    req.headers['x-evolution-instance'] ||
    null

  let vinculo = null
  let erro = false
  if (instanceName) {
    try {
      vinculo = await findEmpresaEInstanciaPorEvolution(instanceName)
    } catch (err) {
      // Falha TÉCNICA é diferente de instância inexistente: a primeira é transitória e não
      // pede cadastro nenhum. Sem separar, o operador seria mandado cadastrar uma
      // instância que já está lá.
      erro = true
      logger.error({ err: err.message }, 'Erro ao resolver a empresa do webhook — mensagem vai para quarentena.')
    }
  }

  const resolucao = resolverTenantWebhook({ instanceName, vinculo, erro })
  req.evolutionInstance = resolucao.evolutionInstance
  req.empresaId = resolucao.empresaId
  req.whatsappInstanciaId = resolucao.instanciaId
  req.empresaOrigem = resolucao.origem
  req.tenantPendencia = resolucao.pendencia

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
