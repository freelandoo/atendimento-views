const test = require('node:test')
const assert = require('node:assert/strict')

const {
  VIEW_PADRAO, VIEW_RECOMENDADA,
  normalizarView, limparFiltros, limparCampo, faixaTentativas,
  passaNosFiltros, filtrarFila, chipsAtivos, contarFiltrosAtivos,
} = require('./fila-ligacoes-view')

const lead = (over = {}) => ({
  campanha_lead_id: 'x', tentativas: 0, avaliacoes: 74, rating: 4.7,
  cidade: 'Feira de Santana', endereco: 'Av. Getulio Vargas, 100 - Centro',
  prioridade: { score: 85, faixa: 'alta', situacao_site: 'sem_site', motivos: [] },
  ...over,
})

test('padrao e visao simplificada, sem nenhum filtro ativo', () => {
  assert.equal(VIEW_PADRAO.modo, 'simplificada')
  assert.equal(contarFiltrosAtivos(VIEW_PADRAO), 0)
  assert.equal(filtrarFila([lead(), lead({ campanha_lead_id: 'y' })], VIEW_PADRAO).length, 2)
})

test('view invalida do localStorage cai no padrao sem quebrar', () => {
  assert.deepEqual(normalizarView(null), VIEW_PADRAO)
  assert.deepEqual(normalizarView({ site: 'inexistente', modo: 'xpto', avalMin: 5 }), VIEW_PADRAO)
  assert.equal(normalizarView({ modo: 'detalhada' }).modo, 'detalhada')
})

test('filtro de site usa a situacao vinda do backend', () => {
  const semSite = lead()
  const comSite = lead({ prioridade: { faixa: 'baixa', situacao_site: 'tem_site' } })
  const naoIdent = lead({ prioridade: { faixa: 'media', situacao_site: 'nao_identificado' } })
  const lista = [semSite, comSite, naoIdent]
  assert.equal(filtrarFila(lista, { site: 'sem_site' }).length, 1)
  assert.equal(filtrarFila(lista, { site: 'tem_site' })[0], comSite)
  assert.equal(filtrarFila(lista, { site: 'nao_identificado' })[0], naoIdent)
  assert.equal(filtrarFila(lista, { site: 'todos' }).length, 3)
})

test('filtro de prioridade por faixa', () => {
  const lista = [lead(), lead({ prioridade: { faixa: 'baixa', situacao_site: 'tem_site' } })]
  assert.equal(filtrarFila(lista, { prioridade: 'alta' }).length, 1)
  assert.equal(filtrarFila(lista, { prioridade: 'baixa' }).length, 1)
  assert.equal(filtrarFila(lista, { prioridade: 'media' }).length, 0)
})

test('faixas de tentativas', () => {
  assert.equal(faixaTentativas(0), 'nenhuma')
  assert.equal(faixaTentativas(1), 'uma')
  assert.equal(faixaTentativas(7), 'duas_mais')
  assert.equal(faixaTentativas(null), 'nenhuma')
  const lista = [lead({ tentativas: 0 }), lead({ tentativas: 1 }), lead({ tentativas: 3 })]
  assert.equal(filtrarFila(lista, { tentativas: 'duas_mais' }).length, 1)
})

test('faixas numericas de avaliacoes e nota; ausente nao passa por faixa minima', () => {
  const lista = [lead({ avaliacoes: 74, rating: 4.7 }), lead({ avaliacoes: 3, rating: 3.0 }), lead({ avaliacoes: null, rating: null })]
  assert.equal(filtrarFila(lista, { avalMin: '50' }).length, 1)
  assert.equal(filtrarFila(lista, { avalMax: '10' }).length, 1)
  assert.equal(filtrarFila(lista, { notaMin: '4.5' }).length, 1)
  assert.equal(filtrarFila(lista, { avalMin: '0' }).length, 2) // sem avaliacoes nao vira zero
})

test('localizacao busca em cidade e endereco', () => {
  assert.equal(passaNosFiltros(lead(), { local: 'feira' }), true)
  assert.equal(passaNosFiltros(lead(), { local: 'centro' }), true)
  assert.equal(passaNosFiltros(lead(), { local: 'salvador' }), false)
})

test('a ordem de prioridade vinda do servidor e preservada', () => {
  const a = lead({ campanha_lead_id: 'a' })
  const b = lead({ campanha_lead_id: 'b' })
  const c = lead({ campanha_lead_id: 'c' })
  assert.deepEqual(filtrarFila([a, b, c], { site: 'sem_site' }).map((l) => l.campanha_lead_id), ['a', 'b', 'c'])
})

test('chips descrevem os filtros ativos e o contador bate', () => {
  const v = { ...VIEW_PADRAO, site: 'sem_site', avalMin: '50', local: 'Feira' }
  const chips = chipsAtivos(v)
  assert.equal(chips.length, 3)
  assert.equal(contarFiltrosAtivos(v), 3)
  assert.ok(chips.some((c) => /Sem site/i.test(c.label)))
  assert.ok(chips.some((c) => /50\+ avaliacoes/i.test(c.label)))
})

test('limpar filtros preserva o modo de exibicao', () => {
  const v = { ...VIEW_PADRAO, modo: 'detalhada', site: 'sem_site', notaMin: '4' }
  const limpo = limparFiltros(v)
  assert.equal(limpo.modo, 'detalhada')
  assert.equal(contarFiltrosAtivos(limpo), 0)
})

test('limpar um chip zera so aquele grupo', () => {
  const v = { ...VIEW_PADRAO, site: 'sem_site', avalMin: '50', avalMax: '90' }
  const semAval = limparCampo(v, 'aval')
  assert.equal(semAval.avalMin, '')
  assert.equal(semAval.avalMax, '')
  assert.equal(semAval.site, 'sem_site')
})

test('atalho recomendado da campanha: sem site', () => {
  assert.equal(VIEW_RECOMENDADA.site, 'sem_site')
  assert.equal(VIEW_RECOMENDADA.modo, 'simplificada')
})
