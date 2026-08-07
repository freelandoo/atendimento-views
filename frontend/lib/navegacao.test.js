'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  NAV, IDS_GRUPOS, podePapel, normalizarRota, mesmaRota, rotasDoItem, itemAtivo,
  navegacaoVisivel, itensVisiveis, resolverAtivo, normalizarGruposAbertos, alternarGrupo,
  lerGruposAbertos,
} = require('./navegacao')

const rotulos = (nos) => nos.map((n) => n.label)
const hrefs = (itens) => itens.map((i) => i.href)

// ---------------------------------------------------------------- papéis

test('podePapel respeita a escada user < admin < superadmin', () => {
  assert.equal(podePapel('user', 'admin'), false)
  assert.equal(podePapel('admin', 'admin'), true)
  assert.equal(podePapel('admin', 'superadmin'), false)
  assert.equal(podePapel('superadmin', 'admin'), true)
})

test('sem exigencia o item e publico; exigencia desconhecida NEGA', () => {
  assert.equal(podePapel(undefined, undefined), true)
  assert.equal(podePapel(undefined, null), true)
  // Um enum novo escrito errado nao pode virar porta aberta.
  assert.equal(podePapel('superadmin', 'chefe'), false)
})

test('papel ausente (sessao carregando) nao enxerga item de admin', () => {
  assert.equal(podePapel(undefined, 'admin'), false)
  assert.equal(podePapel(undefined, 'user'), true)
})

// ---------------------------------------------------------------- rotas

test('normalizarRota tira barra final, query e hash', () => {
  assert.equal(normalizarRota('/dashboard/uso/'), '/dashboard/uso')
  assert.equal(normalizarRota('/dashboard/uso?x=1'), '/dashboard/uso')
  assert.equal(normalizarRota('/dashboard/uso#topo'), '/dashboard/uso')
  assert.equal(normalizarRota('/'), '/')
  assert.equal(normalizarRota(null), '')
})

test('mesmaRota compara por SEGMENTO, nao por prefixo de texto', () => {
  assert.equal(mesmaRota('/dashboard/conversas', '/dashboard/conversas'), true)
  assert.equal(mesmaRota('/dashboard/conversas/123', '/dashboard/conversas'), true)
  // O caso que o startsWith cru errava:
  assert.equal(mesmaRota('/dashboard/conversas-arquivadas', '/dashboard/conversas'), false)
})

test('mesmaRota com exato so aceita igualdade — Visao Geral nao acende no painel inteiro', () => {
  assert.equal(mesmaRota('/dashboard', '/dashboard', true), true)
  assert.equal(mesmaRota('/dashboard/uso', '/dashboard', true), false)
})

// ---------------------------------------------------------------- item ativo

test('aliases acendem o mesmo item: prospeccao e captacao sao Aquisicao', () => {
  const aquisicao = NAV.find((n) => n.id === 'operacao').itens.find((i) => i.href === '/dashboard/aquisicao')
  assert.deepEqual(rotasDoItem(aquisicao), ['/dashboard/aquisicao', '/dashboard/prospeccao', '/dashboard/captacao'])
  assert.equal(itemAtivo('/dashboard/prospeccao', aquisicao), true)
  assert.equal(itemAtivo('/dashboard/captacao', aquisicao), true)
  assert.equal(itemAtivo('/dashboard/banco-leads', aquisicao), false)
})

test('a pagina filha de instancia acende Instancias', () => {
  const ativo = resolverAtivo('/dashboard/instancias/abc-123/contexto', 'admin')
  assert.deepEqual(ativo, { href: '/dashboard/contextos', grupoId: 'configuracoes' })
})

// ---------------------------------------------------------------- visibilidade

test('o menu principal so tem os itens de topo previstos + os dois grupos', () => {
  assert.deepEqual(rotulos(navegacaoVisivel('superadmin')), [
    'Visão Geral', 'Central de Mensagens', 'Central de Ligações', 'Operação',
    'Relatórios', 'Configurações', 'Perfil',
  ])
})

test('user comum nao ve item de admin nem superadmin', () => {
  const vistos = hrefs(itensVisiveis('user'))
  assert.equal(vistos.includes('/dashboard/banco-leads'), false)
  assert.equal(vistos.includes('/dashboard/integracoes'), false)
  assert.equal(vistos.includes('/dashboard/contas'), false)
  // ...mas continua vendo o que sempre viu.
  assert.deepEqual(vistos, ['/dashboard', '/dashboard/conversas', '/dashboard/agenda', '/dashboard/contextos', '/dashboard/perfil'])
})

test('grupo sem nenhum filho visivel SOME — nao abre vazio', () => {
  const arvore = [
    { tipo: 'grupo', id: 'so_admin', label: 'Só admin', icon: 'settings', itens: [
      { tipo: 'item', href: '/x', label: 'X', icon: 'usage', minRole: 'admin' },
    ] },
  ]
  assert.equal(navegacaoVisivel('user', arvore).length, 0)
  assert.equal(navegacaoVisivel('admin', arvore).length, 1)
})

test('user comum ainda ve Operacao e Configuracoes (tem filho publico em cada)', () => {
  const grupos = navegacaoVisivel('user').filter((n) => n.tipo === 'grupo')
  assert.deepEqual(grupos.map((g) => g.id), ['operacao', 'configuracoes'])
  assert.deepEqual(hrefs(grupos[0].itens), ['/dashboard/agenda'])
  assert.deepEqual(hrefs(grupos[1].itens), ['/dashboard/contextos'])
})

test('Contas so aparece para superadmin', () => {
  assert.equal(hrefs(itensVisiveis('admin')).includes('/dashboard/contas'), false)
  assert.equal(hrefs(itensVisiveis('superadmin')).includes('/dashboard/contas'), true)
})

test('nenhuma rota foi renomeada nesta reorganizacao', () => {
  const todas = hrefs(itensVisiveis('superadmin')).sort()
  assert.deepEqual(todas, [
    '/dashboard', '/dashboard/agenda', '/dashboard/aquisicao', '/dashboard/banco-leads',
    '/dashboard/central-ligacoes', '/dashboard/contas', '/dashboard/contextos',
    '/dashboard/conversas', '/dashboard/follow-ups', '/dashboard/integracoes',
    '/dashboard/llm', '/dashboard/perfil', '/dashboard/playbook', '/dashboard/prompts',
    '/dashboard/relatorios', '/dashboard/roteiros', '/dashboard/uso',
  ])
})

// ---------------------------------------------------------------- ativo

test('resolverAtivo devolve o item e o grupo dele', () => {
  assert.deepEqual(resolverAtivo('/dashboard/uso', 'admin'), { href: '/dashboard/uso', grupoId: 'configuracoes' })
  assert.deepEqual(resolverAtivo('/dashboard/follow-ups', 'admin'), { href: '/dashboard/follow-ups', grupoId: 'operacao' })
  assert.deepEqual(resolverAtivo('/dashboard/conversas', 'admin'), { href: '/dashboard/conversas', grupoId: null })
})

test('resolverAtivo nao acende item que o papel nem enxerga', () => {
  assert.deepEqual(resolverAtivo('/dashboard/contas', 'admin'), { href: null, grupoId: null })
  assert.deepEqual(resolverAtivo('/dashboard/contas', 'superadmin'), { href: '/dashboard/contas', grupoId: 'configuracoes' })
})

test('rota fora da arvore nao acende nada', () => {
  assert.deepEqual(resolverAtivo('/dashboard/inexistente', 'superadmin'), { href: null, grupoId: null })
})

// ---------------------------------------------------------------- grupos abertos

test('normalizarGruposAbertos descarta lixo e mantem a ordem da arvore', () => {
  assert.deepEqual(normalizarGruposAbertos(['configuracoes', 'nao_existe', 'operacao']), ['operacao', 'configuracoes'])
  assert.deepEqual(normalizarGruposAbertos(null), [])
  assert.deepEqual(normalizarGruposAbertos('operacao'), [])
})

test('o grupo da pagina atual e SEMPRE incluido', () => {
  assert.deepEqual(normalizarGruposAbertos([], 'configuracoes'), ['configuracoes'])
  assert.deepEqual(normalizarGruposAbertos(['operacao'], 'configuracoes'), ['operacao', 'configuracoes'])
  assert.deepEqual(normalizarGruposAbertos([], null), [])
})

test('alternarGrupo abre, fecha e nao muta a lista anterior', () => {
  const antes = ['operacao']
  const depois = alternarGrupo(antes, 'configuracoes')
  assert.deepEqual(antes, ['operacao'])
  assert.deepEqual(depois, ['operacao', 'configuracoes'])
  assert.deepEqual(alternarGrupo(depois, 'operacao'), ['configuracoes'])
  assert.deepEqual(alternarGrupo(['operacao'], 'nao_existe'), ['operacao'])
})

test('lerGruposAbertos sobrevive a JSON invalido no localStorage', () => {
  assert.deepEqual(lerGruposAbertos('["operacao"]'), ['operacao'])
  assert.deepEqual(lerGruposAbertos('{quebrado'), [])
  assert.deepEqual(lerGruposAbertos('{"a":1}'), [])
  assert.deepEqual(lerGruposAbertos(null), [])
  assert.deepEqual(lerGruposAbertos('[1,"operacao"]'), ['operacao'])
})

test('IDS_GRUPOS reflete a arvore', () => {
  assert.deepEqual(IDS_GRUPOS, ['operacao', 'configuracoes'])
})
