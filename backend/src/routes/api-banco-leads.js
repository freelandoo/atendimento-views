'use strict'
// Banco de Leads — visão UNIFICADA do funil (Google Places + Instagram/LinkedIn),
// agrupada nos 3 estágios que o operador acompanha:
//   sem_contato → ainda não conversou (coletado/contato_encontrado/aguardando/aprovado)
//   conversou   → já houve diálogo (enviado/respondeu)
//   fecharam    → negócio fechado (status 'fechado', marcado MANUALMENTE — migration 013)
// Leads descartados (rejeitado/nao_contatar) ficam fora destas abas de propósito.
//
// Reaproveita prospectador.prospects (mesma tabela das duas origens). Read-only +
// duas transições manuais de status (fechar/reabrir) e export CSV. Isolado por tenant.
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { logger } = require('../logger')

const router = Router({ mergeParams: true })

// Estágios expostos como abas. A ordem aqui é a ordem do funil.
const ABAS = {
  sem_contato: ['coletado', 'contato_encontrado', 'aguardando', 'aprovado'],
  conversou: ['enviado', 'respondeu'],
  fecharam: ['fechado'],
}
const ORIGENS_VALIDAS = new Set(['manual', 'automatico', 'instagram', 'linkedin'])

function envelopeErro(res, err, code) {
  const status = err.statusCode || 500
  logger.error(`[api-banco-leads] ${code}:`, err.message)
  return res.status(status).json({ ok: false, error: { code, message: err.message } })
}

// Monta WHERE + params comuns à listagem e ao export (mesmos filtros).
function montarFiltro(empresaId, query) {
  const params = [empresaId]
  const where = [`empresa_id = $1`]

  const aba = String(query.aba || '').toLowerCase()
  if (ABAS[aba]) {
    params.push(ABAS[aba])
    where.push(`status = ANY($${params.length})`)
  } else {
    // Sem aba válida: mostra o funil inteiro (exclui descartados).
    params.push([...ABAS.sem_contato, ...ABAS.conversou, ...ABAS.fecharam])
    where.push(`status = ANY($${params.length})`)
  }

  const origem = String(query.origem || '').toLowerCase()
  if (ORIGENS_VALIDAS.has(origem)) {
    params.push(origem)
    where.push(`origem = $${params.length}`)
  } else if (origem === 'places') {
    where.push(`origem IN ('manual','automatico')`)
  } else if (origem === 'social') {
    where.push(`origem IN ('instagram','linkedin')`)
  }

  const busca = String(query.busca || '').trim().slice(0, 160)
  if (busca) {
    params.push(`%${busca}%`)
    const i = params.length
    where.push(`(nome ILIKE $${i} OR telefone ILIKE $${i} OR email ILIKE $${i} OR instagram_handle ILIKE $${i})`)
  }
  return { where: where.join(' AND '), params }
}

const COLUNAS = `id, origem, status, nome, telefone, email, instagram_handle,
  nicho, cidade, site, seguidores, categoria_perfil, created_at, updated_at`

// GET /leads?aba=sem_contato|conversou|fecharam&origem=&busca=
router.get('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000)
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM prospectador.prospects
        WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params
    )
    return res.json({ ok: true, data: rows, meta: { total: rows.length } })
  } catch (err) { return envelopeErro(res, err, 'LEADS_FAILED') }
})

// GET /resumo — contagem por aba (para os badges das abas).
router.get('/resumo', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS total
         FROM prospectador.prospects WHERE empresa_id = $1 GROUP BY status`,
      [req.empresa.id]
    )
    const porStatus = Object.fromEntries(rows.map((r) => [r.status, r.total]))
    const abas = Object.fromEntries(
      Object.entries(ABAS).map(([aba, sts]) => [aba, sts.reduce((s, st) => s + (porStatus[st] || 0), 0)])
    )
    return res.json({ ok: true, data: { abas, por_status: porStatus } })
  } catch (err) { return envelopeErro(res, err, 'RESUMO_FAILED') }
})

// POST /leads/:id/fechar — marca o lead como fechado (botão manual).
router.post('/leads/:id/fechar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects SET status = 'fechado', updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND status <> 'fechado'
        RETURNING id, status`,
      [req.empresa.id, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead não encontrado ou já fechado.' } })
    return res.json({ ok: true, data: rows[0] })
  } catch (err) { return envelopeErro(res, err, 'FECHAR_FAILED') }
})

// POST /leads/:id/reabrir — desfaz o fechamento (volta para 'respondeu').
router.post('/leads/:id/reabrir', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE prospectador.prospects SET status = 'respondeu', updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND status = 'fechado'
        RETURNING id, status`,
      [req.empresa.id, req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ ok: false, error: { code: 'LEAD_NAO_ENCONTRADO', message: 'Lead fechado não encontrado.' } })
    return res.json({ ok: true, data: rows[0] })
  } catch (err) { return envelopeErro(res, err, 'REABRIR_FAILED') }
})

// Escapa um campo para CSV pt-BR (separador ';'). Aspas duplicadas; quebra protegida.
function csvCampo(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /export.csv?aba=&origem=&busca= — baixa a aba atual em CSV (Excel pt-BR).
router.get('/export.csv', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    const { rows } = await pool.query(
      `SELECT origem, status, nome, telefone, email, instagram_handle,
              nicho, cidade, site, seguidores, created_at, updated_at
         FROM prospectador.prospects
        WHERE ${where} ORDER BY updated_at DESC LIMIT 5000`,
      params
    )
    const cabecalho = ['Origem', 'Status', 'Nome', 'Telefone', 'Email', 'Instagram',
      'Nicho', 'Cidade', 'Site', 'Seguidores', 'Criado em', 'Atualizado em']
    const linhas = rows.map((r) => [
      r.origem, r.status, r.nome, r.telefone, r.email, r.instagram_handle,
      r.nicho, r.cidade, r.site, r.seguidores,
      r.created_at && new Date(r.created_at).toISOString(),
      r.updated_at && new Date(r.updated_at).toISOString(),
    ].map(csvCampo).join(';'))
    // BOM (﻿) faz o Excel reconhecer UTF-8 e mostrar acentos corretamente.
    const csv = '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n')
    const aba = ABAS[String(req.query.aba || '').toLowerCase()] ? String(req.query.aba).toLowerCase() : 'leads'
    const nomeArquivo = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`)
    return res.send(csv)
  } catch (err) { return envelopeErro(res, err, 'EXPORT_FAILED') }
})

module.exports = router
