'use strict'
// Assistente de Oportunidades — orquestração e SEGURANÇA.
//
// A propriedade mais importante do módulo é negativa: analisar ou aprovar NUNCA pode
// iniciar uma coleta paga. Por isso todo teste aqui roda com um espião em
// `dispararBuscaMaps` (a única porta paga da Bright Data) e em `pesquisarPlaces`, e o
// espião precisa terminar com ZERO chamadas.
//
// O resto cobre: isolamento por empresa, rotina aprovada nascendo PAUSADA, edição do
// admin vencendo a proposta da IA, dispensa que não reaparece e dados insuficientes.

const test = require('node:test')
const assert = require('node:assert/strict')

const placesBrightData = require('../src/services/places-brightdata')
const prospecting = require('../src/prospecting')
const {
  analisarOportunidades,
  aplicarSugestao,
  dispensarSugestao,
  aplicarRedacao,
  montarPayloadRotina,
  ESTADOS,
} = require('../src/services/aquisicao-assistente')

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const OUTRA_EMPRESA = '22222222-2222-4222-8222-222222222222'
const AGORA = new Date('2026-06-23T13:00:00Z')

// Instala os espiões da porta paga. Devolve o contador e o restaurador.
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

// Pool falso: roteia por trecho do SQL e SEMPRE filtra pelo empresa_id recebido, para
// que um vazamento entre empresas apareça como teste vermelho, não como suposição.
function montarPool(estado = {}) {
  const dados = {
    rotinas: [],
    snapshots: [],
    prospects: [],
    sugestoes: [],
    config: { empresa_id: EMPRESA },
    ...estado,
  }
  const consultas = []
  let seq = 0

  const query = async (sql, params = []) => {
    const texto = String(sql)
    consultas.push({ texto, params })

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(texto)) return { rows: [] }

    if (/MAX\(criado_em\) AS ultima/i.test(texto)) {
      const minhas = dados.sugestoes.filter((s) => s.empresa_id === params[0])
      const ultima = minhas.length
        ? minhas.map((s) => new Date(s.criado_em)).sort((a, b) => b - a)[0].toISOString()
        : null
      return { rows: [{ ultima }] }
    }

    if (/FROM prospectador\.aquisicao_rotinas/i.test(texto) && /^\s*SELECT/i.test(texto)) {
      const daEmpresa = dados.rotinas.filter((r) => r.empresa_id === params[0])
      if (/AND id = \$2/i.test(texto)) return { rows: daEmpresa.filter((r) => r.id === params[1]) }
      return { rows: daEmpresa }
    }

    if (/FROM prospectador\.busca_snapshots/i.test(texto)) {
      return { rows: dados.snapshots.filter((s) => s.empresa_id === params[0]) }
    }

    if (/FROM prospectador\.prospects/i.test(texto)) {
      return { rows: dados.prospects.filter((p) => p.empresa_id === params[0]) }
    }

    if (/FROM prospectador\.prospeccao_configuracoes/i.test(texto)) {
      return { rows: dados.config.empresa_id === params[0] ? [dados.config] : [] }
    }
    if (/INSERT INTO prospectador\.prospeccao_configuracoes/i.test(texto)) return { rows: [] }

    if (/SELECT DISTINCT assinatura/i.test(texto)) {
      return {
        rows: dados.sugestoes
          .filter((s) => s.empresa_id === params[0] && ['aprovada', 'dispensada'].includes(s.status))
          .map((s) => ({ assinatura: s.assinatura })),
      }
    }

    if (/INSERT INTO prospectador\.aquisicao_sugestoes/i.test(texto)) {
      const [empresa_id, tipo, rotina_id, nicho, cidade, uf, parametros, titulo, motivo, impacto,
        evidencias, confianca, prioridade, assinatura, origem_texto] = params
      // Honra o índice único parcial (empresa_id, assinatura) WHERE status='pendente'.
      const colide = dados.sugestoes.some(
        (s) => s.empresa_id === empresa_id && s.assinatura === assinatura && s.status === 'pendente'
      )
      if (colide) return { rows: [] }
      const linha = {
        id: `sug-${++seq}`, empresa_id, tipo, rotina_id, nicho, cidade, uf,
        parametros: JSON.parse(parametros), titulo, motivo, impacto,
        evidencias: JSON.parse(evidencias), confianca, prioridade, assinatura,
        origem_texto, status: 'pendente', criado_em: AGORA.toISOString(),
      }
      dados.sugestoes.push(linha)
      return { rows: [linha] }
    }

    if (/UPDATE prospectador\.aquisicao_sugestoes/i.test(texto) && /SET status = \$3/i.test(texto)) {
      const [empresaId, id, status, usuarioId, nota] = params
      const alvo = dados.sugestoes.find(
        (s) => s.empresa_id === empresaId && s.id === id && s.status === 'pendente'
      )
      if (!alvo) return { rows: [] }
      Object.assign(alvo, { status, decidido_por: usuarioId, decidido_em: AGORA.toISOString(), decisao_nota: nota })
      return { rows: [alvo] }
    }
    if (/UPDATE prospectador\.aquisicao_sugestoes/i.test(texto)) {
      const alvo = dados.sugestoes.find((s) => s.empresa_id === params[0] && s.id === params[1])
      if (alvo) alvo.rotina_resultante_id = params[2]
      return { rows: alvo ? [alvo] : [] }
    }

    if (/SELECT[\s\S]*FROM prospectador\.aquisicao_sugestoes/i.test(texto)) {
      const minhas = dados.sugestoes.filter((s) => s.empresa_id === params[0])
      if (/AND id = \$2/i.test(texto)) return { rows: minhas.filter((s) => s.id === params[1]) }
      return { rows: minhas }
    }

    if (/INSERT INTO prospectador\.aquisicao_rotinas/i.test(texto)) {
      const [empresa_id, nicho, cidade, uf, dias_semana, janela_inicio, janela_fim,
        intervalo_horas, quantidade, ativo, estadoRotina] = params
      const linha = {
        id: `rot-nova-${++seq}`, empresa_id, nicho, cidade, uf, dias_semana,
        janela_inicio, janela_fim, intervalo_horas, quantidade, ativo, estado: estadoRotina,
      }
      dados.rotinas.push(linha)
      return { rows: [linha] }
    }

    if (/UPDATE prospectador\.aquisicao_rotinas/i.test(texto)) {
      const alvo = dados.rotinas.find((r) => r.empresa_id === params[0] && r.id === params[1])
      if (!alvo) return { rows: [] }
      // Só o toggle de ativar/pausar usa $3 booleano; a edição completa manda o cadastro.
      if (/SET ativo = \$3/i.test(texto)) Object.assign(alvo, { ativo: params[2] })
      else {
        Object.assign(alvo, {
          nicho: params[2], cidade: params[3], uf: params[4], dias_semana: params[5],
          janela_inicio: params[6], janela_fim: params[7], intervalo_horas: params[8],
          quantidade: params[9], ativo: params[10],
        })
      }
      return { rows: [alvo] }
    }

    throw new Error(`SQL não previsto no teste: ${texto.slice(0, 90)}`)
  }

  return {
    query,
    connect: async () => ({ query, release() {} }),
    _dados: dados,
    _consultas: consultas,
  }
}

// IA que redige: devolve o texto reescrito para todos os candidatos recebidos.
function iaRedatora(registro = []) {
  return {
    modeloAuxiliarAtivo: () => 'gpt-4o-mini',
    generateAIResponse: async (input) => {
      registro.push(input)
      const itens = JSON.parse(input.userPrompt.replace(/^Recomendações:\n/, ''))
      return {
        text: JSON.stringify({
          itens: itens.map((i) => ({ ref: i.ref, titulo: 'Título humano', motivo: 'Motivo em português simples.', impacto: 'Impacto claro.' })),
        }),
      }
    },
  }
}

const rotinaSaturada = {
  id: 'rot-sat', empresa_id: EMPRESA, nicho: 'dentista', cidade: 'Campinas', uf: 'SP',
  ativo: true, estado: 'concluida', falhas_consecutivas: 0, intervalo_horas: 6, quantidade: 200,
  dias_semana: [1, 2, 3, 4, 5], janela_inicio: '08:00', janela_fim: '18:00',
}
const snapshotsSaturados = [
  { empresa_id: EMPRESA, rotina_id: 'rot-sat', status: 'concluido', coletados: 100, novos: 3, created_at: AGORA.toISOString() },
  { empresa_id: EMPRESA, rotina_id: 'rot-sat', status: 'concluido', coletados: 100, novos: 2, created_at: AGORA.toISOString() },
]

test('assistente: analisar NÃO inicia coleta paga e gera sugestão explicada', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({ rotinas: [rotinaSaturada], snapshots: snapshotsSaturados })
  const chamadasIA = []
  const r = await analisarOportunidades(pool, {
    empresaId: EMPRESA,
    agora: AGORA,
    deps: { aiProvider: iaRedatora(chamadasIA), selecionarMercado: async () => null },
  })

  assert.equal(espiao.chamadas.length, 0, 'nenhuma chamada paga pode sair de uma análise')
  assert.equal(r.estado, ESTADOS.SUGESTAO)
  assert.equal(r.sugestoes.length, 1)
  assert.equal(r.sugestoes[0].tipo, 'pausar_rotina')
  assert.equal(r.sugestoes[0].origem_texto, 'ia')
  assert.equal(r.sugestoes[0].motivo, 'Motivo em português simples.')
  // Custo de IA precisa ficar rastreado no tenant certo (página Uso & Custo).
  assert.equal(chamadasIA[0].empresaId, EMPRESA)
})

test('assistente: IA fora do ar não derruba a análise — sai o texto das regras', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({ rotinas: [rotinaSaturada], snapshots: snapshotsSaturados })
  const iaQuebrada = {
    modeloAuxiliarAtivo: () => 'gpt-4o-mini',
    generateAIResponse: async () => { throw new Error('provider fora do ar') },
  }
  const r = await analisarOportunidades(pool, {
    empresaId: EMPRESA, agora: AGORA,
    deps: { aiProvider: iaQuebrada, selecionarMercado: async () => null },
  })

  assert.equal(espiao.chamadas.length, 0)
  assert.equal(r.sugestoes.length, 1)
  assert.equal(r.sugestoes[0].origem_texto, 'regra')
  assert.match(r.sugestoes[0].motivo, /leads novos/i)
})

test('assistente: dados de outra empresa nunca entram na análise', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({
    rotinas: [rotinaSaturada],
    snapshots: snapshotsSaturados,
    config: { empresa_id: EMPRESA },
  })
  const r = await analisarOportunidades(pool, {
    empresaId: OUTRA_EMPRESA, agora: AGORA,
    deps: { aiProvider: iaRedatora(), selecionarMercado: async () => null },
  })

  assert.equal(r.estado, ESTADOS.SEM_DADOS, 'empresa sem dados próprios não herda os da vizinha')
  assert.equal(r.sugestoes.length, 0)
  // Toda consulta de dados foi escopada pela empresa pedida.
  const semEscopo = pool._consultas.filter(
    (c) => /FROM prospectador\.(prospects|busca_snapshots|aquisicao_rotinas|aquisicao_sugestoes)/i.test(c.texto)
      && c.params[0] !== OUTRA_EMPRESA
  )
  assert.deepEqual(semEscopo, [], 'nenhuma consulta pode rodar fora do escopo da empresa')
})

test('assistente: sem rotinas, sem coletas e sem leads → "sem dados suficientes"', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool()
  const r = await analisarOportunidades(pool, {
    empresaId: EMPRESA, agora: AGORA,
    deps: { aiProvider: iaRedatora(), selecionarMercado: async () => ({ nicho: 'x', cidade: 'y' }) },
  })
  assert.equal(r.estado, ESTADOS.SEM_DADOS)
  assert.equal(r.sugestoes.length, 0)
  assert.equal(espiao.chamadas.length, 0)
})

test('assistente: análise repetida respeita o cooldown (não gasta IA à toa)', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({ rotinas: [rotinaSaturada], snapshots: snapshotsSaturados })
  const deps = { aiProvider: iaRedatora(), selecionarMercado: async () => null }
  await analisarOportunidades(pool, { empresaId: EMPRESA, agora: AGORA, deps })

  await assert.rejects(
    () => analisarOportunidades(pool, { empresaId: EMPRESA, agora: new Date(AGORA.getTime() + 60000), deps }),
    (err) => err.statusCode === 429 && /análise foi feita há pouco/i.test(err.message)
  )
})

test('assistente: sugestão dispensada não volta a aparecer sem mudança material', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({ rotinas: [rotinaSaturada], snapshots: snapshotsSaturados })
  const deps = { aiProvider: iaRedatora(), selecionarMercado: async () => null }
  const primeira = await analisarOportunidades(pool, { empresaId: EMPRESA, agora: AGORA, deps })
  await dispensarSugestao(pool, { empresaId: EMPRESA, sugestaoId: primeira.sugestoes[0].id })

  const depois = new Date(AGORA.getTime() + (60 * 60000))
  const segunda = await analisarOportunidades(pool, { empresaId: EMPRESA, agora: depois, deps })
  assert.equal(segunda.sugestoes.length, 0)
  assert.equal(segunda.estado, ESTADOS.SEM_NOVIDADE)

  // Mudança MATERIAL (o mercado voltou a render leads novos) devolve recomendação —
  // agora outra, coerente com a nova evidência.
  pool._dados.snapshots = [
    { empresa_id: EMPRESA, rotina_id: 'rot-sat', status: 'concluido', coletados: 100, novos: 20, created_at: AGORA.toISOString() },
    { empresa_id: EMPRESA, rotina_id: 'rot-sat', status: 'concluido', coletados: 100, novos: 22, created_at: AGORA.toISOString() },
  ]
  const terceira = await analisarOportunidades(pool, {
    empresaId: EMPRESA, agora: new Date(AGORA.getTime() + (120 * 60000)), deps,
  })
  assert.equal(terceira.sugestoes.length, 1)
  assert.equal(terceira.sugestoes[0].tipo, 'ajustar_rotina')
  assert.equal(espiao.chamadas.length, 0)
})

test('assistente: aprovar "criar rotina" cria a rotina PAUSADA e não dispara coleta', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({
    prospects: [{ empresa_id: EMPRESA }],
    sugestoes: [{
      id: 'sug-1', empresa_id: EMPRESA, tipo: 'criar_rotina', rotina_id: null,
      nicho: 'clínica odontológica', cidade: 'Campinas', uf: 'SP',
      parametros: { dias_semana: [1, 2, 3, 4, 5], janela_inicio: '08:00', janela_fim: '18:00', intervalo_horas: 24, quantidade: 200 },
      titulo: 't', motivo: 'm', evidencias: {}, confianca: 70, prioridade: 90,
      assinatura: 'criar_rotina|mkt:x', status: 'pendente', criado_em: AGORA.toISOString(),
    }],
  })

  const { sugestao, rotina } = await aplicarSugestao(pool, { empresaId: EMPRESA, sugestaoId: 'sug-1', usuarioId: null })

  assert.equal(espiao.chamadas.length, 0, 'aprovar não pode iniciar coleta')
  assert.equal(sugestao.status, 'aprovada')
  assert.equal(rotina.ativo, false, 'a rotina aprovada NASCE PAUSADA')
  assert.equal(rotina.estado, 'pausada')
  assert.equal(rotina.nicho, 'clínica odontológica')
  assert.equal(pool._dados.rotinas.length, 1, 'cria exatamente uma rotina')
})

test('assistente: a edição do admin vence a proposta da IA (inclusive tentando ativar)', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({
    sugestoes: [{
      id: 'sug-1', empresa_id: EMPRESA, tipo: 'criar_rotina', rotina_id: null,
      nicho: 'dentista', cidade: 'Campinas', uf: 'SP',
      parametros: { dias_semana: [1, 2, 3, 4, 5], janela_inicio: '08:00', janela_fim: '18:00', intervalo_horas: 24, quantidade: 200 },
      titulo: 't', motivo: 'm', evidencias: {}, confianca: 70, prioridade: 90,
      assinatura: 'a', status: 'pendente', criado_em: AGORA.toISOString(),
    }],
  })

  const { rotina } = await aplicarSugestao(pool, {
    empresaId: EMPRESA,
    sugestaoId: 'sug-1',
    ajustes: { cidade: 'Sorocaba', uf: 'SP', quantidade: 50, intervalo_horas: 48, ativo: true },
  })

  assert.equal(rotina.cidade, 'Sorocaba')
  assert.equal(rotina.quantidade, 50)
  assert.equal(rotina.intervalo_horas, 48)
  assert.equal(rotina.ativo, false, 'nem o formulário pode ativar na aprovação')
  assert.equal(espiao.chamadas.length, 0)
})

test('assistente: aprovar "pausar" pausa só a rotina alvo; aprovar duas vezes é bloqueado', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const outra = { ...rotinaSaturada, id: 'rot-outra', nicho: 'pet shop', ativo: true }
  const pool = montarPool({
    rotinas: [{ ...rotinaSaturada }, outra],
    sugestoes: [{
      id: 'sug-1', empresa_id: EMPRESA, tipo: 'pausar_rotina', rotina_id: 'rot-sat',
      nicho: 'dentista', cidade: 'Campinas', uf: 'SP', parametros: {},
      titulo: 't', motivo: 'm', evidencias: {}, confianca: 70, prioridade: 85,
      assinatura: 'a', status: 'pendente', criado_em: AGORA.toISOString(),
    }],
  })

  const { rotina } = await aplicarSugestao(pool, { empresaId: EMPRESA, sugestaoId: 'sug-1' })
  assert.equal(rotina.id, 'rot-sat')
  assert.equal(rotina.ativo, false)
  assert.equal(pool._dados.rotinas.find((r) => r.id === 'rot-outra').ativo, true, 'a outra rotina não pode ser tocada')

  await assert.rejects(
    () => aplicarSugestao(pool, { empresaId: EMPRESA, sugestaoId: 'sug-1' }),
    (err) => err.statusCode === 409
  )
  assert.equal(espiao.chamadas.length, 0)
})

test('assistente: sugestão de OUTRA empresa não pode ser aprovada nem dispensada', async (t) => {
  const espiao = vigiarColetaPaga()
  t.after(() => espiao.restaurar())

  const pool = montarPool({
    sugestoes: [{
      id: 'sug-1', empresa_id: OUTRA_EMPRESA, tipo: 'pausar_rotina', rotina_id: 'rot-x',
      nicho: 'dentista', cidade: 'Campinas', uf: 'SP', parametros: {},
      titulo: 't', motivo: 'm', evidencias: {}, confianca: 70, prioridade: 85,
      assinatura: 'a', status: 'pendente', criado_em: AGORA.toISOString(),
    }],
  })

  await assert.rejects(
    () => aplicarSugestao(pool, { empresaId: EMPRESA, sugestaoId: 'sug-1' }),
    (err) => err.statusCode === 404
  )
  await assert.rejects(
    () => dispensarSugestao(pool, { empresaId: EMPRESA, sugestaoId: 'sug-1' }),
    (err) => err.statusCode === 404
  )
  assert.equal(pool._dados.sugestoes[0].status, 'pendente', 'a sugestão alheia fica intacta')
  assert.equal(espiao.chamadas.length, 0)
})

test('assistente: redação inválida da IA é ignorada item a item (texto da regra sobrevive)', () => {
  const candidatos = [
    { titulo: 'Regra A', motivo: 'Motivo A', impacto: 'Impacto A' },
    { titulo: 'Regra B', motivo: 'Motivo B', impacto: 'Impacto B' },
  ]
  const { candidatos: saida, redigidos } = aplicarRedacao(candidatos, JSON.stringify({
    itens: [
      { ref: 0, titulo: 'Novo A', motivo: 'Explicação nova.' },
      { ref: 1, titulo: '', motivo: '' },              // sem texto → mantém a regra
      { ref: 99, titulo: 'Fantasma', motivo: 'x' },     // fora do intervalo → ignorado
    ],
  }))
  assert.equal(redigidos, 1)
  assert.equal(saida[0].titulo, 'Novo A')
  assert.equal(saida[0].origem_texto, 'ia')
  assert.equal(saida[1].titulo, 'Regra B', 'candidato sem redação válida mantém o texto determinístico')
  assert.equal(saida.length, 2, 'a IA não pode inventar recomendações novas')
})

test('assistente: resposta não-JSON da IA preserva todos os textos determinísticos', () => {
  const candidatos = [{ titulo: 'Regra A', motivo: 'Motivo A' }]
  const { redigidos, candidatos: saida } = aplicarRedacao(candidatos, 'desculpe, não consegui')
  assert.equal(redigidos, 0)
  assert.equal(saida[0].titulo, 'Regra A')
})

test('assistente: payload da rotina usa a proposta e deixa o admin sobrescrever', () => {
  const sugestao = {
    nicho: 'dentista', cidade: 'Campinas', uf: 'SP',
    parametros: { dias_semana: [1, 2, 3], janela_inicio: '09:00', janela_fim: '17:00', intervalo_horas: 24, quantidade: 200 },
  }
  assert.deepEqual(montarPayloadRotina(sugestao).dias_semana, [1, 2, 3])
  const editado = montarPayloadRotina(sugestao, { quantidade: 30, dias_semana: [6] })
  assert.equal(editado.quantidade, 30)
  assert.deepEqual(editado.dias_semana, [6])
  assert.equal(editado.nicho, 'dentista', 'campo não editado mantém a proposta')
})
