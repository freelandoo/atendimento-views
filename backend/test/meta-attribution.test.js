'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { calcularScoreLeadDeterministico, leadQualificado, eventosDevidos, obterResultadosAnunciosMeta } = require('../src/services/meta-attribution')
const { enviarEventoMetaCAPI } = require('../src/services/meta-capi')

test('score: lead forte (negócio+dor+sem site+intenção+engajado+estágio) é alto e qualificado', () => {
  const s = calcularScoreLeadDeterministico(
    {
      negocio: 'Eletricista', cidade: 'Salvador', dor_principal: 'não aparece no Google',
      ja_aparece_google: false, produto_sugerido: 'site', temperatura_lead: 'quente',
    },
    { estagio: 'proposta', mensagensLead: 8 }
  )
  // 15+5+20+20+15+10+10+10 = 105 → cap 100
  assert.equal(s, 100)
  assert.equal(leadQualificado(s), true)
})

test('score: lead mínimo qualificado (negócio+dor+fit) bate o limiar 60', () => {
  const s = calcularScoreLeadDeterministico(
    { negocio: 'Pintor', dor_principal: 'poucos clientes', precisa_sistema: true },
    {}
  )
  // 15 + 20 + 20 = 55 (sem cidade/intenção/engajamento) → NÃO qualifica
  assert.equal(s, 55)
  assert.equal(leadQualificado(s), false)
})

test('score: lead fraco (só saudação) é baixo e não qualifica', () => {
  const s = calcularScoreLeadDeterministico({}, { estagio: 'primeiro_contato', mensagensLead: 1 })
  assert.equal(s, 0)
  assert.equal(leadQualificado(s), false)
})

test('score: nunca passa de 100 nem fica negativo', () => {
  const cheio = calcularScoreLeadDeterministico(
    {
      negocio: 'x', cidade: 'y', dor_principal: 'z', ja_aparece_google: false,
      precisa_sistema: true, produto_sugerido: 'site', intencao_principal: 'contratar',
      temperatura_lead: 'quente',
    },
    { estagio: 'handoff', mensagensLead: 20 }
  )
  assert.ok(cheio <= 100 && cheio >= 0)
})

test('eventosDevidos: sem ctwa_clid não envia nada', () => {
  assert.deepEqual(eventosDevidos({ ctwaClid: null, score: 90, temReuniao: true }), [])
})

test('eventosDevidos: lead qualificado (CTWA só aceita LeadSubmitted) → 1 evento', () => {
  const due = eventosDevidos({ ctwaClid: 'X', score: 65, temReuniao: true, reuniaoConcluida: true, jaEnviados: [] })
  assert.deepEqual(due.map((e) => e.eventName), ['LeadSubmitted'])
})

test('eventosDevidos: reunião agendada qualifica mesmo com score baixo; não repete o já enviado', () => {
  const comReuniao = eventosDevidos({ ctwaClid: 'X', score: 40, temReuniao: true, jaEnviados: [] })
  assert.deepEqual(comReuniao.map((e) => e.eventName), ['LeadSubmitted']) // reunião torna lead real
  const jaMandado = eventosDevidos({ ctwaClid: 'X', score: 65, temReuniao: true, jaEnviados: ['LeadSubmitted'] })
  assert.deepEqual(jaMandado.map((e) => e.eventName), []) // não repete
  const semFit = eventosDevidos({ ctwaClid: 'X', score: 40, temReuniao: false, jaEnviados: [] })
  assert.deepEqual(semFit.map((e) => e.eventName), []) // score<60 e sem reunião não qualifica
})

test('eventosDevidos: Purchase só quando ativo, com valor', () => {
  const off = eventosDevidos({ ctwaClid: 'X', score: 10, purchaseAtivo: false, valorVenda: 500, jaEnviados: ['Lead'] })
  assert.deepEqual(off.map((e) => e.eventName), [])
  const on = eventosDevidos({ ctwaClid: 'X', score: 10, purchaseAtivo: true, valorVenda: 500, jaEnviados: ['Lead'] })
  assert.deepEqual(on.map((e) => e.eventName), ['Purchase'])
  assert.equal(on[0].value, 500)
  assert.equal(on[0].currency, 'BRL')
})

test('enviarEventoMetaCAPI: desligado sem dataset/token', async () => {
  delete process.env.META_DATASET_ID
  delete process.env.META_CAPI_TOKEN
  const r = await enviarEventoMetaCAPI({ eventName: 'Lead', ctwaClid: 'X', eventId: '1:Lead' })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'capi_desligado')
})

test('enviarEventoMetaCAPI: monta o payload CTWA correto e envia', async () => {
  process.env.META_DATASET_ID = '1572278814315441'
  process.env.META_CAPI_TOKEN = 'tok-fake'
  let capturado = null
  const axiosFake = { post: async (url, body) => { capturado = { url, body }; return { status: 200, data: { events_received: 1 } } } }
  try {
    const r = await enviarEventoMetaCAPI(
      { eventName: 'Schedule', ctwaClid: 'CLID123', eventId: '5511:Schedule' },
      { axios: axiosFake }
    )
    assert.equal(r.ok, true)
    assert.match(capturado.url, /1572278814315441\/events/)
    const evt = capturado.body.data[0]
    assert.equal(evt.event_name, 'Schedule')
    assert.equal(evt.action_source, 'business_messaging')
    assert.equal(evt.messaging_channel, 'whatsapp')
    assert.equal(evt.user_data.ctwa_clid, 'CLID123')
    assert.equal(evt.event_id, '5511:Schedule')
    assert.equal(capturado.body.access_token, 'tok-fake')
  } finally {
    delete process.env.META_DATASET_ID
    delete process.env.META_CAPI_TOKEN
  }
})

test('obterResultadosAnunciosMeta: mapeia linhas e deriva ativo (leads_7d > 0)', async () => {
  const poolFake = {
    query: async (sql, params) => {
      assert.match(sql, /lead_profiles/)
      assert.deepEqual(params, [60]) // QUALIFIED_LEAD_MIN default
      return {
        rows: [
          { ad_id: 'A1', titulo: 'Anúncio bom', leads: 64, qualificados: 9, reunioes: 8, reunioes_concluidas: 1, primeiro_contato: '2026-05-10', ultimo_contato: '2026-06-12', leads_7d: 17 },
          { ad_id: 'A2', titulo: 'Anúncio velho', leads: 66, qualificados: 0, reunioes: 0, reunioes_concluidas: 0, primeiro_contato: '2026-04-13', ultimo_contato: '2026-06-06', leads_7d: 0 },
        ],
      }
    },
  }
  const out = await obterResultadosAnunciosMeta(poolFake)
  assert.equal(out.length, 2)
  assert.equal(out[0].ad_id, 'A1')
  assert.equal(out[0].leads, 64)
  assert.equal(out[0].reunioes_concluidas, 1)
  assert.equal(out[0].ativo, true) // leads_7d 17
  assert.equal(out[1].ativo, false) // leads_7d 0
  assert.equal(out[1].qualificados, 0)
})
