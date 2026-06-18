'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_QUESTIONS_PER_MESSAGE,
  countQuestions,
  countLooseQuestions,
  detectRunOnQuestion,
  validateQuestionRule,
  stripToOneQuestion,
  buildContextualQuestion,
} = require('../src/question-limiter')

// ─── Constante ────────────────────────────────────────────────────────────────

test('MAX_QUESTIONS_PER_MESSAGE é 1', () => {
  assert.equal(MAX_QUESTIONS_PER_MESSAGE, 1)
})

// ─── countQuestions / countLooseQuestions ─────────────────────────────────────

test('0 perguntas numa afirmação', () => {
  assert.equal(countQuestions('Entendido, vou te ajudar.'), 0)
})

test('1 pergunta solta simples', () => {
  assert.equal(countQuestions('Qual é o seu negócio?'), 1)
})

test('1 pergunta contextual (2 infos, 1 "?") → conta como 1', () => {
  assert.equal(countQuestions('Qual é o seu negócio e em qual cidade você atende?'), 1)
})

test('2 perguntas soltas', () => {
  assert.equal(countQuestions('Qual seu negócio? E a cidade?'), 2)
})

test('3 perguntas soltas', () => {
  assert.equal(countQuestions('Qual o negócio? A cidade? E o site?'), 3)
})

test('"???" conta como 1 pergunta (mesma frase)', () => {
  assert.equal(countQuestions('Oi??? Como vai?'), 2)
})

test('mensagem vazia retorna 0', () => {
  assert.equal(countQuestions(''), 0)
  assert.equal(countQuestions(null), 0)
})

// ─── Exemplo exato do critério ruim do usuário ────────────────────────────────

test('exemplo ruim do usuário: 1 pergunta detectada como solta', () => {
  // A frase do usuário tem 1 "?" mas é uma run-on question
  const bad = 'Qual seu negócio, cidade, ticket médio, se tem site, se aparece no Google e quanto quer investir?'
  assert.equal(countLooseQuestions(bad), 1)  // 1 pergunta solta
  assert.equal(detectRunOnQuestion(bad), true)  // mas é run-on
})

// ─── detectRunOnQuestion ──────────────────────────────────────────────────────

test('run-on: não detecta em pergunta simples', () => {
  assert.equal(detectRunOnQuestion('Qual o seu negócio?'), false)
})

test('run-on: não detecta em pergunta contextual com 2 infos', () => {
  assert.equal(detectRunOnQuestion('Qual é o seu negócio e em qual cidade você atende?'), false)
})

test('run-on: detecta quando há 3+ vírgulas na mesma pergunta', () => {
  assert.equal(
    detectRunOnQuestion('Qual negócio, cidade, ticket médio, se tem site e quanto investe?'),
    true
  )
})

test('run-on: detecta quando há 2+ "se" na mesma pergunta', () => {
  assert.equal(
    detectRunOnQuestion('Se tem site, se aparece no Google e quanto quer investir?'),
    true
  )
})

test('run-on: não dispara em múltiplas perguntas soltas (já é outro problema)', () => {
  // Run-on só se aplica quando há exatamente 1 "?"
  assert.equal(detectRunOnQuestion('Qual o negócio? E a cidade?'), false)
})

// ─── validateQuestionRule ─────────────────────────────────────────────────────

test('válido: 0 perguntas (afirmação pura)', () => {
  const result = validateQuestionRule('Entendido.')
  assert.equal(result.valid, true)
  assert.deepEqual(result.violations, [])
})

test('válido: 1 pergunta solta', () => {
  const result = validateQuestionRule('Qual o seu negócio?')
  assert.equal(result.valid, true)
  assert.equal(result.questionCount, 1)
})

test('válido: 1 pergunta contextual', () => {
  const result = validateQuestionRule('Qual é o seu negócio e em qual cidade você atende?')
  assert.equal(result.valid, true)
  assert.equal(result.questionCount, 1)
})

test('inválido: 2 perguntas soltas', () => {
  const result = validateQuestionRule('Qual o negócio? E a cidade?')
  assert.equal(result.valid, false)
  assert.equal(result.questionCount, 2)
  assert.ok(result.violations.some((v) => v.includes('2 perguntas')))
})

test('inválido: 3 perguntas soltas', () => {
  const result = validateQuestionRule('Qual o negócio? A cidade? E o site?')
  assert.equal(result.valid, false)
  assert.equal(result.questionCount, 3)
})

test('inválido: run-on question', () => {
  const result = validateQuestionRule(
    'Qual negócio, cidade, ticket médio, se tem site e quanto investe?'
  )
  assert.equal(result.valid, false)
  assert.equal(result.hasRunOn, true)
  assert.ok(result.violations.some((v) => v.includes('run-on')))
})

test('retorno tem todos os campos esperados', () => {
  const result = validateQuestionRule('Qual o negócio?')
  assert.ok('valid' in result)
  assert.ok('questionCount' in result)
  assert.ok('maxAllowed' in result)
  assert.ok('hasRunOn' in result)
  assert.ok('violations' in result)
  assert.equal(result.maxAllowed, 1)
})

// ─── stripToOneQuestion ───────────────────────────────────────────────────────

test('não altera mensagem com 1 pergunta', () => {
  const msg = 'Qual o seu negócio?'
  assert.equal(stripToOneQuestion(msg), msg)
})

test('não altera mensagem sem perguntas', () => {
  const msg = 'Perfeito, vou te orientar.'
  assert.equal(stripToOneQuestion(msg), msg)
})

test('remove perguntas extras, mantém a primeira', () => {
  const result = stripToOneQuestion('Qual seu negócio? E a cidade? E o site?')
  assert.equal(result, 'Qual seu negócio?')
})

test('preserva contexto antes da primeira pergunta', () => {
  const result = stripToOneQuestion(
    'Entendo. Para te orientar melhor, qual é o seu negócio? E a cidade?'
  )
  assert.equal(result, 'Entendo. Para te orientar melhor, qual é o seu negócio?')
})

test('resultado de stripToOneQuestion passa na validação', () => {
  const bad = 'Qual o negócio? A cidade? O site?'
  const repaired = stripToOneQuestion(bad)
  const validation = validateQuestionRule(repaired)
  assert.equal(validation.valid, true)
})

// ─── buildContextualQuestion ─────────────────────────────────────────────────

test('1 campo: gera pergunta simples', () => {
  const q = buildContextualQuestion(['city'])
  assert.ok(q !== null)
  assert.ok(q.endsWith('?'))
  assert.ok(q.toLowerCase().includes('cidade'))
})

test('2 campos: gera pergunta contextual com "e"', () => {
  const q = buildContextualQuestion(['businessType', 'city'])
  assert.ok(q !== null)
  assert.ok(q.includes(' e '))
  assert.ok(q.endsWith('?'))
  assert.ok(q.toLowerCase().includes('negócio') || q.toLowerCase().includes('negocio'))
  assert.ok(q.toLowerCase().includes('cidade'))
})

test('3 campos: usa apenas os 2 primeiros', () => {
  const q = buildContextualQuestion(['businessType', 'city', 'mainService'])
  assert.ok(q !== null)
  // Apenas 1 "?" — segue a regra
  assert.equal((q.match(/\?/g) || []).length, 1)
  // Não deve conter "site, sistema, automação" (terceiro campo)
  const validation = validateQuestionRule(q)
  assert.equal(validation.valid, true)
})

test('lista vazia retorna null', () => {
  assert.equal(buildContextualQuestion([]), null)
})

test('resultado tem exatamente 1 ponto de interrogação', () => {
  const fields = [['businessType'], ['city'], ['hasWebsite'], ['goal'], ['businessType', 'city']]
  for (const f of fields) {
    const q = buildContextualQuestion(f)
    if (q) {
      const marks = (q.match(/\?/g) || []).length
      assert.equal(marks, 1, `"${q}" tem ${marks} "?" em vez de 1`)
    }
  }
})

test('com prefix: inclui texto de contexto antes da pergunta', () => {
  const q = buildContextualQuestion(['businessType', 'city'], 'Para te orientar melhor:')
  assert.ok(q?.startsWith('Para te orientar melhor:'))
  assert.ok(q?.endsWith('?'))
})

test('resultado passa na validateQuestionRule', () => {
  const combinations = [
    ['businessType'],
    ['city'],
    ['mainService'],
    ['hasWebsite'],
    ['goal'],
    ['businessType', 'city'],
    ['city', 'mainService'],
    ['mainService', 'hasWebsite'],
  ]
  for (const fields of combinations) {
    const q = buildContextualQuestion(fields)
    if (q) {
      const result = validateQuestionRule(q)
      assert.equal(
        result.valid, true,
        `buildContextualQuestion(${JSON.stringify(fields)}) → "${q}" falhou na validação: ${result.violations}`
      )
    }
  }
})

// ─── Caso do critério de pronto ───────────────────────────────────────────────

test('critério: resposta com perguntas separadas falha', () => {
  const bad = 'Qual seu negócio, cidade, ticket médio, se tem site, se aparece no Google e quanto quer investir?'
  const result = validateQuestionRule(bad)
  assert.equal(result.valid, false, 'Resposta com run-on question deve falhar')
})

test('critério: resposta do exemplo correto do usuário passa', () => {
  const good = 'Perfeito. Para eu te orientar melhor: qual é o seu negócio e em qual cidade você atende?'
  const result = validateQuestionRule(good)
  assert.equal(result.valid, true, 'Resposta com pergunta contextual deve passar')
})
