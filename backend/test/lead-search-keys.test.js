'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const KEY = require('../src/services/lead-search-keys')

test('lead-search keys: cria codigo uma unica vez, com hash e hint', () => {
  const material = KEY.criarMaterialChave()

  assert.ok(material.codigo.startsWith('avls_'))
  assert.equal(material.key_hash.length, 64)
  assert.ok(material.key_hint.startsWith('avls_...'))
  assert.notEqual(material.key_hash, material.codigo)
  assert.notEqual(material.key_hint, material.codigo)
})

test('lead-search keys: apresentacao nunca devolve codigo nem hash', () => {
  const row = {
    id: 'key-1',
    empresa_id: 'empresa-1',
    nome: 'Cliente A',
    key_hash: 'hash-secreto',
    key_hint: 'avls_...abc123',
    scopes: ['lead_search:maps:create'],
    status: 'active',
    max_leads_per_job: 100,
    rate_limit_per_minute: 10,
    codigo: 'avls_codigo_em_claro',
  }

  const view = KEY.apresentarChave(row)

  assert.equal(view.key_hash, undefined)
  assert.equal(view.codigo, undefined)
  assert.equal(view.key_hint, 'avls_...abc123')
})

test('lead-search keys: bearer e hash sao estaveis', () => {
  const codigo = KEY.gerarCodigoAcesso()
  const h1 = KEY.hashCodigoAcesso(codigo)
  const h2 = KEY.hashCodigoAcesso(`  ${codigo}  `)

  assert.equal(h1, h2)
  assert.equal(KEY.extrairBearer(`Bearer ${codigo}`), codigo)
  assert.equal(KEY.extrairBearer(codigo), null)
})

test('lead-search keys: valida status, expiracao, escopo e empresa', () => {
  const base = {
    id: 'key-1',
    empresa_id: 'empresa-1',
    status: 'active',
    scopes: ['lead_search:maps:create'],
    expires_at: new Date(Date.now() + 60000).toISOString(),
  }

  assert.equal(KEY.verificarUsoChave(base, 'lead_search:maps:create'), base)
  assert.throws(() => KEY.verificarUsoChave({ ...base, status: 'revoked' }, 'lead_search:maps:create'), /revogado/)
  assert.throws(() => KEY.verificarUsoChave({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() }, 'lead_search:maps:create'), /expirado/)
  assert.throws(() => KEY.verificarUsoChave(base, 'lead_search:jobs:read'), /sem escopo/)
  assert.throws(() => KEY.verificarUsoChave({ ...base, empresa_id: null }, 'lead_search:maps:create'), /sem empresa/)
})

test('lead-search keys: normaliza limites e escopos fechados', () => {
  assert.deepEqual(KEY.normalizarScopes(['lead_search:maps:create', 'lead_search:maps:create']), ['lead_search:maps:create'])
  assert.throws(() => KEY.normalizarScopes(['admin:tudo']), /Escopo invalido/)
  assert.equal(KEY.normalizarLimiteChave(undefined), 100)
  assert.equal(KEY.normalizarRateLimit(undefined), 10)
  assert.throws(() => KEY.normalizarLimiteChave(101), /entre 1 e 100/)
  assert.throws(() => KEY.normalizarRateLimit(0), /entre 1 e 60/)
})
