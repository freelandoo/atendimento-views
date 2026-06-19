'use strict'
// Estágios por contexto (cards): gerar (genérico), adaptar (ao contexto), salvar,
// ativar/desativar (só 1 ativo por empresa) e thumbnail. JWT por empresa.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')
const estagiosSvc = require('../services/contexto-estagios')

const router = Router({ mergeParams: true })

const THUMB_MAX_CHARS = 700_000 // ~500KB em base64

router.use(requireAuth, requireEmpresaAccess)

async function carregarContexto(req, res, next) {
  try {
    const ctx = await estagiosSvc.getContextoComEstagios(pool, req.empresa.id, req.params.contextoId)
    if (!ctx) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Contexto não encontrado.' } })
    }
    req.contexto = ctx
    next()
  } catch (err) {
    logger.error({ err: err.message }, 'api-contexto-estagios: carregarContexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro interno.' } })
  }
}

// GET .../estagios — estágios atuais + meta do card
router.get('/estagios', carregarContexto, async (req, res) => {
  const estagios = estagiosSvc.normalizarEstagios(req.contexto.estagios_json)
  return res.json({
    ok: true,
    data: {
      etapas: estagiosSvc.ETAPAS.map((e) => ({ chave: e.chave, label: e.label })),
      estagios,
      vazio: estagiosSvc.estagiosVazios(estagios),
      ativo: !!req.contexto.runtime_ativo,
      thumbnail_url: req.contexto.thumbnail_url || null,
      tem_conhecimento: !!estagiosSvc.montarConhecimentoDoContexto(req.contexto),
    },
  })
})

// POST .../estagios/gerar — gera os 6 estágios GENÉRICOS (estrutura PJ, dados neutros). Não persiste.
router.post('/estagios/gerar', carregarContexto, async (req, res) => {
  try {
    const force = req.body?.force === true
    const estagios = await estagiosSvc.gerarEstagiosGenericos({ pool, log: logger, force })
    return res.json({ ok: true, data: { estagios } })
  } catch (err) {
    logger.error({ err: err.message }, 'gerar estágios genéricos')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: 'Falha ao gerar estágios. Tente de novo.' } })
  }
})

// POST .../estagios/importar-pj — traz os estágios ATUAIS da PJ (system-*.md) como base. Não persiste.
// Usado para migrar a PJ (vira um card) ou partir da metodologia real da PJ num contexto novo.
router.post('/estagios/importar-pj', carregarContexto, async (_req, res) => {
  return res.json({ ok: true, data: { estagios: estagiosSvc.estagiosPjReferencia() } })
})

// POST .../estagios/adaptar — adapta os estágios (do body ou genéricos) ao conhecimento do contexto. Não persiste.
router.post('/estagios/adaptar', carregarContexto, async (req, res) => {
  try {
    let base = estagiosSvc.normalizarEstagios(req.body?.estagios)
    if (estagiosSvc.estagiosVazios(base)) {
      base = estagiosSvc.normalizarEstagios(req.contexto.estagios_json)
    }
    if (estagiosSvc.estagiosVazios(base)) {
      base = await estagiosSvc.gerarEstagiosGenericos({ pool, log: logger })
    }
    const conhecimento = estagiosSvc.montarConhecimentoDoContexto(req.contexto)
    if (!conhecimento.trim()) {
      return res.status(400).json({ ok: false, error: { code: 'SEM_CONHECIMENTO', message: 'Este contexto não tem conhecimento ainda. Preencha o Contexto 1 / fontes antes de adaptar.' } })
    }
    const estagios = await estagiosSvc.adaptarEstagios({
      pool, log: logger, empresaId: req.empresa.id, contextoId: req.contexto.id, estagios: base, conhecimento,
    })
    return res.json({ ok: true, data: { estagios } })
  } catch (err) {
    logger.error({ err: err.message }, 'adaptar estágios')
    return res.status(502).json({ ok: false, error: { code: 'IA_FALHOU', message: 'Falha ao adaptar estágios. Tente de novo.' } })
  }
})

// PUT .../estagios — salva os 6 estágios no contexto
router.put('/estagios', carregarContexto, async (req, res) => {
  const estagios = req.body?.estagios
  if (!estagios || typeof estagios !== 'object') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'estagios obrigatório.' } })
  }
  try {
    const saved = await estagiosSvc.salvarEstagiosNoContexto(pool, req.empresa.id, req.contexto.id, estagios)
    return res.json({ ok: true, data: { estagios: estagiosSvc.normalizarEstagios(saved.estagios_json), ativo: !!saved.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'salvar estágios')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar.' } })
  }
})

// POST .../ativar — ativa este contexto (desativa os demais da empresa)
router.post('/ativar', carregarContexto, async (req, res) => {
  const estagios = estagiosSvc.normalizarEstagios(req.contexto.estagios_json)
  if (estagiosSvc.estagiosVazios(estagios)) {
    return res.status(400).json({ ok: false, error: { code: 'SEM_ESTAGIOS', message: 'Gere e salve os estágios deste contexto antes de ativar.' } })
  }
  try {
    const ctx = await estagiosSvc.ativarContexto(pool, req.empresa.id, req.contexto.id)
    return res.json({ ok: true, data: { ativo: !!ctx.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'ativar contexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao ativar.' } })
  }
})

// POST .../desativar
router.post('/desativar', carregarContexto, async (req, res) => {
  try {
    const ctx = await estagiosSvc.desativarContexto(pool, req.empresa.id, req.contexto.id)
    return res.json({ ok: true, data: { ativo: !!ctx.ativo } })
  } catch (err) {
    logger.error({ err: err.message }, 'desativar contexto')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao desativar.' } })
  }
})

// PUT .../thumbnail — { thumbnail_url } (URL ou data URI base64)
router.put('/thumbnail', carregarContexto, async (req, res) => {
  const thumb = req.body?.thumbnail_url
  if (thumb != null && typeof thumb !== 'string') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'thumbnail_url inválido.' } })
  }
  if (typeof thumb === 'string' && thumb.length > THUMB_MAX_CHARS) {
    return res.status(400).json({ ok: false, error: { code: 'THUMB_GRANDE', message: 'Imagem muito grande (máx ~500KB).' } })
  }
  try {
    const { rows: [ctx] } = await pool.query(
      `UPDATE app.empresa_contextos SET thumbnail_url = $3, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2 RETURNING id, thumbnail_url`,
      [req.contexto.id, req.empresa.id, thumb || null]
    )
    return res.json({ ok: true, data: { thumbnail_url: ctx.thumbnail_url } })
  } catch (err) {
    logger.error({ err: err.message }, 'salvar thumbnail')
    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Erro ao salvar thumbnail.' } })
  }
})

module.exports = router
