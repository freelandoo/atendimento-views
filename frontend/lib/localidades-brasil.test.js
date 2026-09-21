'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ESTADOS_BRASIL,
  normalizarUfBrasil,
  nomeEstado,
  ibgeMunicipiosUrl,
  extrairCidadesIbge,
  cidadePertenceAoEstado,
} = require('./localidades-brasil')

test('lista de estados cobre as 27 UFs brasileiras sem duplicidade', () => {
  assert.equal(ESTADOS_BRASIL.length, 27)
  assert.equal(new Set(ESTADOS_BRASIL.map((e) => e.uf)).size, 27)
  assert.ok(ESTADOS_BRASIL.some((e) => e.uf === 'SP' && e.nome === 'São Paulo'))
})

test('normalizarUfBrasil aceita apenas UF conhecida', () => {
  assert.equal(normalizarUfBrasil(' sp '), 'SP')
  assert.equal(normalizarUfBrasil('XX'), '')
  assert.equal(normalizarUfBrasil('SAO'), '')
  assert.equal(normalizarUfBrasil(null), '')
})

test('nomeEstado e ibgeMunicipiosUrl usam UF normalizada', () => {
  assert.equal(nomeEstado('sp'), 'São Paulo')
  assert.match(ibgeMunicipiosUrl(' sp '), /estados\/SP\/municipios/)
  assert.equal(ibgeMunicipiosUrl('ZZ'), '')
})

test('extrairCidadesIbge limpa, deduplica e ordena nomes', () => {
  const cidades = extrairCidadesIbge([{ nome: 'Santos' }, { nome: ' Campinas ' }, { nome: 'Santos' }, {}, null])
  assert.deepEqual(cidades, ['Campinas', 'Santos'])
})

test('cidadePertenceAoEstado compara sem depender de caixa', () => {
  assert.equal(cidadePertenceAoEstado('campinas', ['Campinas', 'Santos']), true)
  assert.equal(cidadePertenceAoEstado('Sorocaba', ['Campinas', 'Santos']), false)
  assert.equal(cidadePertenceAoEstado('', ['Campinas']), false)
})
