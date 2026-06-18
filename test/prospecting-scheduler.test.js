'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarConfigProspeccao,
  normalizarDiasSemana,
  diaPermitido,
  gerarSlotsEnvio,
  calcularCapacidadeDiaria,
} = require('../src/services/prospecting-scheduler')

test('prospeccao scheduler: normaliza configuracao segura por padrao', () => {
  const cfg = normalizarConfigProspeccao({})
  assert.equal(cfg.ativo, false)
  assert.equal(cfg.modo, 'manual')
  assert.equal(cfg.horario_inicio, '08:00')
  assert.equal(cfg.horario_fim, '17:00')
  assert.equal(cfg.intervalo_envio_minutos, 15)
  assert.equal(cfg.limite_diario, 80)
  assert.deepEqual(cfg.dias_semana_ativos, [1, 2, 3, 4, 5])
  assert.equal(cfg.gerar_mensagem_ia, false)
  assert.equal(cfg.envio_real_habilitado, false)
})

test('prospeccao scheduler: envio real nao liga sem geracao de mensagem IA', () => {
  const cfg = normalizarConfigProspeccao({
    envio_real_habilitado: true,
    gerar_mensagem_ia: false,
  })
  assert.equal(cfg.envio_real_habilitado, false)
})

test('prospeccao scheduler: aceita aliases de modo e limita valores numericos', () => {
  const cfg = normalizarConfigProspeccao({
    modo: 'semiautomatico',
    intervalo_envio_minutos: 2,
    limite_diario: 999,
    horario_inicio: '8:05',
    horario_fim: '7:00',
  })
  assert.equal(cfg.modo, 'semi_automatico')
  assert.equal(cfg.intervalo_envio_minutos, 5)
  assert.equal(cfg.limite_diario, 200)
  assert.equal(cfg.horario_inicio, '08:05')
  assert.equal(cfg.horario_fim, '17:00')
})

test('prospeccao scheduler: normaliza dias de semana e remove invalidos/duplicados', () => {
  assert.deepEqual(normalizarDiasSemana([1, 1, 5, 9, -1, 0]), [0, 1, 5])
  assert.deepEqual(normalizarDiasSemana('1,2,3'), [1, 2, 3])
  assert.deepEqual(normalizarDiasSemana([]), [1, 2, 3, 4, 5])
})

test('prospeccao scheduler: respeita dias permitidos', () => {
  assert.equal(diaPermitido('2026-05-25', [1, 2, 3, 4, 5]), true) // segunda
  assert.equal(diaPermitido('2026-05-24', [1, 2, 3, 4, 5]), false) // domingo
})

test('prospeccao scheduler: gera slots entre horario inicial e final respeitando intervalo', () => {
  const slots = gerarSlotsEnvio({
    data: '2026-05-25',
    horario_inicio: '08:00',
    horario_fim: '09:00',
    intervalo_envio_minutos: 15,
    limite_diario: 80,
  })
  assert.deepEqual(slots.map((s) => s.hora), ['08:00', '08:15', '08:30', '08:45', '09:00'])
  assert.deepEqual(slots.map((s) => s.ordem), [1, 2, 3, 4, 5])
  assert.equal(slots[0].slot_local, '2026-05-25T08:00:00')
})

test('prospeccao scheduler: nao gera slots em dia nao permitido', () => {
  const slots = gerarSlotsEnvio({
    data: '2026-05-24',
    dias_semana_ativos: [1, 2, 3, 4, 5],
  })
  assert.equal(slots.length, 0)
})

test('prospeccao scheduler: limite diario corta a quantidade de slots', () => {
  const slots = gerarSlotsEnvio({
    data: '2026-05-25',
    horario_inicio: '08:00',
    horario_fim: '17:00',
    intervalo_envio_minutos: 15,
    limite_diario: 3,
  })
  assert.deepEqual(slots.map((s) => s.hora), ['08:00', '08:15', '08:30'])
  assert.equal(calcularCapacidadeDiaria({
    data: '2026-05-25',
    horario_inicio: '08:00',
    horario_fim: '17:00',
    intervalo_envio_minutos: 15,
    limite_diario: 3,
  }), 3)
})
