'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { renderSaudacao, rodarLeads, STATUS_RODAVEL } = require('../src/services/rodar-leads')

test('renderSaudacao substitui variáveis e faz trim', () => {
  const out = renderSaudacao('Oi {nome}, vi a {empresa} em {cidade} ({nicho}).  ', {
    nome: 'Padaria X', cidade: 'SP', nicho: 'padaria',
  })
  assert.strictEqual(out, 'Oi Padaria X, vi a Padaria X em SP (padaria).')
})

test('renderSaudacao é case-insensitive e tolera campos vazios', () => {
  const out = renderSaudacao('Olá {NOME} de {Cidade}', { nome: 'Bar Y' })
  assert.strictEqual(out, 'Olá Bar Y de')
})

test('STATUS_RODAVEL cobre exatamente os status de "sem contato"', () => {
  assert.deepStrictEqual(
    [...STATUS_RODAVEL].sort(),
    ['aguardando', 'aprovado', 'coletado', 'contato_encontrado']
  )
})

test('rodarLeads rejeita seleção vazia (400)', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: [] }),
    (err) => err.statusCode === 400
  )
})

test('rodarLeads rejeita lote acima do máximo (400)', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  const ids = Array.from({ length: 16 }, (_, i) => `id-${i}`)
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ids }),
    (err) => err.statusCode === 400
  )
})

test('rodarLeads exige instância existente (404)', async () => {
  const pool = { query: async () => ({ rows: [] }) } // instância não encontrada
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'] }),
    (err) => err.statusCode === 404
  )
})

test('rodarLeads exige saudação configurada (409)', async () => {
  const pool = {
    query: async () => ({ rows: [{ id: 'i1', evolution_instance: 'free', ativo: true, config_json: {} }] }),
  }
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'] }),
    (err) => err.statusCode === 409
  )
})
