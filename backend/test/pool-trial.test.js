'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const P = require('../src/services/pool-trial')

test('poolHabilitado: só no trial', () => {
  assert.equal(P.poolHabilitado({ status: 'trial' }), true)
  assert.equal(P.poolHabilitado({ status: 'ativo' }), false)
  assert.equal(P.poolHabilitado({ status: 'legado' }), false)
  assert.equal(P.poolHabilitado(null), false)
})

test('teto diário: podePuxar e restantes', () => {
  assert.equal(P.tetoDiario(), 10)
  assert.equal(P.podePuxar(0), true)
  assert.equal(P.podePuxar(9), true)
  assert.equal(P.podePuxar(10), false)
  assert.equal(P.podePuxar(11), false)
  assert.equal(P.restantesHoje(0), 10)
  assert.equal(P.restantesHoje(7), 3)
  assert.equal(P.restantesHoje(10), 0)
  assert.equal(P.restantesHoje(99), 0)
})

test('D21: sqlElegivel exige SEM DONO e NÃO menciona empresa_id (cross-tenant)', () => {
  const sql = P.sqlElegivel('p')
  assert.match(sql, /p\.responsavel_id IS NULL/, 'elegível precisa exigir lead sem dono')
  assert.ok(!/empresa_id/.test(sql), 'elegível NÃO pode filtrar por empresa — o pool é cross-tenant (D21)')
  assert.match(sql, /p\.telefone/, 'elegível exige telefone (trial trabalha manual)')
})

// Guarda D21: a leitura do pool (db/pool-trial.js) não pode ganhar um filtro por empresa — seria
// voltar a esconder o pool por tenant, que é o oposto do desenho.
test('D21: db/pool-trial não filtra por empresa na leitura', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'pool-trial.js'), 'utf8')
  const leitura = fonte.slice(fonte.indexOf('function listarPool'), fonte.indexOf('function puxadasHoje'))
  assert.ok(leitura.length > 0, 'não achei listarPool')
  assert.ok(!/empresa_id\s*=/.test(leitura), 'listarPool passou a filtrar por empresa — proibido (D21)')
})
