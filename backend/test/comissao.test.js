'use strict'
// Comissao do comercial — regra PURA + guardas de regressao que leem o fonte.
//
// O que este arquivo protege, em uma frase: **dinheiro ja creditado nao pode mudar sozinho.**

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const CM = require('../src/services/comissao')

const RAIZ = path.join(__dirname, '..')
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8')

// As faixas aprovadas pelo operador em 2026-09-18 (semeadas pela migration 083).
const FAIXAS = [
  { min: 0, max: 4999.99, percentual: 10 },
  { min: 5000, max: 9999.99, percentual: 12 },
  { min: 10000, max: 14999.99, percentual: 15 },
  { min: 15000, max: null, percentual: 18 },
]
const PLANO = { id: 'p1', slug: 'sdr-v1', versao: 1, faixas_json: FAIXAS, gatilho: CM.GATILHO.PRIMEIRO_PAGAMENTO }

// ─── As faixas ───────────────────────────────────────────────────────────────────────

test('faixaPara escolhe a faixa do acumulado, inclusive nos limites', () => {
  assert.equal(CM.faixaPara(0, FAIXAS).percentual, 10)
  assert.equal(CM.faixaPara(4999.99, FAIXAS).percentual, 10)
  assert.equal(CM.faixaPara(5000, FAIXAS).percentual, 12)
  assert.equal(CM.faixaPara(9999.99, FAIXAS).percentual, 12)
  assert.equal(CM.faixaPara(10000, FAIXAS).percentual, 15)
  assert.equal(CM.faixaPara(15000, FAIXAS).percentual, 18)
})

test('acumulado acima do teto fica na ULTIMA faixa, nunca fora do plano', () => {
  // "R$ 15.000+" nao tem topo. Devolver null aqui faria o melhor mes da operacao aparecer sem
  // percentual — o painel diria que o campeao esta fora do programa.
  assert.equal(CM.faixaPara(999999, FAIXAS).percentual, 18)
})

test('nivelAtual reproduz o painel prometido ao SDR', () => {
  // O exemplo que o operador escreveu: R$ 7.400 no mes => nivel 12%, faltam R$ 2.600 p/ 15%.
  const n = CM.nivelAtual(7400, FAIXAS)
  assert.equal(n.percentual, 12)
  assert.equal(n.proximo.percentual, 15)
  assert.equal(n.proximo.falta, 2600)
})

test('na ultima faixa NAO existe proximo (a tela diz "faixa maxima", nunca "faltam R$ 0")', () => {
  assert.equal(CM.nivelAtual(20000, FAIXAS).proximo, null)
})

// ─── A REGRA CENTRAL: o percentual congelado ─────────────────────────────────────────

test('a venda entra com a faixa que o SDR JA tinha — nao com a que ela desbloqueia', () => {
  // A regra do operador: "a taxa alcancada vale para as PROXIMAS vendas daquele mes, sem
  // recalcular para tras". SDR com R$ 4.000 fecha R$ 3.000: a venda entra a 10% e o painel
  // passa a mostrar 12%. As duas coisas ao mesmo tempo, e e' isso que o modulo separa.
  assert.equal(CM.percentualDaVenda(4000, FAIXAS), 10)
  assert.equal(CM.nivelAtual(7000, FAIXAS).percentual, 12)
})

test('calcularCredito congela plano, percentual e valor juntos', () => {
  const c = CM.calcularCredito({ valorVenda: 3000, acumuladoAntes: 4000, plano: PLANO })
  assert.equal(c.comissao_percentual, 10)
  assert.equal(c.comissao_base, 3000)
  assert.equal(c.comissao_valor, 300)
  assert.equal(c.plano_slug, 'sdr-v1')
  assert.equal(c.plano_versao, 1)
})

test('sequencia de vendas do mes: cada uma guarda o percentual do seu momento', () => {
  // E' o cenario que quebraria se o percentual fosse calculado na leitura: ao final do mes o
  // acumulado e' 12.000, mas NENHUMA das vendas vale 15%.
  let acumulado = 0
  const creditos = [4000, 3000, 5000].map((valor) => {
    const c = CM.calcularCredito({ valorVenda: valor, acumuladoAntes: acumulado, plano: PLANO })
    acumulado += c.comissao_base
    return c
  })
  assert.deepEqual(creditos.map((c) => c.comissao_percentual), [10, 10, 12])
  assert.equal(acumulado, 12000)
  assert.equal(CM.nivelAtual(acumulado, FAIXAS).percentual, 15)
})

test('centavos nao acumulam erro de ponto flutuante', () => {
  assert.equal(CM.calcularCredito({ valorVenda: 1010.10, acumuladoAntes: 0, plano: PLANO }).comissao_valor, 101.01)
})

// ─── O gatilho ───────────────────────────────────────────────────────────────────────

test('primeiro_pagamento libera no 1o recebimento e nunca mais', () => {
  const g = CM.GATILHO.PRIMEIRO_PAGAMENTO
  assert.equal(CM.liberaComissao({ gatilho: g, totalPagoAntes: 0, valorPagamento: 500 }), true)
  assert.equal(CM.liberaComissao({ gatilho: g, totalPagoAntes: 500, valorPagamento: 500 }), false)
})

test('parcelamento NAO reduz a comissao: a 1a parcela credita a venda INTEIRA', () => {
  // Venda de R$ 6.000 parcelada; entra R$ 1.000. A comissao incide sobre os R$ 6.000.
  const c = CM.calcularCredito({ valorVenda: 6000, acumuladoAntes: 0, plano: PLANO })
  assert.equal(c.comissao_base, 6000)
  assert.equal(c.comissao_valor, 600)
})

test('gatilho desconhecido NAO libera (ausencia de regra nunca vira liberacao)', () => {
  assert.equal(CM.liberaComissao({ gatilho: 'proporcional', totalPagoAntes: 0, valorPagamento: 500 }), false)
})

// ─── Competencia ─────────────────────────────────────────────────────────────────────

test('competencia e o mes do RECEBIMENTO, sempre no dia 1', () => {
  assert.equal(CM.competenciaDe('2026-09-30'), '2026-09-01')
})

// ─── Ranking ─────────────────────────────────────────────────────────────────────────

test('ranking ordena por faturamento originado e numera as posicoes', () => {
  const r = CM.montarRanking([
    { usuario_id: 'a', nome: 'Ana', originado: 5000, vendas: 2 },
    { usuario_id: 'b', nome: 'Bruno', originado: 12000, vendas: 3 },
    { usuario_id: 'c', nome: 'Caio', originado: 0, vendas: 0 },
  ])
  assert.deepEqual(r.map((l) => l.nome), ['Bruno', 'Ana'])
  assert.equal(r[0].posicao, 1)
})

test('ranking NAO devolve comissao de ninguem', () => {
  // Decisao D4: quanto o colega ganha e assunto dele com a empresa. O placar mede resultado da
  // operacao, nao contracheque alheio.
  const r = CM.montarRanking([{ usuario_id: 'a', nome: 'Ana', originado: 5000, vendas: 2 }])
  assert.deepEqual(Object.keys(r[0]).sort(), ['nome', 'originado', 'posicao', 'usuario_id', 'vendas'])
})

// ─── Validacao ───────────────────────────────────────────────────────────────────────

test('plano com faixas sobrepostas e recusado', () => {
  const v = CM.validarPlano({ nome: 'x', faixas: [{ min: 0, max: 5000, percentual: 10 }, { min: 4000, max: null, percentual: 12 }] })
  assert.equal(v.ok, false)
})

test('so a ULTIMA faixa pode ficar sem teto', () => {
  const v = CM.validarPlano({ nome: 'x', faixas: [{ min: 0, max: null, percentual: 10 }, { min: 6000, max: null, percentual: 12 }] })
  assert.equal(v.ok, false)
})

test('gatilho sem executor e recusado na entrada', () => {
  assert.equal(CM.validarPlano({ nome: 'x', faixas: FAIXAS, gatilho: 'acumulado_50' }).ok, false)
})

test('venda sem valor positivo e recusada', () => {
  assert.equal(CM.validarVenda({ valor: 0 }).ok, false)
  assert.equal(CM.validarVenda({ valor: 1500 }).ok, true)
})

test('pagamento exige data no formato de data', () => {
  assert.equal(CM.validarPagamento({ valor: 100, recebido_em: '30/09/2026' }).ok, false)
  assert.equal(CM.validarPagamento({ valor: 100, recebido_em: '2026-09-30' }).ok, true)
})

// ─── Guardas de regressao ────────────────────────────────────────────────────────────

test('guarda: o servico de comissao e PURO', () => {
  const fonte = ler('src', 'services', 'comissao.js')
  for (const proibido of ['require(\'../db', 'require("../db', 'pool.query', 'fetch(', 'axios']) {
    assert.ok(!fonte.includes(proibido),
      `"${proibido}" em comissao.js: a regra tem de continuar pura (sem banco, HTTP ou rede)`)
  }
})

test('guarda: o percentual NAO e recalculado na leitura', () => {
  // Se `percentualDaVenda`/`calcularCredito`/`faixaPara` aparecerem nas funcoes de LEITURA do
  // painel e do ranking, o numero do SDR volta a mudar sozinho quando uma venda antiga for paga
  // com atraso — que e' o defeito que a coluna `comissao_percentual` existe para impedir.
  const fonte = ler('src', 'db', 'comissao.js')
  const leitura = fonte.slice(fonte.indexOf('async function acumuladoDoMes'))
  for (const proibido of ['calcularCredito', 'percentualDaVenda']) {
    assert.ok(!leitura.includes(proibido),
      `"${proibido}" na camada de LEITURA: o percentual e congelado na escrita, nunca recalculado`)
  }
})

test('guarda: o acumulado soma comissao_base de venda CREDITADA, nunca valor de venda so fechada', () => {
  // O programa e "faturamento PAGO no mes". Somar `valor` de vendas `aguardando_pagamento` faria
  // o SDR subir de faixa com dinheiro que nao entrou.
  const fonte = ler('src', 'db', 'comissao.js')
  assert.ok(/SUM\(comissao_base\)[\s\S]{0,400}status IN \('comissao_liberada', 'comissao_paga'\)/.test(fonte),
    'o acumulado do mes precisa somar comissao_base apenas de vendas creditadas')
})

test('guarda: o credito e SERIALIZADO por (empresa, originador, competencia)', () => {
  const fonte = ler('src', 'db', 'comissao.js')
  assert.ok(fonte.includes('pg_advisory_xact_lock'),
    'sem lock, dois pagamentos simultaneos leem o mesmo acumulado e as duas vendas entram na faixa antiga')
})

test('guarda: o ledger de pagamentos e append-only (sem UPDATE/DELETE por rota)', () => {
  const fonte = ler('src', 'db', 'comissao.js')
  assert.ok(!/UPDATE\s+app\.venda_pagamentos/i.test(fonte), 'venda_pagamentos nao pode ser atualizada')
  assert.ok(!/DELETE\s+FROM\s+app\.venda_pagamentos/i.test(fonte), 'venda_pagamentos nao pode ser apagada')
})

test('guarda: nao existe rota que APAGUE venda', () => {
  // Mesma disciplina de Roteiros e de Membros: arquivar/cancelar em vez de excluir. Um DELETE
  // aqui desligaria em silencio a comissao ja creditada de uma pessoa.
  const fonte = ler('src', 'routes', 'api-comissao.js')
  assert.ok(!/router\.delete\(/.test(fonte), 'venda nao se exclui: cancela-se antes do credito')
})

test('guarda: cancelar venda so vale ANTES do credito', () => {
  const fonte = ler('src', 'db', 'comissao.js')
  const trecho = fonte.slice(fonte.indexOf('async function cancelarVenda'))
  assert.ok(trecho.includes("status = 'aguardando_pagamento'"),
    'comissao ja liberada e fato: desfazer reescreveria o passado')
})

test('guarda: a venda de reuniao mantem UMA fonte de valor (a Meta nao pode divergir)', () => {
  // D1: quando a venda vem de reuniao, a MESMA transacao atualiza `agenda_eventos.venda_valor`,
  // que e o que o meta-dispatch le para emitir o Purchase. Evento aceito pela Meta nao se estorna.
  const fonte = ler('src', 'db', 'comissao.js')
  assert.ok(/UPDATE app\.agenda_eventos[\s\S]{0,300}venda_valor/.test(fonte),
    'registrar venda vinda de reuniao precisa manter o valor no evento de agenda, na mesma transacao')
})

test('guarda: a CHECK do gatilho no banco espelha o vocabulario do servico', () => {
  // Anti-drift: alargar a CHECK sem implementar o gatilho criaria plano configuravel que ninguem
  // sabe executar — e o SDR ficaria esperando comissao que nunca seria liberada.
  const migration = ler('sql', 'migrations', '083_comissao_sdr.sql')
  const m = migration.match(/comissao_planos_gatilho_chk CHECK \(gatilho IN \(([^)]+)\)\)/)
  assert.ok(m, 'CHECK do gatilho nao encontrada na migration 083')
  const noBanco = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
  assert.deepEqual(noBanco, Object.values(CM.GATILHO).sort())
})

test('guarda: a CHECK de status no banco espelha VENDA_STATUS', () => {
  const migration = ler('sql', 'migrations', '083_comissao_sdr.sql')
  const m = migration.match(/vendas_status_chk CHECK \(status IN \(([^)]+)\)\)/)
  assert.ok(m, 'CHECK de status nao encontrada na migration 083')
  const noBanco = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
  assert.deepEqual(noBanco, Object.values(CM.VENDA_STATUS).sort())
})

test('guarda: a migration 083 e ADITIVA (nao muta dado existente)', () => {
  const migration = ler('sql', 'migrations', '083_comissao_sdr.sql')
  assert.ok(!/^\s*UPDATE\s+/im.test(migration), 'a 083 nao pode atualizar linha existente')
  assert.ok(!/DROP\s+TABLE/i.test(migration), 'a 083 nao pode derrubar tabela')
  // O unico INSERT permitido e o do plano inicial, guardado por NOT EXISTS (idempotente).
  assert.ok(/NOT EXISTS \(SELECT 1 FROM app\.comissao_planos/.test(migration),
    'o seed do plano precisa ser idempotente')
})

test('guarda: o painel do SDR nao inventa faixa quando nao ha plano', () => {
  const fonte = ler('src', 'routes', 'api-comissao.js')
  assert.ok(/plano \? CM\.nivelAtual/.test(fonte),
    'sem plano ativo o nivel tem de ser null — mostrar 0% afirmaria uma regra que ninguem combinou')
})
