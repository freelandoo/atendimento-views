'use strict'

const assert = require('node:assert')
const test = require('node:test')

const estagiosSvc = require('../src/services/contexto-estagios')
const mensagensSvc = require('../src/services/mensagens-automaticas')
const { removerContextoSeOrfao } = require('../src/db/whatsapp-instances')

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

test('mensagem da agenda usa o contexto vinculado à instância', async () => {
  mensagensSvc.invalidarCacheAtivo('e1')
  const pool = {
    async query(sql) {
      if (sql.includes('empresa_whatsapp_instances ewi')) {
        return { rows: [{ gatilhos_agenda_json: { lembrete_15min: 'Mensagem da instância {empresa}' } }] }
      }
      throw new Error('não deveria consultar o fallback global')
    },
  }
  const texto = await mensagensSvc.resolverMensagem(pool, {
    empresaId: 'e1', evolutionInstance: 'fun', grupo: 'gatilhos_agenda', chave: 'lembrete_15min',
    values: { empresa: 'Empresa X' },
  })
  assert.equal(texto, 'Mensagem da instância Empresa X')
  mensagensSvc.invalidarCacheAtivo('e1')
})

test('contexto compartilhado só é removido quando fica órfão', async () => {
  let sqlExecutado = ''
  const pool = {
    async query(sql, params) {
      sqlExecutado = sql
      assert.deepEqual(params, ['ctx-1', 'e1'])
      return { rowCount: 0, rows: [] }
    },
  }
  const removeu = await removerContextoSeOrfao(pool, 'e1', 'ctx-1')
  assert.equal(removeu, false)
  assert.match(sqlExecutado, /NOT EXISTS/)
  assert.match(sqlExecutado, /empresa_whatsapp_instances/)
})
