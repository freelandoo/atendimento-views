'use strict'
// Assistente de Oportunidades (por lead) — orquestração e SEGURANÇA.
//
// A propriedade mais importante continua sendo negativa: analisar, aprovar ou descartar
// NUNCA pode iniciar uma coleta paga. Todo teste roda com espião em `dispararBuscaMaps`
// e `pesquisarPlaces`, e o espião precisa terminar com ZERO chamadas.
//
// O resto cobre o que o operador percebe: a meta conta só lead NOVO aprovado, repetir a
// ação não duplica nada, descartar não importa, a fila continua depois de duplicado ou
// rejeição, e nenhum lead de outra empresa aparece.

const test = require('node:test')
const assert = require('node:assert/strict')

const placesBrightData = require('../src/services/places-brightdata')
const prospecting = require('../src/prospecting')
const {
  resumoSessao,
  iniciarSessao,
  decidirOportunidade,
  ampliarSessao,
  encerrarSessao,
  obterEstadoAtual,
  aplicarJustificativas,
  normalizarMeta,
  ESTADOS,
} = require('../src/services/aquisicao-curadoria')

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const OUTRA_EMPRESA = '22222222-2222-4222-8222-222222222222'
const USUARIO = '33333333-3333-4333-8333-333333333333'
const USUARIO_NULO = '00000000-0000-0000-0000-000000000000'

function vigiarColetaPaga() {
  const original = {
    disparar: placesBrightData.dispararBuscaMaps,
    pesquisar: prospecting.pesquisarPlaces,
  }
  const chamadas = []
  placesBrightData.dispararBuscaMaps = async (args) => { chamadas.push(['disparar', args]); return { snapshotId: 'nao-deveria' } }
  prospecting.pesquisarPlaces = async (args) => { chamadas.push(['pesquisar', args]); return {} }
  return {
    chamadas,
    restaurar() {
      placesBrightData.dispararBuscaMaps = original.disparar
      prospecting.pesquisarPlaces = original.pesquisar
    },
  }
}

const prospect = (over = {}) => ({
  id: 'p1',
  empresa_id: EMPRESA,
  nome: 'Clínica A',
  telefone: '+5519999990000',
  email: null,
  nicho: 'Dentista',
  cidade: 'Campinas - SP',
  endereco: 'Rua X, 1',
  site: null,
  tem_site: false,
  maps_url: null,
  rating: 4.5,
  avaliacoes: 80,
  status: 'aguardando',
  raw_json: {},
  created_at: '2026-08-01T10:00:00Z',
  ...over,
})

// Pool falso com transação real (BEGIN/COMMIT/ROLLBACK) e isolamento por empresa
// aplicado em TODA consulta: vazamento entre empresas vira teste vermelho.
function montarPool(estado = {}) {
  const dados = {
    prospects: [],
    sessoes: [],
    decisoes: [],
    ...estado,
  }
  let seq = 0
  const proximoId = (p) => `${p}-${++seq}`

  const sessaoAtiva = (empresaId, usuarioId) => dados.sessoes.find(
    (s) => s.empresa_id === empresaId
      && (s.usuario_id || USUARIO_NULO) === (usuarioId || USUARIO_NULO)
      && s.status === 'ativa'
  ) || null

  const casaMercado = (p, s) => {
    if (s.escopo_ampliado) return true
    if (s.nicho && String(p.nicho).toLowerCase() !== String(s.nicho).toLowerCase()) return false
    if (s.cidade && !String(p.cidade).toLowerCase().startsWith(String(s.cidade).toLowerCase())) return false
    return true
  }

  const query = async (sql, params = []) => {
    const texto = String(sql).replace(/\s+/g, ' ')

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(texto)) return { rows: [] }

    // ── curadoria_sessoes ──────────────────────────────────────────────────────
    if (/INSERT INTO prospectador\.curadoria_sessoes/i.test(texto)) {
      const [empresaId, usuarioId, nicho, cidade, uf, meta] = params
      if (sessaoAtiva(empresaId, usuarioId)) {
        const err = new Error('duplicate key'); err.code = '23505'; throw err
      }
      const s = {
        id: proximoId('s'), empresa_id: empresaId, usuario_id: usuarioId,
        nicho, cidade, uf, escopo_ampliado: false, meta,
        aprovados: 0, descartados: 0, fila_json: [], status: 'ativa',
        criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), encerrado_em: null,
      }
      dados.sessoes.push(s)
      return { rows: [{ ...s }] }
    }
    if (/UPDATE prospectador\.curadoria_sessoes SET fila_json/i.test(texto)) {
      const s = dados.sessoes.find((x) => x.empresa_id === params[0] && x.id === params[1] && x.status === 'ativa')
      if (!s) return { rows: [] }
      s.fila_json = JSON.parse(params[2])
      return { rows: [{ ...s }] }
    }
    if (/SET escopo_ampliado = true/i.test(texto)) {
      const s = dados.sessoes.find((x) => x.empresa_id === params[0] && x.id === params[1] && x.status === 'ativa')
      if (!s) return { rows: [] }
      s.escopo_ampliado = true
      s.fila_json = []
      return { rows: [{ ...s }] }
    }
    if (/UPDATE prospectador\.curadoria_sessoes SET status = \$3/i.test(texto)) {
      const s = dados.sessoes.find((x) => x.empresa_id === params[0] && x.id === params[1] && x.status === 'ativa')
      if (!s) return { rows: [] }
      s.status = params[2]
      s.encerrado_em = new Date().toISOString()
      return { rows: [{ ...s }] }
    }
    if (/UPDATE prospectador\.curadoria_sessoes SET aprovados = aprovados \+/i.test(texto)) {
      const [empresaId, sessaoId, incA, incD, fila] = params
      const s = dados.sessoes.find((x) => x.empresa_id === empresaId && x.id === sessaoId)
      if (!s) return { rows: [] }
      s.aprovados += incA
      s.descartados += incD
      s.fila_json = JSON.parse(fila)
      if (s.aprovados >= s.meta) { s.status = 'concluida'; s.encerrado_em = new Date().toISOString() }
      return { rows: [{ ...s }] }
    }
    if (/FROM prospectador\.curadoria_sessoes/i.test(texto) && /FOR UPDATE/i.test(texto)) {
      const s = dados.sessoes.find((x) => x.empresa_id === params[0] && x.id === params[1])
      return { rows: s ? [{ ...s }] : [] }
    }
    if (/FROM prospectador\.curadoria_sessoes/i.test(texto) && /status = 'ativa'/i.test(texto)) {
      const s = sessaoAtiva(params[0], params[2])
      return { rows: s ? [{ ...s }] : [] }
    }
    if (/FROM prospectador\.curadoria_sessoes/i.test(texto) && /status <> 'ativa'/i.test(texto)) {
      return { rows: dados.sessoes.filter((s) => s.empresa_id === params[0] && s.status !== 'ativa').map((s) => ({ ...s })) }
    }
    if (/FROM prospectador\.curadoria_sessoes/i.test(texto)) {
      const s = dados.sessoes.find((x) => x.empresa_id === params[0] && x.id === params[1])
      return { rows: s ? [{ ...s }] : [] }
    }

    // ── curadoria_decisoes ─────────────────────────────────────────────────────
    if (/INSERT INTO prospectador\.curadoria_decisoes/i.test(texto)) {
      const [empresaId, sessaoId, prospectId, decisao, contou, justificativa, caracteristicas, usuarioId] = params
      const repetida = dados.decisoes.some((d) => d.sessao_id === sessaoId && d.prospect_id === prospectId)
      if (repetida) return { rows: [] }
      const d = {
        id: proximoId('d'), empresa_id: empresaId, sessao_id: sessaoId, prospect_id: prospectId,
        decisao, contou_meta: contou, justificativa,
        caracteristicas: JSON.parse(caracteristicas), usuario_id: usuarioId,
        criado_em: new Date().toISOString(),
      }
      dados.decisoes.push(d)
      return { rows: [{ id: d.id }] }
    }
    if (/FROM prospectador\.curadoria_decisoes/i.test(texto)) {
      return {
        rows: dados.decisoes
          .filter((d) => d.empresa_id === params[0])
          .map((d) => ({ decisao: d.decisao, caracteristicas: d.caracteristicas })),
      }
    }

    // ── prospects ──────────────────────────────────────────────────────────────
    if (/UPDATE prospectador\.prospects SET status/i.test(texto)) {
      const [empresaId, id, statusNovo] = params
      const p = dados.prospects.find((x) => x.empresa_id === empresaId && x.id === id && x.status === 'aguardando')
      if (!p) return { rows: [] }
      p.status = statusNovo
      return { rows: [{ id: p.id, nome: p.nome, status: p.status }] }
    }
    if (/SELECT COUNT\(\*\)::int AS total FROM prospectador\.prospects/i.test(texto)) {
      const s = sessaoAtiva(params[0], null) || dados.sessoes.find((x) => x.empresa_id === params[0])
      const total = dados.prospects.filter(
        (p) => p.empresa_id === params[0] && p.status === 'aguardando' && (!s || casaMercado(p, s))
      ).length
      return { rows: [{ total }] }
    }
    if (/FROM prospectador\.prospects/i.test(texto)) {
      const empresaId = params[0]
      const s = dados.sessoes.find((x) => x.empresa_id === empresaId && x.status === 'ativa')
      return {
        rows: dados.prospects
          .filter((p) => p.empresa_id === empresaId && p.status === 'aguardando' && (!s || casaMercado(p, s)))
          .map((p) => ({ ...p })),
      }
    }

    throw new Error(`SQL não roteado no teste: ${texto.slice(0, 120)}`)
  }

  return {
    dados,
    query,
    connect: async () => ({ query, release() {} }),
  }
}

// Provider de IA falso. `falhar` reproduz o caminho em que a explicação não vem.
function aiFake({ falhar = false, motivo = 'Vale a pena: negócio ativo e sem site.' } = {}) {
  const chamadas = []
  return {
    chamadas,
    modeloAuxiliarAtivo: () => 'modelo-teste',
    async generateAIResponse(args) {
      chamadas.push(args)
      if (falhar) throw new Error('IA indisponível')
      const itens = JSON.parse(args.userPrompt.replace(/^Leads:\n/, ''))
      return { text: JSON.stringify({ itens: itens.map((i) => ({ ref: i.ref, motivo })) }) }
    },
  }
}

const ctx = (extra = {}) => ({ empresaId: EMPRESA, usuarioId: USUARIO, ...extra })

test('normalizarMeta mantém a meta dentro do que a coleta consegue entregar', () => {
  assert.equal(normalizarMeta(0), 1)
  assert.equal(normalizarMeta(999), 200)
  assert.equal(normalizarMeta('25'), 25)
  assert.equal(normalizarMeta(undefined), 10)
})

test('abrir a sessão monta a fila e explica a oportunidade — sem tocar na coleta paga', async () => {
  const espiao = vigiarColetaPaga()
  try {
    const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2', nome: 'Clínica B' })] })
    const ai = aiFake()
    const r = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', uf: 'SP', meta: 2, deps: { aiProvider: ai } })

    assert.equal(r.estado, ESTADOS.ANALISANDO)
    assert.equal(r.sessao.meta, 2)
    assert.equal(r.sessao.aprovados, 0)
    assert.ok(r.oportunidade)
    assert.equal(r.oportunidade.motivo, 'Vale a pena: negócio ativo e sem site.')
    // Uma chamada de IA para o LOTE inteiro, não uma por lead.
    assert.equal(ai.chamadas.length, 1)
  } finally {
    assert.deepEqual(espiao.chamadas, [], 'nenhuma coleta paga pode ser iniciada')
    espiao.restaurar()
  }
})

test('o prompt da IA não recebe nome, telefone, e-mail nem endereço do lead', async () => {
  const pool = montarPool({ prospects: [prospect({ nome: 'Clínica Segredo', telefone: '+5519911112222', email: 'x@y.com', endereco: 'Rua Confidencial, 9' })] })
  const ai = aiFake()
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 1, deps: { aiProvider: ai } })

  const enviado = JSON.stringify(ai.chamadas[0])
  assert.ok(!enviado.includes('Clínica Segredo'))
  assert.ok(!enviado.includes('19911112222'))
  assert.ok(!enviado.includes('x@y.com'))
  assert.ok(!enviado.includes('Confidencial'))
})

test('IA fora do ar não trava a sessão: a oportunidade sai com o motivo das regras', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  const r = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 1, deps: { aiProvider: aiFake({ falhar: true }) } })
  assert.equal(r.estado, ESTADOS.ANALISANDO)
  assert.ok(r.oportunidade.motivo.length > 0)
  assert.notEqual(r.oportunidade.motivo, '')
})

test('clicar duas vezes no botão não abre duas sessões', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  const deps = { aiProvider: aiFake() }
  const a = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })
  const b = await iniciarSessao(pool, { ...ctx(), nicho: 'Outro', cidade: 'Outra', meta: 99, deps })

  assert.equal(a.sessao.id, b.sessao.id)
  assert.equal(b.reaproveitada, true)
  assert.equal(b.sessao.meta, 5, 'a segunda chamada não redefine a meta em andamento')
  assert.equal(pool.dados.sessoes.length, 1)
})

test('aprovar um lead novo importa para a carteira e consome exatamente 1 da meta', async () => {
  const espiao = vigiarColetaPaga()
  try {
    const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
    const deps = { aiProvider: aiFake() }
    await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 2, deps })

    const r = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })
    assert.equal(r.decisao.contou_meta, true)
    assert.equal(r.decisao.ja_decidido, false)
    assert.equal(r.sessao.aprovados, 1)
    assert.equal(pool.dados.prospects.find((p) => p.id === 'p1').status, 'aprovado')
    // A oportunidade da vez avança sozinha.
    assert.equal(r.oportunidade.prospect_id, 'p2')
  } finally {
    assert.deepEqual(espiao.chamadas, [])
    espiao.restaurar()
  }
})

test('repetir a mesma aprovação não duplica nem consome a meta de novo', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })

  await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })
  const repetida = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })

  assert.equal(repetida.decisao.contou_meta, false)
  assert.equal(repetida.decisao.repetida, true)
  assert.equal(repetida.decisao.ja_decidido, true)
  assert.equal(repetida.sessao.aprovados, 1, 'a meta continua em 1')
  assert.equal(pool.dados.decisoes.length, 1, 'só um registro de decisão')
})

test('lead já decidido fora do assistente não conta para a meta', async () => {
  // Cenário real: o operador aprovou o lead pela lista antes de abrir a sessão.
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })

  pool.dados.prospects.find((p) => p.id === 'p1').status = 'aprovado'
  const r = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })

  assert.equal(r.decisao.contou_meta, false)
  assert.equal(r.decisao.ja_decidido, true)
  assert.equal(r.sessao.aprovados, 0)
})

test('descartar não importa o lead, mas fica registrado como sinal', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })

  const r = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'descartado', deps })

  assert.equal(r.decisao.contou_meta, false)
  assert.equal(r.sessao.aprovados, 0)
  assert.equal(r.sessao.descartados, 1)
  assert.equal(pool.dados.prospects.find((p) => p.id === 'p1').status, 'rejeitado')

  const registro = pool.dados.decisoes[0]
  assert.equal(registro.decisao, 'descartado')
  assert.ok(registro.caracteristicas.site, 'o sinal guarda as características do lead')
  assert.ok(registro.justificativa, 'guarda o que foi mostrado ao operador')
})

test('a sessão continua depois de descartes até bater a meta de NOVOS aprovados', async () => {
  const pool = montarPool({
    prospects: [prospect({ id: 'p1' }), prospect({ id: 'p2' }), prospect({ id: 'p3' }), prospect({ id: 'p4' })],
  })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 2, deps })

  await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'descartado', deps })
  const meio = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p2', decisao: 'aprovado', deps })
  assert.equal(meio.estado, ESTADOS.ANALISANDO, 'com 1 de 2 aprovados a sessão segue')

  const fim = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p3', decisao: 'aprovado', deps })
  assert.equal(fim.sessao.aprovados, 2)
  assert.equal(fim.sessao.status, 'concluida')
  assert.equal(fim.estado, ESTADOS.CONCLUIDA)
  assert.ok(/Meta atingida/i.test(fim.mensagem))
  assert.equal(fim.oportunidade, null)
  assert.equal(pool.dados.prospects.find((p) => p.id === 'p4').status, 'aguardando', 'o resto continua intocado')
})

test('sem candidatos, o assistente sugere ampliar em vez de encerrar no vazio', async () => {
  const pool = montarPool({ prospects: [prospect({ nicho: 'Padaria', cidade: 'Sorocaba - SP' })] })
  const deps = { aiProvider: aiFake() }
  const r = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 3, deps })

  assert.equal(r.estado, ESTADOS.SEM_CANDIDATOS)
  assert.equal(r.ampliar_disponivel, true)
  assert.ok(/ampliar/i.test(r.mensagem))

  const ampliada = await ampliarSessao(pool, { ...ctx(), deps })
  assert.equal(ampliada.estado, ESTADOS.ANALISANDO)
  assert.equal(ampliada.oportunidade.nicho, 'Padaria', 'ampliar alcança o resto da carteira')
  assert.equal(ampliada.sessao.escopo_ampliado, true)
})

// Estado provável logo depois de uma busca guiada: o mercado é novo e a coleta (que leva
// minutos) ainda não chegou. Dizer "você já decidiu todos" aí seria mentira.
test('mercado ainda sem leads não é anunciado como fila já decidida', async () => {
  const pool = montarPool({ prospects: [prospect({ nicho: 'Padaria', cidade: 'Sorocaba - SP' })] })
  const r = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 3, deps: { aiProvider: aiFake() } })

  assert.equal(r.estado, ESTADOS.SEM_CANDIDATOS)
  assert.ok(/Ainda não há leads/i.test(r.mensagem), r.mensagem)
  assert.ok(/alguns minutos/i.test(r.mensagem), 'a coleta é assíncrona e a tela precisa dizer isso')
  assert.ok(!/já decidiu/i.test(r.mensagem))
  assert.equal(r.ampliar_disponivel, true)
})

test('fila realmente esgotada continua dizendo que já foi tudo decidido', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })
  const r = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'descartado', deps })

  assert.equal(r.estado, ESTADOS.SEM_CANDIDATOS)
  assert.ok(/já decidiu todos/i.test(r.mensagem), r.mensagem)
})

test('sessão ampliada e esgotada orienta a buscar mais leads, sem oferecer ampliar de novo', async () => {
  const pool = montarPool({ prospects: [] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 3, deps })
  const r = await ampliarSessao(pool, { ...ctx(), deps })

  assert.equal(r.estado, ESTADOS.SEM_CANDIDATOS)
  assert.equal(r.ampliar_disponivel, false)
  assert.ok(/nova busca/i.test(r.mensagem))
})

test('nenhum lead de outra empresa entra na fila', async () => {
  const pool = montarPool({
    prospects: [
      prospect({ id: 'meu' }),
      prospect({ id: 'alheio', empresa_id: OUTRA_EMPRESA, nome: 'Da Outra Empresa' }),
    ],
  })
  const deps = { aiProvider: aiFake() }
  const r = await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })
  assert.equal(r.oportunidade.prospect_id, 'meu')

  // E a decisão sobre um lead de outra empresa não altera nada.
  const alheia = await decidirOportunidade(pool, { ...ctx(), prospectId: 'alheio', decisao: 'aprovado', deps })
  assert.equal(alheia.decisao.contou_meta, false)
  assert.equal(pool.dados.prospects.find((p) => p.id === 'alheio').status, 'aguardando')
})

test('decidir sem sessão aberta é recusado com orientação, não com erro genérico', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  await assert.rejects(
    () => decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado' }),
    (err) => {
      assert.equal(err.statusCode, 409)
      assert.ok(/Analisar oportunidades/i.test(err.message))
      return true
    }
  )
  assert.equal(pool.dados.prospects[0].status, 'aguardando')
})

test('recarregar a página retoma a sessão sem gerar explicação de novo', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
  const ai = aiFake()
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps: { aiProvider: ai } })
  assert.equal(ai.chamadas.length, 1)

  const retomada = await obterEstadoAtual(pool, { ...ctx(), deps: { aiProvider: ai } })
  assert.equal(retomada.estado, ESTADOS.ANALISANDO)
  assert.equal(retomada.oportunidade.prospect_id, 'p1')
  assert.equal(ai.chamadas.length, 1, 'a fila persistida não é regerada')
})

test('encerrar fecha a sessão e preserva o que já foi decidido', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2' })] })
  const deps = { aiProvider: aiFake() }
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps })
  await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })

  const fim = await encerrarSessao(pool, ctx())
  assert.equal(fim.sessao.status, 'encerrada')
  assert.ok(/1 lead/i.test(fim.mensagem))
  assert.equal(pool.dados.prospects.find((p) => p.id === 'p1').status, 'aprovado')

  const depois = await obterEstadoAtual(pool, { ...ctx(), deps })
  assert.equal(depois.sessao, null)
  assert.equal(depois.historico.length, 1)
})

test('duas sessões de operadores diferentes não disputam o mesmo lead', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  const deps = { aiProvider: aiFake() }
  const outroUsuario = '44444444-4444-4444-8444-444444444444'

  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 3, deps })
  await iniciarSessao(pool, { ...ctx({ usuarioId: outroUsuario }), nicho: 'Dentista', cidade: 'Campinas', meta: 3, deps })
  assert.equal(pool.dados.sessoes.length, 2)

  const a = await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps })
  const b = await decidirOportunidade(pool, { ...ctx({ usuarioId: outroUsuario }), prospectId: 'p1', decisao: 'aprovado', deps })

  assert.equal(a.decisao.contou_meta, true)
  assert.equal(b.decisao.contou_meta, false, 'o segundo não pode contar o mesmo lead')
  assert.equal(b.decisao.ja_decidido, true)
})

// ── Resumo (menu guiado do botão premium) ───────────────────────────────────────
// O menu de entrada precisa saber onde o operador parou. Ele NÃO pode pagar por isso:
// montar fila chama a IA, e abrir um menu não é motivo para gastar.

test('resumo sem sessão devolve vazio, sem chamar a IA e sem tocar na coleta paga', async () => {
  const espiao = vigiarColetaPaga()
  try {
    const pool = montarPool({ prospects: [prospect()] })
    const r = await resumoSessao(pool, ctx())
    assert.equal(r.sessao, null)
    assert.equal(r.fila_pendente, 0)
    assert.deepEqual(r.historico, [])
  } finally {
    assert.deepEqual(espiao.chamadas, [], 'nenhuma coleta paga pode ser iniciada')
    espiao.restaurar()
  }
})

test('resumo mostra a sessão em andamento com mercado e progresso reais', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2', nome: 'Clínica B' })] })
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', uf: 'SP', meta: 3, deps: { aiProvider: aiFake() } })
  await decidirOportunidade(pool, { ...ctx(), prospectId: 'p1', decisao: 'aprovado', deps: { aiProvider: aiFake() } })

  const r = await resumoSessao(pool, ctx())
  assert.equal(r.sessao.nicho, 'Dentista')
  assert.equal(r.sessao.cidade, 'Campinas')
  assert.equal(r.sessao.uf, 'SP')
  assert.equal(r.sessao.meta, 3)
  assert.equal(r.sessao.aprovados, 1)
  assert.equal(r.sessao.status, 'ativa')
})

test('resumo NÃO monta fila e NÃO chama a IA — abrir o menu não custa chamada paga', async () => {
  const pool = montarPool({ prospects: [prospect(), prospect({ id: 'p2', nome: 'Clínica B' })] })
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 5, deps: { aiProvider: aiFake() } })
  // Esvazia a fila persistida: é exatamente o estado em que `obterEstadoAtual` pagaria
  // uma nova explicação. O resumo não pode fazer o mesmo.
  pool.dados.sessoes[0].fila_json = []

  const ai = aiFake()
  const r = await resumoSessao(pool, { ...ctx(), deps: { aiProvider: ai } })
  assert.equal(ai.chamadas.length, 0, 'o resumo não pode chamar a IA')
  assert.equal(r.fila_pendente, 0)
  assert.equal(r.sessao.status, 'ativa')
})

test('resumo não enxerga a sessão de outro operador nem de outra empresa', async () => {
  const pool = montarPool({ prospects: [prospect()] })
  await iniciarSessao(pool, { ...ctx(), nicho: 'Dentista', cidade: 'Campinas', meta: 2, deps: { aiProvider: aiFake() } })

  const outroOperador = await resumoSessao(pool, ctx({ usuarioId: '44444444-4444-4444-8444-444444444444' }))
  assert.equal(outroOperador.sessao, null, 'a sessão é pessoal')

  const outraEmpresa = await resumoSessao(pool, { empresaId: OUTRA_EMPRESA, usuarioId: USUARIO })
  assert.equal(outraEmpresa.sessao, null, 'nada atravessa a fronteira de empresa')
  assert.deepEqual(outraEmpresa.historico, [])
})

test('resumo exige empresa', async () => {
  const pool = montarPool()
  await assert.rejects(() => resumoSessao(pool, { empresaId: null }), /Empresa não informada/)
})

test('justificativa inválida da IA não derruba o item — só mantém o motivo das regras', () => {
  const itens = [
    { prospect_id: 'a', motivo: 'motivo base A', origem_texto: 'regra' },
    { prospect_id: 'b', motivo: 'motivo base B', origem_texto: 'regra' },
  ]
  const { itens: saida, redigidos } = aplicarJustificativas(itens, JSON.stringify({
    itens: [
      { ref: 0, motivo: '  Boa oportunidade.  ' },
      { ref: 1, motivo: '' },
      { ref: 99, motivo: 'fora do intervalo' },
    ],
  }))
  assert.equal(redigidos, 1)
  assert.equal(saida[0].motivo, 'Boa oportunidade.')
  assert.equal(saida[0].origem_texto, 'ia')
  assert.equal(saida[1].motivo, 'motivo base B')
  assert.equal(saida[1].origem_texto, 'regra')
})

test('resposta da IA que não é JSON deixa a fila inteira com o motivo das regras', () => {
  const itens = [{ prospect_id: 'a', motivo: 'motivo base', origem_texto: 'regra' }]
  const { itens: saida, redigidos } = aplicarJustificativas(itens, 'desculpe, não consegui')
  assert.equal(redigidos, 0)
  assert.equal(saida[0].motivo, 'motivo base')
})
