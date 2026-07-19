'use strict'

const PERIODO_REPROSPECCAO_DIAS = 60
const STATUS_CONVERSA_ATIVA = new Set(['ativo', 'em_atendimento', 'aberto', 'pausado'])
const TIPOS_JOB_PROSPECCAO = ['prospeccao_envio_agendado', 'prospeccao_completo']

function soDigitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '')
}

function normalizarNumeroProspeccao(numero) {
  const texto = String(numero == null ? '' : numero).trim()
  if (!texto) return ''
  if (/@g\.us$/i.test(texto) || /@broadcast$/i.test(texto)) return ''
  if (/status@broadcast/i.test(texto)) return ''
  let digits = soDigitos(texto.replace(/@s\.whatsapp\.net$/i, ''))
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) digits = `55${digits}`
  return digits
}

function motivoBloqueio(reason, extra = {}) {
  return { allowed: false, reason, ...extra }
}

function isGrupoOuBroadcast(numero) {
  const texto = String(numero == null ? '' : numero).trim().toLowerCase()
  return /@g\.us$/.test(texto) || /@broadcast$/.test(texto) || texto === 'status@broadcast'
}

function telefonePareceValido(numeroNormalizado) {
  return /^55\d{10,11}$/.test(String(numeroNormalizado || ''))
}

// Aceita apenas celulares: 55+DDD+9+8 dígitos (nono dígito) ou 55+DDD+8 dígitos
// legado começando em 6-9. Telefones fixos (assinante começando em 2-5) ficam de
// fora porque não têm conta WhatsApp e geram falha 400 "exists:false" na Evolution.
function telefoneEhCelular(numeroNormalizado) {
  const n = String(numeroNormalizado || '')
  return /^55\d{2}9\d{8}$/.test(n) || /^55\d{2}[6-9]\d{7}$/.test(n)
}

function diasAtras(dias) {
  return new Date(Date.now() - (dias * 24 * 60 * 60 * 1000))
}

function rowAtualizadoEm(row) {
  return row?.updated_at || row?.updated_at || row?.atualizado_em || row?.created_at || row?.criado_em || null
}

async function queryOpcional(pool, sql, params = []) {
  try {
    return await pool.query(sql, params)
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { rows: [] }
    throw err
  }
}

async function checarBloqueioManual(pool, telefone, prospectId, empresaId = null) {
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT id, motivo, origem, expira_em, criado_em
    FROM prospectador.prospeccao_bloqueios
    WHERE ativo = true
      AND ($3::uuid IS NULL OR empresa_id = $3::uuid)
      AND (expira_em IS NULL OR expira_em > NOW())
      AND (
        telefone_normalizado = $1
        OR ($2::uuid IS NOT NULL AND prospect_id = $2::uuid)
      )
    ORDER BY criado_em DESC
    LIMIT 1
    `,
    [telefone, prospectId || null, empresaId]
  )
  return rows[0] || null
}

async function checarOptOut(pool, telefone, empresaId = null) {
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT telefone, opt_out, updated_at
    FROM prospectador.contato_politicas
    WHERE regexp_replace(telefone, '\\D', '', 'g') = $1
      AND ($2::uuid IS NULL OR empresa_id = $2::uuid)
    LIMIT 1
    `,
    [telefone, empresaId]
  )
  return rows[0] || null
}

async function checarConversa(pool, telefone, empresaId = null) {
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT id, numero, status, estagio, venda_fechada, agente_pausado, atualizado_em
    FROM vendas.conversas
    WHERE ($2::uuid IS NULL OR empresa_id = $2::uuid)
      AND (regexp_replace(numero, '\\D', '', 'g') = $1
        OR numero = $1
        OR numero = $1 || '@s.whatsapp.net')
    ORDER BY atualizado_em DESC
    LIMIT 1
    `,
    [telefone, empresaId]
  )
  return rows[0] || null
}

async function checarProspect(pool, telefone, prospectId, empresaId = null) {
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT id, telefone, status, updated_at, created_at
    FROM prospectador.prospects
    WHERE ($3::uuid IS NULL OR empresa_id = $3::uuid)
      AND (($2::uuid IS NOT NULL AND id = $2::uuid)
        OR regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = $1)
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [telefone, prospectId || null, empresaId]
  )
  return rows[0] || null
}

async function checarUltimoEnvio(pool, telefone, prospectId, desde, options = {}) {
  const jobId = options.jobId || options.job_id || null
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT sa.id, sa.prospect_id, sa.status, sa.enviado_em, sa.created_at
    FROM prospectador.send_attempts sa
    LEFT JOIN prospectador.prospects p ON p.id = sa.prospect_id
    WHERE sa.status IN ('scheduled', 'processing', 'sent')
      AND sa.tipo_mensagem = 'abordagem_inicial'
      AND sa.canal = 'whatsapp'
      AND (
        sa.numero_normalizado = $1
        OR regexp_replace(COALESCE(p.telefone, ''), '\\D', '', 'g') = $1
        OR ($2::uuid IS NOT NULL AND sa.prospect_id = $2::uuid)
      )
      AND COALESCE(sa.enviado_em, sa.created_at) >= $3::timestamptz
      AND ($4::bigint IS NULL OR sa.job_id IS DISTINCT FROM $4::bigint)
    ORDER BY COALESCE(sa.enviado_em, sa.created_at) DESC
    LIMIT 1
    `,
    [telefone, prospectId || null, desde.toISOString(), jobId]
  )
  return rows[0] || null
}

async function checarFilaAtiva(pool, telefone, prospectId, options = {}) {
  const filaId = options.filaId || options.fila_id || null
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT id, execucao_id, prospect_id, status, slot_envio, atualizado_em
    FROM prospectador.prospeccao_fila_diaria
    WHERE status IN ('aguardando_agendamento', 'agendado', 'simulado', 'enviando', 'enviado')
      AND (
        telefone_normalizado = $1
        OR ($2::uuid IS NOT NULL AND prospect_id = $2::uuid)
      )
      AND ($3::uuid IS NULL OR id <> $3::uuid)
    ORDER BY atualizado_em DESC
    LIMIT 1
    `,
    [telefone, prospectId || null, filaId]
  )
  return rows[0] || null
}

async function checarJobPendente(pool, telefone, prospectId, options = {}) {
  const jobId = options.jobId || options.job_id || null
  const filaId = options.filaId || options.fila_id || null
  const { rows } = await queryOpcional(
    pool,
    `
    SELECT id, tipo, dedupe_key, status, available_at, payload
    FROM vendas.job_queue
    WHERE status IN ('pending', 'processing')
      AND tipo = ANY($3::text[])
      AND (
        payload->>'telefone' = $1
        OR payload->>'numero' = $1
        OR payload->>'numero_normalizado' = $1
        OR payload->>'phone' = $1
        OR ($2::text IS NOT NULL AND payload->>'prospect_id' = $2::text)
        OR ($4::text IS NOT NULL AND payload->>'fila_id' = $4::text)
      )
      AND ($5::bigint IS NULL OR id <> $5::bigint)
    ORDER BY available_at ASC, id ASC
    LIMIT 1
    `,
    [telefone, prospectId || null, TIPOS_JOB_PROSPECCAO, filaId, jobId]
  )
  return rows[0] || null
}

async function canProspectLead(pool, phone, options = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('pool com query() e obrigatorio para canProspectLead')
  }

  if (isGrupoOuBroadcast(phone)) {
    return motivoBloqueio('grupo_ou_broadcast', { normalizedPhone: '' })
  }

  const normalizedPhone = normalizarNumeroProspeccao(phone)
  if (!telefonePareceValido(normalizedPhone)) {
    return motivoBloqueio('telefone_invalido', { normalizedPhone })
  }
  if (!telefoneEhCelular(normalizedPhone)) {
    return motivoBloqueio('telefone_fixo', { normalizedPhone })
  }

  const prospectId = options.prospectId || options.prospect_id || null
  const empresaId = options.empresaId || options.empresa_id || null
  const diasReprospeccao = Number.isInteger(options.diasReprospeccao)
    ? options.diasReprospeccao
    : PERIODO_REPROSPECCAO_DIAS
  const desde = options.desde instanceof Date ? options.desde : diasAtras(diasReprospeccao)

  const bloqueio = await checarBloqueioManual(pool, normalizedPhone, prospectId, empresaId)
  if (bloqueio) {
    return motivoBloqueio(`bloqueado:${bloqueio.motivo || 'manual'}`, {
      normalizedPhone,
      existingProspectId: bloqueio.prospect_id || prospectId || undefined,
    })
  }

  const politica = await checarOptOut(pool, normalizedPhone, empresaId)
  if (politica?.opt_out === true) {
    return motivoBloqueio('opt_out', {
      normalizedPhone,
      lastContactAt: rowAtualizadoEm(politica) || undefined,
    })
  }

  const conversa = await checarConversa(pool, normalizedPhone, empresaId)
  if (conversa?.venda_fechada === true) {
    return motivoBloqueio('cliente_fechado', {
      normalizedPhone,
      existingConversationId: conversa.id,
      currentStage: conversa.estagio || undefined,
      lastContactAt: conversa.atualizado_em || undefined,
    })
  }
  if (conversa && STATUS_CONVERSA_ATIVA.has(String(conversa.status || '').toLowerCase())) {
    return motivoBloqueio('conversa_ativa', {
      normalizedPhone,
      existingConversationId: conversa.id,
      currentStage: conversa.estagio || undefined,
      lastContactAt: conversa.atualizado_em || undefined,
    })
  }

  const prospect = await checarProspect(pool, normalizedPhone, prospectId, empresaId)
  if (prospect?.status === 'respondeu') {
    return motivoBloqueio('lead_ja_respondeu', {
      normalizedPhone,
      existingProspectId: prospect.id,
      lastContactAt: rowAtualizadoEm(prospect) || undefined,
    })
  }

  // Banco de Leads reutiliza as guardas de compliance, mas possui sua propria
  // reserva/idempotencia. Nao consulta filas/jobs do pipeline legado nesse modo.
  if (options.complianceOnly === true) {
    return {
      allowed: true,
      reason: 'ok',
      normalizedPhone,
      existingProspectId: prospect?.id || prospectId || undefined,
      currentStage: conversa?.estagio || undefined,
      lastContactAt: rowAtualizadoEm(prospect) || conversa?.atualizado_em || undefined,
    }
  }

  const ultimoEnvio = await checarUltimoEnvio(pool, normalizedPhone, prospect?.id || prospectId, desde, options)
  if (ultimoEnvio?.status === 'scheduled' || ultimoEnvio?.status === 'processing') {
    return motivoBloqueio('envio_ja_reservado', {
      normalizedPhone,
      existingProspectId: ultimoEnvio.prospect_id || prospect?.id || undefined,
      lastContactAt: rowAtualizadoEm(ultimoEnvio) || undefined,
    })
  }
  if (ultimoEnvio?.status === 'sent') {
    return motivoBloqueio('prospectado_recentemente', {
      normalizedPhone,
      existingProspectId: ultimoEnvio.prospect_id || prospect?.id || undefined,
      lastContactAt: ultimoEnvio.enviado_em || ultimoEnvio.created_at || undefined,
    })
  }

  const filaAtiva = await checarFilaAtiva(pool, normalizedPhone, prospect?.id || prospectId, options)
  if (filaAtiva) {
    return motivoBloqueio('envio_agendado_duplicado', {
      normalizedPhone,
      existingProspectId: filaAtiva.prospect_id || prospect?.id || undefined,
      lastContactAt: filaAtiva.slot_envio || filaAtiva.atualizado_em || undefined,
    })
  }

  const jobPendente = await checarJobPendente(pool, normalizedPhone, prospect?.id || prospectId, options)
  if (jobPendente) {
    return motivoBloqueio('job_prospeccao_pendente', {
      normalizedPhone,
      existingProspectId: prospect?.id || prospectId || undefined,
      lastContactAt: jobPendente.available_at || undefined,
    })
  }

  return {
    allowed: true,
    reason: 'ok',
    normalizedPhone,
    existingProspectId: prospect?.id || prospectId || undefined,
    currentStage: conversa?.estagio || undefined,
    lastContactAt: rowAtualizadoEm(prospect) || conversa?.atualizado_em || undefined,
  }
}

module.exports = {
  PERIODO_REPROSPECCAO_DIAS,
  normalizarNumeroProspeccao,
  telefonePareceValido,
  telefoneEhCelular,
  canProspectLead,
}
