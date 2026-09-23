'use strict'
// Convite de cadastro por link — apresentação PURA (sem React, rede ou DOM).
//
// SÓ TRADUZ. Quem decide se o convite está pendente, se a senha serve, se a pessoa tem idade e
// se o papel exige equipe é o backend (`services/cadastro-membro.js` e
// `services/acesso-capacidades.js`), que manda o veredito pronto: `situacao` em cada convite e
// `exige_equipe`/`convidavel` por papel em `/membros/opcoes`. Mesmo contrato de
// `lib/site-rotulos.js` — uma segunda régua aqui divergiria da primeira em silêncio.

/** Rótulo e tom de cada situação. Cor é reforço: o rótulo em texto vai sempre junto. */
const SITUACAO = Object.freeze({
  pendente: { rotulo: 'Aguardando cadastro', tom: 'info' },
  usado: { rotulo: 'Usado', tom: 'ok' },
  revogado: { rotulo: 'Cancelado', tom: 'neutro' },
  expirado: { rotulo: 'Vencido', tom: 'neutro' },
})

/** Situação desconhecida aparece como ela mesma — nunca some, nunca vira outra. */
function rotuloSituacao(situacao) {
  return SITUACAO[situacao] || { rotulo: String(situacao || '—'), tom: 'neutro' }
}

/** O link que a pessoa abre. O token só existe na resposta de quem acabou de gerar. */
function linkDoConvite(origem, token) {
  const base = String(origem || '').replace(/\/+$/, '')
  return `${base}/convite/${encodeURIComponent(String(token || ''))}`
}

/** "vence em 5 h", "vence em 40 min", "venceu". Só texto sobre a data que a API mandou. */
function tempoRestante(expiraEm, agora = new Date()) {
  const fim = expiraEm ? new Date(expiraEm).getTime() : NaN
  if (Number.isNaN(fim)) return ''
  const min = Math.floor((fim - agora.getTime()) / 60000)
  if (min <= 0) return 'venceu'
  if (min < 60) return `vence em ${min} min`
  return `vence em ${Math.floor(min / 60)} h`
}

/** Os papéis que a API disse que podem ser convidados, na ordem que ela mandou. */
function papeisDoConvite(opcoes) {
  return ((opcoes && opcoes.papeis) || []).filter((p) => p && p.convidavel).map((p) => p.papel)
}

/** O papel exige equipe? Resposta da API (`exige_equipe`), nunca deduzida pelo nome. */
function papelExigeEquipe(opcoes, papel) {
  const p = ((opcoes && opcoes.papeis) || []).find((x) => x && x.papel === papel)
  return !!(p && p.exige_equipe)
}

/** Só equipe ATIVA recebe gente — a encerrada seria recusada pelo servidor (409). */
function equipesQueRecebem(equipes) {
  return (Array.isArray(equipes) ? equipes : []).filter((e) => e && e.status === 'ativa')
}

/** Quantos convites ainda podem ser usados — para o título da seção. */
function contarPendentes(convites) {
  return (Array.isArray(convites) ? convites : []).filter((c) => c && c.situacao === 'pendente').length
}

module.exports = {
  SITUACAO,
  rotuloSituacao,
  linkDoConvite,
  tempoRestante,
  papeisDoConvite,
  papelExigeEquipe,
  equipesQueRecebem,
  contarPendentes,
}
