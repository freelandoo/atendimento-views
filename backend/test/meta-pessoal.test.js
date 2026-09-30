'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const MP = require('../src/services/meta-pessoal')

test('normalizarConfig recusa meta vazia/zero e sanea os dias', () => {
  assert.equal(MP.normalizarConfig(null), null)
  assert.equal(MP.normalizarConfig({ alvo_semanal: 0, dias_semana: [1] }), null)
  assert.equal(MP.normalizarConfig({ alvo_semanal: 10, dias_semana: [] }), null)
  // dedup + ordena + descarta fora de 1..7
  assert.deepEqual(
    MP.normalizarConfig({ alvo_semanal: '20', dias_semana: [3, 1, 1, 8, 0, 5] }),
    { alvo_semanal: 20, dias_semana: [1, 3, 5] }
  )
})

test('semanaDe começa numa segunda e contém o dia', () => {
  for (const dia of ['2026-09-30', '2026-01-01', '2026-12-31']) {
    const { inicio, fim } = MP.semanaDe(dia)
    assert.equal(MP.diaIso(inicio), 1, `${inicio} deveria ser segunda`)
    assert.equal(MP.diaIso(fim), 7, `${fim} deveria ser domingo`)
    assert.ok(inicio <= dia && dia <= fim)
  }
})

test('alvoDoDia divide pelos dias atendidos e zera fora deles', () => {
  const config = { alvo_semanal: 20, dias_semana: [1, 2, 3, 4, 5] }
  const { inicio, fim } = MP.semanaDe('2026-09-30')
  assert.equal(MP.alvoDoDia(config, inicio), 4)   // segunda, dia de atendimento
  assert.equal(MP.alvoDoDia(config, fim), 0)       // domingo, fora
  assert.equal(MP.alvoDoDia(null, inicio), 0)
})

test('progresso: fração, faltam, alcançado e alvo null sem barra', () => {
  assert.deepEqual(MP.progresso(2, 4), { alvo: 4, feito: 2, fracao: 0.5, faltam: 2, alcancado: false })
  assert.equal(MP.progresso(5, 4).alcancado, true)
  assert.equal(MP.progresso(5, 4).faltam, 0)
  assert.equal(MP.progresso(0, null).alvo, null) // sem meta ⇒ proximidade() não desenha
})

test('anti-drift: a migration cobra os mesmos limites da regra pura', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'migrations', '111_meta_pessoal.sql'), 'utf8'
  )
  assert.match(sql, /alvo_semanal > 0/)
  assert.match(sql, /ARRAY\[1,2,3,4,5,6,7\]/)
})
