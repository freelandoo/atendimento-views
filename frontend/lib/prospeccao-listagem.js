'use strict'
// Apresentacao da listagem de leads da Aquisicao (modo Busca). PURO e testavel (node:test):
// so traduz numeros que o BACKEND ja apurou em rotulo de tela. Nao filtra, nao ordena, nao
// decide status de lead e nao faz requisicao — a fonte da verdade continua sendo a API.
//
// Por que os contadores nao sao contados aqui: a tabela recebe uma PAGINA do banco (limite da
// requisicao) e, quando ha filtro de status, recebe SO aquele status. Contar a lista carregada
// daria numero errado. As contagens vem de GET /prospeccao/metricas, que aplica os mesmos
// filtros de busca/nicho/cidade da listagem — e de proposito NAO aplica o filtro de status,
// senao cada chip mostraria o total do status selecionado.
//
// A PAGINACAO e' do servidor: `paginaServidor` so descreve o recorte que ja veio pronto. O
// resumo em texto ("Exibindo 26–50 de 2223 leads") continua sendo `resumoIntervalo`, de
// lib/paginacao.js, compartilhado com a Fila da Central de Ligacoes.

// Filtros de status da listagem. `chave` e' o campo correspondente em /prospeccao/metricas.
const FILTROS_STATUS = Object.freeze([
  { valor: '', label: 'Todos', chave: 'total' },
  { valor: 'aguardando', label: 'Aguardando', chave: 'aguardando' },
  { valor: 'aprovado', label: 'Marcados', chave: 'aprovados' },
  { valor: 'rejeitado', label: 'Descartados', chave: 'rejeitados' },
  { valor: 'enviado', label: 'Enviados', chave: 'enviados' },
  { valor: 'respondeu', label: 'Responderam', chave: 'responderam' },
])

/** COUNT(*) do PostgreSQL chega como string; ausente e' ausente, nunca zero. */
function inteiroOuNulo(valor) {
  if (valor == null || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Contagem de cada filtro de status. `null` (metricas ainda nao chegaram ou campo faltando)
 * significa "desconhecido" e a tela nao mostra numero — mostrar 0 seria mentir.
 */
function contagensDosFiltros(metricas) {
  const m = metricas && typeof metricas === 'object' ? metricas : null
  const saida = {}
  for (const f of FILTROS_STATUS) saida[f.valor] = m ? inteiroOuNulo(m[f.chave]) : null
  return saida
}

/**
 * Taxa de resposta = responderam / leads que RECEBERAM mensagem.
 * Quem respondeu ja nao esta mais em `enviado` (o status avanca), entao o denominador e'
 * enviados + responderam. Sem ninguem no denominador nao existe taxa: devolve `null` e a tela
 * escreve "—". Nunca ha divisao por zero.
 */
function taxaResposta(metricas) {
  const enviados = inteiroOuNulo(metricas?.enviados) || 0
  const responderam = inteiroOuNulo(metricas?.responderam) || 0
  const base = enviados + responderam
  if (base <= 0) return { percentual: null, texto: '—', responderam: 0, base: 0 }
  const percentual = Math.round((responderam / base) * 100)
  return { percentual, texto: `${percentual}%`, responderam, base }
}

/**
 * Descreve a pagina que o SERVIDOR devolveu, no mesmo formato de `paginar` — a diferenca e' que
 * aqui os itens ja vem recortados e o total vem da contagem do filtro (`/metricas`), nao do
 * tamanho do array. E' o que permite andar pelos 2223 leads sem nunca carregar 2223 leads.
 *
 * `total` desconhecido (metricas ainda em voo) NAO vira zero: assume-se o que ja se sabe (o que
 * veio ate aqui) e "tem proxima" passa a ser inferido de a pagina ter vindo cheia. Sem isso, a
 * navegacao ficaria travada no primeiro instante da tela.
 */
function paginaServidor({ itens, pagina, porPagina, total } = {}) {
  const arr = Array.isArray(itens) ? itens : []
  const tam = Math.max(Math.trunc(Number(porPagina)) || 1, 1)
  const pedida = Math.trunc(Number(pagina))
  const p = Math.max(Number.isFinite(pedida) ? pedida : 1, 1)
  const offset = (p - 1) * tam
  const totalConhecido = inteiroOuNulo(total)
  const totalEfetivo = totalConhecido != null ? totalConhecido : offset + arr.length
  const totalPaginas = Math.max(1, Math.ceil(totalEfetivo / tam))
  return {
    itens: arr,
    pagina: p,
    totalPaginas,
    porPagina: tam,
    total: totalEfetivo,
    totalEstimado: totalConhecido == null,
    offset,
    inicio: arr.length === 0 ? 0 : offset + 1,
    fim: offset + arr.length,
    temAnterior: p > 1,
    temProxima: totalConhecido != null ? p < totalPaginas : arr.length === tam,
  }
}

module.exports = { FILTROS_STATUS, contagensDosFiltros, taxaResposta, paginaServidor }
