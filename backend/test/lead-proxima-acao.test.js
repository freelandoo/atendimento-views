'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { montarProximaAcao, TIPO, MAX_NOTA } = require('../src/services/lead-proxima-acao')

const AGORA = new Date('2026-09-23T15:00:00.000Z')

test('sem compromisso nenhum: principal nulo e lista vazia (a ficha cai na faixa da fila)', () => {
  const r = montarProximaAcao({ agora: AGORA })
  assert.equal(r.principal, null)
  assert.deepEqual(r.compromissos, [])
  assert.equal(r.ultima_ligacao, null)
})

test('follow-up vencido vem antes de reunião futura — a ordem é o prazo', () => {
  const r = montarProximaAcao({
    agora: AGORA,
    followUps: [{ id: 'f1', canal: 'ligacao', proxima_acao: 'Ligar novamente', agendado_para: '2026-09-22T12:00:00Z' }],
    reunioes: [{ id: 'r1', tipo: 'reuniao', titulo: 'Reunião com X', data_inicio: '2026-09-24T13:00:00Z', data_fim: '2026-09-24T13:30:00Z' }],
  })
  assert.equal(r.principal.tipo, TIPO.FOLLOW_UP)
  assert.equal(r.principal.situacao, 'atrasado')
  assert.equal(r.principal.titulo, 'Ligar novamente')
  assert.equal(r.compromissos[1].tipo, TIPO.REUNIAO)
  assert.equal(r.compromissos[1].situacao, 'futuro')
})

test('reunião que já começou e não terminou é "em curso", não atraso', () => {
  const r = montarProximaAcao({
    agora: AGORA,
    reunioes: [{ id: 'r1', tipo: 'reuniao', titulo: 'R', data_inicio: '2026-09-23T14:50:00Z', data_fim: '2026-09-23T15:20:00Z' }],
  })
  assert.equal(r.principal.situacao, 'em_curso')
})

test('retorno/tarefa da agenda viram tipo "agenda", não reunião', () => {
  const r = montarProximaAcao({
    agora: AGORA,
    reunioes: [{ id: 'a1', tipo: 'retorno', titulo: '', data_inicio: '2026-09-24T13:00:00Z', data_fim: '2026-09-24T13:30:00Z' }],
  })
  assert.equal(r.principal.tipo, TIPO.AGENDA)
  assert.equal(r.principal.tipo_agenda, 'retorno')
  assert.equal(r.principal.titulo, 'Compromisso')
})

test('follow-up sem prazo vai para o fim da lista', () => {
  const r = montarProximaAcao({
    agora: AGORA,
    followUps: [
      { id: 'sem', canal: 'whatsapp', proxima_acao: 'A', agendado_para: null },
      { id: 'com', canal: 'whatsapp', proxima_acao: 'B', agendado_para: '2026-09-30T12:00:00Z' },
    ],
  })
  assert.deepEqual(r.compromissos.map((c) => c.id), ['com', 'sem'])
  assert.equal(r.compromissos[1].situacao, 'sem_prazo')
})

test('notas longas são cortadas e a última ligação é traduzida', () => {
  const r = montarProximaAcao({
    agora: AGORA,
    ultimaLigacao: { id: 'l1', resultado: 'nao_atendeu', notas: 'x'.repeat(500), encerrada_em: '2026-09-22T10:00:00Z', usuario_nome: 'Ana' },
  })
  assert.equal(r.ultima_ligacao.resultado, 'nao_atendeu')
  assert.equal(r.ultima_ligacao.notas.length, MAX_NOTA)
  assert.equal(r.ultima_ligacao.quando, '2026-09-22T10:00:00.000Z')
})

test('guarda: a leitura da próxima ação NÃO escreve nada', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/db/lead-proxima-acao.js'), 'utf8')
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/)
})

test('guarda: a rota repete o recorte do lead antes de ler', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/api-banco-leads.js'), 'utf8')
  const i = src.indexOf("router.get('/leads/:id/proxima-acao'")
  assert.ok(i > 0, 'rota existe')
  const bloco = src.slice(i, src.indexOf('})', i))
  assert.match(bloco, /exigirLeadNoRecorte\(req\)/)
  assert.doesNotMatch(bloco, /requireCapacidade/)
})
