'use strict'

// Credencial da Meta por empresa: isolamento, sigilo do token e a regra de ativação.
// Pool falso — nenhum Postgres é necessário; o que se testa aqui é o SQL que sai e o
// que (não) volta.

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

process.env.META_ENC_KEY = crypto.randomBytes(32).toString('base64')

const integracoes = require('../src/db/meta-integracoes')
const { encrypt, decrypt } = require('../src/services/meta-crypto')

const EMPRESA_A = '00000000-0000-0000-0000-0000000000aa'
const EMPRESA_B = '00000000-0000-0000-0000-0000000000bb'
const TOKEN = 'EAAG_token_super_secreto_da_empresa_A_4821'

function poolFake(responder) {
  const chamadas = []
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      return (responder && (await responder(sql, params))) || { rows: [], rowCount: 0 }
    },
  }
}

function linhaIntegracao(over = {}) {
  return {
    id: 'int-1',
    empresa_id: EMPRESA_A,
    dataset_id: '1572278814315441',
    page_id: null,
    waba_id: 'WABA-A',
    access_token_enc: encrypt(TOKEN),
    token_hint: '4821',
    test_event_code: null,
    status: 'em_teste',
    evento_agendada: true,
    evento_realizada: false,
    evento_venda: false,
    ultimo_teste_em: null,
    ultimo_teste_ok: null,
    ultimo_erro: null,
    criado_em: '2026-08-07T10:00:00Z',
    atualizado_em: '2026-08-07T10:00:00Z',
    ...over,
  }
}

// ─── Sigilo do token ──────────────────────────────────────────────────────────

test('paraApi NUNCA devolve o token — nem em texto puro, nem cifrado', () => {
  const api = integracoes.paraApi(linhaIntegracao())
  const serializado = JSON.stringify(api)
  assert.equal(serializado.includes('access_token'), false)
  assert.equal(serializado.includes('mt1:'), false)
  assert.equal(api.access_token_enc, undefined)
  assert.equal(api.token, undefined)
  // Só a dica de 4 caracteres, para o dono reconhecer qual token está lá.
  assert.equal(api.token_hint, '4821')
})

test('salvarIntegracao cifra o token: o texto puro não chega ao banco', async () => {
  let capturado = null
  const pool = poolFake((sql, params) => {
    capturado = params
    return { rows: [linhaIntegracao()] }
  })
  const data = await integracoes.salvarIntegracao(pool, EMPRESA_A, {
    dataset_id: '1572278814315441',
    waba_id: 'WABA-A',
    access_token: TOKEN,
    eventos: { reuniao_agendada: true },
  })
  const enviadoAoBanco = capturado.map((p) => String(p)).join('|')
  assert.equal(enviadoAoBanco.includes(TOKEN), false, 'token em texto puro não pode ir ao banco')
  const cifrado = capturado.find((p) => typeof p === 'string' && p.startsWith('mt1:'))
  assert.ok(cifrado, 'deve gravar o token cifrado com o cofre da Meta')
  assert.equal(decrypt(cifrado), TOKEN, 'round-trip da cifra')
  // A dica é só o sufixo — não reconstrói o segredo.
  assert.equal(capturado.includes('4821'), true)
  assert.equal(JSON.stringify(data).includes(TOKEN), false)
})

// ─── Isolamento por empresa ───────────────────────────────────────────────────

test('toda leitura/escrita filtra por empresa_id, e a empresa vai como 1º parâmetro', async () => {
  const pool = poolFake(() => ({ rows: [linhaIntegracao()], rowCount: 1 }))
  await integracoes.obterParaApi(pool, EMPRESA_A)
  await integracoes.obterCredencial(pool, EMPRESA_A)
  await integracoes.atualizarEventos(pool, EMPRESA_A, { reuniao_venda: true })
  await integracoes.marcarAtencao(pool, EMPRESA_A, 'erro')
  await integracoes.removerIntegracao(pool, EMPRESA_A)
  for (const c of pool.chamadas) {
    assert.match(c.sql, /empresa_id = \$1/, `consulta sem filtro de empresa: ${c.sql.slice(0, 60)}`)
    assert.equal(c.params[0], EMPRESA_A)
  }
})

test('nenhuma função de credencial funciona sem empresa (bloqueia o vazamento na raiz)', async () => {
  const pool = poolFake(() => ({ rows: [linhaIntegracao()] }))
  await assert.rejects(() => integracoes.obterCredencial(pool, null), /Empresa não informada/)
  await assert.rejects(() => integracoes.obterParaApi(pool, undefined), /Empresa não informada/)
  await assert.rejects(() => integracoes.atualizarEventos(pool, '', {}), /Empresa não informada/)
  await assert.rejects(
    () => integracoes.salvarIntegracao(pool, null, { dataset_id: '123456', waba_id: 'w', access_token: 't' }),
    /Empresa não informada/
  )
  assert.equal(pool.chamadas.length, 0, 'não pode nem chegar a consultar')
})

test('a credencial devolvida é a da empresa pedida — não existe "a integração ativa"', async () => {
  const pool = poolFake((sql, params) => ({
    rows: [linhaIntegracao({ empresa_id: params[0], waba_id: params[0] === EMPRESA_A ? 'WABA-A' : 'WABA-B' })],
  }))
  const a = await integracoes.obterCredencial(pool, EMPRESA_A)
  const b = await integracoes.obterCredencial(pool, EMPRESA_B)
  assert.equal(a.wabaId, 'WABA-A')
  assert.equal(b.wabaId, 'WABA-B')
  assert.equal(a.empresaId, EMPRESA_A)
  assert.equal(b.empresaId, EMPRESA_B)
})

// ─── Validação da configuração ────────────────────────────────────────────────

test('configuração exige Página OU conta WhatsApp Business (senão a Meta rejeita: 2804116)', async () => {
  const pool = poolFake(() => ({ rows: [linhaIntegracao()] }))
  await assert.rejects(
    () => integracoes.salvarIntegracao(pool, EMPRESA_A, {
      dataset_id: '1572278814315441', access_token: TOKEN, eventos: {},
    }),
    /Página do Facebook ou o ID da conta WhatsApp Business/
  )
  assert.equal(pool.chamadas.length, 0)
})

test('configuração recusa dataset não numérico e token vazio', () => {
  const semDataset = integracoes.validarConfiguracao({ dataset_id: 'meu-pixel', access_token: 't' })
  assert.equal(semDataset.ok, false)
  assert.match(semDataset.issues.join(' '), /apenas números/)
  const semToken = integracoes.validarConfiguracao({ dataset_id: '1572278814315441', access_token: '  ' })
  assert.equal(semToken.ok, false)
  assert.match(semToken.issues.join(' '), /token de acesso/)
})

test('salvar volta a integração para "em teste" e apaga o resultado do teste anterior', async () => {
  let sqlSalvar = ''
  const pool = poolFake((sql) => { sqlSalvar = sql; return { rows: [linhaIntegracao()] } })
  await integracoes.salvarIntegracao(pool, EMPRESA_A, {
    dataset_id: '1572278814315441', waba_id: 'WABA-A', access_token: TOKEN, eventos: {},
  })
  // Trocar dataset/token invalida a prova anterior: ativar exige testar de novo.
  assert.match(sqlSalvar, /status\s*=\s*'em_teste'/)
  assert.match(sqlSalvar, /ultimo_teste_ok\s*=\s*NULL/)
})

// ─── Regra de ativação ────────────────────────────────────────────────────────

test('ativar SEM teste bem-sucedido é recusado (409), e nada é atualizado', async () => {
  const pool = poolFake((sql) => {
    if (/SELECT ultimo_teste_ok/.test(sql)) return { rows: [{ ultimo_teste_ok: null }] }
    return { rows: [linhaIntegracao({ status: 'ativa' })] }
  })
  await assert.rejects(
    () => integracoes.definirStatus(pool, EMPRESA_A, 'ativa'),
    (e) => e.statusCode === 409 && /Teste a conexão/.test(e.message)
  )
  assert.equal(pool.chamadas.filter((c) => /UPDATE/.test(c.sql)).length, 0)
})

test('ativar COM teste bem-sucedido passa; desativar não exige teste', async () => {
  const pool = poolFake((sql) => {
    if (/SELECT ultimo_teste_ok/.test(sql)) return { rows: [{ ultimo_teste_ok: true }] }
    return { rows: [linhaIntegracao({ status: 'ativa' })] }
  })
  const ativa = await integracoes.definirStatus(pool, EMPRESA_A, 'ativa')
  assert.equal(ativa.status, 'ativa')
  const pool2 = poolFake(() => ({ rows: [linhaIntegracao({ status: 'desativada' })] }))
  const off = await integracoes.definirStatus(pool2, EMPRESA_A, 'desativada')
  assert.equal(off.status, 'desativada')
  assert.equal(pool2.chamadas.some((c) => /SELECT ultimo_teste_ok/.test(c.sql)), false)
})

test('status fora do enum é recusado antes de tocar o banco', async () => {
  const pool = poolFake(() => ({ rows: [linhaIntegracao()] }))
  await assert.rejects(() => integracoes.definirStatus(pool, EMPRESA_A, 'ligada'), /Status inválido/)
  assert.equal(pool.chamadas.length, 0)
})

test('listarAtivas devolve só empresas ATIVAS e não carrega segredo algum', async () => {
  const pool = poolFake(() => ({
    rows: [{ empresa_id: EMPRESA_A, evento_agendada: true, evento_realizada: false, evento_venda: true }],
  }))
  const lista = await integracoes.listarAtivas(pool)
  assert.match(pool.chamadas[0].sql, /status\s*=\s*'ativa'/)
  assert.equal(pool.chamadas[0].sql.includes('access_token_enc'), false)
  assert.deepEqual(lista, [{
    empresaId: EMPRESA_A, evento_agendada: true, evento_realizada: false, evento_venda: true,
  }])
})

test('teste falho derruba integração ATIVA para "precisa de atenção"', async () => {
  let sql = ''
  const pool = poolFake((s) => { sql = s; return { rows: [linhaIntegracao({ status: 'precisa_atencao' })] } })
  await integracoes.registrarTeste(pool, EMPRESA_A, { ok: false, mensagemErro: 'Token inválido ou expirado.' })
  assert.match(sql, /'precisa_atencao'/)
  assert.match(sql, /empresa_id = \$1/)
})
