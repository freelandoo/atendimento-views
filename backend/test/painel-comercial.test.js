'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const S = require('../src/services/painel-comercial')

test('resolverPeriodo: default = últimos 7 dias', () => {
  const agora = new Date('2026-09-29T12:00:00.000Z')
  const p = S.resolverPeriodo({ agora })
  assert.equal(p.de, '2026-09-22T12:00:00.000Z')
  assert.equal(p.ate, '2026-09-29T12:00:00.000Z')
  assert.match(p.rotulo, /7 dias/)
})

test('resolverPeriodo: 30d', () => {
  const agora = new Date('2026-09-29T00:00:00.000Z')
  const p = S.resolverPeriodo({ periodo: '30d', agora })
  assert.equal(p.de, '2026-08-30T00:00:00.000Z')
})

test('resolverPeriodo: de/ate explícito com limite superior EXCLUSIVO (fim do dia)', () => {
  const p = S.resolverPeriodo({ de: '2026-09-01', ate: '2026-09-07' })
  assert.equal(p.de, '2026-09-01T00:00:00.000Z')
  assert.equal(p.ate, '2026-09-08T00:00:00.000Z') // +1 dia
})

test('resolverPeriodo: intervalo inválido cai no default', () => {
  const agora = new Date('2026-09-29T12:00:00.000Z')
  const p = S.resolverPeriodo({ de: 'lixo', ate: '2026-09-07', agora })
  assert.match(p.rotulo, /7 dias/)
})

test('montarSerie: une por dia e ACUMULA linhas por (dia, canal)', () => {
  const serie = S.montarSerie({
    mensagens: [
      { dia: '2026-09-02', canal: 'instagram', n: 3 },
      { dia: '2026-09-02', canal: 'meta_ads', n: 2 }, // mesmo dia, outro canal → soma
    ],
    ligacoes: [{ dia: '2026-09-01', canal: 'google_places', n: 4, atendidas: 1 }],
    conversou: [{ dia: '2026-09-02', canal: 'instagram', n: 3 }],
    reunioesHumano: [{ dia: '2026-09-02', canal: 'instagram', n: 1 }],
    reunioesBot: [{ dia: '2026-09-02', n: 2 }],
  })
  assert.equal(serie.length, 2)
  assert.deepEqual(serie[0], { dia: '2026-09-01', mensagens: 0, ligacoes: 4, ligacoes_atendidas: 1, conversou: 0, reunioes_humano: 0, reunioes_bot: 0, vendas: 0, faturamento: 0 })
  assert.deepEqual(serie[1], { dia: '2026-09-02', mensagens: 5, ligacoes: 0, ligacoes_atendidas: 0, conversou: 3, reunioes_humano: 1, reunioes_bot: 2, vendas: 0, faturamento: 0 })
})

test('totalizar: reuniões = humano + bot; conversou somado', () => {
  const t = S.totalizar([
    { mensagens: 5, ligacoes: 4, ligacoes_atendidas: 1, conversou: 2, reunioes_humano: 1, reunioes_bot: 2 },
    { mensagens: 1, ligacoes: 0, ligacoes_atendidas: 0, conversou: 0, reunioes_humano: 0, reunioes_bot: 0 },
  ])
  assert.equal(t.mensagens, 6)
  assert.equal(t.ligacoes_atendidas, 1)
  assert.equal(t.conversou, 2)
  assert.equal(t.reunioes, 3)
})

test('calcularRazoes: com denominador; taxa de resposta; div/0 → null', () => {
  const r = S.calcularRazoes({ mensagens: 50, ligacoes_atendidas: 50, conversou: 20, reunioes: 7, reunioes_humano: 7, reunioes_bot: 0 })
  assert.equal(r.contatos, 100)
  assert.equal(r.por_100_contatos, 7) // 7/100*100
  assert.equal(r.por_ligacao, 14) // 7/50*100
  assert.equal(r.taxa_resposta, 40) // 20/50*100 (respostas / mensagens)
  const vazio = S.calcularRazoes({ mensagens: 0, ligacoes_atendidas: 0, conversou: 0, reunioes: 0 })
  assert.equal(vazio.por_100_contatos, null)
  assert.equal(vazio.por_mensagem, null)
  assert.equal(vazio.taxa_resposta, null)
})

test('montarPorCanal: soma por canal, calcula taxa e ordena por reuniões', () => {
  const linhas = S.montarPorCanal({
    mensagens: [
      { canal: 'instagram', n: 40 },
      { canal: 'meta_ads', n: 10 },
    ],
    ligacoes: [{ canal: 'instagram', n: 5, atendidas: 10 }],
    reunioes: [
      { canal: 'meta_ads', n: 3 },
      { canal: 'instagram', n: 2 },
    ],
    conversou: [{ canal: 'instagram', n: 20 }],
  })
  assert.equal(linhas[0].canal, 'meta_ads') // mais reuniões primeiro
  assert.equal(linhas[0].por_100_contatos, 30) // 3 / 10 contatos * 100
  const ig = linhas.find((l) => l.canal === 'instagram')
  assert.equal(ig.por_100_contatos, 4) // 2 / (40+10) * 100
  assert.equal(ig.taxa_resposta, 50) // 20 respostas / 40 mensagens * 100
  assert.equal(linhas[0].taxa_resposta, 0) // meta_ads: 0 respostas / 10 mensagens = 0 (tem denominador)
})

test('montarPorCanal: origem ausente vira "desconhecido"', () => {
  const linhas = S.montarPorCanal({ ligacoes: [{ canal: null, n: 1, atendidas: 0 }] })
  assert.equal(linhas[0].canal, 'desconhecido')
})

test('vendas: entram na série, nos totais e no por-canal (contagem + faturamento)', () => {
  const serie = S.montarSerie({
    mensagens: [{ dia: '2026-09-02', canal: 'instagram', n: 5 }],
    vendas: [
      { dia: '2026-09-02', canal: 'instagram', n: 1, valor: 3000 },
      { dia: '2026-09-02', canal: 'meta_ads', n: 1, valor: 2000 }, // mesmo dia, outro canal → soma
    ],
  })
  assert.equal(serie[0].vendas, 2)
  assert.equal(serie[0].faturamento, 5000)
  const t = S.totalizar(serie)
  assert.equal(t.vendas, 2)
  assert.equal(t.faturamento, 5000)
  const canais = S.montarPorCanal({ vendas: [{ canal: 'instagram', n: 1, valor: 3000 }] })
  assert.equal(canais[0].vendas, 1)
  assert.equal(canais[0].faturamento, 3000)
})

test('montarFunilConversao: níveis decrescentes com queda e largura proporcional ao topo', () => {
  const f = S.montarFunilConversao({ mensagens: 80, ligacoes_atendidas: 20, conversou: 40, reunioes: 10, vendas: 3 })
  assert.deepEqual(f.map((n) => n.n), [100, 40, 10, 3]) // contatos, responderam, reuniões, vendas
  assert.equal(f[0].quedaPct, null) // topo não tem queda
  assert.equal(f[0].larguraPct, 100)
  assert.equal(f[1].quedaPct, 60) // (100-40)/100
  assert.equal(f[3].larguraPct, 3) // 3/100
})

test('montarFunilConversao: topo zero → larguras 0, sem inventar proporção', () => {
  const f = S.montarFunilConversao({ mensagens: 0, ligacoes_atendidas: 0, conversou: 0, reunioes: 0, vendas: 0 })
  assert.equal(f[0].n, 0)
  assert.equal(f[0].larguraPct, 0)
  assert.equal(f[3].larguraPct, 0)
})
