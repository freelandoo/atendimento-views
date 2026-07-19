'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { selecionarMercadoDiario, selecionarMercadoDiarioIA } = require('../src/prospecting')

function poolComResultado(rows) {
  return {
    consultas: [],
    async query(sql, params = []) {
      this.consultas.push({ sql, params })
      return { rows }
    },
  }
}

const CONFIG = { categoria_padrao: 'barber', cidade_padrao: 'SP' }

test('selecionarMercadoDiario: usa o mercado do histórico quando disponível', async () => {
  const pool = poolComResultado([{ nicho: 'pizzaria', cidade: 'campinas' }])
  const r = await selecionarMercadoDiario(pool, CONFIG)
  assert.deepEqual(r, { nicho: 'pizzaria', cidade: 'campinas', origem: 'rotacao_historico' })
})

test('selecionarMercadoDiario: cai no padrão da config quando não há histórico', async () => {
  const pool = poolComResultado([])
  const r = await selecionarMercadoDiario(pool, CONFIG)
  assert.deepEqual(r, { nicho: 'barber', cidade: 'SP', origem: 'config_padrao' })
})

test('selecionarMercadoDiario: cai no padrão quando a query falha', async () => {
  const pool = {
    async query() {
      throw new Error('tabela indisponivel')
    },
  }
  const r = await selecionarMercadoDiario(pool, CONFIG)
  assert.equal(r.origem, 'config_padrao')
  assert.equal(r.nicho, 'barber')
  assert.equal(r.cidade, 'SP')
})

test('selecionarMercadoDiario: rankeia por respostas e depois por menos recente', async () => {
  const pool = poolComResultado([{ nicho: 'dentista', cidade: 'santos' }])
  const r = await selecionarMercadoDiario(pool, CONFIG)
  // valida que a query ordena por respostas DESC e ultimo ASC e filtra ruído
  const sql = pool.consultas[0].sql
  assert.match(sql, /ORDER BY respostas DESC, ultimo ASC/)
  assert.match(sql, /HAVING COUNT\(\*\) >= 3/)
  assert.equal(r.nicho, 'dentista')
})

test('selecionarMercadoDiarioIA: IA escolhe nicho+cidade fresco vendo o que já foi prospectado', async () => {
  const pool = poolComResultado([{ nicho: 'barbearia', cidade: 'SP', total: 68, ultimo: new Date('2026-06-01') }])
  const aiProviderFake = {
    generateAIResponse: async (input) => {
      assert.match(input.userPrompt, /barbearia \/ SP/) // recebeu o raio-x dos mercados tocados
      assert.equal(input.model, 'gpt-4o-mini') // modelo barato
      return { text: '{"nicho":"dentista","cidade":"Curitiba - PR","motivo":"fresco"}', provider: 'openai', model: 'gpt-4o-mini' }
    },
  }
  const r = await selecionarMercadoDiarioIA(pool, {}, { aiProvider: aiProviderFake })
  assert.deepEqual(r, { nicho: 'dentista', cidade: 'Curitiba - PR', origem: 'ia', motivo: 'fresco', confianca: 0, estrategia: 'equilibrada' })
})

test('selecionarMercadoDiarioIA: respeita nicho e localização estritos', async () => {
  const pool = poolComResultado([])
  const prompts = []
  const ai = {
    generateAIResponse: async (input) => {
      prompts.push(input.userPrompt)
      return { text: '{"nicho":"dentista","cidade":"Campinas - SP","motivo":"permitido","confianca":91}' }
    },
  }
  const r = await selecionarMercadoDiarioIA(pool, {
    busca_estrategia: 'conservadora',
    busca_nichos_permitidos: ['dentista'],
    busca_localizacoes_permitidas: ['SP'],
    busca_permitir_nichos_relacionados: false,
  }, { aiProvider: ai, maxTentativas: 1 })
  assert.equal(r.nicho, 'dentista')
  assert.equal(r.confianca, 91)
  assert.equal(r.estrategia, 'conservadora')
  assert.match(prompts[0], /Nichos permitidos.*dentista/i)
  assert.match(prompts[0], /Localizações permitidas: SP/i)
})

test('selecionarMercadoDiarioIA: erro persistente → null (SEM fallback; o chamador aborta o dia)', async () => {
  const pool = poolComResultado([])
  const aiFail = { generateAIResponse: async () => { throw new Error('sem chave') } }
  assert.equal(await selecionarMercadoDiarioIA(pool, {}, { aiProvider: aiFail, maxTentativas: 1 }), null)
  const aiLixo = { generateAIResponse: async () => ({ text: 'isso nao e json' }) }
  assert.equal(await selecionarMercadoDiarioIA(pool, {}, { aiProvider: aiLixo, maxTentativas: 1 }), null)
})

test('selecionarMercadoDiarioIA: faz RETRY — falha 1x e acerta na 2a tentativa', async () => {
  const pool = poolComResultado([])
  let n = 0
  const ai = {
    generateAIResponse: async () => {
      n += 1
      if (n === 1) throw new Error('timeout transitorio')
      return { text: '{"nicho":"eletricista","cidade":"Salvador - BA"}', provider: 'openai', model: 'gpt-4o-mini' }
    },
  }
  const r = await selecionarMercadoDiarioIA(pool, {}, { aiProvider: ai, maxTentativas: 3 })
  assert.equal(n, 2) // tentou 2x (1 falha + 1 sucesso)
  assert.equal(r.nicho, 'eletricista')
  assert.equal(r.cidade, 'Salvador - BA')
})
