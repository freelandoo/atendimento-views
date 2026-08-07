const test = require('node:test')
const assert = require('node:assert/strict')

const {
  VIEW_NEUTRA, VIEW_PADRAO,
  normalizarView, limparFiltros, filaPadrao, limparCampo, faixaTentativas,
  passaNosFiltros, filtrarFila, opcoesDaFila, chipsAtivos, contarFiltrosAtivos, viewsIguais,
} = require('./fila-ligacoes-view')

const AGORA = Date.parse('2026-08-07T12:00:00Z')
const diasAtras = (n) => new Date(AGORA - n * 24 * 60 * 60 * 1000).toISOString()

const lead = (over = {}) => ({
  campanha_lead_id: 'x', status: 'nao_iniciado', tentativas: 0, avaliacoes: 74, rating: 4.7,
  cidade: 'Feira de Santana', endereco: 'Av. Getulio Vargas, 100 - Centro',
  nicho: 'Barbearia', origem: 'automatico', created_at: diasAtras(3),
  prioridade: { score: 85, faixa: 'alta', situacao_site: 'sem_site', motivos: [] },
  ...over,
})

// --- Fila padrao ------------------------------------------------------------------------
test('a fila PADRAO e "nenhuma tentativa" — e isso aparece como filtro ativo', () => {
  assert.equal(VIEW_PADRAO.tentativas, 'nao_iniciados')
  assert.equal(contarFiltrosAtivos(VIEW_PADRAO), 1)
  assert.ok(chipsAtivos(VIEW_PADRAO).some((c) => /Não iniciados/i.test(c.label)))
  const lista = [lead({ tentativas: 0 }), lead({ tentativas: 1 }), lead({ tentativas: 4 })]
  assert.equal(filtrarFila(lista, VIEW_PADRAO, AGORA).length, 1)
})

test('estado neutro nao filtra nada e nao tem chip', () => {
  assert.equal(contarFiltrosAtivos(VIEW_NEUTRA), 0)
  assert.equal(filtrarFila([lead(), lead({ tentativas: 5 })], VIEW_NEUTRA, AGORA).length, 2)
})

test('nao existe mais modo de exibicao na fila', () => {
  assert.equal('modo' in VIEW_PADRAO, false)
  assert.equal('modo' in normalizarView({ modo: 'detalhada' }), false)
})

test('view corrompida/antiga do localStorage volta ao PADRAO, nao ao neutro', () => {
  assert.deepEqual(normalizarView(null), VIEW_PADRAO)
  assert.deepEqual(normalizarView({ site: 'inexistente', tentativas: 'nenhuma', avalMin: 5 }), VIEW_PADRAO)
})

test('limpar filtros mostra a fila inteira; "fila padrao" volta aos nao iniciados', () => {
  assert.deepEqual(limparFiltros(), VIEW_NEUTRA)
  assert.deepEqual(filaPadrao(), VIEW_PADRAO)
})

// --- Operacao ----------------------------------------------------------------------------
test('tentativas tem tres opcoes: nao iniciados, com tentativa e todos', () => {
  assert.equal(faixaTentativas(0), 'nao_iniciados')
  assert.equal(faixaTentativas(1), 'com_tentativa')
  assert.equal(faixaTentativas(7), 'com_tentativa')
  assert.equal(faixaTentativas(null), 'nao_iniciados')
  const lista = [lead({ tentativas: 0 }), lead({ tentativas: 1 }), lead({ tentativas: 3 })]
  assert.equal(filtrarFila(lista, { tentativas: 'com_tentativa' }, AGORA).length, 2)
  assert.equal(filtrarFila(lista, { tentativas: 'todas' }, AGORA).length, 3)
})

test('filtro de status e de proxima acao', () => {
  const lista = [
    lead({ status: 'nao_iniciado', proxima_acao: null }),
    lead({ status: 'follow_up', proxima_acao: 'Mandar proposta' }),
  ]
  assert.equal(filtrarFila(lista, { tentativas: 'todas', status: 'follow_up' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { tentativas: 'todas', proximaAcao: 'com' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { tentativas: 'todas', proximaAcao: 'sem' }, AGORA).length, 1)
})

// --- Contato -----------------------------------------------------------------------------
test('filtro de e-mail disponivel', () => {
  const lista = [lead({ email: 'a@b.com' }), lead({ email: null }), lead({ email: '  ' })]
  assert.equal(filtrarFila(lista, { tentativas: 'todas', email: 'com' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { tentativas: 'todas', email: 'sem' }, AGORA).length, 2)
})

// --- Potencial comercial -----------------------------------------------------------------
test('filtro de prioridade por faixa', () => {
  const lista = [lead(), lead({ prioridade: { faixa: 'baixa', situacao_site: 'tem_site' } })]
  assert.equal(filtrarFila(lista, { tentativas: 'todas', prioridade: 'alta' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { tentativas: 'todas', prioridade: 'media' }, AGORA).length, 0)
})

test('faixas numericas de avaliacoes e nota; ausente nao passa por faixa minima', () => {
  const lista = [lead({ avaliacoes: 74, rating: 4.7 }), lead({ avaliacoes: 3, rating: 3.0 }), lead({ avaliacoes: null, rating: null })]
  const v = { tentativas: 'todas' }
  assert.equal(filtrarFila(lista, { ...v, avalMin: '50' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { ...v, avalMax: '10' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { ...v, notaMin: '4.5' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { ...v, avalMin: '0' }, AGORA).length, 2) // sem avaliacoes nao vira zero
})

// --- Perfil do negocio ---------------------------------------------------------------------
test('localizacao busca em cidade e endereco; segmento e exato', () => {
  assert.equal(passaNosFiltros(lead(), { tentativas: 'todas', local: 'feira' }, AGORA), true)
  assert.equal(passaNosFiltros(lead(), { tentativas: 'todas', local: 'centro' }, AGORA), true)
  assert.equal(passaNosFiltros(lead(), { tentativas: 'todas', local: 'salvador' }, AGORA), false)
  assert.equal(passaNosFiltros(lead(), { tentativas: 'todas', nicho: 'Barbearia' }, AGORA), true)
  assert.equal(passaNosFiltros(lead(), { tentativas: 'todas', nicho: 'Padaria' }, AGORA), false)
})

// --- Presenca digital -----------------------------------------------------------------------
test('situacao do site vem do backend (prioridade OU situacao_site)', () => {
  const semSite = lead()
  const comSite = lead({ prioridade: { faixa: 'baixa', situacao_site: 'tem_site' } })
  const naoIdent = lead({ prioridade: null, situacao_site: 'nao_identificado' })
  const lista = [semSite, comSite, naoIdent]
  const v = { tentativas: 'todas' }
  assert.equal(filtrarFila(lista, { ...v, site: 'sem_site' }, AGORA)[0], semSite)
  assert.equal(filtrarFila(lista, { ...v, site: 'tem_site' }, AGORA)[0], comSite)
  assert.equal(filtrarFila(lista, { ...v, site: 'nao_identificado' }, AGORA)[0], naoIdent)
  assert.equal(filtrarFila(lista, { ...v, site: 'todos' }, AGORA).length, 3)
})

test('filtro de redes sociais usa instagram ou link da bio', () => {
  const lista = [lead({ instagram_handle: 'loja' }), lead({ link_bio: 'https://linktr.ee/x' }), lead()]
  const v = { tentativas: 'todas' }
  assert.equal(filtrarFila(lista, { ...v, redes: 'com' }, AGORA).length, 2)
  assert.equal(filtrarFila(lista, { ...v, redes: 'sem' }, AGORA).length, 1)
})

// --- Qualidade do dado -----------------------------------------------------------------------
test('origem e recencia do cadastro', () => {
  const lista = [
    lead({ origem: 'automatico', created_at: diasAtras(3) }),
    lead({ origem: 'manual', created_at: diasAtras(45) }),
    lead({ origem: 'manual', created_at: diasAtras(200) }),
    lead({ origem: 'manual', created_at: null }),
  ]
  const v = { tentativas: 'todas' }
  assert.equal(filtrarFila(lista, { ...v, origem: 'manual' }, AGORA).length, 3)
  assert.equal(filtrarFila(lista, { ...v, recencia: '7d' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { ...v, recencia: '30d' }, AGORA).length, 1)
  assert.equal(filtrarFila(lista, { ...v, recencia: '90mais' }, AGORA).length, 1)
  // Sem data nao e' "recente" nem "antigo": fica de fora de qualquer faixa.
  assert.equal(filtrarFila([lead({ created_at: null })], { ...v, recencia: '7d' }, AGORA).length, 0)
})

test('opcoes dependentes da fila e visibilidade do grupo Qualidade do dado', () => {
  const o = opcoesDaFila([lead({ nicho: 'Padaria' }), lead({ nicho: 'Barbearia' }), lead({ nicho: 'Padaria' })])
  assert.deepEqual(o.nichos, ['Barbearia', 'Padaria'])
  assert.deepEqual(o.origens, ['automatico'])
  assert.equal(o.mostrarQualidadeDado, true)
  const vazio = opcoesDaFila([{ status: 'nao_iniciado' }])
  assert.equal(vazio.mostrarQualidadeDado, false)
  assert.deepEqual(vazio.nichos, [])
})

// --- Ordem, chips e limpeza ---------------------------------------------------------------
test('a ordem de prioridade vinda do servidor e preservada', () => {
  const a = lead({ campanha_lead_id: 'a' })
  const b = lead({ campanha_lead_id: 'b' })
  const c = lead({ campanha_lead_id: 'c' })
  assert.deepEqual(filtrarFila([a, b, c], { site: 'sem_site' }, AGORA).map((l) => l.campanha_lead_id), ['a', 'b', 'c'])
})

test('chips descrevem os filtros ativos e o contador bate', () => {
  const v = { ...VIEW_NEUTRA, site: 'sem_site', avalMin: '50', local: 'Feira', redes: 'com' }
  const chips = chipsAtivos(v)
  assert.equal(chips.length, 4)
  assert.equal(contarFiltrosAtivos(v), 4)
  assert.ok(chips.some((c) => /Sem site/i.test(c.label)))
  assert.ok(chips.some((c) => /50\+ avaliações/i.test(c.label)))
})

// --- Rascunho x aplicado (painel flutuante) ------------------------------------------------
test('viewsIguais compara o RECORTE, nao a referencia do objeto', () => {
  assert.equal(viewsIguais(VIEW_PADRAO, filaPadrao()), true)
  assert.equal(viewsIguais(VIEW_PADRAO, { ...VIEW_PADRAO }), true)
  // Campo ausente/lixo e' normalizado antes de comparar: rascunho parcial nao vira "diferente".
  assert.equal(viewsIguais(VIEW_PADRAO, { tentativas: 'nao_iniciados', site: 'inexistente' }), true)
  assert.equal(viewsIguais(VIEW_PADRAO, VIEW_NEUTRA), false)
  assert.equal(viewsIguais(VIEW_PADRAO, { ...VIEW_PADRAO, avalMin: '50' }), false)
})

test('a fila padrao NAO e a fila inteira — sao os dois estados de saida do painel', () => {
  assert.equal(viewsIguais(filaPadrao(), limparFiltros()), false)
})

test('limpar um chip zera so aquele grupo, para o estado neutro', () => {
  const v = { ...VIEW_PADRAO, site: 'sem_site', avalMin: '50', avalMax: '90' }
  const semAval = limparCampo(v, 'aval')
  assert.equal(semAval.avalMin, '')
  assert.equal(semAval.avalMax, '')
  assert.equal(semAval.site, 'sem_site')
  assert.equal(semAval.tentativas, 'nao_iniciados')
  // Remover o chip da fila padrao mostra tambem quem ja tem tentativa (fila de retentativa).
  assert.equal(limparCampo(v, 'tentativas').tentativas, 'todas')
})
