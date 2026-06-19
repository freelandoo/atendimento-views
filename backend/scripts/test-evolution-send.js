'use strict'

/**
 * Script de diagnóstico para testar diferentes formatos de payload
 * contra a API Evolution em produção, sem expor credenciais.
 *
 * Uso: EVOLUTION_TEST_NUMBER=5511987654321 node scripts/test-evolution-send.js
 *
 * Formatos testados:
 * A: { number, text }
 * B: { number, textMessage }
 * C: { number, message: { textMessage: { text } } }
 * D: { jid, message: { textMessage: { text } } }
 */

const axios = require('axios')

const EVOLUTION_URL = process.env.EVOLUTION_URL || 'http://evolution-api:8080'
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE || 'PJ'
const TEST_NUMBER = process.env.EVOLUTION_TEST_NUMBER

if (!EVOLUTION_KEY) {
  console.error('❌ EVOLUTION_API_KEY não configurada')
  process.exit(1)
}

if (!TEST_NUMBER) {
  console.error('❌ EVOLUTION_TEST_NUMBER não configurada')
  console.error('Uso: EVOLUTION_TEST_NUMBER=5511987654321 node scripts/test-evolution-send.js')
  process.exit(1)
}

function redactNumber(n) {
  const s = String(n || '').trim()
  if (s.length <= 4) return s
  return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2)
}

const testMessage = 'Teste de payload - PJ Codeworks'
const testCases = [
  {
    name: 'Formato A: { number, text }',
    payload: {
      number: TEST_NUMBER.replace(/\D/g, ''),
      text: testMessage,
    },
  },
  {
    name: 'Formato B: { number, textMessage }',
    payload: {
      number: TEST_NUMBER.replace(/\D/g, ''),
      textMessage: testMessage,
    },
  },
  {
    name: 'Formato C: { number, message: { textMessage: { text } } }',
    payload: {
      number: TEST_NUMBER.replace(/\D/g, ''),
      message: {
        textMessage: {
          text: testMessage,
        },
      },
    },
  },
  {
    name: 'Formato D: { jid, message: { textMessage: { text } } }',
    payload: {
      jid: TEST_NUMBER.replace(/\D/g, '') + '@s.whatsapp.net',
      message: {
        textMessage: {
          text: testMessage,
        },
      },
    },
  },
  {
    name: 'Formato E: { number, message }',
    payload: {
      number: TEST_NUMBER.replace(/\D/g, ''),
      message: testMessage,
    },
  },
]

async function testarFormato(testCase) {
  try {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`🧪 Testando: ${testCase.name}`)
    console.log(`${'='.repeat(70)}`)

    const safePayload = JSON.stringify(testCase.payload)
      .replace(TEST_NUMBER.replace(/\D/g, ''), redactNumber(TEST_NUMBER))
    console.log(`📦 Payload:\n${safePayload}\n`)

    const response = await axios.post(
      `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
      testCase.payload,
      {
        headers: { apikey: EVOLUTION_KEY },
        timeout: 10000,
      }
    )

    console.log(`✅ SUCESSO (HTTP ${response.status})`)
    console.log(`📨 Response:`)
    console.log(JSON.stringify(response.data, null, 2))
    return { success: true, testCase, response }
  } catch (error) {
    const status = error.response?.status || 'N/A'
    const message = error.response?.data?.message || error.response?.data?.error || error.message
    const errMsg = typeof message === 'object' ? JSON.stringify(message) : String(message)

    console.log(`❌ ERRO (HTTP ${status})`)
    console.log(`📌 Mensagem: ${errMsg}`)

    if (error.response?.data) {
      console.log(`📋 Response body:`)
      console.log(JSON.stringify(error.response.data, null, 2))
    }

    return { success: false, testCase, error: errMsg }
  }
}

async function main() {
  console.log(`\n🚀 TESTE DE COMPATIBILIDADE: Evolution API - sendText Payload`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`URL: ${EVOLUTION_URL}`)
  console.log(`Instance: ${INSTANCE_NAME}`)
  console.log(`Número teste: ${redactNumber(TEST_NUMBER)}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  const results = []

  for (const testCase of testCases) {
    const result = await testarFormato(testCase)
    results.push(result)

    if (result.success) {
      console.log(`\n🎯 FORMATO CORRETO ENCONTRADO!\n`)
      console.log(`✨ Use este payload em src/whatsapp.js:`)
      console.log(`\n${JSON.stringify(testCase.payload, null, 2)}\n`)
      process.exit(0)
    }

    // Aguardar um pouco entre testes
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  console.log(`\n\n${'='.repeat(70)}`)
  console.log(`📊 RESUMO DOS TESTES`)
  console.log(`${'='.repeat(70)}`)

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  console.log(`\n✅ Sucesso: ${successful.length}`)
  successful.forEach((r) => {
    console.log(`   - ${r.testCase.name}`)
  })

  console.log(`\n❌ Falha: ${failed.length}`)
  failed.forEach((r) => {
    console.log(`   - ${r.testCase.name}`)
    console.log(`     Erro: ${r.error.slice(0, 100)}`)
  })

  if (failed.length === testCases.length) {
    console.log(`\n⚠️  Nenhum formato funcionou.`)
    console.log(`Possíveis causas:`)
    console.log(`  1. Evolution API não está acessível em ${EVOLUTION_URL}`)
    console.log(`  2. EVOLUTION_API_KEY está incorreta`)
    console.log(`  3. INSTANCE_NAME (${INSTANCE_NAME}) não existe`)
    console.log(`  4. Número de teste (${redactNumber(TEST_NUMBER)}) é inválido`)
    process.exit(1)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e.message)
  process.exit(1)
})
