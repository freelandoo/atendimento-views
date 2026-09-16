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
  'last_updated', 'lastUpdated', 'updated_at', 'updatedAt', 'last_seen', 'lastSeen',
]

// Nomes possiveis da colecao de avaliacoes. A fonte (Bright Data) nao publica contrato
// estavel, entao a lista vive AQUI — o dono do vocabulario de atividade — e nao espalhada
// pelo adaptador, que antes chutava quatro grafias de data por conta propria.
const CAMPOS_COLECAO_REVIEWS = ['reviews', 'google_reviews', 'reviews_data', 'top_reviews']
const CAMPOS_COLECAO_FOTOS = ['photos', 'photos_and_videos']

// Onde o registro CRU da fonte fica preservado dentro do lead (ver places-brightdata.js).
// Guardar o bruto e' o que permite descobrir o nome real de um campo DEPOIS da coleta, sem
// pagar a coleta de novo.
const CHAVE_FONTE_BRUTA = 'fonte_bruta'

/**
 * Todos os objetos onde vale procurar um sinal, do mais especifico para o mais generico.
 *
 * Existe porque o mesmo lead chega em tres formas diferentes: o `place` adaptado (coleta), a
 * linha do banco (`raw_json`) e o registro cru da fonte (`fonte_bruta`). Procurar em um so'
 * fazia o classificador responder "sem sinal" sobre um lead cujo dado estava a um nivel de
 * distancia — e "sem sinal" aqui vira descarte.
 */
function fontesDeDados(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const rj = raw.raw_json && typeof raw.raw_json === 'object' ? raw.raw_json : {}
  const candidatos = [raw, rj, raw[CHAVE_FONTE_BRUTA], rj[CHAVE_FONTE_BRUTA]]
  const fontes = []
  for (const c of candidatos) {
    if (c && typeof c === 'object' && !fontes.includes(c)) fontes.push(c)
  }
  return fontes
}

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
  const fontes = fontesDeDados(input)
  for (const f of fontes) if (f.permanently_closed === true) return 'fechado_permanente'
  for (const f of fontes) if (f.temporarily_closed === true) return 'fechado_temporario'
  // `businessStatus` antes de `status`: `status` no prospect e' o funil interno
  // ('aguardando', 'enviado'...) e nunca fala do Google.
  const status = primeiroTexto(
    ...fontes.map((f) => statusGoogleConhecido(f.businessStatus)),
    ...fontes.map((f) => statusGoogleConhecido(f.status))
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
  return fontesDeDados(input).some(
    (f) => !!(f.regularOpeningHours || f.currentOpeningHours || f.open_hours)
  )
}

function colecaoEm(input, campos) {
  for (const f of fontesDeDados(input)) {
    for (const campo of campos) {
      if (Array.isArray(f[campo]) && f[campo].length) return f[campo]
    }
  }
  return []
}

function contarFotos(input = {}) {
  return colecaoEm(input, CAMPOS_COLECAO_FOTOS).length
}

function ultimaAtividadeGoogle(input = {}) {
  const datas = []
  for (const f of fontesDeDados(input)) datas.push(...datasDeObjeto(f, CAMPOS_DATA_RAIZ))
  datas.push(...datasDeColecao(colecaoEm(input, CAMPOS_COLECAO_REVIEWS)))
  datas.push(...datasDeColecao(colecaoEm(input, CAMPOS_COLECAO_FOTOS)))
  return maiorData(datas)
}

function calcularAtividadeGoogle(input = {}, opts = {}) {
  const agora = opts.agora ? new Date(opts.agora) : new Date()
  const status = normalizarStatusGoogle(input)
  const ultima = ultimaAtividadeGoogle(input)
  const dias = diasDesde(ultima, agora)
  let reviews = 0
  for (const f of fontesDeDados(input)) {
    const n = numero(f.userRatingCount ?? f.avaliacoes ?? f.reviews_count)
    if (n != null) { reviews = n; break }
  }
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
  CHAVE_FONTE_BRUTA,
  CAMPOS_COLECAO_REVIEWS,
  fontesDeDados,
  dataValida,
  normalizarStatusGoogle,
  statusGoogleConhecido,
  ultimaAtividadeGoogle,
  calcularAtividadeGoogle,
}
