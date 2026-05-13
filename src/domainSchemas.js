'use strict'

/**
 * @typedef {Record<string, unknown>} JsonObject
 *
 * @typedef {Object} SchemaIssue
 * @property {string} path
 * @property {string} message
 *
 * @typedef {Object} SchemaResult
 * @property {boolean} ok
 * @property {unknown} value
 * @property {SchemaIssue[]} issues
 *
 * @typedef {Object} RespostaVendasIA
 * @property {string=} mensagem_pro_lead
 * @property {string[]=} mensagens_bolhas
 * @property {JsonObject=} atualizar_perfil
 * @property {string=} etapa_proxima
 * @property {boolean=} solicitar_calculo_preco
 * @property {boolean=} solicitar_classificacao_nicho
 * @property {boolean=} handoff
 * @property {string|null=} motivo_handoff
 *
 * @typedef {Object} JobQueuePayload
 * @property {string=} trigger
 * @property {string=} window_start
 * @property {number=} limit
 * @property {string|null=} categoria
 * @property {string[]=} prospect_ids
 * @property {string=} prospect_id
 * @property {number|null=} limite
 *
 * @typedef {Object} ProspectInput
 * @property {string=} place_id
 * @property {string=} nome
 * @property {string=} telefone
 * @property {string=} nicho
 * @property {string=} cidade
 * @property {string=} endereco
 * @property {number|string|null=} reviews
 * @property {number|string|null=} rating
 * @property {boolean=} tem_site
 * @property {string=} site
 * @property {string=} maps_url
 * @property {number|string|null=} score
 * @property {string=} motivo_score
 * @property {JsonObject=} raw_json
 *
 * @typedef {Object} ProspectPersistido
 * @property {string} id
 * @property {string} nome
 * @property {string} telefone
 * @property {string} nicho
 * @property {string} cidade
 * @property {string} endereco
 * @property {number|null} avaliacoes
 * @property {number|null} rating
 * @property {boolean} tem_site
 * @property {string} site
 * @property {string} maps_url
 * @property {string} place_id
 * @property {string} origem
 * @property {string} status
 * @property {number|null} score
 * @property {string} motivo_score
 * @property {string} categoria
 * @property {unknown|null} diagnostico
 * @property {unknown} created_at
 * @property {unknown} updated_at
 */

const RESPOSTA_VENDAS_CAMPOS_OBRIGATORIOS = [
  'etapa_proxima',
  'solicitar_calculo_preco',
  'handoff',
  'motivo_handoff',
]

const RESPOSTA_VENDAS_ALIASES_MENSAGEM = [
  'mensagem',
  'texto',
  'resposta',
  'mensagem_para_lead',
  'msg',
]

const LEAD_PROFILE_CAMPOS_PERMITIDOS_PADRAO = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'plano_sugerido',
  'preco_calculado',
  'entrada',
  'parcela',
  'precificacao_json',
  'pronto_handoff',
  'temperatura_lead',
  'precisa_sistema',
  'origem',
  'contexto_prospeccao',
  'maturidade_digital',
  'origem_anuncio',
  'intencao_principal',
  'produto_sugerido',
  'eventos_conversa',
  'reuniao_proposta',
  'dor_principal',
  'confusao_site_anuncio_google',
  'explicacao_teste_gratis_enviada',
  'expectativa_google_alinhada',
  'personalizacao_nicho_cidade_enviada',
])

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function issue(path, message) {
  return { path, message }
}

function schemaResult(value, issues) {
  return { ok: issues.length === 0, value, issues }
}

/**
 * Normaliza aliases comuns do modelo e reporta desvios sem endurecer o fluxo.
 * @param {unknown} raw
 * @returns {{ ok: boolean, value: RespostaVendasIA|null, issues: SchemaIssue[] }}
 */
function validarRespostaVendasIA(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, value: null, issues: [issue('$', 'resposta da IA deve ser objeto JSON')] }
  }
  const value = { ...raw }
  if (typeof value.mensagem_pro_lead !== 'string' || !value.mensagem_pro_lead.trim()) {
    for (const key of RESPOSTA_VENDAS_ALIASES_MENSAGEM) {
      const alt = value[key]
      if (typeof alt === 'string' && alt.trim()) {
        value.mensagem_pro_lead = alt.trim()
        break
      }
    }
  }

  const issues = []
  for (const campo of RESPOSTA_VENDAS_CAMPOS_OBRIGATORIOS) {
    if (!(campo in value)) issues.push(issue(campo, 'campo obrigatorio ausente'))
  }
  if (value.handoff === true && !value.motivo_handoff) {
    issues.push(issue('motivo_handoff', 'handoff:true sem motivo_handoff'))
  }
  if (!temMensagemRespostaVendas(value)) {
    issues.push(issue('mensagem_pro_lead', 'resposta sem mensagem enviavel'))
  }
  if (value.atualizar_perfil != null && !isPlainObject(value.atualizar_perfil)) {
    issues.push(issue('atualizar_perfil', 'deve ser objeto quando informado'))
  }
  return schemaResult(value, issues)
}

function temMensagemRespostaVendas(value) {
  if (Array.isArray(value.mensagens_bolhas) && value.mensagens_bolhas.some((m) => typeof m === 'string' && m.trim())) {
    return true
  }
  return typeof value.mensagem_pro_lead === 'string' && value.mensagem_pro_lead.trim().length > 0
}

/**
 * Whitelist rasa para patches de lead profile. Normalizacoes especificas continuam no modulo consumidor.
 * @param {unknown} input
 * @param {Set<string>} [camposPermitidos]
 * @returns {{ ok: boolean, value: JsonObject, issues: SchemaIssue[] }}
 */
function validarAtualizarPerfilLead(input, camposPermitidos = LEAD_PROFILE_CAMPOS_PERMITIDOS_PADRAO) {
  if (!isPlainObject(input)) return { ok: false, value: {}, issues: [issue('$', 'atualizar_perfil deve ser objeto')] }
  const value = {}
  const issues = []
  for (const [key, val] of Object.entries(input)) {
    if (!camposPermitidos.has(key)) {
      issues.push(issue(key, 'campo nao permitido em lead_profiles'))
      continue
    }
    value[key] = val
  }
  return schemaResult(value, issues)
}

/**
 * Garante que payload de job seja um objeto JSON serializavel, reportando problemas conhecidos.
 * @param {string} tipo
 * @param {unknown} payload
 * @returns {{ ok: boolean, value: JobQueuePayload, issues: SchemaIssue[] }}
 */
function validarJobQueuePayload(tipo, payload) {
  const issues = []
  if (!isPlainObject(payload)) {
    return { ok: false, value: {}, issues: [issue('payload', 'payload de job deve ser objeto')] }
  }
  const value = { ...payload }
  if ('prospect_ids' in value && !Array.isArray(value.prospect_ids)) {
    issues.push(issue('payload.prospect_ids', 'deve ser array quando informado'))
  }
  if (tipo === 'prospeccao_envio_agendado' && typeof value.prospect_id !== 'string') {
    issues.push(issue('payload.prospect_id', 'job de envio agendado deve informar prospect_id string'))
  }
  if ('limit' in value && !Number.isFinite(Number(value.limit))) {
    issues.push(issue('payload.limit', 'limit deve ser numerico quando informado'))
  }
  return schemaResult(value, issues)
}

/**
 * @param {unknown} prospect
 * @param {unknown} contexto
 * @returns {{ ok: boolean, value: { prospect: ProspectInput|JsonObject, contexto: JsonObject }, issues: SchemaIssue[] }}
 */
function validarProspectInput(prospect, contexto = {}) {
  const issues = []
  if (!isPlainObject(prospect)) issues.push(issue('prospect', 'prospect deve ser objeto'))
  if (!isPlainObject(contexto)) issues.push(issue('contexto', 'contexto deve ser objeto'))
  return schemaResult(
    {
      prospect: isPlainObject(prospect) ? prospect : {},
      contexto: isPlainObject(contexto) ? contexto : {},
    },
    issues
  )
}

/**
 * @param {unknown} row
 * @returns {ProspectPersistido|null}
 */
function normalizarProspectPersistido(row) {
  if (!isPlainObject(row)) return null
  const rawJson = isPlainObject(row.raw_json) ? row.raw_json : {}
  const categoriaRaw = rawJson.primaryTypeDisplayName
  const categoria = row.categoria
    || (typeof categoriaRaw === 'string' ? categoriaRaw : isPlainObject(categoriaRaw) ? categoriaRaw.text : '')
    || ''
  return {
    id: row.id,
    nome: row.nome,
    telefone: row.telefone || '',
    nicho: row.nicho,
    cidade: row.cidade,
    endereco: row.endereco || '',
    avaliacoes: row.avaliacoes == null ? null : Number(row.avaliacoes),
    rating: row.rating == null ? null : Number(row.rating),
    tem_site: !!row.tem_site,
    site: row.site || '',
    maps_url: row.maps_url || '',
    place_id: row.place_id,
    origem: row.origem,
    status: row.status,
    score: row.score == null ? null : Number(row.score),
    motivo_score: row.motivo_score || '',
    categoria,
    diagnostico: row.diagnostico || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * @param {unknown} row
 * @returns {object|null}
 */
function normalizarDiagnosticoPersistido(row) {
  if (!isPlainObject(row)) return null
  return {
    id: row.id,
    prospect_id: row.prospect_id,
    dor_principal: row.dor_principal || '',
    perda_estimada: row.perda_estimada == null ? null : Number(row.perda_estimada),
    mensagem_gerada: row.mensagem_gerada || '',
    mensagem_editada: row.mensagem_editada || '',
    aprovado_em: row.aprovado_em,
    enviado_em: row.enviado_em,
    agendado_para: row.agendado_para || null,
    metadata_json: isPlainObject(row.metadata_json) ? row.metadata_json : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

module.exports = {
  LEAD_PROFILE_CAMPOS_PERMITIDOS_PADRAO,
  RESPOSTA_VENDAS_CAMPOS_OBRIGATORIOS,
  normalizarDiagnosticoPersistido,
  normalizarProspectPersistido,
  validarAtualizarPerfilLead,
  validarJobQueuePayload,
  validarProspectInput,
  validarRespostaVendasIA,
}
