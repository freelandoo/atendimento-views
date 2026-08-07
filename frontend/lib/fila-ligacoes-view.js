'use strict'
// Visao da FILA da Central de Ligacoes: modo de exibicao (simplificada/detalhada), filtros
// compactos e resumo dos filtros ativos. PURO e testavel (node:test), mesma convencao de
// ligacao-fone.js / ligacao-estado.js.
//
// Divisao de responsabilidade (deliberada): quem entra na fila e QUAL a prioridade de cada
// lead e' decidido no BACKEND (services/ligacao-prioridade.js) — telefone nao discavel nem
// chega aqui. Este modulo so ESCOLHE o que mostrar do que ja veio, sobre a lista carregada,
// sem nova requisicao. Nada aqui altera ordem: a fila chega ordenada por prioridade.

/** @typedef {'simplificada'|'detalhada'} ModoFila */

const VIEW_PADRAO = Object.freeze({
  modo: 'simplificada',
  site: 'todos',        // todos | sem_site | tem_site | nao_identificado
  prioridade: 'todas',  // todas | alta | media | baixa
  tentativas: 'todas',  // todas | nenhuma | uma | duas_mais
  avalMin: '', avalMax: '',
  notaMin: '', notaMax: '',
  local: '',            // cidade, bairro ou trecho do endereco
})

// Atalho recomendado para a campanha de criacao de site: sem site primeiro. A ordenacao por
// maior prioridade e o telefone valido ja sao o padrao da fila (garantidos no backend).
const VIEW_RECOMENDADA = Object.freeze({ ...VIEW_PADRAO, site: 'sem_site' })

const SITE_OPCOES = Object.freeze([
  ['todos', 'Todos'],
  ['sem_site', 'Sem site'],
  ['tem_site', 'Com site'],
  ['nao_identificado', 'Nao identificado'],
])
const PRIORIDADE_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['alta', 'Alta'], ['media', 'Media'], ['baixa', 'Baixa'],
])
const TENTATIVAS_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['nenhuma', 'Nenhuma'], ['uma', 'Uma'], ['duas_mais', 'Duas ou mais'],
])

const rotulo = (opcoes, valor) => (opcoes.find((o) => o[0] === valor) || [])[1] || valor

function numOuNull(s) {
  if (s === '' || s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Normaliza uma view vinda do localStorage (versao antiga / campo faltando / lixo). */
function normalizarView(bruto) {
  const v = bruto && typeof bruto === 'object' ? bruto : {}
  const escolha = (campo, opcoes) => (opcoes.some((o) => o[0] === v[campo]) ? v[campo] : VIEW_PADRAO[campo])
  return {
    modo: v.modo === 'detalhada' ? 'detalhada' : 'simplificada',
    site: escolha('site', SITE_OPCOES),
    prioridade: escolha('prioridade', PRIORIDADE_OPCOES),
    tentativas: escolha('tentativas', TENTATIVAS_OPCOES),
    avalMin: typeof v.avalMin === 'string' ? v.avalMin : '',
    avalMax: typeof v.avalMax === 'string' ? v.avalMax : '',
    notaMin: typeof v.notaMin === 'string' ? v.notaMin : '',
    notaMax: typeof v.notaMax === 'string' ? v.notaMax : '',
    local: typeof v.local === 'string' ? v.local : '',
  }
}

/** Limpar filtros NAO troca o modo de exibicao — sao coisas diferentes para o operador. */
function limparFiltros(view) {
  return { ...VIEW_PADRAO, modo: normalizarView(view).modo }
}

function faixaTentativas(n) {
  const t = Math.max(0, Number.parseInt(n, 10) || 0)
  if (t === 0) return 'nenhuma'
  if (t === 1) return 'uma'
  return 'duas_mais'
}

/** Um lead da fila passa nos filtros? Ausencia de dado nunca vira zero. */
function passaNosFiltros(lead, view) {
  const v = normalizarView(view)
  const l = lead || {}
  if (v.site !== 'todos' && (l.prioridade?.situacao_site || 'nao_identificado') !== v.site) return false
  if (v.prioridade !== 'todas' && (l.prioridade?.faixa || 'baixa') !== v.prioridade) return false
  if (v.tentativas !== 'todas' && faixaTentativas(l.tentativas) !== v.tentativas) return false

  const aval = l.avaliacoes == null ? null : Number(l.avaliacoes)
  const aMin = numOuNull(v.avalMin); const aMax = numOuNull(v.avalMax)
  if (aMin != null && (aval == null || aval < aMin)) return false
  if (aMax != null && (aval == null || aval > aMax)) return false

  const nota = l.rating == null ? null : Number(l.rating)
  const nMin = numOuNull(v.notaMin); const nMax = numOuNull(v.notaMax)
  if (nMin != null && (nota == null || nota < nMin)) return false
  if (nMax != null && (nota == null || nota > nMax)) return false

  if (v.local.trim()) {
    const q = v.local.trim().toLowerCase()
    if (!`${l.cidade || ''} ${l.endereco || ''}`.toLowerCase().includes(q)) return false
  }
  return true
}

/** Aplica os filtros preservando a ordem de prioridade que veio do servidor. */
function filtrarFila(lista, view) {
  return (Array.isArray(lista) ? lista : []).filter((l) => passaNosFiltros(l, view))
}

/** Chips compactos dos filtros ativos (so o que difere do padrao). */
function chipsAtivos(view) {
  const v = normalizarView(view)
  const chips = []
  if (v.site !== 'todos') chips.push({ campo: 'site', label: rotulo(SITE_OPCOES, v.site) })
  if (v.prioridade !== 'todas') chips.push({ campo: 'prioridade', label: `Prioridade ${rotulo(PRIORIDADE_OPCOES, v.prioridade).toLowerCase()}` })
  if (v.tentativas !== 'todas') chips.push({ campo: 'tentativas', label: `${rotulo(TENTATIVAS_OPCOES, v.tentativas)} tentativa(s)` })
  const aMin = numOuNull(v.avalMin); const aMax = numOuNull(v.avalMax)
  if (aMin != null && aMax != null) chips.push({ campo: 'aval', label: `${aMin}–${aMax} avaliacoes` })
  else if (aMin != null) chips.push({ campo: 'aval', label: `${aMin}+ avaliacoes` })
  else if (aMax != null) chips.push({ campo: 'aval', label: `ate ${aMax} avaliacoes` })
  const nMin = numOuNull(v.notaMin); const nMax = numOuNull(v.notaMax)
  if (nMin != null && nMax != null) chips.push({ campo: 'nota', label: `nota ${nMin}–${nMax}` })
  else if (nMin != null) chips.push({ campo: 'nota', label: `nota ${nMin}+` })
  else if (nMax != null) chips.push({ campo: 'nota', label: `nota ate ${nMax}` })
  if (v.local.trim()) chips.push({ campo: 'local', label: v.local.trim() })
  return chips
}

const contarFiltrosAtivos = (view) => chipsAtivos(view).length

/** Zera so um grupo de filtros (usado no "x" do chip). */
function limparCampo(view, campo) {
  const v = normalizarView(view)
  if (campo === 'aval') return { ...v, avalMin: '', avalMax: '' }
  if (campo === 'nota') return { ...v, notaMin: '', notaMax: '' }
  if (campo === 'local') return { ...v, local: '' }
  if (campo === 'site' || campo === 'prioridade' || campo === 'tentativas') return { ...v, [campo]: VIEW_PADRAO[campo] }
  return v
}

module.exports = {
  VIEW_PADRAO, VIEW_RECOMENDADA, SITE_OPCOES, PRIORIDADE_OPCOES, TENTATIVAS_OPCOES,
  normalizarView, limparFiltros, limparCampo, faixaTentativas,
  passaNosFiltros, filtrarFila, chipsAtivos, contarFiltrosAtivos,
}
