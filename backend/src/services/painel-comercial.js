// @ts-check
'use strict'
// Painel comercial da Visão Geral — regras PURAS (sem banco, HTTP, IA ou rede).
// Ver docs/propostas/2026-09-29-dashboard-inteligente-visao-geral.md (Fase 1).
//
// O que ESTE módulo decide: a janela de tempo, como as quatro fontes de evento viram uma série
// por dia, e as razões de conversão COM denominador. O que ele NÃO faz: ler banco. As contagens
// chegam prontas de src/db/painel-comercial.js (que reusa a view vw_ligacoes_analiticas).
//
// "Contato" na Fase 1 = mensagem ENVIADA (lead_disparos) + ligação ATENDIDA (resultado='atendeu').
// "Conversou" (lead respondeu) fica Fase 2 — vendas.conversas não tem carimbo de 1ª resposta.

const PERIODOS = { '7d': 7, '30d': 30 }
const DIA_MS = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' de uma Date em UTC (as contagens já vêm truncadas por dia no SQL). */
function isoDia(d) {
  return new Date(d).toISOString().slice(0, 10)
}

/**
 * Resolve a janela. Default = últimos 7 dias. Aceita `periodo` ('7d'|'30d') OU `de`/`ate`
 * explícitos ('YYYY-MM-DD'). `ate` é limite superior EXCLUSIVO (fim do dia informado).
 * @returns {{ de: string, ate: string, rotulo: string }} ISO timestamps para o SQL.
 */
function resolverPeriodo({ periodo, de, ate, agora = new Date() } = {}) {
  const validaDia = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (validaDia(de) && validaDia(ate)) {
    const ini = new Date(`${de}T00:00:00.000Z`)
    const fim = new Date(new Date(`${ate}T00:00:00.000Z`).getTime() + DIA_MS) // exclusivo
    if (fim > ini) return { de: ini.toISOString(), ate: fim.toISOString(), rotulo: `${de} a ${ate}` }
  }
  const dias = PERIODOS[periodo] || 7
  const fim = agora
  const ini = new Date(fim.getTime() - dias * DIA_MS)
  return { de: ini.toISOString(), ate: fim.toISOString(), rotulo: `últimos ${dias} dias` }
}

/**
 * Une as quatro fontes numa série por dia. Cada entrada de entrada é `{ dia, n, atendidas? }`.
 * Dia sem dado em uma fonte entra com 0; dias totalmente vazios ficam ausentes (v1 não preenche
 * spine — evita bug de fuso e o gráfico lê a tendência mesmo assim).
 */
function montarSerie({ mensagens = [], ligacoes = [], reunioesHumano = [], reunioesBot = [], conversou = [], vendas = [] } = {}) {
  const mapa = new Map()
  const linha = (dia) => {
    if (!mapa.has(dia)) {
      mapa.set(dia, { dia, mensagens: 0, ligacoes: 0, ligacoes_atendidas: 0, conversou: 0, reunioes_humano: 0, reunioes_bot: 0, vendas: 0, faturamento: 0 })
    }
    return mapa.get(dia)
  }
  // += (não =) porque as linhas chegam por (dia, canal): há várias por dia.
  for (const r of mensagens) linha(isoDia(r.dia)).mensagens += Number(r.n) || 0
  for (const r of ligacoes) {
    const l = linha(isoDia(r.dia))
    l.ligacoes += Number(r.n) || 0
    l.ligacoes_atendidas += Number(r.atendidas) || 0
  }
  for (const r of conversou) linha(isoDia(r.dia)).conversou += Number(r.n) || 0
  for (const r of reunioesHumano) linha(isoDia(r.dia)).reunioes_humano += Number(r.n) || 0
  for (const r of reunioesBot) linha(isoDia(r.dia)).reunioes_bot += Number(r.n) || 0
  for (const r of vendas) {
    const l = linha(isoDia(r.dia))
    l.vendas += Number(r.n) || 0
    l.faturamento += Number(r.valor) || 0
  }
  return [...mapa.values()].sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
}

/** Soma a série em totais. reuniões = humano + bot. */
function totalizar(serie) {
  const t = { mensagens: 0, ligacoes: 0, ligacoes_atendidas: 0, conversou: 0, reunioes_humano: 0, reunioes_bot: 0, vendas: 0, faturamento: 0 }
  for (const l of serie) {
    t.mensagens += l.mensagens
    t.ligacoes += l.ligacoes
    t.ligacoes_atendidas += l.ligacoes_atendidas
    t.conversou += l.conversou || 0
    t.reunioes_humano += l.reunioes_humano
    t.reunioes_bot += l.reunioes_bot
    t.vendas += l.vendas || 0
    t.faturamento += l.faturamento || 0
  }
  t.reunioes = t.reunioes_humano + t.reunioes_bot
  return t
}

/**
 * Funil de conversão do período: contatos → responderam → reuniões → vendas. Cada nível traz a
 * largura proporcional ao topo e a queda vs. o nível anterior (onde o funil vaza). Denominador
 * sempre presente; topo zero → larguras 0 (nunca inventa proporção).
 */
function montarFunilConversao(totais = {}) {
  const contatos = (totais.mensagens || 0) + (totais.ligacoes_atendidas || 0)
  const niveis = [
    { chave: 'contatos', rotulo: 'Contatos', n: contatos },
    { chave: 'responderam', rotulo: 'Responderam', n: totais.conversou || 0 },
    { chave: 'reunioes', rotulo: 'Reuniões', n: totais.reunioes || 0 },
    { chave: 'vendas', rotulo: 'Vendas', n: totais.vendas || 0 },
  ]
  const base = niveis[0].n
  let anterior = null
  return niveis.map((nv) => {
    const larguraPct = base > 0 ? Number(((nv.n / base) * 100).toFixed(1)) : 0
    const quedaPct = anterior !== null && anterior > 0 ? Number((((anterior - nv.n) / anterior) * 100).toFixed(1)) : null
    anterior = nv.n
    return { ...nv, larguraPct, quedaPct }
  })
}

/**
 * Razão de conversão SEMPRE com denominador. contato = mensagem enviada + ligação atendida.
 * Divisão por zero → null (nunca 0, que afirmaria "converteu nada").
 */
function calcularRazoes(totais) {
  const contatos = (totais.mensagens || 0) + (totais.ligacoes_atendidas || 0)
  const reunioes = totais.reunioes || 0
  return {
    contatos,
    reunioes,
    por_100_contatos: contatos > 0 ? Number(((reunioes / contatos) * 100).toFixed(1)) : null,
    // finas, por canal de contato
    por_ligacao: totais.ligacoes_atendidas > 0 ? Number(((reunioes / totais.ligacoes_atendidas) * 100).toFixed(1)) : null,
    por_mensagem: totais.mensagens > 0 ? Number(((reunioes / totais.mensagens) * 100).toFixed(1)) : null,
    // taxa de resposta: dos leads a quem MANDAMOS mensagem, quantos responderam (só conta pra
    // frente — vendas.conversas.primeira_resposta_em é gravado no webhook a partir da migration 109).
    taxa_resposta: totais.mensagens > 0 ? Number((((totais.conversou || 0) / totais.mensagens) * 100).toFixed(1)) : null,
  }
}

/**
 * Une contagens por canal (origem do lead). Cada fonte é `{ canal, n }`. Reuniões por canal
 * vêm só das atribuíveis (agenda humana com prospect); bot não tem canal → fica de fora aqui.
 * @returns array [{ canal, mensagens, ligacoes, reunioes, por_100_contatos }]
 */
function montarPorCanal({ mensagens = [], ligacoes = [], reunioes = [], conversou = [], vendas = [] } = {}) {
  const mapa = new Map()
  const linha = (canal) => {
    const k = canal || 'desconhecido'
    if (!mapa.has(k)) mapa.set(k, { canal: k, mensagens: 0, ligacoes: 0, ligacoes_atendidas: 0, conversou: 0, reunioes: 0, vendas: 0, faturamento: 0 })
    return mapa.get(k)
  }
  // += porque as linhas chegam por (dia, canal): várias por canal ao longo dos dias.
  for (const r of mensagens) linha(r.canal).mensagens += Number(r.n) || 0
  for (const r of ligacoes) {
    const l = linha(r.canal)
    l.ligacoes += Number(r.n) || 0
    l.ligacoes_atendidas += Number(r.atendidas) || 0
  }
  for (const r of conversou) linha(r.canal).conversou += Number(r.n) || 0
  for (const r of reunioes) linha(r.canal).reunioes += Number(r.n) || 0
  for (const r of vendas) {
    const l = linha(r.canal)
    l.vendas += Number(r.n) || 0
    l.faturamento += Number(r.valor) || 0
  }
  return [...mapa.values()]
    .map((l) => {
      const contatos = l.mensagens + l.ligacoes_atendidas
      return {
        ...l,
        por_100_contatos: contatos > 0 ? Number(((l.reunioes / contatos) * 100).toFixed(1)) : null,
        taxa_resposta: l.mensagens > 0 ? Number(((l.conversou / l.mensagens) * 100).toFixed(1)) : null,
      }
    })
    .sort((a, b) => b.reunioes - a.reunioes || (b.mensagens + b.ligacoes) - (a.mensagens + a.ligacoes))
}

module.exports = { resolverPeriodo, montarSerie, totalizar, calcularRazoes, montarPorCanal, montarFunilConversao }
