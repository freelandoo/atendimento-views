'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  obterPainelFilaDiaria,
  cancelarItemFilaDiaria,
  pausarExecucaoDiaria,
  listarBloqueiosProspeccao,
  listarExecucoesDiarias,
} = require('../src/services/prospecting-daily-queue')

function criarPoolPainelFake() {
  const state = {
    execucoes: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        data_execucao: '2026-05-24',
        modo: 'automatico',
        status: 'simulada',
        config_snapshot: { categoria_padrao: 'restaurantes', cidade_padrao: 'Salvador', motivo_ia: 'bom historico' },
        total_encontrados: 2,
        total_elegiveis: 2,
        total_agendados: 2,
        total_simulados: 2,
        total_enviados: 0,
        total_respondidos: 0,
        total_falhas: 0,
      },
    ],
    fila: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        execucao_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        prospect_id: '99999999-9999-4999-8999-999999999999',
        telefone_normalizado: '5571999990001',
        nome_lead: 'Restaurante A',
        categoria: 'restaurantes',
        cidade: 'Salvador',
        estado: 'BA',
        status: 'simulado',
        ordem: 1,
        slot_envio: '2026-05-24T09:00:00-03:00',
        mensagem_gerada: 'Oi, vi o restaurante de voces.',
        mensagem_editada: null,
        job_id: null,
        metadata_json: { origem: 'simulacao' },
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        execucao_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        prospect_id: null,
        telefone_normalizado: '5571999990002',
        nome_lead: 'Restaurante B',
        categoria: 'restaurantes',
        cidade: 'Salvador',
        estado: 'BA',
        status: 'falhou',
        ordem: 2,
        slot_envio: '2026-05-24T09:15:00-03:00',
        mensagem_gerada: null,
        mensagem_editada: null,
        job_id: null,
        ultimo_erro: 'telefone invalido',
        metadata_json: { origem: 'simulacao' },
      },
    ],
    bloqueios: [
      { id: 1, telefone_normalizado: '5571999990003', prospect_id: null, motivo: 'opt_out', origem: 'manual', ativo: true },
      { id: 2, telefone_normalizado: '5571999990004', prospect_id: null, motivo: 'lead_respondeu', origem: 'webhook', ativo: true },
    ],
  }

  return {
    state,
    async query(sql, params = []) {
      if (/COUNT\(\*\) OVER\(\)::int AS total_count/i.test(sql) && /FROM prospectador\.prospeccao_execucoes_diarias/i.test(sql)) {
        return { rows: state.execucoes.map((e) => ({ ...e, total_count: state.execucoes.length })) }
      }
      if (/FROM prospectador\.prospeccao_execucoes_diarias\s+ORDER BY data_execucao DESC/i.test(sql)) {
        return { rows: state.execucoes.slice(0, 1) }
      }
      if (/FROM prospectador\.prospeccao_execucoes_diarias\s+WHERE id =/i.test(sql)) {
        return { rows: state.execucoes.filter((e) => e.id === params[0]) }
      }
      if (/FROM prospectador\.prospeccao_fila_diaria f\s+LEFT JOIN prospectador\.prospects/i.test(sql)) {
        return { rows: state.fila.filter((f) => f.execucao_id === params[0]) }
      }
      if (/SELECT\s+status,\s+COUNT\(\*\)::int AS total/i.test(sql) && /GROUP BY status/i.test(sql)) {
        const porStatus = new Map()
        for (const item of state.fila.filter((f) => f.execucao_id === params[0])) {
          const atual = porStatus.get(item.status) || { status: item.status, total: 0, proximo_envio: null }
          atual.total += 1
          if (item.slot_envio && ['simulado', 'agendado', 'enviando'].includes(item.status)) atual.proximo_envio = item.slot_envio
          porStatus.set(item.status, atual)
        }
        return { rows: Array.from(porStatus.values()) }
      }
      if (/COUNT\(\*\)::int AS total FROM prospectador\.prospeccao_fila_diaria/i.test(sql)) {
        return { rows: [{ total: state.fila.filter((f) => f.execucao_id === params[0]).length }] }
      }
      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'cancelado'/i.test(sql)) {
        const item = state.fila.find((f) => f.id === params[0] && ['aguardando_agendamento', 'simulado', 'agendado'].includes(f.status))
        if (!item) return { rows: [] }
        item.status = 'cancelado'
        item.metadata_json = { ...(item.metadata_json || {}), cancelado_manual: true, motivo_cancelamento: params[1] }
        return { rows: [item] }
      }
      if (/UPDATE prospectador\.prospeccao_execucoes_diarias\s+SET status = 'cancelada'/i.test(sql)) {
        const exec = state.execucoes.find((e) => e.id === params[0] && !['concluida', 'cancelada', 'falhou'].includes(e.status))
        if (!exec) return { rows: [] }
        exec.status = 'cancelada'
        return { rows: [exec] }
      }
      if (/UPDATE prospectador\.prospeccao_fila_diaria\s+SET status = 'cancelado'/i.test(sql) && /cancelado_por_pausa_execucao/i.test(sql)) {
        return { rows: [] }
      }
      if (/FROM prospectador\.prospeccao_bloqueios/i.test(sql)) {
        return { rows: state.bloqueios.map((b) => ({ ...b, total_count: state.bloqueios.length })) }
      }
      return { rows: [] }
    },
  }
}

test('painel fila diaria: lista execucao, resumo e itens operacionais', async () => {
  const pool = criarPoolPainelFake()
  const r = await obterPainelFilaDiaria(pool, {})
  assert.equal(r.ok, true)
  assert.equal(r.execucao.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.equal(r.resumo.total, 2)
  assert.equal(r.resumo.mensagens_agendadas, 1)
  assert.equal(r.resumo.falhas, 1)
  assert.equal(r.items.length, 2)
})

test('painel fila diaria: cancela item simulado sem enviar nada', async () => {
  const pool = criarPoolPainelFake()
  const r = await cancelarItemFilaDiaria(pool, '11111111-1111-4111-8111-111111111111', { motivo: 'fora_do_dia' })
  assert.equal(r.ok, true)
  assert.equal(r.item.status, 'cancelado')
  assert.equal(r.item.metadata_json.motivo_cancelamento, 'fora_do_dia')
})

test('painel fila diaria: pausa execucao e retorna status cancelada', async () => {
  const pool = criarPoolPainelFake()
  const r = await pausarExecucaoDiaria(pool, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { motivo: 'operador pausou' })
  assert.equal(r.ok, true)
  assert.equal(r.execucao.status, 'cancelada')
})

test('painel fila diaria: lista historico e bloqueios', async () => {
  const pool = criarPoolPainelFake()
  const execs = await listarExecucoesDiarias(pool, {})
  const bloqueios = await listarBloqueiosProspeccao(pool, {})
  assert.equal(execs.total, 1)
  assert.equal(bloqueios.total, 2)
  assert.deepEqual(bloqueios.items.map((b) => b.motivo), ['opt_out', 'lead_respondeu'])
})
