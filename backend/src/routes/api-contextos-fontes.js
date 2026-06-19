'use strict'
const { Router } = require('express')
const multer = require('multer')

const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')
const {
  importarLinkEmpresa,
  importarDocumentoEmpresa,
  importarTextoManual,
  analisarFonteComIA,
  sugerirContexto1APartirDasFontes,
} = require('../services/knowledge-ingestion')

const router = Router({ mergeParams: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'text/plain', 'application/octet-stream'].includes(file.mimetype)
      || /\.(pdf|txt)$/i.test(file.originalname || '')
    if (!ok) return cb(new Error('Tipo de arquivo não suportado. Aceitamos PDF e TXT.'))
    cb(null, true)
  },
})

function paramsCtx(req) {
  return { empresaId: req.empresa.id, contextoId: req.params.contextoId }
}

// ─── Listar ──────────────────────────────────────────────────────────────────
// GET /api/empresas/:empresaId/contextos/:contextoId/fontes
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { empresaId, contextoId } = paramsCtx(req)
  const { rows } = await pool.query(
    `SELECT id, tipo, url, filename, titulo, status, erro,
            CASE WHEN length(conteudo_extraido) > 0 THEN true ELSE false END AS tem_conteudo,
            length(conteudo_extraido) AS conteudo_chars,
            resumo_json, created_at, updated_at
       FROM app.empresa_fontes_conhecimento
      WHERE empresa_id = $1 AND contexto_id = $2
      ORDER BY created_at DESC`,
    [empresaId, contextoId]
  )
  return res.json({ ok: true, data: rows })
})

// ─── POST link ───────────────────────────────────────────────────────────────
router.post('/link', requireAuth, requireEmpresaAccess, async (req, res) => {
  req.setTimeout(180000)
  res.setTimeout(180000)
  const { url } = req.body || {}
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'url obrigatória.' } })
  }
  try {
    const fonte = await importarLinkEmpresa(pool, logger, { ...paramsCtx(req), url })
    return res.status(201).json({ ok: true, data: fonte })
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: 'INGEST_FAILED', message: err.message } })
  }
})

// ─── POST documento (multipart) ──────────────────────────────────────────────
router.post('/documento', requireAuth, requireEmpresaAccess, upload.single('arquivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Arquivo obrigatório (campo "arquivo").' } })
  }
  try {
    const fonte = await importarDocumentoEmpresa(pool, logger, {
      ...paramsCtx(req),
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    })
    return res.status(201).json({ ok: true, data: fonte })
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: 'INGEST_FAILED', message: err.message } })
  }
})

// ─── POST texto manual ───────────────────────────────────────────────────────
router.post('/texto', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { texto, titulo } = req.body || {}
  if (!texto || typeof texto !== 'string' || texto.trim().length < 10) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'texto obrigatório (mín 10 chars).' } })
  }
  const fonte = await importarTextoManual(pool, logger, { ...paramsCtx(req), texto, titulo })
  return res.status(201).json({ ok: true, data: fonte })
})

// ─── POST analisar fonte ─────────────────────────────────────────────────────
router.post('/:fonteId/analisar', requireAuth, requireEmpresaAccess, async (req, res) => {
  req.setTimeout(150000)
  res.setTimeout(150000)
  try {
    const fonte = await analisarFonteComIA(pool, logger, {
      empresaId: req.empresa.id,
      fonteId: req.params.fonteId,
    })
    return res.json({ ok: true, data: fonte })
  } catch (err) {
    return res.status(502).json({ ok: false, error: { code: 'AI_ERROR', message: err.message } })
  }
})

// ─── DELETE fonte ────────────────────────────────────────────────────────────
router.delete('/:fonteId', requireAuth, requireEmpresaAccess, async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM app.empresa_fontes_conhecimento
      WHERE id = $1 AND empresa_id = $2 AND contexto_id = $3`,
    [req.params.fonteId, req.empresa.id, req.params.contextoId]
  )
  if (!rowCount) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fonte não encontrada.' } })
  return res.json({ ok: true, data: { id: req.params.fonteId, deleted: true } })
})

module.exports = router

// ─── Sub-router para sugestão de Contexto 1 ─ ────────────────────────────────
// (mount em /api/empresas/:empresaId/contextos/:contextoId/sugerir-contexto1)
const sugerirRouter = Router({ mergeParams: true })

sugerirRouter.post('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  req.setTimeout(180000)
  res.setTimeout(180000)
  try {
    const r = await sugerirContexto1APartirDasFontes(pool, logger, paramsCtx(req))
    return res.json({ ok: true, data: r })
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'sugerir-contexto1 falhou')
    return res.status(502).json({ ok: false, error: { code: 'AI_ERROR', message: err.message } })
  }
})

module.exports.sugerirRouter = sugerirRouter
