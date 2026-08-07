'use strict'
// Filtros da FILA da Central de Ligacoes: painel OPERACIONAL GERAL (nao um filtro de site).
// PURO e testavel (node:test), mesma convencao de ligacao-fone.js / ligacao-estado.js.
//
// Divisao de responsabilidade (deliberada): quem entra na fila e QUAL a prioridade de cada
// lead e' decidido no BACKEND (services/ligacao-prioridade.js) — telefone nao discavel nem
// chega aqui, e a ordem ja vem por maior prioridade. Este modulo so RECORTA o que ja veio,
// sobre a lista carregada, sem nova requisicao. Nada aqui reordena a fila.
//
// NAO existe mais "modo de exibicao" aqui: a listagem e' sempre enxuta. A alternancia
// Visao simples/detalhada vive na TELA DE ATENDIMENTO (apos clicar em Ligar), nao na fila.

// Estado NEUTRO: nenhum filtro aplicado (mostra a fila inteira). E' a referencia dos chips —
// um chip aparece para tudo que difere daqui, INCLUSIVE o filtro que vem ligado por padrao.
const VIEW_NEUTRA = Object.freeze({
  // Operacao
  status: 'todos',
  tentativas: 'todas',      // todas | nao_iniciados | com_tentativa
  proximaAcao: 'todas',     // todas | com | sem
  // Contato (telefone discavel e' requisito de ENTRADA, garantido no backend — nao e' filtro)
  email: 'todos',           // todos | com | sem
  // Potencial comercial
  prioridade: 'todas',      // todas | alta | media | baixa
  avalMin: '', avalMax: '',
  notaMin: '', notaMax: '',
  // Perfil do negocio
  local: '',                // cidade, bairro ou trecho do endereco
  nicho: '',                // segmento exato (o select e' montado a partir da propria fila)
  // Presenca digital
  site: 'todos',            // todos | sem_site | tem_site | nao_identificado
  redes: 'todas',           // todas | com | sem
  // Qualidade do dado
  origem: 'todas',          // todas | <valor de prospects.origem>
  recencia: 'todas',        // todas | 7d | 30d | 90mais
})

// Fila PADRAO da operacao: telefone valido (backend) + NENHUMA tentativa + maior prioridade
// primeiro. O time comeca pelos leads ineditos; retentativa e' uma fila propria, alcancada
// trocando este filtro para "Com tentativa".
const VIEW_PADRAO = Object.freeze({ ...VIEW_NEUTRA, tentativas: 'nao_iniciados' })

// Status NAO tem lista fixa aqui: a tela monta as opcoes a partir dos status realmente
// presentes na fila (opcoesDaFila) e reusa o rotulo canonico de STATUS_OP da propria pagina.
const TENTATIVAS_OPCOES = Object.freeze([
  ['nao_iniciados', 'Não iniciados'], ['com_tentativa', 'Com tentativa'], ['todas', 'Todos'],
])
const PROXIMA_ACAO_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['com', 'Com próxima ação'], ['sem', 'Sem próxima ação'],
])
const EMAIL_OPCOES = Object.freeze([
  ['todos', 'Todos'], ['com', 'Com e-mail'], ['sem', 'Sem e-mail'],
])
const PRIORIDADE_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa'],
])
const SITE_OPCOES = Object.freeze([
  ['todos', 'Todos'], ['sem_site', 'Sem site'], ['tem_site', 'Com site'], ['nao_identificado', 'Site não identificado'],
])
const REDES_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['com', 'Com redes sociais'], ['sem', 'Sem redes sociais'],
])
const RECENCIA_OPCOES = Object.freeze([
  ['todas', 'Todas'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['90mais', 'Mais de 90 dias'],
])

const DIA_MS = 24 * 60 * 60 * 1000

const rotulo = (opcoes, valor) => (opcoes.find((o) => o[0] === valor) || [])[1] || valor

function numOuNull(s) {
  if (s === '' || s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const txt = (v) => (v == null ? '' : String(v).trim())

/**
 * Normaliza uma view vinda do localStorage (versao antiga / campo faltando / lixo).
 * Campo invalido volta ao PADRAO (nao ao neutro): view corrompida nao pode virar
 * silenciosamente "fila inteira".
 */
function normalizarView(bruto) {
  const v = bruto && typeof bruto === 'object' ? bruto : {}
  const escolha = (campo, opcoes) => (opcoes.some((o) => o[0] === v[campo]) ? v[campo] : VIEW_PADRAO[campo])
  const texto = (campo) => (typeof v[campo] === 'string' ? v[campo] : VIEW_PADRAO[campo])
  return {
    status: typeof v.status === 'string' && v.status ? v.status : 'todos',
    tentativas: escolha('tentativas', TENTATIVAS_OPCOES),
    proximaAcao: escolha('proximaAcao', PROXIMA_ACAO_OPCOES),
    email: escolha('email', EMAIL_OPCOES),
    prioridade: escolha('prioridade', PRIORIDADE_OPCOES),
    avalMin: texto('avalMin'), avalMax: texto('avalMax'),
    notaMin: texto('notaMin'), notaMax: texto('notaMax'),
    local: texto('local'),
    nicho: texto('nicho'),
    site: escolha('site', SITE_OPCOES),
    redes: escolha('redes', REDES_OPCOES),
    origem: typeof v.origem === 'string' && v.origem ? v.origem : 'todas',
    recencia: escolha('recencia', RECENCIA_OPCOES),
  }
}

/** "Limpar filtros" mostra a fila INTEIRA (inclusive quem ja tem tentativa). */
const limparFiltros = () => ({ ...VIEW_NEUTRA })
/** Volta a fila operacional recomendada (nao iniciados). */
const filaPadrao = () => ({ ...VIEW_PADRAO })

function faixaTentativas(n) {
  return (Math.max(0, Number.parseInt(n, 10) || 0) === 0) ? 'nao_iniciados' : 'com_tentativa'
}

const temRedes = (l) => !!(txt(l.instagram_handle) || txt(l.link_bio))
const situacaoDoLead = (l) => l.prioridade?.situacao_site || l.situacao_site || 'nao_identificado'

/** Idade do cadastro em dias; null quando a data nao veio (ausente != recente). */
function idadeEmDias(lead, agora) {
  const d = lead.created_at ? new Date(lead.created_at).getTime() : NaN
  return Number.isFinite(d) ? (agora - d) / DIA_MS : null
}

/** Um lead da fila passa nos filtros? Ausencia de dado nunca vira zero. */
function passaNosFiltros(lead, view, agora = Date.now()) {
  const v = normalizarView(view)
  const l = lead || {}

  // --- Operacao ---
  if (v.status !== 'todos' && l.status !== v.status) return false
  if (v.tentativas !== 'todas' && faixaTentativas(l.tentativas) !== v.tentativas) return false
  if (v.proximaAcao !== 'todas' && (!!txt(l.proxima_acao) !== (v.proximaAcao === 'com'))) return false

  // --- Contato ---
  if (v.email !== 'todos' && (!!txt(l.email) !== (v.email === 'com'))) return false

  // --- Potencial comercial ---
  if (v.prioridade !== 'todas' && (l.prioridade?.faixa || 'baixa') !== v.prioridade) return false
  const aval = l.avaliacoes == null ? null : Number(l.avaliacoes)
  const aMin = numOuNull(v.avalMin); const aMax = numOuNull(v.avalMax)
  if (aMin != null && (aval == null || aval < aMin)) return false
  if (aMax != null && (aval == null || aval > aMax)) return false
  const nota = l.rating == null ? null : Number(l.rating)
  const nMin = numOuNull(v.notaMin); const nMax = numOuNull(v.notaMax)
  if (nMin != null && (nota == null || nota < nMin)) return false
  if (nMax != null && (nota == null || nota > nMax)) return false

  // --- Perfil do negocio ---
  if (v.local.trim()) {
    const q = v.local.trim().toLowerCase()
    if (!`${l.cidade || ''} ${l.endereco || ''}`.toLowerCase().includes(q)) return false
  }
  if (v.nicho && txt(l.nicho) !== v.nicho) return false

  // --- Presenca digital ---
  if (v.site !== 'todos' && situacaoDoLead(l) !== v.site) return false
  if (v.redes !== 'todas' && (temRedes(l) !== (v.redes === 'com'))) return false

  // --- Qualidade do dado ---
  if (v.origem !== 'todas' && txt(l.origem) !== v.origem) return false
  if (v.recencia !== 'todas') {
    const dias = idadeEmDias(l, agora)
    if (dias == null) return false
    if (v.recencia === '7d' && dias > 7) return false
    if (v.recencia === '30d' && dias > 30) return false
    if (v.recencia === '90mais' && dias <= 90) return false
  }
  return true
}

/** Aplica os filtros preservando a ordem de prioridade que veio do servidor. */
function filtrarFila(lista, view, agora = Date.now()) {
  return (Array.isArray(lista) ? lista : []).filter((l) => passaNosFiltros(l, view, agora))
}

/**
 * Opcoes que dependem do CONTEUDO da fila (segmento, origem) + se ha dado de qualidade para
 * mostrar o grupo. Evita oferecer filtro que nao casaria com nenhum lead.
 */
function opcoesDaFila(lista) {
  const arr = Array.isArray(lista) ? lista : []
  const unicos = (campo) => Array.from(new Set(arr.map((l) => txt(l[campo])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const status = Array.from(new Set(arr.map((l) => txt(l.status)).filter(Boolean)))
  const origens = unicos('origem')
  const temRecencia = arr.some((l) => !!l.created_at)
  return {
    status,
    nichos: unicos('nicho'),
    origens,
    mostrarQualidadeDado: origens.length > 0 || temRecencia,
    temRecencia,
  }
}

/** Chips compactos dos filtros ativos (tudo que difere do estado NEUTRO). */
function chipsAtivos(view) {
  const v = normalizarView(view)
  const chips = []
  if (v.status !== 'todos') chips.push({ campo: 'status', label: `Status: ${v.status.replace(/_/g, ' ')}` })
  if (v.tentativas !== 'todas') chips.push({ campo: 'tentativas', label: rotulo(TENTATIVAS_OPCOES, v.tentativas) })
  if (v.proximaAcao !== 'todas') chips.push({ campo: 'proximaAcao', label: rotulo(PROXIMA_ACAO_OPCOES, v.proximaAcao) })
  if (v.email !== 'todos') chips.push({ campo: 'email', label: rotulo(EMAIL_OPCOES, v.email) })
  if (v.prioridade !== 'todas') chips.push({ campo: 'prioridade', label: `Prioridade ${rotulo(PRIORIDADE_OPCOES, v.prioridade).toLowerCase()}` })
  const aMin = numOuNull(v.avalMin); const aMax = numOuNull(v.avalMax)
  if (aMin != null && aMax != null) chips.push({ campo: 'aval', label: `${aMin}–${aMax} avaliações` })
  else if (aMin != null) chips.push({ campo: 'aval', label: `${aMin}+ avaliações` })
  else if (aMax != null) chips.push({ campo: 'aval', label: `até ${aMax} avaliações` })
  const nMin = numOuNull(v.notaMin); const nMax = numOuNull(v.notaMax)
  if (nMin != null && nMax != null) chips.push({ campo: 'nota', label: `nota ${nMin}–${nMax}` })
  else if (nMin != null) chips.push({ campo: 'nota', label: `nota ${nMin}+` })
  else if (nMax != null) chips.push({ campo: 'nota', label: `nota até ${nMax}` })
  if (v.local.trim()) chips.push({ campo: 'local', label: v.local.trim() })
  if (v.nicho) chips.push({ campo: 'nicho', label: v.nicho })
  if (v.site !== 'todos') chips.push({ campo: 'site', label: rotulo(SITE_OPCOES, v.site) })
  if (v.redes !== 'todas') chips.push({ campo: 'redes', label: rotulo(REDES_OPCOES, v.redes) })
  if (v.origem !== 'todas') chips.push({ campo: 'origem', label: `Origem: ${v.origem}` })
  if (v.recencia !== 'todas') chips.push({ campo: 'recencia', label: rotulo(RECENCIA_OPCOES, v.recencia) })
  return chips
}

const contarFiltrosAtivos = (view) => chipsAtivos(view).length

/**
 * Duas views produzem exatamente o mesmo recorte? Usado pelo painel flutuante para saber se
 * o RASCUNHO ainda nao foi aplicado (o painel so muda a fila no "Aplicar") e para esconder o
 * "restaurar padrao" quando a fila ja esta no padrao.
 */
function viewsIguais(a, b) {
  const x = normalizarView(a)
  const y = normalizarView(b)
  return Object.keys(VIEW_NEUTRA).every((campo) => x[campo] === y[campo])
}

/** Zera so um grupo de filtros (usado no "x" do chip) — sempre para o estado NEUTRO. */
function limparCampo(view, campo) {
  const v = normalizarView(view)
  if (campo === 'aval') return { ...v, avalMin: '', avalMax: '' }
  if (campo === 'nota') return { ...v, notaMin: '', notaMax: '' }
  if (Object.prototype.hasOwnProperty.call(VIEW_NEUTRA, campo)) return { ...v, [campo]: VIEW_NEUTRA[campo] }
  return v
}

module.exports = {
  VIEW_NEUTRA, VIEW_PADRAO,
  TENTATIVAS_OPCOES, PROXIMA_ACAO_OPCOES, EMAIL_OPCOES,
  PRIORIDADE_OPCOES, SITE_OPCOES, REDES_OPCOES, RECENCIA_OPCOES,
  normalizarView, limparFiltros, filaPadrao, limparCampo, faixaTentativas,
  passaNosFiltros, filtrarFila, opcoesDaFila, chipsAtivos, contarFiltrosAtivos, viewsIguais,
}
