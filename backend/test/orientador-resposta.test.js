'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  gerarOrientacaoResposta,
  normalizarOrientacao,
} = require('../src/services/orientador-resposta')

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111'
const NUMERO = '5511999999999@s.whatsapp.net'

test('orientador normaliza JSON da IA em explicacao e resposta editavel', () => {
  const out = normalizarOrientacao(JSON.stringify({
    explicacao: 'Retoma a dor principal e conduz para um proximo passo leve.',
    resposta: 'Faz sentido. Pelo que voce contou, eu seguiria por um caminho simples primeiro. Quer que eu te mostre?',
    confianca: 'alta',
    alertas: ['Nao citar preco sem contexto.'],
  }))

  assert.equal(out.confianca, 'alta')
  assert.match(out.explicacao, /Retoma a dor/)
  assert.match(out.resposta, /caminho simples/)
  assert.deepEqual(out.alertas, ['Nao citar preco sem contexto.'])
})

test('orientador busca conversa da empresa, usa playbook e nao envia mensagem', async () => {
  const chamadas = []
  const pool = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      if (/SELECT c\.numero/.test(sql)) {
        assert.equal(params[0], EMPRESA_ID)
        assert.equal(params[2], NUMERO)
        return {
          rows: [{
            numero: NUMERO,
            empresa_id: EMPRESA_ID,
            historico: [
              { role: 'user', content: 'Quero melhorar os pedidos pelo WhatsApp.' },
              { role: 'assistant', content: 'Hoje voce recebe muitos pedidos manualmente?' },
              { role: 'user', content: 'Sim, fica tudo baguncado.' },
            ],
            estagio: 'diagnostico',
            status: 'ativo',
            agente_pausado: true,
            evolution_instance: 'inst-main',
            atualizado_em: '2026-07-22T12:00:00.000Z',
            negocio: 'restaurante',
            cidade: 'Sao Paulo',
            temperatura_lead: 'quente',
            score_lead: 70,
            dor_principal: 'pedidos desorganizados',
            produto_sugerido: 'sistema de pedidos',
            intencao_principal: 'organizar atendimento',
          }],
        }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  }

  let inputGerado = null
  const contextoChamadas = []
  const out = await gerarOrientacaoResposta({
    pool,
    empresaId: EMPRESA_ID,
    numero: NUMERO,
    _buscarContexto2Ativo: async (poolArg, empresaId, evolutionInstance) => {
      assert.equal(poolArg, pool)
      contextoChamadas.push({ empresaId, evolutionInstance })
      return {
        json: {
          resumo_empresa: { nome: 'Empresa X' },
          servicos: [{ nome: 'Sistema de pedidos' }],
          regras_de_conversao: { regra_principal: 'Responder direto e propor proximo passo.' },
        },
      }
    },
    _generate: async (input) => {
      inputGerado = input
      return {
        text: JSON.stringify({
          explicacao: 'A resposta reconhece a bagunca nos pedidos e sugere um proximo passo sem pressionar.',
          resposta: 'Entendi. Se hoje os pedidos ficam espalhados, faz sentido organizar primeiro esse fluxo no WhatsApp antes de pensar em algo maior. Quer que eu te mostre um caminho simples?',
          confianca: 'alta',
          alertas: [],
        }),
      }
    },
  })

  assert.equal(out.numero, NUMERO)
  assert.equal(out.confianca, 'alta')
  assert.match(out.explicacao, /sem pressionar/)
  assert.match(out.resposta, /WhatsApp/)
  assert.equal(out.contexto_usado.playbook, true)
  assert.equal(inputGerado.task, 'orientador_resposta')
  assert.equal(inputGerado.responseFormatJson, true)
  assert.match(inputGerado.userPrompt, /Sistema de pedidos/)
  assert.match(inputGerado.userPrompt, /pedidos desorganizados/)
  assert.deepEqual(contextoChamadas, [{ empresaId: EMPRESA_ID, evolutionInstance: 'inst-main' }])
  assert.equal(chamadas.length, 1)
})

test('orientador rejeita conversa inexistente no escopo da empresa', async () => {
  const pool = { query: async () => ({ rows: [] }) }
  await assert.rejects(
    () => gerarOrientacaoResposta({
      pool,
      empresaId: EMPRESA_ID,
      numero: NUMERO,
      _generate: async () => ({ text: '{}' }),
      _buscarContexto2Ativo: async () => null,
    }),
    (err) => err.statusCode === 404 && err.code === 'NOT_FOUND'
  )
})
