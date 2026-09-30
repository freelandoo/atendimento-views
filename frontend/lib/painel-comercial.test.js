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

test('funilComQueda: acumulado (etapa ou além), largura e queda entre etapas', () => {
  const { etapas, outros } = P.funilComQueda([
    { estagio: 'primeiro_contato', n: 10 },
    { estagio: 'diagnostico', n: 5 },
    { estagio: 'proposta', n: 3 },
    { estagio: 'fechamento', n: 2 },
    { estagio: 'zumbi', n: 7 },
  ])
  assert.deepEqual(etapas.map((e) => e.acumulado), [20, 10, 5, 2, 2]) // soma de i até o fim
  assert.deepEqual(etapas.map((e) => e.larguraPct), [100, 50, 25, 10, 10])
  assert.equal(etapas[0].quedaPct, null) // primeira etapa não tem queda
  assert.equal(etapas[1].quedaPct, 50) // 1 - 10/20
  assert.equal(etapas[3].quedaPct, 60) // objeção: 1 - 2/5
  assert.equal(etapas[1].n, 5) // parados exatamente no diagnóstico
  assert.equal(outros, 7) // estágio fora do pipeline não entra no funil
})

test('funilComQueda: vazio → etapas zeradas, sem queda inventada', () => {
  const { etapas, outros } = P.funilComQueda([])
  assert.equal(etapas.length, 5)
  assert.ok(etapas.every((e) => e.acumulado === 0 && e.larguraPct === 0))
  assert.ok(etapas.every((e, i) => (i === 0 ? e.quedaPct === null : e.quedaPct === null)))
  assert.equal(outros, 0)
})

test('janelaPreset / janelaAnterior: datas inclusivas e janela anterior de mesmo tamanho', () => {
  const hoje = new Date('2026-09-29T12:00:00Z')
  assert.deepEqual(P.janelaPreset('1d', hoje), { de: '2026-09-29', ate: '2026-09-29' }) // hoje
  assert.deepEqual(P.janelaPreset('7d', hoje), { de: '2026-09-23', ate: '2026-09-29' }) // 7 dias inclusivos
  assert.deepEqual(P.janelaPreset('14d', hoje), { de: '2026-09-16', ate: '2026-09-29' })
  assert.deepEqual(P.janelaPreset('30d', hoje), { de: '2026-08-31', ate: '2026-09-29' })
  // anterior a 23–29 (7 dias) = 16–22
  assert.deepEqual(P.janelaAnterior('2026-09-23', '2026-09-29'), { de: '2026-09-16', ate: '2026-09-22' })
})

test('melhorHora: maior taxa entre as com amostra mínima; ignora amostra pequena', () => {
  const rows = [
    { hora: 9, enviados: 100, responderam: 40 }, // 40%
    { hora: 14, enviados: 3, responderam: 3 }, // 100% mas amostra < 5 → ignorada
    { hora: 19, enviados: 50, responderam: 30 }, // 60%
  ]
  assert.deepEqual(P.melhorHora(rows), { hora: 19, taxa: 0.6 })
  assert.equal(P.melhorHora([{ hora: 8, enviados: 2, responderam: 2 }]), null) // nada com amostra
  assert.equal(P.melhorHora([]), null)
})

test('formatarDelta: quantidade e %; anterior 0 → novo, pct null', () => {
  assert.deepEqual(P.formatarDelta(120, 100), { abs: 20, pct: 20, seta: '▲', novo: false })
  assert.deepEqual(P.formatarDelta(80, 100), { abs: -20, pct: -20, seta: '▼', novo: false })
  assert.deepEqual(P.formatarDelta(100, 100), { abs: 0, pct: 0, seta: '=', novo: false })
  const semBase = P.formatarDelta(5, 0)
  assert.equal(semBase.pct, null) // não divide por zero
  assert.equal(semBase.novo, true)
})

test('direcaoDaOrigem / agruparPorDirecao: inbound × outbound × indefinido', () => {
  assert.equal(P.direcaoDaOrigem('whatsapp'), 'inbound')
  assert.equal(P.direcaoDaOrigem('meta_ads'), 'outbound')
  assert.equal(P.direcaoDaOrigem('desconhecido'), 'indefinido')
  const g = P.agruparPorDirecao([
    { canal: 'meta_ads', mensagens: 40, ligacoes: 0, ligacoes_atendidas: 0, conversou: 8, reunioes: 4 },
    { canal: 'instagram', mensagens: 10, ligacoes: 0, ligacoes_atendidas: 0, conversou: 1, reunioes: 1 },
    { canal: 'whatsapp', mensagens: 20, ligacoes: 0, ligacoes_atendidas: 0, conversou: 10, reunioes: 3 },
  ])
  assert.equal(g.outbound.mensagens, 50) // meta_ads + instagram
  assert.equal(g.outbound.reunioes, 5)
  assert.equal(g.inbound.mensagens, 20)
  assert.equal(g.inbound.taxa_resposta, 50) // 10/20
  assert.equal(g.outbound.taxa_resposta, 18) // 9/50
  assert.equal(g.indefinido.mensagens, 0)
})

test('maxSerie / larguraPct: escala e divisão por zero → 0', () => {
  const serie = [{ mensagens: 3, ligacoes: 10 }, { mensagens: 8, ligacoes: 2 }]
  assert.equal(P.maxSerie(serie, ['mensagens', 'ligacoes']), 10)
  assert.equal(P.larguraPct(5, 10), 50)
  assert.equal(P.larguraPct(5, 0), 0)
  assert.equal(P.larguraPct(0, 0), 0)
})
