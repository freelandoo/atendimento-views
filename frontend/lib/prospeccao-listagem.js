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

const { resumoIntervalo } = require('./paginacao')

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
 * Rodape da listagem: o intervalo visivel dentro do que foi carregado.
 *
 * `totalNoFiltro` (das metricas) pode ser MAIOR que o total carregado, porque a requisicao tem
 * limite. Nesse caso o aviso e' explicito: paginar so anda dentro do que veio, e esconder isso
 * faria o operador acreditar que viu a carteira inteira.
 */
function resumoRodape(pg, totalNoFiltro) {
  const carregados = pg?.total || 0
  const texto = resumoIntervalo(pg, { vazio: 'Nenhum lead nesta lista' })
  const total = inteiroOuNulo(totalNoFiltro)
  const aviso = total != null && total > carregados
    ? `Lista limitada a ${carregados} de ${total} leads deste filtro — refine a busca para ver o resto.`
    : ''
  return { texto, aviso }
}

module.exports = { FILTROS_STATUS, contagensDosFiltros, taxaResposta, resumoRodape }
