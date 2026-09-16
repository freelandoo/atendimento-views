'use strict'
// Score ICP do lead — Fase 1.
//
// Separa sinais AUTOMATICOS (sugestoes seguras a partir do cadastro) da decisao humana.
// O score final sempre vem das respostas marcadas pelo operador; sinais automaticos so
// pre-preenchem/explicam a ficha no Assistente de Oportunidades.

const { calcularScoreRespostas, CRITERIOS_TENKA_V1, MODELO_TENKA_V1 } = require('./icp-modelo')
const { classificarLead } = require('./site-classificacao')

function texto(valor) {
  return String(valor == null ? '' : valor).trim()
}

function numero(valor) {
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function sinal(ok, origem, motivo) {
  return { sugerido: !!ok, origem, motivo }
}

function temInstagramAtivo(lead = {}) {
  const origem = texto(lead.origem).toLowerCase()
  const seguidores = numero(lead.seguidores)
  return origem === 'instagram'
    || origem === 'linkedin'
    || !!texto(lead.instagram_handle)
    || !!texto(lead.bio)
    || !!texto(lead.link_bio)
    || (seguidores != null && seguidores > 0)
}

function calcularSinaisAutomaticos(lead = {}) {
  const url = classificarLead(lead)
  const avaliacoes = numero(lead.avaliacoes)
  const rating = numero(lead.rating)
  const instagramAtivo = temInstagramAtivo(lead)
  const operacaoValidada = (avaliacoes != null && avaliacoes >= 5) || (rating != null && rating >= 4)
  const lacunaDigital = url.situacao_site === 'sem_site'
    || (url.situacao_site === 'nao_identificado' && (instagramAtivo || !!texto(url.link_original)))

  return {
    operacao_validada: sinal(
      operacaoValidada,
      'cadastro',
      operacaoValidada
        ? 'Operacao com sinais publicos de atividade/reputacao.'
        : 'Sem evidencia automatica suficiente de operacao validada.'
    ),
    instagram_ativo: sinal(
      instagramAtivo,
      'cadastro',
      instagramAtivo ? 'Ha presenca social ou perfil coletado.' : 'Nenhum sinal social coletado.'
    ),
    lacuna_digital_clara: sinal(
      lacunaDigital,
      'site',
      lacunaDigital
        ? 'Nao ha site proprio confirmado ou o link precisa de revisao.'
        : 'Site proprio identificado ou lacuna digital nao confirmada.'
    ),
  }
}

function respostasSugeridas(lead = {}) {
  const sinais = calcularSinaisAutomaticos(lead)
  const respostas = {}
  for (const c of CRITERIOS_TENKA_V1) respostas[c.id] = false
  for (const [id, s] of Object.entries(sinais)) respostas[id] = !!s.sugerido
  return respostas
}

function calcularIcpLead(lead = {}, respostas = null) {
  const sinais_auto = calcularSinaisAutomaticos(lead)
  const baseRespostas = respostas == null ? respostasSugeridas(lead) : respostas
  const calculado = calcularScoreRespostas(baseRespostas)
  const motivos = calculado.criterios
    .filter((c) => c.marcado)
    .map((c) => c.rotulo)
  return {
    ...calculado,
    modelo: MODELO_TENKA_V1,
    sinais_auto,
    motivos,
  }
}

function resumoIcp(avaliacao) {
  if (!avaliacao) return null
  return {
    modelo: MODELO_TENKA_V1,
    score: avaliacao.score,
    score_maximo: avaliacao.score_maximo,
    faixa: avaliacao.faixa,
    criterios: avaliacao.criterios,
    sinais_auto: avaliacao.sinais_auto,
    motivos: avaliacao.motivos,
  }
}

module.exports = {
  calcularSinaisAutomaticos,
  respostasSugeridas,
  calcularIcpLead,
  resumoIcp,
}
