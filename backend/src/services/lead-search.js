'use strict'

const MAX_LEADS_PER_JOB = 100
const DEFAULT_LEADS_PER_JOB = 50

const ENTRY_SOURCE = Object.freeze({
  MAPS: 'maps',
})

const SOURCES = Object.freeze({
  GOOGLE_MAPS: 'google_maps',
})

const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  PARTIAL_COMPLETED: 'partial_completed',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
})

const SOURCE_STATE = Object.freeze({
  NOT_CHECKED: 'not_checked',
  FOUND: 'found',
  NOT_FOUND: 'not_found',
  PROVIDER_FAILED: 'provider_failed',
  EMPTY: 'empty',
})

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

function texto(valor) {
  const s = String(valor == null ? '' : valor).trim()
  return s || null
}

function numero(valor) {
  if (valor == null || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function lista(valor) {
  return Array.isArray(valor) ? valor.filter((v) => v != null && v !== '') : []
}

function normalizarLimiteBusca(valor, padrao = DEFAULT_LEADS_PER_JOB) {
  const bruto = valor == null || valor === '' ? padrao : Number.parseInt(valor, 10)
  if (!Number.isFinite(bruto) || bruto < 1) throw erro('Informe um limite entre 1 e 100 leads.', 400, 'INVALID_LIMIT')
  if (bruto > MAX_LEADS_PER_JOB) {
    throw erro('Cada busca pode pedir no maximo 100 leads.', 400, 'LIMIT_EXCEEDED')
  }
  return bruto
}

function normalizarRequestMaps(body = {}) {
  const nicho = texto(body.nicho || body.niche || body.termo || body.keyword)
  const cidade = texto(body.cidade || body.city || body.local || body.location)
  const pais = texto(body.pais || body.country) || 'BR'
  const requestedLimit = normalizarLimiteBusca(body.limit || body.limite || body.quantidade)

  if (!nicho) throw erro('Informe nicho para criar a busca.', 400, 'MISSING_NICHO')
  if (!cidade) throw erro('Informe cidade ou local para criar a busca.', 400, 'MISSING_CIDADE')

  return {
    entrySource: ENTRY_SOURCE.MAPS,
    requestedLimit,
    request: {
      nicho,
      cidade,
      pais: pais.toUpperCase(),
      limit: requestedLimit,
    },
  }
}

function rawRefPublico(rawRef = {}) {
  return {
    raw_ref_id: rawRef.id || null,
    source: rawRef.source || SOURCES.GOOGLE_MAPS,
    raw_path: rawRef.raw_path || 'payload',
    item_index: rawRef.item_index == null ? null : rawRef.item_index,
  }
}

function externalRefMaps(r = {}) {
  return texto(r.place_id) || texto(r.cid) || texto(r.url) || texto(r.name)
}

function montarDossierMaps(registro = {}, rawRef = {}) {
  const ref = rawRefPublico(rawRef)
  const externalRef = externalRefMaps(registro)
  const nome = texto(registro.name)
  const telefone = texto(registro.phone_number)
  const site = texto(registro.open_website)
  const mapsUrl = texto(registro.url)
  const endereco = texto(registro.address)
  const categoria = texto(registro.category)

  return {
    primary_source: SOURCES.GOOGLE_MAPS,
    external_ref: externalRef,
    canonical: {
      business: {
        name: nome,
        identifiers: {
          google_place_id: texto(registro.place_id),
          google_cid: texto(registro.cid),
        },
        categories: [categoria, ...lista(registro.all_categories)].filter(Boolean),
        address: endereco,
        locality: {
          city: texto(registro.city),
          region: texto(registro.state),
          country: texto(registro.country_code || registro.country),
        },
      },
      contacts: {
        phones: telefone ? [{ value: telefone, source: SOURCES.GOOGLE_MAPS, raw_ref: ref }] : [],
        emails: [],
      },
      web_presence: {
        websites: site ? [{ url: site, source: SOURCES.GOOGLE_MAPS, raw_ref: ref }] : [],
        google_maps_url: mapsUrl,
        instagram: null,
        facebook: null,
      },
      reputation: {
        rating: numero(registro.rating),
        reviews_count: numero(registro.reviews_count),
      },
      ads: {
        meta_active_ads: null,
      },
    },
    source_status: {
      [SOURCES.GOOGLE_MAPS]: {
        state: SOURCE_STATE.FOUND,
        provider_status: 'ready',
      },
    },
    source_data: {
      [SOURCES.GOOGLE_MAPS]: {
        place_id: texto(registro.place_id),
        cid: texto(registro.cid),
        name: nome,
        address: endereco,
        phone_number: telefone,
        website: site,
        maps_url: mapsUrl,
        rating: numero(registro.rating),
        reviews_count: numero(registro.reviews_count),
        category: categoria,
        all_categories: lista(registro.all_categories),
        open_hours: registro.open_hours && typeof registro.open_hours === 'object' ? registro.open_hours : null,
        permanently_closed: registro.permanently_closed === true,
        temporarily_closed: registro.temporarily_closed === true,
      },
    },
    raw_refs: [ref],
    verification: {
      state: 'source_declared',
      human_review_required: false,
      confirmed_by: null,
      confirmed_at: null,
    },
  }
}

function apresentarJob(row = {}) {
  if (!row) return null
  return {
    job_id: row.id || row.job_id,
    empresa_id: row.empresa_id,
    entry_source: row.entry_source,
    status: row.status,
    requested_limit: Number(row.requested_limit || 0),
    returned_count: Number(row.returned_count || 0),
    request: row.request || {},
    error_message: row.error_message || null,
    created_at: row.created_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at || null,
  }
}

function apresentarSource(row = {}) {
  return {
    source: row.source,
    state: row.source_state,
    provider_status: row.provider_status || null,
    external_snapshot_id: row.external_snapshot_id || null,
    records_requested: Number(row.records_requested || 0),
    records_returned: Number(row.records_returned || 0),
    cost_records: Number(row.cost_records || 0),
    error_type: row.error_type || null,
    error_message: row.error_message || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    updated_at: row.updated_at || null,
  }
}

function apresentarDossier(row = {}) {
  return {
    id: row.id,
    job_id: row.job_id,
    primary_source: row.primary_source,
    external_ref: row.external_ref || null,
    canonical: row.canonical || {},
    source_status: row.source_status || {},
    source_data: row.source_data || {},
    raw_refs: row.raw_refs || [],
    verification: row.verification || {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

module.exports = {
  MAX_LEADS_PER_JOB,
  DEFAULT_LEADS_PER_JOB,
  ENTRY_SOURCE,
  SOURCES,
  JOB_STATUS,
  SOURCE_STATE,
  erro,
  normalizarLimiteBusca,
  normalizarRequestMaps,
  montarDossierMaps,
  apresentarJob,
  apresentarSource,
  apresentarDossier,
}
