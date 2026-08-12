'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { atribuirZonas, rotuloMenu, classeTom, TOM_CLASSES } = require('./menu-radial')

function acao(id, extra = {}) {
  return { id, rotulo: id, onSelecionar: () => {}, ...extra }
}

test('atribuirZonas: cada acao com zona vai para a propria posicao', () => {
  const r = atribuirZonas([
    acao('concluir', { zona: 'direita' }),
    acao('reagendar', { zona: 'cima' }),
    acao('cancelar', { zona: 'esquerda' }),
  ])
  assert.equal(r.cima.id, 'reagendar')
  assert.equal(r.direita.id, 'concluir')
  assert.equal(r.esquerda.id, 'cancelar')
  assert.deepEqual(r.extras, [])
})

test('atribuirZonas: acao sem zona cai direto no centro (extras)', () => {
  const r = atribuirZonas([acao('roteiro', { zona: 'cima' }), acao('cancelar_automatico')])
  assert.equal(r.cima.id, 'roteiro')
  assert.equal(r.direita, null)
  assert.equal(r.esquerda, null)
  assert.equal(r.extras.length, 1)
  assert.equal(r.extras[0].id, 'cancelar_automatico')
})

test('atribuirZonas: colisao de zona — a PRIMEIRA vence, a segunda cai no centro (nunca some)', () => {
  const r = atribuirZonas([
    acao('reagendar', { zona: 'cima' }),
    acao('roteiro', { zona: 'cima' }),
  ])
  assert.equal(r.cima.id, 'reagendar')
  assert.equal(r.extras.length, 1)
  assert.equal(r.extras[0].id, 'roteiro')
})

test('atribuirZonas: lista vazia ou undefined nao quebra', () => {
  assert.deepEqual(atribuirZonas([]), { cima: null, direita: null, esquerda: null, baixo: null, extras: [] })
  assert.deepEqual(atribuirZonas(undefined), { cima: null, direita: null, esquerda: null, baixo: null, extras: [] })
})

test('atribuirZonas: zona invalida (typo) tambem cai no centro, nao trava', () => {
  const r = atribuirZonas([acao('x', { zona: 'diagonal' })])
  assert.equal(r.cima, null)
  assert.equal(r.extras.length, 1)
})

test('atribuirZonas: quarta acao usa a zona baixo (4 bolinhas, nenhuma cai em extras)', () => {
  const r = atribuirZonas([
    acao('concluir', { zona: 'direita' }),
    acao('reagendar', { zona: 'cima' }),
    acao('cancelar', { zona: 'esquerda' }),
    acao('conversa', { zona: 'baixo' }),
  ])
  assert.equal(r.baixo.id, 'conversa')
  assert.deepEqual(r.extras, [])
})

test('atribuirZonas: colisao na zona baixo tambem cai no centro (nunca some)', () => {
  const r = atribuirZonas([
    acao('conversa', { zona: 'baixo' }),
    acao('outra', { zona: 'baixo' }),
  ])
  assert.equal(r.baixo.id, 'conversa')
  assert.equal(r.extras.length, 1)
  assert.equal(r.extras[0].id, 'outra')
})

test('rotuloMenu: com contexto nomeia a linha; sem contexto fica generico', () => {
  assert.equal(rotuloMenu('João da Padaria'), 'Mais ações — João da Padaria')
  assert.equal(rotuloMenu(''), 'Mais ações')
  assert.equal(rotuloMenu(undefined), 'Mais ações')
  assert.equal(rotuloMenu('   '), 'Mais ações')
})

test('classeTom: tom desconhecido ou ausente cai no neutro, nunca quebra', () => {
  assert.equal(classeTom('positivo'), TOM_CLASSES.positivo)
  assert.equal(classeTom('negativo'), TOM_CLASSES.negativo)
  assert.equal(classeTom(undefined), TOM_CLASSES.neutro)
  assert.equal(classeTom('lixo'), TOM_CLASSES.neutro)
})
