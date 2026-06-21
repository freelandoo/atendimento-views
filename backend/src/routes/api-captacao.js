'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')
const captacao = require('../services/social-capture')
const { atualizarEmailProspect } = require('../prospecting')
const { enviarEmailProspect, emailConfigurado } = require('../services/email-outreach')

const router = Router({ mergeParams: true })

const STATUS_VALIDOS = new Set([
  'coletado', 'contato_encontrado', 'aguardando', 'aprovado', 'enviado', 'respondeu', 'rejeitado', 'nao_contatar',
])
// Estágios expostos como "abas" no funil de captação.
const ABAS = {
  coletados: ['coletado'],
  entrada: ['contato_encontrado', 'aguardando'],
  em_andamento: ['aprovado', 'enviado', 'respondeu'],
  descartados: ['rejeitado', 'nao_contatar'],
}

function envelopeErro(res, err, code) {
  const status = err.statusCode || 500
  logger.error(`[api-captacao] ${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// ── Campanhas (hashtags/termos) ───────────────────────────────────────────────
router.get('/campanhas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await captacao.listarCampanhas(req.empresa.id)
    return res.json({ ok: true, data, meta: { total: data.length } })
  } catch (err) { return envelopeErro(res, err, 'CAMPANHAS_LIST_FAILED') }
})

router.post('/campanhas', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await captacao.criarCampanha(req.empresa.id, req.body || {})
    return res.status(201).json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CAMPANHA_CREATE_FAILED') }
})

router.patch('/campanhas/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await captacao.atualizarCampanha(req.empresa.id, req.params.id, req.body || {})
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'CAMPANHA_UPDATE_FAILED') }
})

router.delete('/campanhas/:id', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    await captacao.removerCampanha(req.empresa.id, req.params.id)
    return res.json({ ok: true })
  } catch (err) { return envelopeErro(res, err, 'CAMPANHA_DELETE_FAILED') }
})

// ── Coleta ────────────────────────────────────────────────────────────────────
router.post('/coletar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const snap = await captacao.iniciarColeta(req.empresa.id, {
      campanhaId: b.campanha_id || b.campanhaId || null,
      fonte: b.fonte || 'instagram',
      nicho: b.nicho || null,
      cidade: b.cidade || null,
      perfis: b.perfis ?? b.perfis_semente ?? null,
      usar_cse: b.usar_cse,
      usar_snowball: b.usar_snowball,
      seguir_link_bio: b.seguir_link_bio,
      limite: b.limite || b.limit || null,
    })
    return res.status(202).json({ ok: true, data: snap })
  } catch (err) { return envelopeErro(res, err, 'COLETA_FAILED') }
})

// Processa snapshots pendentes sob demanda (o worker já faz isso periodicamente).
router.post('/processar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const r = await captacao.processarSnapshotsPendentes()
    return res.json({ ok: true, data: r })
  } catch (err) { return envelopeErro(res, err, 'PROCESSAR_FAILED') }
})

router.get('/orcamento', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    return res.json({ ok: true, data: await captacao.resumoOrcamento(req.empresa.id) })
  } catch (err) { return envelopeErro(res, err, 'ORCAMENTO_FAILED') }
})

router.get('/snapshots', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, campanha_id, fonte, etapa, status, termo, custo_registros, total_prospects, erro, created_at, updated_at
         FROM prospectador.captacao_snapshots
        WHERE empresa_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.empresa.id]
    )
    return res.json({ ok: true, data: rows })
  } catch (err) { return envelopeErro(res, err, 'SNAPSHOTS_FAILED') }
})

// ── Funil / leads ─────────────────────────────────────────────────────────────
// GET /leads?aba=entrada|coletados|em_andamento|descartados  &fonte=instagram
router.get('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const params = [req.empresa.id]
    const where = [`empresa_id = $1`, `origem IN ('instagram','linkedin')`]
    const fonte = String(req.query.fonte || '').toLowerCase()
    if (fonte === 'instagram' || fonte === 'linkedin') {
      params.push(fonte); where.push(`origem = $${params.length}`)
    }
    const aba = String(req.query.aba || '').toLowerCase()
    if (ABAS[aba]) {
      params.push(ABAS[aba]); where.push(`status = ANY($${params.length})`)
    } else if (req.query.status && STATUS_VALIDOS.has(String(req.query.status))) {
      params.push(String(req.query.status)); where.push(`status = $${params.length}`)
    }
    const { rows } = await pool.query(
      `SELECT id, origem, external_ref, instagram_handle, nome, telefone, email, nicho, cidade,
              bio, link_bio, categoria_perfil, seguidores, site, status, created_at, updated_at
         FROM prospectador.prospects
        WHERE ${where.join(' AND ')}
        ORDER BY updated_at DESC LIMIT 300`,
      params
    )
    return res.json({ ok: true, data: rows, meta: { total: rows.length } })
  } catch (err) { return envelopeErro(res, err, 'LEADS_FAILED') }
})

// Resumo de contagem por aba do funil.
router.get('/funil', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS total
         FROM prospectador.prospects
        WHERE empresa_id = $1 AND origem IN ('instagram','linkedin')
        GROUP BY status`,
      [req.empresa.id]
    )
    const porStatus = Object.fromEntries(rows.map((r) => [r.status, r.total]))
    const data = Object.fromEntries(
      Object.entries(ABAS).map(([aba, sts]) => [aba, sts.reduce((s, st) => s + (porStatus[st] || 0), 0)])
    )
    return res.json({ ok: true, data: { abas: data, por_status: porStatus } })
  } catch (err) { return envelopeErro(res, err, 'FUNIL_FAILED') }
})

// Atualiza status do lead (aprovar p/ disparo, descartar, não-contatar...).
router.post('/leads/:id/status', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const novo = String((req.body || {}).status || '')
    if (!STATUS_VALIDOS.has(novo)) {
      return res.status(400).json({ ok: false, error: { code: 'STATUS_INVALIDO', message: `Status inválido: ${novo}` } })
    }
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects SET status = $3, updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND origem IN ('instagram','linkedin')
        RETURNING id, status`,
      [req.empresa.id, req.params.id, novo]
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead não encontrado.' } })
    return res.json({ ok: true, data: rows[0] })
  } catch (err) { return envelopeErro(res, err, 'STATUS_UPDATE_FAILED') }
})

// PATCH /leads/:id/email  { email } — define/edita/limpa o e-mail do lead social.
router.patch('/leads/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await atualizarEmailProspect(req.empresa.id, req.params.id, (req.body || {}).email)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EMAIL_UPDATE_FAILED') }
})

// ── E-mail (Fase futura — já operável quando provider configurado) ────────────
router.get('/email/status', requireAuth, requireEmpresaAccess, async (req, res) => {
  return res.json({ ok: true, data: { configurado: emailConfigurado() } })
})

router.post('/leads/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const r = await enviarEmailProspect(req.empresa.id, req.params.id, { assunto: b.assunto, corpo: b.corpo })
    return res.json({ ok: true, data: r })
  } catch (err) { return envelopeErro(res, err, 'EMAIL_SEND_FAILED') }
})

module.exports = router
