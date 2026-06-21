'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { slugify, gerarSlugEmpresa } = require('../src/string-utils')

test('slugify — minúsculas, sem acento, hífens', () => {
  assert.equal(slugify('Barbearia Top Ltda'), 'barbearia-top-ltda')
  assert.equal(slugify('Açaí & Cia'), 'acai-cia')
  assert.equal(slugify('  espaços   extras  '), 'espacos-extras')
})

test('slugify — string vazia vira fallback', () => {
  assert.equal(slugify(''), '')
  assert.equal(slugify(null), '')
})

test('gerarSlugEmpresa — anexa sufixo aleatório e nunca vazio', () => {
  assert.match(gerarSlugEmpresa('Minha Empresa'), /^minha-empresa-[a-z0-9]{6}$/)
  assert.match(gerarSlugEmpresa(''), /^empresa-[a-z0-9]{6}$/)
})
