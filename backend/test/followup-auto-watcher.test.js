'use strict'

/**
 * Cobertura da correcao do bug do followup automatico (commit 55b2c83).
 *
 * O bug original: a query consolidada em CTE unica fazia SELECT a partir
 * do `updated` (que continha so quem JA havia batido o max), e depois
 * filtrava por `total_auto < max` — conjunto vazio matematico.
 *
 * Os testes simulam o pool postgres e verificam:
 *   1. conversa com 0 followups + silencio > janela → cria 1 followup_auto;
 *   2. conversa com max_sequencia atingido → marcada como aguardando_handoff,
 *      sem novo followup;
 *   3. conversa com job_queue pending → nao duplica;
 *   4. SELECT de elegiveis retorna mesmo quando o UPDATE de encerrados
 *      afeta zero linhas.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createFollowupAuto } = require('../src/followup-auto')

function silentLogger() {
  return {
    info() {}, warn() {}, error() {}, debug() {},
  }
}

/**
 * Mock minimalista do pool que captura as queries em ordem e retorna
 * respostas pre-definidas por intencao (lock, update encerramento, select
 * elegiveis, insert agendamento, etc.).
 */
function criarPoolMock({ leaderAcquired = true, encerramentoRows = 0, elegiveis = [], existingAgendamento = null } = {}) {
  const captura = { queries: [] }

  return {
    captura,
    pool: {
      async query(sql, params) {
        const norm = String(sql).replace(/\s+/g, ' ').trim()
        captura.queries.push({ sql: norm, params })

        // Lock de lider (INSERT ON CONFLICT em watcher_locks)
        if (/INSERT INTO vendas\.watcher_locks/i.test(norm)) {
          return leaderAcquired
            ? { rows: [{ replica_id: process.env.REPLICA_ID || 'replica-1' }] }
            : { rows: [] }
        }

        // Etapa 1: UPDATE de encerramento (rever bug — agora separado)
        if (/^UPDATE vendas\.conversas c SET status = 'aguardando_handoff'/i.test(norm)) {
          return { rows: [], rowCount: encerramentoRows }
        }

        // Etapa 2: SELECT de elegiveis (deve buscar direto de vendas.conversas)
        if (/^SELECT c\.numero, c\.historico, c\.estagio, c\.status, c\.atualizado_em, p\.negocio/i.test(norm)) {
          return { rows: elegiveis }
        }

        // resumoEventosComerciaisFollowup
        if (/FROM vendas\.eventos_comerciais/i.test(norm)) {
          return { rows: [] }
        }
        // agendarFollowupAutoParaConversa → cancelarFollowupsAutoPendentes (DELETE/UPDATE)
        if (/UPDATE vendas\.followup_auto_agendamentos/i.test(norm)) {
          return { rows: [], rowCount: 0 }
        }
        if (/SELECT COUNT\(\*\)::int AS n FROM vendas\.followup_auto_agendamentos/i.test(norm)) {
          return { rows: [{ n: 0 }] }
        }
        if (/INSERT INTO vendas\.followup_auto_agendamentos/i.test(norm)) {
          return { rows: [{ id: 9999, agendado_para: new Date().toISOString() }] }
        }
        if (/INSERT INTO vendas\.job_queue/i.test(norm)) {
          return { rows: [{ id: 8888 }] }
        }
        if (/SELECT.*FROM vendas\.followup_auto_agendamentos.*WHERE id = \$1/i.test(norm)) {
          return existingAgendamento ? { rows: [existingAgendamento] } : { rows: [] }
        }

        // catch-all: nao deveria cair aqui
        return { rows: [] }
      },
    },
  }
}

function depsBase(pool) {
  return {
    pool,
    logger: silentLogger(),
    axios: { post: async () => ({ data: {} }) },
    aiProvider: {
      generateAIResponse: async () => ({ text: '{}', provider: 'openai', model: 'gpt-4o', httpStatus: 200, stopReason: 'stop', usage: {}, fallback_used: false }),
    },
    prompts: { FOLLOWUP_BASE: 'x', FOLLOWUP_TIMING_PROMPT_BASE: 'decida o timing.' },
    partesDataEmTimezone: () => ({ ano: 2026, mes: 5, dia: 23, hour: 12, minute: 0, segundo: 0, hora: 12, minuto: 0 }),
    utcParaDataLocalEmTimezone: (d) => new Date(d),
    adicionarDiasLocalEmTimezone: (d) => new Date(d),
    buscarAprendizadosAtivos: async () => [],
    montarBlocoCorrecoesAprendizados: () => '',
    perfilResumidoParaFollowup: () => '',
    gerarRequestIdAnthropic: () => 'req',
    registrarChamadaAnthropic: async () => {},
    statusHttpDeErroAnthropic: () => 500,
    codigoErroAnthropic: () => 'erro',
    mensagemErroAnthropic: () => '',
    parsearRespostaJsonClaude: () => null,
    normalizarHistoricoMensagens: (h) => Array.isArray(h) ? h : [],
    executarFollowupUmNumero: async () => ({}),
  }
}

function localizarQueries(captura) {
  const join = captura.queries.map((q) => q.sql).join(' ||| ')
  return {
    rodouLock: /INSERT INTO vendas\.watcher_locks/i.test(join),
    rodouUpdateEncerramento: /^UPDATE vendas\.conversas c SET status = 'aguardando_handoff'/im.test(
      captura.queries.map((q) => q.sql).join('\n')
    ),
    rodouSelectElegiveis: captura.queries.some((q) =>
      /^SELECT c\.numero, c\.historico, c\.estagio, c\.status, c\.atualizado_em, p\.negocio/i.test(q.sql)
    ),
    selectVemDeConversas: captura.queries.some((q) =>
      /SELECT c\.numero.*FROM vendas\.conversas c LEFT JOIN vendas\.lead_profiles/i.test(q.sql)
    ),
    rodouInsertAgendamento: captura.queries.some((q) =>
      /INSERT INTO vendas\.followup_auto_agendamentos/i.test(q.sql)
    ),
    queries: captura.queries.map((q) => q.sql),
  }
}

// ─── Cenario 1: conversa elegivel cria followup ────────────────────────────

test('1. conversa elegivel com 0 followups + silencio >60min cria 1 followup_auto', async () => {
  const elegivel = {
    numero: '5511999999999@s.whatsapp.net',
    historico: [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Oi! Qual seu negocio?' },
    ],
    estagio: 'diagnostico',
    status: 'ativo',
    atualizado_em: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    negocio: 'barbearia',
    cidade: 'Sao Paulo',
    temperatura_lead: 'morno',
    silencio_min: 90,
    total_auto: 0,
    sequencia: 1,
    ultima_mensagem_ia: 'Oi! Qual seu negocio?',
  }
  const { pool, captura } = criarPoolMock({ encerramentoRows: 0, elegiveis: [elegivel] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const loc = localizarQueries(captura)
  assert.equal(loc.rodouLock, true, 'leader election deve rodar')
  assert.equal(loc.rodouUpdateEncerramento, true, 'UPDATE de encerramento deve rodar como query separada')
  assert.equal(loc.rodouSelectElegiveis, true, 'SELECT de elegiveis deve rodar')
  assert.equal(loc.selectVemDeConversas, true,
    'SELECT precisa buscar direto de vendas.conversas (nao de "updated")')
  assert.equal(loc.rodouInsertAgendamento, true,
    'conversa elegivel deve gerar INSERT em followup_auto_agendamentos')
})

// ─── Cenario 2: conversa que atingiu max nao gera novo followup ────────────

test('2. conversa com max_sequencia atingido nao cria followup novo (mas roda UPDATE)', async () => {
  // Simula UPDATE afetando 1 linha (a conversa "fechada"), SELECT retornando 0
  const { pool, captura } = criarPoolMock({ encerramentoRows: 1, elegiveis: [] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const loc = localizarQueries(captura)
  assert.equal(loc.rodouUpdateEncerramento, true, 'UPDATE de encerramento marca como aguardando_handoff')
  assert.equal(loc.rodouSelectElegiveis, true, 'SELECT de elegiveis tambem precisa rodar (independente do UPDATE)')
  assert.equal(loc.rodouInsertAgendamento, false,
    'nenhum INSERT em followup_auto_agendamentos quando nao ha elegiveis')
})

// ─── Cenario 3: SELECT filtra job_queue pending (nao duplica) ──────────────

test('3. SELECT contem filtro NOT EXISTS em job_queue para evitar duplicacao', async () => {
  const { pool, captura } = criarPoolMock({ encerramentoRows: 0, elegiveis: [] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const sqlSelect = captura.queries.find((q) =>
    /^SELECT c\.numero/i.test(q.sql)
  )
  assert.ok(sqlSelect, 'SELECT de elegiveis deve estar entre as queries')
  assert.match(sqlSelect.sql, /NOT EXISTS \( SELECT 1 FROM vendas\.job_queue q WHERE q\.tipo = 'followup_auto' AND q\.status IN \('pending', 'processing'\)/i,
    'SELECT deve excluir conversas com job followup_auto pending/processing')
  assert.match(sqlSelect.sql, /NOT EXISTS \( SELECT 1 FROM vendas\.followup_auto_agendamentos fa WHERE fa\.numero = c\.numero AND fa\.status = 'agendado'/i,
    'SELECT deve excluir conversas com followup_auto_agendamentos status=agendado')
})

// ─── Cenario 4: SELECT roda mesmo com UPDATE afetando 0 linhas ─────────────

test('4. SELECT de elegiveis retorna mesmo quando UPDATE de encerrados afeta zero linhas', async () => {
  const elegivel = {
    numero: '5511888888888@s.whatsapp.net',
    historico: [{ role: 'assistant', content: 'Sou o bot da PJ Codeworks. Qual seu negocio?' }],
    estagio: 'diagnostico',
    status: 'ativo',
    atualizado_em: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    negocio: null,
    cidade: null,
    temperatura_lead: null,
    silencio_min: 120,
    total_auto: 0,
    sequencia: 1,
    ultima_mensagem_ia: 'Sou o bot da PJ Codeworks. Qual seu negocio?',
  }
  const { pool, captura } = criarPoolMock({
    encerramentoRows: 0, // UPDATE nao fecha ninguem
    elegiveis: [elegivel],
  })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const loc = localizarQueries(captura)
  assert.equal(loc.rodouUpdateEncerramento, true,
    'UPDATE de encerramento ainda roda mesmo sem afetar linhas')
  assert.equal(loc.rodouSelectElegiveis, true,
    'SELECT de elegiveis nao pode depender do resultado do UPDATE')
  assert.equal(loc.rodouInsertAgendamento, true,
    'elegivel deve ser agendado normalmente')
})

// ─── Cenario 5: replica nao-lider nao roda queries (sanity check do lock) ──

test('5. replica que NAO adquire lock pula o tick inteiro (watcher_locks intacto)', async () => {
  const { pool, captura } = criarPoolMock({ leaderAcquired: false, elegiveis: [] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const loc = localizarQueries(captura)
  assert.equal(loc.rodouLock, true, 'tentativa de lock deve ocorrer')
  assert.equal(loc.rodouUpdateEncerramento, false,
    'sem ser lider, nao roda UPDATE de encerramento')
  assert.equal(loc.rodouSelectElegiveis, false,
    'sem ser lider, nao roda SELECT de elegiveis')
})

// ─── Cenario 7: cancelamento terminal grava marcador (anti-spam) ───────────

test('7. 3+ mensagens consecutivas do bot grava marcador cancelado e nao agenda', async () => {
  const { pool, captura } = criarPoolMock({})
  const fa = createFollowupAuto(depsBase(pool))
  const row = {
    numero: '5511777777777@s.whatsapp.net',
    historico: [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'msg1' },
      { role: 'assistant', content: 'msg2' },
      { role: 'assistant', content: 'msg3' },
    ],
    estagio: 'diagnostico',
    status: 'ativo',
    atualizado_em: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    temperatura_lead: 'morno',
    silencio_min: 90,
    total_auto: 0,
    sequencia: 1,
  }
  const r = await fa.agendarFollowupAutoParaConversa(row)
  assert.equal(r, null, 'nao deve agendar follow-up para conversa morta')
  const inserts = captura.queries.filter((q) =>
    /INSERT INTO vendas\.followup_auto_agendamentos/i.test(q.sql)
  )
  assert.equal(inserts.length, 1, 'deve gravar exatamente 1 marcador (sem reprocessar)')
  assert.match(inserts[0].sql, /'cancelado'/, 'marcador deve ter status cancelado')
  assert.ok(
    inserts[0].params.includes('tres_mensagens_consecutivas_sem_resposta'),
    'motivo do cancelamento deve ser registrado'
  )
})

// ─── Cenario 8: SELECT exclui conversas ja decididas (guard anti-reselecao) ─

test('8. SELECT de elegiveis exclui conversas com marcador cancelado posterior a atividade', async () => {
  const { pool, captura } = criarPoolMock({ elegiveis: [] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const sqlSelect = captura.queries.find((q) => /^SELECT c\.numero/i.test(q.sql))
  assert.ok(sqlSelect, 'SELECT de elegiveis deve estar entre as queries')
  assert.match(
    sqlSelect.sql,
    /NOT EXISTS \( SELECT 1 FROM vendas\.followup_auto_agendamentos fa WHERE fa\.numero = c\.numero AND fa\.status = 'cancelado' AND fa\.criado_em >= c\.atualizado_em/i,
    'SELECT deve excluir conversas ja canceladas para o estado atual (auto-curavel)'
  )
})

// ─── Cenario 6: SQL nao tem o bug do "FROM updated" ────────────────────────

test('6. SQL corrigido NAO faz SELECT FROM updated (causa do bug original)', async () => {
  const { pool, captura } = criarPoolMock({ encerramentoRows: 0, elegiveis: [] })
  const fa = createFollowupAuto(depsBase(pool))
  await fa.silenceWatcherTick()

  const sqlSelect = captura.queries.find((q) => /^SELECT c\.numero/i.test(q.sql))
  assert.ok(sqlSelect, 'SELECT de elegiveis deve estar entre as queries')
  assert.doesNotMatch(sqlSelect.sql, /FROM updated/i,
    'SELECT corrigido nao pode ler de "updated" (origem do bug do commit 55b2c83)')
  assert.match(sqlSelect.sql, /FROM vendas\.conversas c/i,
    'SELECT corrigido deve ler direto de vendas.conversas')
})
