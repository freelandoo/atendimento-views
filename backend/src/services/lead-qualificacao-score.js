'use strict'
// Veredito comercial explicavel do lead.
//
// Este modulo NAO coleta dado e NAO decide sozinho uma acao destrutiva. Ele organiza os sinais
// que ja existem (Google, Instagram, site, contato e ICP) em uma regua unica:
// pontos positivos, penalidades, bloqueios e necessidade de validacao humana.

const { calcularAtividadeGoogle } = require('./google-business-activity')
const { classificarLead } = require('./site-classificacao')
const { perfilConfirmado, CONFIANCA } = require('./instagram-perfil')

const VALIDACAO = Object.freeze({
  APTO_AUTOMATICO: 'apto_automatico',
  REVISAR_RAPIDO: 'revisar_rapido',
  VALIDACAO_HUMANA: 'validacao_humana_obrigatoria',
  AUTOMATICA_HUMANA: 'automatica_humana',
  BLOQUEADO: 'bloqueado_automatico',
  BAIXO_FIT: 'baixo_fit',
})

const PRIORIDADE = Object.freeze({
  ALTA: 'alta',
  MEDIA: 'media',
  BAIXA: 'baixa',
  BLOQUEADA: 'bloqueada',
})

const TIPO = Object.freeze({
  BLOQUEIO: 'bloqueio',
  FORTE: 'forte',
  LEVE: 'leve',
  REVISAO: 'revisao',
})

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

function numero(valor) {
  if (valor == null || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function diasDesde(valor, agora = new Date()) {
  if (!valor) return null
  const t = valor instanceof Date ? valor.getTime() : Date.parse(String(valor))
  if (!Number.isFinite(t)) return null
  const ref = agora instanceof Date ? agora : new Date(agora)
  if (!Number.isFinite(ref.getTime())) return null
  return Math.max(0, Math.floor((ref.getTime() - t) / 86400000))
}

function telefoneDiscavel(bruto) {
  const raw = texto(bruto)
  const digitos = raw.replace(/\D/g, '')
  if (!digitos) return false
  const temPlus = /^\s*\+/.test(raw)
  let resto = digitos
  if (digitos.startsWith('55')) {
    const semDdi = digitos.slice(2)
    if (semDdi.length === 10 || semDdi.length === 11) resto = semDdi
    else if (temPlus && (semDdi.length === 8 || semDdi.length === 9)) return false
  }
  return resto.length === 10 || resto.length === 11
}

function item(tipo, chave, rotulo, pontos, extra = {}) {
  return { tipo, chave, rotulo, pontos, ...extra }
}

function bloqueadoAteAtivo(lead = {}, agora = new Date()) {
  const valor = lead.bloqueado_ate
  if (!valor) return false
  const t = Date.parse(String(valor))
  const ref = agora instanceof Date ? agora.getTime() : new Date(agora).getTime()
  return Number.isFinite(t) && Number.isFinite(ref) && t > ref
}

function scoreIcp100(lead = {}) {
  const n = numero(lead.icp_score)
  if (n == null) return null
  return Math.max(0, Math.min(100, Math.round((n / 13) * 100)))
}

function sinalInstagram(lead = {}, agora = new Date()) {
  const atividade = texto(lead.instagram_atividade)
  const confirmado = perfilConfirmado(lead)
  const candidato = texto(lead.instagram_confianca) === CONFIANCA.CANDIDATO
    && !!texto(lead.instagram_candidato)
  const dias = diasDesde(lead.instagram_ultimo_post_em, agora)
  if (confirmado && atividade === 'ativo_recente') {
    return { pontos: 14, motivos: ['Instagram confirmado com post recente.'], estado: 'ativo_recente', dias }
  }
  if (confirmado && atividade === 'atividade_morna') {
    return { pontos: 7, motivos: ['Instagram confirmado, mas ja passou de 30 dias do ultimo post.'], estado: 'atividade_morna', dias }
  }
  if (confirmado && atividade === 'atividade_antiga') {
    return { pontos: 0, motivos: [], estado: 'atividade_antiga', dias }
  }
  if (confirmado && atividade === 'sem_posts') {
    return { pontos: 0, motivos: [], estado: 'sem_posts', dias }
  }
  if (confirmado) {
    return { pontos: 4, motivos: ['Instagram confirmado; atividade ainda pendente.'], estado: atividade || 'nao_verificado', dias }
  }
  if (candidato) return { pontos: 0, motivos: [], estado: 'candidato', dias }
  return { pontos: 0, motivos: [], estado: atividade || 'nao_verificado', dias }
}

function faixaScore(score) {
  if (score >= 75) return 'A'
  if (score >= 50) return 'B'
  if (score >= 25) return 'C'
  return 'fora'
}

function prioridadePor(score, validacao) {
  if (validacao === VALIDACAO.BLOQUEADO) return PRIORIDADE.BLOQUEADA
  if (score >= 75) return PRIORIDADE.ALTA
  if (score >= 50) return PRIORIDADE.MEDIA
  return PRIORIDADE.BAIXA
}

function dedupePorChave(lista) {
  const vistos = new Set()
  return lista.filter((i) => {
    if (!i || !i.chave || vistos.has(i.chave)) return false
    vistos.add(i.chave)
    return true
  })
}

function avaliarQualificacaoLead(lead = {}, opts = {}) {
  const agora = opts.agora ? new Date(opts.agora) : new Date()
  const sinais = []
  const penalidades = []
  const revisoes = []
  const bloqueios = []

  const atividadeGoogle = calcularAtividadeGoogle(lead, { agora })
  const url = classificarLead(lead)
  const rating = numero(lead.rating)
  const avaliacoes = numero(lead.avaliacoes)
  const raw = lead.raw_json && typeof lead.raw_json === 'object' ? lead.raw_json : {}
  const fotos = numero(lead.fotos)
    ?? numero(raw.photos_count)
    ?? (Array.isArray(raw.photos) ? raw.photos.length : null)
  const horarioConhecido = Object.prototype.hasOwnProperty.call(raw, 'regularOpeningHours')
    || Object.prototype.hasOwnProperty.call(raw, 'currentOpeningHours')
    || Object.prototype.hasOwnProperty.call(raw, 'open_hours')
    || typeof lead.horario_funcionamento === 'boolean'
  const horario = horarioConhecido
    ? !!(raw.regularOpeningHours || raw.currentOpeningHours || raw.open_hours || lead.horario_funcionamento)
    : null
  const googleSinalConhecido = avaliacoes != null || fotos != null || horarioConhecido
    || Object.keys(raw).length > 0
  const telefoneOk = telefoneDiscavel(lead.telefone)
  const ig = sinalInstagram(lead, agora)

  if (atividadeGoogle.faixa === 'fechado') {
    bloqueios.push(item(TIPO.BLOQUEIO, 'google_fechado', 'Google marcado como fechado permanentemente.', -100))
  } else if (atividadeGoogle.faixa === 'fechado_temporario') {
    penalidades.push(item(TIPO.FORTE, 'google_fechado_temporario', 'Google marcado como fechado temporariamente.', -35))
    revisoes.push(item(TIPO.REVISAO, 'validar_google_temporario', 'Validar se o fechamento temporario ainda vale.', 0))
  } else if (atividadeGoogle.faixa === 'abertura_futura') {
    penalidades.push(item(TIPO.FORTE, 'google_abertura_futura', 'Google indica abertura futura.', -25))
    revisoes.push(item(TIPO.REVISAO, 'validar_abertura_futura', 'Validar momento certo antes de abordar.', 0))
  }

  if (lead.opt_out === true || lead.nao_contatar === true) {
    bloqueios.push(item(TIPO.BLOQUEIO, 'opt_out', 'Opt-out ou contato bloqueado.', -100))
  }
  if (bloqueadoAteAtivo(lead, agora)) {
    bloqueios.push(item(TIPO.BLOQUEIO, 'bloqueio_temporario', 'Lead bloqueado por politica/cooldown operacional.', -100))
  }
  if (lead.duplicado === true || lead.duplicado_de || lead.duplicate_of) {
    bloqueios.push(item(TIPO.BLOQUEIO, 'duplicado', 'Duplicado claro de outro lead.', -100))
  }
  if (!telefoneOk) {
    penalidades.push(item(TIPO.FORTE, 'telefone_invalido', 'Telefone ausente ou invalido para WhatsApp/ligacao.', -22))
    revisoes.push(item(TIPO.REVISAO, 'validar_contato', 'Validar contato antes de abordar.', 0))
  }

  if (url.situacao_site === 'sem_site') {
    sinais.push(item('positivo', 'sem_site_proprio', 'Sem site proprio: dor digital clara.', 14))
  } else if (url.situacao_site === 'tem_site') {
    sinais.push(item('positivo', 'site_proprio', 'Site proprio identificado.', 4))
    if (lead.oferta_recomendada === 'site_profissional') {
      penalidades.push(item(TIPO.FORTE, 'oferta_site_conflita', 'Oferta de site novo conflita com site proprio identificado.', -16))
      revisoes.push(item(TIPO.REVISAO, 'revisar_oferta_site', 'Revisar oferta: talvez seja redesign, SEO ou automacao.', 0))
    }
  } else {
    revisoes.push(item(TIPO.REVISAO, 'validar_site', 'Link/site precisa de validacao humana.', 0))
    penalidades.push(item(TIPO.LEVE, 'site_nao_identificado', 'Site proprio ainda nao confirmado.', -3))
  }

  if (atividadeGoogle.faixa === 'ativo_recente') sinais.push(item('positivo', 'google_ativo_recente', 'Google com atividade publica recente.', 12))
  else if (atividadeGoogle.faixa === 'ativo_sem_data') sinais.push(item('positivo', 'google_ativo_sem_data', 'Google tem sinais publicos de operacao.', 4))
  else if (atividadeGoogle.faixa === 'atividade_morna') {
    penalidades.push(item(TIPO.LEVE, 'google_morno', 'Google sem atividade recente ha mais de 6 meses.', -6))
  } else if (atividadeGoogle.faixa === 'atividade_antiga') {
    penalidades.push(item(TIPO.FORTE, 'google_antigo', 'Google sem atividade publica ha mais de 1 ano.', -18))
  } else if (atividadeGoogle.faixa === 'possivelmente_inativo' && googleSinalConhecido && (avaliacoes == null || avaliacoes < 5)) {
    penalidades.push(item(TIPO.LEVE, 'google_pouco_sinal', 'Poucos sinais publicos de atividade no Google.', -8))
  }

  if (ig.pontos > 0) sinais.push(item('positivo', `instagram_${ig.estado}`, ig.motivos[0], ig.pontos))
  if (ig.estado === 'atividade_antiga') {
    const longa = ig.dias != null && ig.dias > 180
    penalidades.push(item(longa ? TIPO.FORTE : TIPO.LEVE, longa ? 'instagram_6m' : 'instagram_3m',
      longa ? 'Instagram sem atividade ha mais de 6 meses.' : 'Instagram sem atividade ha mais de 3 meses.',
      longa ? -14 : -8))
  } else if (ig.estado === 'sem_posts') {
    penalidades.push(item(TIPO.LEVE, 'instagram_sem_posts', 'Instagram confirmado, mas sem posts.', -6))
  } else if (ig.estado === 'candidato') {
    revisoes.push(item(TIPO.REVISAO, 'instagram_candidato', 'Instagram candidato precisa de confirmacao humana.', 0))
  }

  const googleParado = ['atividade_antiga', 'possivelmente_inativo'].includes(atividadeGoogle.faixa)
  const instagramParado = ig.estado === 'atividade_antiga' || ig.estado === 'sem_posts'
  if (googleParado && instagramParado) {
    penalidades.push(item(TIPO.FORTE, 'google_instagram_parados', 'Google e Instagram indicam baixa atividade juntos.', -18))
    revisoes.push(item(TIPO.REVISAO, 'validar_atividade_dupla', 'Validar manualmente antes de gastar abordagem.', 0))
  }

  if (avaliacoes != null) {
    if (avaliacoes >= 50) sinais.push(item('positivo', 'muitas_avaliacoes', 'Muitas avaliacoes no Google.', 9))
    else if (avaliacoes >= 20) sinais.push(item('positivo', 'avaliacoes_medias', 'Boa base de avaliacoes no Google.', 6))
    else if (avaliacoes > 0 && avaliacoes < 5) penalidades.push(item(TIPO.LEVE, 'poucas_avaliacoes', 'Pouquissimas avaliacoes no Google.', -4))
  }
  if (rating != null) {
    if (rating >= 4.5) sinais.push(item('positivo', 'nota_alta', 'Nota alta no Google.', 7))
    else if (rating >= 4) sinais.push(item('positivo', 'nota_boa', 'Boa nota no Google.', 4))
    else if (rating < 3.5) penalidades.push(item(TIPO.LEVE, 'nota_baixa', 'Nota baixa no Google.', -8))
  }
  if (fotos === 0) penalidades.push(item(TIPO.LEVE, 'sem_fotos_google', 'Sem fotos no Google.', -3))
  if (horarioConhecido && horario === false) penalidades.push(item(TIPO.LEVE, 'sem_horario_google', 'Sem horario cadastrado no Google.', -3))

  const nicho = texto(lead.nicho || lead.categoria_perfil).toLowerCase()
  if (!nicho || ['establishment', 'point_of_interest', 'store'].includes(nicho)) {
    penalidades.push(item(TIPO.LEVE, 'categoria_generica', 'Categoria/nicho generico demais.', -3))
    revisoes.push(item(TIPO.REVISAO, 'validar_categoria', 'Validar categoria antes de personalizar abordagem.', 0))
  }

  const icp100 = scoreIcp100(lead)
  if (icp100 != null) {
    if (icp100 >= 75) sinais.push(item('positivo', 'icp_alto', 'ICP humano/comercial alto.', 10))
    else if (icp100 >= 50) sinais.push(item('positivo', 'icp_medio', 'ICP humano/comercial medio.', 5))
  }

  const positivos = dedupePorChave(sinais)
  const riscos = dedupePorChave(penalidades)
  const pendencias = dedupePorChave(revisoes)
  const travas = dedupePorChave(bloqueios)
  const somaPositiva = positivos.reduce((acc, s) => acc + (Number(s.pontos) || 0), 0)
  const somaNegativa = riscos.reduce((acc, s) => acc + (Number(s.pontos) || 0), 0)
  const score = travas.length
    ? 0
    : Math.max(0, Math.min(100, Math.round(45 + somaPositiva + somaNegativa)))

  let validacao = VALIDACAO.APTO_AUTOMATICO
  if (travas.length) validacao = VALIDACAO.BLOQUEADO
  else if (riscos.some((p) => p.tipo === TIPO.FORTE) && pendencias.length) validacao = VALIDACAO.AUTOMATICA_HUMANA
  else if (riscos.some((p) => p.tipo === TIPO.FORTE) || pendencias.some((p) => p.chave !== 'validar_site')) validacao = VALIDACAO.VALIDACAO_HUMANA
  else if (score < 25) validacao = VALIDACAO.BAIXO_FIT
  else if (riscos.length || pendencias.length) validacao = VALIDACAO.REVISAR_RAPIDO

  const faixa = faixaScore(score)
  return {
    score_100: score,
    faixa,
    prioridade: prioridadePor(score, validacao),
    validacao,
    confianca: pendencias.length || riscos.some((p) => p.tipo === TIPO.FORTE) ? 'media' : 'alta',
    bloqueios: travas,
    penalidades: riscos,
    revisoes: pendencias,
    sinais: positivos.filter((s) => s.pontos > 0),
    motivos: [
      ...travas.map((p) => p.rotulo),
      ...riscos.map((p) => p.rotulo),
      ...positivos.filter((s) => s.pontos > 0).map((s) => s.rotulo),
    ].slice(0, 8),
    dimensoes: {
      google_atividade: atividadeGoogle.faixa,
      instagram_atividade: ig.estado,
      situacao_site: url.situacao_site,
      telefone_discavel: telefoneOk,
      icp_score_100: icp100,
    },
  }
}

module.exports = {
  VALIDACAO,
  PRIORIDADE,
  TIPO,
  telefoneDiscavel,
  avaliarQualificacaoLead,
}
