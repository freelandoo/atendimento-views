'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolverBuscaPlaces,
  prospectParaCandidato,
  simularFilaDiariaComPlaces,
} = require('../src/services/prospecting-places-queue')

const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
]

function criarPoolPlacesFake(opts = {}) {
  const state = {
    execucao: null,
    fila: [],
    queries: [],
    prospects: opts.prospects || [],
    backlog: opts.backlog || [],
    politicas: opts.politicas || {},
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
  }

  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params })
      if (/INSERT INTO prospectador\.prospeccao_configuracoes \(singleton_id\)/i.test(sql)) return { rows: [] }
      if (/FROM prospectador\.prospeccao_configuracoes/i.test(sql)) return { rows: [config] }
      if (/INSERT INTO prospectador\.prospeccao_execucoes_diarias/i.test(sql)) {
        state.execucao = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', data_execucao: params[0], modo: params[1], status: 'montando_fila' }
        return { rows: [state.execucao] }
      }
      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'cancelado'/i.test(sql)) return { rows: [] }
      if (/prospeccao_bloqueios/i.test(sql)) return { rows: [] }
      if (/contato_politicas/i.test(sql)) {
        const row = state.politicas[String(params[0] || '')]
        return { rows: row ? [row] : [] }
      }
      if (/vendas\.conversas/i.test(sql)) return { rows: [] }
      if (/SELECT id, nome, telefone, nicho, cidade, raw_json\s+FROM prospectador\.prospects/i.test(sql)) {
        return { rows: state.backlog }
      }
      if (/SELECT id, telefone, status, updated_at, created_at\s+FROM prospectador\.prospects/i.test(sql)) {
        const phone = String(params[0] || '')
        const id = params[1]
        const row = state.prospects.find((p) => p.id === id || String(p.telefone || '').replace(/\D/g, '') === phone)
        return { rows: row ? [{ id: row.id, telefone: row.telefone, status: row.status || 'aguardando', updated_at: row.updated_at }] : [] }
      }
      if (/FROM prospectador\.send_attempts/i.test(sql)) return { rows: [] }
      if (/FROM prospectador\.prospeccao_fila_diaria/i.test(sql)) return { rows: [] }
      if (/FROM vendas\.job_queue/i.test(sql)) return { rows: [] }
      if (/INSERT INTO prospectador\.prospeccao_fila_diaria/i.test(sql)) {
        const row = {
          id: `fila-${state.fila.length + 1}`,
          execucao_id: params[0],
          prospect_id: params[1],
          telefone_normalizado: params[2],
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

test('places queue: resolve busca a partir do input ou config', () => {
  assert.deepEqual(resolverBuscaPlaces({}, {
    categoria_padrao: 'restaurantes',
    cidade_padrao: 'Salvador',
    limite_diario: 80,
  }), {
    nicho: 'restaurantes',
    local: 'Salvador',
    quantidade: 60,
  })
  assert.deepEqual(resolverBuscaPlaces({ nicho: 'barbearias', local: 'SBC', quantidade: 3 }, {}), {
    nicho: 'barbearias',
    local: 'SBC',
    quantidade: 3,
  })
})

test('places queue: prospect salvo vira candidato com score e origem Places no metadata', () => {
  const c = prospectParaCandidato({
    id: UUIDS[0],
    telefone: '5511999990001',
    nome: 'Restaurante A',
    nicho: 'restaurantes',
    cidade: 'Salvador',
    score: 91,
    place_id: 'place-1',
    maps_url: 'https://maps.example/a',
    tem_site: false,
  })
  assert.equal(c.prospect_id, UUIDS[0])
  assert.equal(c.telefone, '5511999990001')
  assert.equal(c.metadata_json.origem_places, true)
  assert.equal(c.metadata_json.score, 91)
  assert.equal(c.metadata_json.place_id, 'place-1')
})

test('places queue: chama Places, salva prospects via funcao reaproveitada e preenche fila so com elegiveis', async () => {
  const prospectsSalvos = [
    { id: UUIDS[0], telefone: '5511999990001', nome: 'Restaurante A', nicho: 'restaurantes', cidade: 'Salvador', score: 88, place_id: 'p1' },
    { id: UUIDS[1], telefone: '5511999990002', nome: 'Restaurante B', nicho: 'restaurantes', cidade: 'Salvador', score: 70, place_id: 'p2' },
  ]
  const pool = criarPoolPlacesFake({
    prospects: prospectsSalvos,
    politicas: {
      '5511999990002': { telefone: '5511999990002', opt_out: true },
    },
  })
  const chamadas = []
  const pesquisarPlacesFn = async (args) => {
    chamadas.push(args)
    return { consulta: `${args.nicho} em ${args.local}`, prospects: prospectsSalvos }
  }

  const r = await simularFilaDiariaComPlaces(pool, { data: '2026-05-25' }, { pesquisarPlacesFn })

  assert.equal(chamadas.length, 1)
  assert.deepEqual(chamadas[0], {
    nicho: 'restaurantes',
    local: 'Salvador',
    quantidade: 60,
    origem: 'automatico',
  })
  assert.equal(r.total_places_salvos, 2)
  assert.equal(r.total_candidatos, 2)
  assert.equal(r.total_elegiveis, 1)
  assert.equal(r.total_bloqueados, 1)
  assert.equal(r.bloqueados[0].elegibilidade.reason, 'opt_out')
  assert.equal(pool.state.fila.length, 1)
  assert.equal(pool.state.fila[0].telefone_normalizado, '5511999990001')
  assert.equal(pool.state.fila[0].metadata_json.candidato.score, 88)
  assert.equal(r.envio_real_habilitado, false)
  assert.equal(r.ia_gerada, false)
})

test('places queue: incluirBacklog drena o backlog junto com o Places (dedup por telefone)', async () => {
  const placesProspects = [
    { id: UUIDS[0], telefone: '5511999990001', nome: 'Restaurante A', nicho: 'restaurantes', cidade: 'Salvador', score: 88, place_id: 'p1' },
  ]
  const backlog = [
    { id: '33333333-3333-4333-8333-333333333333', nome: 'Backlog X', telefone: '5511988880002', nicho: 'restaurantes', cidade: 'Salvador', raw_json: {} },
    // mesmo telefone do Places → deve ser deduplicado
    { id: '44444444-4444-4444-8444-444444444444', nome: 'Dup', telefone: '5511999990001', nicho: 'restaurantes', cidade: 'Salvador', raw_json: {} },
  ]
  const pool = criarPoolPlacesFake({ prospects: placesProspects, backlog })
  const pesquisarPlacesFn = async () => ({ consulta: 'x', prospects: placesProspects })

  const r = await simularFilaDiariaComPlaces(pool, { data: '2026-05-25', incluirBacklog: true }, { pesquisarPlacesFn })

  assert.equal(r.total_backlog_adicionado, 1) // 1 novo do backlog (o dup foi removido)
  assert.equal(r.total_candidatos, 2) // 1 Places + 1 backlog
})

test('places queue: SEM incluirBacklog nao toca o backlog (comportamento manual)', async () => {
  const pool = criarPoolPlacesFake({
    prospects: [{ id: UUIDS[0], telefone: '5511999990001', nome: 'A', nicho: 'restaurantes', cidade: 'Salvador', score: 80, place_id: 'p1' }],
    backlog: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'B', telefone: '5511988880002', nicho: 'restaurantes', cidade: 'Salvador', raw_json: {} }],
  })
  const r = await simularFilaDiariaComPlaces(pool, { data: '2026-05-25' }, { pesquisarPlacesFn: async () => ({ prospects: [{ id: UUIDS[0], telefone: '5511999990001', nome: 'A', nicho: 'restaurantes', cidade: 'Salvador', score: 80, place_id: 'p1' }] }) })
  assert.equal(r.total_backlog_adicionado || 0, 0)
  assert.equal(r.total_candidatos, 1)
})

test('places queue: exige nicho e local antes de chamar Google Places', async () => {
  const pool = criarPoolPlacesFake({ config: { categoria_padrao: null, cidade_padrao: null, limite_diario: 80 } })
  await assert.rejects(
    () => simularFilaDiariaComPlaces(pool, {}, { pesquisarPlacesFn: async () => ({ prospects: [] }) }),
    /Informe categoria\/nicho e cidade\/regiao/
  )
})
