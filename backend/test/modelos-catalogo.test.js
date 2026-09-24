'use strict'
const { test } = require('node:test')
const assert = require('node:assert')

const { priceFor, computeCost, AI_MODEL_PRESETS, validarProviderModel } = require('../src/ai-provider')

// Catalogo de modelos e precos (R8 do REFACTOR_REPORT).
//
// ⚠️ PRECO E CONTABILIDADE HISTORICA, nao configuracao. `computeCost` devolve `null` quando o
// modelo nao esta na tabela, e o painel de Uso & Custo mostra isso como **0**. Entao remover uma
// linha de preco nao "limpa" o catalogo: reescreve o passado, zerando o custo ja registrado
// daquele modelo. Por isso `gpt-3.5-turbo` continua na tabela mesmo tendo saido da lista de
// modelos selecionaveis.

test('a geracao 5 tem preco — sem isso o custo dela apareceria como ZERO no painel', () => {
  const esperados = {
    'claude-fable-5-1': [10, 50],
    'claude-opus-5-5': [4, 20],
    'claude-opus-5': [5, 25],
    'claude-sonnet-5': [2, 10],
  }
  for (const [modelo, [entrada, saida]] of Object.entries(esperados)) {
    const p = priceFor(modelo)
    assert.ok(p, `${modelo} sem preco`)
    assert.equal(Math.round(p.input * 1e6), entrada, `${modelo}: input por 1M`)
    assert.equal(Math.round(p.output * 1e6), saida, `${modelo}: output por 1M`)
  }
})

test('claude-opus-5 e claude-opus-5-5 nao se confundem, apesar do prefixo comum', () => {
  // `priceFor` casa por prefixo quando o id vem com sufixo de data. Com os dois no catalogo,
  // um casamento frouxo faria a versao mais barata (5.5) ser cobrada como a mais cara (5), ou
  // o contrario — e ninguem perceberia, porque o numero continua "plausivel".
  assert.equal(Math.round(priceFor('claude-opus-5').input * 1e6), 5)
  assert.equal(Math.round(priceFor('claude-opus-5-5').input * 1e6), 4)
  // id com sufixo de data cai no modelo certo, nao no vizinho
  assert.equal(Math.round(priceFor('claude-opus-5-20260401').input * 1e6), 5)
  assert.equal(Math.round(priceFor('claude-opus-5-5-20260401').input * 1e6), 4)
})

test('modelo desconhecido devolve null — nunca um preco chutado', () => {
  assert.equal(priceFor('modelo-que-nao-existe'), null)
  assert.equal(computeCost('modelo-que-nao-existe', 1000, 1000), null)
})

test('preco historico continua no catalogo mesmo fora da lista selecionavel', () => {
  assert.ok(priceFor('gpt-3.5-turbo'), 'gpt-3.5-turbo precisa manter preco (custo ja registrado)')
  const opcoes = AI_MODEL_PRESETS.openai.models.map((m) => m.value)
  assert.ok(!opcoes.includes('gpt-3.5-turbo'), 'mas nao deve mais ser oferecido para escolha')
})

test('todo modelo OFERECIDO tem preco — senao o painel mentiria por escolha nossa', () => {
  for (const [provider, preset] of Object.entries(AI_MODEL_PRESETS)) {
    for (const m of preset.models) {
      assert.ok(priceFor(m.value), `${provider}/${m.value} e selecionavel e nao tem preco`)
    }
    assert.ok(priceFor(preset.defaultModel), `${provider}: defaultModel sem preco`)
  }
})

test('tirar um modelo da lista NAO invalida empresa que ja o tinha salvo', () => {
  // A validacao e por PREFIXO, nao pela lista. E isso que torna seguro deixar de oferecer um
  // modelo legado sem quebrar quem ja o escolheu.
  assert.deepEqual(validarProviderModel('openai', 'gpt-3.5-turbo'), { ok: true })
  assert.equal(validarProviderModel('openai', 'claude-opus-5').ok, false, 'e o cruzamento continua barrado')
  assert.equal(validarProviderModel('anthropic', 'gpt-4o').ok, false)
})
