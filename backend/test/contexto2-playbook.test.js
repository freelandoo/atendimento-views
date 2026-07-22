'use strict'

const assert = require('node:assert')
const test = require('node:test')

// ─── Stub do logger ──────────────────────────────────────────────────────────
require('../src/logger') // já existe

const {
  normalizarContexto1,
  validarContexto2Playbook,
  CONTEXTO1_CAMPOS,
} = require('../src/services/contexto-empresa')

// ─── Mocks ───────────────────────────────────────────────────────────────────
function mockPool({ queries = {} } = {}) {
  const calls = []
  const inserts = { sugestoes: [], lead_insights: [], lead_servico_decisoes: [], versoes: [] }
  return {
    calls, inserts,
    async query(sql, params) {
      calls.push({ sql, params })

      // Lookups específicos por padrão
      for (const [needle, handler] of Object.entries(queries)) {
        if (sql.includes(needle)) return handler({ sql, params, inserts })
      }

      // Defaults sensatos
      if (/INSERT INTO app\.empresa_contexto_sugestoes/i.test(sql)) {
        const row = { id: 'sug-' + (inserts.sugestoes.length + 1), status: 'pendente' }
        inserts.sugestoes.push({ params })
        return { rows: [row] }
      }
      if (/INSERT INTO app\.lead_insights/i.test(sql)) {
        const row = { id: 'li-1' }
        inserts.lead_insights.push({ params })
        return { rows: [row] }
      }
      if (/INSERT INTO app\.lead_servico_decisoes/i.test(sql)) {
        const row = { id: 'lsd-' + (inserts.lead_servico_decisoes.length + 1) }
        inserts.lead_servico_decisoes.push({ params })
        return { rows: [row] }
      }
      if (/SELECT \* FROM app\.lead_insights/i.test(sql)) {
        return { rows: [] }
      }
      if (/INSERT INTO app\.empresa_contexto_versoes/i.test(sql)) {
        const row = { id: 'v-1', versao: 1, status: 'rascunho', conteudo_json: {}, conteudo_markdown: '' }
        inserts.versoes.push({ params })
        return { rows: [row] }
      }
      if (/SELECT COALESCE\(MAX\(versao\)/i.test(sql)) {
        return { rows: [{ max_versao: 0 }] }
      }
      if (/SELECT id, nome, slug, plano FROM app\.empresas/i.test(sql)) {
        return { rows: [{ id: params[0], nome: 'Empresa Teste', slug: 'teste', plano: 'free' }] }
      }
      if (/SELECT id, nome, conteudo, contexto_form_json FROM app\.empresa_contextos/i.test(sql)) {
        return { rows: [{ id: params[0], nome: 'Ctx', conteudo: 'Lorem ipsum dolor sit amet consectetur '.repeat(2), contexto_form_json: {} }] }
      }
      return { rows: [] }
    }
  }
}

function mockAIProvider(textOut) {
  return {
    async generateAIResponse(_input) {
      return { text: typeof textOut === 'function' ? textOut() : textOut, provider: 'mock', model: 'mock' }
    },
  }
}

// ─── Testes ───────────────────────────────────────────────────────────────────

test('normalizarContexto1 cria form + texto', () => {
  const input = {
    nome_empresa: 'PJ Codeworks', tipo_negocio: 'Agência', nicho: 'Sites para empresas',
    cidade_regiao: 'Santo André', servicos_produtos: 'Sites institucionais',
  }
  const r = normalizarContexto1(input)
  assert.strictEqual(r.contexto_form_json.nome_empresa, 'PJ Codeworks')
  assert.ok(r.contexto_bruto.includes('NOME EMPRESA: PJ Codeworks'))
  // Garante que todos os campos esperados existam no form (vazios se não passados)
  for (const c of CONTEXTO1_CAMPOS) {
    assert.strictEqual(typeof r.contexto_form_json[c], 'string', `campo ${c} ausente`)
  }
})

test('validarContexto2Playbook preenche seções faltantes', () => {
  const j = validarContexto2Playbook({
    resumo_empresa: { nome: 'X' },
    servicos: [{ nome: 'site', descricao: 'd' }],
    // intencionalmente sem regras_orcamento, regras_reuniao, etc.
  })
  assert.strictEqual(j.schema_version, 'contexto2.playbook.v2')
  assert.strictEqual(j.resumo_empresa.nome, 'X')
  assert.ok(Array.isArray(j.servicos))
  assert.ok(j.regras_orcamento)
  assert.ok(j.regras_reuniao)
  assert.ok(j.objecoes)
  assert.ok(j.handoff)
  assert.ok(j.runtime_policy.fazer_uma_pergunta_por_vez === true)
})

test('gerarContexto2Playbook chama IA mockada e salva versão rascunho', async () => {
  const pool = mockPool()
  const fakeJson = {
    markdown: '# Playbook teste',
    json: { resumo_empresa: { nome: 'PJ' }, servicos: [{ nome: 'site' }] }
  }
  const ai = mockAIProvider(JSON.stringify(fakeJson))
  const { gerarContexto2Playbook } = require('../src/services/contexto-empresa')
  const r = await gerarContexto2Playbook({
    pool, log: console, empresaId: 'emp-1', contextoId: 'ctx-1', userId: 'u-1', aiProvider: ai,
  })
  assert.ok(r.json)
  assert.strictEqual(r.json.schema_version, 'contexto2.playbook.v2')
  assert.ok(r.markdown.startsWith('# Playbook'))
  assert.strictEqual(pool.inserts.versoes.length, 1)
})

test('extrairDadosDaMensagem aproveita resposta parcial', async () => {
  const pool = mockPool()
  const ai = mockAIProvider(JSON.stringify({
    intencao: 'diagnostico',
    dados_extraidos: { tipo_negocio: 'barbearia', bairro_ou_regiao: 'Rudge' },
    campos_coletados: ['tipo_negocio', 'bairro_ou_regiao'],
    campos_faltantes: ['cidade', 'objetivo', 'urgencia'],
    inferencias: [
      { campo: 'cidade', valor: 'Santo André', confianca: 'baixa', precisa_confirmar: true }
    ],
    temperatura: 'morno',
    score: 30,
    orcamento_status: 'nao_solicitado',
    reuniao_status: 'nao_oferecida',
    proxima_pergunta_sugerida: 'Em qual cidade fica a barbearia?',
  }))
  const { extrairDadosDaMensagem } = require('../src/services/contexto2-runtime')
  const r = await extrairDadosDaMensagem({
    pool, log: console, playbook: { json: { schema_version: 'contexto2.playbook.v2' } },
    historico: [], mensagem: 'Tenho uma barbearia no Rudge.',
    leadInsights: {}, empresaId: 'e', conversaId: 'c', leadPhone: '+55', aiProvider: ai,
  })
  assert.strictEqual(r.dados_extraidos.tipo_negocio, 'barbearia')
  assert.ok(r.campos_faltantes.includes('cidade'))
  assert.strictEqual(r.inferencias[0].confianca, 'baixa')
  assert.ok(r.proxima_pergunta_sugerida)
})

test('decidirRespostaComPlaybook gera mensagem e detecta handoff', async () => {
  const pool = mockPool()
  const ai = mockAIProvider(JSON.stringify({
    mensagem_pro_lead: 'Posso te ajudar — qual cidade?',
    etapa_proxima: 'diagnostico',
    atualizar_perfil: {},
    precisa_handoff: false,
    sugestao_aprendizado: null,
  }))
  const { decidirRespostaComPlaybook } = require('../src/services/contexto2-runtime')
  const d = await decidirRespostaComPlaybook({
    pool, log: console, playbook: { json: {} }, historico: [],
    mensagem: 'Tenho barbearia', leadInsights: {}, extracao: { campos_faltantes: ['cidade'] },
    empresaId: 'e', conversaId: 'c', leadPhone: '+55', aiProvider: ai,
  })
  assert.match(d.mensagem_pro_lead, /cidade/i)
  assert.strictEqual(d.precisa_handoff, false)
})

test('decidirRespostaComPlaybook normaliza servico escolhido pelo catalogo canonico', async () => {
  const pool = mockPool()
  const ai = mockAIProvider(JSON.stringify({
    mensagem_pro_lead: 'Para esse objetivo, eu comecaria por criacao de site.',
    etapa_proxima: 'diagnostico',
    atualizar_perfil: {},
    precisa_handoff: false,
    servico_recomendado_slug: 'criação de site',
    servico_oferecido_slug: '',
    motivo_decisao_servico: 'Lead quer melhorar presenca digital.',
    confianca_servico: 'alta',
    sugestao_aprendizado: null,
  }))
  const { decidirRespostaComPlaybook } = require('../src/services/contexto2-runtime')
  const d = await decidirRespostaComPlaybook({
    pool,
    log: console,
    playbook: {
      json: {
        servicos: [
          { id: '11111111-1111-4111-8111-111111111111', slug: 'seo', nome: 'SEO' },
          { id: '22222222-2222-4222-8222-222222222222', slug: 'criacao-de-site', nome: 'Criacao de site' },
          { id: '33333333-3333-4333-8333-333333333333', slug: 'sistemas', nome: 'Sistemas' },
        ],
      },
    },
    historico: [],
    mensagem: 'Quero um site para vender melhor',
    leadInsights: {},
    extracao: { servicos_interesse: ['site'], servicos_interesse_slugs: [] },
    empresaId: 'e',
    conversaId: 'c',
    leadPhone: '+55',
    aiProvider: ai,
  })

  assert.strictEqual(d.servico_recomendado_slug, 'criacao-de-site')
  assert.strictEqual(d.servico_recomendado_nome, 'Criacao de site')
  assert.strictEqual(d.atualizar_perfil.produto_sugerido, 'Criacao de site')
})

test('sugestao_aprendizado é salva como pendente, não altera contexto ativo', async () => {
  const pool = mockPool()
  const { talvezGerarSugestaoAprendizado } = require('../src/services/contexto2-runtime')
  const r = await talvezGerarSugestaoAprendizado({
    pool, log: console, empresaId: 'e', contextoVersaoId: 'v-1',
    conversaId: 'c', leadPhone: '+55',
    decisao: {
      sugestao_aprendizado: {
        tipo: 'objecao_nova',
        evidencia: 'Lead recusou por achar caro sem ver escopo',
        sugestao_markdown: 'Adicionar objeção "achei caro" com resposta de proposta de escopo mínimo',
        confianca: 'media',
      }
    },
  })
  assert.ok(r)
  assert.strictEqual(pool.inserts.sugestoes.length, 1)
  // Garante que nenhuma query de UPDATE em empresa_contexto_versoes status=ativo foi feita
  const danger = pool.calls.find((c) => /UPDATE app\.empresa_contexto_versoes/.test(c.sql))
  assert.strictEqual(danger, undefined, 'NUNCA atualizar versão a partir de sugestão')
})

test('atualizarLeadInsights faz merge seguro (não apaga dados anteriores)', async () => {
  const prev = {
    id: 'li-1',
    dados_extraidos: { tipo_negocio: 'barbearia', cidade: 'Santo André' },
    objecoes: ['preco_alto'], dores: [], servicos_interesse: [],
  }
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM app\.lead_insights/.test(sql)) return { rows: [prev] }
      if (/UPDATE app\.lead_insights/.test(sql)) {
        return { rows: [{ id: 'li-1' }] }
      }
      return { rows: [] }
    }
  }
  const { atualizarLeadInsights } = require('../src/services/contexto2-runtime')
  const r = await atualizarLeadInsights({
    pool, empresaId: 'e', conversaId: 'c', leadPhone: '+55',
    extracao: {
      dados_extraidos: { urgencia: 'esta_semana' }, // novo dado
      campos_coletados: ['tipo_negocio', 'urgencia'],
      campos_faltantes: ['orcamento'],
      objecoes_detectadas: ['preco_alto', 'nao_tem_tempo'],
      dores_detectadas: [],
      servicos_interesse: [],
      intencao: 'diagnostico', temperatura: 'quente',
      score: 70, orcamento_status: 'nao_solicitado', reuniao_status: 'nao_oferecida',
      proxima_melhor_acao: '', inferencias: [],
    },
  })
  // O merge deve preservar dados anteriores
  assert.strictEqual(r.dados_extraidos.tipo_negocio, 'barbearia')
  assert.strictEqual(r.dados_extraidos.urgencia, 'esta_semana')
  // Objeções viram set (sem duplicar)
  assert.deepStrictEqual([...new Set(r.objecoes)].sort(), ['nao_tem_tempo', 'preco_alto'])
})

test('registrarDecisoesServico grava eventos e snapshot da decisao de servico', async () => {
  const pool = mockPool()
  const { registrarDecisoesServico } = require('../src/services/contexto2-runtime')
  const r = await registrarDecisoesServico({
    pool,
    empresaId: '00000000-0000-0000-0000-000000000001',
    playbook: {
      contexto_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      versao_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      json: {
        servicos: [
          { id: '11111111-1111-4111-8111-111111111111', slug: 'seo', nome: 'SEO' },
          { id: '22222222-2222-4222-8222-222222222222', slug: 'criacao-de-site', nome: 'Criacao de site' },
        ],
      },
    },
    conversaId: 'c1',
    leadPhone: '5511999990000',
    mensagem: 'Preciso aparecer no Google e talvez criar site',
    extracao: { servicos_interesse_slugs: ['seo'] },
    decisao: {
      servico_recomendado_slug: 'seo',
      servico_recomendado_nome: 'SEO',
      servico_oferecido_slug: 'criacao-de-site',
      servico_oferecido_nome: 'Criacao de site',
      motivo_decisao_servico: 'Lead mencionou busca no Google e site.',
      confianca_servico: 'alta',
      mensagem_pro_lead: 'Podemos comecar por SEO e avaliar o site.',
    },
  })

  assert.strictEqual(r.eventos, 3)
  assert.strictEqual(pool.inserts.lead_servico_decisoes.length, 3)
  assert.ok(pool.calls.some((c) => /UPDATE app\.lead_insights/.test(c.sql) && /ultima_decisao_servico_json/.test(c.sql)))
})

test('contexto-servicos separa catalogo de ofertas em servicos distintos', () => {
  const { catalogoDasFontes } = require('../src/services/contexto-servicos')
  const servicos = catalogoDasFontes([
    {
      id: 'f1',
      tipo: 'site',
      url: 'https://exemplo.com',
      resumo_json: {
        catalogo_de_ofertas: [
          { nome: 'SEO', descricao: 'Otimização para buscadores', beneficios: ['Aparecer melhor no Google'] },
          { nome: 'Criação de site', descricao: 'Sites institucionais e landing pages' },
          { nome: 'Sistemas', descricao: 'Sistemas sob medida para operação' },
        ],
      },
    },
  ])

  assert.deepStrictEqual(servicos.map((s) => s.nome), ['SEO', 'Criação de site', 'Sistemas'])
  assert.deepStrictEqual(servicos.map((s) => s.slug), ['seo', 'criacao-de-site', 'sistemas'])
})

test('gerarContexto2Playbook injeta catalogo estruturado no playbook validado', async () => {
  const pool = mockPool()
  const ai = mockAIProvider(JSON.stringify({
    markdown: '# Playbook',
    json: { servicos: [{ nome: 'Misturado' }] },
  }))
  const { gerarContexto2Playbook } = require('../src/services/contexto-empresa')
  const r = await gerarContexto2Playbook({
    pool,
    log: console,
    empresaId: 'emp-1',
    contextoId: 'ctx-1',
    userId: 'u-1',
    aiProvider: ai,
    catalogoServicos: [
      { id: 's1', slug: 'seo', nome: 'SEO', descricao_curta: 'Otimização para buscadores', ativo: true },
      { id: 's2', slug: 'criacao-de-site', nome: 'Criação de site', descricao_curta: 'Sites institucionais', ativo: true },
      { id: 's3', slug: 'sistemas', nome: 'Sistemas', descricao_curta: 'Sistemas sob medida', ativo: true },
    ],
  })

  assert.deepStrictEqual(r.json.servicos.map((s) => s.nome), ['SEO', 'Criação de site', 'Sistemas'])
  assert.equal(r.json.catalogo_servicos_snapshot.total, 3)
  assert.match(r.json.informacoes_empresa, /SERVICOS ESTRUTURADOS/)
})
