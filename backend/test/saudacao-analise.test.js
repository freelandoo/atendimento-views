'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { gerarSaudacaoAnalise } = require('../src/services/saudacao-analise')

// Sem contextoId, gerarSaudacaoAnalise não toca o banco — pool nunca é usado.
const poolNoop = { query: async () => { throw new Error('não deveria consultar o banco') } }
const json = { fonte: 'google_places', empresa: { nome: 'Padaria X' }, lacunas: ['site'] }

test('inclui instruções e dados do lead no prompt e devolve o texto da IA', async () => {
  let capturado = null
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null,
    jsonApresentacao: json, instrucoes: 'tom informal, oferta de site', nomeLead: 'Padaria X',
    _generate: async (input) => { capturado = input; return { text: 'Olá Padaria X! Vi que você não tem site…' } },
  })
  assert.strictEqual(out, 'Olá Padaria X! Vi que você não tem site…')
  assert.match(capturado.userPrompt, /INSTRUÇÕES EXTRAS DA EMPRESA/)
  assert.match(capturado.userPrompt, /tom informal, oferta de site/)
  assert.match(capturado.userPrompt, /DADOS DO LEAD/)
  assert.match(capturado.userPrompt, /Padaria X/)
})

test('não vaza o campo .prompt do json de apresentação para a IA', async () => {
  let capturado = null
  await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null,
    jsonApresentacao: { ...json, prompt: 'PROMPT_GENERICO_NAO_DEVE_VAZAR' },
    _generate: async (input) => { capturado = input; return { text: 'ok' } },
  })
  assert.doesNotMatch(capturado.userPrompt, /PROMPT_GENERICO_NAO_DEVE_VAZAR/)
})

test('saída vazia conta como falha (retorna "")', async () => {
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null, jsonApresentacao: json,
    _generate: async () => ({ text: '   ' }),
  })
  assert.strictEqual(out, '')
})

test('saída acima de 500 chars conta como falha (retorna "")', async () => {
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null, jsonApresentacao: json,
    _generate: async () => ({ text: 'x'.repeat(501) }),
  })
  assert.strictEqual(out, '')
})

test('provider que lança nunca propaga (retorna "")', async () => {
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null, jsonApresentacao: json,
    _generate: async () => { throw new Error('boom') },
  })
  assert.strictEqual(out, '')
})
