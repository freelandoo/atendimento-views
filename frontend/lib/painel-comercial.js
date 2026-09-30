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

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10)
}

const PRESET_DIAS = { '1d': 1, '7d': 7, '14d': 14, '30d': 30 }

/** Janela de um preset ('1d'|'7d'|'14d'|'30d') como datas YMD inclusivas terminando hoje. */
function janelaPreset(preset, hoje = new Date()) {
  const dias = PRESET_DIAS[preset] || 7
  return { de: ymd(new Date(hoje.getTime() - (dias - 1) * DIA_MS)), ate: ymd(hoje) }
}

/** Hora (0-23) com maior taxa de resposta, entre as com amostra mínima. null se nenhuma qualifica. */
function melhorHora(rows, minEnviados = 5) {
  let melhor = null
  for (const r of rows || []) {
    const env = Number(r.enviados) || 0
    if (env < minEnviados) continue
    const taxa = (Number(r.responderam) || 0) / env
    if (!melhor || taxa > melhor.taxa) melhor = { hora: Number(r.hora), taxa }
  }
  return melhor
}

/** Janela IMEDIATAMENTE anterior, mesmo tamanho, para comparação. */
function janelaAnterior(de, ate) {
  const d0 = new Date(`${de}T00:00:00.000Z`)
  const d1 = new Date(`${ate}T00:00:00.000Z`)
  const len = Math.round((d1.getTime() - d0.getTime()) / DIA_MS) + 1 // dias inclusivos
  return { de: ymd(new Date(d0.getTime() - len * DIA_MS)), ate: ymd(new Date(d0.getTime() - DIA_MS)) }
}

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

/**
 * Δ entre período atual e anterior, em quantidade E percentual. `pct` é null quando o anterior é
 * 0 (não dá para dividir); nesse caso `novo=true` sinaliza "sem base para comparar".
 */
function formatarDelta(atual, anterior) {
  const a = Number(atual) || 0
  const b = Number(anterior) || 0
  const abs = a - b
  return {
    abs,
    pct: b > 0 ? Math.round((abs / b) * 100) : null,
    seta: abs > 0 ? '▲' : abs < 0 ? '▼' : '=',
    novo: b === 0 && a > 0,
  }
}

// Direção do lead pela ORIGEM (migration 108): inbound = veio até nós; outbound = fomos atrás.
// Espelha GRUPOS.inbound/outbound de lead-origem; origem sem prospect casado (desconhecido) fica
// "indefinido" — nem inbound nem outbound, e a tela só o mostra se houver.
const DIRECAO_INBOUND = new Set(['whatsapp', 'meta_form'])
const DIRECAO_OUTBOUND = new Set(['manual', 'automatico', 'instagram', 'linkedin', 'meta_ads'])
function direcaoDaOrigem(origem) {
  const v = String(origem || '').trim().toLowerCase()
  if (DIRECAO_INBOUND.has(v)) return 'inbound'
  if (DIRECAO_OUTBOUND.has(v)) return 'outbound'
  return 'indefinido'
}

/** Rola o `por_canal` (por origem) em inbound × outbound, com taxa de resposta e conv./100. */
function agruparPorDirecao(porCanal) {
  const base = () => ({ mensagens: 0, ligacoes: 0, ligacoes_atendidas: 0, conversou: 0, reunioes: 0 })
  const acc = { inbound: base(), outbound: base(), indefinido: base() }
  for (const c of porCanal || []) {
    const d = acc[direcaoDaOrigem(c.canal)]
    d.mensagens += Number(c.mensagens) || 0
    d.ligacoes += Number(c.ligacoes) || 0
    d.ligacoes_atendidas += Number(c.ligacoes_atendidas) || 0
    d.conversou += Number(c.conversou) || 0
    d.reunioes += Number(c.reunioes) || 0
  }
  const finalizar = (x) => {
    const contatos = x.mensagens + x.ligacoes_atendidas
    return {
      ...x,
      contatos,
      por_100_contatos: contatos > 0 ? Number(((x.reunioes / contatos) * 100).toFixed(1)) : null,
      taxa_resposta: x.mensagens > 0 ? Number(((x.conversou / x.mensagens) * 100).toFixed(1)) : null,
    }
  }
  return { inbound: finalizar(acc.inbound), outbound: finalizar(acc.outbound), indefinido: finalizar(acc.indefinido) }
}

/** Largura da barra em %; divisão por zero → 0 (nunca NaN). */
function larguraPct(valor, max) {
  if (!max || max <= 0) return 0
  return Math.round((Number(valor || 0) / max) * 100)
}

// Funil "onde os leads param". Ordem/rótulos = os mesmos estágios da Visão Geral.
const ESTAGIO_ROTULO = {
  primeiro_contato: 'Primeiro contato',
  diagnostico: 'Diagnóstico',
  proposta: 'Proposta',
  objecao: 'Objeção',
  fechamento: 'Fechamento',
}
const ESTAGIO_ORDEM = ['primeiro_contato', 'diagnostico', 'proposta', 'objecao', 'fechamento']

/** Ordena o funil pelos estágios canônicos (com 0 quando vazio) + estágios desconhecidos ao fim. */
function ordenarFunil(rows) {
  const mapa = new Map((rows || []).map((r) => [r.estagio, Number(r.n) || 0]))
  const conhecidos = ESTAGIO_ORDEM.map((e) => ({ estagio: e, rotulo: ESTAGIO_ROTULO[e], n: mapa.get(e) || 0 }))
  const extras = [...mapa.keys()]
    .filter((e) => !ESTAGIO_ORDEM.includes(e))
    .map((e) => ({ estagio: e, rotulo: e, n: mapa.get(e) || 0 }))
  const todos = [...conhecidos, ...extras]
  const max = todos.reduce((m, l) => Math.max(m, l.n), 0)
  return todos.map((l) => ({ ...l, pct: larguraPct(l.n, max) }))
}

/**
 * Funil com QUEDA entre etapas, honesto para um SNAPSHOT: `acumulado` = leads neste estágio OU
 * além (um lead em "proposta" já passou por contato e diagnóstico). Isso dá a forma decrescente de
 * funil e uma queda real ("de quem chegou ao diagnóstico, X% não avançou"). Assume a ordem canônica
 * dos 5 estágios; estágios fora dela não entram no pipeline (viram `outros`).
 * @returns {{ etapas: Array<{estagio,rotulo,n,acumulado,larguraPct,quedaPct}>, outros: number }}
 */
function funilComQueda(rows) {
  const mapa = new Map((rows || []).map((r) => [r.estagio, Number(r.n) || 0]))
  const counts = ESTAGIO_ORDEM.map((e) => mapa.get(e) || 0)
  const acumulado = counts.map((_, i) => counts.slice(i).reduce((s, x) => s + x, 0))
  const base = acumulado[0] || 0
  const etapas = ESTAGIO_ORDEM.map((e, i) => ({
    estagio: e,
    rotulo: ESTAGIO_ROTULO[e],
    n: counts[i], // parados EXATAMENTE aqui
    acumulado: acumulado[i], // chegaram até aqui (ou além)
    larguraPct: larguraPct(acumulado[i], base),
    quedaPct: i > 0 && acumulado[i - 1] > 0 ? Math.round((1 - acumulado[i] / acumulado[i - 1]) * 100) : null,
  }))
  let outros = 0
  for (const [k, v] of mapa) if (!ESTAGIO_ORDEM.includes(k)) outros += v
  return { etapas, outros }
}

module.exports = { ROTULO_CANAL, rotuloCanal, idadeEquipe, ESTAGIO_ROTULO, ordenarFunil, funilComQueda, direcaoDaOrigem, agruparPorDirecao, janelaPreset, janelaAnterior, melhorHora, formatarDelta, fmt, fmtTaxa, fraseRazao, maxSerie, larguraPct }
