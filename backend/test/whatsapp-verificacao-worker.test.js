'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const W = require('../src/services/whatsapp-verificacao-worker')

function poolFalso({ leads = [], rowCountUpdate = 1 } = {}) {
  const chamadas = []
  return {
    chamadas,
    async query(sql, params = []) {
      chamadas.push({ sql, params })
      if (/FROM prospectador\.prospects/i.test(sql) && /tem_whatsapp IS NULL/i.test(sql) && /ORDER BY created_at/i.test(sql)) {
        return { rows: leads }
      }
      if (/UPDATE prospectador\.prospects/i.test(sql)) {
        return { rowCount: rowCountUpdate, rows: [] }
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 120)}`)
    },
  }
}

test('verificarEmpresa marca com e sem WhatsApp sem enviar mensagem', async () => {
  const pool = poolFalso({
    leads: [
      { id: '11111111-1111-1111-1111-111111111111', telefone: '11999990000' },
      { id: '22222222-2222-2222-2222-222222222222', telefone: '11888880000' },
    ],
  })
  const veredito = new Map([
    ['5511999990000', { exists: true, jid: '5511999990000@s.whatsapp.net' }],
    ['5511888880000', { exists: false, jid: '5511888880000@s.whatsapp.net' }],
  ])

  const out = await W.verificarEmpresa(pool, {
    empresa_id: 'empresa-1',
    evolution_instance: 'instancia-1',
  }, {
    verificarNumerosWhatsapp: async () => veredito,
  })

  assert.equal(out.verificados, 2)
  assert.equal(out.com_whatsapp, 1)
  assert.equal(out.sem_whatsapp, 1)
  const updates = pool.chamadas.filter((c) => /UPDATE prospectador\.prospects/i.test(c.sql))
  assert.equal(updates.length, 2)
  assert.equal(updates[0].params[3], true)
  assert.equal(updates[1].params[3], false)
})

test('verificarEmpresa deixa pendente quando a Evolution falha', async () => {
  const pool = poolFalso({
    leads: [{ id: '11111111-1111-1111-1111-111111111111', telefone: '11999990000' }],
  })

  const out = await W.verificarEmpresa(pool, {
    empresa_id: 'empresa-1',
    evolution_instance: 'instancia-1',
  }, {
    verificarNumerosWhatsapp: async () => null,
  })

  assert.equal(out.falhou, true)
  assert.equal(out.verificados, 0)
  assert.equal(out.pendentes, 1)
  assert.equal(pool.chamadas.some((c) => /UPDATE prospectador\.prospects/i.test(c.sql)), false)
})

test('tick usa lideranca e nao roda sem lock', async () => {
  let listou = false
  const out = await W.tickVerificacaoWhatsapp({}, {
    adquirirLiderancaWorker: async () => false,
    listarInstanciasElegiveis: async () => { listou = true; return [] },
  })

  assert.equal(out.skipped, true)
  assert.equal(out.motivo, 'sem_lideranca')
  assert.equal(listou, false)
})
