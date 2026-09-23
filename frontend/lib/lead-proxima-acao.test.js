const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { quandoEmTexto, cartaoCompromisso, resumoUltimaLigacao } = require('./lead-proxima-acao')

// 23/09/2026 12:00 em São Paulo.
const AGORA = new Date('2026-09-23T15:00:00.000Z')

test('quandoEmTexto escreve hoje/amanhã/ontem no fuso da operação', () => {
  assert.equal(quandoEmTexto('2026-09-23T17:30:00Z', AGORA), 'Hoje, 14:30')
  assert.equal(quandoEmTexto('2026-09-24T12:00:00Z', AGORA), 'Amanhã, 09:00')
  assert.equal(quandoEmTexto('2026-09-22T13:00:00Z', AGORA), 'Ontem, 10:00')
  assert.match(quandoEmTexto('2026-09-30T13:00:00Z', AGORA), /30\/09, 10:00$/)
  assert.equal(quandoEmTexto(null, AGORA), '')
  assert.equal(quandoEmTexto('lixo', AGORA), '')
})

test('follow-up atrasado carrega selo em TEXTO, não só cor', () => {
  const c = cartaoCompromisso({ tipo: 'follow_up', id: '1', canal: 'ligacao', titulo: 'Ligar novamente',
    quando: '2026-09-22T13:00:00Z', situacao: 'atrasado', observacao: null, responsavel_nome: 'Ana' }, AGORA)
  assert.equal(c.tipo, 'Follow-up por ligação')
  assert.equal(c.selo, 'Atrasado')
  assert.equal(c.detalhe, 'Responsável: Ana')
})

test('futuro no mesmo dia vira "Hoje"; sem data diz isso', () => {
  const hoje = cartaoCompromisso({ tipo: 'reuniao', tipo_agenda: 'reuniao', id: 'r', titulo: 'Reunião com X',
    quando: '2026-09-23T19:00:00Z', situacao: 'futuro' }, AGORA)
  assert.equal(hoje.situacao, 'hoje')
  assert.equal(hoje.selo, 'Hoje')
  const sem = cartaoCompromisso({ tipo: 'follow_up', id: 's', canal: 'whatsapp', titulo: 'Retomar', quando: null, situacao: 'sem_prazo' }, AGORA)
  assert.equal(sem.quando, 'Sem data definida')
  assert.equal(sem.selo, 'Sem data')
})

test('retorno na agenda é rotulado como tal; reunião do bot diz de onde veio', () => {
  assert.equal(cartaoCompromisso({ tipo: 'agenda', tipo_agenda: 'retorno', id: 'a', titulo: 'Ligar', quando: '2026-09-25T12:00:00Z', situacao: 'futuro' }, AGORA).tipo,
    'Retorno na agenda')
  assert.match(cartaoCompromisso({ tipo: 'reuniao', id: 'b', titulo: 'R', quando: '2026-09-25T12:00:00Z', situacao: 'futuro', origem: 'bot' }, AGORA).detalhe,
    /automático/)
})

test('resumo da última ligação', () => {
  assert.equal(resumoUltimaLigacao(null), null)
  const r = resumoUltimaLigacao({ id: 'l', resultado: 'nao_atendeu', quando: '2026-09-22T13:00:00Z', usuario_nome: 'Ana', notas: 'tentar à tarde' }, AGORA)
  assert.equal(r.texto, 'Não atendeu · Ontem, 10:00 · por Ana')
  assert.equal(r.notas, 'tentar à tarde')
})

test('guarda: o módulo não decide atraso comparando datas por conta própria', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'lead-proxima-acao.js'), 'utf8')
  assert.doesNotMatch(fonte, /getTime\(\)\s*<\s*agora|agendado_para|data_inicio/)
})
