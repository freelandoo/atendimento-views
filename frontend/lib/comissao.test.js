'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const M = require('./comissao')
const FONTE = fs.readFileSync(path.join(__dirname, 'comissao.js'), 'utf8')

const painel = (nivel, plano = { nome: 'Comissao SDR v1', slug: 'sdr-v1', versao: 1, faixas: [], gatilho: 'primeiro_pagamento' }) =>
  ({ plano, nivel })

test('resumoDoNivel reproduz a frase prometida ao SDR', () => {
  const r = M.resumoDoNivel(painel({
    acumulado: 7400, percentual: 12, faixa_min: 5000, faixa_max: 9999.99,
    proximo: { percentual: 15, a_partir_de: 10000, falta: 2600 },
  }))
  assert.equal(r.titulo, 'Seu nível atual: 12%')
  assert.ok(r.detalhe.includes('2.600'), r.detalhe)
  assert.ok(r.detalhe.includes('15%'), r.detalhe)
})

test('sem plano ativo a tela NAO inventa faixa', () => {
  const r = M.resumoDoNivel({ plano: null, nivel: null })
  assert.equal(r.configurado, false)
  assert.equal(r.progresso, null)
  assert.ok(!r.titulo.includes('0%'), 'mostrar 0% afirmaria uma regra que ninguem combinou')
})

test('na faixa maxima a tela diz "faixa maxima", nunca "faltam R$ 0"', () => {
  const r = M.resumoDoNivel(painel({ acumulado: 20000, percentual: 18, faixa_min: 15000, faixa_max: null, proximo: null }))
  assert.ok(r.detalhe.includes('faixa máxima'))
  assert.equal(r.progresso.percentual, 100)
})

test('a barra mede o progresso DENTRO da faixa, nao sobre o total do mes', () => {
  // 7.400 na faixa 5.000-10.000 = metade do caminho (48%), nao 74%.
  const r = M.resumoDoNivel(painel({
    acumulado: 7400, percentual: 12, faixa_min: 5000, faixa_max: 9999.99,
    proximo: { percentual: 15, a_partir_de: 10000, falta: 2600 },
  }))
  assert.equal(r.progresso.percentual, 48)
})

test('formatarDinheiro devolve moeda brasileira e trata valor ausente', () => {
  assert.ok(M.formatarDinheiro(2600).includes('2.600'))
  assert.equal(M.formatarDinheiro(null), '—')
})

test('rotuloCompetencia le o mes por extenso', () => {
  assert.equal(M.rotuloCompetencia('2026-09-01'), 'setembro de 2026')
  assert.equal(M.rotuloCompetencia(''), '—')
})

test('o status diz a CONSEQUENCIA, nao so o estado', () => {
  assert.ok(M.rotuloStatus('aguardando_pagamento').ajuda.includes('liberada quando o cliente paga'))
  assert.equal(M.rotuloStatus('inexistente').rotulo, 'inexistente')
})

test('medalha so nas tres primeiras posicoes', () => {
  assert.equal(M.medalhaDaPosicao(1), '🥇')
  assert.equal(M.medalhaDaPosicao(4), null)
})

test('destacarVoce marca a propria linha sem reordenar', () => {
  const r = M.destacarVoce([{ usuario_id: 'a', posicao: 1 }, { usuario_id: 'b', posicao: 2 }], 'b')
  assert.deepEqual(r.map((l) => l.voce), [false, true])
})

test('acoes dependem do estado E de quem olha', () => {
  const venda = { status: 'aguardando_pagamento' }
  assert.deepEqual(M.acoesDaVenda(venda, false), [], 'quem nao gerencia nao recebe acao nenhuma')
  assert.deepEqual(M.acoesDaVenda(venda, true).map((a) => a.id), ['pagamento', 'cancelar'])
  assert.deepEqual(M.acoesDaVenda({ status: 'comissao_liberada' }, true).map((a) => a.id), ['pagamento', 'pagar'])
})

test('venda com comissao liberada nao oferece cancelar, e explica por que', () => {
  const acoes = M.acoesDaVenda({ status: 'comissao_liberada' }, true)
  assert.ok(!acoes.some((a) => a.id === 'cancelar'))
  assert.ok(M.motivoNaoCancelavel({ status: 'comissao_liberada' }).includes('fato registrado'))
  assert.equal(M.motivoNaoCancelavel({ status: 'aguardando_pagamento' }), null)
})

// ─── Guardas de regressao ────────────────────────────────────────────────────────────

test('guarda: a tela NAO calcula faixa, percentual nem comissao', () => {
  // A regra vive no backend (`services/comissao.js`). Uma segunda regua aqui faria a tela
  // explicar uma comissao diferente da que foi paga.
  for (const proibido of ['faixaPara', 'percentualDaVenda', 'calcularCredito', 'liberaComissao']) {
    assert.ok(!FONTE.includes(proibido),
      `"${proibido}" no front: a regra de comissao e do backend`)
  }
})

test('guarda: o ranking nao exibe comissao de ninguem', () => {
  // Decisao D4: cada um ve so o proprio dinheiro. Se o payload um dia trouxer `comissao` por
  // pessoa, este modulo continua nao o lendo.
  const trecho = FONTE.slice(FONTE.indexOf('medalhaDaPosicao'))
  assert.ok(!/comissao/i.test(trecho.split('acoesDaVenda')[0]),
    'a area de ranking nao pode ler comissao por pessoa')
})

test('guarda: nenhuma chamada de rede no modulo de apresentacao', () => {
  for (const proibido of ['fetch(', 'apiFetch', 'axios']) {
    assert.ok(!FONTE.includes(proibido), `"${proibido}" em lib/comissao.js: o modulo so traduz`)
  }
})
