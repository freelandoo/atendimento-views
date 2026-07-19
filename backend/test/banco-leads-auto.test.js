'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const {
  dentroDaJanela, sortearIntervaloMinutos, executarBancoLeadsWorkerTick,
  verificarBancoLeadsSemi, _autoEmpresa, _semiEmpresa,
} = require('../src/services/banco-leads-auto')

function makePool(handlers) {
  return {
    query: async (sql) => {
      for (const [needle, fn] of handlers) {
        if (sql.includes(needle)) return fn(sql)
      }
      throw new Error('SQL não mapeado: ' + String(sql).slice(0, 70))
    },
  }
}
const autoCfg = {
  empresa_id: 'e1', modo: 'automatico', gerar_ia: false, instrucoes_ia: null,
  auto_ativo: true, janela_inicio: '08:00', janela_fim: '18:00',
  teto_diario: 40, intervalo_min: 15, intervalo_max: 30, auto_proximo_disparo_em: null,
}
const semiCfg = { ...autoCfg, modo: 'semi_automatico', auto_ativo: false, auto_instancia_id: 'i1' }
const now = new Date(2026, 0, 1, 10, 0, 0) // 10:00 local

test('dentroDaJanela cobre dentro / antes / depois / faixa inválida', () => {
  assert.equal(dentroDaJanela(new Date(2026, 0, 1, 10, 0), '08:00', '18:00'), true)
  assert.equal(dentroDaJanela(new Date(2026, 0, 1, 6, 0), '08:00', '18:00'), false)
  assert.equal(dentroDaJanela(new Date(2026, 0, 1, 20, 0), '08:00', '18:00'), false)
  assert.equal(dentroDaJanela(new Date(2026, 0, 1, 10, 0), '18:00', '08:00'), false)
})

test('dentroDaJanela usa APP_TIMEZONE em vez do fuso do processo', () => {
  const instanteUtc = new Date('2026-01-01T10:00:00.000Z')
  assert.equal(dentroDaJanela(instanteUtc, '08:00', '18:00', 'America/Sao_Paulo'), false)
  assert.equal(dentroDaJanela(instanteUtc, '08:00', '18:00', 'UTC'), true)
})

test('sortearIntervaloMinutos fica sempre na faixa', () => {
  for (let i = 0; i < 60; i++) {
    const v = sortearIntervaloMinutos(15, 30)
    assert.ok(v >= 15 && v <= 30, `fora da faixa: ${v}`)
  }
})

test('_autoEmpresa: modo não-automático é ignorado', async () => {
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [{ ...autoCfg, modo: 'manual' }] })]])
  const r = await _autoEmpresa(pool, 'e1', now, {})
  assert.equal(r.motivo, 'inativo')
})

test('_autoEmpresa: fora da janela não dispara', async () => {
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [autoCfg] })]])
  const r = await _autoEmpresa(pool, 'e1', new Date(2026, 0, 1, 6, 0), {})
  assert.equal(r.motivo, 'fora_janela')
})

test('_autoEmpresa: aguarda o intervalo quando próximo disparo é no futuro', async () => {
  const futuro = new Date(now.getTime() + 10 * 60_000).toISOString()
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [{ ...autoCfg, auto_proximo_disparo_em: futuro }] })]])
  const r = await _autoEmpresa(pool, 'e1', now, {})
  assert.equal(r.motivo, 'aguardando_intervalo')
})

test('_autoEmpresa: sem lead elegível não dispara', async () => {
  const pool = makePool([
    ['FROM app.banco_leads_config', () => ({ rows: [autoCfg] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
    ['FROM prospectador.prospects', () => ({ rows: [] })],
    ['FROM prospectador.lead_disparos', () => ({ rows: [{ hoje: 0 }] })],
  ])
  const r = await _autoEmpresa(pool, 'e1', now, {})
  assert.equal(r.motivo, 'sem_lead')
})

test('_autoEmpresa: dispara 1 lead e agenda o próximo', async () => {
  let agendouProximo = false
  const pool = makePool([
    ['FROM app.banco_leads_config', () => ({ rows: [autoCfg] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
    ['FROM prospectador.prospects', (sql) => {
      assert.match(sql, /NOT EXISTS/)
      assert.match(sql, /aguardando_disparo/)
      return { rows: [{ id: 'p1', telefone: '5511999999999' }] }
    }],
    ['FROM prospectador.lead_disparos', () => ({ rows: [{ hoje: 0 }] })],
    ['UPDATE app.banco_leads_config', () => { agendouProximo = true; return { rows: [] } }],
  ])
  let chamou = null
  const rodarLeadsFn = async (_pool, args) => { chamou = args; return { rodada: true, aceitos: [{ id: 'p1', nome: 'X' }], pulados: [] } }
  const canProspectLeadFn = async () => ({ allowed: true })
  const r = await _autoEmpresa(pool, 'e1', now, { rodarLeadsFn, canProspectLeadFn })
  assert.equal(r.motivo, 'disparado')
  assert.equal(r.lead_id, 'p1')
  assert.deepStrictEqual(chamou.prospectIds, ['p1'])
  assert.equal(chamou.instanciaId, 'i1')
  assert.ok(agendouProximo)
})

test('_autoEmpresa: avança quando o primeiro candidato falha na elegibilidade', async () => {
  const pool = makePool([
    ['FROM app.banco_leads_config', () => ({ rows: [autoCfg] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
    ['FROM prospectador.prospects', () => ({ rows: [
      { id: 'p-bloqueado', telefone: '551133334444' },
      { id: 'p-livre', telefone: '5511999999999' },
    ] })],
    ['FROM prospectador.lead_disparos', () => ({ rows: [{ hoje: 0 }] })],
    ['UPDATE app.banco_leads_config', () => ({ rows: [] })],
  ])
  const verificados = []
  const canProspectLeadFn = async (_pool, _telefone, options) => {
    verificados.push(options.prospectId)
    return { allowed: options.prospectId === 'p-livre' }
  }
  let escolhido = null
  const rodarLeadsFn = async (_pool, args) => {
    escolhido = args.prospectIds[0]
    return { rodada: true, aceitos: [{ id: escolhido }] }
  }

  const r = await _autoEmpresa(pool, 'e1', now, { rodarLeadsFn, canProspectLeadFn })

  assert.deepStrictEqual(verificados, ['p-bloqueado', 'p-livre'])
  assert.equal(escolhido, 'p-livre')
  assert.equal(r.motivo, 'disparado')
})

test('_autoEmpresa: teto diário atingido não dispara', async () => {
  const pool = makePool([
    ['FROM app.banco_leads_config', () => ({ rows: [{ ...autoCfg, teto_diario: 5 }] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
    ['FROM prospectador.lead_disparos', () => ({ rows: [{ hoje: 5 }] })],
  ])
  const r = await _autoEmpresa(pool, 'e1', now, {})
  assert.equal(r.motivo, 'teto_diario')
})

test('_semiEmpresa: gera pendentes usando a instância configurada', async () => {
  const pool = makePool([
    ['FROM app.banco_leads_config', () => ({ rows: [semiCfg] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
  ])
  let chamou = null
  const gerarPendentesSemiFn = async (_pool, args) => {
    chamou = args
    return { gerados: [{ prospect_id: 'p1', nome: 'Lead' }], pulados: [] }
  }
  const r = await _semiEmpresa(pool, 'e1', { gerarPendentesSemiFn })
  assert.equal(r.motivo, 'gerado')
  assert.equal(r.gerados, 1)
  assert.equal(chamou.instanciaId, 'i1')
  assert.equal(chamou.limit, 15)
})

test('verificarBancoLeadsSemi revisita a fila em cada tick e alcança leads novos', async () => {
  const pool = makePool([
    ['SELECT empresa_id FROM app.banco_leads_config', () => ({ rows: [{ empresa_id: 'e1' }] })],
    ['FROM app.banco_leads_config', () => ({ rows: [semiCfg] })],
    ['FROM app.empresa_whatsapp_instances', () => ({ rows: [{ id: 'i1', evolution_instance: 'inst' }] })],
  ])
  let tick = 0
  const gerarPendentesSemiFn = async () => {
    tick++
    return { gerados: [{ prospect_id: `p${tick}`, nome: `Lead ${tick}` }], pulados: [] }
  }

  const primeiro = await verificarBancoLeadsSemi(pool, { gerarPendentesSemiFn })
  const segundo = await verificarBancoLeadsSemi(pool, { gerarPendentesSemiFn })

  assert.equal(primeiro.resultados[0].gerados, 1)
  assert.equal(segundo.resultados[0].gerados, 1)
  assert.equal(tick, 2)
})

test('executarBancoLeadsWorkerTick impede reentrancia no mesmo processo', async () => {
  let liberarReconciliacao
  const espera = new Promise((resolve) => { liberarReconciliacao = resolve })
  let liberacoes = 0
  const deps = {
    replicaId: 'replica-test',
    adquirirLiderancaFn: async () => true,
    renovarLiderancaFn: async () => true,
    liberarLiderancaFn: async () => { liberacoes++ },
    reconciliarFn: async () => { await espera; return { verificados: 0 } },
    verificarSemiFn: async () => ({ ok: true }),
    verificarAutoFn: async () => ({ ok: true }),
  }
  const primeiro = executarBancoLeadsWorkerTick({}, now, deps)
  const segundo = await executarBancoLeadsWorkerTick({}, now, deps)
  assert.equal(segundo.motivo, 'tick_em_andamento')
  liberarReconciliacao()
  const final = await primeiro
  assert.equal(final.motivo, 'executado')
  assert.equal(liberacoes, 1)
})
