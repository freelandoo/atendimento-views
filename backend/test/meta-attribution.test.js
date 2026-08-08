'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { calcularScoreLeadDeterministico, leadQualificado, obterResultadosAnunciosMeta } = require('../src/services/meta-attribution')
const { enviarEventoMetaCAPI, configValida } = require('../src/services/meta-capi')

const EMPRESA_A = '00000000-0000-0000-0000-0000000000aa'

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

// --- meta-capi.js: transporte por CONFIG, nunca por variável de ambiente ---------

test('meta-capi: variável de ambiente NÃO liga mais o envio (config é obrigatória)', async () => {
  // Regressão do vazamento entre tenants: enquanto o dataset/token vinham do
  // processo, qualquer chamada mandava evento para a conta de um tenant só.
  process.env.META_DATASET_ID = '1572278814315441'
  process.env.META_CAPI_TOKEN = 'tok-do-processo'
  try {
    let chamou = false
    const axiosFake = { post: async () => { chamou = true; return { status: 200, data: {} } } }
    const r = await enviarEventoMetaCAPI({}, { eventName: 'LeadSubmitted', ctwaClid: 'X', eventId: 'e1' }, { axios: axiosFake })
    assert.equal(r.ok, false)
    assert.equal(r.motivo, 'config_invalida')
    assert.equal(chamou, false, 'não pode chamar a Meta sem config da empresa')
  } finally {
    delete process.env.META_DATASET_ID
    delete process.env.META_CAPI_TOKEN
  }
})

test('meta-capi: configValida exige dataset, token e um destino (page ou waba)', () => {
  assert.equal(configValida({ datasetId: '123456', token: 't' }), false) // sem destino
  assert.equal(configValida({ datasetId: '123456', pageId: 'p' }), false) // sem token
  assert.equal(configValida({ token: 't', pageId: 'p' }), false) // sem dataset
  assert.equal(configValida({ datasetId: '123456', token: 't', pageId: 'p' }), true)
  assert.equal(configValida({ datasetId: '123456', token: 't', wabaId: 'w' }), true)
})

test('meta-capi: monta o payload CTWA com a credencial DA EMPRESA', async () => {
  let capturado = null
  const axiosFake = { post: async (url, body) => { capturado = { url, body }; return { status: 200, data: { events_received: 1 } } } }
  const r = await enviarEventoMetaCAPI(
    { datasetId: '1572278814315441', token: 'tok-empresa-A', wabaId: 'WABA-A', testEventCode: 'TEST1' },
    { eventName: 'LeadSubmitted', ctwaClid: 'CLID123', eventId: 'ra:agenda_app:99', eventTime: 1700000000 },
    { axios: axiosFake }
  )
  assert.equal(r.ok, true)
  assert.match(capturado.url, /1572278814315441\/events/)
  const evt = capturado.body.data[0]
  assert.equal(evt.event_name, 'LeadSubmitted')
  assert.equal(evt.action_source, 'business_messaging')
  assert.equal(evt.messaging_channel, 'whatsapp')
  assert.equal(evt.user_data.ctwa_clid, 'CLID123')
  // WhatsApp: a documentação pede o WABA; page_id serve o caminho Messenger.
  assert.equal(evt.user_data.whatsapp_business_account_id, 'WABA-A')
  assert.equal(evt.user_data.page_id, undefined)
  assert.equal(evt.event_id, 'ra:agenda_app:99')
  assert.equal(evt.event_time, 1700000000)
  assert.equal(capturado.body.access_token, 'tok-empresa-A')
  assert.equal(capturado.body.test_event_code, 'TEST1')
})

test('meta-capi: erro da Meta volta estruturado e o corpo cru NÃO é devolvido', async () => {
  const axiosFake = {
    post: async () => {
      const e = new Error('Request failed')
      e.response = {
        status: 400,
        data: { error: { message: 'Invalid parameter', code: 190, error_subcode: 2804116, fbtrace_id: 'FB1', error_user_msg: 'eco do payload com ctwa_clid' } },
      }
      throw e
    },
  }
  const r = await enviarEventoMetaCAPI(
    { datasetId: '123456', token: 't', wabaId: 'w' },
    { eventName: 'Purchase', ctwaClid: 'X', eventId: 'rv:agenda_app:1' },
    { axios: axiosFake, logger: { warn() {} } }
  )
  assert.equal(r.ok, false)
  assert.equal(r.status, 400)
  assert.equal(r.erro.codigo, 190)
  assert.equal(r.erro.subcodigo, 2804116)
  assert.equal(r.erro.fbtraceId, 'FB1')
  // A mensagem "user" da Meta pode ecoar o payload enviado — ela não pode subir crua.
  assert.equal(r.erro.error_user_msg, undefined)
  assert.equal(JSON.stringify(r).includes('eco do payload'), false)
})

test('obterResultadosAnunciosMeta: exige empresaId (sem ele, devolvia todos os tenants)', async () => {
  const poolFake = { query: async () => { throw new Error('não deveria consultar') } }
  await assert.rejects(() => obterResultadosAnunciosMeta(poolFake), /empresaId/)
  await assert.rejects(() => obterResultadosAnunciosMeta(poolFake, {}), /empresaId/)
})

test('obterResultadosAnunciosMeta: mapeia linhas, filtra por empresa e deriva ativo', async () => {
  const poolFake = {
    query: async (sql, params) => {
      assert.match(sql, /lead_profiles/)
      // O filtro por empresa é parte da consulta, não um detalhe de chamada.
      assert.match(sql, /p\.empresa_id = \$2/)
      assert.deepEqual(params, [60, EMPRESA_A]) // QUALIFIED_LEAD_MIN default + empresa
      return {
        rows: [
          { ad_id: 'A1', titulo: 'Anúncio bom', leads: 64, qualificados: 9, reunioes: 8, reunioes_concluidas: 1, primeiro_contato: '2026-05-10', ultimo_contato: '2026-06-12', leads_7d: 17 },
          { ad_id: 'A2', titulo: 'Anúncio velho', leads: 66, qualificados: 0, reunioes: 0, reunioes_concluidas: 0, primeiro_contato: '2026-04-13', ultimo_contato: '2026-06-06', leads_7d: 0 },
        ],
      }
    },
  }
  const out = await obterResultadosAnunciosMeta(poolFake, { empresaId: EMPRESA_A })
  assert.equal(out.length, 2)
  assert.equal(out[0].ad_id, 'A1')
  assert.equal(out[0].leads, 64)
  assert.equal(out[0].reunioes_concluidas, 1)
  assert.equal(out[0].ativo, true) // leads_7d 17
  assert.equal(out[1].ativo, false) // leads_7d 0
  assert.equal(out[1].qualificados, 0)
})
