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
const { atualizarEmailProspect } = require('../prospecting')
const { rodarLeads } = require('../services/rodar-leads')
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
  nicho, cidade, site, seguidores, categoria_perfil, created_at, updated_at,
  bloqueado_ate, bloqueio_motivo`

// GET /leads?aba=sem_contato|conversou|fecharam&origem=&busca=
// Inclui o último disparo (quem rodou / quando) e o estado da trava (bloqueado_ate).
router.get('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { where, params } = montarFiltro(req.empresa.id, req.query)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000)
    params.push(limit)
    const { rows } = await pool.query(
      `SELECT ${COLUNAS},
         (SELECT d.criado_em FROM prospectador.lead_disparos d
            WHERE d.prospect_id = prospects.id ORDER BY d.criado_em DESC LIMIT 1) AS rodado_em,
         (SELECT COALESCE(u.nome, u.email) FROM prospectador.lead_disparos d
            LEFT JOIN app.usuarios u ON u.id = d.usuario_id
            WHERE d.prospect_id = prospects.id ORDER BY d.criado_em DESC LIMIT 1) AS rodado_por
        FROM prospectador.prospects
        WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params
    )
    return res.json({ ok: true, data: rows, meta: { total: rows.length } })
  } catch (err) { return envelopeErro(res, err, 'LEADS_FAILED') }
})

// POST /leads  { origem, nome, whatsapp, instagram } — cadastro manual de um lead.
// A origem do formulário (manual/google/instagram) mapeia para a coluna `origem`:
//   manual → 'manual' · google → 'automatico' (ambos aparecem como "Places")
//   instagram → 'instagram'. Exige nome + ao menos um contato (whatsapp ou @).
const ORIGEM_CADASTRO = { manual: 'manual', google: 'automatico', instagram: 'instagram' }
router.post('/leads', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const b = req.body || {}
    const origem = ORIGEM_CADASTRO[String(b.origem || '').toLowerCase()]
    if (!origem) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Origem inválida (use manual, google ou instagram).' } })
    }
    const nome = String(b.nome || '').trim().slice(0, 200)
    if (!nome) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe o nome do lead.' } })
    }
    const telefone = String(b.whatsapp || '').replace(/\D/g, '').slice(0, 20)
    if (telefone && telefone.length < 10) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'WhatsApp inválido — informe DDD + número.' } })
    }
    const instagram = String(b.instagram || '').trim().replace(/^@+/, '').toLowerCase().slice(0, 100)
    if (!telefone && !instagram) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Informe ao menos WhatsApp ou Instagram.' } })
    }
    // Com telefone o lead já é "rodável" (contato_encontrado); sem, fica só coletado.
    const status = telefone ? 'contato_encontrado' : 'coletado'
    const { rows } = await pool.query(
      `INSERT INTO prospectador.prospects
         (empresa_id, origem, nome, telefone, instagram_handle, status, raw_json)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7::jsonb)
       RETURNING ${COLUNAS}`,
      [req.empresa.id, origem, nome, telefone, instagram, status, JSON.stringify({ fonte: 'cadastro_manual' })]
    )
    return res.status(201).json({ ok: true, data: { ...rows[0], rodado_em: null, rodado_por: null } })
  } catch (err) { return envelopeErro(res, err, 'LEAD_CREATE_FAILED') }
})

// GET /meus-disparos — histórico de "quanto rodou" do usuário logado nesta empresa.
// Resumo (total/hoje/semana/enviados/falhou) + contagem por dia (14d) + últimos disparos.
router.get('/meus-disparos', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const usuarioId = req.usuario?.id
    if (!usuarioId) return res.json({ ok: true, data: { resumo: {}, por_dia: [], recentes: [] } })
    const args = [req.empresa.id, usuarioId]

    const resumoQ = pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE criado_em::date = NOW()::date)::int AS hoje,
         COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::int AS semana,
         COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviados,
         COUNT(*) FILTER (WHERE status = 'falhou')::int AS falhou
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2`, args)

    const porDiaQ = pool.query(
      `SELECT to_char(criado_em::date, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS total
         FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND usuario_id = $2 AND criado_em >= NOW() - INTERVAL '14 days'
        GROUP BY criado_em::date ORDER BY criado_em::date DESC`, args)

    const recentesQ = pool.query(
      `SELECT d.id, d.status, d.evolution_instance, d.criado_em, p.nome AS prospect_nome
         FROM prospectador.lead_disparos d
         LEFT JOIN prospectador.prospects p ON p.id = d.prospect_id
        WHERE d.empresa_id = $1 AND d.usuario_id = $2
        ORDER BY d.criado_em DESC LIMIT 50`, args)

    const [resumo, porDia, recentes] = await Promise.all([resumoQ, porDiaQ, recentesQ])
    return res.json({ ok: true, data: {
      resumo: resumo.rows[0] || { total: 0, hoje: 0, semana: 0, enviados: 0, falhou: 0 },
      por_dia: porDia.rows,
      recentes: recentes.rows,
    } })
  } catch (err) { return envelopeErro(res, err, 'MEUS_DISPAROS_FAILED') }
})

// POST /rodar  { instancia_id, prospect_ids: [..] } — dispara a saudação (1ª mensagem)
// pelos números selecionados via a instância escolhida. Throttle no serviço.
router.post('/rodar', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const { instancia_id, prospect_ids } = req.body || {}
    if (!instancia_id) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Escolha uma instância.' } })
    }
    const resumo = await rodarLeads(pool, {
      empresaId: req.empresa.id,
      usuarioId: req.usuario?.id || null,
      instanciaId: instancia_id,
      prospectIds: Array.isArray(prospect_ids) ? prospect_ids : [],
    })
    return res.json({ ok: true, data: resumo })
  } catch (err) {
    const status = err.statusCode || 500
    if (status >= 500) logger.error('[api-banco-leads] RODAR_FAILED:', err.message)
    return res.status(status).json({ ok: false, error: { code: 'RODAR_FAILED', message: err.message } })
  }
})

// POST /limpar — apaga os leads SEM contato (sem email E sem telefone).
// Protege negócios fechados (status 'fechado' nunca é removido). Irreversível.
router.post('/limpar', requireAuth, requireEmpresaAccess, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cond = `empresa_id = $1
      AND NULLIF(BTRIM(COALESCE(email, '')), '') IS NULL
      AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NULL
      AND status <> 'fechado'`
    // Limpa disparos órfãos desses leads (caso existam) antes de removê-los.
    await client.query(
      `DELETE FROM prospectador.lead_disparos
        WHERE empresa_id = $1 AND prospect_id IN (
          SELECT id FROM prospectador.prospects WHERE ${cond})`,
      [req.empresa.id]
    )
    const del = await client.query(
      `DELETE FROM prospectador.prospects WHERE ${cond} RETURNING id`,
      [req.empresa.id]
    )
    await client.query('COMMIT')
    return res.json({ ok: true, data: { removidos: del.rowCount } })
  } catch (err) {
    await client.query('ROLLBACK')
    return envelopeErro(res, err, 'LIMPAR_FAILED')
  } finally {
    client.release()
  }
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

// PATCH /leads/:id/email  { email } — define/edita/limpa o e-mail do lead.
router.patch('/leads/:id/email', requireAuth, requireEmpresaAccess, async (req, res) => {
  try {
    const data = await atualizarEmailProspect(req.empresa.id, req.params.id, (req.body || {}).email)
    return res.json({ ok: true, data })
  } catch (err) { return envelopeErro(res, err, 'EMAIL_UPDATE_FAILED') }
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
