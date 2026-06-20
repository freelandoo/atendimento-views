'use strict'

const { normalizarData } = require('./prospecting-daily-queue')

function normalizarPeriodo(input = {}) {
  const fim = normalizarData(input.fim || input.data_fim || new Date())
  const inicioRaw = input.inicio || input.data_inicio
  if (inicioRaw) return { inicio: normalizarData(inicioRaw), fim }
  const d = new Date(`${fim}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 29)
  return { inicio: d.toISOString().slice(0, 10), fim }
}

function numero(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function taxa(respostas, enviados) {
  const e = numero(enviados)
  if (!e) return 0
  return Number((numero(respostas) / e).toFixed(4))
}

function normalizarTexto(v, max = 160) {
  const texto = String(v == null ? '' : v).trim()
  return texto ? texto.slice(0, max) : ''
}

function montarFiltrosWhere(filtros = {}) {
  const periodo = normalizarPeriodo(filtros)
  const params = [periodo.inicio, periodo.fim]
  const where = [
    `COALESCE(f.slot_envio::date, f.criado_em::date) >= $1::date`,
    `COALESCE(f.slot_envio::date, f.criado_em::date) <= $2::date`,
  ]

  // Isolamento por tenant: quando informado, restringe a análise à fila DESTA empresa.
  const empresaId = filtros.empresaId || filtros.empresa_id
  if (empresaId) {
    params.push(empresaId)
    where.push(`f.empresa_id = $${params.length}`)
  }

  const categoria = normalizarTexto(filtros.categoria || filtros.tag)
  if (categoria) {
    params.push(`%${categoria}%`)
    where.push(`COALESCE(f.categoria, p.nicho, '') ILIKE $${params.length}`)
  }

  const cidade = normalizarTexto(filtros.cidade)
  if (cidade) {
    params.push(`%${cidade}%`)
    where.push(`COALESCE(f.cidade, p.cidade, '') ILIKE $${params.length}`)
  }

  const estado = normalizarTexto(filtros.estado || filtros.uf, 2).toUpperCase()
  if (estado) {
    params.push(estado)
    where.push(`UPPER(COALESCE(f.estado, '')) = $${params.length}`)
  }

  const modo = normalizarTexto(filtros.modo || filtros.modo_usado)
  if (modo) {
    params.push(modo)
    where.push(`e.modo = $${params.length}`)
  }

  const status = normalizarTexto(filtros.status || filtros.funil)
  if (status) {
    params.push(status)
    where.push(`(f.status = $${params.length} OR c.estagio = $${params.length})`)
  }

  return { periodo, params, whereSql: where.join(' AND ') }
}

function baseSql(whereSql) {
  return `
    FROM prospectador.prospeccao_fila_diaria f
    LEFT JOIN prospectador.prospeccao_execucoes_diarias e ON e.id = f.execucao_id
    LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
    LEFT JOIN vendas.conversas c
      ON regexp_replace(c.numero, '\\D', '', 'g') = f.telefone_normalizado
      OR regexp_replace(c.numero, '\\D', '', 'g') LIKE '%' || RIGHT(f.telefone_normalizado, 11)
    WHERE ${whereSql}
  `
}

async function ranking(pool, filtrosBase, dimensaoSql, label) {
  const { rows } = await pool.query(
    `
    SELECT ${dimensaoSql} AS chave,
           COUNT(*)::int AS total_itens,
           COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS mensagens_enviadas,
           COUNT(*) FILTER (WHERE f.status = 'falhou')::int AS falhas,
           COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS respostas,
           COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('diagnostico', 'qualificacao'))::int AS diagnostico,
           COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('proposta', 'proposta_enviada', 'negociacao'))::int AS proposta,
           COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('handoff', 'reuniao_agendada', 'proposta_enviada', 'negociacao'))::int AS reunioes,
           COUNT(DISTINCT c.numero) FILTER (WHERE c.venda_fechada = true)::int AS fechados
    ${baseSql(filtrosBase.whereSql)}
    GROUP BY ${dimensaoSql}
    ORDER BY respostas DESC, reunioes DESC, mensagens_enviadas DESC, total_itens DESC
    LIMIT 12
    `,
    filtrosBase.params
  )
  return rows.map((r) => ({
    dimensao: label,
    chave: r.chave || 'sem_dado',
    total_itens: numero(r.total_itens),
    mensagens_enviadas: numero(r.mensagens_enviadas),
    falhas: numero(r.falhas),
    respostas: numero(r.respostas),
    taxa_resposta: taxa(r.respostas, r.mensagens_enviadas),
    diagnostico: numero(r.diagnostico),
    proposta: numero(r.proposta),
    reunioes: numero(r.reunioes),
    fechados: numero(r.fechados),
  }))
}

async function obterDashboardEstrategicoProspeccao(pool, filtros = {}) {
  const filtrosBase = montarFiltrosWhere(filtros)
  const custoTotal = filtros.custo_total != null && filtros.custo_total !== ''
    ? Math.max(0, numero(filtros.custo_total, 0))
    : null

  const [totaisResult, serieResult, categorias, cidades, modos, horarios] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*)::int AS total_itens,
        COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS mensagens_enviadas,
        COUNT(*) FILTER (WHERE f.status = 'falhou')::int AS falhas,
        COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS respostas,
        COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('diagnostico', 'qualificacao'))::int AS diagnostico,
        COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('proposta', 'proposta_enviada', 'negociacao'))::int AS proposta,
        COUNT(DISTINCT c.numero) FILTER (WHERE c.estagio IN ('handoff', 'reuniao_agendada', 'proposta_enviada', 'negociacao'))::int AS reunioes,
        COUNT(DISTINCT c.numero) FILTER (WHERE c.venda_fechada = true)::int AS fechados
      ${baseSql(filtrosBase.whereSql)}
      `,
      filtrosBase.params
    ),
    // Série diária para o gráfico de crescimento (mesma base/contagem dos totais).
    pool.query(
      `
      SELECT COALESCE(f.slot_envio::date, f.criado_em::date) AS dia,
        COUNT(*) FILTER (WHERE f.status IN ('enviado', 'respondido'))::int AS enviados,
        COUNT(*) FILTER (WHERE f.status = 'respondido')::int AS respostas,
        COUNT(*) FILTER (WHERE f.status = 'falhou')::int AS falhas
      ${baseSql(filtrosBase.whereSql)}
      GROUP BY 1
      ORDER BY 1
      `,
      filtrosBase.params
    ),
    ranking(pool, filtrosBase, `COALESCE(f.categoria, p.nicho, 'sem_categoria')`, 'categoria'),
    ranking(pool, filtrosBase, `CONCAT_WS('/', NULLIF(COALESCE(f.cidade, p.cidade, ''), ''), NULLIF(COALESCE(f.estado, ''), ''))`, 'cidade'),
    ranking(pool, filtrosBase, `COALESCE(e.modo, 'sem_modo')`, 'modo'),
    ranking(pool, filtrosBase, `COALESCE(to_char(f.slot_envio, 'HH24:00'), 'sem_horario')`, 'horario'),
  ])

  const serieDiaria = (serieResult.rows || []).map((r) => ({
    dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia).slice(0, 10),
    enviados: numero(r.enviados),
    respostas: numero(r.respostas),
    falhas: numero(r.falhas),
  }))

  const row = totaisResult.rows[0] || {}
  const mensagensEnviadas = numero(row.mensagens_enviadas)
  const respostas = numero(row.respostas)
  const reunioes = numero(row.reunioes)
  const oportunidades = Math.max(respostas, reunioes)
  const metricas = {
    total_itens: numero(row.total_itens),
    mensagens_enviadas: mensagensEnviadas,
    falhas: numero(row.falhas),
    respostas,
    taxa_resposta: taxa(respostas, mensagensEnviadas),
    diagnostico: numero(row.diagnostico),
    proposta: numero(row.proposta),
    reunioes,
    fechados: numero(row.fechados),
    custo_total: custoTotal,
    custo_por_oportunidade: custoTotal != null && oportunidades > 0 ? Number((custoTotal / oportunidades).toFixed(2)) : null,
  }

  return {
    ok: true,
    filtros: {
      periodo: filtrosBase.periodo,
      empresa_id: filtros.empresaId || filtros.empresa_id || null,
      categoria: normalizarTexto(filtros.categoria || filtros.tag) || null,
      cidade: normalizarTexto(filtros.cidade) || null,
      estado: normalizarTexto(filtros.estado || filtros.uf, 2).toUpperCase() || null,
      modo: normalizarTexto(filtros.modo || filtros.modo_usado) || null,
      status: normalizarTexto(filtros.status || filtros.funil) || null,
    },
    metricas,
    serie_diaria: serieDiaria,
    rankings: {
      categorias,
      cidades,
      modos,
      horarios,
    },
    melhores: {
      categoria: categorias[0] || null,
      cidade: cidades[0] || null,
      modo: modos[0] || null,
      horario: horarios[0] || null,
    },
  }
}

module.exports = {
  normalizarPeriodo,
  montarFiltrosWhere,
  obterDashboardEstrategicoProspeccao,
}
