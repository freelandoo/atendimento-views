'use strict'

/**
 * Confirma que a rota /dashboard/teste-ia (simulador) aplica o MESMO
 * validador de acao que o bot real do WhatsApp.
 *
 * Bug original: o simulador chamava o LLM e renderizava direto, sem passar
 * pelo validarRespostaPorAcao. Resultado: riscos criticos como pedido de
 * CPF/pagamento ou link desconhecido passavam no simulador mas o WhatsApp
 * real bloqueava. Quebrava a confianca da equipe nos testes.
 *
 * Apos o fix, qualquer resposta do LLM no simulador passa pelo orquestrador
 * + validator. Se for bloqueada, a resposta exibida no painel ja vem
 * substituida pelo fallback contextual.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')

const registerAITestRoutes = require('../src/ai-test-routes')

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

function aiProviderMockComResposta(rawJsonText) {
  return {
    generateAIResponse: async () => ({
      text: rawJsonText,
      provider: 'openai',
      model: 'gpt-4o',
      httpStatus: 200,
      stopReason: 'stop',
      usage: { input_tokens: 100, output_tokens: 40 },
      fallback_used: false,
    }),
  }
}

async function montarApp({ aiProvider }) {
  const app = express()
  app.use(express.json())
  // bypass dashboard auth pra teste — injetamos dashboardUser
  app.use((req, _res, next) => {
    req.dashboardUser = { id: 1, role: 'admin' }
    next()
  })
  registerAITestRoutes(app, {
    pool: { query: async () => ({ rows: [] }) },
    logger: silentLogger(),
    aiProvider,
    montarSystemPromptDinamico: () => 'Você é o assistente. Responda APENAS com JSON.',
  })
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      resolve({ server, port: server.address().port })
    })
  })
}

function chamarTesteIA(port, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/dashboard/teste-ia',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => { chunks += c })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) })
          } catch (e) {
            resolve({ status: res.statusCode, body: chunks })
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

test('simulador: pedido de CPF/pagamento do LLM passa (LLM no controle)', async () => {
  // Decisao do dono (2026-06-06): LLM 100% no controle. O validador NAO substitui
  // mais a resposta por fallback nesse caso — a mensagem da IA segue para o lead.
  const respostaLlmRuim = JSON.stringify({
    mensagem_pro_lead: 'Me passa seu CPF e uma chave Pix para eu iniciar o pagamento por aqui?',
    mensagens_bolhas: [
      'Me passa seu CPF e uma chave Pix para eu iniciar o pagamento por aqui?',
    ],
    atualizar_perfil: {},
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })

  const { server, port } = await montarApp({
    aiProvider: aiProviderMockComResposta(respostaLlmRuim),
  })

  try {
    const r = await chamarTesteIA(port, {
      leadMessage: 'quero ver valores',
      context: {
        stage: 'diagnostico',
        leadName: 'Teste',
        businessType: 'restaurante',
        city: 'Salvador',
      },
      history: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋 Com o que voce trabalha hoje?' },
        { role: 'user', content: 'Restaurante na Bahia' },
        { role: 'assistant', content: 'Otimo! Restaurante na Bahia — qual cidade?' },
        { role: 'user', content: 'Salvador' },
        { role: 'assistant', content: 'Perfeito, restaurante em Salvador. Hoje seus clientes chegam por indicacao, redes sociais ou Google?' },
      ],
    })

    assert.equal(r.status, 200, `esperava 200, obtido ${r.status}`)
    const resp = r.body
    const respostaExibida = typeof resp.result?.reply === 'string' ? resp.result.reply : ''

    // Com LLM no controle, a resposta da IA segue sem ser substituida por fallback.
    assert.ok(respostaExibida.length > 0)
    assert.match(respostaExibida, /CPF/i,
      `simulador deveria deixar a resposta da IA passar. Recebido: ${respostaExibida}`)
  } finally {
    server.close()
  }
})

test('simulador: resposta normal do LLM passa sem alteracao', async () => {
  const respostaLlmBoa = JSON.stringify({
    mensagem_pro_lead: 'Faz sentido. Voce ja tem um site hoje ou so o Instagram?',
    mensagens_bolhas: ['Faz sentido. Voce ja tem um site hoje ou so o Instagram?'],
    atualizar_perfil: {},
    etapa_proxima: 'diagnostico',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  })

  const { server, port } = await montarApp({
    aiProvider: aiProviderMockComResposta(respostaLlmBoa),
  })

  try {
    const r = await chamarTesteIA(port, {
      leadMessage: 'Instagram',
      context: {
        stage: 'diagnostico',
        leadName: 'Teste',
        businessType: 'restaurante',
        city: 'Salvador',
      },
      history: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Oi! Tudo bem?' },
      ],
    })
    assert.equal(r.status, 200)
    const respostaExibida = typeof r.body.result?.reply === 'string' ? r.body.result.reply : ''
    assert.match(respostaExibida, /Voce ja tem um site/i,
      `resposta legitima deve passar intacta. Recebido: ${respostaExibida}`)
  } finally {
    server.close()
  }
})

test('simulador: aceite de reuniao com perfil extraido pela IA nao vira fallback de dado faltante', async () => {
  const respostaAgenda = '```json\n' + JSON.stringify({
    mensagens_bolhas: [
      'Perfeito! Vou agendar com a equipe da PJ Codeworks.',
      'Qual horario funciona melhor pra voce? Tenho amanha 19:30 ou 20:15 disponiveis.',
    ],
    atualizar_perfil: {
      negocio: 'restaurante',
      cidade: 'Salvador',
      temperatura_lead: 'quente',
    },
    etapa_proxima: 'proposta',
    reuniao_proposta: {
      necessaria: true,
      horarios_sugeridos: ['19:30', '20:15'],
      duracao_maxima_minutos: 15,
    },
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
  }, null, 2) + '\n```'

  const { server, port } = await montarApp({
    aiProvider: aiProviderMockComResposta(respostaAgenda),
  })

  try {
    const r = await chamarTesteIA(port, {
      leadMessage: 'Claro',
      context: {
        stage: 'primeiro_contato',
        leadName: 'Lead Teste',
        businessType: '',
        city: '',
        need: 'ia',
      },
      history: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋 Com o que você trabalha hoje.' },
        { role: 'user', content: 'Restaurante na Bahia Salvador' },
        { role: 'assistant', content: 'Otimo! Restaurante em Salvador. Hoje seus clientes chegam mais por indicacao, redes sociais ou ja pesquisam no Google?' },
        { role: 'user', content: 'Instagram' },
        { role: 'assistant', content: 'Entendi, o Instagram ajuda bastante na vitrine dos pratos. Voce ja tem um site tambem ou so o Instagram por enquanto?' },
        { role: 'user', content: 'Instagram aprenas' },
        { role: 'assistant', content: 'Faz sentido. Um site complementa bem: aparece no Google quando alguem procura restaurante em Salvador.' },
        { role: 'user', content: 'Entendi' },
        { role: 'assistant', content: 'Posso te chamar pra uma conversa rapida de 15 minutos com a equipe pra te apresentar como ficaria na pratica?' },
      ],
    })

    assert.equal(r.status, 200)
    const respostaExibida = typeof r.body.result?.reply === 'string' ? r.body.result.reply : ''
    assert.match(respostaExibida, /19:30|20:15/,
      `aceite de reuniao deve preservar slots oferecidos. Recebido: ${respostaExibida}`)
    assert.doesNotMatch(respostaExibida, /qual e o tipo do seu negocio|o que voce quer construir/i,
      `nao deve cair em fallback de dado faltante. Recebido: ${respostaExibida}`)
  } finally {
    server.close()
  }
})
