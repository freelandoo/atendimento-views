'use strict'
// Roteiros humanos versionados (modulo Prospeccao & Inteligencia Comercial). API
// multi-tenant, admin-only (mount em index.js aplica requireAuth + requireRole('admin')).
// Cada rota reforca requireEmpresaAccess; toda operacao passa req.empresa.id ao db,
// que filtra empresa_id (isolamento). Regra de imutabilidade fica no db (src/db/roteiros.js).
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const R = require('../db/roteiros')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

function erro(res, err, code = 'ROTEIRO_FAILED', status = err?.statusCode || 500) {
  logger.error({ err: err?.message, code }, '[api-roteiros] falha')
  const message = status >= 500 ? 'Nao foi possivel concluir a operacao de roteiro.' : (err?.message || 'Dados invalidos.')
  return res.status(status).json({ ok: false, error: { code, message } })
}

function idParam(res, value, nome) {
  const v = String(value || '').trim()
  if (!v) { res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: `${nome} e obrigatorio.` } }); return null }
  return v
}

// --- ROTEIROS ---------------------------------------------------------------------
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await R.listarRoteiros(pool, req.empresa.id)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIROS_LIST_FAILED') }
})

// POST / — cria roteiro + versao 1 (rascunho). { nome, descricao?, nicho? }
router.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const data = await R.criarRoteiro(pool, req.empresa.id, {
      nome: b.nome, descricao: b.descricao, nicho: b.nicho, criadoPor: req.usuario?.id,
    })
    return res.status(201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIRO_CREATE_FAILED') }
})

router.get('/:roteiroId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const roteiroId = idParam(res, req.params.roteiroId, 'roteiroId'); if (!roteiroId) return
    const data = await R.obterRoteiro(pool, req.empresa.id, roteiroId)
    if (!data) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Roteiro nao encontrado.' } })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIRO_GET_FAILED') }
})

// POST /:roteiroId/arquivar e /desarquivar — ciclo de vida do ROTEIRO (nao da versao).
// Reversivel e nao destrutivo: nada e' apagado. NAO existe DELETE de roteiro neste modulo,
// de proposito — as FKs de historico (app.ligacoes, ligacao_etapas/sinais/objecoes/perguntas
// e campanhas.roteiro_versao_id) sao ON DELETE SET NULL, entao um DELETE nao seria barrado
// pelo banco: ele desligaria em silencio as ligacoes ja realizadas do roteiro que as gerou.
// Arquivar e' a operacao segura equivalente. Nao reintroduza exclusao aqui.
router.post('/:roteiroId/arquivar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const roteiroId = idParam(res, req.params.roteiroId, 'roteiroId'); if (!roteiroId) return
    const data = await R.definirArquivamentoRoteiro(pool, req.empresa.id, roteiroId, true)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIRO_ARQUIVAR_FAILED') }
})

router.post('/:roteiroId/desarquivar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const roteiroId = idParam(res, req.params.roteiroId, 'roteiroId'); if (!roteiroId) return
    const data = await R.definirArquivamentoRoteiro(pool, req.empresa.id, roteiroId, false)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIRO_DESARQUIVAR_FAILED') }
})

// POST /:roteiroId/versoes — nova versao (rascunho); { basear_em_versao_id? } copia etapas.
router.post('/:roteiroId/versoes', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const roteiroId = idParam(res, req.params.roteiroId, 'roteiroId'); if (!roteiroId) return
    const data = await R.criarNovaVersao(pool, req.empresa.id, roteiroId, {
      basearEmVersaoId: req.body?.basear_em_versao_id || null, criadoPor: req.usuario?.id,
    })
    return res.status(201).json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ROTEIRO_NOVA_VERSAO_FAILED') }
})

// --- VERSOES ----------------------------------------------------------------------
router.get('/versoes/:versaoId', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const versaoId = idParam(res, req.params.versaoId, 'versaoId'); if (!versaoId) return
    const data = await R.obterVersaoComEtapas(pool, req.empresa.id, versaoId)
    if (!data) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Versao nao encontrada.' } })
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'VERSAO_GET_FAILED') }
})

// PUT /versoes/:versaoId/etapas — substitui as etapas (so em rascunho). { etapas: [...] }
router.put('/versoes/:versaoId/etapas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const versaoId = idParam(res, req.params.versaoId, 'versaoId'); if (!versaoId) return
    const data = await R.salvarEtapas(pool, req.empresa.id, versaoId, req.body?.etapas)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'ETAPAS_SAVE_FAILED') }
})

router.post('/versoes/:versaoId/publicar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const versaoId = idParam(res, req.params.versaoId, 'versaoId'); if (!versaoId) return
    const data = await R.publicarVersao(pool, req.empresa.id, versaoId)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'VERSAO_PUBLICAR_FAILED') }
})

router.post('/versoes/:versaoId/arquivar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const versaoId = idParam(res, req.params.versaoId, 'versaoId'); if (!versaoId) return
    const data = await R.arquivarVersao(pool, req.empresa.id, versaoId)
    return res.json({ ok: true, data })
  } catch (err) { return erro(res, err, 'VERSAO_ARQUIVAR_FAILED') }
})

module.exports = router
