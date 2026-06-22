'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  montarMensagemFallback,
  limparMensagemGerada,
  gerarMensagemParaItemFila,
  editarMensagemItemFila,
} = require('../src/services/prospecting-message-generation')

const FILA_ID = '11111111-1111-4111-8111-111111111111'
const EXECUCAO_ID = '22222222-2222-4222-8222-222222222222'
const PROSPECT_ID = '33333333-3333-4333-8333-333333333333'

function criarPoolMensagemFake(opts = {}) {
  const state = {
    queries: [],
    decisoes: [],
    fila: {
      id: FILA_ID,
      execucao_id: EXECUCAO_ID,
      prospect_id: PROSPECT_ID,
      telefone_normalizado: '5571999990001',
      nome_lead: 'Restaurante A',
      categoria: 'restaurantes',
      cidade: 'Salvador',
      estado: 'BA',
      status: opts.status || 'simulado',
      ordem: 1,
      slot_envio: opts.slot_envio === undefined ? '2026-05-25T08:00:00Z' : opts.slot_envio,
      mensagem_gerada: null,
      mensagem_editada: null,
      metadata_json: {},
      prospect_nome: 'Restaurante A',
      prospect_nicho: 'restaurantes',
      prospect_cidade: 'Salvador',
      avaliacoes: 45,
      rating: 4.6,
      tem_site: false,
      site: null,
      maps_url: 'https://maps.example/a',
      place_id: 'place-a',
      score: 88,
      raw_json: {},
      data_execucao: '2026-05-25',
      modo_execucao: 'manual',
    },
  }

  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params })

      if (/FROM prospectador\.prospeccao_fila_diaria f/i.test(sql)) {
        return { rows: state.fila ? [state.fila] : [] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET mensagem_gerada/i.test(sql)) {
        state.fila = {
          ...state.fila,
          mensagem_gerada: params[1],
          mensagem_editada: null,
          metadata_json: {
            ...(state.fila.metadata_json || {}),
            ...JSON.parse(params[2]),
          },
        }
        return { rows: [state.fila] }
      }

      if (/INSERT INTO prospectador\.prospeccao_decisoes_ia/i.test(sql)) {
        state.decisoes.push({
          execucao_id: params[0],
          fila_id: params[1],
          provider: params[2],
          model: params[3],
          prompt_version: params[4],
          input_json: JSON.parse(params[5]),
          output_json: JSON.parse(params[6]),
        })
        return { rows: [] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET mensagem_editada/i.test(sql)) {
        state.fila = {
          ...state.fila,
          mensagem_editada: params[1],
          metadata_json: {
            ...(state.fila.metadata_json || {}),
            ...JSON.parse(params[2]),
          },
        }
        return { rows: [state.fila] }
      }

      return { rows: [] }
    },
  }
}

test('mensagem fila: limpa markdown simples retornado pela IA', () => {
  assert.equal(limparMensagemGerada('```text\nOi, teste\n```'), 'Oi, teste')
  assert.equal(limparMensagemGerada('"Oi, teste"'), 'Oi, teste')
})

test('mensagem fila: fallback usa lead, cidade, categoria e nao envia nada', () => {
  const msg = montarMensagemFallback({
    nome_lead: 'Restaurante A',
    categoria: 'restaurantes',
    cidade: 'Salvador',
    rating: 4.6,
    avaliacoes: 45,
  })
  assert.match(msg, /Sou da nossa empresa/)
  assert.match(msg, /Restaurante A/)
  assert.match(msg, /Salvador/)
  assert.match(msg, /restaurantes/)
  assert.doesNotMatch(msg, /reuniao|preco|R\$/i)
})

test('mensagem fila: gera IA somente para item simulado com slot e salva no item + decisao', async () => {
  const pool = criarPoolMensagemFake()
  const chamadas = []
  const aiProvider = {
    generateAIResponse: async (input) => {
      chamadas.push(input)
      return {
        text: 'Opa, tudo bem? Sou da PJ Codeworks. Vi o Restaurante A no Google Maps em Salvador e preparei uma analise rapida sobre presenca digital para restaurantes. Posso te mandar?',
        provider: 'openai',
        model: 'gpt-4o',
        fallback_used: false,
      }
    },
  }

  const r = await gerarMensagemParaItemFila(pool, FILA_ID, { aiProvider })

  assert.equal(r.ok, true)
  assert.equal(r.envio_real_habilitado, false)
  assert.equal(chamadas.length, 1)
  assert.equal(pool.state.fila.mensagem_gerada, r.mensagem_gerada)
  assert.equal(pool.state.fila.mensagem_editada, null)
  assert.equal(pool.state.decisoes.length, 1)
  assert.equal(pool.state.decisoes[0].execucao_id, EXECUCAO_ID)
  assert.equal(pool.state.decisoes[0].fila_id, FILA_ID)
  assert.equal(pool.state.decisoes[0].provider, 'openai')
  assert.equal(pool.state.decisoes[0].input_json.slot_envio, '2026-05-25T08:00:00Z')
  assert.match(pool.state.decisoes[0].output_json.mensagem_gerada, /PJ Codeworks/)
  assert.ok(pool.state.queries.some((q) => /SET mensagem_gerada/i.test(q.sql)))
  assert.equal(pool.state.queries.some((q) => /INSERT INTO vendas\.job_queue/i.test(q.sql)), false)
  assert.equal(pool.state.queries.some((q) => /send_attempts/i.test(q.sql)), false)
})

test('mensagem fila: bloqueia geracao para item aguardando agendamento', async () => {
  const pool = criarPoolMensagemFake({ status: 'aguardando_agendamento', slot_envio: null })
  await assert.rejects(
    () => gerarMensagemParaItemFila(pool, FILA_ID, {
      aiProvider: { generateAIResponse: async () => ({ text: 'nao deveria chamar' }) },
    }),
    /Mensagem so pode ser gerada para item simulado ou agendado/
  )
})

test('mensagem fila: permite edicao manual antes do envio', async () => {
  const pool = criarPoolMensagemFake({ status: 'agendado' })
  const r = await editarMensagemItemFila(pool, FILA_ID, {
    mensagem_editada: 'Opa, tudo bem? Sou da PJ Codeworks. Vi o Restaurante A em Salvador e queria te mandar uma analise rapida da presenca digital de voces. Pode ser?',
  })
  assert.equal(r.ok, true)
  assert.equal(r.envio_real_habilitado, false)
  assert.equal(pool.state.fila.mensagem_editada, r.mensagem_editada)
  assert.equal(r.mensagem_final, r.mensagem_editada)
  assert.ok(pool.state.fila.metadata_json.mensagem_editada_manual)
})

test('mensagem fila: bloqueia edicao manual depois de envio', async () => {
  const pool = criarPoolMensagemFake({ status: 'enviado' })
  await assert.rejects(
    () => editarMensagemItemFila(pool, FILA_ID, { mensagem_editada: 'texto' }),
    /Mensagem so pode ser editada antes do envio/
  )
})
