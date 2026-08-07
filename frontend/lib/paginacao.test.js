'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO, normalizarPorPagina, paginar, resumoIntervalo, resumoPaginacao, mostrarPaginacao,
} = require('./paginacao')

const listaDe = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}` }))

test('tamanhos e padrao da paginacao', () => {
  assert.deepEqual([...TAMANHOS_PAGINA], [25, 50, 100])
  assert.equal(POR_PAGINA_PADRAO, 25)
})

test('normalizarPorPagina so aceita os tamanhos oferecidos', () => {
  assert.equal(normalizarPorPagina(50), 50)
  assert.equal(normalizarPorPagina('100'), 100)
  assert.equal(normalizarPorPagina(10), POR_PAGINA_PADRAO)
  assert.equal(normalizarPorPagina(null), POR_PAGINA_PADRAO)
  assert.equal(normalizarPorPagina('lixo'), POR_PAGINA_PADRAO)
})

test('paginar recorta a janela pedida sem reordenar', () => {
  const pg = paginar(listaDe(128), 2, 25)
  assert.equal(pg.itens.length, 25)
  assert.equal(pg.itens[0].id, 'l26')
  assert.equal(pg.itens[24].id, 'l50')
  assert.equal(pg.inicio, 26)
  assert.equal(pg.fim, 50)
  assert.equal(pg.offset, 25)
  assert.equal(pg.total, 128)
  assert.equal(pg.totalPaginas, 6)
  assert.equal(pg.temAnterior, true)
  assert.equal(pg.temProxima, true)
})

test('pagina fora do intervalo e clampada (nunca cai em pagina vazia)', () => {
  assert.equal(paginar(listaDe(30), 99, 25).pagina, 2)
  assert.equal(paginar(listaDe(30), 0, 25).pagina, 1)
  assert.equal(paginar(listaDe(30), -3, 25).pagina, 1)
  assert.equal(paginar(listaDe(30), 'abc', 25).pagina, 1)
})

test('lista vazia nao quebra e nao inventa intervalo', () => {
  const pg = paginar([], 3, 25)
  assert.equal(pg.total, 0)
  assert.equal(pg.itens.length, 0)
  assert.equal(pg.pagina, 1)
  assert.equal(pg.totalPaginas, 1)
  assert.equal(pg.inicio, 0)
  assert.equal(pg.fim, 0)
  assert.equal(pg.temAnterior, false)
  assert.equal(pg.temProxima, false)
  assert.equal(paginar(null, 1, 25).total, 0)
})

test('ultima pagina fecha no total, nao no tamanho da pagina', () => {
  const pg = paginar(listaDe(128), 6, 25)
  assert.equal(pg.inicio, 126)
  assert.equal(pg.fim, 128)
  assert.equal(pg.itens.length, 3)
  assert.equal(pg.temProxima, false)
})

test('resumoIntervalo usa o vocabulario da tela e trata singular/vazio', () => {
  assert.equal(resumoIntervalo(paginar(listaDe(128), 2, 25)), 'Exibindo 26–50 de 128 leads')
  assert.equal(resumoIntervalo(paginar(listaDe(1), 1, 25)), 'Exibindo 1–1 de 1 lead')
  assert.equal(resumoIntervalo(paginar([], 1, 25)), 'Nenhum lead')
  assert.equal(resumoIntervalo(null), 'Nenhum lead')
  assert.equal(
    resumoIntervalo(paginar(listaDe(9), 1, 25), { verbo: 'Mostrando', singular: 'contato' }),
    'Mostrando 1–9 de 9 contatos'
  )
  assert.equal(resumoIntervalo(paginar([], 1, 25), { vazio: 'Nada por aqui' }), 'Nada por aqui')
})

test('resumoPaginacao mantem o formato historico da fila de ligacoes', () => {
  assert.equal(resumoPaginacao(paginar(listaDe(132), 1, 25)), 'Mostrando 1–25 de 132 leads')
  assert.equal(resumoPaginacao(paginar([], 1, 25)), 'Nenhum lead')
})

test('mostrarPaginacao: so quando ha mais que uma pagina ou tamanho fora do padrao', () => {
  assert.equal(mostrarPaginacao(10, 25), false)
  assert.equal(mostrarPaginacao(25, 25), false)
  assert.equal(mostrarPaginacao(26, 25), true)
  assert.equal(mostrarPaginacao(0, 25), false)
  assert.equal(mostrarPaginacao(40, 100), true)
})
