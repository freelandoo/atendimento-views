'use strict'

const assert = require('node:assert')
const test = require('node:test')

function mockAIProvider(textOut) {
  return {
    async generateAIResponse() {
      return { text: typeof textOut === 'function' ? textOut() : textOut, provider: 'mock', model: 'mock' }
    },
  }
}

const pool = { async query() { return { rows: [] } } }

test('decidirRespostaComPlaybook corrige fuga quando lead pede preco e playbook tem valor', async () => {
  const ai = mockAIProvider(JSON.stringify({
    mensagem_pro_lead: 'Sobre o preço, preciso entender melhor o que você precisa.',
    etapa_proxima: 'diagnostico',
    atualizar_perfil: {},
    precisa_handoff: false,
    sugestao_aprendizado: null,
  }))
  const { decidirRespostaComPlaybook } = require('../src/services/contexto2-runtime')
  const d = await decidirRespostaComPlaybook({
    pool, log: console,
    playbook: {
      json: {
        precos_planos: 'R$ 300 ao ano',
        cadastro_e_onboarding: {
          link_cadastro: 'https://www.freelandoo.com.br/',
          perguntas_para_direcionar: ['Você quer vender serviços, criar cursos ou captar clientes?'],
        },
        links_uteis_estruturados: [{ label: 'Site', url: 'https://www.freelandoo.com.br/' }],
      },
    },
    historico: [],
    mensagem: 'como faço pra me cadastrar e qual o custo?',
    leadInsights: {},
    extracao: { intencoes: ['cadastro', 'preco'] },
    empresaId: 'e',
    conversaId: 'c',
    leadPhone: '+55',
    aiProvider: ai,
  })

  assert.match(d.mensagem_pro_lead, /R\$\s?300 ao ano/i)
  assert.match(d.mensagem_pro_lead, /https:\/\/www\.freelandoo\.com\.br/i)
  assert.doesNotMatch(d.mensagem_pro_lead, /preciso entender melhor/i)
})

test('extrairEDecidirBundle corrige resposta sem valor quando playbook tem preco', async () => {
  const ai = mockAIProvider(JSON.stringify({
    extracao: { intencoes: ['preco'], intencao_principal: 'preco', intencao: 'preco' },
    decisao: {
      mensagem_pro_lead: 'Pra te passar valor, preciso entender melhor.',
      etapa_proxima: 'diagnostico',
      atualizar_perfil: {},
      precisa_handoff: false,
      sugestao_aprendizado: null,
    },
  }))
  const { extrairEDecidirBundle } = require('../src/services/contexto2-runtime')
  const r = await extrairEDecidirBundle({
    pool, log: console,
    playbook: { json: { precos_planos: 'R$ 300 ao ano' } },
    historico: [],
    mensagem: 'qual o valor?',
    leadInsights: {},
    empresaId: 'e',
    conversaId: 'c',
    leadPhone: '+55',
    aiProvider: ai,
  })

  assert.match(r.decisao.mensagem_pro_lead, /R\$\s?300 ao ano/i)
  assert.doesNotMatch(r.decisao.mensagem_pro_lead, /preciso entender melhor/i)
})
