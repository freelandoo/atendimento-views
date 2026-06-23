'use strict'

const assert = require('node:assert')
const test = require('node:test')

function mockAIProvider(textOut, calls = []) {
  return {
    async generateAIResponse(input) {
      calls.push(input)
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

test('Contexto 2 injeta apelido no prompt de resposta separado', async () => {
  const calls = []
  const ai = mockAIProvider(JSON.stringify({
    mensagem_pro_lead: 'Oi Ana, consigo te ajudar.',
    etapa_proxima: 'diagnostico',
    atualizar_perfil: {},
    precisa_handoff: false,
    sugestao_aprendizado: null,
  }), calls)
  const { decidirRespostaComPlaybook } = require('../src/services/contexto2-runtime')
  await decidirRespostaComPlaybook({
    pool, log: console,
    playbook: { json: {} },
    historico: [],
    mensagem: 'oi',
    leadInsights: {},
    extracao: {},
    apelido: 'Ana',
    empresaId: 'e',
    conversaId: 'c',
    leadPhone: '+55',
    aiProvider: ai,
  })

  assert.match(calls[0].userPrompt, /NOME DO LEAD/)
  assert.match(calls[0].userPrompt, /Ana/)
  assert.match(calls[0].userPrompt, /nao repita o nome em toda mensagem/)
})

test('Contexto 2 injeta apelido no prompt bundle', async () => {
  const calls = []
  const ai = mockAIProvider(JSON.stringify({
    extracao: { intencoes: ['duvida'], intencao_principal: 'duvida', intencao: 'duvida' },
    decisao: {
      mensagem_pro_lead: 'Oi Bia, claro.',
      etapa_proxima: 'diagnostico',
      atualizar_perfil: {},
      precisa_handoff: false,
      sugestao_aprendizado: null,
    },
  }), calls)
  const { extrairEDecidirBundle } = require('../src/services/contexto2-runtime')
  await extrairEDecidirBundle({
    pool, log: console,
    playbook: { json: {} },
    historico: [],
    mensagem: 'oi',
    leadInsights: {},
    apelido: 'Bia',
    empresaId: 'e',
    conversaId: 'c',
    leadPhone: '+55',
    aiProvider: ai,
  })

  assert.match(calls[0].userPrompt, /NOME DO LEAD/)
  assert.match(calls[0].userPrompt, /Bia/)
})

test('Contexto 2 bundle tem gate de agenda no system prompt e na extracao', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'contexto2-runtime.js'), 'utf8')

  assert.match(fonte, /const systemPrompt = usaAgenda \? BUNDLE_SYSTEM : BUNDLE_SYSTEM \+ REPLY_SEM_AGENDA/)
  assert.match(fonte, /if \(!usaAgenda\) _neutralizarAgendaDesligada\(extracao, decisao\)/)
})
