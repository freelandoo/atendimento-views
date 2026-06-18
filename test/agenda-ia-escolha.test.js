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
  // horario "7:30" da noite -> normaliza p/ 19:30 (mesma heuristica do parser)
  const so = normalizarReuniaoEscolha({ horario: '7:30' })
  assert.equal(so.horario, '19:30')
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

test('validarSlotReuniao: rejeita horario fora da janela padrao (sem tocar no banco)', async () => {
  assert.equal(await validarSlotReuniao({ data: '2026-06-05', horario: '22:00' }), false)
  assert.equal(await validarSlotReuniao({ data: '2026-06-05', horario: '' }), false)
  assert.equal(await validarSlotReuniao({ data: 'amanha', horario: '19:30' }), false)
})

test('validarSlotReuniao: rejeita domingo e horario fora da grade do dia (sem tocar no banco)', async () => {
  // 2026-06-06 = sabado (grade de DIA 08:00–20:30, passos de 30min), 2026-06-07 = domingo
  assert.equal(await validarSlotReuniao({ data: '2026-06-07', horario: '20:00' }), false) // domingo nao atende
  assert.equal(await validarSlotReuniao({ data: '2026-06-06', horario: '19:45' }), false) // sabado e grade de 30min (:45 nao existe)
  assert.equal(await validarSlotReuniao({ data: '2026-06-06', horario: '21:00' }), false) // alem do ultimo inicio do sabado (20:30)
})

test('horarios de reuniao: sabado tem janela de dia (08:00–20:30); domingo nao atende', () => {
  const { horariosPadraoParaWeekday, diaAtendeReuniao } = require('../src/date-utils')
  const sab = horariosPadraoParaWeekday(6)
  assert.ok(sab.includes('08:00') && sab.includes('20:30'), 'sabado deve cobrir 08:00 ate 20:30')
  assert.ok(!sab.includes('21:00'), 'ultimo inicio do sabado e 20:30')
  assert.deepEqual(horariosPadraoParaWeekday(0), [], 'domingo nao tem horarios')
  assert.ok(horariosPadraoParaWeekday(3).includes('19:30'), 'dia util mantem a noite')
  assert.equal(diaAtendeReuniao(6), true)
  assert.equal(diaAtendeReuniao(0), false)
})

test('dias candidatos: sabado entra na semana com janela de dia', () => {
  // 2026-06-10 = quarta; os proximos dias incluem o sabado 06-13 com horario de dia.
  const dias = montarDiasCandidatos(new Date('2026-06-10T15:00:00Z'), 7, true)
  const sab = dias.find((d) => d.label === 'sabado')
  assert.ok(sab, 'sabado deve estar entre os dias candidatos')
  assert.ok(sab.candidatos.includes('08:00') && sab.candidatos.includes('14:00'))
})

test('dias candidatos: dia util a tarde OFERECE HOJE (sem o antigo portao das 18:30)', () => {
  // 2026-06-04T17:00Z = quinta 14:00 BRT — antes pulava para amanha; agora hoje
  // entra com os horarios da noite (19:30+ estao a >60min).
  const dias = montarDiasCandidatos(new Date('2026-06-04T17:00:00Z'), 7, true)
  assert.equal(dias[0].label, 'hoje')
  assert.ok(dias[0].candidatos.includes('19:30'))
  assert.ok(dias[0].candidatos.includes('21:15'))
})

test('dias candidatos: tarde da noite sem antecedencia rola para o proximo dia util', () => {
  // 2026-06-05T23:50Z = sexta 20:50 BRT — nao ha slot com 60min de antecedencia
  // hoje (ultimo e 21:15), entao o primeiro candidato e o proximo dia util.
  const dias = montarDiasCandidatos(new Date('2026-06-05T23:50:00Z'), 7, true)
  assert.notEqual(dias[0].label, 'hoje')
})

const { slotsLivresDoDia, REUNIAO_BUFFER_MINUTOS } = require('../src/agenda')
const { utcParaDataLocalEmTimezone } = require('../src/date-utils')

test('buffer de 30min entre reuniões: bloqueia slots a menos de 30min de uma reunião', () => {
  assert.equal(REUNIAO_BUFFER_MINUTOS, 30)
  const di = utcParaDataLocalEmTimezone({ year: 2026, month: 6, day: 8, hour: 20, minute: 0 }, 'America/Sao_Paulo')
  const df = new Date(di.getTime() + 15 * 60 * 1000)
  const eventos = [{ data_inicio: di, data_fim: df }]
  const cands = ['19:30', '19:45', '20:00', '20:15', '20:30', '20:45', '21:00', '21:15']
  const livres = slotsLivresDoDia('2026-06-08', cands, eventos, 15)
  // Reunião 20:00–20:15 + buffer 30 → livre só a partir de 20:45 (e nada perto antes).
  assert.deepEqual(livres, ['20:45', '21:00', '21:15'])
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
