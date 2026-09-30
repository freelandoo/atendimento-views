'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const P = require('./painel-comercial')

test('rotuloCanal: conhecido, desconhecido e fallback', () => {
  assert.equal(P.rotuloCanal('meta_ads'), 'Anúncios Meta')
  assert.equal(P.rotuloCanal('desconhecido'), 'Sem origem')
  assert.equal(P.rotuloCanal('xyz'), 'xyz') // origem nova aparece como ela mesma, nunca sumida
  assert.equal(P.rotuloCanal(null), 'Sem origem')
})

test('fmtTaxa: null vira "—", nunca 0', () => {
  assert.equal(P.fmtTaxa(null), '—')
  assert.equal(P.fmtTaxa(0), '0')
  assert.equal(P.fmtTaxa(7), '7')
})

test('fraseRazao: com denominador; sem contatos tem texto próprio', () => {
  assert.equal(P.fraseRazao({ contatos: 100, reunioes: 7, por_100_contatos: 7 }), '7 reuniões / 100 contatos')
  assert.equal(P.fraseRazao({ contatos: 0, reunioes: 0, por_100_contatos: null }), 'Sem contatos no período')
  assert.equal(P.fraseRazao(null), 'Sem contatos no período')
})

test('idadeEquipe: hoje, dias, meses, anos; inválida/futura → ""', () => {
  const agora = new Date('2026-09-29T12:00:00Z')
  assert.equal(P.idadeEquipe('2026-09-29T08:00:00Z', agora), 'criada hoje')
  assert.equal(P.idadeEquipe('2026-09-24T12:00:00Z', agora), 'há 5 dias')
  assert.equal(P.idadeEquipe('2026-07-01T12:00:00Z', agora), 'há 3 meses') // 90 dias
  assert.equal(P.idadeEquipe('2025-01-01T12:00:00Z', agora), 'há 1 ano')
  assert.equal(P.idadeEquipe('2027-01-01T12:00:00Z', agora), '') // futura
  assert.equal(P.idadeEquipe(null, agora), '')
  assert.equal(P.idadeEquipe('lixo', agora), '')
})

test('maxSerie / larguraPct: escala e divisão por zero → 0', () => {
  const serie = [{ mensagens: 3, ligacoes: 10 }, { mensagens: 8, ligacoes: 2 }]
  assert.equal(P.maxSerie(serie, ['mensagens', 'ligacoes']), 10)
  assert.equal(P.larguraPct(5, 10), 50)
  assert.equal(P.larguraPct(5, 0), 0)
  assert.equal(P.larguraPct(0, 0), 0)
})
