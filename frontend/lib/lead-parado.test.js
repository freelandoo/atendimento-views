'use strict'
// Lead parado (Operação Comercial, Etapa 3) — apresentação PURA, sem React e sem rede.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const L = require('./lead-parado')

test('zero e ausencia deixam a celula LIMPA, nunca um "0"', () => {
  // Marcar com zero quem não tem problema nenhum enche a tabela de ruído.
  for (const v of [0, null, undefined, -1, 'abc']) {
    assert.equal(L.rotuloParados(v), '', `${JSON.stringify(v)} deveria ficar vazio`)
  }
  assert.equal(L.tomParados(0), 'neutro')
})

test('singular e plural', () => {
  assert.equal(L.rotuloParados(1), '1 parado')
  assert.equal(L.rotuloParados(4), '4 parados')
  assert.equal(L.tomParados(1), 'alerta')
})

test('a explicacao diz a JANELA e que parado JA esta contado em Leads', () => {
  const t = L.explicacao(7)
  assert.match(t, /7 dias/)
  assert.match(t, /Leads/, 'precisa dizer que e subconjunto, senao o admin soma duas vezes')
  // Sem janela conhecida não se inventa número.
  assert.ok(L.explicacao(null).length > 0)
  assert.ok(!/null|NaN/.test(L.explicacao(null)))
})

test('o texto fala de ACAO REGISTRADA, nunca de "nao trabalhou"', () => {
  // A medida não enxerga follow-up de contato avulso (sem prospect_id). A tela não pode prometer
  // mais do que o sistema viu.
  assert.match(L.explicacao(7), /registrada/i)
})

test('detalhe do mais antigo: singular, plural e ausencia', () => {
  assert.equal(L.detalheMaisAntigo(1), 'o mais antigo há 1 dia')
  assert.equal(L.detalheMaisAntigo(46), 'o mais antigo há 46 dias')
  for (const v of [0, null, undefined, 'x']) assert.equal(L.detalheMaisAntigo(v), '')
})

test('resumo da equipe: null quando nao ha nada parado', () => {
  // Aviso que sempre aparece deixa de ser aviso.
  assert.equal(L.resumoDaEquipe([], 7), null)
  assert.equal(L.resumoDaEquipe([{ leads_parados: 0 }], 7), null)
  assert.equal(L.resumoDaEquipe(null, 7), null)
})

test('resumo soma leads e conta PESSOAS, com singular e plural', () => {
  const r = L.resumoDaEquipe([
    { usuario_id: 'a', leads_parados: 3 },
    { usuario_id: 'b', leads_parados: 0 },
    { usuario_id: 'c', leads_parados: 5 },
  ], 7)
  assert.equal(r.total, 8)
  assert.equal(r.pessoas, 2)
  assert.match(r.frase, /8 leads/)
  assert.match(r.frase, /2 pessoas/)
  assert.match(r.frase, /7 dias/)

  const um = L.resumoDaEquipe([{ usuario_id: 'a', leads_parados: 1 }], 7)
  assert.match(um.frase, /1 lead está parado/)
  assert.match(um.frase, /1 pessoa/)
})

test('o resumo LEMBRA que devolver e humano', () => {
  // O sistema marca e avisa; devolver continua sendo decisão de uma pessoa (decisão do operador).
  const r = L.resumoDaEquipe([{ leads_parados: 2 }], 7)
  assert.match(r.acao, /pessoa/i)
  assert.match(r.acao, /Banco de Leads/)
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

const FONTE = fs.readFileSync(path.join(__dirname, 'lead-parado.js'), 'utf8')
const SEM_COMENTARIOS = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('NAO e placar: nada ordena, pontua ou compara pessoas', () => {
  for (const proibido of ['sort(', 'ranking', 'posicao', 'score', 'produtividade', 'percentual']) {
    assert.ok(!SEM_COMENTARIOS.toLowerCase().includes(proibido),
      `"${proibido}" transformaria o alerta em nota sobre a pessoa`)
  }
})

test('a REGRA nao vive no front: nao calcula dias nem decide quem esta parado', () => {
  for (const proibido of ['Date.now', 'new Date(', 'responsavel_desde', 'ultima_acao', 'fetch(']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `lead-parado.js (front) nao pode conter '${proibido}'`)
  }
})
