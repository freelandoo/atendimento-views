'use strict'

// Agenda por IA: a LLM captura a escolha do lead no JSON (reuniao_escolha) e o
// codigo valida contra os slots reais antes de agendar. Aqui cobrimos o parser
// (normalizarReuniaoEscolha) e a nao-interferencia do orquestrador quando o lead
// responde em linguagem natural (sem horario explicito) — caso em que a captura
// via JSON entra no lugar do regex.

const test = require('node:test')
const assert = require('node:assert')

const { normalizarReuniaoEscolha } = require('../src/agent')
const { decidirProximaAcao } = require('../src/next-action-orchestrator')
const { validarSlotReuniao, montarDiasCandidatos } = require('../src/agenda')

test('normalizarReuniaoEscolha: aceita {data,horario} validos e normaliza o horario', () => {
  assert.deepEqual(
    normalizarReuniaoEscolha({ data: '2026-06-05', horario: '19:30' }),
    { data: '2026-06-05', horario: '19:30' }
  )
  // "7:30" agora e horario literal da manha: a janela de reuniao comeca as 07:00.
  const so = normalizarReuniaoEscolha({ horario: '7:30' })
  assert.equal(so.horario, '07:30')
  assert.equal(so.data, null)
})

test('normalizarReuniaoEscolha: rejeita shapes invalidos', () => {
  assert.equal(normalizarReuniaoEscolha(null), null)
  assert.equal(normalizarReuniaoEscolha({}), null)
  assert.equal(normalizarReuniaoEscolha({ horario: '' }), null)
  assert.equal(normalizarReuniaoEscolha('19:30'), null)
  assert.equal(normalizarReuniaoEscolha({ data: 'amanha' }), null)
})

test('orquestrador NAO captura escolha em linguagem natural (deixa para a IA/JSON)', () => {
  const perfil = {
    reuniao_proposta: {
      necessaria: true,
      data_sugerida: '2026-06-05',
      horarios_sugeridos: ['19:30', '20:00'],
      horario_confirmado: null,
    },
  }
  const d = decidirProximaAcao({
    mensagemAtual: 'pode ser o primeiro',
    historico: [
      { role: 'assistant', content: 'Tenho amanhã às 19:30 ou às 20:00. Qual fica melhor?' },
      { role: 'user', content: 'pode ser o primeiro' },
    ],
    perfil,
    etapaAtual: 'agendamento_pendente',
  })
  // sem horario explicito, o regex nao deve "confirmar" — cai na LLM, que captura
  // a escolha via reuniao_escolha no JSON e o codigo valida/agenda.
  assert.notEqual(d.acao_decidida, 'confirmacao_reuniao')
})

test('validarSlotReuniao: rejeita madrugada fora da janela padrao (sem tocar no banco)', async () => {
  assert.equal(await validarSlotReuniao({ data: '2026-06-05', horario: '06:45' }), false)
  assert.equal(await validarSlotReuniao({ data: '2026-06-05', horario: '00:00' }), false)
  assert.equal(await validarSlotReuniao({ data: '2026-06-05', horario: '' }), false)
  assert.equal(await validarSlotReuniao({ data: 'amanha', horario: '19:30' }), false)
})

test('validarSlotReuniao: rejeita horario fora da grade de 15 min (sem tocar no banco)', async () => {
  assert.equal(await validarSlotReuniao({ data: '2026-06-06', horario: '07:10' }), false)
  assert.equal(await validarSlotReuniao({ data: '2026-06-06', horario: '24:00' }), false)
})

test('horarios de reuniao: todos os dias vao de 07:00 ate 23:45', () => {
  const { horariosPadraoParaWeekday, diaAtendeReuniao } = require('../src/date-utils')
  const sab = horariosPadraoParaWeekday(6)
  assert.ok(sab.includes('07:00') && sab.includes('23:45'), 'sabado deve cobrir 07:00 ate 23:45')
  assert.ok(!sab.includes('06:45'), 'madrugada antes de 07:00 nao entra')
  assert.ok(horariosPadraoParaWeekday(0).includes('22:00'), 'domingo tambem aceita reuniao')
  assert.ok(horariosPadraoParaWeekday(3).includes('17:30'), 'dia util nao para no fim da tarde')
  assert.equal(diaAtendeReuniao(6), true)
  assert.equal(diaAtendeReuniao(0), true)
})

test('dias candidatos: sabado entra na semana com a mesma janela ampla', () => {
  // 2026-06-10 = quarta; os proximos dias incluem o sabado 06-13.
  const dias = montarDiasCandidatos(new Date('2026-06-10T15:00:00Z'), 7, true)
  const sab = dias.find((d) => d.label === 'sabado')
  assert.ok(sab, 'sabado deve estar entre os dias candidatos')
  assert.ok(sab.candidatos.includes('07:00') && sab.candidatos.includes('22:00'))
})

test('dias candidatos: dia util a tarde OFERECE HOJE com a janela ampla', () => {
  // 2026-06-04T17:00Z = quinta 14:00 BRT — hoje ainda tem tarde e noite disponiveis.
  const dias = montarDiasCandidatos(new Date('2026-06-04T17:00:00Z'), 7, true)
  assert.equal(dias[0].label, 'hoje')
  assert.ok(dias[0].candidatos.includes('15:00'))
  assert.ok(dias[0].candidatos.includes('23:45'))
})

test('dias candidatos: perto da meia-noite sem antecedencia rola para amanha', () => {
  // 2026-06-06T02:30Z = sexta 23:30 BRT — nao ha slot com 60min de antecedencia.
  const dias = montarDiasCandidatos(new Date('2026-06-06T02:30:00Z'), 7, true)
  assert.notEqual(dias[0].label, 'hoje')
})

const { slotsLivresDoDia, REUNIAO_BUFFER_MINUTOS } = require('../src/agenda')
const { utcParaDataLocalEmTimezone } = require('../src/date-utils')

test('buffer entre reuniões: bloqueia slots a menos da folga de uma reunião', () => {
  // A folga passou a ser a MESMA da agenda da tela (services/agenda-slots.js). Com 2h, uma
  // reunião marcada apaga os slots proximos dela, mas a janela ampla ainda pode ter horarios
  // antes/depois da folga.
  assert.equal(REUNIAO_BUFFER_MINUTOS, 120)
  const di = utcParaDataLocalEmTimezone({ year: 2026, month: 6, day: 8, hour: 20, minute: 0 }, 'America/Sao_Paulo')
  const df = new Date(di.getTime() + 15 * 60 * 1000)
  const eventos = [{ data_inicio: di, data_fim: df }]
  const cands = ['19:30', '19:45', '20:00', '20:15', '20:30', '20:45', '21:00', '21:15']
  const livres = slotsLivresDoDia('2026-06-08', cands, eventos, 15)
  // Reunião 20:00–20:15 + folga de 2h → nada mais cabe na janela da noite daquele dia.
  assert.deepEqual(livres, [])

  // O dia SEGUINTE continua inteiro: a folga não atravessa dias.
  assert.deepEqual(slotsLivresDoDia('2026-06-09', cands, eventos, 15), cands)
})

const { mesclarInsightsLead } = require('../src/core-funnel')

test('mesclarInsightsLead: acumula arrays (dedup), nao apaga escalar com null, extrai score_lead', () => {
  const atual = { origem_clientes: 'indicacao', concorrentes_mencionados: ['A'], objecoes: ['preco'] }
  const novo = {
    score: 72, origem_clientes: null, urgencia: 'alta', prazo: 'essa semana',
    orcamento_mencionado: 'ate 1000', eh_decisor: 'sim',
    concorrentes_mencionados: ['A', 'B'], sinais_compra: ['quer comecar'],
    objecoes: ['preco', 'prazo'], observacao_curta: 'pintor querendo site',
  }
  const patch = mesclarInsightsLead(atual, novo)
  assert.equal(patch.score_lead, 72)
  assert.equal(patch.insights_lead.origem_clientes, 'indicacao') // novo null nao apaga
  assert.equal(patch.insights_lead.urgencia, 'alta')
  assert.equal(patch.insights_lead.eh_decisor, 'sim')
  assert.deepEqual(patch.insights_lead.concorrentes_mencionados, ['A', 'B']) // uniao + dedup
  assert.deepEqual(patch.insights_lead.objecoes, ['preco', 'prazo'])
})

test('mesclarInsightsLead: null sem novo; score<=0 nao grava; enum invalido ignorado', () => {
  assert.equal(mesclarInsightsLead({}, null), null)
  const p = mesclarInsightsLead({}, { score: 0, urgencia: 'qualquer', observacao_curta: 'x' })
  assert.equal(p.score_lead, undefined)
  assert.equal(p.insights_lead.observacao_curta, 'x')
  assert.equal(p.insights_lead.urgencia, undefined) // enum invalido nao entra
})
