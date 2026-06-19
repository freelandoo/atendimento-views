'use strict'

// Regressao: lead escreve tudo numa linha ("Trabalho com restaurante em sp e e
// meu primeiro site como faco para criar"). O regex over-capturava a frase
// inteira como `negocio` e um template ("Para {negocio} em {cidade}, ...") ecoava
// o lixo. Agora o ramo deve ser extraido limpo nos dois caminhos (legado e novo),
// deixando a analise da IA prevalecer.

const test = require('node:test')
const assert = require('node:assert')

const { extrairDadosLeadDoTexto } = require('../src/agent')
const { extrairDadosMensagem } = require('../src/next-action-orchestrator')

const FRASE_CORRIDA = 'Trabalho com restaurante em sp e é meu primeiro site como faço para criar'

test('negocio run-on: caminho legado (extrairDadosLeadDoTexto) extrai so o ramo', () => {
  const d = extrairDadosLeadDoTexto(FRASE_CORRIDA)
  assert.equal(d.negocio || d.nicho, 'restaurante')
})

test('negocio run-on: caminho novo (extrairDadosMensagem) extrai so o ramo', () => {
  const d = extrairDadosMensagem(FRASE_CORRIDA)
  assert.equal(d.negocio, 'restaurante')
})

test('negocio: nao captura termo do catalogo (site/sistema) como ramo', () => {
  const d = extrairDadosMensagem('quero um site para minha empresa')
  assert.notEqual(d.negocio, 'site')
  // site e necessidade, nao negocio
  assert.equal(d.necessidade, 'site')
})

test('negocio: ramos legitimos seguem intactos', () => {
  assert.equal(extrairDadosLeadDoTexto('tenho uma barbearia').negocio, 'corte de cabelo / barbearia')
  assert.equal(extrairDadosMensagem('trabalho com loja de roupas femininas').negocio, 'loja de roupas femininas')
})
