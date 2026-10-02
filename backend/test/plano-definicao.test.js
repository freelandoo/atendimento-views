'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const P = require('../src/services/plano-definicao')

test('PLANOS e STATUS sao as listas fechadas esperadas', () => {
  assert.deepEqual(P.PLANOS, ['minimo', 'basico', 'pro', 'legado'])
  assert.deepEqual(P.STATUS, ['trial', 'ativo', 'atrasado', 'cancelado', 'expirado'])
})

test('validadores negam o desconhecido', () => {
  assert.equal(P.planoValido('basico'), true)
  assert.equal(P.planoValido('enterprise'), false)
  assert.equal(P.statusValido('trial'), true)
  assert.equal(P.statusValido('pausado'), false)
  assert.equal(P.planoValido(null), false)
})

test('mapa de recursos: minimo sem automacao, basico com IA, pro com cruzamento, legado total', () => {
  assert.equal(P.planoPermite('minimo', 'ia_auto'), false)
  assert.equal(P.planoPermite('minimo', 'followup_auto'), false)
  assert.equal(P.planoPermite('minimo', 'captacao'), true)
  assert.equal(P.planoPermite('basico', 'ia_auto'), true)
  assert.equal(P.planoPermite('basico', 'cruzamento'), false) // cruzamento e' add-on no basico
  assert.equal(P.planoPermite('pro', 'cruzamento'), true)
  assert.equal(P.planoPermite('legado', 'cruzamento'), true)
})

test('planoPermite NEGA plano ou recurso desconhecido (nunca abre porta)', () => {
  assert.equal(P.planoPermite('inexistente', 'ia_auto'), false)
  assert.equal(P.planoPermite('basico', 'recurso_que_nao_existe'), false)
})

test('avaliarAcesso: ativo e trial valido liberam', () => {
  assert.equal(P.avaliarAcesso({ status: 'ativo' }).liberado, true)
  const t = P.avaliarAcesso({ status: 'trial', trialFim: new Date(Date.now() + 86400000) })
  assert.equal(t.liberado, true)
  assert.equal(t.somenteLeitura, false)
})

test('avaliarAcesso: atrasado libera em SOMENTE LEITURA (nao barra)', () => {
  const v = P.avaliarAcesso({ status: 'atrasado' })
  assert.equal(v.liberado, true)
  assert.equal(v.somenteLeitura, true)
  assert.equal(P.barra(v.motivo), false)
})

test('avaliarAcesso: cancelado e expirado bloqueiam', () => {
  assert.equal(P.avaliarAcesso({ status: 'cancelado' }).liberado, false)
  assert.equal(P.avaliarAcesso({ status: 'expirado' }).liberado, false)
  assert.equal(P.barra(P.MOTIVOS.CANCELADO), true)
  assert.equal(P.barra(P.MOTIVOS.EXPIRADO), true)
})

test('avaliarAcesso: trial com prazo VENCIDO = trial_expirado, mesmo sem job ter trocado o status', () => {
  const v = P.avaliarAcesso({ status: 'trial', trialFim: new Date(Date.now() - 1000) })
  assert.equal(v.liberado, false)
  assert.equal(v.motivo, P.MOTIVOS.TRIAL_EXPIRADO)
  assert.equal(P.barra(v.motivo), true)
})

test('avaliarAcesso: status desconhecido NEGA (fail-safe)', () => {
  const v = P.avaliarAcesso({ status: 'zorp' })
  assert.equal(v.liberado, false)
  assert.equal(P.barra(v.motivo), true)
})

test('precos e assinaveis: minimo/basico assinaveis; pro/legado nao', () => {
  assert.equal(P.precoDoPlano('minimo'), 79.0)
  assert.equal(P.precoDoPlano('basico'), 149.9)
  assert.equal(P.precoDoPlano('pro'), 600.0)
  assert.equal(P.precoDoPlano('legado'), null)
  assert.equal(P.precoDoPlano('inexistente'), null)
  assert.equal(P.planoAssinavel('minimo'), true)
  assert.equal(P.planoAssinavel('basico'), true)
  assert.equal(P.planoAssinavel('pro'), false) // em construcao
  assert.equal(P.planoAssinavel('legado'), false) // interno
})

test('nivelDoPlano: trial<minimo<basico<pro; null e desconhecido = pro (fail-open)', () => {
  assert.equal(P.nivelDoPlano({ status: 'trial', nome: 'minimo' }), P.NIVEL.trial)
  assert.equal(P.nivelDoPlano({ status: 'ativo', nome: 'minimo' }), P.NIVEL.minimo)
  assert.equal(P.nivelDoPlano({ status: 'ativo', nome: 'basico' }), P.NIVEL.basico)
  assert.equal(P.nivelDoPlano({ status: 'ativo', nome: 'pro' }), P.NIVEL.pro)
  assert.equal(P.nivelDoPlano({ status: 'ativo', nome: 'legado' }), P.NIVEL.pro)
  assert.equal(P.nivelDoPlano(null), P.NIVEL.pro) // grandfather
  assert.equal(P.nivelDoPlano({ status: 'ativo', nome: 'zorp' }), P.NIVEL.pro) // fail-open
})

test('moduloBloqueadoPorPlano: Pro trava abaixo de Pro; segmento fora do mapa nunca trava', () => {
  const basico = { status: 'ativo', nome: 'basico' }
  const trial = { status: 'trial', nome: 'minimo' }
  assert.equal(P.moduloBloqueadoPorPlano(basico, 'equipe'), true) // Pro
  assert.equal(P.moduloBloqueadoPorPlano(basico, 'ligacoes'), true)
  assert.equal(P.moduloBloqueadoPorPlano({ status: 'ativo', nome: 'pro' }, 'equipe'), false)
  assert.equal(P.moduloBloqueadoPorPlano(trial, 'whatsapp'), true) // minimo-level
  assert.equal(P.moduloBloqueadoPorPlano(trial, 'captacao'), true) // coleta paga: trial usa o pool
  assert.equal(P.moduloBloqueadoPorPlano({ status: 'ativo', nome: 'minimo' }, 'whatsapp'), false)
  assert.equal(P.moduloBloqueadoPorPlano({ status: 'ativo', nome: 'minimo' }, 'captacao'), false)
  assert.equal(P.moduloBloqueadoPorPlano(basico, 'banco-leads'), false) // fora do mapa
  assert.equal(P.moduloBloqueadoPorPlano(null, 'equipe'), false) // grandfather fail-open
})

// Anti-drift: as listas do modulo precisam casar com os CHECKs da migration 114. Se alguem
// alargar um lado sem o outro, este teste quebra (mesma disciplina de domain-enums.test.js).
test('anti-drift: PLANOS/STATUS batem com os CHECK da migration 114', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'migrations', '114_empresa_plano.sql'),
    'utf8'
  )
  for (const p of P.PLANOS) assert.ok(sql.includes(`'${p}'`), `migration deve citar plano '${p}'`)
  for (const s of P.STATUS) assert.ok(sql.includes(`'${s}'`), `migration deve citar status '${s}'`)
})
