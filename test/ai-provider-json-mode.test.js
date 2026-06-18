'use strict'

/**
 * Garante que `response_format: json_object` so e enviado a OpenAI quando
 * o prompt menciona JSON. Caso contrario, a OpenAI rejeita com 400 e o
 * teste de conectividade (/dashboard/ai/test) falha.
 *
 * Bug observado em 2026-05-24: teste gpt-4o falhava em ~1s com 400 porque
 * o prompt de teste era "Responda apenas: Motor de IA ativo." (sem JSON)
 * mas o codigo forcava response_format json_object.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// Interceptar require('axios') para capturar o body enviado a OpenAI
function withAxiosMock(fn) {
  const requestsCaptured = []
  const originalResolve = Module._resolveFilename
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'axios') {
      return {
        post: async (url, body /*, opts */) => {
          requestsCaptured.push({ url, body })
          return {
            status: 200,
            data: {
              model: body.model,
              choices: [{ message: { content: 'Motor de IA ativo.' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            },
          }
        },
      }
    }
    return originalLoad.apply(this, arguments)
  }
  try {
    // Limpa cache do ai-provider para forcar re-load com axios mockado
    delete require.cache[require.resolve('../src/ai-provider')]
    return fn(requestsCaptured)
  } finally {
    Module._load = originalLoad
    Module._resolveFilename = originalResolve
    delete require.cache[require.resolve('../src/ai-provider')]
  }
}

test('OpenAI: SEM responseFormatJson NAO envia response_format (default seguro)', async () => {
  process.env.OPENAI_KEY = 'sk-test-fake'
  await withAxiosMock(async (requests) => {
    const { generateAIResponse } = require('../src/ai-provider')
    const fakePool = {
      query: async (sql) => {
        if (/SELECT/i.test(sql)) return { rows: [{ provider: 'openai', model: 'gpt-4o', temperature: 0, max_tokens: 40, fallback_enabled: false }] }
        return { rows: [] }
      },
    }
    await generateAIResponse(
      {
        systemPrompt: 'Você é o motor de IA da PJ Codeworks em modo de verificação de conectividade.',
        userPrompt: 'Responda apenas: "Motor de IA ativo."',
        task: 'teste_principal',
        provider: 'openai',
        model: 'gpt-4o',
        maxTokens: 40,
        temperature: 0,
        disableFallback: true,
      },
      fakePool
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.response_format, undefined,
      'response_format nao deve ser enviado quando responseFormatJson nao e true')
  })
})

test('OpenAI: prompt COM "JSON" mas SEM responseFormatJson NAO ativa json_object', async () => {
  // Garante que a heuristica antiga foi removida: a presenca da palavra JSON
  // no prompt NAO deve mais forcar response_format. Bug em producao 2026-05-28:
  // prompt de prospeccao dizia "sem JSON" e a heuristica ativava json_object,
  // fazendo a OpenAI retornar {"text":"..."} literal que ia parar no lead.
  process.env.OPENAI_KEY = 'sk-test-fake'
  await withAxiosMock(async (requests) => {
    const { generateAIResponse } = require('../src/ai-provider')
    const fakePool = {
      query: async (sql) => {
        if (/SELECT/i.test(sql)) return { rows: [{ provider: 'openai', model: 'gpt-4o', temperature: 0.4, max_tokens: 1200, fallback_enabled: false }] }
        return { rows: [] }
      },
    }
    await generateAIResponse(
      {
        systemPrompt: 'Retorne APENAS o texto da mensagem, sem JSON e sem markdown.',
        userPrompt: 'Diga oi.',
        task: 'mensagem_livre',
        provider: 'openai',
        model: 'gpt-4o',
        disableFallback: true,
      },
      fakePool
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.response_format, undefined,
      'response_format nao deve ser enviado mesmo com "JSON" no prompt (heuristica removida)')
  })
})

test('OpenAI: responseFormatJson:true ativa response_format json_object (opt-in)', async () => {
  process.env.OPENAI_KEY = 'sk-test-fake'
  await withAxiosMock(async (requests) => {
    const { generateAIResponse } = require('../src/ai-provider')
    const fakePool = {
      query: async (sql) => {
        if (/SELECT/i.test(sql)) return { rows: [{ provider: 'openai', model: 'gpt-4o', temperature: 0.4, max_tokens: 1200, fallback_enabled: false }] }
        return { rows: [] }
      },
    }
    await generateAIResponse(
      {
        systemPrompt: 'Você é o assistente. Responda APENAS com um objeto JSON valido.',
        userPrompt: 'Diga oi.',
        task: 'agent_turn',
        provider: 'openai',
        model: 'gpt-4o',
        responseFormatJson: true,
        disableFallback: true,
      },
      fakePool
    )
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].body.response_format, { type: 'json_object' },
      'response_format json_object deve ser enviado quando o caller passa responseFormatJson:true')
  })
})

const SCHEMA_FAKE = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } }
const poolOpenAI = {
  query: async (sql) =>
    /SELECT/i.test(sql)
      ? { rows: [{ provider: 'openai', model: 'gpt-4o', temperature: 0.4, max_tokens: 1200, fallback_enabled: false }] }
      : { rows: [] },
}

test('OpenAI: responseSchema ativa json_schema strict (Structured Outputs)', async () => {
  process.env.OPENAI_KEY = 'sk-test-fake'
  delete process.env.AI_STRUCTURED_OUTPUTS
  await withAxiosMock(async (requests) => {
    const { generateAIResponse } = require('../src/ai-provider')
    await generateAIResponse(
      { systemPrompt: 'x', userPrompt: 'y', task: 'agent_turn', provider: 'openai', model: 'gpt-4o', responseFormatJson: true, responseSchema: SCHEMA_FAKE, disableFallback: true },
      poolOpenAI
    )
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.response_format.type, 'json_schema')
    assert.equal(requests[0].body.response_format.json_schema.strict, true)
    assert.deepEqual(requests[0].body.response_format.json_schema.schema, SCHEMA_FAKE)
  })
})

test('OpenAI: AI_STRUCTURED_OUTPUTS=off volta para json_object mesmo com responseSchema', async () => {
  process.env.OPENAI_KEY = 'sk-test-fake'
  process.env.AI_STRUCTURED_OUTPUTS = 'off'
  try {
    await withAxiosMock(async (requests) => {
      const { generateAIResponse } = require('../src/ai-provider')
      await generateAIResponse(
        { systemPrompt: 'x', userPrompt: 'y', task: 'agent_turn', provider: 'openai', model: 'gpt-4o', responseFormatJson: true, responseSchema: SCHEMA_FAKE, disableFallback: true },
        poolOpenAI
      )
      assert.deepEqual(requests[0].body.response_format, { type: 'json_object' })
    })
  } finally {
    delete process.env.AI_STRUCTURED_OUTPUTS
  }
})

test('OpenAI: schema recusado (400) degrada para json_object (fallback gracioso)', async () => {
  process.env.OPENAI_KEY = 'sk-test-fake'
  delete process.env.AI_STRUCTURED_OUTPUTS
  const bodies = []
  const originalLoad = Module._load
  Module._load = function (request) {
    if (request === 'axios') {
      return {
        post: async (url, body) => {
          bodies.push(body)
          if (body.response_format && body.response_format.type === 'json_schema') {
            const e = new Error('Invalid schema')
            e.response = { status: 400, data: { error: { message: 'bad schema' } } }
            throw e
          }
          return { status: 200, data: { model: body.model, choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] } }
        },
      }
    }
    return originalLoad.apply(this, arguments)
  }
  try {
    delete require.cache[require.resolve('../src/ai-provider')]
    const { generateAIResponse } = require('../src/ai-provider')
    await generateAIResponse(
      { systemPrompt: 'x', userPrompt: 'y', task: 'agent_turn', provider: 'openai', model: 'gpt-4o', responseFormatJson: true, responseSchema: SCHEMA_FAKE, disableFallback: true },
      poolOpenAI,
      { warn: () => {}, info: () => {}, error: () => {} }
    )
    assert.equal(bodies.length, 2, 'deve tentar json_schema e depois json_object')
    assert.equal(bodies[0].response_format.type, 'json_schema')
    assert.deepEqual(bodies[1].response_format, { type: 'json_object' })
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve('../src/ai-provider')]
  }
})
