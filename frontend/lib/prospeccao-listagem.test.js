'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { FILTROS_STATUS, contagensDosFiltros, taxaResposta, paginaServidor } = require('./prospeccao-listagem')
const { resumoIntervalo } = require('./paginacao')

// Formato real de GET /prospeccao/metricas: COUNT(*) do PostgreSQL chega como STRING.
const METRICAS = {
  total: '128', aguardando: '42', aprovados: '18', rejeitados: '11',
  enviados: '45', responderam: '12', taxa_resposta: 21,
}

const listaDe = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}` }))

test('os seis filtros de status estao presentes e na ordem da tela', () => {
  assert.deepEqual(
    FILTROS_STATUS.map((f) => f.label),
    ['Todos', 'Aguardando', 'Marcados', 'Descartados', 'Enviados', 'Responderam']
  )
  assert.deepEqual(
    FILTROS_STATUS.map((f) => f.valor),
    ['', 'aguardando', 'aprovado', 'rejeitado', 'enviado', 'respondeu']
  )
})

test('contagens saem das metricas, com string virando numero', () => {
  const c = contagensDosFiltros(METRICAS)
  assert.equal(c[''], 128)
  assert.equal(c.aguardando, 42)
  assert.equal(c.aprovado, 18)
  assert.equal(c.rejeitado, 11)
  assert.equal(c.enviado, 45)
  assert.equal(c.respondeu, 12)
})

test('metricas ausentes = contagem DESCONHECIDA (null), nunca zero', () => {
  for (const m of [null, undefined, {}]) {
    const c = contagensDosFiltros(m)
    assert.equal(c[''], null)
    assert.equal(c.aguardando, null)
  }
  assert.equal(contagensDosFiltros({ total: 'x' })[''], null)
})

test('zero de verdade continua sendo zero', () => {
  const c = contagensDosFiltros({ ...METRICAS, responderam: '0' })
  assert.equal(c.respondeu, 0)
})

test('taxa de resposta = responderam / (enviados + responderam)', () => {
  const t = taxaResposta(METRICAS)
  assert.equal(t.base, 57)
  assert.equal(t.responderam, 12)
  assert.equal(t.percentual, 21)
  assert.equal(t.texto, '21%')
})

test('sem ninguem que recebeu mensagem nao ha divisao por zero', () => {
  for (const m of [null, {}, { enviados: '0', responderam: '0' }]) {
    const t = taxaResposta(m)
    assert.equal(t.percentual, null)
    assert.equal(t.texto, '—')
    assert.equal(t.base, 0)
  }
})

test('todo mundo que recebeu respondeu = 100%', () => {
  const t = taxaResposta({ enviados: '0', responderam: '7' })
  assert.equal(t.texto, '100%')
  assert.equal(t.base, 7)
})

// --- Paginacao vinda do SERVIDOR ---------------------------------------------------------
// A pagina chega recortada (25 itens) e o total vem da contagem do filtro. E' isso que permite
// alcancar o lead 2000 sem nunca carregar 2000 leads.
const pagina2 = () => paginaServidor({ itens: listaDe(25), pagina: 2, porPagina: 25, total: '2223' })

test('descreve a pagina recortada pelo servidor com o total do filtro', () => {
  const pg = pagina2()
  assert.equal(pg.itens.length, 25)
  assert.equal(pg.pagina, 2)
  assert.equal(pg.total, 2223)
  assert.equal(pg.totalPaginas, 89)
  assert.equal(pg.offset, 25)
  assert.equal(pg.inicio, 26)
  assert.equal(pg.fim, 50)
  assert.equal(pg.temAnterior, true)
  assert.equal(pg.temProxima, true)
  assert.equal(pg.totalEstimado, false)
})

test('o resumo cobre a carteira inteira, nao so o que foi carregado', () => {
  assert.equal(resumoIntervalo(pagina2()), 'Exibindo 26–50 de 2223 leads')
})

test('ultima pagina fecha no total e nao oferece proxima', () => {
  const pg = paginaServidor({ itens: listaDe(23), pagina: 89, porPagina: 25, total: 2223 })
  assert.equal(pg.inicio, 2201)
  assert.equal(pg.fim, 2223)
  assert.equal(pg.temProxima, false)
  assert.equal(pg.temAnterior, true)
})

test('total ainda desconhecido nao vira zero nem trava a navegacao', () => {
  const cheia = paginaServidor({ itens: listaDe(25), pagina: 1, porPagina: 25, total: null })
  assert.equal(cheia.totalEstimado, true)
  assert.equal(cheia.total, 25)
  // Pagina veio CHEIA: provavelmente ha mais. Sem isso a tela travaria no primeiro instante.
  assert.equal(cheia.temProxima, true)

  const parcial = paginaServidor({ itens: listaDe(9), pagina: 1, porPagina: 25, total: undefined })
  assert.equal(parcial.temProxima, false)
})

test('pagina vazia nao inventa intervalo', () => {
  const pg = paginaServidor({ itens: [], pagina: 1, porPagina: 25, total: 0 })
  assert.equal(pg.inicio, 0)
  assert.equal(pg.fim, 0)
  assert.equal(pg.temProxima, false)
  assert.equal(resumoIntervalo(pg, { vazio: 'Nenhum lead nesta lista' }), 'Nenhum lead nesta lista')
})

test('entrada invalida cai em pagina 1 sem quebrar', () => {
  const pg = paginaServidor({ itens: null, pagina: 'abc', porPagina: 0, total: 'lixo' })
  assert.equal(pg.pagina, 1)
  assert.equal(pg.itens.length, 0)
  assert.equal(pg.total, 0)
})
