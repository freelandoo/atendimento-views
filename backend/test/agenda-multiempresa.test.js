'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validarEvento,
  montarResumo,
  listarEventos,
  criarEvento,
  atualizarEvento,
  removerEvento,
  existeConflito,
} = require('../src/services/agenda-multiempresa')

// Pool fake em memória: guarda linhas e simula as queries usadas pelo módulo.
function criarPoolFake(seed = []) {
  let seq = seed.length
  const linhas = seed.map((r) => ({ ...r }))
  const queries = []
  return {
    linhas,
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })

      if (/COUNT\(\*\)::int AS n FROM app\.agenda_eventos/i.test(sql)) {
        const [empresaId, ini, fim, statusOcupa] = params
        // CRM em equipe, Etapa 11: o conflito virou POR PESSOA. `ignorarId` e `responsavelId` sao
        // ambos opcionais e entram na MESMA posicao seguinte, na ordem em que o SQL os acrescenta —
        // por isso o fake precisa distinguir pelo texto da query, e nao pela posicao.
        const usaIgnorar = /AND id <> \$/.test(sql)
        const usaResponsavel = /responsavel_id = \$/.test(sql)
        const ignorar = usaIgnorar ? (params[4] || null) : null
        const responsavel = usaResponsavel ? (params[usaIgnorar ? 5 : 4] || null) : null
        const n = linhas.filter((r) =>
          r.empresa_id === empresaId &&
          !r.excluido_em &&
          statusOcupa.includes(r.status) &&
          new Date(r.data_inicio) < new Date(fim) &&
          new Date(r.data_fim) > new Date(ini) &&
          (!ignorar || r.id !== ignorar) &&
          // Sem responsavel informado: empresa inteira (comportamento anterior).
          // Com responsavel: os eventos DELE + os da EMPRESA (sem responsavel), porque o evento
          // sem dono pode ser um bloqueio que vale para todos.
          (!responsavel || r.responsavel_id === responsavel || !r.responsavel_id)
        ).length
        return { rows: [{ n }] }
      }

      if (/^\s*SELECT \* FROM app\.agenda_eventos\s+WHERE id =/i.test(sql)) {
        const [id, empresaId] = params
        const row = linhas.find((r) => r.id === id && r.empresa_id === empresaId && !r.excluido_em)
        return { rows: row ? [row] : [] }
      }

      if (/FROM app\.agenda_eventos ae\s*\n?\s*LEFT JOIN/i.test(sql) || /SELECT \* FROM app\.agenda_eventos\s+WHERE empresa_id = \$1/i.test(sql)) {
        const [empresaId, , , , tipo, status, responsavelId] = params
        const out = linhas
          .filter((r) => r.empresa_id === empresaId && !r.excluido_em)
          .filter((r) => (tipo ? r.tipo === tipo : true))
          .filter((r) => (status ? r.status === status : true))
          // Etapa 11: filtrar por responsavel INCLUI os eventos da empresa (sem responsavel).
          .filter((r) => (responsavelId ? (r.responsavel_id === responsavelId || !r.responsavel_id) : true))
          .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
        return { rows: out }
      }

      if (/INSERT INTO app\.agenda_eventos/i.test(sql)) {
        const row = {
          id: `evt-${++seq}`,
          empresa_id: params[0],
          criado_por: params[1],
          // Colunas novas da migration 076, inseridas ANTES do titulo (Etapa 11).
          responsavel_id: params[2],
          prospect_id: params[3],
          titulo: params[4],
          descricao: params[5],
          tipo: params[6],
          status: params[7],
          prioridade: params[8],
          data_inicio: params[9],
          data_fim: params[10],
          timezone: params[11],
          lead_telefone: params[12],
          lead_nome: params[13],
          metadata: JSON.parse(params[14] || '{}'),
          excluido_em: null,
          criado_em: new Date('2026-06-19T12:00:00Z'),
          atualizado_em: new Date('2026-06-19T12:00:00Z'),
        }
        linhas.push(row)
        return { rows: [row] }
      }

      if (/UPDATE app\.agenda_eventos SET excluido_em/i.test(sql)) {
        const [id, empresaId] = params
        const row = linhas.find((r) => r.id === id && r.empresa_id === empresaId && !r.excluido_em)
        if (!row) return { rows: [] }
        row.excluido_em = new Date()
        return { rows: [{ id: row.id }] }
      }

      if (/UPDATE app\.agenda_eventos SET /i.test(sql)) {
        // os 2 últimos params são id e empresa_id
        const empresaId = params[params.length - 1]
        const id = params[params.length - 2]
        const row = linhas.find((r) => r.id === id && r.empresa_id === empresaId && !r.excluido_em)
        if (!row) return { rows: [] }
        // aplica os SET col = $n na ordem do SQL
        const cols = [...sql.matchAll(/(\w+)\s*=\s*\$(\d+)/g)]
        for (const [, col, idx] of cols) {
          const p = params[Number(idx) - 1]
          if (col === 'metadata') row.metadata = JSON.parse(p)
          else if (col !== 'id' && col !== 'empresa_id') row[col] = p
        }
        row.atualizado_em = new Date()
        return { rows: [row] }
      }

      return { rows: [] }
    },
  }
}

const EMP = '00000000-0000-0000-0000-000000000001'
const OUTRA = '00000000-0000-0000-0000-000000000002'

test('validarEvento exige titulo, tipo e período coerente', () => {
  const semTitulo = validarEvento({ data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z' })
  assert.equal(semTitulo.ok, false)
  assert.ok(semTitulo.issues.includes('titulo obrigatorio'))

  const periodoRuim = validarEvento({ titulo: 'X', data_inicio: '2026-06-20T11:00:00Z', data_fim: '2026-06-20T10:00:00Z' })
  assert.equal(periodoRuim.ok, false)
  assert.ok(periodoRuim.issues.some((i) => /data_fim/.test(i)))

  const ok = validarEvento({ titulo: 'Reunião', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.tipo, 'reuniao')
  assert.equal(ok.value.prioridade, 'media')
})

test('criarEvento persiste evento escopado na empresa', async () => {
  const pool = criarPoolFake()
  const ev = await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'user-1',
    titulo: 'Call com lead', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z',
    lead_telefone: '5511999999999', lead_nome: 'Padaria do Zé',
  })
  assert.equal(ev.empresa_id, EMP)
  assert.equal(ev.titulo, 'Call com lead')
  assert.equal(ev.lead_nome, 'Padaria do Zé')
  assert.equal(ev.status, 'pendente')
})

test('criarEvento bloqueia conflito de horário na mesma empresa', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, { empresaId: EMP, titulo: 'A', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z' })
  await assert.rejects(
    () => criarEvento(pool, { empresaId: EMP, titulo: 'B', data_inicio: '2026-06-20T10:30:00Z', data_fim: '2026-06-20T11:30:00Z' }),
    (e) => e.code === 'CONFLICT' && e.statusCode === 409
  )
})

test('conflito é isolado por empresa: outra empresa pode usar o mesmo horário', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, { empresaId: EMP, titulo: 'A', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z' })
  const ev = await criarEvento(pool, { empresaId: OUTRA, titulo: 'B', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z' })
  assert.equal(ev.empresa_id, OUTRA)
})

test('bloqueio não dispara checagem de conflito', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, { empresaId: EMP, titulo: 'Reunião', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z' })
  const bloq = await criarEvento(pool, { empresaId: EMP, tipo: 'bloqueio', status: 'bloqueado', titulo: 'Almoço', data_inicio: '2026-06-20T10:30:00Z', data_fim: '2026-06-20T11:30:00Z' })
  assert.equal(bloq.tipo, 'bloqueio')
})

test('listarEventos filtra pela empresa e monta resumo', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, { empresaId: EMP, titulo: 'R1', data_inicio: '2026-06-20T09:00:00Z', data_fim: '2026-06-20T09:30:00Z' })
  await criarEvento(pool, { empresaId: EMP, tipo: 'follow_up', titulo: 'F1', data_inicio: '2026-06-20T14:00:00Z', data_fim: '2026-06-20T14:30:00Z' })
  await criarEvento(pool, { empresaId: OUTRA, titulo: 'X', data_inicio: '2026-06-20T09:00:00Z', data_fim: '2026-06-20T09:30:00Z' })

  const out = await listarEventos(pool, { empresaId: EMP, inicio: '2026-06-20', fim: '2026-06-20' })
  assert.equal(out.eventos.length, 2)
  assert.equal(out.resumo.total, 2)
  assert.equal(out.resumo.reunioes, 1)
  assert.equal(out.resumo.por_tipo.follow_up, 1)
})

test('Etapa 11: o conflito e POR PESSOA — dois vendedores podem marcar no MESMO horario', () => {})

test('conflito por pessoa: cada vendedor tem a propria agenda', async () => {
  // Antes da Etapa 11 a checagem era da empresa inteira: a reuniao de um vendedor impedia os
  // outros dois de marcar no mesmo horario. Com equipe, isso e o oposto do necessario.
  const pool = criarPoolFake()
  await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'A',
    data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z',
  })
  const doB = await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'vendedor-B', titulo: 'B',
    data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z',
  })
  assert.equal(doB.responsavel_id, 'vendedor-B')
})

test('conflito por pessoa: o MESMO vendedor continua bloqueado', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'A',
    data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z',
  })
  await assert.rejects(
    () => criarEvento(pool, {
      empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'A2',
      data_inicio: '2026-06-20T10:30:00Z', data_fim: '2026-06-20T11:30:00Z',
    }),
    (e) => e.code === 'CONFLICT'
  )
})

test('evento SEM responsavel (bloqueio da empresa) bloqueia TODO MUNDO', async () => {
  // E' o termo que nao pode sumir do WHERE: feriado, treinamento e todo evento anterior a
  // migration 076 nao tem responsavel, e ignora-los deixaria marcar reuniao em cima deles.
  const pool = criarPoolFake()
  await criarEvento(pool, {
    empresaId: EMP, titulo: 'Treinamento da equipe',
    data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z',
  })
  await assert.rejects(
    () => criarEvento(pool, {
      empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'Reuniao',
      data_inicio: '2026-06-20T10:30:00Z', data_fim: '2026-06-20T11:30:00Z',
    }),
    (e) => e.code === 'CONFLICT'
  )
})

test('o responsavel DEFAULT e quem cria; marcar para outro e explicito', async () => {
  const pool = criarPoolFake()
  const proprio = await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'Minha reuniao',
    data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z',
  })
  assert.equal(proprio.responsavel_id, 'vendedor-A')

  const paraOutro = await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'admin-1', responsavelId: 'vendedor-B', titulo: 'Reuniao do B',
    data_inicio: '2026-06-21T10:00:00Z', data_fim: '2026-06-21T10:30:00Z',
  })
  // Quem MARCOU e quem CONDUZ sao pessoas diferentes, e as duas ficam registradas.
  assert.equal(paraOutro.criado_por, 'admin-1')
  assert.equal(paraOutro.responsavel_id, 'vendedor-B')
})

test('listarEventos por responsavel traz os DELE e os da EMPRESA', async () => {
  const pool = criarPoolFake()
  await criarEvento(pool, { empresaId: EMP, criadoPor: 'vendedor-A', titulo: 'A', data_inicio: '2026-06-20T09:00:00Z', data_fim: '2026-06-20T09:30:00Z' })
  await criarEvento(pool, { empresaId: EMP, criadoPor: 'vendedor-B', titulo: 'B', data_inicio: '2026-06-20T14:00:00Z', data_fim: '2026-06-20T14:30:00Z' })
  await criarEvento(pool, { empresaId: EMP, tipo: 'bloqueio', status: 'bloqueado', titulo: 'Feriado', data_inicio: '2026-06-20T18:00:00Z', data_fim: '2026-06-20T19:00:00Z' })

  const doA = await listarEventos(pool, { empresaId: EMP, inicio: '2026-06-20', fim: '2026-06-20', responsavelId: 'vendedor-A' })
  const titulos = doA.eventos.map((e) => e.titulo).sort()
  assert.deepEqual(titulos, ['A', 'Feriado'], 'o bloqueio da empresa vale para todos')

  const todos = await listarEventos(pool, { empresaId: EMP, inicio: '2026-06-20', fim: '2026-06-20' })
  assert.equal(todos.eventos.length, 3, 'sem responsavel = agenda consolidada')
})

test('prospect_id e gravado quando informado (vinculo firme com o lead)', async () => {
  const pool = criarPoolFake()
  const ev = await criarEvento(pool, {
    empresaId: EMP, criadoPor: 'u1', prospectId: 'prospect-9', titulo: 'R',
    data_inicio: '2026-06-22T10:00:00Z', data_fim: '2026-06-22T10:30:00Z',
    lead_telefone: '5511999999999',
  })
  assert.equal(ev.prospect_id, 'prospect-9')
  // `lead_telefone` continua existindo: e' ele que casa reuniao com contato que ainda nao virou
  // prospect.
  assert.equal(ev.lead_telefone, '5511999999999')
})

test('atualizarEvento muda status e revalida; remover faz soft delete', async () => {
  const pool = criarPoolFake()
  const ev = await criarEvento(pool, { empresaId: EMP, titulo: 'R', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z' })
  const atualizado = await atualizarEvento(pool, { empresaId: EMP, id: ev.id, status: 'confirmado', titulo: 'R (confirmada)' })
  assert.equal(atualizado.status, 'confirmado')
  assert.equal(atualizado.titulo, 'R (confirmada)')

  const del = await removerEvento(pool, { empresaId: EMP, id: ev.id })
  assert.equal(del.removido, true)
  const depois = await listarEventos(pool, { empresaId: EMP, inicio: '2026-06-20', fim: '2026-06-20' })
  assert.equal(depois.eventos.length, 0)
})

test('atualizarEvento de empresa errada não encontra (isolamento)', async () => {
  const pool = criarPoolFake()
  const ev = await criarEvento(pool, { empresaId: EMP, titulo: 'R', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T10:30:00Z' })
  await assert.rejects(
    () => atualizarEvento(pool, { empresaId: OUTRA, id: ev.id, status: 'confirmado' }),
    (e) => e.code === 'NOT_FOUND'
  )
})

test('montarResumo conta tipos e status', () => {
  const resumo = montarResumo([
    { tipo: 'reuniao', status: 'pendente' },
    { tipo: 'reuniao', status: 'confirmado' },
    { tipo: 'tarefa', status: 'concluido' },
  ])
  assert.equal(resumo.total, 3)
  assert.equal(resumo.reunioes, 2)
  assert.equal(resumo.pendentes, 1)
  assert.equal(resumo.confirmados, 1)
  assert.equal(resumo.concluidos, 1)
  assert.equal(resumo.por_tipo.tarefa, 1)
})

test('existeConflito respeita ignorarId (mesmo evento ao editar)', async () => {
  const pool = criarPoolFake()
  const ev = await criarEvento(pool, { empresaId: EMP, titulo: 'R', data_inicio: '2026-06-20T10:00:00Z', data_fim: '2026-06-20T11:00:00Z' })
  const semIgnorar = await existeConflito(pool, { empresaId: EMP, dataInicio: '2026-06-20T10:30:00Z', dataFim: '2026-06-20T10:45:00Z' })
  assert.equal(semIgnorar, true)
  const ignorando = await existeConflito(pool, { empresaId: EMP, dataInicio: '2026-06-20T10:30:00Z', dataFim: '2026-06-20T10:45:00Z', ignorarId: ev.id })
  assert.equal(ignorando, false)
})
