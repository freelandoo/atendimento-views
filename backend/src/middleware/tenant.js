'use strict'
const { verifyJwt } = require('../auth')
const { findEmpresaById, findEmpresaEInstanciaPorEvolution, buscarVinculoUsuarioEmpresa } = require('../db/empresas')
const { findUsuarioById } = require('../db/usuarios')
const { logger } = require('../logger')
const { resolverTenantWebhook } = require('../services/webhook-quarentena')
const {
  PAPEL_PLATAFORMA, avaliarCapacidade, capacidadesDoVinculo,
} = require('../services/acesso-capacidades')
const { registrarUltimoAcesso } = require('../db/membros')
const { avaliarAcesso: avaliarAcessoPrograma, barra: aceiteBarra } = require('../services/programa-aceite')
const { VERSAO: TERMO_VERSAO } = require('../services/programa-termo')

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
//
// A PARTIR DA ETAPA 1 DO CRM EM EQUIPE ele também publica o PAPEL EFETIVO do usuário NESTA
// empresa — antes, o único papel que existia no request era o GLOBAL (`req.usuario.role`), e era
// ele que `requireRole` lia. Efeito medido do modelo antigo: quem era `admin` global era admin em
// TODA empresa a que pertencesse. O que o middleware passa a publicar:
//
//   - `req.empresa`         — a empresa (inalterado).
//   - `req.vinculoEmpresa`  — a linha de app.usuarios_empresas, ou null para superadmin (que não
//                             precisa de vínculo). É a FONTE do papel efetivo.
//   - `req.papelEmpresa`    — `owner | comercial`, ou null.
//   - `req.capacidades`     — lista já resolvida (papel + concessões aditivas), para a rota
//                             devolver ao front sem recalcular e sem o front conhecer a matriz.
//
// NEUTRO EM COMPORTAMENTO NESTA ETAPA: nenhuma rota lê esses campos ainda, e a decisão de acesso
// continua sendo tomada por `requireRole` exatamente como antes. A troca é a Etapa 6.
//
// O vínculo INATIVO já era barrado antes desta etapa (`usuarioPertenceAEmpresa` filtrava
// `ativo = true`) e continua sendo — `buscarVinculoUsuarioEmpresa` mantém o mesmo filtro. A
// mudança é só que agora o middleware guarda a LINHA em vez de descartar tudo menos o booleano.
//
// ─── A PARTIR DA ETAPA 1 DA OPERAÇÃO COMERCIAL, ELE TAMBÉM APLICA O ACEITE DO TERMO ──────
// O gate do aceite vive AQUI, e não nos mounts nem em `requireCapacidade`, por um motivo
// concreto: `/conversas`, `/whatsapp` e `/agenda` autorizam POR ROTA, então um gate por mount
// deixaria buracos, e uma rota nova nasceria fora dele. `requireEmpresaAccess` roda em TODO
// request com escopo de empresa — é o único ponto onde "antes do aceite, nada da empresa
// responde" é uma afirmação verdadeira em vez de uma lista que alguém precisa lembrar de manter.
//
// A ÚNICA exceção é o próprio router do aceite, que monta `requireEmpresaAccessSemAceite`. Há
// guarda de regressão (test/programa-aceite.test.js) que lê o `index.js` e FALHA se aparecer um
// segundo uso dessa variante — uma exceção nomeada e contada, nunca uma porta aberta.
//
// Quem decide é o módulo PURO `services/programa-aceite.js`; aqui só se traduz o veredito em
// HTTP. Custo de I/O: ZERO — o aceite vem no mesmo SELECT do vínculo (db/empresas.js).
async function resolverEmpresaAccess(req, res, next, { exigirAceite } = {}) {
  const empresaId = req.params.empresaId || req.body?.empresa_id || req.query?.empresa_id
  if (!empresaId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'empresa_id ausente.' } })
  }

  const empresa = await findEmpresaById(empresaId)
  if (!empresa) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Empresa não encontrada.' } })
  }

  const ehPlataforma = req.usuario.role === PAPEL_PLATAFORMA
  let vinculo = null

  // superadmin tem acesso a tudo
  if (!ehPlataforma) {
    vinculo = await buscarVinculoUsuarioEmpresa(req.usuario.id, empresa.id)
    if (!vinculo) {
      return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Acesso negado a esta empresa.' } })
    }
  }

  req.empresa = empresa
  req.vinculoEmpresa = vinculo
  req.papelEmpresa = vinculo ? vinculo.role : null
  req.capacidades = capacidadesDoVinculo({
    papel: req.papelEmpresa,
    permissoes: vinculo ? vinculo.permissoes : null,
    papelPlataforma: req.usuario.role,
  })

  // "Último acesso" POR EMPRESA (`app.usuarios_empresas.ultimo_acesso_em`).
  // `app.usuarios.ultimo_login_em` já existe, mas é GLOBAL: com uma pessoa servindo duas
  // empresas, ele não responde "quando ela trabalhou NESTA operação?" — que é o que o admin
  // precisa ver em Contas da empresa.
  //
  // Deliberadamente NÃO aguardado (`void`): é telemetria de uso, não fato de negócio, e uma
  // falha ou lentidão de escrita nunca pode atrasar nem derrubar um request autenticado. A
  // própria função só grava no máximo uma vez por hora, para não transformar toda requisição
  // autenticada numa escrita. `superadmin` sem vínculo não tem onde registrar — e não se
  // inventa um.
  if (vinculo) void registrarUltimoAcesso(vinculo.id)

  // ─── ACEITE DO TERMO DA OPERAÇÃO COMERCIAL ────────────────────────────────────────────
  // `req.aceitePrograma` é publicado SEMPRE, inclusive para quem não é sujeito do programa e
  // inclusive na variante que não exige — é o que permite ao router do aceite dizer à tela o
  // estado atual sem uma consulta própria, e ao `/me` informar a pendência.
  const veredito = avaliarAcessoPrograma({
    papel: req.papelEmpresa,
    papelPlataforma: req.usuario.role,
    aceite: vinculo && vinculo.aceite_versao
      ? { versao: vinculo.aceite_versao, em: vinculo.aceite_em }
      : null,
  }, TERMO_VERSAO)
  req.aceitePrograma = veredito

  if (exigirAceite && aceiteBarra(veredito.motivo)) {
    // 403, não 401: a sessão é válida e a pessoa existe — o que falta é um ato dela. E o código
    // é PRÓPRIO (`ACEITE_PENDENTE`), nunca o `FORBIDDEN` genérico: a tela precisa distinguir
    // "você não tem permissão" (que não se resolve sozinho) de "falta aceitar o termo" (que se
    // resolve numa tela). Log sem PII — papel e motivo são vocabulário fechado.
    logger.warn({
      papel: req.papelEmpresa, motivo: veredito.motivo, empresa_id: empresa.id,
    }, '[programa] acesso barrado: aceite pendente')
    return res.status(403).json({
      ok: false,
      error: {
        code: 'ACEITE_PENDENTE',
        message: 'Você precisa aceitar o termo da Operação Comercial para continuar.',
      },
      data: { motivo: veredito.motivo, versao_exigida: veredito.versao_exigida },
    })
  }

  next()
}

// O middleware de sempre: exige o aceite. É este que todos os mounts usam.
const requireEmpresaAccess = (req, res, next) => resolverEmpresaAccess(req, res, next, { exigirAceite: true })

// A ÚNICA exceção, e ela existe porque a tela de aceite precisa ser alcançável enquanto o resto
// está barrado — sem isso o bloqueio seria uma porta trancada sem maçaneta. Continua exigindo
// `requireAuth` e vínculo ativo com a empresa: quem não é da empresa não vê nem o termo dela.
// PROIBIDO um segundo uso (guarda de regressão em test/programa-aceite.test.js).
const requireEmpresaAccessSemAceite = (req, res, next) => resolverEmpresaAccess(req, res, next, { exigirAceite: false })

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

// Exige uma CAPACIDADE do CRM em equipe. Deve rodar DEPOIS de requireAuth + requireEmpresaAccess
// (é de lá que vêm o papel efetivo e as concessões). Quem decide é o módulo PURO
// `services/acesso-capacidades.js`; este middleware só traduz o veredito em HTTP — mesma divisão
// de `instancia-envio.js` (regra pura) e `whatsapp.js` (I/O).
//
// Diferença deliberada em relação a `requireRole`: aquele recebe PAPÉIS e é aplicado por mount de
// router; este recebe uma AÇÃO de negócio. Papel muda de nome e ganha irmãos; "disparar mensagem
// em lote pela Evolution" continua sendo a mesma decisão. Os dois convivem: `requireRole`
// continua servindo o que é genuinamente de plataforma (`/api/admin`, quarentena global).
//
// ETAPA 1: nasce SEM NENHUM CHAMADOR, de propósito. A troca dos mounts `requireRole('admin')` por
// capacidade é a Etapa 6, uma rota por commit, com teste de permissão (inclusive o caso negativo)
// antes de cada merge. Ver docs/plano-execucao-crm-equipe.md.
function requireCapacidade(...capacidades) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } })
    }
    // Sem empresa resolvida não há papel efetivo — e recusar é a única resposta honesta:
    // cair no papel global aqui reintroduziria exatamente o defeito que esta etapa corrige.
    if (!req.empresa) {
      logger.error({ rota: req.originalUrl }, '[acesso] requireCapacidade sem requireEmpresaAccess antes')
      return res.status(500).json({ ok: false, error: { code: 'ACESSO_MAL_CONFIGURADO', message: 'Não foi possível verificar o acesso.' } })
    }
    const vinculo = {
      papel: req.papelEmpresa,
      permissoes: req.vinculoEmpresa ? req.vinculoEmpresa.permissoes : null,
      papelPlataforma: req.usuario.role,
    }
    // Várias capacidades = QUALQUER uma basta (o chamador declara as alternativas que servem).
    for (const capacidade of capacidades) {
      if (avaliarCapacidade(vinculo, capacidade).permitido) return next()
    }
    // Log sem PII: papel e capacidade são vocabulário fechado; nunca e-mail, nome ou telefone.
    logger.warn({
      papel: req.papelEmpresa, capacidades, empresa_id: req.empresa.id,
    }, '[acesso] capacidade negada')
    return res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Você não tem permissão para esta ação.' } })
  }
}

module.exports = {
  requireAuth,
  requireEmpresaAccess,
  requireEmpresaAccessSemAceite,
  resolveEmpresaFromWebhook,
  requireRole,
  requireCapacidade,
}
