'use strict'

const assert = require('node:assert')
const test = require('node:test')

const estagiosSvc = require('../src/services/contexto-estagios')

// Resolução do contexto de ESTÁGIOS por instância (1 número = 1 negócio):
// preferência pelo contexto amarrado à instância; fallback no runtime-ativo.

function ctxRow(id, estagios) {
  return { id, nome: `ctx-${id}`, conteudo: '', contexto_form_json: {}, estagios_json: estagios, thumbnail_url: null }
}

function mockPool({ instancia = null, ativo = null } = {}) {
  const calls = []
  return {
    calls,
    async query(sql) {
      calls.push(sql)
      if (sql.includes('empresa_whatsapp_instances ewi')) return { rows: instancia ? [instancia] : [] }
      if (sql.includes('runtime_ativo = true')) return { rows: ativo ? [ativo] : [] }
      return { rows: [] }
    },
  }
}

test('estágios por instância: usa o contexto amarrado à instância (não o runtime-ativo)', async () => {
  const pool = mockPool({
    instancia: ctxRow('CTX_INST', { nucleo: 'regras da instancia' }),
    ativo: ctxRow('CTX_ATIVO', { nucleo: 'regras do ativo' }),
  })
  const r = await estagiosSvc.getContextoAtivoComEstagios(pool, 'e1', 'fun')
  assert.equal(r.contexto_id, 'CTX_INST')
  // Achou pela instância — não precisou consultar o runtime-ativo.
  assert.ok(!pool.calls.some((s) => s.includes('runtime_ativo = true')))
})

test('estágios fallback: instância sem contexto com estágios cai no runtime-ativo', async () => {
  const pool = mockPool({
    instancia: ctxRow('CTX_INST', {}), // estágios vazios -> não vale
    ativo: ctxRow('CTX_ATIVO', { nucleo: 'regras do ativo' }),
  })
  const r = await estagiosSvc.getContextoAtivoComEstagios(pool, 'e1', 'fun')
  assert.equal(r.contexto_id, 'CTX_ATIVO')
})

test('estágios sem instância: usa o runtime-ativo (comportamento legado)', async () => {
  const pool = mockPool({ ativo: ctxRow('CTX_ATIVO', { nucleo: 'x' }) })
  const r = await estagiosSvc.getContextoAtivoComEstagios(pool, 'e1')
  assert.equal(r.contexto_id, 'CTX_ATIVO')
  assert.ok(!pool.calls.some((s) => s.includes('empresa_whatsapp_instances ewi')))
})

test('estágios nada configurado: retorna null', async () => {
  const pool = mockPool({})
  const r = await estagiosSvc.getContextoAtivoComEstagios(pool, 'e1', 'fun')
  assert.equal(r, null)
})
