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

test('ordenarFunil: ordem canônica com 0, desconhecido ao fim, pct pelo maior', () => {
  const f = P.ordenarFunil([
    { estagio: 'proposta', n: 5 },
    { estagio: 'primeiro_contato', n: 10 },
    { estagio: 'zumbi', n: 2 },
  ])
  assert.deepEqual(f.map((l) => l.estagio), ['primeiro_contato', 'diagnostico', 'proposta', 'objecao', 'fechamento', 'zumbi'])
  assert.equal(f[0].rotulo, 'Primeiro contato')
  assert.equal(f[1].n, 0) // diagnóstico ausente → 0 (funil mantém a etapa)
  assert.equal(f[0].pct, 100) // maior (10)
  assert.equal(f[2].pct, 50) // proposta 5/10
  assert.equal(f[5].rotulo, 'zumbi') // desconhecido aparece como ele mesmo, ao fim
})

test('ordenarFunil: vazio → 5 etapas em zero', () => {
  const f = P.ordenarFunil([])
  assert.equal(f.length, 5)
  assert.ok(f.every((l) => l.n === 0 && l.pct === 0))
})

test('janelaPreset / janelaAnterior: datas inclusivas e janela anterior de mesmo tamanho', () => {
  const hoje = new Date('2026-09-29T12:00:00Z')
  assert.deepEqual(P.janelaPreset('7d', hoje), { de: '2026-09-23', ate: '2026-09-29' }) // 7 dias inclusivos
  assert.deepEqual(P.janelaPreset('30d', hoje), { de: '2026-08-31', ate: '2026-09-29' })
  // anterior a 23–29 (7 dias) = 16–22
  assert.deepEqual(P.janelaAnterior('2026-09-23', '2026-09-29'), { de: '2026-09-16', ate: '2026-09-22' })
})

test('maxSerie / larguraPct: escala e divisão por zero → 0', () => {
  const serie = [{ mensagens: 3, ligacoes: 10 }, { mensagens: 8, ligacoes: 2 }]
  assert.equal(P.maxSerie(serie, ['mensagens', 'ligacoes']), 10)
  assert.equal(P.larguraPct(5, 10), 50)
  assert.equal(P.larguraPct(5, 0), 0)
  assert.equal(P.larguraPct(0, 0), 0)
})
