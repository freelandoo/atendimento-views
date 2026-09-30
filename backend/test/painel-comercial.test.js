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
    reunioesHumano: [{ dia: '2026-09-02', canal: 'instagram', n: 1 }],
    reunioesBot: [{ dia: '2026-09-02', n: 2 }],
  })
  assert.equal(serie.length, 2)
  assert.deepEqual(serie[0], { dia: '2026-09-01', mensagens: 0, ligacoes: 4, ligacoes_atendidas: 1, reunioes_humano: 0, reunioes_bot: 0 })
  assert.deepEqual(serie[1], { dia: '2026-09-02', mensagens: 5, ligacoes: 0, ligacoes_atendidas: 0, reunioes_humano: 1, reunioes_bot: 2 })
})

test('totalizar: reuniões = humano + bot', () => {
  const t = S.totalizar([
    { mensagens: 5, ligacoes: 4, ligacoes_atendidas: 1, reunioes_humano: 1, reunioes_bot: 2 },
    { mensagens: 1, ligacoes: 0, ligacoes_atendidas: 0, reunioes_humano: 0, reunioes_bot: 0 },
  ])
  assert.equal(t.mensagens, 6)
  assert.equal(t.ligacoes_atendidas, 1)
  assert.equal(t.reunioes, 3)
})

test('calcularRazoes: com denominador; divisão por zero → null (nunca 0)', () => {
  const r = S.calcularRazoes({ mensagens: 50, ligacoes_atendidas: 50, reunioes: 7, reunioes_humano: 7, reunioes_bot: 0 })
  assert.equal(r.contatos, 100)
  assert.equal(r.por_100_contatos, 7) // 7/100*100
  assert.equal(r.por_ligacao, 14) // 7/50*100
  const vazio = S.calcularRazoes({ mensagens: 0, ligacoes_atendidas: 0, reunioes: 0 })
  assert.equal(vazio.por_100_contatos, null)
  assert.equal(vazio.por_mensagem, null)
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
  })
  assert.equal(linhas[0].canal, 'meta_ads') // mais reuniões primeiro
  assert.equal(linhas[0].por_100_contatos, 30) // 3 / 10 contatos * 100
  const ig = linhas.find((l) => l.canal === 'instagram')
  assert.equal(ig.por_100_contatos, 4) // 2 / (40+10) * 100
})

test('montarPorCanal: origem ausente vira "desconhecido"', () => {
  const linhas = S.montarPorCanal({ ligacoes: [{ canal: null, n: 1, atendidas: 0 }] })
  assert.equal(linhas[0].canal, 'desconhecido')
})
