'use strict'

const { pool } = require('../db')

const EVENTOS_SAUDE = new Set([
  'CONNECTION_UPDATE',
  'CONNECTION.UPDATE',
  'QRCODE_UPDATED',
  'QRCODE.UPDATED',
  'MESSAGES_UPDATE',
  'MESSAGES.UPDATE',
])

function textoCurto(value, max = 500) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return s.slice(0, max)
}

function buscarPrimeiro(obj, paths) {
  for (const path of paths) {
    let atual = obj
    for (const key of path) {
      if (atual == null || typeof atual !== 'object') {
        atual = undefined
        break
      }
      atual = atual[key]
    }
    if (atual != null && String(atual).trim()) return atual
  }
  return null
}

function coletarMessageStubParameters(data) {
  const candidatos = [
    data?.messageStubParameters,
    data?.message?.messageStubParameters,
    data?.update?.messageStubParameters,
    data?.data?.messageStubParameters,
  ]
  const encontrado = candidatos.find(Array.isArray)
  return encontrado ? encontrado.map((x) => String(x).slice(0, 80)).slice(0, 10) : []
}

function normalizarEventoEvolution(raw) {
  return String(raw || '').trim().toUpperCase()
}

function classificarEventoSaudeInstancia({ event, state, reason, disconnectCode, detalhes }) {
  const blob = [
    event,
    state,
    reason,
    disconnectCode,
    detalhes?.message_status,
    detalhes?.message_stub_parameters?.join(' '),
  ].filter(Boolean).join(' ').toLowerCase()

  const altoRisco = [
    '463',
    'device_removed',
    'device removed',
    'logged_out',
    'logged out',
    'logout',
    '401',
    'banned',
    'banido',
    'blocked',
    'bloqueado',
    'spam',
    'policy',
    'reputation',
    'restricted',
    'restri',
  ].some((termo) => blob.includes(termo))
  if (altoRisco) {
    return {
      risk_level: 'alto',
      risk_message: 'Desconexao/rejeicao com sinal de risco. Pause envios e investigue antes de reconectar para proteger o numero.',
    }
  }

  const atencao = [
    'conflict',
    'close',
    'closed',
    'disconnect',
    'disconnected',
    'connection_lost',
    'timed out',
    'timeout',
    'qr',
    'error',
  ].some((termo) => blob.includes(termo))
  if (atencao) {
    return {
      risk_level: 'atencao',
      risk_message: 'Instancia teve queda ou erro recente. Reconecte com cautela e revise a origem antes de retomar envios.',
    }
  }

  return { risk_level: 'normal', risk_message: null }
}

function eventoSaudeDeWebhook(body, empresaId, evolutionInstance) {
  const event = normalizarEventoEvolution(body?.event)
  if (!EVENTOS_SAUDE.has(event)) return null

  const data = body?.data && typeof body.data === 'object' ? body.data : {}
  const state = textoCurto(buscarPrimeiro(data, [
    ['state'],
    ['instance', 'state'],
    ['connection'],
    ['status'],
  ]), 120)
  const reason = textoCurto(buscarPrimeiro(data, [
    ['reason'],
    ['message'],
    ['error'],
    ['lastDisconnect', 'error', 'message'],
    ['lastDisconnect', 'error', 'output', 'payload', 'message'],
  ]), 500)
  const disconnectCode = textoCurto(buscarPrimeiro(data, [
    ['disconnectionReasonCode'],
    ['disconnectCode'],
    ['statusCode'],
    ['lastDisconnect', 'error', 'output', 'statusCode'],
    ['lastDisconnect', 'error', 'status'],
  ]), 80)
  const detalhes = {
    message_status: textoCurto(buscarPrimeiro(data, [
      ['status'],
      ['message', 'status'],
      ['update', 'status'],
      ['data', 'status'],
    ]), 80),
    message_stub_parameters: coletarMessageStubParameters(data),
    source_event: event,
  }
  const risco = classificarEventoSaudeInstancia({
    event,
    state,
    reason,
    disconnectCode,
    detalhes,
  })

  return {
    empresa_id: empresaId,
    evolution_instance: textoCurto(evolutionInstance || body?.instance || body?.sender, 120),
    event,
    state,
    reason,
    disconnect_code: disconnectCode,
    risk_level: risco.risk_level,
    risk_message: risco.risk_message,
    detalhes_json: detalhes,
  }
}

async function registrarEventoSaudeInstancia(evento, db = pool) {
  if (!evento?.empresa_id || !evento?.evolution_instance || !evento?.event) return null
  const { rows: [inst] } = await db.query(
    `SELECT id
       FROM app.empresa_whatsapp_instances
      WHERE empresa_id = $1 AND evolution_instance = $2
      LIMIT 1`,
    [evento.empresa_id, evento.evolution_instance]
  )
  const { rows: [row] } = await db.query(
    `INSERT INTO app.whatsapp_instance_events
       (empresa_id, instance_id, evolution_instance, event, state, reason, disconnect_code,
        risk_level, risk_message, detalhes_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING id, criado_em`,
    [
      evento.empresa_id,
      inst?.id || null,
      evento.evolution_instance,
      evento.event,
      evento.state || null,
      evento.reason || null,
      evento.disconnect_code || null,
      evento.risk_level || 'normal',
      evento.risk_message || null,
      JSON.stringify(evento.detalhes_json || {}),
    ]
  )
  return row || null
}

function alertaSaudeDeEvento(evento) {
  if (!evento || evento.risk_level === 'normal') return null
  return {
    risk_level: evento.risk_level,
    message: evento.risk_message || (evento.risk_level === 'alto'
      ? 'Evento de alto risco registrado para esta instancia.'
      : 'Evento de atencao registrado para esta instancia.'),
    event: evento.event || null,
    state: evento.state || null,
    reason: evento.reason || null,
    disconnect_code: evento.disconnect_code || null,
    criado_em: evento.criado_em || null,
  }
}

async function buscarUltimoEventoSaudeInstancia(db, empresaId, instanceId) {
  const { rows: [row] } = await db.query(
    `SELECT event, state, reason, disconnect_code, risk_level, risk_message, criado_em
       FROM app.whatsapp_instance_events
      WHERE empresa_id = $1 AND instance_id = $2
        AND risk_level IN ('atencao','alto')
        AND criado_em > NOW() - INTERVAL '7 days'
      ORDER BY criado_em DESC
      LIMIT 1`,
    [empresaId, instanceId]
  )
  return row || null
}

async function listarEventosSaudeInstancia(db, empresaId, instanceId, limit = 20) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50)
  const { rows } = await db.query(
    `SELECT event, state, reason, disconnect_code, risk_level, risk_message, detalhes_json, criado_em
       FROM app.whatsapp_instance_events
      WHERE empresa_id = $1 AND instance_id = $2
      ORDER BY criado_em DESC
      LIMIT $3`,
    [empresaId, instanceId, max]
  )
  return rows
}

module.exports = {
  EVENTOS_SAUDE,
  normalizarEventoEvolution,
  classificarEventoSaudeInstancia,
  eventoSaudeDeWebhook,
  registrarEventoSaudeInstancia,
  alertaSaudeDeEvento,
  buscarUltimoEventoSaudeInstancia,
  listarEventosSaudeInstancia,
}
