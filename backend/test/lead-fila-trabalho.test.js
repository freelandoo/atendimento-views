'use strict'
// Ordem de TRABALHO do Banco de Leads — regra pura + guardas de regressão.
//
// As guardas são o coração desta entrega: a ordem antiga (`updated_at DESC` no servidor +
// `pontos ASC` na tela) é fácil de voltar sem ninguém notar, porque a listagem continua
// funcionando — ela só passa a mostrar a coisa errada primeiro.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const F = require('../src/services/lead-fila-trabalho')

const SRC = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8')

test('a fila comeca por quem esta esperando e termina no historico', () => {
  assert.deepEqual(F.FAIXAS, [
    'cliente_esperando',
    'pronto_enviar',
    'nunca_abordado',
    'abordado_sem_resposta',
    'falta_contato',
    'em_espera',
    'fora_da_fila',
  ])
})

test('"nao trabalhado" vem ANTES de "falta contato" — era o inverso disso o defeito relatado', () => {
  // Sem telefone vale -10 pontos no cadastro; com a ordem antiga (menor pontuacao primeiro) o
  // lead que nao da' para contatar era a PRIMEIRA linha do vendedor.
  assert.ok(F.FAIXAS.indexOf('nunca_abordado') < F.FAIXAS.indexOf('falta_contato'))
})

test('faixaPorOrdem traduz o numero do SQL e recusa o que nao existe', () => {
  assert.equal(F.faixaPorOrdem(1), 'cliente_esperando')
  assert.equal(F.faixaPorOrdem(3), 'nunca_abordado')
  assert.equal(F.faixaPorOrdem(7), 'fora_da_fila')
  assert.equal(F.faixaPorOrdem(0), null)
  assert.equal(F.faixaPorOrdem(99), null)
  assert.equal(F.faixaPorOrdem(null), null)
})

test('o CASE classifica uma vez e cobre TODAS as faixas, com ELSE obrigatorio', () => {
  const sql = F.sqlFaixaTrabalho()
  for (let i = 1; i <= 7; i += 1) {
    assert.ok(sql.includes(`THEN ${i}`) || sql.includes(`ELSE ${i}`), `faixa ${i} fora do CASE`)
  }
  assert.ok(/ELSE \d+\s*\n\s*END/.test(sql), 'CASE sem ELSE deixaria lead sem faixa (NULL ordena por ultimo)')
})

test('o que tem consequencia mais forte e testado ANTES, mesmo estando no fim da fila', () => {
  const sql = F.sqlFaixaTrabalho()
  // `fechado` tambem satisfaz "ja foi abordado"; reuniao marcada tambem satisfaz "respondeu".
  assert.ok(sql.indexOf('THEN 7') < sql.indexOf('THEN 6'), 'fora_da_fila antes de em_espera')
  assert.ok(sql.indexOf('THEN 6') < sql.indexOf('THEN 1'), 'em_espera antes de cliente_esperando')
  // Se `cliente_esperando` viesse antes, todo lead que ja respondeu na vida ficaria no topo para
  // sempre — `status = 'respondeu'` e' grudento, nada o zera.
})

test('os aliases do CASE sao os da consulta da listagem', () => {
  const sql = F.sqlFaixaTrabalho()
  assert.ok(sql.includes('prospects.status'))
  assert.ok(sql.includes('ultimo.rodado_em'))
  assert.ok(sql.includes('rascunho.mensagem_gerada'))
  assert.ok(sql.includes('agenda.proximo_agendamento'))
})

test('o desempate NAO usa updated_at — foi ele que trouxe o lead recem-trabalhado de volta ao topo', () => {
  const sql = F.sqlDesempateTrabalho()
  assert.ok(!sql.includes('updated_at'), 'qualquer escrita, ate automatica, mexe em updated_at')
  assert.ok(sql.includes('created_at'))
  assert.ok(sql.trim().endsWith('ASC'), 'quem espera ha mais tempo vem primeiro')
})

// ─── Guardas de regressao ───────────────────────────────────────────────────────────────────

test('a listagem do Banco de Leads NAO volta a ordenar por updated_at', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  const listagem = fonte.slice(fonte.indexOf("router.get('/leads'"), fonte.indexOf("router.post('/leads/:id/assumir'"))
  assert.ok(!/ORDER BY[^`]*updated_at/i.test(listagem), 'ordem por atividade recente e o oposto de "nao tratado"')
  assert.ok(listagem.includes('sqlFaixaTrabalho()'), 'a listagem tem de classificar pela fila de trabalho')
  assert.ok(listagem.includes('sqlDesempateTrabalho()'))
})

test('a faixa e classificada UMA vez, no SQL — nao ha segunda regua em JS', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  assert.ok(fonte.includes('faixaPorOrdem('), 'o numero do SQL vira nome por faixaPorOrdem')
  // Comparar a faixa com literal fora do modulo puro e' o comeco de uma segunda regua.
  for (const chave of F.FAIXAS) {
    assert.ok(!fonte.includes(`'${chave}'`), `literal de faixa fora do modulo puro: ${chave}`)
  }
})

test('a listagem devolve o total REAL da carteira, nao so o tamanho da janela', () => {
  const fonte = SRC('routes/api-banco-leads.js')
  assert.ok(fonte.includes('total_carteira'), 'sem o total, o teto vira um recorte invisivel')
  assert.ok(/COUNT\(\*\)::int AS total/.test(fonte))
})
