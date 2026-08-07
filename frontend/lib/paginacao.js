'use strict'
// Paginacao de APRESENTACAO, PURA e reutilizavel (node:test).
//
// Recorte sobre uma lista JA filtrada e JA ordenada: nao reordena, nao filtra e nao pede nada
// ao servidor. Paginar DEPOIS de filtrar/ordenar e' o que garante "ordenar o conjunto completo
// antes de paginar" — a pagina e' so a janela visivel.
//
// Nasceu dentro de lib/fila-ligacoes-view.js (fila da Central de Ligacoes) e foi extraida aqui
// quando a listagem da Aquisicao passou a paginar tambem: o comportamento e' o mesmo, entao ele
// tem UM dono. `fila-ligacoes-view.js` reexporta estes nomes — nada mudou para quem ja usava.
//
// O tamanho de pagina de proposito NAO e' filtro: nao vira chip nem conta em filtros ativos.

const TAMANHOS_PAGINA = Object.freeze([25, 50, 100])
const POR_PAGINA_PADRAO = 25

/** Tamanho invalido/antigo do localStorage volta ao padrao. */
function normalizarPorPagina(valor) {
  const n = Number.parseInt(valor, 10)
  return TAMANHOS_PAGINA.includes(n) ? n : POR_PAGINA_PADRAO
}

/**
 * Recorta a pagina pedida. A pagina e' CLAMPADA no intervalo valido: encolher a lista (filtro
 * mais restrito, lead trabalhado) nunca deixa o operador numa pagina vazia — ele cai na ultima.
 * `offset` e' o indice GLOBAL do 1o item da pagina; `inicio`/`fim` sao 1-based, para o resumo.
 */
function paginar(lista, pagina, porPagina) {
  const arr = Array.isArray(lista) ? lista : []
  const tam = normalizarPorPagina(porPagina)
  const total = arr.length
  const totalPaginas = Math.max(1, Math.ceil(total / tam))
  const pedida = Math.trunc(Number(pagina))
  const p = Math.min(Math.max(Number.isFinite(pedida) ? pedida : 1, 1), totalPaginas)
  const offset = (p - 1) * tam
  return {
    itens: arr.slice(offset, offset + tam),
    pagina: p,
    totalPaginas,
    porPagina: tam,
    total,
    offset,
    inicio: total === 0 ? 0 : offset + 1,
    fim: Math.min(offset + tam, total),
    temAnterior: p > 1,
    temProxima: p < totalPaginas,
  }
}

/**
 * "Exibindo 21–40 de 128 leads" — o trecho visivel dentro do total ja filtrado.
 * O verbo e o substantivo sao parametros porque cada tela ja tem o seu vocabulario; a
 * ARITMETICA do intervalo e' que nao pode ser reescrita em cada rodape.
 */
function resumoIntervalo(pg, opcoes = {}) {
  const verbo = opcoes.verbo || 'Exibindo'
  const singular = opcoes.singular || 'lead'
  const plural = opcoes.plural || `${singular}s`
  if (!pg || !pg.total) return opcoes.vazio || `Nenhum ${singular}`
  return `${verbo} ${pg.inicio}–${pg.fim} de ${pg.total} ${pg.total > 1 ? plural : singular}`
}

/** "Mostrando 1–25 de 132 leads" — formato historico da fila da Central de Ligacoes. */
function resumoPaginacao(pg) {
  return resumoIntervalo(pg, { verbo: 'Mostrando' })
}

/**
 * O rodape aparece? Regra base: so quando ha mais itens que o limite da pagina. Excecao: se o
 * operador escolheu um tamanho diferente do padrao, o rodape continua visivel — senao escolher
 * 100 com 40 leads esconderia o proprio seletor e prenderia a escolha.
 */
function mostrarPaginacao(total, porPagina) {
  const tam = normalizarPorPagina(porPagina)
  return (Number(total) || 0) > tam || tam !== POR_PAGINA_PADRAO
}

module.exports = {
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO,
  normalizarPorPagina, paginar, resumoIntervalo, resumoPaginacao, mostrarPaginacao,
}
