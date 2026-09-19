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

// ─── CRM em equipe, Etapa 6.3 ───────────────────────────────────────────────────────────
// O menu passou a filtrar por CAPACIDADE (resolvida pelo backend), nao por escada de papel.
// Estes ajudantes montam o `acesso` de cada papel, com as capacidades que
// `services/acesso-capacidades.js` concede a ele — se as duas listas divergirem, o menu passa a
// mentir sobre o que a API libera.
const CAP_COMERCIAL = [
  'lead_ver_aprovados', 'lead_assumir', 'lead_abordar_manual', 'conversa_atender',
  'ligacao_operar', 'followup_ver_fila', 'followup_operar', 'roteiro_ler',
  'agenda_operar_propria', 'instancia_gerenciar_propria', 'comissao_ver_propria',
]
const CAP_MEMBER = ['conversa_atender', 'conversa_ver_todas', 'agenda_operar_propria', 'instancia_gerenciar_propria']
// owner/admin alcancam TUDO: a lista e a uniao de todas as capacidades usadas na arvore.
const CAP_ADMIN = [
  ...CAP_COMERCIAL, ...CAP_MEMBER,
  'aquisicao_gerenciar', 'lead_triar', 'lead_ver_brutos', 'lead_disparar_lote', 'lead_transferir',
  'conversa_gerenciar_ia', 'conversa_apagar_historico', 'ligacao_ver_todas', 'campanha_gerenciar',
  'followup_reatribuir', 'followup_config_empresa', 'roteiro_gerenciar', 'agenda_ver_equipe',
  'instancia_gerenciar_empresa', 'instancia_gerenciar_contexto', 'membros_gerenciar',
  'integracoes_gerenciar', 'relatorios_ver',
]
const admin = { role: 'user', capacidades: CAP_ADMIN }
const comercial = { role: 'user', capacidades: CAP_COMERCIAL }
const member = { role: 'user', capacidades: CAP_MEMBER }
const superadmin = { role: 'superadmin', capacidades: [] }

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
  const ativo = resolverAtivo('/dashboard/instancias/abc-123/contexto', admin)
  assert.deepEqual(ativo, { href: '/dashboard/contextos', grupoId: 'configuracoes' })
})

// ---------------------------------------------------------------- visibilidade

test('o menu principal so tem os itens de topo previstos + os dois grupos', () => {
  assert.deepEqual(rotulos(navegacaoVisivel(superadmin)), [
    'Visão Geral', 'Central de Mensagens', 'Central de Ligações', 'Operação',
    'Relatórios', 'Configurações', 'Perfil',
  ])
})

test('user comum nao ve item de admin nem superadmin', () => {
  const vistos = hrefs(itensVisiveis({ role: 'user', capacidades: [] }))
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
  assert.equal(navegacaoVisivel({ role: 'user', capacidades: [] }, arvore).length, 0)
  assert.equal(navegacaoVisivel('admin', arvore).length, 1)
})

test('user comum ainda ve Operacao e Configuracoes (tem filho publico em cada)', () => {
  const grupos = navegacaoVisivel({ role: 'user', capacidades: [] }).filter((n) => n.tipo === 'grupo')
  assert.deepEqual(grupos.map((g) => g.id), ['operacao', 'configuracoes'])
  assert.deepEqual(hrefs(grupos[0].itens), ['/dashboard/agenda'])
  assert.deepEqual(hrefs(grupos[1].itens), ['/dashboard/contextos'])
})

test('Contas so aparece para superadmin', () => {
  assert.equal(hrefs(itensVisiveis(admin)).includes('/dashboard/contas'), false)
  assert.equal(hrefs(itensVisiveis(superadmin)).includes('/dashboard/contas'), true)
})

test('nenhuma rota foi renomeada nesta reorganizacao', () => {
  const todas = hrefs(itensVisiveis(superadmin)).sort()
  assert.deepEqual(todas, [
    '/dashboard', '/dashboard/agenda', '/dashboard/aquisicao', '/dashboard/banco-leads',
    '/dashboard/central-ligacoes', '/dashboard/comissao', '/dashboard/contas',
    '/dashboard/contas-empresa',
    '/dashboard/contextos',
    '/dashboard/conversas', '/dashboard/equipe', '/dashboard/equipes-comerciais',
    '/dashboard/follow-ups', '/dashboard/integracoes',
    '/dashboard/llm', '/dashboard/perfil', '/dashboard/playbook', '/dashboard/prompts',
    '/dashboard/relatorios', '/dashboard/roteiros', '/dashboard/uso',
  ])
})

test('Equipes comerciais e' + "'" + ' de gestao: comercial NAO ve o item', () => {
  // Equipe organiza CARTEIRA (que nicho se trabalha), nao acesso — mas quem MONTA a equipe e' o
  // dono. O item filtra pela MESMA capacidade do mount do backend (`MEMBROS_GERENCIAR`), senao o
  // menu ofereceria uma tela que responde 403.
  assert.ok(hrefs(itensVisiveis(admin)).includes('/dashboard/equipes-comerciais'))
  assert.ok(!hrefs(itensVisiveis(comercial)).includes('/dashboard/equipes-comerciais'))
})

test('Contas da empresa e Contas da PLATAFORMA sao telas distintas, com papeis distintos', () => {
  // `/dashboard/contas-empresa` (CRM em equipe, Etapa 2) lista quem trabalha NESTA empresa;
  // `/dashboard/contas` e' a lista global da plataforma. Fundir as duas daria a um admin de
  // empresa a lista de contas de TODAS as empresas — foi por isso que nasceram separadas.
  assert.ok(hrefs(itensVisiveis(admin)).includes('/dashboard/contas-empresa'))
  assert.ok(!hrefs(itensVisiveis(admin)).includes('/dashboard/contas'))
  assert.ok(!hrefs(itensVisiveis(comercial)).includes('/dashboard/contas-empresa'))
})

// ---------------------------------------------------------------- ativo

test('resolverAtivo devolve o item e o grupo dele', () => {
  assert.deepEqual(resolverAtivo('/dashboard/uso', admin), { href: '/dashboard/uso', grupoId: 'configuracoes' })
  assert.deepEqual(resolverAtivo('/dashboard/follow-ups', admin), { href: '/dashboard/follow-ups', grupoId: 'operacao' })
  assert.deepEqual(resolverAtivo('/dashboard/conversas', admin), { href: '/dashboard/conversas', grupoId: null })
})

test('resolverAtivo nao acende item que o papel nem enxerga', () => {
  assert.deepEqual(resolverAtivo('/dashboard/contas', admin), { href: null, grupoId: null })
  assert.deepEqual(resolverAtivo('/dashboard/contas', superadmin), { href: '/dashboard/contas', grupoId: 'configuracoes' })
})

test('rota fora da arvore nao acende nada', () => {
  assert.deepEqual(resolverAtivo('/dashboard/inexistente', superadmin), { href: null, grupoId: null })
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


// ---------------------------------------------------------------- capacidades (Etapa 6.3)

test('o COMERCIAL ve o trabalho e NAO ve a gestao', () => {
  const vistos = hrefs(itensVisiveis(comercial))
  // O que ele trabalha:
  for (const r of ['/dashboard/central-ligacoes', '/dashboard/banco-leads', '/dashboard/follow-ups',
    '/dashboard/roteiros', '/dashboard/conversas', '/dashboard/agenda']) {
    assert.ok(vistos.includes(r), `comercial precisa ver ${r}`)
  }
  // O que e' gestao — o caso NEGATIVO, que e' o que da valor ao papel:
  for (const r of ['/dashboard/aquisicao', '/dashboard/relatorios', '/dashboard/equipe',
    '/dashboard/contas-empresa', '/dashboard/integracoes', '/dashboard/llm', '/dashboard/uso',
    '/dashboard/prompts', '/dashboard/playbook', '/dashboard/contas']) {
    assert.ok(!vistos.includes(r), `comercial NAO pode ver ${r}`)
  }
})

test('o MEMBER ve menos que o comercial: nao opera fila nem liga', () => {
  const vistos = hrefs(itensVisiveis(member))
  assert.ok(vistos.includes('/dashboard/conversas'))
  assert.ok(vistos.includes('/dashboard/agenda'))
  assert.ok(!vistos.includes('/dashboard/central-ligacoes'))
  assert.ok(!vistos.includes('/dashboard/banco-leads'))
  assert.ok(!vistos.includes('/dashboard/follow-ups'))
})

test('sessao CARREGANDO (capacidades null) mostra so o que nao exige nada', () => {
  // Mostrar um item que vai responder 403 e' pior que mostra-lo um instante depois.
  const vistos = hrefs(itensVisiveis({ role: 'user', capacidades: null }))
  assert.deepEqual(vistos.sort(), [
    '/dashboard', '/dashboard/agenda', '/dashboard/contextos', '/dashboard/conversas', '/dashboard/perfil',
  ].sort())
})

test('superadmin enxerga TUDO mesmo sem lista de capacidades', () => {
  // O backend responde assim (`avaliarCapacidade` devolve `plataforma`). Se o menu escondesse,
  // a tela mentiria sobre o proprio acesso.
  const vistos = hrefs(itensVisiveis({ role: 'superadmin', capacidades: null }))
  assert.ok(vistos.includes('/dashboard/aquisicao'))
  assert.ok(vistos.includes('/dashboard/equipe'))
  assert.ok(vistos.includes('/dashboard/contas'))
})

test('capacidade DESCONHECIDA esconde o item', () => {
  const arvore = [{ tipo: 'item', href: '/x', label: 'X', capacidade: 'capacidade_que_nao_existe' }]
  assert.equal(navegacaoVisivel(comercial, arvore).length, 0)
  assert.equal(navegacaoVisivel(admin, arvore).length, 0)
  // Mas o superadmin continua passando: ele nao e filtrado por capacidade.
  assert.equal(navegacaoVisivel(superadmin, arvore).length, 1)
})

test('a arvore nao usa mais minRole, exceto em /dashboard/contas (plataforma)', () => {
  const comMinRole = []
  const visitar = (nos) => {
    for (const no of nos) {
      if (no.tipo === 'grupo') { visitar(no.itens); continue }
      if (no.minRole) comMinRole.push(no.href)
    }
  }
  visitar(NAV)
  assert.deepEqual(comMinRole, ['/dashboard/contas'],
    'so a tela de PLATAFORMA pode continuar decidida por papel global')
})

test('todo item de gestao declara capacidade — nenhum ficou publico por engano', () => {
  const publicosEsperados = [
    '/dashboard', '/dashboard/conversas', '/dashboard/agenda', '/dashboard/contextos', '/dashboard/perfil',
  ]
  const publicos = []
  const visitar = (nos) => {
    for (const no of nos) {
      if (no.tipo === 'grupo') { visitar(no.itens); continue }
      if (!no.capacidade && !no.minRole) publicos.push(no.href)
    }
  }
  visitar(NAV)
  assert.deepEqual(publicos.sort(), publicosEsperados.sort())
})
