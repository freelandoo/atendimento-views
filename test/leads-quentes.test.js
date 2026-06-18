'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { listarLeadsQuentesParaTrabalhar } = require('../src/leads-quentes')

test('listarLeadsQuentesParaTrabalhar: usa limiar/limite default e mapeia os campos', async () => {
  let capturado = null
  const poolFake = {
    query: async (sql, params) => {
      capturado = { sql, params }
      assert.match(sql, /lead_profiles/)
      assert.match(sql, /agenda_eventos/) // exclui quem tem reuniao futura
      return {
        rows: [
          {
            numero: '5511999990001@s.whatsapp.net', atualizado_em: '2026-06-13T12:00:00Z',
            negocio: 'Barbearia', cidade: 'SP', score_lead: 82, temperatura_lead: 'quente',
            dor_principal: 'poucos clientes', produto_sugerido: 'site',
            canal: 'meta', ofereceu_reuniao: true, aguardando_resposta: false,
          },
          {
            numero: '5521988887777@s.whatsapp.net', atualizado_em: '2026-06-13T10:00:00Z',
            negocio: null, cidade: null, score_lead: null, temperatura_lead: null,
            dor_principal: null, produto_sugerido: null,
            canal: 'prospeccao', ofereceu_reuniao: false, aguardando_resposta: true,
          },
        ],
      }
    },
  }
  const out = await listarLeadsQuentesParaTrabalhar(poolFake)
  // params: [QUALIFIED_LEAD_MIN(60), limite(150), dias(45)]
  assert.equal(capturado.params[0], 60)
  assert.equal(capturado.params[1], 150)
  assert.equal(capturado.params[2], 45)
  assert.equal(out.length, 2)
  assert.equal(out[0].numero, '5511999990001@s.whatsapp.net')
  assert.equal(out[0].canal, 'meta')
  assert.equal(out[0].score, 82) // numero, nao string
  assert.equal(out[0].ofereceu_reuniao, true)
  assert.equal(out[1].score, null) // sem score
  assert.equal(out[1].aguardando_resposta, true)
  assert.ok(out[0].ultima_atividade.startsWith('2026-06-13'))
})

test('listarLeadsQuentesParaTrabalhar: respeita limite custom (clamp) e dias', async () => {
  let params = null
  const poolFake = { query: async (_sql, p) => { params = p; return { rows: [] } } }
  await listarLeadsQuentesParaTrabalhar(poolFake, { limite: 5000, diasAtivo: 7 })
  assert.equal(params[1], 500) // limite clampa em 500
  assert.equal(params[2], 7)
})
