'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { extrairNomeDeclarado, nomeDePushName, primeiroNome } = require('../src/nome-contato')

test('nome-contato: captura primeiro nome valido do pushName', () => {
  assert.equal(nomeDePushName('Joao Silva'), 'Joao')
  assert.equal(nomeDePushName('Maria Aparecida'), 'Maria')
  assert.equal(nomeDePushName('5511999999999'), null)
  assert.equal(nomeDePushName('Restaurante Sabor'), null)
})

test('nome-contato: extrai nome declarado ou corrigido pelo lead', () => {
  assert.equal(extrairNomeDeclarado('Meu nome e Carla'), 'Carla')
  assert.equal(extrairNomeDeclarado('meu nome é João'), 'João')
  assert.equal(extrairNomeDeclarado('pode me chamar de Bia'), 'Bia')
  assert.equal(extrairNomeDeclarado('não, é Pedro'), 'Pedro')
  assert.equal(extrairNomeDeclarado('sou cliente e queria saber preco'), null)
  assert.equal(extrairNomeDeclarado('sou o cliente que falou ontem'), null)
})

test('nome-contato: normaliza sem aceitar palavras obvias que nao sao nome', () => {
  assert.equal(primeiroNome('clinica vida'), null)
  assert.equal(primeiroNome('ana'), 'Ana')
})
