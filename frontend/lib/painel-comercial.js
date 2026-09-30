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

function rotuloCanal(c) {
  return ROTULO_CANAL[c] || c || 'Sem origem'
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

module.exports = { ROTULO_CANAL, rotuloCanal, fmt, fmtTaxa, fraseRazao, maxSerie, larguraPct }
