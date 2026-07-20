'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  renderSaudacao, rodarLeads, gerarMensagensSemi, dispararGerados, estadoEnvioInstancia,
  aguardarStatusEnvioEvolution, afirmarEnvioNaoFalhouNaEvolution, enviarLoteEmBackground,
  reconciliarConfirmacoesPendentes,
  separarElegiveis, exigirInstanciaConectada, carregarInstancia, STATUS_RODAVEL,
} = require('../src/services/rodar-leads')

// Pool mockado por roteamento de SQL: casa a primeira needle contida no texto.
function makePool(handlers) {
  const query = async (sql, params) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(sql).trim())) return { rows: [], rowCount: 0 }
    for (const [needle, fn] of handlers) {
      if (sql.includes(needle)) return fn(params, sql)
    }
    if (
      sql.includes('prospectador.prospeccao_bloqueios') ||
      sql.includes('prospectador.contato_politicas') ||
      sql.includes('FROM vendas.conversas') ||
      (sql.includes('FROM prospectador.prospects') && sql.includes('regexp_replace'))
    ) return { rows: [] }
    throw new Error('SQL não mapeado: ' + String(sql).slice(0, 70))
  }
  return {
    query,
    connect: async () => ({ query, release: () => {} }),
  }
}
const instanciaAtiva = {
  id: 'i1', evolution_instance: 'inst', nome: 'N', ativo: true,
  config_json: { saudacao: 'Oi {nome}' }, contexto_id: null,
}
const configSemi = {
  empresa_id: 'e1', modo: 'semi_automatico', gerar_ia: false, instrucoes_ia: null,
  auto_ativo: false, janela_inicio: '08:00', janela_fim: '18:00',
  teto_diario: 40, intervalo_min: 15, intervalo_max: 30,
}
const prospectRodavel = {
  id: 'p1', nome: 'Padaria X', telefone: '5511999998888', status: 'contato_encontrado',
  origem: 'manual', cidade: 'SP', nicho: 'padaria', raw_json: null, bloqueado_ate: null,
  tem_whatsapp: null,
}
const conexaoOk = { verificarStatus: async () => ({ connected: true, state: 'open' }) }

test('renderSaudacao substitui variáveis e faz trim', () => {
  const out = renderSaudacao('Oi {nome}, vi a {empresa} em {cidade} ({nicho}).  ', {
    nome: 'Padaria X', cidade: 'SP', nicho: 'padaria',
  })
  assert.strictEqual(out, 'Oi Padaria X, vi a Padaria X em SP (padaria).')
})

test('renderSaudacao é case-insensitive e tolera campos vazios', () => {
  const out = renderSaudacao('Olá {NOME} de {Cidade}', { nome: 'Bar Y' })
  assert.strictEqual(out, 'Olá Bar Y de')
})

test('STATUS_RODAVEL cobre exatamente os status de "sem contato"', () => {
  assert.deepStrictEqual(
    [...STATUS_RODAVEL].sort(),
    ['aguardando', 'aprovado', 'coletado', 'contato_encontrado']
  )
})

test('carregarInstancia rejeita o canal Freelandoo nos fluxos de disparo', async () => {
  let sqlExecutado = ''
  const pool = {
    query: async (sql) => {
      sqlExecutado = sql
      return { rows: [] }
    },
  }
  await carregarInstancia(pool, 'e1', 'i1')
  assert.match(sqlExecutado, /canal.*freelandoo/)
})

test('rodarLeads rejeita seleção vazia (400)', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: [] }),
    (err) => err.statusCode === 400
  )
})

test('rodarLeads rejeita lote acima do máximo (400)', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  const ids = Array.from({ length: 16 }, (_, i) => `id-${i}`)
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ids }),
    (err) => err.statusCode === 400
  )
})

test('rodarLeads exige instância existente (404)', async () => {
  const pool = { query: async () => ({ rows: [] }) } // instância não encontrada
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'] }),
    (err) => err.statusCode === 404
  )
})

test('rodarLeads exige saudação configurada (409)', async () => {
  const pool = {
    query: async () => ({ rows: [{ id: 'i1', evolution_instance: 'free', ativo: true, config_json: {} }] }),
  }
  await assert.rejects(
    () => rodarLeads(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'] }),
    (err) => err.statusCode === 409
  )
})

// ─── Semi: gerarMensagensSemi ──────────────────────────────────────────────────
test('gerarMensagensSemi rejeita seleção vazia (400)', async () => {
  const pool = { query: async () => { throw new Error('não deveria consultar o banco') } }
  await assert.rejects(
    () => gerarMensagensSemi(pool, { empresaId: 'e1', instanciaId: 'i1', prospectIds: [] }),
    (err) => err.statusCode === 400
  )
})

test('gerarMensagensSemi exige instância existente (404)', async () => {
  const pool = { query: async () => ({ rows: [] }) }
  await assert.rejects(
    () => gerarMensagensSemi(pool, { empresaId: 'e1', instanciaId: 'i1', prospectIds: ['p1'] }),
    (err) => err.statusCode === 404
  )
})

test('gerarMensagensSemi gera com fallback (gerar_ia off) e grava aguardando_disparo', async () => {
  let finalSql = ''
  let mensagemInserida = ''
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
    ['ANY($2::uuid[])', () => ({ rows: [prospectRodavel] })],
    ["erro = 'geracao_expirada'", () => ({ rows: [] })],
    ["SET status = 'gerando'", () => ({ rows: [] })],
    ["NULL, 'gerando'", () => ({ rows: [{ id: 'd1' }] })],
    ["SET status = 'aguardando_disparo'", (params, sql) => {
      finalSql = sql
      mensagemInserida = String(params[1])
      return { rows: [] }
    }],
  ])
  const out = await gerarMensagensSemi(pool, { empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'] })
  assert.strictEqual(out.gerados.length, 1)
  assert.strictEqual(out.gerados[0].gerada_por_ia, false)
  assert.match(out.gerados[0].mensagem, /Padaria X/) // template renderizado
  assert.match(finalSql, /aguardando_disparo/)       // finaliza a reserva no estado pendente
  assert.match(mensagemInserida, /Padaria X/)
})

// ─── Semi: dispararGerados ─────────────────────────────────────────────────────
test('dispararGerados sem pendências devolve rodada=false', async () => {
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
    // estadoThrottle
    ['FROM prospectador.lead_disparos\n      WHERE empresa_id', () => ({ rows: [{ hoje: 0, ultimo: null }] })],
    // busca dos rascunhos aguardando_disparo (JOIN) — nenhum
    ["d.status = 'aguardando_disparo'", () => ({ rows: [] })],
  ])
  const out = await dispararGerados(pool, { empresaId: 'e1', instanciaId: 'i1', prospectIds: [] }, conexaoOk)
  assert.strictEqual(out.rodada, false)
  assert.deepStrictEqual(out.aceitos, [])
})

test('estadoEnvioInstancia devolve cooldown restante e cooldown_min', async () => {
  const agoraIso = new Date().toISOString()
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['FROM prospectador.lead_disparos\n      WHERE empresa_id', () => ({ rows: [{ hoje: 1, ultimo: agoraIso }] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
  ])
  const r = await estadoEnvioInstancia(pool, { empresaId: 'e1', instanciaId: 'i1' })
  assert.ok(r.cooldown_restante_s > 0, 'cooldown deve estar ativo (último disparo agora)')
  assert.equal(r.cooldown_min, 15)
  assert.equal(r.teto_restante, 39) // teto 40 - 1 hoje
})

test('estadoEnvioInstancia sem disparo hoje: cooldown zerado', async () => {
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['FROM prospectador.lead_disparos\n      WHERE empresa_id', () => ({ rows: [{ hoje: 0, ultimo: null }] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
  ])
  const r = await estadoEnvioInstancia(pool, { empresaId: 'e1', instanciaId: 'i1' })
  assert.equal(r.cooldown_restante_s, 0)
})

test('dispararGerados respeita cooldown (429)', async () => {
  const agoraIso = new Date().toISOString()
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
    ["d.status = 'aguardando_disparo'", () => ({ rows: [{
      disparo_id: 'd1', mensagem: 'Oi', prospect_id: 'p1', nome: 'Lead',
      telefone: '5511999998888', status: 'contato_encontrado', bloqueado_ate: null,
      tem_whatsapp: null,
    }] })],
    ['FOR UPDATE', () => ({ rows: [{ id: 'i1' }] })],
    ['FROM prospectador.lead_disparos\n      WHERE empresa_id', () => ({ rows: [{ hoje: 1, ultimo: agoraIso }] })],
  ])
  await assert.rejects(
    () => dispararGerados(pool, { empresaId: 'e1', instanciaId: 'i1', prospectIds: [] }, conexaoOk),
    (err) => err.statusCode === 429
  )
})

test('exigirInstanciaConectada bloqueia envio antes da reserva', async () => {
  await assert.rejects(
    () => exigirInstanciaConectada(instanciaAtiva, async () => ({ connected: false, state: 'close' })),
    (err) => err.statusCode === 409 && err.code === 'instance_disconnected'
  )
})

test('aguardarStatusEnvioEvolution lê ERROR do MessageUpdate pelo key id', async () => {
  const pool = makePool([
    ['FROM public."MessageUpdate"', (params) => {
      assert.equal(params[0], 'msg-1')
      return { rows: [{ status: 'ERROR' }] }
    }],
  ])
  const status = await aguardarStatusEnvioEvolution(pool, { key: { id: 'msg-1' } }, { timeoutMs: 0 })
  assert.deepEqual(status, { keyId: 'msg-1', status: 'ERROR' })
  await assert.rejects(
    () => afirmarEnvioNaoFalhouNaEvolution(pool, { key: { id: 'msg-1' } }, { timeoutMs: 0 }),
    (err) => err.evolutionClassificacao?.tipo === 'message_error'
  )
})

test('aguardarStatusEnvioEvolution sem update retorna PENDING sem lançar', async () => {
  const pool = makePool([
    ['FROM public."MessageUpdate"', () => ({ rows: [] })],
  ])
  const status = await aguardarStatusEnvioEvolution(pool, { key: { id: 'msg-2' } }, { timeoutMs: 0 })
  assert.deepEqual(status, { keyId: 'msg-2', status: 'PENDING' })
  const ok = await afirmarEnvioNaoFalhouNaEvolution(pool, { key: { id: 'msg-2' } }, { timeoutMs: 0 })
  assert.equal(ok.status, 'PENDING')
})

test('rodarLeads nao aceita uma segunda reserva ativa para o mesmo lead', async () => {
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
    ['ANY($2::uuid[])', () => ({ rows: [prospectRodavel] })],
    ['FROM prospectador.lead_disparos\n      WHERE empresa_id', () => ({ rows: [{ hoje: 0, ultimo: null }] })],
    ["status = 'aguardando_disparo'", () => ({ rows: [] })],
    ['INSERT INTO prospectador.lead_disparos', () => ({ rows: [] })],
  ])
  const out = await rodarLeads(pool, {
    empresaId: 'e1', usuarioId: 'u1', instanciaId: 'i1', prospectIds: ['p1'],
  }, conexaoOk)
  assert.equal(out.rodada, false)
  assert.equal(out.pulados[0].motivo, 'ja_em_processamento')
})

test('separarElegiveis reutiliza a guarda de opt-out do pipeline oficial', async () => {
  const pool = makePool([
    ['ANY($2::uuid[])', () => ({ rows: [prospectRodavel] })],
    ['prospectador.contato_politicas', () => ({ rows: [{ opt_out: true }] })],
  ])
  const out = await separarElegiveis(pool, 'e1', ['p1'])
  assert.equal(out.elegiveis.length, 0)
  assert.equal(out.pulados[0].motivo, 'opt_out')
})

test('dispararGerados descarta rascunho de lead sabidamente sem WhatsApp', async () => {
  const pool = makePool([
    ['app.empresa_whatsapp_instances', () => ({ rows: [instanciaAtiva] })],
    ['app.banco_leads_config', () => ({ rows: [configSemi] })],
    ["d.status = 'aguardando_disparo'", () => ({ rows: [{
      disparo_id: 'd1', mensagem: 'Oi', prospect_id: 'p1', nome: 'Lead',
      telefone: '5511999998888', status: 'contato_encontrado', bloqueado_ate: null,
      tem_whatsapp: false,
    }] })],
    ['UPDATE prospectador.prospects SET tem_whatsapp = false', () => ({ rows: [] })],
    ['UPDATE prospectador.lead_disparos', () => ({ rows: [] })],
  ])
  const out = await dispararGerados(pool, { empresaId: 'e1', instanciaId: 'i1', prospectIds: [] }, conexaoOk)
  assert.equal(out.rodada, false)
  assert.equal(out.pulados[0].motivo, 'sem_whatsapp')
})

test('aguardarStatusEnvioEvolution nao trata SERVER_ACK como sucesso terminal', async () => {
  let consultas = 0
  const pool = makePool([
    ['FROM public."MessageUpdate"', () => {
      consultas++
      return { rows: [{ status: consultas === 1 ? 'SERVER_ACK' : 'ERROR' }] }
    }],
  ])
  const status = await aguardarStatusEnvioEvolution(
    pool,
    { key: { id: 'msg-3' } },
    { timeoutMs: 500, intervalMs: 100 }
  )
  assert.equal(consultas, 2)
  assert.deepEqual(status, { keyId: 'msg-3', status: 'ERROR' })
})

test('reconciliarConfirmacoesPendentes so avanca o funil com confirmacao terminal', async () => {
  let prospectAtualizado = false
  let disparoEnviado = false
  const pool = makePool([
    ["status = 'enviando' AND criado_em", () => ({ rows: [] })],
    ['LEFT JOIN LATERAL', () => ({ rows: [{
      disparo_id: 'd1', prospect_id: 'p1', evolution_message_id: 'msg-4',
      evolution_status: 'DELIVERY_ACK',
    }] })],
    ['UPDATE prospectador.prospects', () => { prospectAtualizado = true; return { rows: [] } }],
    ["SET status = 'enviado'", () => { disparoEnviado = true; return { rows: [] } }],
  ])
  const out = await reconciliarConfirmacoesPendentes(pool)
  assert.equal(out.enviados, 1)
  assert.equal(prospectAtualizado, true)
  assert.equal(disparoEnviado, true)
})

test('enviarLoteEmBackground revalida compliance imediatamente antes da Evolution', async () => {
  let erroGravado = null
  const pool = makePool([
    ['prospectador.contato_politicas', () => ({ rows: [{ opt_out: true }] })],
    ['UPDATE prospectador.lead_disparos', (params) => {
      erroGravado = params[1]
      return { rows: [] }
    }],
  ])
  const out = await enviarLoteEmBackground(pool, {
    empresaId: 'e1',
    evolutionInstance: 'inst',
    itens: [{ prospect: prospectRodavel, disparoId: 'd1', mensagem: 'Oi' }],
    gerar: { ativo: false },
  })
  assert.equal(out[0].status, 'falhou')
  assert.equal(erroGravado, 'compliance:opt_out')
})
