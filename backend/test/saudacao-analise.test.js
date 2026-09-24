'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { gerarSaudacaoAnalise } = require('../src/services/saudacao-analise')

// Sem contextoId, gerarSaudacaoAnalise não toca o banco — pool nunca é usado.
const poolNoop = { query: async () => { throw new Error('não deveria consultar o banco') } }
const json = { fonte: 'google_places', empresa: { nome: 'Padaria X' }, lacunas: ['site'] }
const respostaJson = {
  schema_version: 'abordagem_inicial_v1',
  mensagem: 'Oi, tudo bem? Sou da nossa empresa. Ja deixei uma previa de site pronta aqui no atendimento para Padaria X. Vi que voce nao tem site proprio confirmado. Hoje voce gostaria de trazer mais pedidos pelo WhatsApp?',
  angulo: 'sem_site',
  sinais_usados: ['sem site proprio confirmado'],
  pergunta_final: 'Hoje voce gostaria de trazer mais pedidos pelo WhatsApp?',
  confianca: 0.8,
}

test('inclui instruções e dados do lead no prompt e devolve a mensagem do contrato JSON da IA', async () => {
  let capturado = null
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null,
    jsonApresentacao: json, instrucoes: 'tom informal, oferta de site', nomeLead: 'Padaria X',
    _generate: async (input) => { capturado = input; return { text: JSON.stringify(respostaJson) } },
  })
  assert.strictEqual(out, respostaJson.mensagem)
  assert.match(capturado.systemPrompt, /contrato JSON/)
  assert.match(capturado.systemPrompt, /abordagem_inicial_v1/)
  assert.match(capturado.userPrompt, /INSTRUCOES EXTRAS DA EMPRESA/)
  assert.match(capturado.userPrompt, /tom informal, oferta de site/)
  assert.match(capturado.userPrompt, /DADOS DO LEAD/)
  assert.match(capturado.userPrompt, /Padaria X/)
})

test('não vaza o campo .prompt do json de apresentação para a IA', async () => {
  let capturado = null
  await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null,
    jsonApresentacao: { ...json, prompt: 'PROMPT_GENERICO_NAO_DEVE_VAZAR' },
    _generate: async (input) => { capturado = input; return { text: JSON.stringify(respostaJson) } },
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
  const contratoLongo = { ...respostaJson, mensagem: 'x'.repeat(501) }
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null, jsonApresentacao: json,
    _generate: async () => ({ text: JSON.stringify(contratoLongo) }),
  })
  assert.strictEqual(out, '')
})

test('texto livre sem contrato JSON conta como falha (retorna "")', async () => {
  const out = await gerarSaudacaoAnalise({
    pool: poolNoop, empresaId: 'e1', contextoId: null, jsonApresentacao: json,
    _generate: async () => ({ text: 'Oi, tudo bem? Tenho uma previa pronta.' }),
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
