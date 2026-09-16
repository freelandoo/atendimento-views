'use strict'
// Sinais publicos de atividade do Perfil da Empresa/Google Maps.
//
// Isto nao tenta provar que o negocio esta aberto. A meta e' reduzir energia gasta em
// perfil provavelmente parado: fechado derruba forte; review/foto recente ajuda; falta
// de recencia vira alerta, nao descarte automatico.

const SEIS_MESES_DIAS = 183
const UM_ANO_DIAS = 365

const CAMPOS_DATA_REVIEW = [
  'publishTime', 'published_at', 'publishedAt', 'review_date', 'reviewDate',
  'date', 'datetime', 'created_at', 'createdAt', 'time', 'timestamp',
]
const CAMPOS_DATA_RAIZ = [
  'latestReviewDate', 'latest_review_date', 'lastReviewDate', 'last_review_date',
  'reviews_last_updated', 'reviewsLastUpdated', 'last_review_at', 'latest_review_at',
]

function dataValida(valor) {
  if (valor == null || valor === '') return null
  if (typeof valor === 'number') {
    const ms = valor > 1e12 ? valor : valor * 1000
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d : null
  }
  if (typeof valor === 'string') {
    const s = valor.trim()
    if (!s) return null
    const d = new Date(s)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

function diasDesde(data, agora = new Date()) {
  if (!(data instanceof Date) || !Number.isFinite(data.getTime())) return null
  const ref = agora instanceof Date ? agora : new Date(agora)
  if (!Number.isFinite(ref.getTime())) return null
  return Math.floor((ref.getTime() - data.getTime()) / 86400000)
}

function primeiroTexto(...valores) {
  for (const v of valores) {
    const s = String(v == null ? '' : v).trim()
    if (s) return s
  }
  return ''
}

function statusGoogleConhecido(valor) {
  const status = String(valor == null ? '' : valor).trim().toUpperCase()
  if (!status) return ''
  if (status.includes('CLOSED_PERMANENTLY') || status === 'FECHADO_PERMANENTEMENTE') return 'fechado_permanente'
  if (status.includes('CLOSED_TEMPORARILY') || status === 'FECHADO_TEMPORARIAMENTE') return 'fechado_temporario'
  if (status.includes('FUTURE_OPENING')) return 'abertura_futura'
  if (status.includes('OPERATIONAL')) return 'operacional'
  return ''
}

function normalizarStatusGoogle(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const rj = raw.raw_json && typeof raw.raw_json === 'object' ? raw.raw_json : {}
  if (raw.permanently_closed === true || rj.permanently_closed === true) return 'fechado_permanente'
  if (raw.temporarily_closed === true || rj.temporarily_closed === true) return 'fechado_temporario'
  const status = primeiroTexto(
    statusGoogleConhecido(raw.businessStatus),
    statusGoogleConhecido(rj.businessStatus),
    statusGoogleConhecido(rj.status),
    statusGoogleConhecido(raw.status)
  )
  if (status) return status
  return 'desconhecido'
}

function datasDeObjeto(obj, campos) {
  if (!obj || typeof obj !== 'object') return []
  const datas = []
  for (const campo of campos) {
    const d = dataValida(obj[campo])
    if (d) datas.push(d)
  }
  return datas
}

function arrayEm(...candidatos) {
  for (const c of candidatos) {
    if (Array.isArray(c)) return c
  }
  return []
}

function datasDeColecao(itens) {
  const datas = []
  for (const item of Array.isArray(itens) ? itens : []) {
    datas.push(...datasDeObjeto(item, CAMPOS_DATA_REVIEW))
  }
  return datas
}

function maiorData(datas) {
  let maior = null
  for (const d of datas) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) continue
    if (!maior || d.getTime() > maior.getTime()) maior = d
  }
  return maior
}

function numero(valor) {
  if (valor == null || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function temHorario(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const rj = raw.raw_json && typeof raw.raw_json === 'object' ? raw.raw_json : {}
  return !!(
    raw.regularOpeningHours || raw.currentOpeningHours || raw.open_hours ||
    rj.regularOpeningHours || rj.currentOpeningHours || rj.open_hours
  )
}

function contarFotos(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const rj = raw.raw_json && typeof raw.raw_json === 'object' ? raw.raw_json : {}
  const fotos = arrayEm(raw.photos, raw.photos_and_videos, rj.photos, rj.photos_and_videos)
  return fotos.length
}

function ultimaAtividadeGoogle(input = {}) {
  const raw = input && typeof input === 'object' ? input : {}
  const rj = raw.raw_json && typeof raw.raw_json === 'object' ? raw.raw_json : {}
  const reviews = arrayEm(raw.reviews, raw.google_reviews, rj.reviews, rj.google_reviews)
  const fotos = arrayEm(raw.photos, raw.photos_and_videos, rj.photos, rj.photos_and_videos)
  return maiorData([
    ...datasDeObjeto(raw, CAMPOS_DATA_RAIZ),
    ...datasDeObjeto(rj, CAMPOS_DATA_RAIZ),
    ...datasDeColecao(reviews),
    ...datasDeColecao(fotos),
  ])
}

function calcularAtividadeGoogle(input = {}, opts = {}) {
  const agora = opts.agora ? new Date(opts.agora) : new Date()
  const status = normalizarStatusGoogle(input)
  const ultima = ultimaAtividadeGoogle(input)
  const dias = diasDesde(ultima, agora)
  const reviews = numero(input.userRatingCount ?? input.avaliacoes ?? input.reviews_count ?? input.raw_json?.userRatingCount ?? input.raw_json?.reviews_count) || 0
  const fotos = contarFotos(input)
  const horario = temHorario(input)

  if (status === 'fechado_permanente') {
    return {
      faixa: 'fechado',
      pontos: -90,
      ultima_atividade_em: ultima ? ultima.toISOString() : null,
      dias_desde_atividade: dias,
      motivos: ['Perfil marcado como fechado permanentemente no Google.'],
      sinais: { status, reviews, fotos, horario },
    }
  }
  if (status === 'fechado_temporario') {
    return {
      faixa: 'fechado_temporario',
      pontos: -55,
      ultima_atividade_em: ultima ? ultima.toISOString() : null,
      dias_desde_atividade: dias,
      motivos: ['Perfil marcado como fechado temporariamente no Google.'],
      sinais: { status, reviews, fotos, horario },
    }
  }
  if (status === 'abertura_futura') {
    return {
      faixa: 'abertura_futura',
      pontos: -25,
      ultima_atividade_em: ultima ? ultima.toISOString() : null,
      dias_desde_atividade: dias,
      motivos: ['Perfil ainda marcado como abertura futura.'],
      sinais: { status, reviews, fotos, horario },
    }
  }

  if (dias != null && dias <= SEIS_MESES_DIAS) {
    return {
      faixa: 'ativo_recente',
      pontos: 14,
      ultima_atividade_em: ultima.toISOString(),
      dias_desde_atividade: dias,
      motivos: ['Teve atividade publica no Google nos ultimos 6 meses.'],
      sinais: { status, reviews, fotos, horario },
    }
  }
  if (dias != null && dias <= UM_ANO_DIAS) {
    return {
      faixa: 'atividade_morna',
      pontos: 4,
      ultima_atividade_em: ultima.toISOString(),
      dias_desde_atividade: dias,
      motivos: ['Teve atividade publica no Google, mas ja passou de 6 meses.'],
      sinais: { status, reviews, fotos, horario },
    }
  }
  if (dias != null) {
    return {
      faixa: 'atividade_antiga',
      pontos: -18,
      ultima_atividade_em: ultima.toISOString(),
      dias_desde_atividade: dias,
      motivos: ['Ultima atividade publica no Google tem mais de 1 ano.'],
      sinais: { status, reviews, fotos, horario },
    }
  }

  if (reviews >= 20 || fotos >= 3 || horario) {
    return {
      faixa: 'ativo_sem_data',
      pontos: 2,
      ultima_atividade_em: null,
      dias_desde_atividade: null,
      motivos: ['Tem sinais publicos de operacao, mas sem data de atividade confiavel.'],
      sinais: { status, reviews, fotos, horario },
    }
  }

  return {
    faixa: 'possivelmente_inativo',
    pontos: -15,
    ultima_atividade_em: null,
    dias_desde_atividade: null,
    motivos: ['Sem sinais publicos recentes de atividade no Google.'],
    sinais: { status, reviews, fotos, horario },
  }
}

module.exports = {
  SEIS_MESES_DIAS,
  UM_ANO_DIAS,
  dataValida,
  normalizarStatusGoogle,
  statusGoogleConhecido,
  ultimaAtividadeGoogle,
  calcularAtividadeGoogle,
}
