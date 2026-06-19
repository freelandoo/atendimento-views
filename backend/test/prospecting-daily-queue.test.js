'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarCandidato,
  criarFilaDiariaSimulada,
} = require('../src/services/prospecting-daily-queue')

const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
]

function criarPoolFilaFake(opts = {}) {
  const state = {
    execucao: null,
    fila: [],
    queries: [],
    prospects: opts.prospects || [],
    bloqueios: opts.bloqueios || {},
    conversas: opts.conversas || {},
    politicas: opts.politicas || {},
    sendAttempts: opts.sendAttempts || {},
    jobs: opts.jobs || {},
  }

  const config = opts.config || {
    ativo: true,
    modo: 'automatico',
    horario_inicio: '08:00',
    horario_fim: '08:15',
    intervalo_envio_minutos: 15,
    limite_diario: 80,
    dias_semana_ativos: [1, 2, 3, 4, 5],
    categoria_padrao: 'restaurantes',
    cidade_padrao: 'Salvador',
    estado_padrao: 'BA',
    regiao_padrao: null,
    gerar_mensagem_ia: false,
    envio_real_habilitado: false,
    criado_em: '2026-05-24T00:00:00Z',
    atualizado_em: '2026-05-24T00:00:00Z',
  }

  function phoneParam(params) {
    return String(params?.[0] || '')
  }

  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params })

      if (/INSERT INTO prospectador\.prospeccao_configuracoes \(singleton_id\)/i.test(sql)) return { rows: [] }
      if (/FROM prospectador\.prospeccao_configuracoes/i.test(sql)) return { rows: [config] }

      if (/SELECT id, nome, telefone, nicho, cidade, raw_json\s+FROM prospectador\.prospects/i.test(sql)) {
        return { rows: state.prospects }
      }

      if (/INSERT INTO prospectador\.prospeccao_execucoes_diarias/i.test(sql)) {
        state.execucao = {
          id: opts.execucaoId || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          data_execucao: params[0],
          modo: params[1],
          status: 'montando_fila',
          config_snapshot: JSON.parse(params[2]),
        }
        return { rows: [state.execucao] }
      }

      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'cancelado'/i.test(sql)) {
        for (const item of state.fila) {
          if (['aguardando_agendamento', 'agendado', 'simulado'].includes(item.status)) item.status = 'cancelado'
        }
        return { rows: [] }
      }

      if (/prospeccao_bloqueios/i.test(sql)) {
        const row = state.bloqueios[phoneParam(params)]
        return { rows: row ? [row] : [] }
      }

      if (/contato_politicas/i.test(sql)) {
        const row = state.politicas[phoneParam(params)]
        return { rows: row ? [row] : [] }
      }

      if (/vendas\.conversas/i.test(sql)) {
        const row = state.conversas[phoneParam(params)]
        return { rows: row ? [row] : [] }
      }

      if (/SELECT id, telefone, status, updated_at, created_at\s+FROM prospectador\.prospects/i.test(sql)) {
        const phone = phoneParam(params)
        const id = params[1]
        const row = state.prospects.find((p) => p.id === id || String(p.telefone || '').replace(/\D/g, '') === phone)
        return { rows: row ? [{ id: row.id, telefone: row.telefone, status: row.status || 'aguardando', updated_at: row.updated_at }] : [] }
      }

      if (/FROM prospectador\.send_attempts/i.test(sql)) {
        const row = state.sendAttempts[phoneParam(params)]
        return { rows: row ? [row] : [] }
      }

      if (/FROM prospectador\.prospeccao_fila_diaria/i.test(sql)) {
        const phone = phoneParam(params)
        const row = state.fila.find((i) =>
          i.telefone_normalizado === phone &&
          ['aguardando_agendamento', 'agendado', 'simulado', 'enviando', 'enviado'].includes(i.status)
        )
        return { rows: row ? [row] : [] }
      }

      if (/FROM vendas\.job_queue/i.test(sql)) {
        const row = state.jobs[phoneParam(params)]
        return { rows: row ? [row] : [] }
      }

      if (/INSERT INTO prospectador\.prospeccao_fila_diaria/i.test(sql)) {
        const phone = params[2]
        const duplicado = state.fila.some((i) =>
          i.telefone_normalizado === phone &&
          ['aguardando_agendamento', 'agendado', 'simulado', 'enviando', 'enviado'].includes(i.status)
        )
        if (duplicado) return { rows: [] }
        const row = {
          id: `fila-${state.fila.length + 1}`,
          execucao_id: params[0],
          prospect_id: params[1],
          telefone_normalizado: phone,
          nome_lead: params[3],
          categoria: params[4],
          cidade: params[5],
          estado: params[6],
          status: params[7],
          ordem: params[8],
          slot_envio: params[9],
          metadata_json: JSON.parse(params[10]),
        }
        state.fila.push(row)
        return { rows: [row] }
      }

      if (/UPDATE prospectador\.prospeccao_execucoes_diarias/i.test(sql)) {
        state.execucao = {
          ...state.execucao,
          status: 'simulada',
          total_encontrados: params[1],
          total_elegiveis: params[2],
          total_agendados: params[3],
          total_simulados: params[4],
          total_falhas: params[5],
        }
        return { rows: [state.execucao] }
      }

      return { rows: [] }
    },
  }
}

test('fila diaria: normaliza candidato manual', () => {
  const c = normalizarCandidato({
    prospectId: UUIDS[0],
    phone: '11 99999-9999',
    name: 'Restaurante Teste',
    tag: 'restaurantes',
    city: 'Salvador',
    uf: 'BA',
  })
  assert.equal(c.prospect_id, UUIDS[0])
  assert.equal(c.telefone_normalizado, '5511999999999')
  assert.equal(c.nome_lead, 'Restaurante Teste')
  assert.equal(c.categoria, 'restaurantes')
})

test('fila diaria: cria execucao e preenche candidatos manuais em modo simulado', async () => {
  const pool = criarPoolFilaFake()
  const r = await criarFilaDiariaSimulada(pool, {
    data: '2026-05-25',
    candidatos: [
      { prospect_id: UUIDS[0], telefone: '11 99999-0001', nome: 'A', categoria: 'restaurantes', cidade: 'Salvador' },
      { prospect_id: UUIDS[1], telefone: '11 99999-0002', nome: 'B', categoria: 'restaurantes', cidade: 'Salvador' },
      { prospect_id: UUIDS[2], telefone: '11 99999-0003', nome: 'C', categoria: 'restaurantes', cidade: 'Salvador' },
    ],
  })
  assert.equal(r.ok, true)
  assert.equal(r.total_candidatos, 3)
  assert.equal(r.total_elegiveis, 3)
  assert.equal(r.total_simulados, 2)
  assert.equal(r.total_aguardando_agendamento, 1)
  assert.equal(r.total_bloqueados, 0)
  assert.deepEqual(pool.state.fila.map((i) => i.status), ['simulado', 'simulado', 'aguardando_agendamento'])
  assert.equal(pool.state.fila[0].slot_envio, '2026-05-25T08:00:00')
  assert.equal(pool.state.fila[1].slot_envio, '2026-05-25T08:15:00')
  assert.equal(pool.state.execucao.status, 'simulada')
})

test('fila diaria: aplica elegibilidade e nao insere bloqueados', async () => {
  const pool = criarPoolFilaFake({
    politicas: {
      '5511999990002': { telefone: '5511999990002', opt_out: true, updated_at: '2026-05-01T00:00:00Z' },
    },
    conversas: {
      '5511999990003': { id: 99, status: 'ativo', estagio: 'diagnostico', venda_fechada: false },
    },
  })
  const r = await criarFilaDiariaSimulada(pool, {
    data: '2026-05-25',
    candidatos: [
      { prospect_id: UUIDS[0], telefone: '11 99999-0001', nome: 'A' },
      { prospect_id: UUIDS[1], telefone: '11 99999-0002', nome: 'B' },
      { prospect_id: UUIDS[2], telefone: '11 99999-0003', nome: 'C' },
    ],
  })
  assert.equal(r.total_elegiveis, 1)
  assert.equal(r.total_bloqueados, 2)
  assert.deepEqual(r.bloqueados.map((b) => b.elegibilidade.reason), ['opt_out', 'conversa_ativa'])
  assert.equal(pool.state.fila.length, 1)
  assert.equal(pool.state.fila[0].telefone_normalizado, '5511999990001')
})

test('fila diaria: busca candidatos em prospectador.prospects quando lista manual nao vem', async () => {
  const pool = criarPoolFilaFake({
    prospects: [
      { id: UUIDS[0], nome: 'A', telefone: '5511999990001', nicho: 'restaurantes', cidade: 'Salvador', status: 'aguardando' },
      { id: UUIDS[1], nome: 'B', telefone: '5511999990002', nicho: 'restaurantes', cidade: 'Salvador', status: 'aguardando' },
    ],
  })
  const r = await criarFilaDiariaSimulada(pool, { data: '2026-05-25' })
  assert.equal(r.total_candidatos, 2)
  assert.equal(r.total_elegiveis, 2)
  assert.equal(pool.state.fila.length, 2)
  assert.ok(pool.state.queries.some((q) => /FROM prospectador\.prospects p/i.test(q.sql)))
})

test('fila diaria: nao gera IA, jobs ou envio real', async () => {
  const pool = criarPoolFilaFake()
  const r = await criarFilaDiariaSimulada(pool, {
    data: '2026-05-25',
    candidatos: [{ prospect_id: UUIDS[0], telefone: '11 99999-0001', nome: 'A' }],
  })
  assert.equal(r.envio_real_habilitado, false)
  assert.equal(r.ia_gerada, false)
  assert.equal(pool.state.queries.some((q) => /INSERT INTO vendas\.job_queue/i.test(q.sql)), false)
  assert.equal(pool.state.queries.some((q) => /send_attempts\s*\(/i.test(q.sql)), false)
})
