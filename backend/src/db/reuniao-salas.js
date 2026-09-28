'use strict'

const crypto = require('crypto')

const TERMINAIS = new Set(['lead_nao_compareceu', 'host_nao_entrou', 'sem_presenca_registrada'])
const AGUARDO_LEAD_MIN = 10

function erro(message, statusCode = 400, code = 'VALIDATION') {
  const e = new Error(message)
  e.statusCode = statusCode
  e.code = code
  return e
}

function tokenSeguro(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function texto(valor, max = 160) {
  const s = String(valor == null ? '' : valor).trim()
  return s ? s.slice(0, max) : null
}

function mapSala(row) {
  if (!row) return null
  const iso = (v) => (v instanceof Date ? v.toISOString() : v)
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    agenda_evento_id: row.agenda_evento_id,
    provider: row.provider,
    provider_domain: row.provider_domain,
    room_name: row.room_name,
    lead_token: row.lead_token,
    status_presenca: row.status_presenca,
    host_entrou_em: iso(row.host_entrou_em),
    lead_entrou_em: iso(row.lead_entrou_em),
    classificado_em: iso(row.classificado_em),
    criado_em: iso(row.criado_em),
    atualizado_em: iso(row.atualizado_em),
    evento: row.evento_id ? {
      id: row.evento_id,
      titulo: row.evento_titulo,
      tipo: row.evento_tipo,
      status: row.evento_status,
      data_inicio: iso(row.evento_inicio),
      data_fim: iso(row.evento_fim),
      lead_nome: row.evento_lead_nome || null,
      lead_telefone: row.evento_lead_telefone || null,
      responsavel_id: row.evento_responsavel_id || null,
      criado_por: row.evento_criado_por || null,
    } : null,
  }
}

function selectSalaWhere(where) {
  return `
    SELECT rs.*,
           ae.id AS evento_id,
           ae.titulo AS evento_titulo,
           ae.tipo AS evento_tipo,
           ae.status AS evento_status,
           ae.data_inicio AS evento_inicio,
           ae.data_fim AS evento_fim,
           ae.lead_nome AS evento_lead_nome,
           ae.lead_telefone AS evento_lead_telefone,
           ae.responsavel_id AS evento_responsavel_id,
           ae.criado_por AS evento_criado_por
      FROM app.reuniao_salas rs
      JOIN app.agenda_eventos ae
        ON ae.id = rs.agenda_evento_id
       AND ae.empresa_id = rs.empresa_id
       AND ae.excluido_em IS NULL
     WHERE ${where}
     LIMIT 1`
}

async function obterEventoReuniao(db, { empresaId, agendaEventoId }) {
  const { rows } = await db.query(
    `SELECT id, empresa_id, criado_por, responsavel_id, titulo, tipo, status, data_inicio, data_fim,
            lead_nome, lead_telefone
       FROM app.agenda_eventos
      WHERE empresa_id = $1 AND id = $2::uuid AND excluido_em IS NULL
      LIMIT 1`,
    [empresaId, agendaEventoId]
  )
  const ev = rows[0] || null
  if (!ev) throw erro('Reunião não encontrada.', 404, 'NOT_FOUND')
  if (ev.tipo !== 'reuniao') throw erro('Sala só pode ser criada para evento do tipo reunião.', 400, 'EVENTO_NAO_REUNIAO')
  return ev
}

function statusCalculado(sala, agora = new Date()) {
  if (!sala) return 'pendente'
  if (TERMINAIS.has(sala.status_presenca)) return sala.status_presenca
  if (sala.host_entrou_em && sala.lead_entrou_em) return 'ambos_entraram'
  const inicio = new Date(sala.evento?.data_inicio || sala.evento_inicio)
  if (!Number.isNaN(inicio.getTime()) && agora.getTime() >= inicio.getTime() + AGUARDO_LEAD_MIN * 60000) {
    if (sala.host_entrou_em && !sala.lead_entrou_em) return 'lead_nao_compareceu'
    if (!sala.host_entrou_em && sala.lead_entrou_em) return 'host_nao_entrou'
    if (!sala.host_entrou_em && !sala.lead_entrou_em) return 'sem_presenca_registrada'
  }
  if (sala.host_entrou_em) return 'host_entrou'
  if (sala.lead_entrou_em) return 'lead_entrou'
  return 'pendente'
}

function salaParaApi(sala) {
  if (!sala) return null
  return {
    id: sala.id,
    agenda_evento_id: sala.agenda_evento_id,
    provider: sala.provider,
    provider_domain: sala.provider_domain,
    room_name: sala.room_name,
    status_presenca: sala.status_presenca,
    host_entrou_em: sala.host_entrou_em || null,
    lead_entrou_em: sala.lead_entrou_em || null,
    classificado_em: sala.classificado_em || null,
    host_url: `/dashboard/reunioes/${sala.agenda_evento_id}`,
    lead_url: `/reuniao/${sala.lead_token}`,
    aguardo_lead_minutos: AGUARDO_LEAD_MIN,
  }
}

async function reconciliarSala(db, sala) {
  if (!sala) return null
  const novo = statusCalculado(sala)
  if (novo === sala.status_presenca) return sala
  const terminal = TERMINAIS.has(novo)
  const { rows } = await db.query(
    `UPDATE app.reuniao_salas
        SET status_presenca = $3,
            classificado_em = CASE WHEN $4 THEN COALESCE(classificado_em, NOW()) ELSE classificado_em END,
            atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid
      RETURNING *`,
    [sala.empresa_id, sala.id, novo, terminal]
  )
  if (novo === 'lead_nao_compareceu') {
    await db.query(
      `UPDATE app.agenda_eventos
          SET status = 'nao_compareceu', atualizado_em = NOW()
        WHERE empresa_id = $1
          AND id = $2::uuid
          AND tipo = 'reuniao'
          AND status IN ('pendente', 'confirmado')`,
      [sala.empresa_id, sala.agenda_evento_id]
    )
  }
  return { ...sala, ...mapSala({ ...rows[0], ...prefixEvento(sala.evento) }) }
}

function prefixEvento(evento) {
  if (!evento) return {}
  return {
    evento_id: evento.id,
    evento_titulo: evento.titulo,
    evento_tipo: evento.tipo,
    evento_status: evento.status,
    evento_inicio: evento.data_inicio,
    evento_fim: evento.data_fim,
    evento_lead_nome: evento.lead_nome,
    evento_lead_telefone: evento.lead_telefone,
    evento_responsavel_id: evento.responsavel_id,
    evento_criado_por: evento.criado_por,
  }
}

async function obterSalaPorEvento(db, { empresaId, agendaEventoId }) {
  const { rows } = await db.query(
    selectSalaWhere('rs.empresa_id = $1 AND rs.agenda_evento_id = $2::uuid'),
    [empresaId, agendaEventoId]
  )
  const sala = mapSala(rows[0] || null)
  return reconciliarSala(db, sala)
}

async function obterSalaPorToken(db, token) {
  const { rows } = await db.query(
    selectSalaWhere('rs.lead_token = $1'),
    [String(token || '')]
  )
  const sala = mapSala(rows[0] || null)
  return reconciliarSala(db, sala)
}

async function garantirSala(db, { empresaId, agendaEventoId, usuarioId = null }) {
  const existente = await obterSalaPorEvento(db, { empresaId, agendaEventoId })
  if (existente) return existente
  const ev = await obterEventoReuniao(db, { empresaId, agendaEventoId })
  const room = `av-${tokenSeguro(18)}`
  const leadToken = tokenSeguro(32)
  const { rows } = await db.query(
    `INSERT INTO app.reuniao_salas
       (empresa_id, agenda_evento_id, room_name, lead_token, criado_por)
     VALUES ($1, $2::uuid, $3, $4, $5::uuid)
     RETURNING *`,
    [empresaId, ev.id, room, leadToken, usuarioId || null]
  )
  return mapSala({ ...rows[0], ...prefixEvento({
    id: ev.id,
    titulo: ev.titulo,
    tipo: ev.tipo,
    status: ev.status,
    data_inicio: ev.data_inicio,
    data_fim: ev.data_fim,
    lead_nome: ev.lead_nome,
    lead_telefone: ev.lead_telefone,
    responsavel_id: ev.responsavel_id,
    criado_por: ev.criado_por,
  }) })
}

async function registrarPresenca(db, { empresaId = null, agendaEventoId = null, token = null, papel, evento, usuarioId = null, participanteId = null, displayName = null }) {
  if (!['host', 'lead'].includes(papel)) throw erro('Papel de presença inválido.')
  if (!['entrou', 'saiu'].includes(evento)) throw erro('Evento de presença inválido.')
  const sala = empresaId && agendaEventoId
    ? await obterSalaPorEvento(db, { empresaId, agendaEventoId })
    : await obterSalaPorToken(db, token)
  if (!sala) throw erro('Sala não encontrada.', 404, 'NOT_FOUND')

  const client = typeof db.connect === 'function' ? await db.connect() : null
  const q = client || db
  try {
    if (client) await q.query('BEGIN')
    await q.query(
      `INSERT INTO app.reuniao_presencas
         (empresa_id, sala_id, agenda_evento_id, papel, evento, usuario_id, participante_id, display_name)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7, $8)`,
      [
        sala.empresa_id, sala.id, sala.agenda_evento_id, papel, evento, usuarioId || null,
        texto(participanteId), texto(displayName),
      ]
    )
    if (evento === 'entrou') {
      const coluna = papel === 'host' ? 'host_entrou_em' : 'lead_entrou_em'
      await q.query(
        `UPDATE app.reuniao_salas
            SET ${coluna} = COALESCE(${coluna}, NOW()), atualizado_em = NOW()
          WHERE id = $1::uuid`,
        [sala.id]
      )
    }
    const atualizado = await obterSalaPorToken(q, sala.lead_token)
    if (client) await q.query('COMMIT')
    return atualizado
  } catch (err) {
    if (client) await q.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (client) client.release()
  }
}

async function reconciliarSalasExpiradas(db, empresaId) {
  const { rows } = await db.query(
    `SELECT rs.id
       FROM app.reuniao_salas rs
       JOIN app.agenda_eventos ae ON ae.id = rs.agenda_evento_id AND ae.empresa_id = rs.empresa_id
      WHERE rs.empresa_id = $1
        AND rs.status_presenca IN ('pendente', 'host_entrou', 'lead_entrou')
        AND ae.excluido_em IS NULL
        AND ae.tipo = 'reuniao'
        AND ae.data_inicio + ($2::int * INTERVAL '1 minute') <= NOW()
      ORDER BY ae.data_inicio ASC
      LIMIT 50`,
    [empresaId, AGUARDO_LEAD_MIN]
  )
  for (const row of rows) {
    const { rows: salaRows } = await db.query(selectSalaWhere('rs.empresa_id = $1 AND rs.id = $2::uuid'), [empresaId, row.id])
    await reconciliarSala(db, mapSala(salaRows[0] || null))
  }
  return rows.length
}

module.exports = {
  AGUARDO_LEAD_MIN,
  garantirSala,
  obterSalaPorEvento,
  obterSalaPorToken,
  registrarPresenca,
  reconciliarSalasExpiradas,
  salaParaApi,
  statusCalculado,
}
