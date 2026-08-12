'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  montarFila,
  aplicarFiltroRapido,
  aplicarAvancado,
  contagensRapidas,
  contarFiltrosAtivos,
  chipsAtivos,
  opcoesDeAcao,
  resumoFila,
  descricaoPrioridade,
  filtroRapidoValido,
  FILTROS_RAPIDOS,
  nomeDeVerdade,
  formatarTelefone,
  rotuloLead,
  paginar,
  resumoIntervalo,
  POR_PAGINA_PADRAO,
} = require('./followups-fila')

const AGORA = new Date('2026-08-08T15:00:00')

const humano = (extra = {}) => ({
  numero: '5511999990001@s.whatsapp.net',
  telefone_digitos: '5511999990001',
  nome: 'Padaria do Zé',
  negocio: 'Padaria do Zé',
  cidade: 'Santo André',
  estagio: 'negociacao',
  dias_silencio: 4,
  score: 78,
  temperatura: 'quente',
  motivo: 'pediu preco e sumiu',
  motivos: [],
  followups_ignorados: 2,
  escalado: true,
  acao_recomendada: 'ligar',
  acao_label: 'Ligar',
  janela_recomendada: 'Agora — ligar até 17h',
  janela_quando: 'agora',
  orientacao: 'Ligue para destravar.',
  prompt_preview: null,
  ...extra,
})

const auto = (extra = {}) => ({
  id: 1,
  numero: '5511999990002@s.whatsapp.net',
  sequencia: 1,
  status: 'agendado',
  agendado_para: '2026-08-08T18:00:00',
  executado_em: null,
  cancelado_em: null,
  motivo_decisao: null,
  detectado_em: '2026-08-07T10:00:00',
  estagio: 'diagnostico',
  nome: 'Studio Ana',
  ...extra,
})

test('fila junta as duas fontes numa linha por conversa', () => {
  const itens = montarFila({ humanos: [humano()], automaticos: [auto()], agora: AGORA })
  assert.equal(itens.length, 2)
  assert.deepEqual(itens.map((i) => i.origem_label), ['Humano', 'IA'])
})

test('acao humana e a proxima acao da conversa; o automatico vira contexto da MESMA linha', () => {
  const numero = '5511999990001@s.whatsapp.net'
  const itens = montarFila({
    humanos: [humano()],
    automaticos: [auto({ id: 9, numero, sequencia: 3, agendado_para: '2026-08-09T09:00:00' })],
    agora: AGORA,
  })
  assert.equal(itens.length, 1, 'nao pode duplicar a conversa em duas linhas')
  const item = itens[0]
  assert.equal(item.acao, 'ligar')
  assert.equal(item.humano, true)
  assert.equal(item.ia_agendada, true)
  assert.equal(item.origem_label, 'Humano + IA')
  assert.equal(item.ia_status, 'agendado')
  assert.equal(item.tentativas, 3)
  // Aparece nos DOIS filtros de origem — e verdade, nao duplicidade.
  assert.equal(aplicarFiltroRapido(itens, 'humano').length, 1)
  assert.equal(aplicarFiltroRapido(itens, 'ia').length, 1)
})

test('localizacao da fila e SO a cidade, mesmo quando nome e negocio sao o mesmo texto', () => {
  // Fixture `humano()` tem nome === negocio ('Padaria do Zé') — exatamente o caso relatado:
  // sem apelido, o rotulo (linha principal) nasce do negocio. A linha secundaria nao pode
  // repetir esse mesmo texto; so a cidade.
  const [item] = montarFila({ humanos: [humano()], agora: AGORA })
  assert.equal(item.rotulo, 'Padaria do Zé')
  assert.equal(item.localizacao, 'Santo André')
  assert.ok(!String(item.localizacao).includes('Padaria'), 'localizacao nao repete o negocio')
  // `contexto` (busca da fila) continua com negocio+cidade — nao foi removido, so deixou de
  // ser o que a LINHA mostra.
  assert.equal(item.contexto, 'Padaria do Zé · Santo André')
})

test('localizacao fica null quando nao ha cidade conhecida (sem inventar dado)', () => {
  const [item] = montarFila({ humanos: [humano({ cidade: null })], agora: AGORA })
  assert.equal(item.localizacao, null)
})

test('item so do automatico nao tem localizacao (fonte nao traz cidade)', () => {
  const [item] = montarFila({ automaticos: [auto()], agora: AGORA })
  assert.equal(item.localizacao, null)
})

test('item so do automatico NAO recebe prioridade inventada', () => {
  const [item] = montarFila({ automaticos: [auto()], agora: AGORA })
  assert.equal(item.prioridade, null)
  assert.equal(item.prioridade_score, null)
  assert.match(descricaoPrioridade(item), /não calculada/)
})

test('prioridade do item humano traduz a temperatura do backend', () => {
  const itens = montarFila({
    humanos: [humano(), humano({ numero: 'b', temperatura: 'morno', score: 42 }), humano({ numero: 'c', temperatura: 'frio', score: 12 })],
    agora: AGORA,
  })
  assert.deepEqual(itens.map((i) => i.prioridade), ['alta', 'media', 'baixa'])
  assert.match(descricaoPrioridade(itens[0]), /alta \(78 de 100\)/)
})

test('"Todos" mostra so o que esta em aberto — concluido, cancelado e falha ficam nos proprios filtros', () => {
  const itens = montarFila({
    humanos: [humano()],
    automaticos: [
      auto({ id: 2, numero: 'a', status: 'agendado' }),
      auto({ id: 3, numero: 'b', status: 'executado', executado_em: '2026-08-01T10:00:00' }),
      auto({ id: 4, numero: 'c', status: 'falhou', motivo_decisao: 'IA sem credito' }),
      auto({ id: 5, numero: 'd', status: 'cancelado', cancelado_em: '2026-08-02T10:00:00' }),
    ],
    agora: AGORA,
  })
  const c = contagensRapidas(itens)
  assert.equal(c.todos, 2, 'humano em aberto + 1 agendado')
  assert.equal(c.aguardando, 1)
  assert.equal(c.falhas, 1)
  assert.equal(c.concluidos, 1)
  assert.equal(aplicarFiltroRapido(itens, 'todos').some((i) => i.situacao === 'cancelado'), false)
})

test('"Proxima acao hoje" cobre vencido, agora e ainda hoje — e ignora o futuro', () => {
  const itens = montarFila({
    humanos: [
      humano({ numero: 'agora', janela_quando: 'agora' }),
      humano({ numero: 'amanha', janela_quando: 'proximo_dia_util' }),
    ],
    automaticos: [
      auto({ id: 6, numero: 'atrasado', agendado_para: '2026-08-08T09:00:00' }),
      auto({ id: 7, numero: 'hoje', agendado_para: '2026-08-08T22:00:00' }),
      auto({ id: 8, numero: 'depois', agendado_para: '2026-08-20T09:00:00' }),
    ],
    agora: AGORA,
  })
  const hoje = aplicarFiltroRapido(itens, 'hoje').map((i) => i.numero).sort()
  assert.deepEqual(hoje, ['agora', 'atrasado', 'hoje'])
})

test('follow-up ja enviado no passado nao vira "atrasado"', () => {
  const [item] = montarFila({
    automaticos: [auto({ status: 'executado', executado_em: '2026-07-01T10:00:00' })],
    agora: AGORA,
  })
  assert.equal(item.prazo_quando, 'passado')
})

test('falha de qualquer agendamento da conversa continua no filtro Falhas', () => {
  const numero = 'x'
  const itens = montarFila({
    automaticos: [
      auto({ id: 10, numero, status: 'falhou', sequencia: 1, motivo_decisao: 'Evolution 401' }),
      auto({ id: 11, numero, status: 'agendado', sequencia: 2 }),
    ],
    agora: AGORA,
  })
  assert.equal(itens.length, 1, 'a conversa continua sendo uma linha so')
  assert.equal(itens[0].situacao, 'aguardando', 'a nova tentativa e o estado atual')
  assert.equal(itens[0].tem_falha, true)
  assert.equal(itens[0].falha_motivo, 'Evolution 401')
  assert.equal(aplicarFiltroRapido(itens, 'falhas').length, 1)
})

test('ordem da fila: trabalho humano antes do agendado, urgencia antes de score', () => {
  const itens = montarFila({
    humanos: [
      humano({ numero: 'frio', temperatura: 'frio', score: 10, janela_quando: 'agora' }),
      humano({ numero: 'quente-amanha', temperatura: 'quente', score: 95, janela_quando: 'proximo_dia_util' }),
    ],
    automaticos: [auto({ id: 12, numero: 'agendado' })],
    agora: AGORA,
  })
  assert.deepEqual(itens.map((i) => i.numero), ['frio', 'quente-amanha', 'agendado'])
})

test('filtro avancado COMPOE com o rapido e nao o substitui', () => {
  const itens = montarFila({
    humanos: [humano(), humano({ numero: 'b', acao_recomendada: 'assumir_conversa', acao_label: 'Assumir conversa' })],
    automaticos: [auto()],
    agora: AGORA,
  })
  const avancado = aplicarAvancado(itens, { acao: 'ligar' })
  assert.equal(avancado.length, 1)
  assert.equal(aplicarFiltroRapido(avancado, 'humano').length, 1)
  assert.equal(aplicarFiltroRapido(avancado, 'ia').length, 0)
})

test('periodo alcanca so item com data real; item sem data sai do resultado', () => {
  const itens = montarFila({
    humanos: [humano()],
    automaticos: [auto({ id: 13, numero: 'z', agendado_para: '2026-08-08T18:00:00' })],
    agora: AGORA,
  })
  const noDia = aplicarAvancado(itens, { dataDe: '2026-08-08', dataAte: '2026-08-08' })
  assert.deepEqual(noDia.map((i) => i.numero), ['z'])
  assert.equal(aplicarAvancado(itens, { dataDe: '2026-09-01' }).length, 0)
})

test('na linha mesclada, o periodo enxerga a data agendada do automatico', () => {
  const numero = '5511999990001@s.whatsapp.net'
  const itens = montarFila({
    humanos: [humano()],
    automaticos: [auto({ id: 16, numero, agendado_para: '2026-08-10T09:00:00' })],
    agora: AGORA,
  })
  assert.equal(itens[0].prazo, null, 'a proxima acao e humana: nao tem data')
  assert.equal(aplicarAvancado(itens, { dataDe: '2026-08-10', dataAte: '2026-08-10' }).length, 1)
  assert.equal(aplicarAvancado(itens, { dataDe: '2026-08-11' }).length, 0)
})

test('busca aceita nome e telefone; prioridade "sem" acha o que nao tem call score', () => {
  const itens = montarFila({ humanos: [humano()], automaticos: [auto()], agora: AGORA })
  assert.equal(aplicarAvancado(itens, { busca: 'padaria' }).length, 1)
  assert.equal(aplicarAvancado(itens, { busca: '999990001' }).length, 1)
  // Dois digitos casariam com quase todo telefone: abaixo de 3 a busca numerica nao vale.
  assert.equal(aplicarAvancado(itens, { busca: '99' }).length, 0)
  assert.equal(aplicarAvancado(itens, { prioridade: 'sem' })[0].origem_label, 'IA')
})

test('tentativas e motivo de falha filtram pelo dado real', () => {
  const itens = montarFila({
    automaticos: [
      auto({ id: 14, numero: 'a', sequencia: 3, status: 'falhou', motivo_decisao: 'IA sem credito' }),
      auto({ id: 15, numero: 'b', sequencia: 1 }),
    ],
    agora: AGORA,
  })
  assert.deepEqual(aplicarAvancado(itens, { tentativasMin: '3' }).map((i) => i.numero), ['a'])
  assert.deepEqual(aplicarAvancado(itens, { falhaTexto: 'credito' }).map((i) => i.numero), ['a'])
})

test('chips, contagem de filtros ativos e opcoes de acao descrevem o estado real', () => {
  const view = { acao: 'ligar', prioridade: 'sem', dataDe: '2026-08-01' }
  assert.equal(contarFiltrosAtivos(view), 3)
  const chips = chipsAtivos(view, { ligar: 'Ligar' })
  assert.deepEqual(chips, ['Ação: Ligar', 'Prioridade: não calculada', 'Prazo de 2026-08-01'])
  assert.equal(contarFiltrosAtivos({}), 0)

  const itens = montarFila({ humanos: [humano()], automaticos: [auto()], agora: AGORA })
  assert.deepEqual(opcoesDeAcao(itens), [
    { valor: 'aguardar_envio_ia', label: 'Aguardar envio automático' },
    { valor: 'ligar', label: 'Ligar' },
  ])
})

test('resumo do cabecalho nunca inventa numero', () => {
  assert.match(resumoFila({ todos: 0, hoje: 0 }), /Nada em aberto/)
  assert.match(resumoFila({ todos: 1, hoje: 0 }), /1 item em aberto/)
  assert.match(resumoFila({ todos: 5, hoje: 2 }), /5 itens em aberto · 2 com prazo para hoje/)
  assert.match(resumoFila(null), /Nada em aberto/)
})

test('filtro rapido desconhecido cai em "todos" (nunca lista vazia por engano)', () => {
  assert.equal(filtroRapidoValido('inexistente'), 'todos')
  assert.equal(filtroRapidoValido(null), 'todos')
  assert.equal(FILTROS_RAPIDOS.every((f) => typeof f.descricao === 'string' && f.descricao), true)
})

test('entrada vazia ou malformada nao quebra a fila', () => {
  assert.deepEqual(montarFila(), [])
  assert.deepEqual(montarFila({ humanos: null, automaticos: undefined }), [])
  assert.deepEqual(montarFila({ humanos: [{ nome: 'sem numero' }] }), [])
})

// ── Rotulo do lead: nenhum identificador tecnico do Evolution chega a tela ──────────

test('identificador do Evolution NUNCA vira nome de lead', () => {
  assert.equal(nomeDeVerdade('5511999990001@s.whatsapp.net'), null)
  assert.equal(nomeDeVerdade('5511999990001@lid'), null)
  assert.equal(nomeDeVerdade('5511999990001'), null) // telefone tambem nao e nome
  assert.equal(nomeDeVerdade('+55 11 99999-0001'), null)
  assert.equal(nomeDeVerdade(''), null)
  assert.equal(nomeDeVerdade(null), null)
  assert.equal(nomeDeVerdade('  Padaria do Zé '), 'Padaria do Zé')
})

test('sem nome, a linha mostra o telefone formatado — nunca o JID', () => {
  const semNome = montarFila({ humanos: [humano({ nome: null })], agora: AGORA })[0]
  assert.equal(semNome.nome, null)
  assert.equal(semNome.rotulo, '(11) 99999-0001')
  assert.equal(semNome.rotulo.includes('@'), false)

  // Linha antiga que ainda traz o JID no campo `nome` e' saneada na entrada.
  const legado = montarFila({ humanos: [humano({ nome: '5511999990001@s.whatsapp.net' })], agora: AGORA })[0]
  assert.equal(legado.nome, null)
  assert.equal(legado.rotulo, '(11) 99999-0001')

  // Item vindo so do automatico segue a mesma regra.
  const ia = montarFila({ automaticos: [auto({ nome: null })], agora: AGORA })[0]
  assert.equal(ia.rotulo, '(11) 99999-0002')
})

test('com nome de negocio, o rotulo e o nome (o telefone fica so como contato)', () => {
  const item = montarFila({ humanos: [humano()], agora: AGORA })[0]
  assert.equal(item.nome, 'Padaria do Zé')
  assert.equal(item.rotulo, 'Padaria do Zé')
})

test('formatarTelefone tolera 55, 10 e 11 digitos e nao inventa formato', () => {
  assert.equal(formatarTelefone('5511999990001'), '(11) 99999-0001')
  assert.equal(formatarTelefone('11999990001'), '(11) 99999-0001')
  assert.equal(formatarTelefone('1133330001'), '(11) 3333-0001')
  assert.equal(formatarTelefone('123'), '123') // curto demais: devolve os digitos, sem mascara falsa
  assert.equal(formatarTelefone(''), '')
})

test('a busca da fila enxerga o rotulo visivel, inclusive quando ele e o telefone', () => {
  const fila = montarFila({ humanos: [humano({ nome: null, negocio: null, cidade: null })], agora: AGORA })
  assert.equal(fila[0].rotulo, '(11) 99999-0001')
  // Casa pelo trecho do telefone e tambem pelo rotulo formatado que esta na tela.
  assert.equal(aplicarAvancado(fila, { busca: '99999' }).length, 1)
  assert.equal(aplicarAvancado(fila, { busca: '(11) 99999' }).length, 1)
  assert.equal(aplicarAvancado(fila, { busca: 'Padaria' }).length, 0)
})

test('rotuloLead nao quebra com entrada vazia', () => {
  assert.equal(rotuloLead(null), '')
  assert.equal(rotuloLead({}), '')
})

// ── Paginacao: reuso do mesmo modulo da Aquisicao e da Central de Ligacoes ─────────

test('a fila pagina de 25 em 25 sobre o conjunto JA filtrado', () => {
  assert.equal(POR_PAGINA_PADRAO, 25)
  const humanos = Array.from({ length: 60 }, (_, i) => humano({
    numero: `55119999${String(i).padStart(5, '0')}@s.whatsapp.net`,
    telefone_digitos: `55119999${String(i).padStart(5, '0')}`,
    nome: `Lead ${String(i).padStart(2, '0')}`,
  }))
  const fila = montarFila({ humanos, agora: AGORA })
  assert.equal(fila.length, 60)

  const p1 = paginar(fila, 1, POR_PAGINA_PADRAO)
  assert.equal(p1.itens.length, 25)
  assert.equal(p1.temAnterior, false)
  assert.equal(p1.temProxima, true)
  assert.equal(resumoIntervalo(p1, { singular: 'follow-up', plural: 'follow-ups' }), 'Exibindo 1–25 de 60 follow-ups')

  const p3 = paginar(fila, 3, POR_PAGINA_PADRAO)
  assert.equal(p3.itens.length, 10)
  assert.equal(p3.temProxima, false)
  assert.equal(resumoIntervalo(p3, { singular: 'follow-up', plural: 'follow-ups' }), 'Exibindo 51–60 de 60 follow-ups')

  // A pagina e' clampada: filtrar ate sobrar pouco nunca deixa uma janela vazia.
  const encolhida = paginar(fila.slice(0, 3), 3, POR_PAGINA_PADRAO)
  assert.equal(encolhida.pagina, 1)
  assert.equal(encolhida.itens.length, 3)
})
