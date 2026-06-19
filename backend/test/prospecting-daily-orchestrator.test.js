'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  slotEnvioParaInstante,
  verificarAgendaDiariaProspeccao,
  agendarEnvioItemFilaDiaria,
} = require('../src/prospecting')
const { pool } = require('../src/db')

test('slotEnvioParaInstante converte horário local de São Paulo (-03) para instante UTC', () => {
  // 09:00 em São Paulo = 12:00 UTC (sem horário de verão desde 2019)
  assert.equal(slotEnvioParaInstante('2026-05-28T09:00:00').toISOString(), '2026-05-28T12:00:00.000Z')
  assert.equal(slotEnvioParaInstante('2026-05-28T08:00:00').toISOString(), '2026-05-28T11:00:00.000Z')
})

test('slotEnvioParaInstante aceita data com espaço e ignora sufixo extra', () => {
  assert.equal(slotEnvioParaInstante('2026-05-28 14:30:00').toISOString(), '2026-05-28T17:30:00.000Z')
})

test('slotEnvioParaInstante retorna null para entrada inválida', () => {
  assert.equal(slotEnvioParaInstante('abc'), null)
  assert.equal(slotEnvioParaInstante(''), null)
  assert.equal(slotEnvioParaInstante(null), null)
})

test('orquestrador e helper de agendamento são exportados como funções', () => {
  assert.equal(typeof verificarAgendaDiariaProspeccao, 'function')
  assert.equal(typeof agendarEnvioItemFilaDiaria, 'function')
})

test('verificarAgendaDiariaProspeccao: roda uma rodada POR EMPRESA com config ativa (loop multiempresa)', async () => {
  const originalQuery = pool.query
  const empresasLidas = []
  pool.query = async (sql, params = []) => {
    const text = String(sql)
    // 1) Lista de empresas com config ativa.
    if (/FROM prospectador\.prospeccao_configuracoes\s+WHERE ativo = true/i.test(text)) {
      return { rows: [{ empresa_id: 'e1' }, { empresa_id: 'e2' }] }
    }
    // garantirLinhaConfiguracao (INSERT)
    if (/INSERT INTO prospectador\.prospeccao_configuracoes/i.test(text)) {
      return { rows: [] }
    }
    // 2) Config por empresa: devolve ativo=false → a rodada sai cedo ('desabilitado'),
    //    mas prova que o núcleo foi chamado por empresa (params[0] = empresa_id).
    if (/FROM prospectador\.prospeccao_configuracoes/i.test(text)) {
      empresasLidas.push(params[0])
      return { rows: [{ ativo: false }] }
    }
    return { rows: [] }
  }
  try {
    const r = await verificarAgendaDiariaProspeccao(new Date('2026-06-19T12:00:00Z'))
    assert.equal(r.ok, true)
    assert.equal(r.empresas, 2)
    assert.equal(r.resultados.length, 2)
    assert.deepEqual(r.resultados.map((x) => x.empresa_id), ['e1', 'e2'])
    assert.ok(r.resultados.every((x) => x.motivo === 'desabilitado'))
    // O núcleo leu a config de CADA empresa (isolamento por tenant).
    assert.deepEqual(empresasLidas, ['e1', 'e2'])
  } finally {
    pool.query = originalQuery
  }
})

test('verificarAgendaDiariaProspeccao: sem empresa com config ativa, não faz nada', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    if (/WHERE ativo = true/i.test(String(sql))) return { rows: [] }
    return { rows: [] }
  }
  try {
    const r = await verificarAgendaDiariaProspeccao(new Date('2026-06-19T12:00:00Z'))
    assert.equal(r.motivo, 'desabilitado')
    assert.equal(r.empresas, 0)
  } finally {
    pool.query = originalQuery
  }
})
