'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  adicionarFiltroMercado,
  termoBuscaProspect,
  listarOpcoesFiltrosMercado,
} = require('../src/services/prospect-filters')

test('prospect filters: mercado consulta nicho ou categoria_perfil com SQL parametrizado', () => {
  const where = ['p.empresa_id = $1']
  const params = ['empresa-1']

  adicionarFiltroMercado(where, params, { mercado: 'barbearia', cidade: 'Santo Andre' }, { alias: 'p' })

  assert.equal(params.length, 3)
  assert.equal(params[1], '%barbearia%')
  assert.equal(params[2], '%Santo Andre%')
  assert.match(where.join(' AND '), /\(p\.nicho ILIKE \$2 OR p\.categoria_perfil ILIKE \$2\)/)
  assert.match(where.join(' AND '), /p\.cidade ILIKE \$3/)
})

test('prospect filters: aceita nicho ou categoria como aliases de mercado', () => {
  const whereNicho = []
  const paramsNicho = []
  adicionarFiltroMercado(whereNicho, paramsNicho, { nicho: 'dentistas' })

  const whereCategoria = []
  const paramsCategoria = []
  adicionarFiltroMercado(whereCategoria, paramsCategoria, { categoria: 'clinica' })

  assert.equal(paramsNicho[0], '%dentistas%')
  assert.match(whereNicho[0], /nicho ILIKE \$1 OR categoria_perfil ILIKE \$1/)
  assert.equal(paramsCategoria[0], '%clinica%')
  assert.match(whereCategoria[0], /nicho ILIKE \$1 OR categoria_perfil ILIKE \$1/)
})

test('prospect filters: termoBuscaProspect normaliza busca, q ou pesquisa', () => {
  assert.equal(termoBuscaProspect({ busca: '  lead  ' }), 'lead')
  assert.equal(termoBuscaProspect({ q: '  mercado  ' }), 'mercado')
  assert.equal(termoBuscaProspect({ pesquisa: '  cidade  ' }), 'cidade')
})

test('prospect filters: opcoes de mercado ficam escopadas por empresa, origem e status', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [{ valor: 'barbearia', total: 2 }] }
    },
  }

  const out = await listarOpcoesFiltrosMercado(pool, {
    empresaId: 'empresa-1',
    origemIn: ['manual', 'automatico'],
    statusAny: ['aguardando', 'aprovado'],
    limit: 10,
  })

  assert.equal(out.nichos[0].valor, 'barbearia')
  assert.equal(queries.length, 3)
  for (const q of queries) {
    assert.match(q.sql, /empresa_id = \$1/)
    assert.match(q.sql, /origem = ANY\(\$2\)/)
    assert.match(q.sql, /status = ANY\(\$3\)/)
    assert.deepEqual(q.params, ['empresa-1', ['manual', 'automatico'], ['aguardando', 'aprovado'], 10])
  }
})
