'use strict'

// Bloqueio de agenda que vale para o BOT (migration 090) + grade de horarios da tela.
//
// O defeito que estes testes protegem: o bot oferece horario lendo `vendas.agenda_eventos` e a
// tela grava em `app.agenda_eventos`. Sem o espelho, bloquear a agenda pela tela nao tem efeito
// nenhum sobre quem marca pelo WhatsApp.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const slots = require('../src/services/agenda-slots')
const espelho = require('../src/services/agenda-espelho')

const SRC = path.join(__dirname, '..', 'src')
const fonte = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

// Instante fake em UTC: os testes da grade nao dependem de fuso real, so' de ordem.
const paraInstante = (dia, hhmm) => new Date(`${dia}T${hhmm}:00.000Z`)

// ─── gerarGrade ──────────────────────────────────────────────────────────────────────────

test('gerarGrade produz os horarios da janela no passo pedido', () => {
  const g = slots.gerarGrade({ horaInicio: '08:00', horaFim: '10:00', duracaoMin: 30 })
  assert.deepEqual(g, ['08:00', '08:30', '09:00', '09:30'])
})

test('gerarGrade nao oferece slot que estoura a janela', () => {
  // Um slot de 45 min comecando 09:30 terminaria 10:15 — fora da janela. Oferece-lo prometeria
  // um horario que a janela nao tem.
  const g = slots.gerarGrade({ horaInicio: '09:00', horaFim: '10:00', duracaoMin: 45 })
  assert.deepEqual(g, ['09:00'])
})

test('gerarGrade devolve vazio para janela invertida ou invalida', () => {
  assert.deepEqual(slots.gerarGrade({ horaInicio: '18:00', horaFim: '08:00', duracaoMin: 30 }), [])
  assert.deepEqual(slots.gerarGrade({ horaInicio: 'xx', horaFim: '10:00', duracaoMin: 30 }), [])
})

// ─── marcarDisponibilidade ───────────────────────────────────────────────────────────────

test('slot sem evento fica livre; slot sobreposto fica ocupado', () => {
  const r = slots.marcarDisponibilidade({
    data: '2026-10-05',
    candidatos: ['08:00', '08:30', '09:00'],
    eventos: [{ data_inicio: '2026-10-05T08:30:00Z', data_fim: '2026-10-05T09:00:00Z', tipo: 'reuniao', titulo: 'Cliente' }],
    duracaoMin: 30,
    paraInstante,
  })
  assert.equal(r[0].livre, true)
  assert.equal(r[1].livre, false)
  assert.equal(r[1].motivo, slots.MOTIVO.COMPROMISSO)
  assert.equal(r[2].livre, true, 'o slot seguinte encosta mas nao sobrepoe')
})

test('bloqueio aparece como BLOQUEIO, nao como compromisso generico', () => {
  const r = slots.marcarDisponibilidade({
    data: '2026-10-05',
    candidatos: ['12:00'],
    eventos: [{ data_inicio: '2026-10-05T12:00:00Z', data_fim: '2026-10-05T13:00:00Z', tipo: 'bloqueio', titulo: 'Almoço' }],
    duracaoMin: 30,
    paraInstante,
  })
  assert.equal(r[0].motivo, slots.MOTIVO.BLOQUEIO)
  assert.equal(r[0].titulo, 'Almoço', 'a tela precisa dizer POR QUE o horario sumiu')
})

test('o BLOQUEIO vence o compromisso quando os dois cobrem o mesmo slot', () => {
  // A informacao util e' "e feriado", nao "tem alguma coisa marcada".
  const r = slots.marcarDisponibilidade({
    data: '2026-10-05',
    candidatos: ['10:00'],
    eventos: [
      { data_inicio: '2026-10-05T10:00:00Z', data_fim: '2026-10-05T11:00:00Z', tipo: 'reuniao', titulo: 'Call' },
      { data_inicio: '2026-10-05T09:00:00Z', data_fim: '2026-10-05T18:00:00Z', tipo: 'bloqueio', titulo: 'Feriado' },
    ],
    duracaoMin: 30,
    paraInstante,
  })
  assert.equal(r[0].motivo, slots.MOTIVO.BLOQUEIO)
  assert.equal(r[0].titulo, 'Feriado')
})

test('reuniao da agenda do BOT ocupa o slot da tela', () => {
  // A direcao INVERSA do espelho: sem isto, o operador marcaria em cima de uma reuniao que o
  // bot combinou com o cliente pelo WhatsApp.
  const r = slots.marcarDisponibilidade({
    data: '2026-10-05',
    candidatos: ['15:00'],
    eventos: [{ data_inicio: '2026-10-05T15:00:00Z', data_fim: '2026-10-05T15:30:00Z', tipo: 'reuniao', __origem: 'bot', titulo: 'Lead' }],
    duracaoMin: 30,
    paraInstante,
  })
  assert.equal(r[0].livre, false)
  assert.equal(r[0].motivo, slots.MOTIVO.AGENDA_BOT)
})

test('horario que ja passou nao e oferta, e o motivo e PASSADO', () => {
  const r = slots.marcarDisponibilidade({
    data: '2026-10-05',
    candidatos: ['08:00', '14:00'],
    eventos: [],
    duracaoMin: 30,
    paraInstante,
    agora: new Date('2026-10-05T10:00:00Z'),
  })
  assert.equal(r[0].motivo, slots.MOTIVO.PASSADO)
  assert.equal(r[1].livre, true)
})

// ─── expandirRecorrencia ─────────────────────────────────────────────────────────────────

test('sem recorrencia gera exatamente o dia pedido', () => {
  const r = slots.expandirRecorrencia({ dataInicial: '2026-10-05', tipo: 'nenhuma' })
  assert.deepEqual(r.datas, ['2026-10-05'])
})

test('recorrencia diaria cobre o intervalo inteiro (almoco de todo dia)', () => {
  const r = slots.expandirRecorrencia({ dataInicial: '2026-10-05', tipo: 'diaria', ate: '2026-10-08' })
  assert.deepEqual(r.datas, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
})

test('recorrencia semanal cai nos dias da semana escolhidos', () => {
  // 2026-10-05 e uma segunda. Pedindo segunda(1) e quarta(3) ate 12/10.
  const r = slots.expandirRecorrencia({
    dataInicial: '2026-10-05', tipo: 'semanal', ate: '2026-10-12', diasSemana: [1, 3],
  })
  assert.deepEqual(r.datas, ['2026-10-05', '2026-10-07', '2026-10-12'])
})

test('recorrencia semanal sem dias usa o dia da semana da data inicial', () => {
  const r = slots.expandirRecorrencia({ dataInicial: '2026-10-05', tipo: 'semanal', ate: '2026-10-20' })
  assert.deepEqual(r.datas, ['2026-10-05', '2026-10-12', '2026-10-19'])
})

test('repeticao sem data final e RECUSADA', () => {
  // Bloqueio eterno so' se desfaz linha a linha — e cada linha tem um espelho na outra agenda.
  const r = slots.expandirRecorrencia({ dataInicial: '2026-10-05', tipo: 'diaria' })
  assert.equal(r.ok, false)
  assert.match(r.erro, /ate quando/i)
})

test('o teto de ocorrencias existe para um erro de digitacao nao virar milhares de linhas', () => {
  const r = slots.expandirRecorrencia({ dataInicial: '2026-01-01', tipo: 'diaria', ate: '2030-01-01' })
  assert.equal(r.datas.length, slots.MAX_OCORRENCIAS)
  assert.equal(r.truncado, true, 'a tela precisa poder avisar que cortou')
})

// ─── deveEspelhar ────────────────────────────────────────────────────────────────────────

test('so BLOQUEIO ativo e espelhado na agenda do bot', () => {
  assert.equal(espelho.deveEspelhar({ tipo: 'bloqueio', status: 'bloqueado' }), true)
  assert.equal(espelho.deveEspelhar({ tipo: 'bloqueio', status: 'pendente' }), true)
  // Reuniao NAO: duplica-la mandaria lembrete repetido ao lead e conversao repetida a Meta.
  assert.equal(espelho.deveEspelhar({ tipo: 'reuniao', status: 'confirmado' }), false)
  // Bloqueio cancelado nao esconde slot nenhum; espelha-lo prenderia o bot num horario livre.
  assert.equal(espelho.deveEspelhar({ tipo: 'bloqueio', status: 'cancelado' }), false)
  assert.equal(espelho.deveEspelhar(null), false)
})

// ─── Guardas de regressao ────────────────────────────────────────────────────────────────

test('GUARDA: o modulo de slots e PURO (sem banco, HTTP ou rede)', () => {
  const src = fonte('services/agenda-slots.js')
  for (const proibido of ['require(\'../db\')', 'pool.query', 'fetch(', 'axios', 'generateAIResponse']) {
    assert.ok(!src.includes(proibido), `agenda-slots.js deixou de ser puro: achei ${proibido}`)
  }
})

test('GUARDA: ocupacaoDoBot EXCLUI o espelho', () => {
  // Sem isto, todo bloqueio conflitaria consigo mesmo pelo proprio reflexo e seria impossivel
  // editar um bloqueio ja criado.
  const src = fonte('services/agenda-espelho.js')
  assert.match(src, /origem IS DISTINCT FROM \$2/,
    'ocupacaoDoBot precisa excluir as linhas de origem espelho_app')
})

test('GUARDA: apagar o bloqueio apaga o espelho', () => {
  // Sem isto o bot recusaria para sempre um horario que ninguem mais ve em lugar nenhum.
  const src = fonte('services/agenda-multiempresa.js')
  const remover = src.slice(src.indexOf('async function removerEvento'))
  assert.match(remover, /espelho_vendas_id/, 'removerEvento precisa ler o espelho')
  assert.match(remover, /removerEspelho/, 'removerEvento precisa remover o espelho')
})

test('GUARDA: o conflito da tela consulta TAMBEM a agenda do bot', () => {
  const src = fonte('services/agenda-multiempresa.js')
  const conflito = src.slice(src.indexOf('async function existeConflito'), src.indexOf('async function listarEventos'))
  assert.match(conflito, /ocupacaoDoBot/,
    'existeConflito precisa enxergar a reuniao que o bot marcou, senao a tela marca em cima dela')
})

test('GUARDA: o bloqueio nasce SEM responsavel', () => {
  // Bloqueio com dono valeria para uma pessoa so' e nao atravessaria o espelho — `vendas`
  // identifica dono por BIGINT e `app` por UUID, sem traducao entre os dois.
  const src = fonte('routes/api-agenda.js')
  const rota = src.slice(src.indexOf("router.post('/bloqueios'"))
  assert.match(rota, /responsavelId: null/,
    'o bloqueio da empresa precisa nascer sem responsavel para valer para todos')
})
