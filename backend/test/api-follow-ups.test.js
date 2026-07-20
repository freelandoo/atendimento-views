'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const router = require('../src/routes/api-follow-ups')
const { validarNumeroEntrada, validarTextoEntrada, validarPatchConfig } = router._internals

test('numero de contato aceita telefone e JID individual validos', () => {
  assert.equal(validarNumeroEntrada('5511999999999'), '5511999999999')
  assert.equal(
    validarNumeroEntrada('5511999999999@s.whatsapp.net'),
    '5511999999999@s.whatsapp.net'
  )
})

test('numero de contato rejeita vazio, grupo, broadcast e sufixo arbitrario', () => {
  for (const numero of ['', '123@g.us', '5511999999999@broadcast', '5511999999999@exemplo.com']) {
    assert.throws(
      () => validarNumeroEntrada(numero),
      (err) => err.statusCode === 400 && /numero/.test(err.message)
    )
  }
})

test('texto obrigatorio e limites sao validados antes dos servicos', () => {
  assert.equal(validarTextoEntrada('  mensagem  ', 'texto', 20, true), 'mensagem')
  assert.throws(() => validarTextoEntrada('   ', 'texto', 20, true), /obrigatorio/)
  assert.throws(() => validarTextoEntrada('x'.repeat(21), 'texto', 20), /limite de 20/)
})

test('config rejeita modo, meta e pausa invalidos', () => {
  assert.doesNotThrow(() => validarPatchConfig({ modo: 'semi', meta_ligacoes_dia: 12, pausado: false }))
  assert.throws(() => validarPatchConfig({ modo: 'aleatorio' }), /modo invalido/)
  assert.throws(() => validarPatchConfig({ meta_ligacoes_dia: 0 }), /entre 1 e 100/)
  assert.throws(() => validarPatchConfig({ meta_ligacoes_dia: 101 }), /entre 1 e 100/)
  assert.throws(() => validarPatchConfig({ meta_ligacoes_dia: 1.5 }), /entre 1 e 100/)
  assert.throws(() => validarPatchConfig({ pausado: 'sim' }), /booleano/)
})
