'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const API = require('./lead-search-api-keys')

test('lead-search-api-keys: resolve estados sem expor segredo', () => {
  const agora = new Date('2026-09-24T12:00:00.000Z')

  assert.equal(API.estadoChave({ status: 'active', expires_at: '2026-09-25T12:00:00.000Z' }, agora), 'active')
  assert.equal(API.estadoChave({ status: 'active', expires_at: '2026-09-23T12:00:00.000Z' }, agora), 'expired')
  assert.equal(API.estadoChave({ status: 'revoked', expires_at: '2026-09-25T12:00:00.000Z' }, agora), 'revoked')
  assert.equal(API.rotuloEstadoChave('expired'), 'Expirada')
})

test('lead-search-api-keys: valida formulario administrativo', () => {
  const agora = new Date('2026-09-24T12:00:00.000Z')
  const invalido = API.validarFormularioChave({
    nome: '',
    empresa_id: '',
    max_leads_per_job: 101,
    rate_limit_per_minute: 0,
    expires_at: '2026-09-23T12:00',
  }, agora)

  assert.equal(invalido.ok, false)
  assert.equal(invalido.erros.nome, 'Informe um nome com pelo menos 2 caracteres.')
  assert.equal(invalido.erros.empresa_id, 'Escolha a empresa que podera usar este codigo.')
  assert.match(invalido.erros.max_leads_per_job, /1 e 100/)
  assert.match(invalido.erros.rate_limit_per_minute, /1 e 60/)
  assert.match(invalido.erros.expires_at, /futuro/)
})

test('lead-search-api-keys: monta payload estavel para backend', () => {
  const payload = API.montarPayloadChave({
    nome: '  API Casa das Plantas  ',
    empresa_id: 'empresa-1',
    max_leads_per_job: '80',
    rate_limit_per_minute: '10',
    expires_at: '',
  })

  assert.deepEqual(payload, {
    nome: 'API Casa das Plantas',
    empresa_id: 'empresa-1',
    scopes: ['lead_search:maps:create', 'lead_search:jobs:read'],
    expires_at: null,
    max_leads_per_job: 80,
    rate_limit_per_minute: 10,
  })
})
