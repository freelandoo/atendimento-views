'use strict'
// Missão da Operação Comercial (Etapa 2) — apresentação PURA, sem React e sem rede.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const M = require('./missao')

const MISSAO = Object.freeze({
  titulo: 'Desafio de setembro',
  inicio: '2026-09-01',
  fim: '2026-09-30',
  recompensa_descricao: 'Bônus de fechamento',
  recompensa_valor: 1000,
})

// ─── Situação ────────────────────────────────────────────────────────────────────────────

test('prazo vencido NAO e encerrada — sao frases diferentes', () => {
  // Dizer "encerrada" faria a tela afirmar uma decisão que ninguém tomou.
  const vencido = M.rotuloSituacao('prazo_vencido')
  const encerrada = M.rotuloSituacao('encerrada')
  assert.notEqual(vencido.rotulo, encerrada.rotulo)
  assert.match(vencido.explicacao, /at[ée] algu[ée]m encerrar|acabou/i)
})

test('as quatro situacoes tem rotulo, tom e explicacao', () => {
  for (const s of ['agendada', 'vigente', 'prazo_vencido', 'encerrada']) {
    const r = M.rotuloSituacao(s)
    assert.ok(r.rotulo && r.tom && r.explicacao, `situacao ${s} incompleta`)
  }
})

test('situacao desconhecida nao quebra a tela', () => {
  assert.equal(M.rotuloSituacao('situacao_nova_do_servidor').rotulo, '—')
  assert.equal(M.rotuloSituacao(null).rotulo, '—')
})

// ─── Janela e recompensa ─────────────────────────────────────────────────────────────────

test('janela em formato brasileiro, e um dia so aparece uma vez', () => {
  assert.equal(M.janelaTexto(MISSAO), '01/09/2026 a 30/09/2026')
  assert.equal(M.janelaTexto({ inicio: '2026-09-10', fim: '2026-09-10' }), '10/09/2026')
  assert.equal(M.janelaTexto(null), '—')
  assert.equal(M.dataBR('data-ruim'), '—')
})

test('a recompensa em dinheiro QUALIFICA a descricao, nao a substitui', () => {
  const t = M.recompensaTexto(MISSAO)
  assert.match(t, /Bônus de fechamento/)
  assert.match(t, /1\.000/)
})

test('recompensa sem valor mostra so a descricao — nem todo premio e dinheiro', () => {
  assert.equal(M.recompensaTexto({ recompensa_descricao: 'Um dia de folga', recompensa_valor: null }), 'Um dia de folga')
  assert.equal(M.recompensaTexto({ recompensa_descricao: 'Um dia de folga' }), 'Um dia de folga')
})

// ─── Meu progresso ───────────────────────────────────────────────────────────────────────

test('progresso parcial diz quanto FALTA, e a barra acompanha', () => {
  const r = M.resumoDoProgresso({ valor: 12500, alvo: 20000, faltam: 7500, fracao: 0.625, alcancado: false }, 'vigente')
  assert.equal(r.alcancado, false)
  assert.match(r.frase, /Faltam/)
  assert.match(r.frase, /7\.500/)
  assert.equal(r.larguraBarra, '63%')
})

test('alcancado comemora e enche a barra', () => {
  const r = M.resumoDoProgresso({ valor: 68000, alvo: 20000, faltam: 0, fracao: 1, alcancado: true }, 'vigente')
  assert.equal(r.alcancado, true)
  assert.match(r.frase, /alcançou/i)
  assert.equal(r.larguraBarra, '100%')
  assert.equal(r.tom, 'positivo')
})

test('depois do prazo a conquista continua sendo fato, e quem nao bateu ouve no passado', () => {
  const bateu = M.resumoDoProgresso({ valor: 30000, alvo: 20000, fracao: 1, alcancado: true }, 'encerrada')
  assert.match(bateu.frase, /alcançou/i)

  const naoBateu = M.resumoDoProgresso({ valor: 5000, alvo: 20000, faltam: 15000, fracao: 0.25, alcancado: false }, 'encerrada')
  assert.match(naoBateu.frase, /Faltaram/)
})

test('alvo ilegivel NAO comemora conquista que ninguem definiu', () => {
  const r = M.resumoDoProgresso({ valor: 99999, alvo: null, fracao: 0, alcancado: false }, 'vigente')
  assert.equal(r.alcancado, false)
  assert.match(r.frase, /sem um alvo/i)
  assert.equal(r.larguraBarra, '0%')
})

test('progresso ausente nao quebra e nao inventa numero', () => {
  const r = M.resumoDoProgresso(null, 'vigente')
  assert.equal(r.alcancado, false)
  assert.equal(r.larguraBarra, '0%')
})

test('a barra nunca passa de 100% nem fica negativa', () => {
  assert.equal(M.resumoDoProgresso({ valor: 1, alvo: 1, fracao: 3.4, alcancado: true }).larguraBarra, '100%')
  assert.equal(M.resumoDoProgresso({ valor: 0, alvo: 10, fracao: -1, alcancado: false }).larguraBarra, '0%')
})

// ─── Quem alcançou (visão do dono) ───────────────────────────────────────────────────────

test('lista AUSENTE e lista VAZIA sao coisas diferentes', () => {
  // Ausente = "você não vê isto" (não gerencia). Vazia = "ninguém alcançou ainda".
  assert.equal(M.resumoDeQuemAlcancou(null), null)
  assert.equal(M.resumoDeQuemAlcancou(undefined), null)
  const vazia = M.resumoDeQuemAlcancou([])
  assert.equal(vazia.total, 0)
  assert.match(vazia.frase, /Ninguém/)
})

test('a ordem do servidor e PRESERVADA — reordenar por valor criaria placar', () => {
  const lista = [
    { usuario_id: 'a', nome: 'Ana', valor: 21000, vendas: 2 },
    { usuario_id: 'b', nome: 'Bruno', valor: 90000, vendas: 5 },
  ]
  const r = M.resumoDeQuemAlcancou(lista)
  assert.deepEqual(r.itens.map((i) => i.nome), ['Ana', 'Bruno'])
  assert.equal(r.total, 2)
  assert.match(r.frase, /2 pessoas/)
})

test('singular e plural, e pessoa sem nome nao vira linha em branco', () => {
  const r = M.resumoDeQuemAlcancou([{ usuario_id: 'a', nome: null, valor: 21000, vendas: 1 }])
  assert.match(r.frase, /1 pessoa alcançou/)
  assert.equal(r.itens[0].nome, 'Sem nome')
})

// ─── A baixa da recompensa (Etapa 4) ─────────────────────────────────────────────────────

test('quem alcancou carrega se JA RECEBEU, e "nao pago" nunca fica mudo', () => {
  const r = M.resumoDeQuemAlcancou([
    { usuario_id: 'a', nome: 'Ana', valor: 30000, pago: true, valor_pago: 1000 },
    { usuario_id: 'b', nome: 'Bruno', valor: 25000 },
  ])
  assert.equal(r.itens[0].pago, true)
  assert.match(r.itens[0].rotuloPagamento, /entregue/i)
  assert.match(r.itens[0].rotuloPagamento, /1\.000/)
  assert.equal(r.itens[1].pago, false)
  assert.ok(r.itens[1].rotuloPagamento, 'quem nao recebeu tambem precisa de rotulo')
})

test('premio NAO-monetario entregue nao inventa valor', () => {
  const r = M.resumoDeQuemAlcancou([{ usuario_id: 'a', nome: 'Ana', valor: 30000, pago: true, valor_pago: null }])
  assert.equal(r.itens[0].rotuloPagamento, 'Prêmio entregue')
})

test('pendentes conta o que resta FAZER, separado do total', () => {
  const r = M.resumoDeQuemAlcancou([
    { usuario_id: 'a', nome: 'Ana', valor: 30000, pago: true },
    { usuario_id: 'b', nome: 'Bruno', valor: 25000 },
    { usuario_id: 'c', nome: 'Caio', valor: 22000 },
  ])
  assert.equal(r.total, 3)
  assert.equal(r.pendentes, 2)
})

test('minhaRecompensa e null para quem NAO alcancou', () => {
  // Prometer entrega a quem não bateu o alvo seria pior que não dizer nada.
  assert.equal(M.minhaRecompensa({ alcancado: false, recompensa_paga: false }), null)
  assert.equal(M.minhaRecompensa(null), null)
})

test('alcancou e ainda nao recebeu: a tela DIZ isso', () => {
  const r = M.minhaRecompensa({ alcancado: true, recompensa_paga: false })
  assert.equal(r.pago, false)
  assert.match(r.frase, /ainda não foi registrada/i)
  assert.equal(r.tom, 'espera')
})

test('recebeu: mostra o valor quando houve, e nao inventa quando nao houve', () => {
  const comValor = M.minhaRecompensa({ alcancado: true, recompensa_paga: true, recompensa_valor_pago: 1000 })
  assert.equal(comValor.pago, true)
  assert.match(comValor.frase, /1\.000/)
  assert.equal(comValor.tom, 'positivo')

  const semValor = M.minhaRecompensa({ alcancado: true, recompensa_paga: true, recompensa_valor_pago: null })
  assert.match(semValor.frase, /entregue/i)
  assert.ok(!/R\$/.test(semValor.frase), 'premio nao-monetario nao pode virar dinheiro na tela')
})

// ─── Guardas de regressão ────────────────────────────────────────────────────────────────

const FONTE = fs.readFileSync(path.join(__dirname, 'missao.js'), 'utf8')
const SEM_COMENTARIOS = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*$/gm, '')

test('o modulo NUNCA compara nem ordena pessoas — isso e ranking, outra etapa', () => {
  for (const proibido of ['sort(', 'ranking', 'posicao', 'medalha', 'produtividade', 'score']) {
    assert.ok(!SEM_COMENTARIOS.toLowerCase().includes(proibido),
      `"${proibido}" transformaria o progresso pessoal em placar`)
  }
})

test('a REGRA nao vive no front: nada de decidir situacao, alvo ou conquista', () => {
  // Situação, fração e `alcancado` chegam prontos do backend (services/missao.js).
  for (const proibido of ['Date.now', 'new Date(', 'alcancado =', 'fetch(', 'apiFetch']) {
    assert.ok(!SEM_COMENTARIOS.includes(proibido), `missao.js (front) nao pode conter '${proibido}'`)
  }
})

test('formatarDinheiro e REEXPORTADO da comissao, nao reescrito', () => {
  // Duas formatações de dinheiro divergiriam — e as duas aparecem na MESMA tela.
  assert.ok(FONTE.includes("require('./comissao')"))
  assert.ok(!/function formatarDinheiro/.test(FONTE))
  assert.equal(M.formatarDinheiro, require('./comissao').formatarDinheiro)
})

test('GUARDA: tela de Comissao publica missao sempre com equipe', () => {
  const tela = fs.readFileSync(path.join(__dirname, '..', 'app', 'dashboard', 'comissao', 'page.tsx'), 'utf8')
  assert.match(tela, /type EquipeMissao =/)
  assert.match(tela, /apiFetch<EquipeMissao\[\]>\(`\/api\/empresas\/\$\{empresaId\}\/equipes-comerciais`\)/)
  assert.match(tela, /equipe_id: equipeId/)
  assert.match(tela, /desabilitado=\{!equipeId\}/)
  assert.match(tela, /Missão da equipe/)
})
