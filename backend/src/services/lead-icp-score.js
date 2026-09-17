'use strict'
// Score ICP do lead — Fase 1.
//
// Separa sinais AUTOMATICOS (sugestoes seguras a partir do cadastro) da decisao humana.
// O score final sempre vem das respostas marcadas pelo operador; sinais automaticos so
// pre-preenchem/explicam a ficha no Assistente de Oportunidades.

const { calcularScoreRespostas, CRITERIOS_TENKA_V1, MODELO_TENKA_V1 } = require('./icp-modelo')
const { classificarLead } = require('./site-classificacao')
const { perfilConfirmado } = require('./instagram-perfil')

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

/**
 * Qualquer rastro de presenca social — inclusive fraco (bio, link da bio, seguidores).
 *
 * Usada SO' pela lacuna digital, onde a pergunta e' "existe algum sinal de vida digital que
 * contraste com a ausencia de site?". Ali um rastro fraco serve; para afirmar que o lead TEM
 * Instagram, nao serve — ver `temPerfilSocialConfirmado`.
 */
function temPresencaSocial(lead = {}) {
  const origem = texto(lead.origem).toLowerCase()
  const seguidores = numero(lead.seguidores)
  return origem === 'instagram'
    || origem === 'linkedin'
    || !!texto(lead.instagram_handle)
    || !!texto(lead.bio)
    || !!texto(lead.link_bio)
    || (seguidores != null && seguidores > 0)
}

/**
 * O lead tem perfil social PROVADO?
 *
 * Antes, o sinal do criterio `instagram_ativo` era `temPresencaSocial`, e isso tinha dois
 * defeitos somados: (a) "tem bio" nunca foi "tem Instagram" — muito menos "Instagram ativo"; e
 * (b) o caminho do Maps NAO grava nenhum daqueles campos, entao o sinal era falso para a base
 * inteira. Um criterio `tipo: 'automatico'` que nunca liga.
 *
 * Agora quem responde e' `instagram-perfil.js`, o dono do vocabulario. Lead de captacao social
 * continua marcando (o perfil E' o lead, e `instagram_handle` ja' vem preenchido) e lead do Maps
 * passa a marcar quando o Instagram foi confirmado a partir do Perfil da Empresa ou da revisao
 * humana. Ninguem perde pre-marcacao; o Maps ganha.
 *
 * DESDE 2026-09-17 A ATIVIDADE EXISTE (sonda do dataset `ig_perfis`: o perfil traz `posts` com
 * data). O sinal passou a usa-la, com uma assimetria deliberada:
 *   - atividade MEDIDA e parada (antiga / sem posts) ⇒ NAO sugere. Agora se SABE que nao esta
 *     ativo, e continuar sugerindo faria o sistema afirmar o contrario do que mediu.
 *   - atividade NAO MEDIDA (ninguem raspou ainda, perfil privado, fonte sem data) ⇒ sugere, como
 *     antes. Ausencia de medida nunca vira negativa: seria tirar pre-marcacao de todo lead que o
 *     worker ainda nao alcancou — exatamente o que a entrega anterior prometeu nao fazer.
 *
 * Atividade de perfil apenas CANDIDATO nao entra aqui de proposito: `perfilConfirmado` ja' a
 * barra. Medida sobre um perfil que talvez nem seja do lead e' sinal fraco para priorizar
 * revisao humana, nunca ponto no ICP (regra do operador, 2026-09-16).
 */
const ATIVIDADE_PARADA = new Set(['atividade_antiga', 'sem_posts'])

function temPerfilSocialConfirmado(lead = {}) {
  if (!perfilConfirmado(lead)) return false
  return !ATIVIDADE_PARADA.has(String(lead.instagram_atividade || ''))
}

/** O motivo exibido, que precisa dizer se houve medicao — e nao so o veredito. */
function motivoInstagram(lead = {}, ok) {
  const atividade = String(lead.instagram_atividade || '')
  if (!ok) {
    if (ATIVIDADE_PARADA.has(atividade)) {
      return atividade === 'sem_posts'
        ? 'Perfil confirmado, mas sem nenhuma publicacao.'
        : 'Perfil confirmado, mas sem postar ha mais de 3 meses.'
    }
    return 'Nenhum perfil social confirmado para este lead.'
  }
  if (atividade === 'ativo_recente') return 'Perfil confirmado e com post nos ultimos 30 dias.'
  if (atividade === 'atividade_morna') return 'Perfil confirmado, ultimo post ha 1 a 3 meses.'
  return 'Perfil social confirmado — atividade recente ainda nao verificada.'
}

function calcularSinaisAutomaticos(lead = {}) {
  const url = classificarLead(lead)
  const avaliacoes = numero(lead.avaliacoes)
  const rating = numero(lead.rating)
  const perfilSocial = temPerfilSocialConfirmado(lead)
  const operacaoValidada = (avaliacoes != null && avaliacoes >= 5) || (rating != null && rating >= 4)
  // A lacuna digital continua lendo a presenca AMPLA, de proposito: a pergunta ali e' se ha'
  // algum sinal de vida digital contrastando com a falta de site, e para isso um rastro fraco
  // basta. Trocar as duas pela mesma funcao mudaria um segundo criterio sem ninguem ter pedido.
  const lacunaDigital = url.situacao_site === 'sem_site'
    || (url.situacao_site === 'nao_identificado' && (temPresencaSocial(lead) || !!texto(url.link_original)))

  return {
    operacao_validada: sinal(
      operacaoValidada,
      'cadastro',
      operacaoValidada
        ? 'Operacao com sinais publicos de atividade/reputacao.'
        : 'Sem evidencia automatica suficiente de operacao validada.'
    ),
    instagram_ativo: sinal(perfilSocial, 'cadastro', motivoInstagram(lead, perfilSocial)),
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
