'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { FILTROS_STATUS, contagensDosFiltros, taxaResposta, resumoRodape } = require('./prospeccao-listagem')
const { paginar } = require('./paginacao')

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

test('rodape mostra o intervalo visivel da pagina', () => {
  const { texto, aviso } = resumoRodape(paginar(listaDe(128), 2, 25), 128)
  assert.equal(texto, 'Exibindo 26–50 de 128 leads')
  assert.equal(aviso, '')
})

test('rodape avisa quando o filtro tem mais leads do que a lista carregada', () => {
  const { texto, aviso } = resumoRodape(paginar(listaDe(100), 1, 25), '128')
  assert.equal(texto, 'Exibindo 1–25 de 100 leads')
  assert.match(aviso, /limitada a 100 de 128 leads/)
})

test('total do filtro desconhecido ou menor nao gera aviso', () => {
  assert.equal(resumoRodape(paginar(listaDe(100), 1, 25), null).aviso, '')
  assert.equal(resumoRodape(paginar(listaDe(100), 1, 25), 100).aviso, '')
  assert.equal(resumoRodape(paginar(listaDe(100), 1, 25), 3).aviso, '')
})

test('lista vazia tem rodape proprio, sem intervalo inventado', () => {
  const { texto, aviso } = resumoRodape(paginar([], 1, 25), 0)
  assert.equal(texto, 'Nenhum lead nesta lista')
  assert.equal(aviso, '')
})
