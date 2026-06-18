'use strict'

const { obterConfiguracaoProspeccao } = require('./prospecting-settings')
const { gerarSlotsEnvio } = require('./prospecting-scheduler')
const { canProspectLead, normalizarNumeroProspeccao } = require('./prospecting-eligibility')

function normalizarData(data) {
  if (data instanceof Date && !Number.isNaN(data.valueOf())) return data.toISOString().slice(0, 10)
  const texto = String(data || '').trim()
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  return new Date().toISOString().slice(0, 10)
}

function textoOuNull(valor, max = 180) {
  const texto = String(valor == null ? '' : valor).trim()
  return texto ? texto.slice(0, max) : null
}

function normalizarCandidato(c = {}) {
  const prospectId = textoOuNull(c.prospect_id || c.prospectId || c.id, 80)
  const telefone = c.telefone || c.phone || c.numero || c.whatsapp || ''
  return {
    prospect_id: prospectId,
    telefone,
    telefone_normalizado: normalizarNumeroProspeccao(telefone),
    nome_lead: textoOuNull(c.nome || c.nome_lead || c.name || c.empresa || 'Lead', 180),
    categoria: textoOuNull(c.categoria || c.nicho || c.tag, 160),
    cidade: textoOuNull(c.cidade || c.city, 120),
    estado: textoOuNull(c.estado || c.uf || c.state, 2),
    metadata_json: c.metadata_json && typeof c.metadata_json === 'object' ? c.metadata_json : {},
  }
}

function normalizarLimite(valor, fallback = 80, max = 500) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, 1), max)
}

function normalizarOffset(valor) {
  const n = Number.parseInt(valor, 10)
  if (!Number.isFinite(n)) return 0
  return Math.max(n, 0)
}

async function buscarCandidatosProspeccao(pool, filtros = {}) {
  const limite = Math.min(Math.max(Number.parseInt(filtros.limit || filtros.limite || 120, 10) || 120, 1), 500)
  const params = [limite]
  const where = [
    "p.telefone IS NOT NULL",
    "p.status IN ('aguardando', 'aprovado')",
  ]
  if (filtros.categoria) {
    params.push(`%${String(filtros.categoria).trim()}%`)
    where.push(`p.nicho ILIKE $${params.length}`)
  }
  if (filtros.cidade) {
    params.push(`%${String(filtros.cidade).trim()}%`)
    where.push(`p.cidade ILIKE $${params.length}`)
  }
  const { rows } = await pool.query(
    `
    SELECT id, nome, telefone, nicho, cidade, raw_json
    FROM prospectador.prospects p
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(score_v2, score, 0) DESC, updated_at DESC
    LIMIT $1
    `,
    params
  )
  return rows.map((r) => normalizarCandidato({
    prospect_id: r.id,
    telefone: r.telefone,
    nome: r.nome,
    categoria: r.nicho,
    cidade: r.cidade,
    metadata_json: r.raw_json || {},
  }))
}

async function listarExecucoesDiarias(pool, filtros = {}) {
  const limit = normalizarLimite(filtros.limit || filtros.limite, 20, 100)
  const offset = normalizarOffset(filtros.offset)
  const params = [limit, offset]
  const where = []

  if (filtros.data_execucao || filtros.data) {
    params.push(normalizarData(filtros.data_execucao || filtros.data))
    where.push(`data_execucao = $${params.length}::date`)
  }
  if (filtros.status) {
    params.push(String(filtros.status).trim())
    where.push(`status = $${params.length}`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await pool.query(
    `
    SELECT *,
           COUNT(*) OVER()::int AS total_count
    FROM prospectador.prospeccao_execucoes_diarias
    ${whereSql}
    ORDER BY data_execucao DESC, criado_em DESC
    LIMIT $1 OFFSET $2
    `,
    params
  )

  const total = rows[0]?.total_count || 0
  return { ok: true, total, items: rows.map(({ total_count, ...row }) => row) }
}

async function buscarExecucaoParaPainel(pool, filtros = {}) {
  if (filtros.execucao_id || filtros.execucaoId) {
    const { rows } = await pool.query(
      `SELECT * FROM prospectador.prospeccao_execucoes_diarias WHERE id = $1::uuid LIMIT 1`,
      [filtros.execucao_id || filtros.execucaoId]
    )
    return rows[0] || null
  }

  const data = filtros.data_execucao || filtros.data
  if (data) {
    const { rows } = await pool.query(
      `SELECT * FROM prospectador.prospeccao_execucoes_diarias WHERE data_execucao = $1::date ORDER BY criado_em DESC LIMIT 1`,
      [normalizarData(data)]
    )
    return rows[0] || null
  }

  const { rows } = await pool.query(
    `SELECT * FROM prospectador.prospeccao_execucoes_diarias ORDER BY data_execucao DESC, criado_em DESC LIMIT 1`
  )
  return rows[0] || null
}

async function obterPainelFilaDiaria(pool, filtros = {}) {
  const execucao = await buscarExecucaoParaPainel(pool, filtros)
  if (!execucao) {
    return {
      ok: true,
      execucao: null,
      resumo: {
        total: 0,
        por_status: {},
        mensagens_agendadas: 0,
        falhas: 0,
        respostas: 0,
        proximo_envio: null,
      },
      items: [],
      total: 0,
    }
  }

  const limit = normalizarLimite(filtros.limit || filtros.limite, 80, 500)
  const offset = normalizarOffset(filtros.offset)
  const whereParams = [execucao.id]
  const where = [`f.execucao_id = $1::uuid`]
  if (filtros.status) {
    whereParams.push(String(filtros.status).trim())
    where.push(`f.status = $${whereParams.length}`)
  }
  const itemParams = [...whereParams, limit, offset]
  const limitParam = itemParams.length - 1
  const offsetParam = itemParams.length

  const [itemsResult, resumoResult, totalResult] = await Promise.all([
    pool.query(
      `
      SELECT f.*,
             p.nome AS prospect_nome,
             p.nicho AS prospect_nicho,
             p.cidade AS prospect_cidade,
             p.score,
             p.score_v2,
             p.maps_url,
             p.status AS prospect_status
      FROM prospectador.prospeccao_fila_diaria f
      LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.ordem ASC, f.criado_em ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      itemParams
    ),
    pool.query(
      `
      SELECT
        status,
        COUNT(*)::int AS total,
        MIN(slot_envio) FILTER (WHERE slot_envio IS NOT NULL AND status IN ('simulado', 'agendado', 'enviando')) AS proximo_envio
      FROM prospectador.prospeccao_fila_diaria
      WHERE execucao_id = $1::uuid
      GROUP BY status
      `,
      [execucao.id]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM prospectador.prospeccao_fila_diaria f WHERE ${where.join(' AND ')}`,
      whereParams
    ),
  ])

  const porStatus = {}
  let proximoEnvio = null
  for (const row of resumoResult.rows) {
    porStatus[row.status] = Number(row.total || 0)
    if (row.proximo_envio && (!proximoEnvio || new Date(row.proximo_envio) < new Date(proximoEnvio))) {
      proximoEnvio = row.proximo_envio
    }
  }

  return {
    ok: true,
    execucao,
    resumo: {
      total: Object.values(porStatus).reduce((acc, n) => acc + Number(n || 0), 0),
      por_status: porStatus,
      mensagens_agendadas: Number(porStatus.agendado || 0) + Number(porStatus.simulado || 0),
      falhas: Number(porStatus.falhou || 0),
      respostas: Number(porStatus.respondido || 0),
      proximo_envio: proximoEnvio,
    },
    items: itemsResult.rows,
    total: Number(totalResult.rows[0]?.total || 0),
  }
}

async function cancelarItemFilaDiaria(pool, filaId, payload = {}) {
  const motivo = textoOuNull(payload.motivo || 'cancelado_manual', 160) || 'cancelado_manual'
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'cancelado',
        atualizado_em = NOW(),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
          'cancelado_manual', true,
          'motivo_cancelamento', $2::text,
          'cancelado_em', NOW()
        )
    WHERE id = $1::uuid
      AND status IN ('aguardando_agendamento', 'simulado', 'agendado')
    RETURNING *
    `,
    [filaId, motivo]
  )
  if (!rows[0]) {
    const err = new Error('Item da fila nao encontrado ou nao pode ser cancelado.')
    err.statusCode = 409
    throw err
  }
  return { ok: true, item: rows[0] }
}

async function pausarExecucaoDiaria(pool, execucaoId, payload = {}) {
  const motivo = textoOuNull(payload.motivo || 'pausa_manual', 160) || 'pausa_manual'
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_execucoes_diarias
    SET status = 'cancelada',
        finalizado_em = COALESCE(finalizado_em, NOW()),
        atualizado_em = NOW(),
        config_snapshot = COALESCE(config_snapshot, '{}'::jsonb) || jsonb_build_object(
          'pausada_manualmente', true,
          'motivo_pausa', $2::text,
          'pausada_em', NOW()
        )
    WHERE id = $1::uuid
      AND status NOT IN ('concluida', 'cancelada', 'falhou')
    RETURNING *
    `,
    [execucaoId, motivo]
  )
  if (!rows[0]) {
    const err = new Error('Execucao diaria nao encontrada ou ja finalizada.')
    err.statusCode = 409
    throw err
  }
  await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'cancelado',
        atualizado_em = NOW(),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object(
          'cancelado_por_pausa_execucao', true,
          'motivo_cancelamento', $2::text
        )
    WHERE execucao_id = $1::uuid
      AND status IN ('aguardando_agendamento', 'simulado', 'agendado')
    `,
    [execucaoId, motivo]
  )
  return { ok: true, execucao: rows[0] }
}

async function listarBloqueiosProspeccao(pool, filtros = {}) {
  const limit = normalizarLimite(filtros.limit || filtros.limite, 80, 300)
  const offset = normalizarOffset(filtros.offset)
  const params = [limit, offset]
  const where = []
  if (filtros.ativo !== undefined && filtros.ativo !== '') {
    params.push(String(filtros.ativo) !== 'false')
    where.push(`ativo = $${params.length}`)
  }
  if (filtros.motivo) {
    params.push(String(filtros.motivo).trim())
    where.push(`motivo = $${params.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await pool.query(
    `
    SELECT *, COUNT(*) OVER()::int AS total_count
    FROM prospectador.prospeccao_bloqueios
    ${whereSql}
    ORDER BY criado_em DESC
    LIMIT $1 OFFSET $2
    `,
    params
  )
  const total = rows[0]?.total_count || 0
  return { ok: true, total, items: rows.map(({ total_count, ...row }) => row) }
}

async function criarOuAtualizarExecucaoDiaria(pool, { dataExecucao, config, origem = 'simulacao', mercado = null }) {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_execucoes_diarias (
      data_execucao, modo, status, config_snapshot, iniciado_em
    )
    VALUES ($1::date, $2, 'montando_fila', $3::jsonb, NOW())
    ON CONFLICT (data_execucao) DO UPDATE
    SET modo = EXCLUDED.modo,
        status = 'montando_fila',
        config_snapshot = EXCLUDED.config_snapshot,
        iniciado_em = NOW(),
        finalizado_em = NULL,
        total_encontrados = 0,
        total_elegiveis = 0,
        total_agendados = 0,
        total_simulados = 0,
        total_enviados = 0,
        total_respondidos = 0,
        total_falhas = 0,
        atualizado_em = NOW()
    RETURNING *
    `,
    [dataExecucao, config?.modo || 'manual', JSON.stringify({ ...(config || {}), origem, mercado })]
  )
  return rows[0]
}

async function cancelarFilaSimuladaAnterior(pool, execucaoId) {
  await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'cancelado',
        atualizado_em = NOW(),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || '{"cancelado_por_nova_simulacao": true}'::jsonb
    WHERE execucao_id = $1::uuid
      AND status IN ('aguardando_agendamento', 'agendado', 'simulado')
    `,
    [execucaoId]
  )
}

async function inserirItemFila(pool, item) {
  const { rows } = await pool.query(
    `
    INSERT INTO prospectador.prospeccao_fila_diaria (
      execucao_id, prospect_id, telefone_normalizado, nome_lead, categoria,
      cidade, estado, status, ordem, slot_envio, metadata_json
    )
    VALUES (
      $1::uuid, $2::uuid, $3, $4, $5,
      $6, $7, $8, $9, $10::timestamptz, $11::jsonb
    )
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [
      item.execucao_id,
      item.prospect_id || null,
      item.telefone_normalizado || null,
      item.nome_lead || null,
      item.categoria || null,
      item.cidade || null,
      item.estado || null,
      item.status,
      item.ordem,
      item.slot_envio || null,
      JSON.stringify(item.metadata_json || {}),
    ]
  )
  return rows[0] || null
}

async function atualizarTotaisExecucao(pool, execucaoId, totais) {
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_execucoes_diarias
    SET status = 'simulada',
        total_encontrados = $2,
        total_elegiveis = $3,
        total_agendados = $4,
        total_simulados = $5,
        total_falhas = $6,
        finalizado_em = NOW(),
        atualizado_em = NOW()
    WHERE id = $1::uuid
    RETURNING *
    `,
    [
      execucaoId,
      totais.encontrados,
      totais.elegiveis,
      totais.agendados,
      totais.simulados,
      totais.falhas,
    ]
  )
  return rows[0] || null
}

async function criarFilaDiariaSimulada(pool, input = {}) {
  const dataExecucao = normalizarData(input.data_execucao || input.data || new Date())
  const config = input.config || await obterConfiguracaoProspeccao(pool)
  const slots = gerarSlotsEnvio({ ...(config || {}), data: dataExecucao })
  const candidatos = Array.isArray(input.candidatos) && input.candidatos.length
    ? input.candidatos.map(normalizarCandidato)
    : await buscarCandidatosProspeccao(pool, {
      limit: input.limit || input.limite || Math.max((config?.limite_diario || 80) * 2, 80),
      categoria: input.categoria || config?.categoria_padrao || config?.categoria || null,
      cidade: input.cidade || config?.cidade_padrao || null,
    })

  const execucao = await criarOuAtualizarExecucaoDiaria(pool, {
    dataExecucao,
    config,
    origem: Array.isArray(input.candidatos) && input.candidatos.length ? 'manual' : 'prospects',
    // Mercado escolhido (nicho/cidade) gravado p/ aparecer no log de execuções.
    mercado: {
      nicho: input.categoria || config?.categoria_padrao || null,
      cidade: input.cidade || config?.cidade_padrao || null,
      origem: input.mercado_origem || null,
      motivo: input.mercado_motivo || null,
    },
  })
  await cancelarFilaSimuladaAnterior(pool, execucao.id)

  const itens = []
  const bloqueados = []
  let elegiveis = 0
  let simulados = 0
  let aguardando = 0

  for (const candidato of candidatos) {
    const elegibilidade = await canProspectLead(pool, candidato.telefone_normalizado || candidato.telefone, {
      prospectId: candidato.prospect_id || null,
    })
    if (!elegibilidade.allowed) {
      bloqueados.push({ candidato, elegibilidade })
      continue
    }

    elegiveis += 1
    const slot = slots[elegiveis - 1] || null
    const status = slot ? 'simulado' : 'aguardando_agendamento'
    if (slot) simulados += 1
    else aguardando += 1

    const item = await inserirItemFila(pool, {
      execucao_id: execucao.id,
      prospect_id: candidato.prospect_id || elegibilidade.existingProspectId || null,
      telefone_normalizado: elegibilidade.normalizedPhone,
      nome_lead: candidato.nome_lead,
      categoria: candidato.categoria || config?.categoria_padrao || null,
      cidade: candidato.cidade || config?.cidade_padrao || null,
      estado: candidato.estado || config?.estado_padrao || null,
      status,
      ordem: elegiveis,
      slot_envio: slot?.slot_local || null,
      metadata_json: {
        origem: 'simulacao',
        elegibilidade_reason: elegibilidade.reason,
        slot_preview: slot,
        candidato: candidato.metadata_json || {},
      },
    })

    if (item) itens.push(item)
    else bloqueados.push({ candidato, elegibilidade: { allowed: false, reason: 'duplicado_no_insert' } })
  }

  const execucaoAtualizada = await atualizarTotaisExecucao(pool, execucao.id, {
    encontrados: candidatos.length,
    elegiveis,
    agendados: simulados,
    simulados,
    falhas: bloqueados.length,
  })

  return {
    ok: true,
    execucao: execucaoAtualizada || execucao,
    data_execucao: dataExecucao,
    config,
    total_candidatos: candidatos.length,
    total_elegiveis: elegiveis,
    total_simulados: simulados,
    total_aguardando_agendamento: aguardando,
    total_bloqueados: bloqueados.length,
    itens,
    bloqueados,
    slots_preview: slots.slice(0, 8),
    envio_real_habilitado: false,
    ia_gerada: false,
  }
}

module.exports = {
  normalizarData,
  normalizarCandidato,
  buscarCandidatosProspeccao,
  listarExecucoesDiarias,
  obterPainelFilaDiaria,
  cancelarItemFilaDiaria,
  pausarExecucaoDiaria,
  listarBloqueiosProspeccao,
  criarFilaDiariaSimulada,
}
