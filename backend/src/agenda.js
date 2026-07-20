'use strict'

const crypto = require('crypto')
const { pool } = require('./db')
const { logger } = require('./logger')
const { enviarMensagem } = require('./whatsapp')
const mensagensSvc = require('./services/mensagens-automaticas')
const { empresaAgentePausada } = require('./db/empresas')
const {
  REUNIAO_PROPOSTA_HORARIOS_PADRAO,
  horariosPadraoParaWeekday,
  diaAtendeReuniao,
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

// Buffer (minutos) exigido ENTRE reuniões: se uma estender, não atropela a próxima.
// Configurável por REUNIAO_BUFFER_MIN (default 30). Aplicado expandindo a janela do
// horário candidato ao checar conflito — a reunião gravada continua com a duração real.
const REUNIAO_BUFFER_MINUTOS = (() => {
  const n = parseInt(process.env.REUNIAO_BUFFER_MIN, 10)
  return Number.isFinite(n) && n >= 0 ? n : 30
})()

// Expande [inicio, fim] pelo buffer dos dois lados (garante folga antes E depois).
function janelaComBufferReuniao(inicio, fim, bufferMin = REUNIAO_BUFFER_MINUTOS) {
  const ms = Math.max(0, bufferMin) * 60 * 1000
  return {
    inicio: new Date(new Date(inicio).getTime() - ms),
    fim: new Date(new Date(fim).getTime() + ms),
  }
}

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
    venda_fechada: row.conversa_venda_fechada === true,
    venda_valor: row.conversa_venda_valor != null ? Number(row.conversa_venda_valor) : null,
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
    // Reunião respeita o buffer (folga p/ não atropelar a próxima); outros tipos, exato.
    const janela = values.tipo === 'reuniao'
      ? janelaComBufferReuniao(values.data_inicio, values.data_fim)
      : { inicio: values.data_inicio, fim: values.data_fim }
    const ocupado = await existeConflitoAgenda(janela.inicio, janela.fim, uid)
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
    `SELECT e.*, c.numero AS conversa_numero, c.venda_fechada AS conversa_venda_fechada, c.venda_valor AS conversa_venda_valor, lp.numero AS lead_numero
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

// Saudação (sensível ao nome) por tipo de lembrete. Continua no código porque
// depende do nome do lead; entra no template via placeholder {saudacao}.
function saudacaoLembrete(tipo, nome) {
  if (tipo === 'dia') return nome ? `Oi, ${nome}, bom dia! 😊` : 'Bom dia! 😊'
  if (tipo === 'agora') return nome ? `${nome}, chegou a hora! 🙌` : 'Chegou a hora! 🙌'
  return nome ? `Oi, ${nome}, tudo bem?` : 'Oi, tudo bem?'
}
function chaveLembrete(tipo) {
  return tipo === 'dia' ? 'lembrete_dia' : tipo === 'agora' ? 'lembrete_agora' : 'lembrete_15min'
}
function valoresLembrete(evento, lead = {}, tipo = '15min') {
  const nome = normalizarTexto(lead.apelido || lead.nome || lead.negocio || lead.empresa, 80)
  return { nome, hora: horarioReuniaoLabel(evento), saudacao: saudacaoLembrete(tipo, nome) }
}

// Versão SÍNCRONA (template default, nome da empresa padrão) — back-compat e
// fallback. O envio real usa montarMensagemLembrete (empresa-aware) abaixo.
function gerarMensagemLembreteReuniao(evento, lead = {}, tipo = '15min') {
  const template = mensagensSvc.defaultsDoGrupo('gatilhos_agenda')[chaveLembrete(tipo)]
  return mensagensSvc.renderTemplate(template, { ...valoresLembrete(evento, lead, tipo), empresa: require('./db/empresas').NOME_PADRAO })
}

// Versão empresa-aware: resolve o template salvo do contexto ativo da empresa dona
// do evento e injeta o nome certo. Fail-open (cai no default) via resolverMensagem.
async function montarMensagemLembrete(row, tipo = '15min', empresaId = null) {
  return mensagensSvc.resolverMensagem(pool, {
    empresaId,
    evolutionInstance: row?.evolution_instance || null,
    grupo: 'gatilhos_agenda',
    chave: chaveLembrete(tipo),
    values: valoresLembrete(row, row, tipo),
    log: logger,
  })
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

// Insere/atualiza um lembrete de UM tipo da reunião e enfileira o job de envio.
// Idempotente por (evento_id, tipo); preserva o que já foi 'enviado' (não re-envia).
async function inserirLembreteReuniao(row, tipo, enviarEm) {
  const quando = enviarEm instanceof Date ? enviarEm : new Date(enviarEm)
  if (Number.isNaN(quando.getTime())) return null
  const { rows } = await pool.query(
    `INSERT INTO vendas.agenda_lembretes
       (evento_id, lead_id, conversa_id, tipo, enviar_em, status, canal)
     VALUES ($1,$2,$3,$4,$5,'pendente','whatsapp')
     ON CONFLICT (evento_id, tipo) WHERE tipo <> 'manual'
     DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       conversa_id = EXCLUDED.conversa_id,
       enviar_em = EXCLUDED.enviar_em,
       status = CASE WHEN vendas.agenda_lembretes.status = 'enviado' THEN vendas.agenda_lembretes.status ELSE 'pendente' END,
       erro = NULL,
       atualizado_em = NOW()
     RETURNING *`,
    [row.id, row.lead_id || null, row.conversa_id || null, tipo, quando]
  )
  const lembrete = rows[0]
  if (lembrete?.status === 'pendente') await enfileirarJobLembreteReuniao(lembrete.id, lembrete.enviar_em)
  return lembrete || null
}

function reuniaoElegivelLembrete(row) {
  if (!row || row.tipo !== 'reuniao' || row.excluido_em) return false
  if (!['pendente', 'confirmado'].includes(row.status)) return false
  if (row.conversa_venda_fechada === true) return false
  if (row.reagendado_para_evento_id) return false
  return Boolean(numeroDoEvento(row))
}

// Lembretes de tempo criados ao agendar a reunião: 15 min antes + na hora.
async function agendarLembretesReuniao(eventoId) {
  const row = await buscarEventoComVinculos(eventoId, null, 'admin')
  if (!reuniaoElegivelLembrete(row)) return null
  const inicio = row.data_inicio instanceof Date ? row.data_inicio : new Date(row.data_inicio)
  if (Number.isNaN(inicio.getTime())) return null
  const agora = new Date()
  let principal = null
  const em15 = adicionarMinutos(inicio, -15)
  if (em15 > agora) principal = await inserirLembreteReuniao(row, '15min', em15)
  if (inicio > agora) {
    const lAgora = await inserirLembreteReuniao(row, 'agora', inicio)
    principal = principal || lAgora
  }
  return principal
}

// Lembrete da MANHÃ do dia (tipo 'dia'): "hoje temos nossa reunião às X".
// Coexiste com o de 15 min (constraint unique por evento+tipo). Idempotente.
async function criarLembreteManhaReuniao(eventoId) {
  const row = await buscarEventoComVinculos(eventoId, null, 'admin')
  if (!reuniaoElegivelLembrete(row)) return null
  const inicio = row.data_inicio instanceof Date ? row.data_inicio : new Date(row.data_inicio)
  const agora = new Date()
  // Lembrete da manhã (envia agora). Garante também os de tempo (15 min/na hora) —
  // backfill p/ reuniões criadas antes desses lembretes existirem (idempotente).
  const dia = await inserirLembreteReuniao(row, 'dia', agora)
  if (!Number.isNaN(inicio.getTime())) {
    const em15 = adicionarMinutos(inicio, -15)
    if (em15 > agora) await inserirLembreteReuniao(row, '15min', em15)
    if (inicio > agora) await inserirLembreteReuniao(row, 'agora', inicio)
  }
  return dia
}

// Enfileira os lembretes da manhã (a partir das 08:00 BRT, com catch-up até 12:00 —
// sobrevive a reinício/queda do worker no início da manhã) para as reuniões de HOJE
// ainda no futuro, que ainda nao tem lembrete 'dia'. Chamado pelo tick do worker.
async function verificarLembretesManhaReuniao(now = new Date()) {
  try {
    const p = partesDataBrasil(now)
    const minutos = p.hour * 60 + p.minute
    if (minutos < 8 * 60 || minutos > 12 * 60) return { enfileirados: 0 }
    const dataIso = isoDateBrasil(now)
    const { rows } = await pool.query(
      `SELECT e.id
       FROM vendas.agenda_eventos e
       WHERE e.tipo = 'reuniao' AND e.excluido_em IS NULL
         AND e.status IN ('pendente', 'confirmado')
         AND (e.data_inicio AT TIME ZONE $2)::date = $1::date
         AND e.data_inicio > NOW()
         AND NOT EXISTS (SELECT 1 FROM vendas.agenda_lembretes l WHERE l.evento_id = e.id AND l.tipo = 'dia')`,
      [dataIso, TIMEZONE]
    )
    let n = 0
    for (const r of rows) {
      const lembrete = await criarLembreteManhaReuniao(r.id)
      if (lembrete) n += 1
    }
    return { enfileirados: n }
  } catch (e) {
    logger.warn('verificarLembretesManhaReuniao:', e.message)
    return { enfileirados: 0 }
  }
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
            e.empresa_id AS evento_empresa_id, c.empresa_id AS conversa_empresa_id,
            c.evolution_instance,
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
  // Pause da empresa: agente pausado = não dispara lembrete automático. Envio manual
  // (manual=true) ignora o pause (o operador decidiu enviar). Fail-open: erro de
  // leitura do pause nunca bloqueia o envio (empresaAgentePausada já é fail-open).
  const empresaIdEvento = row.evento_empresa_id || row.conversa_empresa_id || null
  if (!manual && empresaIdEvento && await empresaAgentePausada(empresaIdEvento)) {
    await pool.query(`UPDATE vendas.agenda_lembretes SET status = 'cancelado', erro = 'agente_pausado', atualizado_em = NOW() WHERE id = $1`, [lembreteId])
    return { ok: true, cancelado: true, motivo: 'agente_pausado' }
  }
  const mensagem = await montarMensagemLembrete(row, row.lembrete_tipo, empresaIdEvento)
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

// Classifica, via IA, a resposta do lead a um LEMBRETE de reuni\u00e3o j\u00e1 agendada: confirma
// presen\u00e7a, pede para remarcar, ou outro. Substitui o antigo match por palavra-chave, que
// dava falso positivo (ex.: "amanh\u00e3 te mando a foto" virava pedido de remarca\u00e7\u00e3o). Em
// QUALQUER falha/timeout/JSON inv\u00e1lido retorna null (nenhuma a\u00e7\u00e3o) \u2014 nunca arrisca uma
// remarca\u00e7\u00e3o ou confirma\u00e7\u00e3o erradas. Injet\u00e1vel via deps.aiProvider para teste.
async function classificarRespostaLembreteIA(texto, deps = {}) {
  const raw = String(texto || '').trim()
  if (!raw) return null
  const ai = deps.aiProvider || require('./ai-provider')
  if (!ai || typeof ai.generateAIResponse !== 'function') return null
  const systemPrompt =
    'Voce classifica a resposta de um lead a um LEMBRETE de uma reuniao JA agendada. ' +
    'Considere apenas a intencao sobre comparecer a essa reuniao. Responda SOMENTE um JSON ' +
    '{"intencao":"confirma|remarcar|outro"}. ' +
    'confirma = o lead diz que vai comparecer / esta disponivel / confirma o horario. ' +
    'remarcar = o lead nao consegue nesse horario e quer outro dia/horario, ou pede para adiar. ' +
    'outro = qualquer outra coisa (duvida, comentario solto, assunto nao relacionado). ' +
    'Na duvida, responda outro.'
  const userPrompt = `Resposta do lead: "${raw.slice(0, 400)}"`
  try {
    const r = await ai.generateAIResponse(
      {
        systemPrompt,
        userPrompt,
        task: 'classificar_resposta_lembrete',
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0,
        maxTokens: 30,
        timeoutMs: 12000,
        responseFormatJson: true,
      },
      pool,
      null
    )
    const txt = String(r?.text || '').trim().replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim()
    const intent = String(JSON.parse(txt)?.intencao || '').toLowerCase()
    if (intent === 'confirma') return 'reuniao_confirmada'
    if (intent === 'remarcar') return 'reagendamento_pendente'
    return null
  } catch (e) {
    logger.warn('classificarRespostaLembreteIA falhou (sem acao):', e.message)
    return null
  }
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
  const empresaIdRemarca = row.evento_empresa_id || row.conversa_empresa_id || row.empresa_id || null
  const mensagem = await mensagensSvc.resolverMensagem(pool, {
    empresaId: empresaIdRemarca,
    evolutionInstance: row.evolution_instance || null,
    grupo: 'gatilhos_agenda',
    chave: 'remarcacao',
    values: { data: dataLabel, opcoes },
    log: logger,
  })
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
  // Classificação por IA (default); injetável via opts.classificar para teste determinístico.
  const classificar = typeof opts.classificar === 'function' ? opts.classificar : classificarRespostaLembreteIA
  const tipoResposta = await classificar(texto, opts)
  const jid = String(numero || '').trim()
  if (!tipoResposta || !jid) return null
  const { rows } = await pool.query(
    `SELECT e.id, e.usuario_id, e.metadata,
            e.empresa_id AS evento_empresa_id, c.empresa_id AS conversa_empresa_id,
            c.evolution_instance, c.numero AS conversa_numero, lp.numero AS lead_numero
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

  // Marca a venda do lead da reunião (venda_fechada + valor) — alimenta o evento Purchase
  // da Meta (quando ligado) e a métrica de fechamento.
  app.patch('/dashboard/agenda/:id/vendido', async (req, res) => {
    try {
      const id = normalizarIdOpcional(req.params.id)
      if (!id) return jsonErro(res, 400, 'ID invalido')
      const atual = await buscarEventoDoUsuario(id, req.dashboardUser.id, req.dashboardUser.role)
      if (!atual) return jsonErro(res, 404, 'Evento nao encontrado')
      const valor = Number(req.body?.valor)
      if (!Number.isFinite(valor) || valor <= 0) return jsonErro(res, 400, 'Informe um valor de venda valido (> 0)')
      const numero = numeroDoEvento(atual)
      if (!numero) return jsonErro(res, 422, 'Reuniao sem lead vinculado')
      const { rowCount } = await pool.query(
        `UPDATE vendas.conversas
         SET venda_fechada = true, venda_valor = $2, atualizado_em = NOW()
         WHERE regexp_replace(numero, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')`,
        [numero, valor]
      )
      if (!rowCount) return jsonErro(res, 404, 'Conversa do lead nao encontrada')
      res.json({ ok: true, venda_valor: valor })
    } catch (err) {
      logger.error('PATCH /dashboard/agenda/:id/vendido:', err.message)
      jsonErro(res, 500, 'Falha ao registrar venda')
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

// Consulta os eventos que ocupam horario num dia (iso AAAA-MM-DD), com RETRY.
// Um blip transitorio de conexao fazia o bot dizer "agenda indisponivel" mesmo
// com a agenda vazia; 1 retry curto elimina esse falso negativo.
async function eventosDoDia(iso, uid, tentativas = 2) {
  const params = [iso, TIMEZONE, Array.from(STATUS_OCUPA_HORARIO)]
  if (uid) params.push(uid)
  const sql =
    `SELECT data_inicio, data_fim FROM vendas.agenda_eventos
     WHERE excluido_em IS NULL
       AND status = ANY($3::text[])
       AND data_inicio < (($1::date::timestamp + INTERVAL '1 day') AT TIME ZONE $2)
       AND data_fim > ($1::date::timestamp AT TIME ZONE $2)
       ${uid ? 'AND usuario_id = $4' : ''}`
  let ultimoErro = null
  for (let i = 0; i < Math.max(1, tentativas); i += 1) {
    try {
      const { rows } = await pool.query(sql, params)
      return { rows }
    } catch (e) {
      ultimoErro = e
      if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 150))
    }
  }
  logger.error('[AGENDA] falha ao consultar disponibilidade real (apos retry); nenhum horario sera oferecido', {
    erro: ultimoErro && ultimoErro.message ? ultimoErro.message : String(ultimoErro),
  })
  return { erro: true }
}

// Dado os eventos de um dia, retorna os labels de horario padrao que estao livres.
function slotsLivresDoDia(iso, candidatos, eventos, duracaoMinutos = 15) {
  const [year, month, day] = String(iso).split('-').map(Number)
  return candidatos.filter((slotLabel) => {
    const [hh, mm] = slotLabel.split(':').map(Number)
    const slotInicio = utcParaDataLocalEmTimezone({ year, month, day, hour: hh, minute: mm }, TIMEZONE)
    const slotFim = new Date(slotInicio.getTime() + duracaoMinutos * 60 * 1000)
    // Buffer entre reuniões: o candidato precisa de folga antes E depois de eventos.
    const { inicio: ci, fim: cf } = janelaComBufferReuniao(slotInicio, slotFim)
    return !eventos.some((ev) => temConflito(ci, cf, new Date(ev.data_inicio), new Date(ev.data_fim)))
  })
}

// Antecedencia minima para uma reuniao no MESMO dia (minutos). Antes havia um
// portao de 18:30 que escondia os horarios de hoje a tarde inteira — o bot
// pulava para "amanha" mesmo com 19:30-21:15 livres hoje. Agora hoje e ofertado
// sempre que houver slot com pelo menos esta antecedencia.
const ANTECEDENCIA_MESMO_DIA_MIN = 60

// Monta a lista de dias candidatos (hoje, se util e ainda houver slot com
// antecedencia, + proximos dias uteis) ate atingir `quantidadeDias`.
// Compartilhado por buscarSlotsDisponiveis e buscarDisponibilidadeSemana.
function montarDiasCandidatos(agora, quantidadeDias, incluirHoje = true) {
  const DIAS_PT = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
  const p = partesDataBrasil(agora)
  const minAtual = p.hour * 60 + p.minute
  const dias = []
  if (incluirHoje && diaAtendeReuniao(p.weekday)) {
    const hojeSlots = horariosPadraoParaWeekday(p.weekday).filter((h) => {
      const [hh, mm] = h.split(':').map(Number)
      return hh * 60 + mm >= minAtual + ANTECEDENCIA_MESMO_DIA_MIN
    })
    if (hojeSlots.length > 0) dias.push({ iso: isoDateBrasil(agora), label: 'hoje', candidatos: hojeSlots })
  }
  let cursor = new Date(agora)
  let primeiroDia = true
  while (dias.length < quantidadeDias) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    const pd = partesDataBrasil(cursor)
    if (diaAtendeReuniao(pd.weekday)) {
      const iso = isoDateBrasil(cursor)
      const label = primeiroDia && dias.length === 0 ? 'amanha' : DIAS_PT[pd.weekday]
      primeiroDia = false
      dias.push({ iso, label, candidatos: horariosPadraoParaWeekday(pd.weekday) })
    }
  }
  return dias
}

/**
 * Disponibilidade da semana: horarios livres POR DIA nos proximos `dias` dias
 * uteis, dentro da janela 19:30–21:15 (America/Sao_Paulo). A IA usa isso para
 * oferecer qualquer dia/horario com flexibilidade; o codigo valida a escolha
 * ao vivo antes de agendar (validarSlotReuniao).
 * @returns {Promise<{ janela:{inicio:string,fim:string}, dias: Array<{data:string,data_br:string,label:string,horarios:string[]}> }>}
 */
async function buscarDisponibilidadeSemana({ dataInicial = new Date(), duracaoMinutos = 15, dias = 7, usuarioId = null, maxPorDia = 8 } = {}) {
  const agora = dataInicial instanceof Date ? dataInicial : new Date(dataInicial)
  const uid = Number(usuarioId) > 0 ? Number(usuarioId) : null
  const candidatos = montarDiasCandidatos(agora, dias, true)
  const out = []
  for (const dia of candidatos) {
    const ev = await eventosDoDia(dia.iso, uid)
    if (ev.erro) continue
    const livres = slotsLivresDoDia(dia.iso, dia.candidatos, ev.rows, duracaoMinutos).slice(0, maxPorDia)
    if (livres.length > 0) {
      // data_br (DD/MM) pronto para a IA mostrar o dia concreto ao cliente,
      // alem do label (hoje/amanha/<dia da semana>) e da data ISO p/ booking.
      const data_br = `${dia.iso.slice(8, 10)}/${dia.iso.slice(5, 7)}`
      out.push({ data: dia.iso, data_br, label: dia.label, horarios: livres })
    }
  }
  const padr = REUNIAO_PROPOSTA_HORARIOS_PADRAO
  return { janela: { inicio: padr[0], fim: padr[padr.length - 1] }, dias: out }
}

/**
 * Valida AO VIVO uma escolha de reuniao { data:'AAAA-MM-DD', horario:'HH:MM' }:
 * precisa ser um slot da janela padrao, em dia util, e estar livre na agenda.
 * Usado no booking antes de criar o evento (guardrail: a IA pode oferecer
 * qualquer dia, mas o codigo so agenda horario real e disponivel).
 */
async function validarSlotReuniao({ data, horario, duracaoMinutos = 15, usuarioId = null } = {}) {
  const d = String(data || '').trim()
  let h = String(horario || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{1,2}:\d{2}$/.test(h)) return false
  if (h.length === 4) h = `0${h}`
  const [year, month, day] = d.split('-').map(Number)
  const wd = partesDataBrasil(utcParaDataLocalEmTimezone({ year, month, day, hour: 12, minute: 0 }, TIMEZONE)).weekday
  if (!diaAtendeReuniao(wd)) return false
  // O horário precisa ser um slot válido DAQUELE dia (noite nos úteis, dia no sábado).
  if (!horariosPadraoParaWeekday(wd).includes(h)) return false
  const [hh, mm] = h.split(':').map(Number)
  const slotInicio = utcParaDataLocalEmTimezone({ year, month, day, hour: hh, minute: mm }, TIMEZONE)
  const slotFim = new Date(slotInicio.getTime() + duracaoMinutos * 60 * 1000)
  // Buffer entre reuniões: valida com folga antes/depois (não só sobreposição exata).
  const { inicio: ci, fim: cf } = janelaComBufferReuniao(slotInicio, slotFim)
  const ocupado = await slotEstaOcupado(ci, cf, usuarioId)
  return !ocupado
}

/**
 * Consulta a agenda e retorna os próximos slots livres para reunião de proposta.
 * Respeita a janela comercial (19:30–21:15) em dias úteis, timezone America/Sao_Paulo.
 * Retorna objeto no mesmo formato de sugestaoReuniaoProposta:
 *   { data_sugerida, data_label, horarios_sugeridos }
 */
async function buscarSlotsDisponiveis({ dataInicial = new Date(), duracaoMinutos = 15, quantidade = 2, usuarioId = null, incluirHoje = true } = {}) {
  const agora = dataInicial instanceof Date ? dataInicial : new Date(dataInicial)
  const uid = Number(usuarioId) > 0 ? Number(usuarioId) : null
  // incluirHoje=false: o lead pediu OUTRO dia (ex.: "so amanha"); pula o bloco de
  // hoje. Monta ate 7 dias uteis a frente (compartilhado com a disponibilidade).
  const diasParaVerificar = montarDiasCandidatos(agora, 7, incluirHoje)

  for (const dia of diasParaVerificar) {
    const ev = await eventosDoDia(dia.iso, uid)
    if (ev.erro) {
      // Em falha de BD (apos retry), nao oferece horarios sem validar a agenda real.
      return {
        data_sugerida: null,
        data_label: null,
        horarios_sugeridos: [],
        erro: 'agenda_indisponivel',
      }
    }
    const livres = slotsLivresDoDia(dia.iso, dia.candidatos, ev.rows, duracaoMinutos)
    if (livres.length > 0) {
      return { data_sugerida: dia.iso, data_label: dia.label, horarios_sugeridos: livres.slice(0, quantidade) }
    }
  }

  // Sem vagas livres: nao inventa horarios.
  return {
    data_sugerida: null,
    data_label: null,
    horarios_sugeridos: [],
    erro: 'sem_slots_disponiveis',
  }
}

// ─── RESUMO DIÁRIO DA AGENDA (operador) ───────────────────────────────────────
// Texto com as reuniões do dia para o operador. Sem inventar — lê a agenda real.
async function montarTextoResumoDiarioAgenda(dataIso) {
  const iso = parseDateOnly(dataIso) || dataLocal()
  const { rows } = await pool.query(
    `SELECT e.data_inicio, e.status, e.titulo,
            COALESCE(c.numero, lp.numero, e.metadata->>'lead_numero') AS lead
     FROM vendas.agenda_eventos e
     LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
     LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
     WHERE e.tipo = 'reuniao' AND e.excluido_em IS NULL
       AND e.status IN ('pendente', 'confirmado')
       AND (e.data_inicio AT TIME ZONE $2)::date = $1::date
     ORDER BY e.data_inicio ASC`,
    [iso, TIMEZONE]
  )
  const dataBr = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  if (!rows.length) {
    return `📅 Agenda de hoje (${dataBr}) — {{empresa}}\nNenhuma reunião agendada para hoje.`
  }
  const linhas = rows.map((r) => {
    const hora = formatarHoraSaoPaulo(r.data_inicio) || '--:--'
    const nome = String(r.titulo || '').replace(/^Reuni[ãa]o[^—-]*[—-]\s*/i, '').trim().slice(0, 48) || (r.lead || '?')
    const st = r.status === 'confirmado' ? '✅' : '🕒'
    return `${st} ${hora} — ${nome}`
  })
  return `📅 Agenda de hoje (${dataBr}) — ${rows.length} reunião(ões):\n` + linhas.join('\n')
}

// Move reuniões cuja hora já passou (e seguem 'pendente'/'confirmado' sem desfecho) para
// 'atrasado'. Sem isso, uma reunião de ontem fica "pendente" pra sempre: a métrica de
// reunião mistura futuras, realizadas e furadas, e o evento de conclusão (Meta/fechamento)
// depende de clique manual. 'atrasado' = "passou da hora, aguardando desfecho" — sai do
// balde de "próximas" e o operador marca concluída/não-compareceu com 1 clique (as rotas
// de concluir/nao-compareceu não têm trava de status, então seguem funcionando).
const REUNIAO_GRACE_DESFECHO_MS = 2 * 60 * 60 * 1000 // folga de 2h após o fim
async function verificarReunioesAtrasadas(now = new Date()) {
  try {
    const base = now instanceof Date ? now : new Date(now)
    const limite = new Date(base.getTime() - REUNIAO_GRACE_DESFECHO_MS)
    const { rowCount } = await pool.query(
      `UPDATE vendas.agenda_eventos
       SET status = 'atrasado', atualizado_em = NOW()
       WHERE tipo = 'reuniao'
         AND excluido_em IS NULL
         AND status IN ('pendente', 'confirmado')
         AND data_fim < $1`,
      [limite]
    )
    if (rowCount) logger.info('[agenda] reunioes passadas movidas para atrasado (aguardando desfecho):', rowCount)
    return { atualizadas: rowCount || 0 }
  } catch (e) {
    logger.warn('verificarReunioesAtrasadas:', e.message)
    return { atualizadas: 0 }
  }
}

// Texto do ping ao operador quando o lead nao confirmou a reuniao a tempo. Puro
// (sem IO) para ser testavel sem banco. So o operador recebe — nunca o lead.
function montarPingNaoConfirmou({ nome, hora, numero } = {}) {
  const nm = normalizarTexto(nome, 80) || 'O lead'
  const h = String(hora || '--:--')
  const phone = String(numero || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  return (
    `⚠️ ${nm} ainda não confirmou a reunião de hoje às ${h}.\n` +
    (phone ? `Lead: ${phone}\n` : '') +
    `Vale dar um toque pra garantir presença.`
  )
}

// Faltando até 2h pra reunião e o lead ainda não confirmou nem pediu remarcação
// (status segue 'pendente') apesar do lembrete já enviado: avisa o operador 1x via
// WhatsApp pra ele dar um toque manual. Idempotente por metadata.confirmacao_escalada_em
// (só marca o flag após o ping sair, então retenta no próximo tick se o envio falhar).
// O notificador é injetado (deps.notificarOperador) — sem ele, no-op.
const REUNIAO_CONFIRMA_JANELA_MS = 2 * 60 * 60 * 1000 // avisa faltando <= 2h
async function verificarReunioesNaoConfirmadas(now = new Date(), deps = {}) {
  const notificar = typeof deps.notificarOperador === 'function' ? deps.notificarOperador : null
  if (!notificar) return { avisadas: 0 }
  try {
    const base = now instanceof Date ? now : new Date(now)
    const limite = new Date(base.getTime() + REUNIAO_CONFIRMA_JANELA_MS)
    const { rows } = await pool.query(
      `SELECT e.id, e.data_inicio,
              COALESCE(c.numero, lp.numero, e.metadata->>'lead_numero') AS numero,
              COALESCE(NULLIF(lp.apelido, ''), NULLIF(lp.negocio, '')) AS nome
       FROM vendas.agenda_eventos e
       LEFT JOIN vendas.conversas c ON c.id = e.conversa_id
       LEFT JOIN vendas.lead_profiles lp ON lp.id = e.lead_id
       WHERE e.tipo = 'reuniao'
         AND e.excluido_em IS NULL
         AND e.status = 'pendente'
         AND e.data_inicio > $1
         AND e.data_inicio <= $2
         AND (e.metadata->>'confirmacao_escalada_em') IS NULL
         AND EXISTS (
           SELECT 1 FROM vendas.agenda_lembretes l
           WHERE l.evento_id = e.id AND l.status = 'enviado'
         )
       ORDER BY e.data_inicio ASC
       LIMIT 20`,
      [base, limite]
    )
    let avisadas = 0
    for (const ev of rows) {
      const texto = montarPingNaoConfirmou({
        nome: ev.nome,
        hora: formatarHoraSaoPaulo(ev.data_inicio) || '--:--',
        numero: ev.numero,
      })
      try {
        const enviou = await notificar(texto)
        if (!enviou) continue
        await pool.query(
          `UPDATE vendas.agenda_eventos
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmacao_escalada_em', $2::text),
               atualizado_em = NOW()
           WHERE id = $1 AND excluido_em IS NULL`,
          [ev.id, base.toISOString()]
        )
        avisadas++
      } catch (e) {
        logger.warn('verificarReunioesNaoConfirmadas envio:', e.message)
      }
    }
    if (avisadas) logger.info('[agenda] reunioes nao confirmadas escaladas ao operador:', avisadas)
    return { avisadas }
  } catch (e) {
    logger.warn('verificarReunioesNaoConfirmadas:', e.message)
    return { avisadas: 0 }
  }
}

// Enfileira o resumo diário quando bater 08:00 ou 19:15 (America/Sao_Paulo).
// Dedupe por dia+slot via job_queue.dedupe_key (idempotente entre ticks/instâncias).
async function verificarResumoDiarioAgenda(now = new Date()) {
  try {
    const p = partesDataBrasil(now)
    const minutos = p.hour * 60 + p.minute
    // Catch-up de 120 min por slot (sobrevive a reinício/queda do worker na virada
    // do horário). Dedupe por dia+slot garante 1 envio. (Antes: janela de 30 min —
    // perdida quando o worker não ticava exatamente no intervalo.)
    const SLOTS = [{ key: 'manha', min: 8 * 60 }, { key: 'noite', min: 19 * 60 + 15 }]
    const CATCHUP_MIN = 120
    const dataIso = isoDateBrasil(now)
    for (const s of SLOTS) {
      if (minutos < s.min || minutos > s.min + CATCHUP_MIN) continue
      const dedupe = `resumo_agenda_operador:${dataIso}:${s.key}`
      const { rowCount } = await pool.query(
        `INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
         VALUES ('resumo_agenda_operador', $1, $2::jsonb, 'pending', 0, 2, NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [dedupe, JSON.stringify({ data: dataIso, slot: s.key })]
      )
      if (rowCount > 0) return { enfileirado: true, slot: s.key, data: dataIso }
    }
  } catch (e) {
    logger.warn('verificarResumoDiarioAgenda:', e.message)
  }
  return { enfileirado: false }
}

module.exports = {
  TIMEZONE,
  REUNIAO_BUFFER_MINUTOS,
  janelaComBufferReuniao,
  slotsLivresDoDia,
  criarEventoAgenda,
  montarTextoResumoDiarioAgenda,
  verificarResumoDiarioAgenda,
  verificarReunioesAtrasadas,
  verificarReunioesNaoConfirmadas,
  montarPingNaoConfirmou,
  verificarLembretesManhaReuniao,
  buscarSlotsDisponiveis,
  buscarDisponibilidadeSemana,
  validarSlotReuniao,
  montarDiasCandidatos,
  existeConflitoAgenda,
  agendarLembretesReuniao,
  cancelarLembretesEvento,
  enviarLembreteReuniao,
  gerarMensagemLembreteReuniao,
  processarLembreteReuniaoJob,
  classificarRespostaLembreteIA,
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
