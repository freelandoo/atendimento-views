'use strict'
// Tradução PURA do veredito do painel comercial (nada de regra: o backend já agregou).
// Ver docs/propostas/2026-09-29-dashboard-inteligente-visao-geral.md.

// Rótulos de canal = origem do lead. Espelha o vocabulário de lead-origem; mantido local e
// pequeno de propósito (não vale acoplar a tela ao módulo por 6 linhas).
const ROTULO_CANAL = {
  google_places: 'Google Maps',
  instagram: 'Instagram',
  meta_ads: 'Anúncios Meta',
  linkedin: 'LinkedIn',
  manual: 'Manual',
  automatico: 'Automático',
  inbound: 'Entrada',
  desconhecido: 'Sem origem',
}

const DIA_MS = 24 * 60 * 60 * 1000

function rotuloCanal(c) {
  return ROTULO_CANAL[c] || c || 'Sem origem'
}

/** Há quanto tempo a equipe existe, em texto ("há 3 meses"). Data inválida/futura → ''. */
function idadeEquipe(criadoEm, agora = new Date()) {
  if (!criadoEm) return ''
  const criado = new Date(criadoEm)
  if (isNaN(criado.getTime())) return ''
  const dias = Math.floor((agora.getTime() - criado.getTime()) / DIA_MS)
  if (dias < 0) return ''
  if (dias < 1) return 'criada hoje'
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
  if (dias < 365) { const m = Math.floor(dias / 30); return `há ${m} ${m === 1 ? 'mês' : 'meses'}` }
  const a = Math.floor(dias / 365)
  return `há ${a} ${a === 1 ? 'ano' : 'anos'}`
}

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR')
}

/** Taxa "por 100" formatada; null (sem denominador) → "—", nunca "0". */
function fmtTaxa(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

/** Frase da razão de topo SEMPRE com denominador. Sem contatos → texto próprio, nunca 0%. */
function fraseRazao(razoes) {
  if (!razoes || !razoes.contatos || razoes.por_100_contatos == null) return 'Sem contatos no período'
  return `${fmt(razoes.reunioes)} reuniões / ${fmt(razoes.contatos)} contatos`
}

/** Maior valor entre as chaves dadas na série — para escalar as barras. */
function maxSerie(serie, chaves) {
  let m = 0
  for (const l of serie || []) for (const k of chaves) m = Math.max(m, Number(l[k]) || 0)
  return m
}

/** Largura da barra em %; divisão por zero → 0 (nunca NaN). */
function larguraPct(valor, max) {
  if (!max || max <= 0) return 0
  return Math.round((Number(valor || 0) / max) * 100)
}

module.exports = { ROTULO_CANAL, rotuloCanal, idadeEquipe, fmt, fmtTaxa, fraseRazao, maxSerie, larguraPct }
