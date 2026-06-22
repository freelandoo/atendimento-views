'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarAgendaCampanha,
  normalizarDias,
  horaParaMinutos,
  campanhaDevePreencher,
} = require('../src/services/captacao-scheduler')

const TZ = 'America/Sao_Paulo'
// Helper: Date em horário de Brasília (UTC-3, sem horário de verão hoje).
const brt = (iso) => new Date(`${iso}-03:00`)

test('agenda: defaults seguros (agendamento desligado, 24h, dias úteis)', () => {
  const a = normalizarAgendaCampanha({})
  assert.equal(a.agendamento_ativo, false)
  assert.equal(a.intervalo_horas, 24)
  assert.equal(a.janela_inicio, '08:00')
  assert.equal(a.janela_fim, '18:00')
  assert.deepEqual(a.dias_semana, [1, 2, 3, 4, 5])
})

test('agenda: input tem prioridade sobre base; janela inválida cai pro default', () => {
  const a = normalizarAgendaCampanha(
    { agendamento_ativo: true, intervalo_horas: 6, janela_inicio: '20:00', janela_fim: '19:00', dias_semana: [0, 6] },
    { intervalo_horas: 12 }
  )
  assert.equal(a.agendamento_ativo, true)
  assert.equal(a.intervalo_horas, 6)
  assert.equal(a.janela_inicio, '20:00')
  assert.equal(a.janela_fim, '18:00') // fim <= início → reset
  assert.deepEqual(a.dias_semana, [0, 6])
})

test('agenda: intervalo é limitado a 1..168 e dias inválidos somem', () => {
  assert.equal(normalizarAgendaCampanha({ intervalo_horas: 0 }).intervalo_horas, 1)
  assert.equal(normalizarAgendaCampanha({ intervalo_horas: 999 }).intervalo_horas, 168)
  assert.deepEqual(normalizarDias([9, 3, 3, -1, 5]), [3, 5])
})

test('horaParaMinutos converte HH:MM', () => {
  assert.equal(horaParaMinutos('08:30'), 510)
  assert.equal(horaParaMinutos('00:00'), 0)
})

const baseCamp = {
  ativo: true,
  ultima_coleta_em: null,
  metadata_json: { agendamento_ativo: true, intervalo_horas: 6, janela_inicio: '08:00', janela_fim: '18:00', dias_semana: [1, 2, 3, 4, 5] },
}

test('deve disparar: dentro da janela, dia útil, nunca coletada', () => {
  // Quarta-feira (2026-06-24) 10:00 BRT
  assert.equal(campanhaDevePreencher(baseCamp, brt('2026-06-24T10:00'), TZ), true)
})

test('não dispara: agendamento desligado', () => {
  const c = { ...baseCamp, metadata_json: { ...baseCamp.metadata_json, agendamento_ativo: false } }
  assert.equal(campanhaDevePreencher(c, brt('2026-06-24T10:00'), TZ), false)
})

test('não dispara: campanha inativa', () => {
  assert.equal(campanhaDevePreencher({ ...baseCamp, ativo: false }, brt('2026-06-24T10:00'), TZ), false)
})

test('não dispara: fora da janela de horário (antes do início)', () => {
  assert.equal(campanhaDevePreencher(baseCamp, brt('2026-06-24T06:00'), TZ), false)
})

test('não dispara: fim de semana fora dos dias ativos', () => {
  // Domingo 2026-06-21 10:00 BRT
  assert.equal(campanhaDevePreencher(baseCamp, brt('2026-06-21T10:00'), TZ), false)
})

test('não dispara: intervalo ainda não venceu', () => {
  const c = { ...baseCamp, ultima_coleta_em: brt('2026-06-24T07:00').toISOString() } // 3h antes
  assert.equal(campanhaDevePreencher(c, brt('2026-06-24T10:00'), TZ), false)
})

test('dispara: intervalo venceu (>= 6h desde última coleta)', () => {
  const c = { ...baseCamp, ultima_coleta_em: brt('2026-06-24T03:00').toISOString() } // 7h antes
  assert.equal(campanhaDevePreencher(c, brt('2026-06-24T10:00'), TZ), true)
})
