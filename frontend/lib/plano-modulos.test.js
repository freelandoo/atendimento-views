'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const M = require('./plano-modulos')

test('moduloDaRota: casa rota exata e subrota; null fora da matriz', () => {
  assert.equal(M.moduloDaRota('/dashboard/equipe')?.chave, '/dashboard/equipe')
  assert.equal(M.moduloDaRota('/dashboard/equipe/123')?.chave, '/dashboard/equipe')
  assert.equal(M.moduloDaRota('/dashboard/banco-leads'), null) // usável p/ todos
  assert.equal(M.moduloDaRota('/dashboard'), null)
})

test('bloqueado: trial trava Central de Mensagens; Mínimo libera', () => {
  const conversas = M.moduloDaRota('/dashboard/conversas')
  assert.equal(M.bloqueado({ status: 'trial', nome: 'minimo' }, conversas), true)
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'minimo' }, conversas), false)
})

test('bloqueado: itens Pro travam abaixo de Pro', () => {
  const equipe = M.moduloDaRota('/dashboard/equipe')
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'minimo' }, equipe), true)
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'basico' }, equipe), true)
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'pro' }, equipe), false)
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'legado' }, equipe), false)
})

test('FAIL-OPEN: sem plano (grandfather) e nome desconhecido não bloqueiam', () => {
  const equipe = M.moduloDaRota('/dashboard/equipe')
  assert.equal(M.bloqueado(null, equipe), false)
  assert.equal(M.bloqueado({ status: 'ativo', nome: 'zorp' }, equipe), false)
})

test('planoQueLibera: rótulo do CTA', () => {
  assert.equal(M.planoQueLibera(M.moduloDaRota('/dashboard/equipe')), 'Empresarial')
  assert.equal(M.planoQueLibera(M.moduloDaRota('/dashboard/conversas')), 'Essencial')
})
