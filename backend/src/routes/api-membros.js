'use strict'
// Contas da empresa — API multi-tenant. CRM em equipe, Etapa 2.
// Ver docs/plano-execucao-crm-equipe.md §4.
//
// AUTORIZAÇÃO: `requireAuth` + `requireEmpresaAccess` + `requireCapacidade(MEMBROS_GERENCIAR)`.
// **Esta é a PRIMEIRA rota do projeto a usar `requireCapacidade`** — até aqui a autorização era
// por PAPEL GLOBAL (`requireRole('admin')`), que valia dentro de qualquer empresa a que o usuário
// pertencesse. Aqui quem decide é o papel do VÍNCULO (Etapa 1).
//
// Por que não `requireRole('admin')`: gerenciar membros é decisão DA EMPRESA. Um `admin` global
// que é apenas `comercial` na empresa X não pode criar contas em X — e era exatamente isso que o
// modelo antigo permitia.
//
// NÃO EXISTE ROTA DE EXCLUSÃO, de propósito. Desativar (`ativo = false`) revoga o acesso e
// preserva o histórico; um `DELETE` no vínculo desligaria em silêncio a autoria de ligações,
// follow-ups e auditoria daquela pessoa. Mesma disciplina de "arquivar em vez de excluir" já
// adotada em Roteiros.
//
// Esta rota NÃO é `/api/admin/usuarios`. Aquela é de PLATAFORMA (superadmin, lista global de
// contas) e continua existindo — são coisas diferentes e não devem ser fundidas.

const { Router } = require('express')
const { requireAuth, requireEmpresaAccess, requireCapacidade } = require('../middleware/tenant')
const { CAPACIDADES, PAPEIS, concedeveisPara } = require('../services/acesso-capacidades')
const M = require('../db/membros')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function envelopeErro(res, err, code = 'MEMBROS_FAILED') {
  const status = err?.statusCode || 500
  // Erro de servidor não vaza mensagem interna; erro de entrada precisa ser legível para o
  // operador corrigir o formulário.
  logger.error({ err: err?.message, code }, '[api-membros] falha')
  const message = status >= 500 ? 'Não foi possível concluir a operação.' : (err?.message || 'Dados inválidos.')
  return res.status(status).json({ ok: false, error: { code: err?.code || code, message } })
}

// Todas as rotas exigem a mesma capacidade. Aplicada no router, não repetida por rota: um
// `use` é o que impede uma rota nova de nascer sem gate.
router.use(requireAuth, requireEmpresaAccess, requireCapacidade(CAPACIDADES.MEMBROS_GERENCIAR))

// GET / — membros da empresa (nunca devolve senha nem hash; ver COLS_MEMBRO em db/membros.js).
router.get('/', async (req, res) => {
  try {
    return res.json({ ok: true, data: await M.listarMembros(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'MEMBROS_LIST_FAILED') }
})

// GET /opcoes — vocabulário para a tela montar o formulário sem conhecer a matriz.
// A tela NÃO decide o que pode ser concedido: ela desenha o que a API disser. Mesmo contrato de
// `frontend/lib/site-rotulos.js` — regra no backend, tradução no front.
router.get('/opcoes', (_req, res) => {
  return res.json({
    ok: true,
    data: {
      papeis: PAPEIS.map((papel) => ({ papel, concedeveis: concedeveisPara(papel) })),
      senha_minima: M.SENHA_MIN,
    },
  })
})

// POST / — cria (ou reusa) o usuário e vincula à empresa.
router.post('/', async (req, res) => {
  try {
    const b = req.body || {}
    const data = await M.criarMembro(req.empresa.id, {
      nome: b.nome, email: b.email, senha: b.senha, role: b.role, permissoes: b.permissoes,
    }, req.usuario.id)
    return res.status(201).json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'MEMBRO_CREATE_FAILED') }
})

// PATCH /:vinculoId — papel, concessões e/ou ativo.
// O id da rota é o do VÍNCULO (app.usuarios_empresas.id), não o do usuário: é o vínculo que
// pertence a esta empresa. Usar o `usuario_id` deixaria a rota falando de uma entidade global.
router.patch('/:vinculoId', async (req, res) => {
  try {
    const b = req.body || {}
    const patch = {}
    if (b.role !== undefined) patch.role = b.role
    if (b.permissoes !== undefined) patch.permissoes = b.permissoes
    if (b.ativo !== undefined) patch.ativo = b.ativo
    const data = await M.atualizarMembro(req.empresa.id, req.params.vinculoId, patch, req.usuario.id)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'MEMBRO_UPDATE_FAILED') }
})

module.exports = router
