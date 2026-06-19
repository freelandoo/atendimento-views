'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  idempotencyKeyFila,
  mensagemFinalFila,
  processarEnvioFilaAgendado,
  prepararItemFilaParaJobEnvio,
  marcarJobAgendadoNaFila,
} = require('../src/services/prospecting-send-worker')

const FILA_ID = '11111111-1111-4111-8111-111111111111'
const EXECUCAO_ID = '22222222-2222-4222-8222-222222222222'
const PROSPECT_ID = '33333333-3333-4333-8333-333333333333'

function criarPoolEnvioFake(opts = {}) {
  const state = {
    queries: [],
    attempts: [],
    sent: [],
    duplicateFila: opts.duplicateFila || null,
    jobPendente: opts.jobPendente || null,
    sendAttemptBloqueante: opts.sendAttemptBloqueante || null,
    politica: opts.politica || null,
    conversa: opts.conversa || null,
    fila: {
      id: FILA_ID,
      execucao_id: EXECUCAO_ID,
      prospect_id: PROSPECT_ID,
      telefone_normalizado: '5571999990001',
      nome_lead: 'Restaurante A',
      categoria: 'restaurantes',
      cidade: 'Salvador',
      estado: 'BA',
      status: opts.status || 'agendado',
      ordem: 1,
      slot_envio: opts.slot_envio === undefined ? '2026-05-25T08:00:00Z' : opts.slot_envio,
      mensagem_gerada: opts.mensagem_gerada === undefined ? 'Opa, tudo bem? Sou da PJ Codeworks. Posso te mandar uma analise rapida?' : opts.mensagem_gerada,
      mensagem_editada: opts.mensagem_editada || null,
      job_id: opts.job_id || null,
      tentativas: 0,
      ultimo_erro: null,
      metadata_json: {},
      prospect_nome: 'Restaurante A',
      prospect_telefone: '5571999990001',
      prospect_status: opts.prospect_status || 'aprovado',
      prospect_nicho: 'restaurantes',
      prospect_cidade: 'Salvador',
    },
  }

  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params })

      if (/FROM prospectador\.prospeccao_fila_diaria f/i.test(sql)) {
        return { rows: state.fila ? [state.fila] : [] }
      }

      if (/prospeccao_bloqueios/i.test(sql)) return { rows: [] }
      if (/contato_politicas/i.test(sql)) return { rows: state.politica ? [state.politica] : [] }
      if (/vendas\.conversas/i.test(sql)) return { rows: state.conversa ? [state.conversa] : [] }

      if (/SELECT id, telefone, status, updated_at, created_at\s+FROM prospectador\.prospects/i.test(sql)) {
        return {
          rows: [{
            id: PROSPECT_ID,
            telefone: '5571999990001',
            status: opts.prospect_status || 'aprovado',
            updated_at: '2026-05-01T00:00:00Z',
          }],
        }
      }

      if (/FROM prospectador\.send_attempts sa/i.test(sql)) {
        return { rows: state.sendAttemptBloqueante ? [state.sendAttemptBloqueante] : [] }
      }

      if (/FROM prospectador\.prospeccao_fila_diaria\s+WHERE status IN/i.test(sql)) {
        const excludeFilaId = params[2]
        if (state.duplicateFila && state.duplicateFila.id !== excludeFilaId) return { rows: [state.duplicateFila] }
        return { rows: [] }
      }

      if (/FROM vendas\.job_queue/i.test(sql)) {
        const excludeJobId = params[4]
        if (state.jobPendente && state.jobPendente.id !== excludeJobId) return { rows: [state.jobPendente] }
        return { rows: [] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'enviando'/i.test(sql)) {
        if (!['simulado', 'agendado'].includes(state.fila.status)) return { rows: [] }
        if (!state.fila.slot_envio || !mensagemFinalFila(state.fila)) return { rows: [] }
        state.fila = {
          ...state.fila,
          status: 'enviando',
          job_id: params[1] || state.fila.job_id,
          tentativas: state.fila.tentativas + 1,
          ultimo_erro: null,
        }
        return { rows: [state.fila] }
      }

      if (/INSERT INTO prospectador\.send_attempts/i.test(sql) && /'processing'/.test(sql)) {
        if (opts.reservaDuplicada) return { rows: [] }
        const row = {
          id: state.attempts.length + 1,
          prospect_id: params[0],
          idempotency_key: params[1],
          status: 'processing',
          numero_normalizado: params[5],
          job_id: params[6],
        }
        state.attempts.push(row)
        return { rows: [row] }
      }

      if (/INSERT INTO prospectador\.send_attempts/i.test(sql) && /CASE WHEN \$4 = 'sent'/i.test(sql)) {
        state.attempts.push({
          prospect_id: params[0],
          idempotency_key: params[1],
          status: params[3],
          erro: params[4],
          numero_normalizado: params[8],
          job_id: params[9],
        })
        return { rows: [] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'enviado'/i.test(sql)) {
        state.fila = {
          ...state.fila,
          status: 'enviado',
          ultimo_erro: null,
          metadata_json: { ...state.fila.metadata_json, ...JSON.parse(params[1]) },
        }
        return { rows: [state.fila] }
      }

      if (/UPDATE prospectador\.prospects\s+SET status = 'enviado'/i.test(sql)) return { rows: [] }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = \$2/i.test(sql)) {
        state.fila = { ...state.fila, status: params[1], ultimo_erro: params[2] }
        return { rows: [state.fila] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'agendado'/i.test(sql)) {
        state.fila = { ...state.fila, status: 'agendado', job_id: params[1] }
        return { rows: [state.fila] }
      }

      return { rows: [] }
    },
  }
}

test('envio fila: idempotency key e vinculada ao item da fila', () => {
  assert.equal(
    idempotencyKeyFila(FILA_ID),
    `prospeccao:fila_diaria:${FILA_ID}:abordagem_inicial:whatsapp`
  )
})

test('envio fila: prepara item para job apenas quando ha slot e mensagem', async () => {
  const pool = criarPoolEnvioFake()
  const r = await prepararItemFilaParaJobEnvio(pool, FILA_ID)
  assert.equal(r.ok, true)
  assert.equal(r.fila_id, FILA_ID)
  assert.equal(r.prospect_id, PROSPECT_ID)
  assert.equal(r.slot_envio, '2026-05-25T08:00:00Z')
  assert.match(r.mensagem_final, /PJ Codeworks/)
})

test('envio fila: marca job agendado na fila', async () => {
  const pool = criarPoolEnvioFake({ status: 'simulado' })
  const item = await marcarJobAgendadoNaFila(pool, FILA_ID, 99)
  assert.equal(item.status, 'agendado')
  assert.equal(item.job_id, 99)
})

test('envio fila: revalida elegibilidade, reserva idempotencia, envia e marca enviado', async () => {
  const pool = criarPoolEnvioFake()
  const envios = []
  const r = await processarEnvioFilaAgendado(pool, FILA_ID, {
    jobId: 77,
    enviarMensagemFn: async (numero, texto) => {
      envios.push({ numero, texto })
      return { key: { id: 'wa-1' } }
    },
  })

  assert.equal(r.ok, true)
  assert.equal(r.status, 'enviado')
  assert.equal(pool.state.fila.status, 'enviado')
  assert.equal(pool.state.fila.job_id, 77)
  assert.equal(envios.length, 1)
  assert.equal(envios[0].numero, '5571999990001')
  assert.match(envios[0].texto, /PJ Codeworks/)
  assert.ok(pool.state.attempts.some((a) => a.status === 'processing'))
  assert.ok(pool.state.attempts.some((a) => a.status === 'sent'))
})

test('envio fila: bloqueia opt-out imediatamente antes do envio', async () => {
  const pool = criarPoolEnvioFake({ politica: { opt_out: true, telefone: '5571999990001' } })
  let chamouWhatsapp = false
  const r = await processarEnvioFilaAgendado(pool, FILA_ID, {
    jobId: 77,
    enviarMensagemFn: async () => { chamouWhatsapp = true },
  })
  assert.equal(r.ok, false)
  assert.equal(r.bloqueado, true)
  assert.equal(r.motivo, 'opt_out')
  assert.equal(chamouWhatsapp, false)
  assert.equal(pool.state.fila.status, 'cancelado')
})

test('envio fila: mesmo item ja enviado nao envia duas vezes', async () => {
  const pool = criarPoolEnvioFake({ status: 'enviado' })
  let chamouWhatsapp = false
  const r = await processarEnvioFilaAgendado(pool, FILA_ID, {
    enviarMensagemFn: async () => { chamouWhatsapp = true },
  })
  assert.equal(r.ok, true)
  assert.equal(r.deduplicado, true)
  assert.equal(r.motivo, 'fila_ja_enviada')
  assert.equal(chamouWhatsapp, false)
})

test('envio fila: falha retryable volta para agendado e relanca para o job retry', async () => {
  const pool = criarPoolEnvioFake()
  const err = new Error('timeout')
  err.evolutionClassificacao = { tipo: 'transient', retryable: true, motivo: 'timeout' }
  await assert.rejects(
    () => processarEnvioFilaAgendado(pool, FILA_ID, {
      jobId: 77,
      enviarMensagemFn: async () => { throw err },
    }),
    /timeout/
  )
  assert.equal(pool.state.fila.status, 'agendado')
  assert.ok(pool.state.attempts.some((a) => a.status === 'failed'))
})

test('envio fila: bloqueia item sem mensagem', async () => {
  const pool = criarPoolEnvioFake({ mensagem_gerada: '' })
  await assert.rejects(
    () => processarEnvioFilaAgendado(pool, FILA_ID, {
      enviarMensagemFn: async () => ({ ok: true }),
    }),
    /Item sem mensagem gerada\/editada/
  )
})
