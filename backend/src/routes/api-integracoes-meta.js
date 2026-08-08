'use strict'

// Configurações › Integrações › Meta Conversions — HTTP.
//
// Montada em /api/empresas/:empresaId/integracoes/meta com requireAuth +
// requireRole('admin') (index.js) e requireEmpresaAccess em TODA rota. As duas
// camadas são necessárias e nenhuma é decorativa:
//   - requireRole('admin')     → só dono/admin (e superadmin) chegam aqui;
//   - requireEmpresaAccess     → e só na empresa a que estão vinculados.
// A tela também esconde o item para não-admin, mas essa checagem é conveniência:
// a autorização de verdade é esta, no backend.
//
// O TOKEN NUNCA SAI DAQUI. Nenhuma resposta deste arquivo devolve access_token, nem
// cifrado — a leitura devolve `token_hint` (4 últimos caracteres) e nada mais.

const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const integracoesDb = require('../db/meta-integracoes')
const ledger = require('../db/conversao-eventos')
const { testarConexaoMeta } = require('../services/meta-teste-conexao')
const { registrarAuditoria } = require('../db/auditoria')
const { EVENTO_META, STATUS_EVENTO } = require('../services/meta-conversao')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function falhar(res, err, code) {
  const status = err.statusCode || 500
  // Erro de servidor não vaza detalhe para o cliente: a mensagem interna pode
  // carregar contexto de configuração. 4xx é mensagem de negócio, feita para ser lida.
  if (status >= 500) {
    logger.error(`${code}:`, err.message)
    return res.status(status).json({ ok: false, error: { code, message: 'Falha ao processar a solicitação.' } })
  }
  return res.status(status).json({ ok: false, error: { code: err.code || code, message: err.message } })
}

function contexto(req) {
  return { empresaId: req.empresa.id, usuarioId: req.usuario?.id || null }
}

// Auditoria de tudo que mexe em credencial de terceiro. Best-effort (nunca quebra a ação).
function auditar(req, acao, contextoExtra = {}) {
  const { empresaId, usuarioId } = contexto(req)
  return registrarAuditoria(pool, empresaId, {
    usuarioId,
    entidadeTipo: 'integracao_meta',
    entidadeId: empresaId,
    acao,
    contexto: contextoExtra,
  })
}

// GET /  → configuração atual (sem token) + resumo de envio + mapeamento adotado.
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId } = contexto(req)
    const [integracao, resumo] = await Promise.all([
      integracoesDb.obterParaApi(pool, empresaId),
      ledger.resumoPorStatus(pool, empresaId),
    ])
    return res.json({
      ok: true,
      data: {
        // null = "não configurada" (é a ausência de linha, não um status).
        integracao,
        resumo,
        // O mapeamento adotado é DADO da resposta, não texto fixo na tela: se ele
        // mudar no backend, a ajuda contextual muda junto e não fica mentindo.
        mapeamento: EVENTO_META,
      },
    })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_LER_FALHOU')
  }
})

// PUT /  → cria ou atualiza a configuração (token no CORPO, nunca em query string).
router.put('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId, usuarioId } = contexto(req)
    const data = await integracoesDb.salvarIntegracao(pool, empresaId, req.body || {}, { usuarioId })
    // Contexto da auditoria sem segredo: só a dica do token, jamais o token.
    await auditar(req, 'integracao_meta_salva', { dataset_id: data.dataset_id, token_hint: data.token_hint })
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_SALVAR_FALHOU')
  }
})

// PATCH /eventos  → liga/desliga cada evento sem exigir reenviar o token.
router.patch('/eventos', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId } = contexto(req)
    const eventos = req.body?.eventos && typeof req.body.eventos === 'object' ? req.body.eventos : req.body
    const data = await integracoesDb.atualizarEventos(pool, empresaId, eventos || {})
    await auditar(req, 'integracao_meta_eventos', { eventos: data.eventos })
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_EVENTOS_FALHOU')
  }
})

// POST /testar  → prova a credencial e CADA evento habilitado, em modo teste.
router.post('/testar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId } = contexto(req)
    const resultado = await testarConexaoMeta(pool, empresaId)
    await auditar(req, 'integracao_meta_testada', { ok: resultado.ok })
    const integracao = await integracoesDb.obterParaApi(pool, empresaId)
    return res.json({ ok: true, data: { ...resultado, integracao } })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_TESTAR_FALHOU')
  }
})

// POST /status  { status: 'ativa' | 'desativada' }
// Ativar exige teste bem-sucedido (regra no db/meta-integracoes.js, não na tela).
router.post('/status', requireAuth, requireEmpresaAccess, async (req, res) => {
  const status = String(req.body?.status || '').trim()
  if (!['ativa', 'desativada'].includes(status)) {
    return res.status(400).json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Informe status ativa ou desativada.' },
    })
  }
  try {
    const { empresaId } = contexto(req)
    const data = await integracoesDb.definirStatus(pool, empresaId, status)
    await auditar(req, status === 'ativa' ? 'integracao_meta_ativada' : 'integracao_meta_desativada')
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_STATUS_FALHOU')
  }
})

// DELETE /  → remove a credencial. O ledger (histórico) é preservado de propósito:
// apagar a configuração não pode apagar o registro do que já foi enviado à Meta.
router.delete('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId } = contexto(req)
    const data = await integracoesDb.removerIntegracao(pool, empresaId)
    await auditar(req, 'integracao_meta_removida')
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_INTEGRACAO_REMOVER_FALHOU')
  }
})

// GET /eventos  → histórico recente DESTA empresa (telefone mascarado, sem token).
router.get('/eventos', requireAuth, requireEmpresaAccess, async (req, res) => {
  const status = String(req.query?.status || '').trim()
  if (status && !STATUS_EVENTO.includes(status)) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Status inválido.' } })
  }
  try {
    const { empresaId } = contexto(req)
    const limite = Number.parseInt(req.query?.limite, 10)
    const eventos = await ledger.listarHistorico(pool, empresaId, {
      status: status || null,
      limite: Number.isFinite(limite) ? limite : 50,
    })
    return res.json({ ok: true, data: { eventos } })
  } catch (err) {
    return falhar(res, err, 'META_EVENTOS_LISTAR_FALHOU')
  }
})

// POST /eventos/:id/reenviar  → devolve UM evento falho para a fila.
// Preserva o event_id: a Meta deduplica, então reenviar nunca dobra a conversão.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.post('/eventos/:id/reenviar', requireAuth, requireEmpresaAccess, async (req, res) => {
  // Sem esta validação, um id torto vira erro 22P02 do Postgres e sai como 500.
  if (!UUID_RE.test(String(req.params.id || ''))) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Evento inválido.' } })
  }
  try {
    const { empresaId } = contexto(req)
    const data = await ledger.reenviar(pool, empresaId, req.params.id)
    await auditar(req, 'integracao_meta_reenvio', { evento_id: req.params.id })
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_EVENTO_REENVIAR_FALHOU')
  }
})

// POST /eventos/reenviar-falhas  → devolve TODOS os falhos da empresa para a fila.
router.post('/eventos/reenviar-falhas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { empresaId } = contexto(req)
    const data = await ledger.reenviarFalhas(pool, empresaId)
    await auditar(req, 'integracao_meta_reenvio_lote', data)
    return res.json({ ok: true, data })
  } catch (err) {
    return falhar(res, err, 'META_EVENTOS_REENVIAR_FALHOU')
  }
})

module.exports = router
