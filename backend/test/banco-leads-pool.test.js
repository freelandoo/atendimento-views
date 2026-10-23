'use strict'
// POOL do modo Automático: rodízio entre as instâncias habilitadas, recusa por motivo DA
// INSTÂNCIA passando para a próxima do ciclo, e CONTINUIDADE do lead vencendo o rodízio.
//
// O que estes testes protegem, nesta ordem de gravidade:
//  1. lead que já fala com um número NUNCA é atendido por outro (nem quando o dele está fora);
//  2. uma instância fora do ar não custa o ciclo inteiro (antes, com 3 números e 1 caído,
//     1/3 dos ciclos virava nada);
//  3. o intervalo configurado é ENTRE CICLOS — o tempo até a MESMA instância voltar à vez
//     cresce com o tamanho do pool, e é isso que o rodízio tem de produzir.
const { test } = require('node:test')
const assert = require('node:assert')
const {
  _autoEmpresa, ordenarPoolAutomatico, escolherInstanciaAutomatico, erroDaInstancia,
} = require('../src/services/banco-leads-auto')

const CFG = {
  empresa_id: 'e1', modo: 'automatico', gerar_ia: false, instrucoes_ia: null,
  auto_ativo: true, janela_inicio: '08:00', janela_fim: '18:00',
  teto_diario: 0, intervalo_min: 20, intervalo_max: 20, auto_proximo_disparo_em: null,
  auto_recorte_modo: 'geral', auto_nicho: null,
}
const AGORA = new Date(2026, 0, 1, 10, 0, 0)
const VINCULO_SQL = 'BTRIM(evolution_instance) AS evolution_instance'

// Pool de teste: `handlers` tem precedência; o resto cai nos defaults abaixo.
function makePool(handlers = [], { instancias = [], prospects = [], vinculos = [] } = {}) {
  const updates = []
  return {
    updates,
    query: async (sql, params = []) => {
      for (const [needle, fn] of handlers) if (sql.includes(needle)) return fn(sql, params)
      if (sql.includes('FROM app.banco_leads_config')) return { rows: [CFG] }
      if (sql.includes('FROM app.empresa_whatsapp_instances')) return { rows: instancias }
      if (sql.includes('FROM prospectador.prospects')) return { rows: prospects }
      if (sql.includes(VINCULO_SQL)) return { rows: vinculos }
      if (sql.includes('UPDATE app.banco_leads_config')) { updates.push(params); return { rows: [] } }
      throw new Error('SQL nao mapeado: ' + String(sql).slice(0, 70))
    },
  }
}

function instancia(nome, ultimoDisparoEm = null, disparosHoje = 0) {
  return {
    id: 'id-' + nome,
    evolution_instance: nome,
    nome,
    disparos_hoje: disparosHoje,
    ultimo_disparo_em: ultimoDisparoEm,
  }
}
const permitido = async () => ({ allowed: true })

// ─── Rodízio: quem está descansado há mais tempo é a vez ──────────────────────────────

for (const n of [2, 3, 4]) {
  test('rodizio com ' + n + ' instancias: a vez e sempre da mais descansada', async () => {
    const nomes = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)) // A, B, C, D
    const ultimos = new Map(nomes.map((x) => [x, null]))
    const ordemUsada = []
    // Um ciclo a cada 20 min, como o intervalo configurado. Duas voltas completas.
    for (let ciclo = 0; ciclo < n * 2; ciclo++) {
      const agora = new Date(AGORA.getTime() + ciclo * 20 * 60000)
      const pool = makePool([], {
        instancias: nomes.map((x) => instancia(x, ultimos.get(x))),
        prospects: [{ id: 'p' + ciclo, telefone: '5511999999999' }],
      })
      const r = await _autoEmpresa(pool, 'e1', agora, {
        canProspectLeadFn: permitido,
        rodarLeadsFn: async () => ({ rodada: true, aceitos: [{ id: 'p' + ciclo }], pulados: [] }),
      })
      assert.equal(r.motivo, 'disparado')
      ordemUsada.push(r.evolution_instance)
      ultimos.set(r.evolution_instance, agora)
    }
    // 1ª volta: cada instância uma vez (nenhuma repete antes de todas trabalharem).
    assert.deepStrictEqual([...ordemUsada.slice(0, n)].sort(), [...nomes].sort(), ordemUsada.join(','))
    // 2ª volta: a mesma ordem da 1ª — a vez volta para quem esperou mais.
    assert.deepStrictEqual(ordemUsada.slice(n), ordemUsada.slice(0, n), ordemUsada.join(','))
    assert.equal(ordemUsada.length, n * 2)
  })
}

test('cooldown da instancia nao bloqueia o ciclo quando ha outra pronta', async () => {
  const quenteAgora = new Date(AGORA.getTime() - 60000) // disparou 1 min atrás
  const escolha = await escolherInstanciaAutomatico({ query: async () => ({ rows: [] }) }, 'e1', AGORA, CFG, {
    listarPoolAutomaticoFn: async () => ordenarPoolAutomatico(
      [instancia('A', quenteAgora), instancia('B', null)], AGORA, 0
    ),
  })
  assert.equal(escolha.motivo, 'ok')
  assert.equal(escolha.instancia.evolution_instance, 'B')
  // A fila existe e exclui quem está em cooldown.
  assert.deepStrictEqual(escolha.fila.map((i) => i.evolution_instance), ['B'])
})

// ─── Instância que recusa o ciclo ─────────────────────────────────────────────────────

test('instancia desconectada: o ciclo tenta a proxima do pool em vez de se perder', async () => {
  const pool = makePool([], {
    instancias: [instancia('A'), instancia('B')],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
  })
  const tentadas = []
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async (_p, args) => {
      tentadas.push(args.instanciaId)
      if (args.instanciaId === 'id-A') {
        const e = new Error('A instancia WhatsApp esta desconectada.')
        e.code = 'instance_disconnected'
        e.statusCode = 409
        throw e
      }
      return { rodada: true, aceitos: [{ id: 'p1' }], pulados: [] }
    },
  })
  assert.equal(r.motivo, 'disparado')
  assert.equal(r.evolution_instance, 'B')
  assert.deepStrictEqual(tentadas, ['id-A', 'id-B'])
  assert.equal(r.instancias_recusaram.length, 1)
})

test('teto/cooldown (429) tambem passa a vez para a proxima instancia', async () => {
  const pool = makePool([], {
    instancias: [instancia('A'), instancia('B')],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
  })
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async (_p, args) => {
      if (args.instanciaId === 'id-A') {
        const e = new Error('Teto diario atingido')
        e.statusCode = 429
        throw e
      }
      return { rodada: true, aceitos: [{ id: 'p1' }], pulados: [] }
    },
  })
  assert.equal(r.evolution_instance, 'B')
})

test('erro que NAO e da instancia encerra o ciclo sem tentar as outras', async () => {
  const pool = makePool([], {
    instancias: [instancia('A'), instancia('B')],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
  })
  const tentadas = []
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async (_p, args) => {
      tentadas.push(args.instanciaId)
      throw new Error('IA indisponivel') // vale igual em todas as instâncias
    },
  })
  assert.equal(r.motivo, 'erro')
  assert.deepStrictEqual(tentadas, ['id-A'], 'repetir a mesma falha em cada numero arrisca disparo duplo')
})

test('erroDaInstancia aceita so os estados DAQUELE numero', () => {
  assert.equal(erroDaInstancia({ code: 'instance_disconnected' }), true)
  assert.equal(erroDaInstancia({ code: 'INSTANCIA_NAO_COMPROVADA' }), true)
  assert.equal(erroDaInstancia({ instanciaBloqueada: true }), true)
  assert.equal(erroDaInstancia({ statusCode: 429 }), true)
  assert.equal(erroDaInstancia(new Error('IA fora do ar')), false)
  assert.equal(erroDaInstancia({ statusCode: 500 }), false)
  assert.equal(erroDaInstancia(null), false)
})

// ─── CONTINUIDADE: o vínculo vence o rodízio ──────────────────────────────────────────

test('lead ja vinculado sai pela instancia DELE, nao pela vez do rodizio', async () => {
  // A é a vez (nunca disparou); o lead já fala com B.
  const pool = makePool([], {
    instancias: [instancia('A'), instancia('B', new Date(AGORA.getTime() - 60 * 60000))],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
    vinculos: [{ numero: '5511999999999@s.whatsapp.net', evolution_instance: 'B' }],
  })
  const tentadas = []
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async (_p, args) => {
      tentadas.push(args.instanciaId)
      return { rodada: true, aceitos: [{ id: 'p1' }], pulados: [] }
    },
  })
  assert.equal(r.motivo, 'disparado')
  assert.equal(r.evolution_instance, 'B')
  assert.equal(r.continuidade, true)
  assert.deepStrictEqual(tentadas, ['id-B'])
})

test('instancia vinculada fora do pool: o lead e PULADO, nunca atendido por outro numero', async () => {
  // O lead fala com C, que não está no pool (inativa / sem saudação / desconectada).
  const pool = makePool([], {
    instancias: [instancia('A'), instancia('B')],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
    vinculos: [{ numero: '5511999999999@s.whatsapp.net', evolution_instance: 'C' }],
  })
  let enviou = false
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async () => { enviou = true; return { rodada: true, aceitos: [{ id: 'p1' }], pulados: [] } },
  })
  assert.equal(enviou, false, 'nenhum envio: trocar o numero quebraria o atendimento existente')
  assert.equal(r.motivo, 'sem_lead')
  assert.equal(r.motivos.instancia_vinculada_indisponivel, 1)
})

test('a varredura PULA o lead travado e segue para o proximo elegivel', async () => {
  const pool = makePool([], {
    instancias: [instancia('A')],
    prospects: [
      { id: 'travado', telefone: '5511888888888' }, // vinculado a C, fora do pool
      { id: 'livre', telefone: '5511777777777' },
    ],
    vinculos: [{ numero: '5511888888888@s.whatsapp.net', evolution_instance: 'C' }],
  })
  const r = await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async () => ({ rodada: true, aceitos: [{ id: 'livre' }], pulados: [] }),
  })
  assert.equal(r.motivo, 'disparado')
  assert.equal(r.lead_id, 'livre')
  assert.equal(r.continuidade, false)
})

test('isolamento: a consulta de vinculo e escopada na empresa', async () => {
  let sqlVinculo = ''
  const pool = makePool([
    [VINCULO_SQL, (sql, params) => {
      sqlVinculo = sql
      assert.equal(params[1], 'e1', 'a empresa entra na consulta de vinculo')
      return { rows: [] }
    }],
  ], {
    instancias: [instancia('A')],
    prospects: [{ id: 'p1', telefone: '5511999999999' }],
  })
  await _autoEmpresa(pool, 'e1', AGORA, {
    canProspectLeadFn: permitido,
    rodarLeadsFn: async () => ({ rodada: true, aceitos: [{ id: 'p1' }], pulados: [] }),
  })
  assert.match(sqlVinculo, /empresa_id = \$2::uuid OR empresa_id IS NULL/)
})

// ─── ESTADO REAL do automático (o painel) ─────────────────────────────────────────────

const { estadoAutomatico, contarCandidatosAutomatico } = require('../src/services/banco-leads-auto')

function depsEstado({ fila = [], todas = [], candidatos = 5, motivo = 'ok', total = null } = {}) {
  return {
    listarPoolAutomaticoFn: async () => fila,
    contarCandidatosFn: async () => candidatos,
    listarInstanciasDiagnosticoFn: async () => todas,
    __motivo: motivo,
    __total: total,
  }
}

test('estado: pronto quando ha instancia no rodizio e lead no recorte', async () => {
  const pool = makePool([], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({
    fila: [instancia('A')],
    todas: [{ id: 'id-A', evolution_instance: 'A', nome: 'Victor 2', ativo: true, principal: true, tem_saudacao: true, disparos_hoje: 0, ultimo_disparo_em: null }],
    candidatos: 7,
  }))
  assert.equal(d.estado, 'pronto')
  assert.equal(d.leads_candidatos, 7)
  assert.equal(d.instancias[0].no_rodizio, true)
  assert.equal(d.instancias[0].motivo_fora, null)
  assert.equal(d.instancias[0].nome, 'Victor 2')
})

test('estado: aguardando_intervalo tem precedencia, como no worker', async () => {
  const proximo = new Date(AGORA.getTime() + 12 * 60000)
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [{ ...CFG, auto_proximo_disparo_em: proximo }] })]], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({ fila: [instancia('A')] }))
  assert.equal(d.estado, 'aguardando_intervalo')
  assert.equal(d.segundos_para_proximo, 720)
})

test('estado: pausado quando auto_ativo e falso', async () => {
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [{ ...CFG, auto_ativo: false }] })]], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({ fila: [instancia('A')] }))
  assert.equal(d.estado, 'pausado')
})

test('estado: sem_instancia_pronta e explica por que cada numero esta fora', async () => {
  const pool = makePool([], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({
    fila: [],
    todas: [
      { id: 'id-A', evolution_instance: 'A', nome: 'A', ativo: false, tem_saudacao: true, disparos_hoje: 0, ultimo_disparo_em: null },
      { id: 'id-B', evolution_instance: 'B', nome: 'B', ativo: true, tem_saudacao: false, disparos_hoje: 0, ultimo_disparo_em: null },
    ],
  }))
  assert.equal(d.estado, 'sem_instancia_pronta')
  assert.equal(d.instancias.find((i) => i.id === 'id-A').motivo_fora, 'desativada')
  assert.equal(d.instancias.find((i) => i.id === 'id-B').motivo_fora, 'sem_saudacao')
})

test('estado: cooldown da instancia e explicado, nao escondido', async () => {
  const pool = makePool([], {})
  const quente = new Date(AGORA.getTime() - 60000)
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({
    fila: [],
    todas: [{ id: 'id-A', evolution_instance: 'A', nome: 'A', ativo: true, tem_saudacao: true, disparos_hoje: 1, ultimo_disparo_em: quente }],
  }))
  assert.equal(d.instancias[0].motivo_fora, 'aguardando_cooldown')
  assert.ok(d.instancias[0].cooldown_restante_s > 0)
})

test('estado: sem_lead_elegivel quando o recorte nao alcanca ninguem', async () => {
  const pool = makePool([], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({ fila: [instancia('A')], candidatos: 0 }))
  assert.equal(d.estado, 'sem_lead_elegivel')
})

test('estado: devolve o recorte de nicho que esta realmente valendo', async () => {
  const pool = makePool([['FROM app.banco_leads_config', () => ({ rows: [{ ...CFG, auto_recorte_modo: 'nicho', auto_nicho: 'desentupidora' }] })]], {})
  const d = await estadoAutomatico(pool, 'e1', AGORA, depsEstado({ fila: [instancia('A')] }))
  assert.deepStrictEqual(d.recorte, { modo: 'nicho', nicho: 'desentupidora' })
})

test('contarCandidatosAutomatico usa o MESMO recorte da varredura (nicho no WHERE)', async () => {
  let sqlVisto = ''
  let paramsVistos = null
  const pool = {
    query: async (sql, params) => { sqlVisto = sql; paramsVistos = params; return { rows: [{ total: 3 }] } },
  }
  const total = await contarCandidatosAutomatico(pool, 'e1', { auto_recorte_modo: 'nicho', auto_nicho: 'desentupidora' })
  assert.equal(total, 3)
  assert.match(sqlVisto, /categoria_perfil/)
  assert.match(sqlVisto, /NOT EXISTS/)
  assert.equal(paramsVistos[2], 'desentupidora')
})

test('sem nicho configurado, a contagem nao filtra nicho', async () => {
  let sqlVisto = ''
  const pool = { query: async (sql) => { sqlVisto = sql; return { rows: [{ total: 9 }] } } }
  await contarCandidatosAutomatico(pool, 'e1', { auto_recorte_modo: 'geral', auto_nicho: null })
  assert.ok(!sqlVisto.includes('categoria_perfil'), 'nicho vazio = carteira inteira do recorte geral')
})
