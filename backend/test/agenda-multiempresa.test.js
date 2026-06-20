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
        const ignorar = params[4] || null
        const n = linhas.filter((r) =>
          r.empresa_id === empresaId &&
          !r.excluido_em &&
          statusOcupa.includes(r.status) &&
          new Date(r.data_inicio) < new Date(fim) &&
          new Date(r.data_fim) > new Date(ini) &&
          (!ignorar || r.id !== ignorar)
        ).length
        return { rows: [{ n }] }
      }

      if (/^\s*SELECT \* FROM app\.agenda_eventos\s+WHERE id =/i.test(sql)) {
        const [id, empresaId] = params
        const row = linhas.find((r) => r.id === id && r.empresa_id === empresaId && !r.excluido_em)
        return { rows: row ? [row] : [] }
      }

      if (/SELECT \* FROM app\.agenda_eventos\s+WHERE empresa_id = \$1/i.test(sql)) {
        const [empresaId, , , , tipo, status] = params
        const out = linhas
          .filter((r) => r.empresa_id === empresaId && !r.excluido_em)
          .filter((r) => (tipo ? r.tipo === tipo : true))
          .filter((r) => (status ? r.status === status : true))
          .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
        return { rows: out }
      }

      if (/INSERT INTO app\.agenda_eventos/i.test(sql)) {
        const row = {
          id: `evt-${++seq}`,
          empresa_id: params[0],
          criado_por: params[1],
          titulo: params[2],
          descricao: params[3],
          tipo: params[4],
          status: params[5],
          prioridade: params[6],
          data_inicio: params[7],
          data_fim: params[8],
          timezone: params[9],
          lead_telefone: params[10],
          lead_nome: params[11],
          metadata: JSON.parse(params[12] || '{}'),
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
