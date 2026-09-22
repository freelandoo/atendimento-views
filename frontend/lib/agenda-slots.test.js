'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  MOTIVO, RECORRENCIA, aparenciaDoSlot, resumoDoDia, rotuloDoDia,
  impedimentoDoBloqueio, resumoDoBloqueio,
} = require('./agenda-slots.js')

test('slot livre e clicavel; ocupado nao e', () => {
  assert.equal(aparenciaDoSlot({ horario: '09:00', livre: true }).clicavel, true)
  assert.equal(aparenciaDoSlot({ horario: '09:00', livre: false, motivo: MOTIVO.COMPROMISSO }).clicavel, false)
})

test('o motivo vira texto — cor nunca e o unico sinal', () => {
  const a = aparenciaDoSlot({ horario: '12:00', livre: false, motivo: MOTIVO.BLOQUEIO, titulo: 'Feriado' })
  assert.equal(a.rotulo, 'Bloqueado')
  assert.match(a.descricao, /Feriado/, 'o titulo explica o sumico melhor que o motivo generico')
})

test('reuniao do WhatsApp e nomeada como tal', () => {
  const a = aparenciaDoSlot({ horario: '15:00', livre: false, motivo: MOTIVO.AGENDA_BOT })
  assert.match(a.descricao, /WhatsApp/)
})

test('preparo nao e compromisso: o texto diz de qual reuniao e a folga', () => {
  const a = aparenciaDoSlot({ horario: '14:00', livre: false, motivo: MOTIVO.PREPARO, titulo: 'Reunião com Fulano', referencia: '16:00' })
  assert.equal(a.rotulo, 'Preparo')
  assert.equal(a.clicavel, false)
  assert.match(a.descricao, /preparo da reunião das 16:00/i)
  assert.ok(!/já há um compromisso/i.test(a.descricao), 'as 14:00 nao existe compromisso nenhum')
})

test('preparo sem referencia ainda se explica', () => {
  const a = aparenciaDoSlot({ horario: '14:00', livre: false, motivo: MOTIVO.PREPARO, titulo: null, referencia: null })
  assert.equal(a.rotulo, 'Preparo')
  assert.match(a.descricao, /preparo da reunião/i)
  assert.ok(!/das (undefined|null)/.test(a.descricao))
})

test('indisponivel NAO usa vermelho', () => {
  // Agenda cheia nao e' tela cheia de erro.
  const a = aparenciaDoSlot({ horario: '09:00', livre: false, motivo: MOTIVO.COMPROMISSO })
  assert.ok(!/red|danger/.test(a.classe), `classe de ocupado nao pode ser de erro: ${a.classe}`)
})

test('resumoDoDia distingue lotado de encerrado de bloqueado', () => {
  assert.equal(resumoDoDia({ horarios: [{ livre: true }, { livre: false }] }).texto, '1 horário livre')
  assert.equal(resumoDoDia({ horarios: [{ livre: false, motivo: MOTIVO.PASSADO }] }).texto, 'Dia encerrado')
  assert.equal(resumoDoDia({ horarios: [{ livre: false, motivo: MOTIVO.BLOQUEIO }] }).texto, 'Agenda bloqueada')
  assert.equal(resumoDoDia({ horarios: [{ livre: false, motivo: MOTIVO.COMPROMISSO }] }).texto, 'Sem horários livres')
})

test('rotuloDoDia marca hoje', () => {
  assert.equal(rotuloDoDia('2026-10-05', '2026-10-05').titulo, 'Hoje')
  assert.equal(rotuloDoDia('2026-10-06', '2026-10-05').titulo, 'Terça')
})

test('impedimento cobre os casos que a API recusaria', () => {
  const base = { data: '2026-10-05', hora_inicio: '09:00', hora_fim: '10:00', recorrencia: RECORRENCIA.NENHUMA }
  assert.equal(impedimentoDoBloqueio(base), '')
  assert.match(impedimentoDoBloqueio({ ...base, hora_fim: '08:00' }), /maior/)
  assert.match(impedimentoDoBloqueio({ ...base, recorrencia: RECORRENCIA.DIARIA }), /até quando/i)
  assert.match(
    impedimentoDoBloqueio({ ...base, recorrencia: RECORRENCIA.SEMANAL, repetir_ate: '2026-11-05', dias_semana: [] }),
    /dia da semana/i
  )
})

test('o aviso de que o bloqueio NAO alcanca o bot aparece', () => {
  // Fingir sucesso total deixaria a pessoa achar que bloqueou quando o WhatsApp ainda oferece.
  const r = resumoDoBloqueio({ criados: 1, vale_para_bot: false, falhas: [] })
  assert.match(r.alerta, /WhatsApp/)
})

test('dias que falharam por conflito sao reportados', () => {
  const r = resumoDoBloqueio({ criados: 3, vale_para_bot: true, falhas: [{ data: '2026-10-07' }] })
  assert.equal(r.texto, '3 dias bloqueados.')
  assert.match(r.alerta, /1 dia ficou de fora/)
})

test('GUARDA: o modulo nao recalcula disponibilidade', () => {
  // Ele TRADUZ o veredito da API. Decidir aqui criaria uma segunda regua que diverge em silencio
  // da do servidor — o mesmo contrato de lib/site-rotulos.js.
  const src = fs.readFileSync(path.join(__dirname, 'agenda-slots.js'), 'utf8')
  for (const proibido of ['data_inicio', 'data_fim', 'sobrepoe', 'existeConflito', 'fetch(']) {
    assert.ok(!src.includes(proibido), `lib/agenda-slots.js passou a decidir em vez de traduzir: ${proibido}`)
  }
})
