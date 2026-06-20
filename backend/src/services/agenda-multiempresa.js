'use strict'

// Agenda comercial MULTIEMPRESA (app.agenda_eventos). Vertical autocontida, escopada
// por empresa_id, sem acoplamento à agenda legada single-tenant (vendas.agenda_eventos)
// nem ao worker de lembretes/IA. Funções de DB recebem `pool` por injeção (testáveis).

const TIMEZONE = 'America/Sao_Paulo'
const TIPOS = new Set(['reuniao', 'follow_up', 'retorno', 'tarefa', 'bloqueio', 'outro'])
const STATUS = new Set(['pendente', 'confirmado', 'concluido', 'cancelado', 'bloqueado', 'nao_compareceu'])
const PRIORIDADES = new Set(['baixa', 'normal', 'media', 'alta', 'urgente'])
// Status que efetivamente ocupam o horário (entram na checagem de conflito).
const STATUS_OCUPA = ['pendente', 'confirmado', 'bloqueado']

function erro(code, message, statusCode = 400) {
  const e = new Error(message)
  e.code = code
  e.statusCode = statusCode
  return e
}

function texto(valor, max = 500) {
  const s = String(valor == null ? '' : valor).trim()
  return s ? s.slice(0, max) : null
}

function parseData(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor
  const s = String(valor == null ? '' : valor).trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseDataDia(valor, fallback) {
  const s = String(valor == null ? '' : valor).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return fallback
}

function hojeIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// Valida e normaliza o payload de um evento. parcial=true ignora campos ausentes (PATCH).
function validarEvento(body = {}, { parcial = false } = {}) {
  const out = {}
  const issues = []

  if (!parcial || body.titulo !== undefined) {
    out.titulo = texto(body.titulo, 160)
    if (!out.titulo) issues.push('titulo obrigatorio')
  }
  if (!parcial || body.descricao !== undefined) out.descricao = texto(body.descricao, 2000)
  if (!parcial || body.tipo !== undefined) {
    out.tipo = TIPOS.has(body.tipo) ? body.tipo : (parcial ? undefined : 'reuniao')
    if (body.tipo !== undefined && !TIPOS.has(body.tipo)) issues.push('tipo invalido')
  }
  if (!parcial || body.status !== undefined) {
    if (body.status !== undefined && !STATUS.has(body.status)) issues.push('status invalido')
    else out.status = STATUS.has(body.status) ? body.status : 'pendente'
  }
  if (!parcial || body.prioridade !== undefined) {
    out.prioridade = PRIORIDADES.has(body.prioridade) ? body.prioridade : 'media'
  }
  if (!parcial || body.data_inicio !== undefined) {
    out.data_inicio = parseData(body.data_inicio)
    if (!out.data_inicio) issues.push('data_inicio invalida')
  }
  if (!parcial || body.data_fim !== undefined) {
    out.data_fim = parseData(body.data_fim)
    if (!out.data_fim) issues.push('data_fim invalida')
  }
  if (out.data_inicio && out.data_fim && out.data_fim <= out.data_inicio) {
    issues.push('data_fim deve ser maior que data_inicio')
  }
  if (!parcial || body.lead_telefone !== undefined) out.lead_telefone = texto(body.lead_telefone, 40)
  if (!parcial || body.lead_nome !== undefined) out.lead_nome = texto(body.lead_nome, 160)
  if (!parcial || body.metadata !== undefined) {
    out.metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}
  }

  return { ok: issues.length === 0, value: out, issues }
}

function mapEvento(row) {
  if (!row) return null
  const iso = (d) => (d instanceof Date ? d.toISOString() : d)
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    criado_por: row.criado_por || null,
    titulo: row.titulo,
    descricao: row.descricao || '',
    tipo: row.tipo,
    status: row.status,
    prioridade: row.prioridade,
    data_inicio: iso(row.data_inicio),
    data_fim: iso(row.data_fim),
    timezone: row.timezone || TIMEZONE,
    lead_telefone: row.lead_telefone || null,
    lead_nome: row.lead_nome || null,
    metadata: row.metadata || {},
    criado_em: iso(row.criado_em),
    atualizado_em: iso(row.atualizado_em),
  }
}

function montarResumo(eventos = []) {
  const resumo = { total: eventos.length, reunioes: 0, pendentes: 0, confirmados: 0, concluidos: 0, por_tipo: {} }
  for (const e of eventos) {
    resumo.por_tipo[e.tipo] = (resumo.por_tipo[e.tipo] || 0) + 1
    if (e.tipo === 'reuniao') resumo.reunioes += 1
    if (e.status === 'pendente') resumo.pendentes += 1
    if (e.status === 'confirmado') resumo.confirmados += 1
    if (e.status === 'concluido') resumo.concluidos += 1
  }
  return resumo
}

// Existe evento (não cancelado) DESTA empresa que se sobrepõe a [inicio, fim)?
async function existeConflito(pool, { empresaId, dataInicio, dataFim, ignorarId = null }) {
  const params = [empresaId, dataInicio, dataFim, STATUS_OCUPA]
  let ignoreClause = ''
  if (ignorarId) {
    params.push(ignorarId)
    ignoreClause = `AND id <> $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app.agenda_eventos
      WHERE empresa_id = $1
        AND excluido_em IS NULL
        AND status = ANY($4::text[])
        AND data_inicio < $3
        AND data_fim > $2
        ${ignoreClause}`,
    params
  )
  return (rows[0]?.n || 0) > 0
}

// Lista eventos da empresa numa janela [inicio, fim] (datas YYYY-MM-DD, inclusivas).
async function listarEventos(pool, { empresaId, inicio, fim, tipo = null, status = null } = {}) {
  const inicioDia = parseDataDia(inicio, hojeIso())
  const fimDia = parseDataDia(fim, inicioDia)
  const params = [empresaId, inicioDia, fimDia, TIMEZONE, tipo, status]
  const { rows } = await pool.query(
    `SELECT * FROM app.agenda_eventos
      WHERE empresa_id = $1
        AND excluido_em IS NULL
        AND data_inicio >= ($2::date::timestamp AT TIME ZONE $4)
        AND data_inicio < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)
        AND ($5::text IS NULL OR tipo = $5::text)
        AND ($6::text IS NULL OR status = $6::text)
      ORDER BY data_inicio ASC, criado_em ASC`,
    params
  )
  const eventos = rows.map(mapEvento)
  return { eventos, resumo: montarResumo(eventos), periodo: { inicio: inicioDia, fim: fimDia } }
}

async function obterEvento(pool, { empresaId, id }) {
  const { rows } = await pool.query(
    `SELECT * FROM app.agenda_eventos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL LIMIT 1`,
    [id, empresaId]
  )
  return mapEvento(rows[0] || null)
}

async function criarEvento(pool, { empresaId, criadoPor = null, ...body } = {}) {
  const parsed = validarEvento(body, { parcial: false })
  if (!parsed.ok) throw erro('VALIDATION', `Dados inválidos: ${parsed.issues.join(', ')}`, 400)
  const v = parsed.value
  // Bloqueio reserva o horário mas não "conflita" com nada; demais tipos respeitam conflito.
  if (v.tipo !== 'bloqueio' && STATUS_OCUPA.includes(v.status)) {
    const conflito = await existeConflito(pool, { empresaId, dataInicio: v.data_inicio, dataFim: v.data_fim })
    if (conflito) throw erro('CONFLICT', 'Já existe um compromisso nesse horário.', 409)
  }
  const { rows } = await pool.query(
    `INSERT INTO app.agenda_eventos
       (empresa_id, criado_por, titulo, descricao, tipo, status, prioridade,
        data_inicio, data_fim, timezone, lead_telefone, lead_nome, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     RETURNING *`,
    [
      empresaId, criadoPor, v.titulo, v.descricao, v.tipo, v.status, v.prioridade,
      v.data_inicio, v.data_fim, TIMEZONE, v.lead_telefone, v.lead_nome, JSON.stringify(v.metadata || {}),
    ]
  )
  return mapEvento(rows[0])
}

async function atualizarEvento(pool, { empresaId, id, ...body } = {}) {
  const atual = await obterEvento(pool, { empresaId, id })
  if (!atual) throw erro('NOT_FOUND', 'Evento não encontrado.', 404)
  const parsed = validarEvento(body, { parcial: true })
  if (!parsed.ok) throw erro('VALIDATION', `Dados inválidos: ${parsed.issues.join(', ')}`, 400)
  const v = parsed.value

  // Merge dos campos de tempo/status p/ validar período e conflito com o estado final.
  const inicioFinal = v.data_inicio || new Date(atual.data_inicio)
  const fimFinal = v.data_fim || new Date(atual.data_fim)
  if (fimFinal <= inicioFinal) throw erro('VALIDATION', 'data_fim deve ser maior que data_inicio', 400)
  const tipoFinal = v.tipo || atual.tipo
  const statusFinal = v.status || atual.status
  if (tipoFinal !== 'bloqueio' && STATUS_OCUPA.includes(statusFinal)) {
    const conflito = await existeConflito(pool, { empresaId, dataInicio: inicioFinal, dataFim: fimFinal, ignorarId: id })
    if (conflito) throw erro('CONFLICT', 'Já existe um compromisso nesse horário.', 409)
  }

  // Monta SET dinâmico só com os campos enviados.
  const campos = []
  const params = []
  const add = (col, val) => { params.push(val); campos.push(`${col} = $${params.length}`) }
  if (v.titulo !== undefined) add('titulo', v.titulo)
  if (v.descricao !== undefined) add('descricao', v.descricao)
  if (v.tipo !== undefined) add('tipo', v.tipo)
  if (v.status !== undefined) add('status', v.status)
  if (v.prioridade !== undefined) add('prioridade', v.prioridade)
  if (v.data_inicio !== undefined) add('data_inicio', v.data_inicio)
  if (v.data_fim !== undefined) add('data_fim', v.data_fim)
  if (v.lead_telefone !== undefined) add('lead_telefone', v.lead_telefone)
  if (v.lead_nome !== undefined) add('lead_nome', v.lead_nome)
  if (v.metadata !== undefined) { params.push(JSON.stringify(v.metadata)); campos.push(`metadata = $${params.length}::jsonb`) }
  if (!campos.length) return atual
  campos.push('atualizado_em = NOW()')
  params.push(id, empresaId)
  const { rows } = await pool.query(
    `UPDATE app.agenda_eventos SET ${campos.join(', ')}
      WHERE id = $${params.length - 1} AND empresa_id = $${params.length} AND excluido_em IS NULL
      RETURNING *`,
    params
  )
  return mapEvento(rows[0] || null)
}

// Soft delete escopado por empresa.
async function removerEvento(pool, { empresaId, id }) {
  const { rows } = await pool.query(
    `UPDATE app.agenda_eventos SET excluido_em = NOW(), atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL
      RETURNING id`,
    [id, empresaId]
  )
  if (!rows[0]) throw erro('NOT_FOUND', 'Evento não encontrado.', 404)
  return { id: rows[0].id, removido: true }
}

module.exports = {
  TIMEZONE,
  TIPOS,
  STATUS,
  PRIORIDADES,
  validarEvento,
  mapEvento,
  montarResumo,
  existeConflito,
  listarEventos,
  obterEvento,
  criarEvento,
  atualizarEvento,
  removerEvento,
}
