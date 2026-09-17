'use strict'
// Regra PURA do descarte por inatividade. A garantia central — "ausencia de data NUNCA vira
// descarte" — precisa ser verificavel sem banco, senao ela vira promessa de comentario.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const {
  vereditoDaLinha, lerArgs, acaoAuditoria, RECENCIA_PADRAO_DIAS, ACAO_FECHADO, ACAO_INATIVO,
} = require('../scripts/descartar-leads-inativos')

const HOJE = Date.now()
const diasAtras = (n) => new Date(HOJE - n * 86400000).toISOString()

// Um lead operacional cuja review mais recente tem `dias` de idade.
function leadComReview(dias, extra = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    empresa_id: '22222222-2222-2222-2222-222222222222',
    nicho: 'Energia Solar', status: 'aguardando', qualificacao: 'legado',
    raw_json: { businessStatus: 'OPERATIONAL', top_reviews: [{ review_date: diasAtras(dias) }] },
    ...extra,
  }
}
// Um lead operacional SEM nenhuma data de atividade.
function leadSemData(extra = {}) {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    empresa_id: '22222222-2222-2222-2222-222222222222',
    nicho: 'Energia Solar', status: 'aguardando', qualificacao: 'legado',
    raw_json: { businessStatus: 'OPERATIONAL', reviews_count: 0 },
    ...extra,
  }
}

const SEM_RECENCIA = lerArgs(['node', 'x'])
const COM_RECENCIA = lerArgs(['node', 'x', '--recencia'])

test('recencia desligada e o padrao: um lead parado ha 3 anos NAO e descartado sem a flag', () => {
  assert.equal(SEM_RECENCIA.recenciaDias, null)
  const v = vereditoDaLinha(leadComReview(1100), SEM_RECENCIA)
  assert.equal(v.acao, 'manter')
})

test('com --recencia, review mais velha que o corte vira descarte', () => {
  const v = vereditoDaLinha(leadComReview(1100), COM_RECENCIA)
  assert.equal(v.acao, 'descartar')
  assert.equal(v.motivo, 'atividade_antiga')
})

test('com --recencia, review DENTRO do corte e mantida', () => {
  const v = vereditoDaLinha(leadComReview(30), COM_RECENCIA)
  assert.equal(v.acao, 'manter')
  assert.equal(v.motivo, 'atividade_dentro_do_corte')
})

test('AUSENCIA de data NUNCA vira descarte, nem com --recencia', () => {
  const v = vereditoDaLinha(leadSemData(), COM_RECENCIA)
  assert.equal(v.acao, 'manter')
  assert.equal(v.motivo, 'sem_prova_de_inatividade')
  assert.equal(v.atividade.dias_desde_atividade, null)
})

test('o corte e' + ' exclusivo: exatamente no limite ainda NAO descarta', () => {
  assert.equal(vereditoDaLinha(leadComReview(RECENCIA_PADRAO_DIAS), COM_RECENCIA).acao, 'manter')
  assert.equal(vereditoDaLinha(leadComReview(RECENCIA_PADRAO_DIAS + 2), COM_RECENCIA).acao, 'descartar')
})

test('--recencia=183 aplica o corte de 6 meses que o operador pediu', () => {
  const args = lerArgs(['node', 'x', '--recencia=183'])
  assert.equal(args.recenciaDias, 183)
  assert.equal(vereditoDaLinha(leadComReview(300), args).acao, 'descartar')
  assert.equal(vereditoDaLinha(leadComReview(100), args).acao, 'manter')
})

test('--recencia invalido ABORTA em vez de cair no default', () => {
  assert.throws(() => lerArgs(['node', 'x', '--recencia=abc']), /numero de dias/)
  assert.throws(() => lerArgs(['node', 'x', '--recencia=0']), /numero de dias/)
})

test('lead APROVADO por uma pessoa e pulado, nao descartado', () => {
  const v = vereditoDaLinha(leadComReview(1100, { qualificacao: 'aprovado' }), COM_RECENCIA)
  assert.equal(v.acao, 'pular_aprovado')
})

test('ja descartado nao e tocado de novo (idempotencia)', () => {
  const v = vereditoDaLinha(leadComReview(1100, { qualificacao: 'descartado' }), COM_RECENCIA)
  assert.equal(v.acao, 'manter')
  assert.equal(v.motivo, 'ja_descartado')
})

test('fechamento declarado tem precedencia sobre recencia no motivo', () => {
  const fechado = leadComReview(1100, { raw_json: { permanently_closed: true, top_reviews: [{ review_date: diasAtras(1100) }] } })
  const v = vereditoDaLinha(fechado, COM_RECENCIA)
  assert.equal(v.acao, 'descartar')
  assert.equal(v.motivo, 'fechado_permanente')
})

test('a acao de auditoria separa fechamento de inatividade', () => {
  assert.equal(acaoAuditoria('atividade_antiga'), ACAO_INATIVO)
  assert.equal(acaoAuditoria('fechado_permanente'), ACAO_FECHADO)
  assert.equal(acaoAuditoria('fechado_temporario'), ACAO_FECHADO)
  assert.notEqual(ACAO_FECHADO, ACAO_INATIVO)
})

// Guarda de regressao: o script nao pode ganhar criterio proprio de atividade nem chamada
// externa. Quem julga e' `services/google-business-activity.js`, e um descarte jamais pode
// custar uma coleta paga.
test('guarda: o script nao faz chamada externa nem duplica o classificador', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'descartar-leads-inativos.js'), 'utf8')
  for (const proibido of ['fetch(', 'axios', 'brightdata', 'BrightData', 'generateAIResponse']) {
    assert.ok(!fonte.includes(proibido), `descarte nao pode usar ${proibido}`)
  }
  assert.ok(fonte.includes("require('../src/services/google-business-activity')"),
    'o veredito de atividade tem de vir do classificador canonico')
})
