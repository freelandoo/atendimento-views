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
