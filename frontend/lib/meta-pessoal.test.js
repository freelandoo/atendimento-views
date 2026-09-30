'use strict'
const test = require('node:test')
const assert = require('node:assert')
const M = require('./meta-pessoal')

test('DIAS cobre a semana ISO inteira', () => {
  assert.equal(M.DIAS.length, 7)
  assert.deepEqual(M.DIAS.map((d) => d.iso), [1, 2, 3, 4, 5, 6, 7])
})

test('rotuloDias lista os dias na ordem da semana', () => {
  assert.equal(M.rotuloDias([1, 2, 3, 4, 5]), 'Seg, Ter, Qua, Qui, Sex')
  assert.equal(M.rotuloDias([6, 3]), 'Qua, Sáb')
  assert.equal(M.rotuloDias([]), '—')
  assert.equal(M.rotuloDias(null), '—')
})

test('rotuloCanal traduz as chaves e ecoa o desconhecido', () => {
  assert.equal(M.rotuloCanal('contatos'), 'Contatos')
  assert.equal(M.rotuloCanal('ligacoes'), 'Ligações')
  assert.equal(M.rotuloCanal('mensagens'), 'Mensagens')
  assert.equal(M.rotuloCanal('outro'), 'outro')
})

test('proximidade é a mesma de minha-operacao (reexport, não cópia)', () => {
  assert.equal(M.proximidade, require('./minha-operacao').proximidade)
  // sem alvo ⇒ não desenha barra
  assert.equal(M.proximidade({ alvo: null, fracao: 0 }), null)
})
