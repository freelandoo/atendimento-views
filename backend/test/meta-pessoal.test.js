'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const MP = require('../src/services/meta-pessoal')

test('normalizarConfig (geral) recusa meta vazia/zero e sanea os dias', () => {
  assert.equal(MP.normalizarConfig(null), null)
  assert.equal(MP.normalizarConfig({ alvo_semanal: 0, dias_semana: [1] }), null)
  assert.equal(MP.normalizarConfig({ alvo_semanal: 10, dias_semana: [] }), null)
  // dedup + ordena + descarta fora de 1..7; modo default = geral, canais nulos
  assert.deepEqual(
    MP.normalizarConfig({ alvo_semanal: '20', dias_semana: [3, 1, 1, 8, 0, 5] }),
    { modo: 'geral', alvo_semanal: 20, alvo_ligacoes: null, alvo_mensagens: null, dias_semana: [1, 3, 5] }
  )
})

test('normalizarConfig (separado) exige os dois canais > 0; alvo_semanal = soma', () => {
  assert.deepEqual(
    MP.normalizarConfig({ modo: 'separado', alvo_ligacoes: '40', alvo_mensagens: 160, dias_semana: [1, 2, 3, 4, 5] }),
    { modo: 'separado', alvo_semanal: 200, alvo_ligacoes: 40, alvo_mensagens: 160, dias_semana: [1, 2, 3, 4, 5] }
  )
  assert.equal(MP.normalizarConfig({ modo: 'separado', alvo_ligacoes: 40, dias_semana: [1] }), null)
  assert.equal(MP.normalizarConfig({ modo: 'separado', alvo_mensagens: 40, dias_semana: [1] }), null)
  assert.equal(MP.normalizarConfig({ modo: 'separado', alvo_ligacoes: 0, alvo_mensagens: 5, dias_semana: [1] }), null)
})

test('medidasDoPeriodo: geral soma canais numa barra, separado abre duas', () => {
  const { inicio, fim } = MP.semanaDe('2026-09-30') // inicio=segunda(dia de meta), fim=domingo(fora)
  const geral = MP.normalizarConfig({ alvo_semanal: 20, dias_semana: [1, 2, 3, 4, 5] })
  // semana: uma barra 'contatos' = ligações + mensagens contra o alvo semanal cheio
  const gs = MP.medidasDoPeriodo(geral, { ligacoes: 3, mensagens: 5 }, 'semana', fim)
  assert.equal(gs.length, 1)
  assert.equal(gs[0].chave, 'contatos')
  assert.deepEqual([gs[0].prog.feito, gs[0].prog.alvo], [8, 20])
  // dia útil: alvo = 20/5 = 4
  const gd = MP.medidasDoPeriodo(geral, { ligacoes: 1, mensagens: 1 }, 'dia', inicio)
  assert.equal(gd[0].prog.alvo, 4)

  const sep = MP.normalizarConfig({ modo: 'separado', alvo_ligacoes: 10, alvo_mensagens: 40, dias_semana: [1, 2, 3, 4, 5] })
  const ss = MP.medidasDoPeriodo(sep, { ligacoes: 2, mensagens: 30 }, 'semana', fim)
  assert.deepEqual(ss.map((m) => m.chave), ['ligacoes', 'mensagens'])
  assert.deepEqual([ss[0].prog.feito, ss[0].prog.alvo], [2, 10])
  assert.deepEqual([ss[1].prog.feito, ss[1].prog.alvo], [30, 40])

  assert.deepEqual(MP.medidasDoPeriodo(null, { ligacoes: 1, mensagens: 1 }, 'semana', fim), [])
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

test('anti-drift: a migration 113 cobra modo e os alvos por canal do separado', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'migrations', '113_meta_pessoal_canais.sql'), 'utf8'
  )
  assert.match(sql, /modo IN \('geral', 'separado'\)/)
  assert.match(sql, /alvo_ligacoes > 0 AND alvo_mensagens > 0/)
})
