'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { jidConversaDoEnvio, registrarEnvioNoHistorico } = require('../src/services/historico-envio')

test('jidConversaDoEnvio prefere o remoteJid da resposta da Evolution', () => {
  const jid = jidConversaDoEnvio({ key: { remoteJid: '5511987654321@s.whatsapp.net' } }, '11 98765-4321')
  assert.strictEqual(jid, '5511987654321@s.whatsapp.net')
})

test('jidConversaDoEnvio remove sufixo de device do remoteJid', () => {
  const jid = jidConversaDoEnvio({ key: { remoteJid: '5511987654321:12@s.whatsapp.net' } }, null)
  assert.strictEqual(jid, '5511987654321@s.whatsapp.net')
})

test('jidConversaDoEnvio aceita key aninhada (message.key / data.key)', () => {
  assert.strictEqual(
    jidConversaDoEnvio({ message: { key: { remoteJid: '5521999990000@s.whatsapp.net' } } }, null),
    '5521999990000@s.whatsapp.net'
  )
  assert.strictEqual(
    jidConversaDoEnvio({ data: { key: { remoteJid: '5521999990000@s.whatsapp.net' } } }, null),
    '5521999990000@s.whatsapp.net'
  )
})

test('jidConversaDoEnvio: fallback monta JID dos dígitos com prefixo 55', () => {
  assert.strictEqual(jidConversaDoEnvio(null, '(11) 98765-4321'), '5511987654321@s.whatsapp.net')
  assert.strictEqual(jidConversaDoEnvio({}, '5511987654321'), '5511987654321@s.whatsapp.net')
  assert.strictEqual(jidConversaDoEnvio(null, '5511987654321@s.whatsapp.net'), '5511987654321@s.whatsapp.net')
})

test('jidConversaDoEnvio: sem dígitos retorna null', () => {
  assert.strictEqual(jidConversaDoEnvio(null, ''), null)
  assert.strictEqual(jidConversaDoEnvio(null, null), null)
})

test('registrarEnvioNoHistorico faz upsert com entrada assistant no historico', async () => {
  const chamadas = []
  const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] } } }
  const r = await registrarEnvioNoHistorico(pool, {
    respostaEnvio: { key: { remoteJid: '5511987654321@s.whatsapp.net' } },
    numero: '11987654321',
    texto: 'Oi! Vi sua empresa no Google…',
    tipo: 'prospeccao_saudacao',
    empresaId: 'emp-1',
    evolutionInstance: 'free',
    meta: { prospect_id: 'p1' },
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.jid, '5511987654321@s.whatsapp.net')
  assert.strictEqual(chamadas.length, 1)
  const { sql, params } = chamadas[0]
  assert.match(sql, /INSERT INTO vendas\.conversas/)
  assert.match(sql, /ON CONFLICT \(numero\) DO UPDATE/)
  assert.strictEqual(params[0], '5511987654321@s.whatsapp.net')
  const historico = JSON.parse(params[1])
  assert.strictEqual(historico.length, 1)
  assert.strictEqual(historico[0].role, 'assistant')
  assert.strictEqual(historico[0].content, 'Oi! Vi sua empresa no Google…')
  assert.strictEqual(historico[0].tipo, 'prospeccao_saudacao')
  assert.strictEqual(historico[0].prospect_id, 'p1')
  assert.ok(historico[0].criado_em)
  assert.strictEqual(params[2], 'emp-1')
  assert.strictEqual(params[4], 'free')
})

test('registrarEnvioNoHistorico não grava texto vazio nem número inválido', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  const semTexto = await registrarEnvioNoHistorico(pool, { numero: '5511987654321', texto: '   ' })
  assert.strictEqual(semTexto.ok, false)
  const semNumero = await registrarEnvioNoHistorico(pool, { numero: '', texto: 'oi' })
  assert.strictEqual(semNumero.ok, false)
})
