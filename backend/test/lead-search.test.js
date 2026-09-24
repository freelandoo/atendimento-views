'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const LS = require('../src/services/lead-search')
const { processarJobMaps } = require('../src/services/lead-search-worker')

const JOB_BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  empresa_id: '22222222-2222-4222-8222-222222222222',
  usuario_id: '33333333-3333-4333-8333-333333333333',
  entry_source: 'maps',
  status: 'queued',
  request: { nicho: 'clinicas odontologicas', cidade: 'Sao Paulo', pais: 'BR', limit: 2 },
  requested_limit: 2,
  returned_count: 0,
}

const REGISTRO_MAPS = {
  place_id: 'ChIJabc123',
  cid: '123456',
  name: 'Clinica Exemplo',
  address: 'Rua A, 123 - Sao Paulo - SP',
  phone_number: '+55 11 99999-0000',
  open_website: 'https://clinica.example',
  url: 'https://maps.google.com/?cid=123456',
  rating: 4.7,
  reviews_count: 82,
  category: 'Dental clinic',
  all_categories: ['Dental clinic', 'Dentist'],
}

function criarDbFake({ job = JOB_BASE, source = {} } = {}) {
  const state = {
    job: { ...job },
    source: {
      job_id: job.id,
      source: LS.SOURCES.GOOGLE_MAPS,
      source_state: LS.SOURCE_STATE.NOT_CHECKED,
      provider_status: null,
      external_snapshot_id: null,
      ...source,
    },
    chamadas: [],
  }
  return {
    state,
    async iniciarJobMaps() {
      state.chamadas.push('iniciarJobMaps')
      if (![LS.JOB_STATUS.QUEUED, LS.JOB_STATUS.RUNNING].includes(state.job.status)) return null
      state.job.status = LS.JOB_STATUS.RUNNING
      return state.job
    },
    async carregarFonte() {
      state.chamadas.push('carregarFonte')
      return state.source
    },
    async registrarTriggerMaps(_pool, dados) {
      state.chamadas.push('registrarTriggerMaps')
      state.source.external_snapshot_id = dados.snapshotId
      state.source.provider_status = dados.providerStatus
      return state.source
    },
    async registrarProgressoFonte(_pool, dados) {
      state.chamadas.push('registrarProgressoFonte')
      state.source.provider_status = dados.providerStatus
      return state.source
    },
    async marcarProviderFailed(_pool, dados) {
      state.chamadas.push('marcarProviderFailed')
      state.source.source_state = LS.SOURCE_STATE.PROVIDER_FAILED
      state.source.error_type = dados.errorType
      state.job.status = LS.JOB_STATUS.FAILED
      state.job.error_message = dados.errorMessage
      return state.job
    },
    async salvarResultadosMaps(_pool, dados) {
      state.chamadas.push('salvarResultadosMaps')
      state.registros = dados.registros
      state.source.source_state = dados.registros.length ? LS.SOURCE_STATE.FOUND : LS.SOURCE_STATE.NOT_FOUND
      state.job.status = LS.JOB_STATUS.COMPLETED
      state.job.returned_count = dados.registros.length
      return state.job
    },
  }
}

test('lead-search: request Maps exige volume e limita em 100 leads', () => {
  const r = LS.normalizarRequestMaps({ nicho: 'restaurantes', cidade: 'Salvador', quantidade: 100 })
  assert.equal(r.entrySource, 'maps')
  assert.equal(r.requestedLimit, 100)
  assert.equal(r.request.limit, 100)

  assert.throws(
    () => LS.normalizarRequestMaps({ nicho: 'restaurantes', cidade: 'Salvador', quantidade: 101 }),
    /maximo 100/
  )
})

test('lead-search: dossier Maps traz contrato em camadas sem qualificar lead', () => {
  const d = LS.montarDossierMaps(REGISTRO_MAPS, {
    id: 'raw-1',
    source: LS.SOURCES.GOOGLE_MAPS,
    item_index: 0,
    raw_path: 'payload',
  })

  assert.equal(d.primary_source, LS.SOURCES.GOOGLE_MAPS)
  assert.equal(d.canonical.business.name, 'Clinica Exemplo')
  assert.equal(d.canonical.contacts.phones[0].value, '+55 11 99999-0000')
  assert.equal(d.source_data.google_maps.place_id, 'ChIJabc123')
  assert.equal(d.source_status.google_maps.state, LS.SOURCE_STATE.FOUND)
  assert.deepEqual(d.raw_refs[0], {
    raw_ref_id: 'raw-1',
    source: LS.SOURCES.GOOGLE_MAPS,
    raw_path: 'payload',
    item_index: 0,
  })
  assert.equal(d.canonical.score, undefined)
  assert.equal(d.canonical.qualificacao, undefined)
  assert.equal(d.verification.state, 'source_declared')
})

test('lead-search worker: job novo dispara Bright Data e fica assincrono', async () => {
  const db = criarDbFake()
  const chamadasMaps = []
  const maps = {
    async dispararBuscaMaps(args) {
      chamadasMaps.push(args)
      return { snapshotId: 'snap-1', geo: { lat: -23.5, long: -46.6 } }
    },
  }

  const r = await processarJobMaps({}, JOB_BASE.id, { db, maps })

  assert.equal(r.ok, true)
  assert.equal(r.triggered, true)
  assert.equal(db.state.source.external_snapshot_id, 'snap-1')
  assert.deepEqual(chamadasMaps[0], { nicho: 'clinicas odontologicas', cidade: 'Sao Paulo', pais: 'BR' })
  assert.ok(!db.state.chamadas.includes('salvarResultadosMaps'))
})

test('lead-search worker: falha de fornecedor vira provider_failed, nao not_found', async () => {
  const db = criarDbFake({ source: { external_snapshot_id: 'snap-erro' } })
  const maps = {
    async estadoBuscaMaps() { return 'failed' },
  }

  const r = await processarJobMaps({}, JOB_BASE.id, { db, maps })

  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'provider_failed')
  assert.equal(db.state.source.source_state, LS.SOURCE_STATE.PROVIDER_FAILED)
  assert.equal(db.state.job.status, LS.JOB_STATUS.FAILED)
})

test('lead-search worker: snapshot ready salva registros brutos para persistencia', async () => {
  const db = criarDbFake({ source: { external_snapshot_id: 'snap-ready' } })
  const maps = {
    async estadoBuscaMaps() { return 'ready' },
    async snapshotRegistrosMaps() { return [REGISTRO_MAPS] },
  }

  const r = await processarJobMaps({}, JOB_BASE.id, { db, maps })

  assert.equal(r.ok, true)
  assert.equal(r.status, LS.JOB_STATUS.COMPLETED)
  assert.deepEqual(db.state.registros, [REGISTRO_MAPS])
  assert.equal(db.state.source.source_state, LS.SOURCE_STATE.FOUND)
})
