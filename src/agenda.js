'use strict'

const crypto = require('crypto')
const { pool } = require('./db')
const { logger } = require('./logger')
const { enviarMensagem } = require('./whatsapp')
const {
  REUNIAO_PROPOSTA_HORARIOS_PADRAO,
  TIMEZONE,
  adicionarMinutos,
  formatarHoraSaoPaulo,
  partesDataBrasil,
  isoDateBrasil,
  parseDateTimeSaoPaulo,
  utcParaDataLocalEmTimezone,
} = require('./date-utils')

const TIPOS_EVENTO = new Set(['reuniao', 'follow_up', 'retorno', 'tarefa', 'prospeccao', 'disparo', 'pessoal', 'bloqueio', 'outro'])
const STATUS_EVENTO = new Set(['pendente', 'concluido', 'atrasado', 'cancelado', 'bloqueado', 'confirmado', 'nao_compareceu', 'reagendamento_pendente'])
const STATUS_OCUPA_HORARIO = new Set(['pendente', 'confirmado', 'bloqueado'])
const PRIORIDADES = new Set(['baixa', 'normal', 'media', 'alta', 'urgente'])
const RECORRENCIAS = new Set(['nenhuma', 'diaria', 'semanal', 'mensal'])
const LEMBRETE_15_MIN_MS = 15 * 60 * 1000

function jsonErro(res, status, erro, detalhe) {
  const body = { ok: false, erro }
  if (detalhe) body.detalhe = detalhe
  return res.status(status).json(body)
}

function erroLembrete(code, message, status = 400) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dataLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function parseDateOnly(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return s
}

function periodoQuery(query = {}) {
  const data = parseDateOnly(query.data)
  const inicio = parseDateOnly(query.inicio) || data || dataLocal()
  const fim = parseDateOnly(query.fim) || inicio
  const inicioDate = new Date(`${inicio}T00:00:00.000Z`)
  const fimDate = new Date(`${fim}T00:00:00.000Z`)
  if (fimDate < inicioDate) {
    return { erro: 'Periodo invalido' }
  }
  return { inicio, fim }
}

function normalizarTexto(value, max = 500) {
  const s = String(value == null ? '' : value).trim()
  return s ? s.slice(0, max) : ''
}

function normalizarIdOpcional(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
}

function parseDateTime(value) {
  return parseDateTimeSaoPaulo(value)
}

function normalizarRegraRecorrencia(input) {
  if (!input || typeof input !== 'object') return null
  const tipo = RECORRENCIAS.has(input.tipo) ? input.tipo : 'nenhuma'
  if (tipo === 'nenhuma') return null
  const regra = {
    tipo,
    intervalo: Math.min(Math.max(parseInt(input.intervalo, 10) || 1, 1), 12),
  }
  if (Array.isArray(input.diasSemana)) {
    regra.diasSemana = input.diasSemana.map((v) => normalizarTexto(v, 20)).filter(Boolean).slice(0, 7)
  }
  const ate = parseDateOnly(input.ate)
  if (ate) regra.ate = ate
  return regra
}

function validarPayloadEvento(body = {}, userId, parcial = false) {
  const out = {}
  const issues = []

  if (!parcial || body.titulo !== undefined) {
    out.titulo = normalizarTexto(body.titulo, 160)
    if (!out.titulo) issues.push('titulo obrigatorio')
  }
  if (!parcial || body.descricao !== undefined) out.descricao = normalizarTexto(body.descricao, 2000)
  if (!parcial || body.tipo !== undefined) {
    out.tipo = TIPOS_EVENTO.has(body.tipo) ? body.tipo : ''
    if (!out.tipo) issues.push('tipo invalido')
  }
  if (!parcial || body.status !== undefined) {
    out.status = STATUS_EVENTO.has(body.status) ? body.status : 'pendente'
  }
  if (!parcial || body.prioridade !== undefined) {
    out.prioridade = PRIORIDADES.has(body.prioridade) ? body.prioridade : 'media'
  }
  if (!parcial || body.data_inicio !== undefined) {
    out.data_inicio = parseDateTime(body.data_inicio)
    if (!out.data_inicio) issues.push('data_inicio invalida')
  }
  if (!parcial || body.data_fim !== undefined) {
    out.data_fim = parseDateTime(body.data_fim)
    if (!out.data_fim) issues.push('data_fim invalida')
  }
  if (out.data_inicio && out.data_fim && out.data_fim <= out.data_inicio) {
    issues.push('data_fim deve ser maior que data_inicio')
  }
  if (!userId) issues.push('usuario obrigatorio')

  if (!parcial || body.lead_id !== undefined) out.lead_id = normalizarIdOpcional(body.lead_id)
  if (!parcial || body.conversa_id !== undefined) out.conversa_id = normalizarIdOpcional(body.conversa_id)
  if (!parcial || body.recorrente !== undefined || body.regra_recorrencia !== undefined) {
    const regra = normalizarRegraRecorrencia(body.regra_recorrencia)
    out.recorrente = Boolean(body.recorrente && regra)
    out.regra_recorrencia = out.recorrente ? regra : null
  }
  if (!parcial || body.metadata !== undefined) {
    out.metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}
  }

  return { ok: issues.length === 0, value: out, issues }
}

function statusEfetivo(row, agora = new Date()) {
  if (!row) return 'pendente'
  if (row.status === 'bloqueado' || row.tipo === 'bloqueio') return 'bloqueado'
  if (row.status === 'pendente') {
    const fim = new Date(row.data_fim || row.data_inicio)
    if (!Number.isNaN(fim.getTime()) && fim < agora) return 'atrasado'
  }
  return row.status || 'pendente'
}

function mapEvento(row, agora = new Date()) {
  if (!row) return null
  const numero = row.conversa_numero || row.lead_numero || null
  return {
    id: row.id,
    usuario_id: row.usuario_id,
    lead_id: row.lead_id,
    conversa_id: row.conversa_id,
    numero,
    titulo: row.titulo,
    descricao: row.descricao || '',
    tipo: row.tipo,
    status: row.status,
    status_efetivo: statusEfetivo(row, agora),
    prioridade: row.prioridade,
    data_inicio: row.data_inicio instanceof Date ? row.data_inicio.toISOString() : row.data_inicio,
    data_fim: row.data_fim instanceof Date ? row.data_fim.toISOString() : row.data_fim,
    timezone: row.timezone || TIMEZONE,
    recorrente: Boolean(row.recorrente),
    regra_recorrencia: row.regra_recorrencia || null,
    recorrencia_id: row.recorrencia_id || null,
    reagendado_de_evento_id: row.reagendado_de_evento_id || null,
    reagendado_para_evento_id: row.reagendado_para_evento_id || null,
    motivo_reagendamento: row.motivo_reagendamento || null,
    nao_compareceu_em: row.nao_compareceu_em instanceof Date ? row.nao_compareceu_em.toISOString() : row.nao_compareceu_em,
    marcado_por: row.marcado_por || null,
    origem: row.origem || 'manual',
    metadata: row.metadata || {},
    lembrete_status: row.lembrete_status || null,
    lembrete_enviado_em: row.lembrete_enviado_em instanceof Date ? row.lembrete_enviado_em.toISOString() : row.lembrete_enviado_em,
    lembrete_erro: row.lembrete_erro || null,
    criado_em: row.criado_em instanceof Date ? row.criado_em.toISOString() : row.criado_em,
    atualizado_em: row.atualizado_em instanceof Date ? row.atualizado_em.toISOString() : row.atualizado_em,
    concluido_em: row.concluido_em instanceof Date ? row.concluido_em.toISOString() : row.concluido_em,
  }
}

function montarResumo(eventos, agora = new Date()) {
  const resumo = {
    atrasados: 0,
    hoje: eventos.length,
    concluidos: 0,
    proximos: 0,
    reunioes_hoje: 0,
    followups_pendentes: 0,
    por_tipo: {},
  }
  for (const evento of eventos) {
    const status = evento.status_efetivo || statusEfetivo(evento, agora)
    resumo.por_tipo[evento.tipo] = (resumo.por_tipo[evento.tipo] || 0) + 1
    if (status === 'atrasado') resumo.atrasados += 1
    if (status === 'concluido') resumo.concluidos += 1
    if (status === 'pendente' && new Date(evento.data_inicio) >= agora) resumo.proximos += 1
    if (evento.tipo === 'reuniao') resumo.reunioes_hoje += 1
    if (evento.tipo === 'follow_up' && status !== 'concluido' && status !== 'cancelado') resumo.followups_pendentes += 1
  }
  return resumo
}

function somarMes(date, months) {
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const max = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, max))
  return d
}

function gerarOcorrenciasRecorrentes(base, regra, maxOcorrencias = 24) {
  if (!regra || !RECORRENCIAS.has(regra.tipo) || regra.tipo === 'nenhuma') return []
  const inicio = parseDateTime(base.data_inicio)
  const fim = parseDateTime(base.data_fim)
  if (!inicio || !fim) return []
  const duracao = fim.getTime() - inicio.getTime()
  const limiteAte = regra.ate ? new Date(`${regra.ate}T23:59:59.999Z`) : new Date(inicio.getTime() + 90 * 24 * 60 * 60 * 1000)
  const intervalo = Math.min(Math.max(parseInt(regra.intervalo, 10) || 1, 1), 12)
  const out = []
  let atual = new Date(inicio.getTime())
  while (out.length < maxOcorrencias) {
    if (regra.tipo === 'diaria') atual = new Date(atual.getTime() + intervalo * 24 * 60 * 60 * 1000)
    else if (regra.tipo === 'semanal') atual = new Date(atual.getTime() + intervalo * 7 * 24 * 60 * 60 * 1000)
    else if (regra.tipo === 'mensal') atual = somarMes(atual, intervalo)
    if (atual > limiteAte) break
    out.push({
      ...base,
      data_inicio: new Date(atual.getTime()),
      data_fim: new Date(atual.getTime() + duracao),
      recorrente: false,
      regra_recorrencia: null,
    })
  }
  return out
}

async function inserirEvento(values, usuarioId, recorrenciaId = null, origem = 'manual') {
  const { rows } = await pool.query(
    `INSERT INTO vendas.agenda_eventos
      (usuario_id, lead_id, conversa_id, titulo, descricao, tipo, status, prioridade,
       data_inicio, data_fim, timezone, recorrente, regra_recorrencia, recorrencia_id, origem, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb)
     RETURNING *`,
    [
      usuarioId,
      values.lead_id || null,
      values.conversa_id || null,
      values.titulo,
      values.descricao || null,
      values.tipo,
      values.status || 'pendente',
      values.prioridade || 'media',
      values.data_inicio,
      values.data_fim,
      TIMEZONE,
      Boolean(values.recorrente),
      JSON.stringify(values.regra_recorrencia || null),
      recorrenciaId,
      origem,
      JSON.stringify(values.metadata || {}),
    ]
  )
  return rows[0]
}

async function existeConflitoAgenda(dataInicio, dataFim, usuarioId = null, ignorarId = null) {
  const uid = Number(usuarioId) > 0 ? Number(usuarioId) : null
  const ignore = Number(ignorarId) > 0 ? Number(ignorarId) : null
  const inicio = dataInicio instanceof Date ? dataInicio : new Date(dataInicio)
  const fim = dataFim instanceof Date ? dataFim : new Date(dataFim)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) return false
  const params = [inicio, fim, Array.from(STATUS_OCUPA_HORARIO)]
  let uidClause = ''
  let ignoreClause = ''
  if (uid) {
    params.push(uid)
    uidClause = `AND usuario_id = $${params.length}`
  }
  if (ignore) {
    params.push(ignore)
    ignoreClause = `AND id <> $${params.length}`
  }
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM vendas.agenda_eventos
       WHERE excluido_em IS NULL
         AND status = ANY($3::text[])
         AND data_inicio < $2
         AND data_fim > $1
         ${uidClause}
         ${ignoreClause}`,
      params
    )
    return parseInt(rows[0]?.n || '0', 10) > 0
  } catch {
    return false
  }
}

function payloadBloqueio(body = {}, userId, parcial = false) {
  const base = {
    titulo: body.titulo || 'Horário bloqueado',
    descricao: body.descricao ?? body.motivo ?? '',
    tipo: 'bloqueio',
    status: 'bloqueado',
    prioridade: body.prioridade || 'normal',
    data_inicio: body.data_inicio,
    data_fim: body.data_fim,
    recorrente: body.recorrente,
    regra_recorrencia: body.regra_recorrencia,
    metadata: {
      ...((body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) ? body.metadata : {}),
      motivo: normalizarTexto(body.motivo ?? body.descricao, 300),
      observacao: normalizarTexto(body.observacao, 1000),
    },
  }
  if (parcial) {
    for (const key of ['data_inicio', 'data_fim', 'recorrente', 'regra_recorrencia']) {
      if (body[key] === undefined) delete base[key]
    }
    if (body.motivo === undefined && body.descricao === undefined) delete base.descricao
    if (body.motivo === undefined && body.observacao === undefined && body.metadata === undefined) delete base.metadata
  }
  return validarPayloadEvento(base, userId, parcial)
}

async function buscarEventoAgendaDuplicado(values, usuarioId, origem = 'manual') {
  const leadId = Number(values.lead_id) > 0 ? Number(values.lead_id) : null
  const leadNumero = normalizarTexto(values.metadata?.lead_numero, 80)
  const dataInicio = values.data_inicio instanceof Date ? values.data_inicio : new Date(values.data_inicio)
  if (Number.isNaN(dataInicio.getTime())) return null

  const params = [
    usuarioId,
    values.tipo || 'reuniao',
    dataInicio,
    origem,
    leadId,
    leadNumero || null,
  ]
  const { rows } = await pool.query(
    `SELECT *
     FROM vendas.agenda_eventos
     WHERE usuario_id = $1
       AND tipo = $2
       AND data_inicio = $3
       AND origem = $4
       AND excluido_em IS NULL
       AND (
         ($5::bigint IS NOT NULL AND lead_id = $5::bigint)
         OR ($6::text IS NOT NULL AND metadata->>'lead_numero' = $6::text)
       )
     ORDER BY id ASC
     LIMIT 1`,
    params
  )
  return rows[0] || null
}

async function criarEventoAgenda({
  usuarioId,
  leadId,
  conversaId,
  titulo,
  descricao,
  tipo = 'reuniao',
  prioridade = 'alta',
  dataInicio,
  dataFim,
  metadata = {},
  origem = 'sistema',
} = {}) {
  let uid = Number(usuarioId) > 0 ? Number(usuarioId) : null
  if (!uid) {
    const { rows: users } = await pool.query(
      `SELECT id FROM vendas.dashboard_users WHERE ativo = true ORDER BY id LIMIT 1`
    )
    if (!users.length) return null
    uid = users[0].id
  }
  const inicio = dataInicio instanceof Date ? dataInicio : new Date(dataInicio)
  const fim = dataFim instanceof Date ? dataFim : new Date(dataFim)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) return null
  const values = {
    titulo: String(titulo || '').trim().slice(0, 160) || 'Evento',
    descricao: String(descricao || '').slice(0, 2000),
    tipo: TIPOS_EVENTO.has(tipo) ? tipo : 'reuniao',
    status: 'pendente',
    prioridade: PRIORIDADES.has(prioridade) ? prioridade : 'alta',
    data_inicio: inicio,
    data_fim: fim,
    lead_id: Number(leadId) > 0 ? Number(leadId) : null,
    conversa_id: Number(conversaId) > 0 ? Number(conversaId) : null,
    recorrente: false,
    regra_recorrencia: null,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
  }
  const duplicado = await buscarEventoAgendaDuplicado(values, uid, origem)
  if (duplicado) return duplicado
  if (values.tipo !== 'bloqueio') {
    const ocupado = await existeConflitoAgenda(values.data_inicio, values.data_fim, uid)
    if (ocupado) return null
  }
  const row = await inserirEvento(values, uid, null, origem)
  await agendarLembretesReuniao(row.id)
  return row
}

async function buscarEventoDoUsuario(id, usuarioId, role = 'admin') {
  const params = [id]
  let scope = ''
  if (role !== 'admin') {
    params.push(usuarioId)
    scope = ` AND usuario_id = $2`
  }
  const { rows } = await pool.query(
    `SELECT *
     FROM vendas.agenda_eventos
     WHERE id = $1
       AND excluido_em IS NULL
       ${scope}
     LIMIT 1`,
    params
  )
  return rows[0] || null
}

async function buscarEventoComVinculos(id, usuarioId, role = 'admin') {
  const params = [id]
  let scope = ''
  if (role !== 'admin') {
    params.push(usuarioId)
    scope = ` AND e.usuario_id = $2`
  }
  const { rows } = await pool.query(
    `SELECT e.*, c.numero AS conversa_numero, c.venda_fechada AS conversa_venda_fechada, lp.numero AS lead_numero
     FROM vendas.agenda_eventos e
     LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
     LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
     WHERE e.id = $1
       AND e.excluido_em IS NULL
       ${scope}
     LIMIT 1`,
    params
  )
  return rows[0] || null
}

function numeroDoEvento(row) {
  return row?.conversa_numero || row?.lead_numero || row?.metadata?.lead_numero || row?.metadata?.numero || null
}

function textoNaoCompareceu(row) {
  const inicio = row?.data_inicio instanceof Date ? row.data_inicio : new Date(row?.data_inicio)
  const quando = Number.isNaN(inicio.getTime())
    ? 'no horário combinado'
    : inicio.toLocaleString('pt-BR', {
      timeZone: TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  return `Lead não compareceu à reunião de ${quando}.`
}

async function registrarHistoricoNaoCompareceu(row, extra = '') {
  const numero = numeroDoEvento(row)
  if (!numero) return false
  const content = `[Agenda] ${textoNaoCompareceu(row)}${extra ? ` ${extra}` : ''}`
  await pool.query(
    `UPDATE vendas.conversas
     SET historico = (
           CASE WHEN jsonb_typeof(historico) = 'array' THEN historico ELSE '[]'::jsonb END
         ) || $2::jsonb,
         atualizado_em = NOW()
     WHERE numero = $1`,
    [
      numero,
      JSON.stringify([{
        role: 'operator',
        content,
        agenda_evento_id: row.id,
        tipo: 'nao_compareceu',
        criado_em: new Date().toISOString(),
      }]),
    ]
  )
  return true
}

function horarioReuniaoLabel(row) {
  return formatarHoraSaoPaulo(row?.data_inicio) || '--:--'
}

function gerarMensagemLembreteReuniao(evento, lead = {}) {
  const nome = normalizarTexto(lead.apelido || lead.nome || lead.negocio || lead.empresa, 80)
  const saudacao = nome ? `Oi, ${nome}, tudo bem?` : 'Oi, tudo bem?'
  const hora = horarioReuniaoLabel(evento)
  return `${saudacao} Lembrete rápido: nossa reunião com a equipe da PJ Codeworks está marcada para hoje às ${hora}.\n\nA ideia é te mostrar a estrutura recomendada, prazo e investimento em até 15 minutos. Continua disponível nesse horário?`
}

async function enfileirarJobLembreteReuniao(lembreteId, enviarEm) {
  const id = Number(lembreteId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const dedupe = `agenda_lembrete_reuniao:${id}`
  const payload = JSON.stringify({ lembrete_id: id })
  const { rows } = await pool.query(
    `INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
     VALUES ('agenda_lembrete_reuniao', $1, $2::jsonb, 'pending', 0, 3, $3::timestamptz)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       payload = EXCLUDED.payload,
       status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
       attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
       available_at = EXCLUDED.available_at,
       atualizado_em = NOW()
     RETURNING id`,
    [dedupe, payload, enviarEm]
  )
  return rows[0]?.id || null
}

async function cancelarLembretesEvento(eventoId, motivo = 'evento_alterado') {
  const id = Number(eventoId)
  if (!Number.isSafeInteger(id) || id <= 0) return 0
  const { rows } = await pool.query(
    `UPDATE vendas.agenda_lembretes
     SET status = 'cancelado',
         erro = COALESCE(erro, $2),
         atualizado_em = NOW()
     WHERE evento_id = $1
       AND status = 'pendente'
     RETURNING id`,
    [id, motivo]
  )
  if (rows.length) {
    await pool.query(
      `UPDATE vendas.job_queue
       SET status = 'completed',
           last_error = $2,
           locked_at = NULL,
           locked_until = NULL,
           atualizado_em = NOW()
       WHERE dedupe_key = ANY($1::text[])
         AND status = 'pending'`,
      [rows.map((r) => `agenda_lembrete_reuniao:${r.id}`), `cancelado: ${motivo}`]
    )
  }
  return rows.length
}

async function agendarLembretesReuniao(eventoId) {
  const row = await buscarEventoComVinculos(eventoId, null, 'admin')
  if (!row || row.tipo !== 'reuniao' || row.excluido_em) return null
  if (!['pendente', 'confirmado'].includes(row.status)) return null
  if (row.conversa_venda_fechada === true) return null
  if (row.reagendado_para_evento_id) return null
  const numero = numeroDoEvento(row)
  if (!numero) return null
  const inicio = row.data_inicio instanceof Date ? row.data_inicio : new Date(row.data_inicio)
  const enviarEm = adicionarMinutos(inicio, -15)
  if (Number.isNaN(enviarEm.getTime()) || enviarEm <= new Date()) return null
  const { rows } = await pool.query(
    `INSERT INTO vendas.agenda_lembretes
       (evento_id, lead_id, conversa_id, tipo, enviar_em, status, canal)
     VALUES ($1,$2,$3,'15min',$4,'pendente','whatsapp')
     ON CONFLICT (evento_id, tipo) WHERE tipo <> 'manual'
     DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       conversa_id = EXCLUDED.conversa_id,
       enviar_em = EXCLUDED.enviar_em,
       status = CASE WHEN vendas.agenda_lembretes.status = 'enviado' THEN vendas.agenda_lembretes.status ELSE 'pendente' END,
       erro = NULL,
       atualizado_em = NOW()
     RETURNING *`,
    [row.id, row.lead_id || null, row.conversa_id || null, enviarEm]
  )
  const lembrete = rows[0]
  if (lembrete?.status === 'pendente') await enfileirarJobLembreteReuniao(lembrete.id, lembrete.enviar_em)
  return lembrete || null
}

async function registrarHistoricoLembrete(row, mensagem) {
  const numero = numeroDoEvento(row)
  if (!numero) return false
  await pool.query(
    `UPDATE vendas.conversas
     SET historico = (
           CASE WHEN jsonb_typeof(historico) = 'array' THEN historico ELSE '[]'::jsonb END
         ) || $2::jsonb,
         atualizado_em = NOW()
     WHERE numero = $1`,
    [
      numero,
      JSON.stringify([{
        role: 'assistant',
        content: mensagem,
        tipo: 'lembrete_reuniao',
        agenda_evento_id: row.id,
        criado_em: new Date().toISOString(),
      }, {
        role: 'operator',
        content: `[Sistema] Lembrete de reunião enviado para o lead: hoje às ${horarioReuniaoLabel(row)}.`,
        tipo: 'sistema_lembrete_reuniao',
        agenda_evento_id: row.id,
        criado_em: new Date().toISOString(),
      }]),
    ]
  )
  return true
}

async function enviarLembreteReuniao(lembreteId, { manual = false, enviarMensagemFn = enviarMensagem } = {}) {
  const { rows } = await pool.query(
    `SELECT l.*, l.status AS lembrete_status, l.tipo AS lembrete_tipo,
            e.*, e.status AS evento_status, e.tipo AS evento_tipo,
            c.numero AS conversa_numero, c.venda_fechada AS conversa_venda_fechada, lp.numero AS lead_numero,
            lp.apelido, lp.negocio, NULL::text AS nome, lp.contexto_prospeccao
     FROM vendas.agenda_lembretes l
     JOIN vendas.agenda_eventos e ON e.id = l.evento_id
     LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
     LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
     WHERE l.id = $1
     LIMIT 1`,
    [lembreteId]
  )
  const row = rows[0]
  if (!row) throw erroLembrete('lembrete_nao_encontrado', 'Lembrete nao encontrado', 404)
  if (!manual && row.lembrete_status !== 'pendente') return { ok: true, ignorado: true }
  if (row.excluido_em || row.evento_tipo !== 'reuniao' || row.conversa_venda_fechada === true || !['pendente', 'confirmado'].includes(row.evento_status)) {
    await pool.query(`UPDATE vendas.agenda_lembretes SET status = 'cancelado', erro = 'evento_invalido', atualizado_em = NOW() WHERE id = $1`, [lembreteId])
    return { ok: true, cancelado: true }
  }
  if (row.reagendado_para_evento_id) {
    await pool.query(`UPDATE vendas.agenda_lembretes SET status = 'cancelado', erro = 'evento_reagendado', atualizado_em = NOW() WHERE id = $1`, [lembreteId])
    return { ok: true, cancelado: true }
  }
  const numero = numeroDoEvento(row)
  if (!numero) {
    await pool.query(`UPDATE vendas.agenda_lembretes SET status = 'falhou', erro = 'sem_numero', atualizado_em = NOW() WHERE id = $1`, [lembreteId])
    throw erroLembrete('lead_sem_telefone', 'Nao foi possivel enviar lembrete: lead sem telefone valido.')
  }
  const mensagem = gerarMensagemLembreteReuniao(row, row)
  try {
    await enviarMensagemFn(numero, mensagem)
    await registrarHistoricoLembrete(row, mensagem)
    await pool.query(
      `UPDATE vendas.agenda_lembretes
       SET status = 'enviado', enviado_em = NOW(), mensagem = $2, erro = NULL, atualizado_em = NOW()
       WHERE id = $1`,
      [lembreteId, mensagem]
    )
    return { ok: true, enviado: true, mensagem }
  } catch (err) {
    await pool.query(
      `UPDATE vendas.agenda_lembretes
       SET status = 'falhou', erro = $2, atualizado_em = NOW()
       WHERE id = $1`,
      [lembreteId, String(err.message || err).slice(0, 900)]
    )
    const msg = err?.message ? `Falha no WhatsApp/Evolution: ${err.message}` : 'Falha no WhatsApp/Evolution ao enviar lembrete.'
    throw erroLembrete('envio_falhou', msg, 502)
  }
}

async function processarLembreteReuniaoJob(job) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
  const id = Number(payload.lembrete_id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Job agenda_lembrete_reuniao sem lembrete_id')
  return enviarLembreteReuniao(id)
}

function classificarRespostaLembrete(texto) {
  const raw = String(texto || '').trim()
  if (!raw) return null
  const normalizado = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/(nao posso|nao vou conseguir|remarcar|remarca|outro horario|outro dia|preciso reagendar|preciso remarcar|mais tarde|amanha)/i.test(normalizado)) {
    return 'reagendamento_pendente'
  }
  if (/\b(sim|confirmado|confirmo|ok|combinado|estarei)\b|estou disponivel|posso sim|vou participar|pode ser/i.test(normalizado)) {
    return 'reuniao_confirmada'
  }
  return null
}

async function registrarHistoricoRespostaLembrete(numero, eventoId, tipo, texto) {
  const content = tipo === 'reuniao_confirmada'
    ? '[Sistema] Lead confirmou disponibilidade para a reuniao.'
    : '[Sistema] Lead pediu reagendamento da reuniao.'
  await pool.query(
    `UPDATE vendas.conversas
     SET historico = (
           CASE WHEN jsonb_typeof(historico) = 'array' THEN historico ELSE '[]'::jsonb END
         ) || $2::jsonb,
         atualizado_em = NOW()
     WHERE numero = $1`,
    [
      numero,
      JSON.stringify([{
        role: 'operator',
        content,
        tipo,
        agenda_evento_id: eventoId,
        resposta_lead: String(texto || '').slice(0, 300),
        criado_em: new Date().toISOString(),
      }]),
    ]
  )
}

async function registrarSugestaoReagendamentoLembrete(row, enviarMensagemFn = enviarMensagem) {
  const numero = numeroDoEvento(row)
  if (!numero) return null
  const slots = await buscarSlotsDisponiveis({
    dataInicial: new Date(),
    quantidade: 2,
    usuarioId: row.usuario_id || null,
  })
  const horarios = Array.isArray(slots?.horarios_sugeridos) ? slots.horarios_sugeridos.filter(Boolean) : []
  if (!horarios.length) return null
  const dataLabel = slots.data_label || 'em outro horario'
  const opcoes = horarios.length === 1 ? horarios[0] : `${horarios[0]} ou ${horarios[1]}`
  const mensagem = `Sem problema, a gente remarca. Tenho ${dataLabel} às ${opcoes} com a equipe da PJ Codeworks. Qual desses horários fica melhor pra você?`
  await enviarMensagemFn(numero, mensagem)
  await pool.query(
    `UPDATE vendas.conversas
     SET historico = (
           CASE WHEN jsonb_typeof(historico) = 'array' THEN historico ELSE '[]'::jsonb END
         ) || $2::jsonb,
         atualizado_em = NOW()
     WHERE numero = $1`,
    [
      numero,
      JSON.stringify([{
        role: 'assistant',
        content: mensagem,
        tipo: 'sugestao_reagendamento_reuniao',
        agenda_evento_id: row.id,
        criado_em: new Date().toISOString(),
      }]),
    ]
  )
  return { mensagem, disponibilidade: slots }
}

async function registrarRespostaLembreteReuniao(numero, texto, opts = {}) {
  const tipoResposta = classificarRespostaLembrete(texto)
  const jid = String(numero || '').trim()
  if (!tipoResposta || !jid) return null
  const { rows } = await pool.query(
    `SELECT e.id, e.usuario_id, e.metadata, c.numero AS conversa_numero, lp.numero AS lead_numero
     FROM vendas.agenda_eventos e
     LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
     LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
     WHERE e.excluido_em IS NULL
       AND e.tipo = 'reuniao'
       AND e.status IN ('pendente', 'confirmado')
       AND (c.numero = $1 OR lp.numero = $1 OR e.metadata->>'lead_numero' = $1)
       AND e.data_inicio >= NOW() - INTERVAL '2 hours'
       AND e.data_inicio <= NOW() + INTERVAL '7 days'
       AND EXISTS (
         SELECT 1 FROM vendas.agenda_lembretes l
         WHERE l.evento_id = e.id
           AND l.status = 'enviado'
       )
     ORDER BY e.data_inicio ASC
     LIMIT 1`,
    [jid]
  )
  const evento = rows[0]
  if (!evento) return null
  const patch = {
    lembrete_resposta: tipoResposta,
    lembrete_resposta_em: new Date().toISOString(),
  }
  const novoStatus = tipoResposta === 'reuniao_confirmada' ? 'confirmado' : 'reagendamento_pendente'
  await pool.query(
    `UPDATE vendas.agenda_eventos
     SET status = $2,
         metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
         atualizado_em = NOW()
     WHERE id = $1 AND excluido_em IS NULL`,
    [evento.id, novoStatus, JSON.stringify(patch)]
  )
  await registrarHistoricoRespostaLembrete(jid, evento.id, tipoResposta, texto)
  let sugestao = null
  if (tipoResposta === 'reagendamento_pendente') {
    sugestao = await registrarSugestaoReagendamentoLembrete(evento, opts.enviarMensagemFn || enviarMensagem)
  }
  return {
    evento_id: evento.id,
    resposta: tipoResposta,
    status: novoStatus,
    sugestao_reagendamento: sugestao,
    mensagem_enviada: Boolean(sugestao?.mensagem),
  }
}

async function marcarNaoCompareceuEvento(row, usuarioId, observacao = '') {
  const metadata = {
    ...((row.metadata && typeof row.metadata === 'object') ? row.metadata : {}),
    nao_compareceu: true,
    nao_compareceu_observacao: normalizarTexto(observacao, 500),
  }
  const { rows } = await pool.query(
    `UPDATE vendas.agenda_eventos
     SET status = 'nao_compareceu',
         nao_compareceu_em = COALESCE(nao_compareceu_em, NOW()),
         marcado_por = $2,
         metadata = $3::jsonb,
         atualizado_em = NOW()
     WHERE id = $1 AND excluido_em IS NULL
     RETURNING *`,
    [row.id, usuarioId, JSON.stringify(metadata)]
  )
  return rows[0] || null
}

async function listarEventos({ query, user }) {
  const periodo = periodoQuery(query)
  if (periodo.erro) return { ok: false, erro: periodo.erro }

  const params = [periodo.inicio, periodo.fim]
  const wheres = [
    `e.excluido_em IS NULL`,
    `e.data_inicio >= ($1::date::timestamp AT TIME ZONE $8)`,
    `e.data_inicio < (($2::date::timestamp + INTERVAL '1 day') AT TIME ZONE $8)`,
    `($3::text IS NULL OR e.status = $3::text)`,
    `($4::text IS NULL OR e.tipo = $4::text)`,
    `($5::int IS NULL OR e.lead_id = $5::int)`,
    `($6::int IS NULL OR e.conversa_id = $6::int)`,
    `($7::bigint IS NULL OR e.usuario_id = $7::bigint)`,
  ]
  params.push(query.status || null, query.tipo || null, normalizarIdOpcional(query.lead_id), normalizarIdOpcional(query.conversa_id))
  params.push(user.role === 'admin' ? normalizarIdOpcional(query.usuario_id) : user.id)
  params.push(TIMEZONE)

  const { rows } = await pool.query(
    `SELECT e.*, c.numero AS conversa_numero, lp.numero AS lead_numero
     FROM vendas.agenda_eventos e
     LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
     LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
     LEFT JOIN LATERAL (
       SELECT l.status AS lembrete_status, l.enviado_em AS lembrete_enviado_em, l.erro AS lembrete_erro
       FROM vendas.agenda_lembretes l
       WHERE l.evento_id = e.id
         AND l.status <> 'cancelado'
       ORDER BY l.enviado_em DESC NULLS LAST, l.enviar_em DESC, l.id DESC
       LIMIT 1
     ) lemb ON true
     WHERE ${wheres.join(' AND ')}
     ORDER BY e.data_inicio ASC, e.id ASC`,
    params
  )
  const eventos = rows.map((row) => mapEvento(row))
  return {
    ok: true,
    eventos,
    resumo: montarResumo(eventos),
    periodo,
  }
}

function registerAgendaRoutes(app) {
  app.get('/dashboard/agenda/resumo', async (req, res) => {
    try {
      const data = parseDateOnly(req.query.data) || dataLocal()
      const out = await listarEventos({ query: { ...req.query, data }, user: req.dashboardUser })
      if (!out.ok) return jsonErro(res, 400, out.erro)
      res.json({ ok: true, resumo: out.resumo, periodo: out.periodo })
    } catch (err) {
      logger.error('GET /dashboard/agenda/resumo:', err.message)
      jsonErro(res, 500, 'Falha ao carregar resumo da agenda')
    }
  })

  app.get('/dashboard/agenda/disponibilidade', async (req, res) => {
    try {
      const dataInicio = parseDateTime(req.query?.data_inicio)
      const dataFim = parseDateTime(req.query?.data_fim)
      if (dataInicio && dataFim) {
        if (dataFim <= dataInicio) return jsonErro(res, 400, 'Datas invalidas')
        const ocupado = await existeConflitoAgenda(dataInicio, dataFim, req.dashboardUser.id)
        return res.json({ ok: true, ocupado, disponivel: !ocupado })
      }
      const quantidade = Math.min(Math.max(parseInt(req.query?.quantidade, 10) || 2, 1), 8)
      const duracaoMinutos = Math.min(Math.max(parseInt(req.query?.duracao_minutos, 10) || 15, 5), 180)
      const dataInicial = req.query?.data_inicial ? parseDateTime(req.query.data_inicial) : new Date()
      const slots = await buscarSlotsDisponiveis({
        dataInicial: dataInicial || new Date(),
        duracaoMinutos,
        quantidade,
        usuarioId: req.dashboardUser.id,
      })
      res.json({ ok: true, disponibilidade: slots })
    } catch (err) {
      logger.error('GET /dashboard/agenda/disponibilidade:', err.message)
      jsonErro(res, 500, 'Falha ao consultar disponibilidade')
    }
  })

  app.post('/dashboard/agenda/bloqueios', async (req, res) => {
    try {
      const parsed = payloadBloqueio(req.body, req.dashboardUser.id)
      if (!parsed.ok) return jsonErro(res, 400, 'Dados invalidos', parsed.issues)
      const recorrenciaId = parsed.value.recorrente ? crypto.randomUUID() : null
      const principal = await inserirEvento(parsed.value, req.dashboardUser.id, recorrenciaId, 'manual')
      let ocorrencias = []
      if (parsed.value.recorrente) {
        const futuras = gerarOcorrenciasRecorrentes(parsed.value, parsed.value.regra_recorrencia)
        for (const futura of futuras) {
          ocorrencias.push(await inserirEvento(futura, req.dashboardUser.id, recorrenciaId, 'manual'))
        }
      }
      res.status(201).json({
        ok: true,
        bloqueio: mapEvento(principal),
        evento: mapEvento(principal),
        ocorrencias_criadas: ocorrencias.length,
      })
    } catch (err) {
      logger.error('POST /dashboard/agenda/bloqueios:', err.message)
      jsonErro(res, 500, 'Falha ao criar bloqueio')
    }
  })

  app.patch('/dashboard/agenda/bloqueios/:id', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual || atual.tipo !== 'bloqueio') return jsonErro(res, 404, 'Bloqueio nao encontrado')
      const parsed = payloadBloqueio(req.body, req.dashboardUser.id, true)
      if (!parsed.ok) return jsonErro(res, 400, 'Dados invalidos', parsed.issues)
      const value = parsed.value
      const mergedInicio = value.data_inicio || atual.data_inicio
      const mergedFim = value.data_fim || atual.data_fim
      if (new Date(mergedFim) <= new Date(mergedInicio)) return jsonErro(res, 400, 'data_fim deve ser maior que data_inicio')
      const metadata = {
        ...((atual.metadata && typeof atual.metadata === 'object') ? atual.metadata : {}),
        ...((value.metadata && typeof value.metadata === 'object') ? value.metadata : {}),
      }
      const descricao = value.descricao ?? metadata.motivo ?? atual.descricao
      const { rows } = await pool.query(
        `UPDATE vendas.agenda_eventos
         SET titulo = 'Horário bloqueado',
             descricao = $2,
             tipo = 'bloqueio',
             status = 'bloqueado',
             prioridade = COALESCE($3, prioridade),
             data_inicio = COALESCE($4, data_inicio),
             data_fim = COALESCE($5, data_fim),
             lead_id = NULL,
             conversa_id = NULL,
             recorrente = COALESCE($6, recorrente),
             regra_recorrencia = COALESCE($7::jsonb, regra_recorrencia),
             metadata = $8::jsonb,
             concluido_em = NULL,
             atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL
         RETURNING *`,
        [
          id,
          descricao,
          value.prioridade ?? null,
          value.data_inicio ?? null,
          value.data_fim ?? null,
          Object.prototype.hasOwnProperty.call(value, 'recorrente') ? value.recorrente : null,
          Object.prototype.hasOwnProperty.call(value, 'regra_recorrencia') ? JSON.stringify(value.regra_recorrencia) : null,
          JSON.stringify(metadata),
        ]
      )
      res.json({ ok: true, bloqueio: mapEvento(rows[0]), evento: mapEvento(rows[0]) })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/bloqueios/:id:', err.message)
      jsonErro(res, 500, 'Falha ao editar bloqueio')
    }
  })

  app.delete('/dashboard/agenda/bloqueios/:id', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual || atual.tipo !== 'bloqueio') return jsonErro(res, 404, 'Bloqueio nao encontrado')
      await pool.query(
        `UPDATE vendas.agenda_eventos
         SET excluido_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL`,
        [id]
      )
      res.json({ ok: true })
    } catch (err) {
      logger.error('DELETE /dashboard/agenda/bloqueios/:id:', err.message)
      jsonErro(res, 500, 'Falha ao remover bloqueio')
    }
  })

  app.post('/dashboard/agenda/:id/lembrete-agora', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoComVinculos(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual || atual.tipo !== 'reuniao') return jsonErro(res, 404, 'Reuniao nao encontrada', { code: 'evento_nao_encontrado' })
      const numero = numeroDoEvento(atual)
      if (!numero) return jsonErro(res, 400, 'Este compromisso nao possui lead/conversa vinculada para envio de lembrete.', { code: 'lead_sem_telefone' })
      if (!['pendente', 'confirmado'].includes(atual.status)) return jsonErro(res, 400, 'Esta reuniao nao aceita lembrete', { code: 'evento_status_invalido' })
      const { rows: recentes } = await pool.query(
        `SELECT id
         FROM vendas.agenda_lembretes
         WHERE evento_id = $1
           AND status = 'enviado'
           AND enviado_em >= NOW() - INTERVAL '10 minutes'
         LIMIT 1`,
        [id]
      )
      if (recentes.length && !req.body?.confirmar_reenvio) {
        return jsonErro(res, 409, 'Lembrete enviado recentemente. Confirme antes de reenviar.', { code: 'lembrete_recente' })
      }
      const { rows: manuais } = await pool.query(
        `SELECT id
         FROM vendas.agenda_lembretes
         WHERE evento_id = $1
           AND tipo = 'manual'
         ORDER BY id DESC
         LIMIT 1`,
        [id]
      )
      let lembrete
      if (manuais[0]?.id) {
        const { rows } = await pool.query(
          `UPDATE vendas.agenda_lembretes
           SET lead_id = $2,
               conversa_id = $3,
               enviar_em = NOW(),
               status = 'pendente',
               erro = NULL,
               atualizado_em = NOW()
           WHERE id = $1
           RETURNING *`,
          [manuais[0].id, atual.lead_id || null, atual.conversa_id || null]
        )
        lembrete = rows[0]
      } else {
        const { rows } = await pool.query(
          `INSERT INTO vendas.agenda_lembretes
             (evento_id, lead_id, conversa_id, tipo, enviar_em, status, canal)
           VALUES ($1,$2,$3,'manual',NOW(),'pendente','whatsapp')
           RETURNING *`,
          [id, atual.lead_id || null, atual.conversa_id || null]
        )
        lembrete = rows[0]
      }
      const envio = await enviarLembreteReuniao(lembrete.id, { manual: true })
      res.json({
        ok: true,
        message: 'Lembrete enviado com sucesso.',
        lembrete_id: lembrete.id,
        evento: {
          id,
          lembrete_status: 'enviado',
          lembrete_enviado_em: new Date().toISOString(),
        },
        enviado: envio.enviado === true,
      })
    } catch (err) {
      logger.error('POST /dashboard/agenda/:id/lembrete-agora:', err.message)
      jsonErro(res, err.status || 500, err.message || 'Falha ao enviar lembrete', { code: err.code || 'envio_falhou' })
    }
  })

  app.get('/dashboard/agenda/:id', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const row = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!row) return jsonErro(res, 404, 'Evento nao encontrado')
      res.json({ ok: true, evento: mapEvento(row) })
    } catch (err) {
      logger.error('GET /dashboard/agenda/:id:', err.message)
      jsonErro(res, 500, 'Falha ao carregar evento')
    }
  })

  app.get('/dashboard/agenda', async (req, res) => {
    try {
      const out = await listarEventos({ query: req.query, user: req.dashboardUser })
      if (!out.ok) return jsonErro(res, 400, out.erro)
      res.json({ ok: true, eventos: out.eventos, resumo: out.resumo, periodo: out.periodo })
    } catch (err) {
      logger.error('GET /dashboard/agenda:', err.message)
      jsonErro(res, 500, 'Falha ao carregar agenda')
    }
  })

  app.post('/dashboard/agenda', async (req, res) => {
    try {
      const parsed = validarPayloadEvento(req.body, req.dashboardUser.id)
      if (!parsed.ok) return jsonErro(res, 400, 'Dados invalidos', parsed.issues)
      if (parsed.value.tipo !== 'bloqueio') {
        const ocupado = await existeConflitoAgenda(parsed.value.data_inicio, parsed.value.data_fim, req.dashboardUser.id)
        if (ocupado) return jsonErro(res, 409, 'Esse horario esta bloqueado na agenda. Escolha outro horario.')
      }
      const recorrenciaId = parsed.value.recorrente ? crypto.randomUUID() : null
      const principal = await inserirEvento(parsed.value, req.dashboardUser.id, recorrenciaId)
      await agendarLembretesReuniao(principal.id)
      let ocorrencias = []
      if (parsed.value.recorrente) {
        const futuras = gerarOcorrenciasRecorrentes(parsed.value, parsed.value.regra_recorrencia)
        for (const futura of futuras) {
          const occ = await inserirEvento(futura, req.dashboardUser.id, recorrenciaId)
          await agendarLembretesReuniao(occ.id)
          ocorrencias.push(occ)
        }
      }
      res.status(201).json({
        ok: true,
        evento: mapEvento(principal),
        ocorrencias_criadas: ocorrencias.length,
      })
    } catch (err) {
      logger.error('POST /dashboard/agenda:', err.message)
      jsonErro(res, 500, 'Falha ao criar compromisso')
    }
  })

  app.patch('/dashboard/agenda/:id/concluir', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual) return jsonErro(res, 404, 'Evento nao encontrado')
      await cancelarLembretesEvento(id, 'evento_concluido')
      const { rows } = await pool.query(
        `UPDATE vendas.agenda_eventos
         SET status = 'concluido', concluido_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL
         RETURNING *`,
        [id]
      )
      res.json({ ok: true, evento: mapEvento(rows[0]) })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/:id/concluir:', err.message)
      jsonErro(res, 500, 'Falha ao concluir evento')
    }
  })

  app.patch('/dashboard/agenda/:id/reagendar', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const dataInicio = parseDateTime(req.body?.data_inicio)
      const dataFim = parseDateTime(req.body?.data_fim)
      if (!dataInicio || !dataFim || dataFim <= dataInicio) {
        return jsonErro(res, 400, 'Datas invalidas')
      }
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual) return jsonErro(res, 404, 'Evento nao encontrado')
      if (atual.tipo !== 'bloqueio') {
        const ocupado = await existeConflitoAgenda(dataInicio, dataFim, atual.usuario_id || req.dashboardUser.id, id)
        if (ocupado) return jsonErro(res, 409, 'Esse horario esta bloqueado na agenda. Escolha outro horario.')
      }
      await cancelarLembretesEvento(id, 'evento_reagendado')
      const { rows } = await pool.query(
        `UPDATE vendas.agenda_eventos
         SET data_inicio = $2, data_fim = $3, status = 'pendente', concluido_em = NULL, atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL
         RETURNING *`,
        [id, dataInicio, dataFim]
      )
      await agendarLembretesReuniao(id)
      res.json({ ok: true, evento: mapEvento(rows[0]) })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/:id/reagendar:', err.message)
      jsonErro(res, 500, 'Falha ao reagendar compromisso')
    }
  })

  app.patch('/dashboard/agenda/:id/nao-compareceu', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoComVinculos(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual || atual.tipo !== 'reuniao') return jsonErro(res, 404, 'Reuniao nao encontrada')
      if (atual.status === 'nao_compareceu') return res.json({ ok: true, evento: mapEvento(atual), ja_marcado: true })
      const row = await marcarNaoCompareceuEvento(atual, req.dashboardUser.id, req.body?.observacao)
      await cancelarLembretesEvento(id, 'nao_compareceu')
      await registrarHistoricoNaoCompareceu(atual)
      res.json({ ok: true, evento: mapEvento({ ...atual, ...row }) })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/:id/nao-compareceu:', err.message)
      jsonErro(res, 500, 'Falha ao marcar nao comparecimento')
    }
  })

  app.post('/dashboard/agenda/:id/reagendar-nao-comparecimento', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoComVinculos(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual || atual.tipo !== 'reuniao') return jsonErro(res, 404, 'Reuniao nao encontrada')
      const dataInicio = parseDateTime(req.body?.nova_data_inicio)
      const dataFimRaw = parseDateTime(req.body?.nova_data_fim)
      const dataFim = dataFimRaw || (dataInicio ? new Date(dataInicio.getTime() + 15 * 60 * 1000) : null)
      if (!dataInicio || !dataFim || dataFim <= dataInicio) return jsonErro(res, 400, 'Datas invalidas')
      if ((dataFim.getTime() - dataInicio.getTime()) !== 15 * 60 * 1000) return jsonErro(res, 400, 'Reuniao deve durar 15 minutos')

      const { rows: existentes } = await pool.query(
        `SELECT id
         FROM vendas.agenda_eventos
         WHERE reagendado_de_evento_id = $1
           AND excluido_em IS NULL
           AND status IN ('pendente', 'confirmado')
         LIMIT 1`,
        [id]
      )
      if (existentes.length) return jsonErro(res, 409, 'Ja existe um reagendamento ativo para esta reuniao.')

      const ocupado = await existeConflitoAgenda(dataInicio, dataFim, atual.usuario_id || req.dashboardUser.id, id)
      if (ocupado) return jsonErro(res, 409, 'Esse horario esta bloqueado na agenda. Escolha outro horario.')

      const marcado = atual.status === 'nao_compareceu'
        ? atual
        : await marcarNaoCompareceuEvento(atual, req.dashboardUser.id, req.body?.observacao)
      if (atual.status !== 'nao_compareceu') await registrarHistoricoNaoCompareceu(atual, 'Reagendamento iniciado pelo operador.')
      await cancelarLembretesEvento(id, 'reagendamento_nao_comparecimento')

      const metadataOriginal = atual.metadata && typeof atual.metadata === 'object' ? atual.metadata : {}
      const values = {
        titulo: `Reagendamento - ${String(atual.titulo || 'Reunião').slice(0, 142)}`,
        descricao: normalizarTexto(req.body?.observacao || atual.descricao || 'Reagendamento por não comparecimento.', 2000),
        tipo: 'reuniao',
        status: 'pendente',
        prioridade: atual.prioridade || 'alta',
        data_inicio: dataInicio,
        data_fim: dataFim,
        lead_id: atual.lead_id || null,
        conversa_id: atual.conversa_id || null,
        recorrente: false,
        regra_recorrencia: null,
        metadata: {
          ...metadataOriginal,
          origem_reagendamento: 'nao_comparecimento',
          reagendado_de_evento_id: id,
          observacao_reagendamento: normalizarTexto(req.body?.observacao, 500),
        },
      }
      const novoInserido = await inserirEvento(values, atual.usuario_id || req.dashboardUser.id, null, 'reagendamento_nao_comparecimento')
      const { rows: novoRows } = await pool.query(
        `UPDATE vendas.agenda_eventos
         SET reagendado_de_evento_id = $2,
             motivo_reagendamento = $3,
             marcado_por = $4,
             atualizado_em = NOW()
         WHERE id = $1
         RETURNING *`,
        [novoInserido.id, id, 'nao_comparecimento', req.dashboardUser.id]
      )
      const novo = novoRows[0] || novoInserido
      await agendarLembretesReuniao(novo.id)
      await pool.query(
        `UPDATE vendas.agenda_eventos
         SET reagendado_para_evento_id = $2,
             motivo_reagendamento = $3,
             atualizado_em = NOW()
         WHERE id = $1`,
        [id, novo.id, 'nao_comparecimento']
      )
      res.status(201).json({ ok: true, evento_original: mapEvento({ ...atual, ...marcado, reagendado_para_evento_id: novo.id }), evento: mapEvento(novo) })
    } catch (err) {
      logger.error('POST /dashboard/agenda/:id/reagendar-nao-comparecimento:', err.message)
      jsonErro(res, 500, 'Falha ao reagendar nao comparecimento')
    }
  })

  app.patch('/dashboard/agenda/:id', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual) return jsonErro(res, 404, 'Evento nao encontrado')
      const parsed = validarPayloadEvento(req.body, req.dashboardUser.id, true)
      if (!parsed.ok) return jsonErro(res, 400, 'Dados invalidos', parsed.issues)
      const value = parsed.value
      const mergedInicio = value.data_inicio || atual.data_inicio
      const mergedFim = value.data_fim || atual.data_fim
      if (new Date(mergedFim) <= new Date(mergedInicio)) return jsonErro(res, 400, 'data_fim deve ser maior que data_inicio')
      const mergedTipo = value.tipo || atual.tipo
      if (mergedTipo !== 'bloqueio') {
        const ocupado = await existeConflitoAgenda(mergedInicio, mergedFim, atual.usuario_id || req.dashboardUser.id, id)
        if (ocupado) return jsonErro(res, 409, 'Esse horario esta bloqueado na agenda. Escolha outro horario.')
      }
      const { rows } = await pool.query(
        `UPDATE vendas.agenda_eventos
         SET titulo = COALESCE($2, titulo),
             descricao = COALESCE($3, descricao),
             tipo = COALESCE($4, tipo),
             status = COALESCE($5, status),
             prioridade = COALESCE($6, prioridade),
             data_inicio = COALESCE($7, data_inicio),
             data_fim = COALESCE($8, data_fim),
             lead_id = $9,
             conversa_id = $10,
             recorrente = COALESCE($11, recorrente),
             regra_recorrencia = COALESCE($12::jsonb, regra_recorrencia),
             metadata = COALESCE($13::jsonb, metadata),
             concluido_em = CASE WHEN $5 = 'concluido' AND concluido_em IS NULL THEN NOW() WHEN $5 = 'pendente' THEN NULL ELSE concluido_em END,
             atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL
         RETURNING *`,
        [
          id,
          value.titulo ?? null,
          value.descricao ?? null,
          value.tipo ?? null,
          value.status ?? null,
          value.prioridade ?? null,
          value.data_inicio ?? null,
          value.data_fim ?? null,
          Object.prototype.hasOwnProperty.call(value, 'lead_id') ? value.lead_id : atual.lead_id,
          Object.prototype.hasOwnProperty.call(value, 'conversa_id') ? value.conversa_id : atual.conversa_id,
          Object.prototype.hasOwnProperty.call(value, 'recorrente') ? value.recorrente : null,
          Object.prototype.hasOwnProperty.call(value, 'regra_recorrencia') ? JSON.stringify(value.regra_recorrencia) : null,
          Object.prototype.hasOwnProperty.call(value, 'metadata') ? JSON.stringify(value.metadata) : null,
        ]
      )
      if (value.data_inicio || value.data_fim || value.status || value.tipo) {
        await cancelarLembretesEvento(id, 'evento_editado')
        await agendarLembretesReuniao(id)
      }
      res.json({ ok: true, evento: mapEvento(rows[0]) })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/:id:', err.message)
      jsonErro(res, 500, 'Falha ao editar evento')
    }
  })

  app.delete('/dashboard/agenda/:id', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual) return jsonErro(res, 404, 'Evento nao encontrado')
      await cancelarLembretesEvento(id, 'evento_excluido')
      await pool.query(
        `UPDATE vendas.agenda_eventos
         SET excluido_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND excluido_em IS NULL`,
        [id]
      )
      res.json({ ok: true })
    } catch (err) {
      logger.error('DELETE /dashboard/agenda/:id:', err.message)
      jsonErro(res, 500, 'Falha ao excluir evento')
    }
  })
}

// ─── DISPONIBILIDADE DE SLOTS ──────────────────────────────────────────────

function temConflito(slotInicio, slotFim, eventoInicio, eventoFim) {
  return slotInicio < eventoFim && slotFim > eventoInicio
}

/**
 * Retorna true se existe evento ativo que sobrepõe [dataInicio, dataFim).
 * Usado para re-validar antes de criar evento de reunião.
 */
async function slotEstaOcupado(dataInicio, dataFim, usuarioId = null) {
  const uid = Number(usuarioId) > 0 ? Number(usuarioId) : null
  const inicio = dataInicio instanceof Date ? dataInicio : new Date(dataInicio)
  const fim = dataFim instanceof Date ? dataFim : new Date(dataFim)
  const params = [inicio, fim, Array.from(STATUS_OCUPA_HORARIO)]
  if (uid) params.push(uid)
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM vendas.agenda_eventos
       WHERE excluido_em IS NULL
         AND status = ANY($3::text[])
         AND data_inicio < $2
         AND data_fim > $1
         ${uid ? 'AND usuario_id = $4' : ''}`,
      params
    )
    return parseInt(rows[0]?.n || '0', 10) > 0
  } catch {
    return false
  }
}

/**
 * Consulta a agenda e retorna os próximos slots livres para reunião de proposta.
 * Respeita a janela comercial (19:30–21:15) em dias úteis, timezone America/Sao_Paulo.
 * Retorna objeto no mesmo formato de sugestaoReuniaoProposta:
 *   { data_sugerida, data_label, horarios_sugeridos }
 */
async function buscarSlotsDisponiveis({ dataInicial = new Date(), duracaoMinutos = 15, quantidade = 2, usuarioId = null } = {}) {
  const DIAS_PT = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
  const agora = dataInicial instanceof Date ? dataInicial : new Date(dataInicial)
  const p = partesDataBrasil(agora)
  const minAtual = p.hour * 60 + p.minute
  const diaUtil = p.weekday >= 1 && p.weekday <= 5
  const minMesmoDia = 18 * 60 + 30 // 18:30 — a partir daqui pode oferecer hoje

  const uid = Number(usuarioId) > 0 ? Number(usuarioId) : null

  // Monta lista de dias candidatos (até 7 dias úteis à frente)
  const diasParaVerificar = []

  if (diaUtil && minAtual >= minMesmoDia) {
    const hojeSlots = REUNIAO_PROPOSTA_HORARIOS_PADRAO.filter((h) => {
      const [hh, mm] = h.split(':').map(Number)
      return hh * 60 + mm >= minAtual + 15
    })
    if (hojeSlots.length > 0) {
      diasParaVerificar.push({ iso: isoDateBrasil(agora), label: 'hoje', candidatos: hojeSlots })
    }
  }

  let cursor = new Date(agora)
  let primeiroDiaUtil = true
  while (diasParaVerificar.length < 7) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    const pd = partesDataBrasil(cursor)
    if (pd.weekday >= 1 && pd.weekday <= 5) {
      const iso = isoDateBrasil(cursor)
      const label = primeiroDiaUtil && diasParaVerificar.length === 0 ? 'amanha' : DIAS_PT[pd.weekday]
      primeiroDiaUtil = false
      diasParaVerificar.push({ iso, label, candidatos: REUNIAO_PROPOSTA_HORARIOS_PADRAO.slice() })
    }
  }

  for (const dia of diasParaVerificar) {
    const [year, month, day] = dia.iso.split('-').map(Number)
    let eventos = []
    try {
      const params = [dia.iso, TIMEZONE, Array.from(STATUS_OCUPA_HORARIO)]
      if (uid) params.push(uid)
      const { rows } = await pool.query(
        `SELECT data_inicio, data_fim FROM vendas.agenda_eventos
         WHERE excluido_em IS NULL
           AND status = ANY($3::text[])
           AND data_inicio < (($1::date::timestamp + INTERVAL '1 day') AT TIME ZONE $2)
           AND data_fim > ($1::date::timestamp AT TIME ZONE $2)
           ${uid ? 'AND usuario_id = $4' : ''}`,
        params
      )
      eventos = rows
    } catch {
      // Em falha de BD, retorna candidatos sem filtrar (melhor do que travar o fluxo)
      return { data_sugerida: dia.iso, data_label: dia.label, horarios_sugeridos: dia.candidatos.slice(0, quantidade) }
    }

    const livres = dia.candidatos.filter((slotLabel) => {
      const [hh, mm] = slotLabel.split(':').map(Number)
      const slotInicio = utcParaDataLocalEmTimezone({ year, month, day, hour: hh, minute: mm }, TIMEZONE)
      const slotFim = new Date(slotInicio.getTime() + duracaoMinutos * 60 * 1000)
      return !eventos.some((ev) => temConflito(slotInicio, slotFim, new Date(ev.data_inicio), new Date(ev.data_fim)))
    })

    if (livres.length > 0) {
      return { data_sugerida: dia.iso, data_label: dia.label, horarios_sugeridos: livres.slice(0, quantidade) }
    }
  }

  // Fallback absoluto (não deve ocorrer em condições normais)
  const fb = diasParaVerificar[0] || { iso: isoDateBrasil(agora), label: 'amanha' }
  return { data_sugerida: fb.iso, data_label: fb.label, horarios_sugeridos: REUNIAO_PROPOSTA_HORARIOS_PADRAO.slice(0, quantidade) }
}

module.exports = {
  TIMEZONE,
  criarEventoAgenda,
  buscarSlotsDisponiveis,
  existeConflitoAgenda,
  agendarLembretesReuniao,
  cancelarLembretesEvento,
  enviarLembreteReuniao,
  gerarMensagemLembreteReuniao,
  processarLembreteReuniaoJob,
  registrarRespostaLembreteReuniao,
  slotEstaOcupado,
  temConflito,
  gerarOcorrenciasRecorrentes,
  listarEventos,
  mapEvento,
  montarResumo,
  normalizarRegraRecorrencia,
  periodoQuery,
  registerAgendaRoutes,
  statusEfetivo,
  validarPayloadEvento,
}
