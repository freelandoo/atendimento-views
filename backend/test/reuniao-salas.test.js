'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { statusCalculado, salaParaApi } = require('../src/db/reuniao-salas')

const INICIO = '2026-09-28T13:00:00.000Z'
const ANTES = new Date('2026-09-28T13:09:59.000Z')
const DEPOIS = new Date('2026-09-28T13:10:00.000Z')

function sala(extra = {}) {
  return {
    id: 's1',
    agenda_evento_id: 'a1',
    provider: 'jitsi',
    provider_domain: 'meet.jit.si',
    room_name: 'av-teste',
    lead_token: 'lead-token',
    status_presenca: 'pendente',
    host_entrou_em: null,
    lead_entrou_em: null,
    classificado_em: null,
    evento: { data_inicio: INICIO },
    ...extra,
  }
}

test('antes de 10 minutos a sala continua pendente sem presença', () => {
  assert.equal(statusCalculado(sala(), ANTES), 'pendente')
})

test('depois de 10 minutos host sem lead vira lead_nao_compareceu', () => {
  assert.equal(statusCalculado(sala({ host_entrou_em: '2026-09-28T13:00:10.000Z' }), DEPOIS), 'lead_nao_compareceu')
})

test('depois de 10 minutos lead sem host vira host_nao_entrou', () => {
  assert.equal(statusCalculado(sala({ lead_entrou_em: '2026-09-28T13:00:10.000Z' }), DEPOIS), 'host_nao_entrou')
})

test('depois de 10 minutos sem ninguém vira sem_presenca_registrada', () => {
  assert.equal(statusCalculado(sala(), DEPOIS), 'sem_presenca_registrada')
})

test('quando os dois entraram a presença fica completa', () => {
  assert.equal(statusCalculado(sala({
    host_entrou_em: '2026-09-28T13:00:10.000Z',
    lead_entrou_em: '2026-09-28T13:00:20.000Z',
  }), DEPOIS), 'ambos_entraram')
})

test('payload da sala não expõe o token público cru', () => {
  const out = salaParaApi(sala())
  assert.equal(out.lead_url, '/reuniao/lead-token')
  assert.equal(Object.hasOwn(out, 'lead_token'), false)
})
