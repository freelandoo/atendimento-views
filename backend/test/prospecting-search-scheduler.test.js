'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buscaProspeccaoDevePreencher } = require('../src/services/prospecting-search-scheduler')

const TZ = 'America/Sao_Paulo'
// Helper: Date em horário de Brasília (UTC-3, sem horário de verão hoje).
const brt = (iso) => new Date(`${iso}-03:00`)

// Config base: agendamento ligado, nicho/cidade preenchidos, janela 08–18, dias úteis.
const base = (over = {}) => ({
  agendamento_busca_ativo: true,
  categoria_padrao: 'dentista',
  cidade_padrao: 'Santana',
  estado_padrao: 'SP',
  horario_inicio: '08:00',
  horario_fim: '18:00',
  dias_semana_ativos: [1, 2, 3, 4, 5],
  busca_intervalo_horas: 6,
  ultima_busca_em: null,
  ...over,
})

// 2026-06-23 é uma terça-feira.
const TERCA_10H = brt('2026-06-23T10:00:00')

test('não dispara se agendamento desligado', () => {
  assert.equal(buscaProspeccaoDevePreencher(base({ agendamento_busca_ativo: false }), TERCA_10H, TZ), false)
})

test('não dispara sem nicho ou sem cidade (busca do Places exige ambos)', () => {
  assert.equal(buscaProspeccaoDevePreencher(base({ categoria_padrao: null }), TERCA_10H, TZ), false)
  assert.equal(buscaProspeccaoDevePreencher(base({ cidade_padrao: '' }), TERCA_10H, TZ), false)
})

test('dispara dentro da janela, dia útil, sem busca anterior', () => {
  assert.equal(buscaProspeccaoDevePreencher(base(), TERCA_10H, TZ), true)
})

test('não dispara antes do início da janela', () => {
  assert.equal(buscaProspeccaoDevePreencher(base(), brt('2026-06-23T07:30:00'), TZ), false)
})

test('não dispara depois do fim da janela', () => {
  assert.equal(buscaProspeccaoDevePreencher(base(), brt('2026-06-23T18:30:00'), TZ), false)
})

test('não dispara em dia não ativo (domingo)', () => {
  // 2026-06-21 é domingo (dia 0), fora de [1..5].
  assert.equal(buscaProspeccaoDevePreencher(base(), brt('2026-06-21T10:00:00'), TZ), false)
})

test('respeita o intervalo a cada X horas (ainda não passou)', () => {
  const cfg = base({ ultima_busca_em: brt('2026-06-23T07:00:00').toISOString() }) // 3h atrás
  assert.equal(buscaProspeccaoDevePreencher(cfg, TERCA_10H, TZ), false)
})

test('dispara quando o intervalo já passou', () => {
  const cfg = base({ ultima_busca_em: brt('2026-06-23T03:00:00').toISOString() }) // 7h atrás (> 6h)
  assert.equal(buscaProspeccaoDevePreencher(cfg, TERCA_10H, TZ), true)
})

test('config nula é tratada com segurança', () => {
  assert.equal(buscaProspeccaoDevePreencher(null, TERCA_10H, TZ), false)
})
