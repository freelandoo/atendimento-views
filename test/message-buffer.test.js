'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_BUFFER_WINDOW_MS,
  MIN_BUFFER_WINDOW_MS,
  MAX_BUFFER_WINDOW_MS,
  consolidateMessages,
  consolidateFromHistory,
  MessageBuffer,
  createMessageBuffer,
} = require('../src/message-buffer')

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um MessageBuffer com timer fake (controlado manualmente).
 * Suporta múltiplos timers simultâneos (um por lead).
 *
 * tick()      → dispara TODOS os timers pendentes
 * tick(id)    → dispara apenas o timer com aquele id
 * hasPendingTimer() → true se há ao menos 1 timer ativo
 */
function createFakeBuffer(options = {}) {
  let nextId = 1
  const timers = new Map()  // id → callback

  const fakeSetTimeout = (fn) => {
    const id = nextId++
    timers.set(id, fn)
    return id
  }

  const fakeClearTimeout = (id) => {
    timers.delete(id)
  }

  const buffer = new MessageBuffer({
    ...options,
    bufferWindowMs: options.bufferWindowMs || MIN_BUFFER_WINDOW_MS,
    _setTimeout: fakeSetTimeout,
    _clearTimeout: fakeClearTimeout,
  })

  function tick(id) {
    if (id !== undefined) {
      const fn = timers.get(id)
      if (fn) { timers.delete(id); fn() }
    } else {
      // Dispara todos os timers pendentes (em ordem de criação)
      const entries = [...timers.entries()]
      timers.clear()
      for (const [, fn] of entries) fn()
    }
  }

  function hasPendingTimer() {
    return timers.size > 0
  }

  return { buffer, tick, hasPendingTimer }
}

// ─── consolidateMessages ──────────────────────────────────────────────────────

test('array vazio retorna string vazia', () => {
  assert.equal(consolidateMessages([]), '')
})

test('mensagem única retorna sem alteração', () => {
  assert.equal(consolidateMessages(['Oi']), 'Oi')
})

test('múltiplas mensagens juntas com \\n', () => {
  const result = consolidateMessages(['Oi', 'Tenho interesse', 'Quanto fica?'])
  assert.equal(result, 'Oi\nTenho interesse\nQuanto fica?')
})

test('caso do usuário: 4 mensagens consolidadas', () => {
  const msgs = ['Oi', 'Tenho interesse', 'Quanto fica?', 'Sou de Santo André']
  const result = consolidateMessages(msgs)
  assert.equal(result, 'Oi\nTenho interesse\nQuanto fica?\nSou de Santo André')
})

test('mensagens vazias são ignoradas', () => {
  assert.equal(consolidateMessages(['Oi', '', '   ', 'Olá']), 'Oi\nOlá')
})

test('mensagens idênticas consecutivas são deduplicadas', () => {
  assert.equal(consolidateMessages(['Oi', 'Oi', 'Tudo bem?']), 'Oi\nTudo bem?')
})

test('mensagens idênticas não consecutivas NÃO são deduplicadas', () => {
  const result = consolidateMessages(['Oi', 'Tudo?', 'Oi'])
  assert.equal(result, 'Oi\nTudo?\nOi')
})

test('null/undefined em array não quebra', () => {
  const result = consolidateMessages([null, 'Oi', undefined, 'Olá'])
  assert.equal(result, 'Oi\nOlá')
})

// ─── consolidateFromHistory ───────────────────────────────────────────────────

test('extrai apenas mensagens do role user', () => {
  const historico = [
    { role: 'user', content: 'Oi' },
    { role: 'assistant', content: 'Olá! Qual o negócio?' },
    { role: 'user', content: 'Sou dentista' },
  ]
  const result = consolidateFromHistory(historico)
  assert.equal(result, 'Oi\nSou dentista')
})

test('respeita o limite de mensagens', () => {
  const historico = Array.from({ length: 20 }, (_, i) => ({
    role: 'user',
    content: `msg ${i + 1}`,
  }))
  const result = consolidateFromHistory(historico, 3)
  assert.equal(result, 'msg 18\nmsg 19\nmsg 20')
})

test('historico vazio retorna string vazia', () => {
  assert.equal(consolidateFromHistory([]), '')
  assert.equal(consolidateFromHistory(null), '')
})

// ─── MessageBuffer.add ────────────────────────────────────────────────────────

test('add: cria buffer e retorna snapshot', () => {
  const { buffer } = createFakeBuffer()
  const result = buffer.add('lead1', 'Oi')
  assert.equal(result.leadId, 'lead1')
  assert.deepEqual(result.messages, ['Oi'])
  assert.equal(result.messageCount, 1)
  assert.ok(result.lastMessageAt instanceof Date)
})

test('add: acumula mensagens do mesmo lead', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi')
  buffer.add('lead1', 'Tenho interesse')
  const result = buffer.add('lead1', 'Quanto fica?')
  assert.deepEqual(result.messages, ['Oi', 'Tenho interesse', 'Quanto fica?'])
  assert.equal(result.messageCount, 3)
})

test('add: leads diferentes ficam isolados', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi de 1')
  buffer.add('lead2', 'Oi de 2')
  assert.deepEqual(buffer.peek('lead1').messages, ['Oi de 1'])
  assert.deepEqual(buffer.peek('lead2').messages, ['Oi de 2'])
})

test('add: mensagem vazia não é armazenada', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', '')
  buffer.add('lead1', '   ')
  // buffer ainda é criado mas sem mensagens
  const snap = buffer.peek('lead1')
  assert.equal(snap.messageCount, 0)
})

// ─── MessageBuffer.flush ──────────────────────────────────────────────────────

test('flush: retorna dados consolidados e remove buffer', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi')
  buffer.add('lead1', 'Sou de SP')
  const result = buffer.flush('lead1')

  assert.equal(result.leadId, 'lead1')
  assert.deepEqual(result.messages, ['Oi', 'Sou de SP'])
  assert.equal(result.consolidated, 'Oi\nSou de SP')
  assert.equal(result.messageCount, 2)
  assert.ok(!buffer.has('lead1'))
})

test('flush: retorna null se não há buffer', () => {
  const { buffer } = createFakeBuffer()
  assert.equal(buffer.flush('inexistente'), null)
})

test('flush: buffer é removido após flush', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi')
  buffer.flush('lead1')
  assert.equal(buffer.size(), 0)
})

// ─── Timer automático (via tick) ─────────────────────────────────────────────

test('timer dispara flush automático após janela', () => {
  const flushed = []
  const { buffer, tick } = createFakeBuffer({
    onFlush: (result) => flushed.push(result),
  })

  buffer.add('lead1', 'Oi')
  buffer.add('lead1', 'Tenho interesse')

  tick()  // simula expiração do timer

  assert.equal(flushed.length, 1)
  assert.equal(flushed[0].leadId, 'lead1')
  assert.equal(flushed[0].consolidated, 'Oi\nTenho interesse')
  assert.ok(!buffer.has('lead1'))
})

test('nova mensagem reinicia o timer', () => {
  const flushed = []
  const { buffer, tick, hasPendingTimer } = createFakeBuffer({
    onFlush: (result) => flushed.push(result),
  })

  buffer.add('lead1', 'Oi')
  // Timer está pendente
  assert.ok(hasPendingTimer())

  buffer.add('lead1', 'Tenho interesse')
  // Timer foi reiniciado — ainda está pendente (com novo callback)
  assert.ok(hasPendingTimer())

  tick()

  assert.equal(flushed.length, 1)
  assert.equal(flushed[0].messageCount, 2)
})

test('flush manual antes do timer cancela o timer', () => {
  const flushed = []
  const { buffer, tick, hasPendingTimer } = createFakeBuffer({
    onFlush: (result) => flushed.push(result),
  })

  buffer.add('lead1', 'Oi')
  buffer.flush('lead1')  // flush manual

  // Timer foi cancelado
  assert.ok(!hasPendingTimer())

  tick()  // tick não deve disparar nada
  assert.equal(flushed.length, 0)  // onFlush nunca chamado
})

// ─── peek, has, size ─────────────────────────────────────────────────────────

test('peek: retorna estado sem remover', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi')
  const snap = buffer.peek('lead1')
  assert.equal(snap.messageCount, 1)
  assert.ok(buffer.has('lead1'))  // ainda existe
})

test('peek: retorna null se não existe', () => {
  const { buffer } = createFakeBuffer()
  assert.equal(buffer.peek('ninguem'), null)
})

test('has: retorna true se existe, false se não', () => {
  const { buffer } = createFakeBuffer()
  assert.equal(buffer.has('lead1'), false)
  buffer.add('lead1', 'Oi')
  assert.equal(buffer.has('lead1'), true)
})

test('size: conta leads com buffer ativo', () => {
  const { buffer } = createFakeBuffer()
  assert.equal(buffer.size(), 0)
  buffer.add('lead1', 'Oi')
  buffer.add('lead2', 'Olá')
  assert.equal(buffer.size(), 2)
  buffer.flush('lead1')
  assert.equal(buffer.size(), 1)
})

// ─── cancel / cancelAll ───────────────────────────────────────────────────────

test('cancel: remove buffer sem processar', () => {
  const flushed = []
  const { buffer, tick } = createFakeBuffer({
    onFlush: (r) => flushed.push(r),
  })

  buffer.add('lead1', 'Oi')
  buffer.cancel('lead1')

  tick()  // timer cancelado, não deve chamar onFlush
  assert.equal(flushed.length, 0)
  assert.equal(buffer.has('lead1'), false)
})

test('cancelAll: limpa todos os buffers', () => {
  const { buffer } = createFakeBuffer()
  buffer.add('lead1', 'Oi')
  buffer.add('lead2', 'Olá')
  buffer.add('lead3', 'Hey')
  assert.equal(buffer.size(), 3)
  buffer.cancelAll()
  assert.equal(buffer.size(), 0)
})

// ─── Limites da janela ────────────────────────────────────────────────────────

test('bufferWindowMs respeita mínimo de 10s', () => {
  const buf = new MessageBuffer({ bufferWindowMs: 1000 })
  assert.equal(buf.bufferWindowMs, MIN_BUFFER_WINDOW_MS)
})

test('bufferWindowMs respeita máximo de 20s', () => {
  const buf = new MessageBuffer({ bufferWindowMs: 60000 })
  assert.equal(buf.bufferWindowMs, MAX_BUFFER_WINDOW_MS)
})

test('bufferWindowMs padrão é 15s', () => {
  const buf = new MessageBuffer()
  assert.equal(buf.bufferWindowMs, DEFAULT_BUFFER_WINDOW_MS)
})

// ─── createMessageBuffer ─────────────────────────────────────────────────────

test('createMessageBuffer retorna instância de MessageBuffer', () => {
  const buf = createMessageBuffer()
  assert.ok(buf instanceof MessageBuffer)
})

// ─── Critério de pronto ───────────────────────────────────────────────────────

test('critério: IA não responde ao primeiro "Oi" quando há mais mensagens', () => {
  const processados = []
  const { buffer, tick } = createFakeBuffer({
    bufferWindowMs: MIN_BUFFER_WINDOW_MS,
    onFlush: (result) => processados.push(result),
  })

  // Lead manda 4 mensagens em sequência (WhatsApp quebrado)
  buffer.add('5511999', 'Oi')
  // IA NÃO responde aqui — timer existe mas não disparou
  buffer.add('5511999', 'Tenho interesse')
  // IA NÃO responde aqui — timer reiniciado
  buffer.add('5511999', 'Quanto fica?')
  // IA NÃO responde aqui — timer reiniciado
  buffer.add('5511999', 'Sou de Santo André')
  // Timer reiniciado... agora expira sem nova mensagem

  assert.equal(processados.length, 0)  // ainda nenhum processamento

  tick()  // janela expirou

  assert.equal(processados.length, 1)  // UM único processamento
  assert.equal(processados[0].messageCount, 4)
  assert.equal(
    processados[0].consolidated,
    'Oi\nTenho interesse\nQuanto fica?\nSou de Santo André'
  )
})

test('critério: cada lead tem buffer independente', () => {
  const flushed = {}
  const { buffer, tick } = createFakeBuffer({
    onFlush: (r) => { flushed[r.leadId] = r },
  })

  buffer.add('lead-A', 'Oi')
  buffer.add('lead-B', 'Olá')
  buffer.add('lead-A', 'Sou de SP')

  tick()

  assert.ok('lead-A' in flushed)
  assert.ok('lead-B' in flushed)
  assert.equal(flushed['lead-A'].messageCount, 2)
  assert.equal(flushed['lead-B'].messageCount, 1)
})
