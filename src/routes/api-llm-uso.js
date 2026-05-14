'use strict'
const { Router } = require('express')
const { pool } = require('../db')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { computeCost } = require('../ai-provider')

const router = Router({ mergeParams: true })

function parseDate(s, fallback) {
  if (!s) return fallback
  const d = new Date(s)
  return isNaN(d.getTime()) ? fallback : d
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function int(v) {
  return Math.trunc(num(v))
}

function money(v) {
  return num(v).toFixed(6)
}

function effectiveCost(row) {
  const saved = row.cost_usd == null ? null : Number(row.cost_usd)
  if (Number.isFinite(saved) && saved > 0) return saved
  return computeCost(row.model, row.input_tokens, row.output_tokens) || 0
}

function makeGroup() {
  return { chamadas: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, ultima_em: null }
}

function touchGroup(group, row, cost) {
  group.chamadas += 1
  group.input_tokens += int(row.input_tokens)
  group.output_tokens += int(row.output_tokens)
  group.cost_usd += cost
  if (!group.ultima_em || new Date(row.created_at) > new Date(group.ultima_em)) group.ultima_em = row.created_at
}

function serializeGroup(extra, group) {
  return {
    ...extra,
    chamadas: group.chamadas,
    input_tokens: group.input_tokens,
    output_tokens: group.output_tokens,
    cost_usd: money(group.cost_usd),
    ...(group.ultima_em ? { ultima_em: group.ultima_em } : {}),
  }
}

// GET /api/empresas/:empresaId/llm/uso?from=&to=
router.get('/', requireAuth, requireEmpresaAccess, async (req, res) => {
  const now = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const from = parseDate(req.query.from, monthAgo)
  const to = parseDate(req.query.to, now)

  const baseWhere = `WHERE empresa_id = $1 AND created_at >= $2 AND created_at < $3`
  const args = [req.empresa.id, from, to]

  const { rows } = await pool.query(
    `SELECT id, created_at, provider, model, task, ref_type, ref_id, client_numero,
            success, input_tokens, output_tokens, cost_usd
     FROM vendas.ai_logs ${baseWhere}
     ORDER BY created_at DESC`,
    args
  )

  const contextoIds = [...new Set(rows
    .filter((r) => r.ref_type === 'contexto' && r.ref_id)
    .map((r) => String(r.ref_id)))]
  const contextoNomes = new Map()
  if (contextoIds.length) {
    const { rows: ctxRows } = await pool.query(
      `SELECT id::text AS id, nome FROM app.empresa_contextos WHERE id::text = ANY($1::text[])`,
      [contextoIds]
    )
    for (const r of ctxRows) contextoNomes.set(r.id, r.nome)
  }

  const totais = { chamadas: 0, sucesso: 0, erros: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 }
  const porTipo = new Map()
  const porCliente = new Map()
  const porContexto = new Map()
  const porModelo = new Map()

  for (const row of rows) {
    const cost = effectiveCost(row)
    totais.chamadas += 1
    if (row.success) totais.sucesso += 1
    else totais.erros += 1
    totais.input_tokens += int(row.input_tokens)
    totais.output_tokens += int(row.output_tokens)
    totais.cost_usd += cost

    const tipoKey = row.ref_type || row.task || 'outros'
    if (!porTipo.has(tipoKey)) porTipo.set(tipoKey, makeGroup())
    touchGroup(porTipo.get(tipoKey), row, cost)

    if (row.client_numero) {
      if (!porCliente.has(row.client_numero)) porCliente.set(row.client_numero, makeGroup())
      touchGroup(porCliente.get(row.client_numero), row, cost)
    }

    if (row.ref_type === 'contexto') {
      const contextoKey = row.ref_id || ''
      if (!porContexto.has(contextoKey)) porContexto.set(contextoKey, makeGroup())
      touchGroup(porContexto.get(contextoKey), row, cost)
    }

    const modeloKey = `${row.provider || ''}\u0000${row.model || ''}`
    if (!porModelo.has(modeloKey)) porModelo.set(modeloKey, makeGroup())
    touchGroup(porModelo.get(modeloKey), row, cost)
  }

  const sortByCost = (a, b) => num(b.cost_usd) - num(a.cost_usd)

  return res.json({
    ok: true,
    data: {
      filtro: { from, to },
      totais: { ...totais, cost_usd: money(totais.cost_usd) },
      por_tipo: [...porTipo.entries()]
        .map(([tipo, group]) => serializeGroup({ tipo }, group))
        .sort(sortByCost),
      por_cliente: [...porCliente.entries()]
        .map(([client_numero, group]) => serializeGroup({ client_numero }, group))
        .sort(sortByCost)
        .slice(0, 100),
      por_contexto: [...porContexto.entries()]
        .map(([contexto_id, group]) => serializeGroup({
          contexto_id,
          contexto_nome: contextoNomes.get(contexto_id) || null,
        }, group))
        .sort(sortByCost)
        .slice(0, 100),
      por_modelo: [...porModelo.entries()]
        .map(([key, group]) => {
          const [provider, model] = key.split('\u0000')
          return serializeGroup({ provider, model }, group)
        })
        .sort(sortByCost),
      recentes: rows.slice(0, 50).map((row) => ({
        ...row,
        cost_usd: money(effectiveCost(row)),
      })),
    },
  })
})

module.exports = router
