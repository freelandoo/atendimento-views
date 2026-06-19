'use strict'

const assert = require('node:assert')
const test = require('node:test')

require('../src/logger')

// Carrega os prompts-base da PJ do disco (no boot real isto roda no index.js).
// Sem isto, estagiosPjReferencia() volta vazio e a geração não chama a IA.
const prompts = require('../src/prompts')
prompts.loadSystemCorePrompt()
prompts.loadSystemPrimeiroContatoPrompt()
prompts.loadSystemDiagnosticoPrompt()
prompts.loadSystemPropostaPrompt()
prompts.loadSystemObjecaoPrompt()
prompts.loadSystemFechamentoPrompt()

const estagiosSvc = require('../src/services/contexto-estagios')
const frameworks = require('../src/services/geracao-frameworks')
const { gerarTudo, refinarEstagiosComFrameworks, rederivarOuLimpar } = require('../src/services/geracao-completa')

// ─── Provider de geração fake: responde por task ──────────────────────────────
function fakeGenProvider({ respostas = {} } = {}) {
  const calls = []
  return {
    calls,
    async generateAIResponse(input) {
      calls.push({ task: input.task, model: input.model, provider: input.provider })
      const r = respostas[input.task]
      if (r != null) return { text: r }
      switch (input.task) {
        case 'mergeContext1FromSources': return { text: '{}' }
        case 'gerarEstagioGenerico': return { text: 'GENERICO' }
        case 'adaptarEstagio': return { text: 'ADAPTADO' }
        case 'refinarEstagioVendas': return { text: 'REFINADO' }
        case 'generateContextPlaybook': return { text: '{"json":{},"markdown":"ok"}' }
        default: return { text: '{}' }
      }
    },
  }
}

// ─── 1) Frameworks: estrutura esperada ────────────────────────────────────────
test('frameworks: mapa cobre as 6 etapas e há guardrail ético', () => {
  for (const chave of estagiosSvc.CHAVES_ETAPA) {
    assert.ok(frameworks.MAPA_POR_ETAPA[chave], `falta técnica para a etapa ${chave}`)
  }
  assert.match(frameworks.REFINO_SYSTEM, /HONESTA|honesto|ÉTICO/i)
  assert.match(frameworks.GUARDRAIL_ETICO, /NUNCA invente/i)
  assert.match(frameworks.FRAMEWORKS_VENDA, /SPIN/)
})

// ─── 2) Refino aplica frameworks nas 6 etapas e degrada sem quebrar ───────────
test('refinarEstagiosComFrameworks: refina as 6 e mantém original quando IA volta vazio', async () => {
  const genProvider = fakeGenProvider()
  const base = estagiosSvc.normalizarEstagios({
    nucleo: 'n', primeiro_contato: 'pc', diagnostico: 'dg',
    proposta: 'pp', objecao: 'ob', fechamento: 'fc',
  })
  const out = await refinarEstagiosComFrameworks({
    genProvider, pool: {}, log: null, empresaId: 'e1', contextoId: 'c1',
    estagios: base, conhecimento: 'empresa de sites',
  })
  for (const chave of estagiosSvc.CHAVES_ETAPA) assert.equal(out[chave], 'REFINADO')

  // IA devolvendo vazio → mantém o texto original (não apaga o estágio).
  const genVazio = fakeGenProvider({ respostas: { refinarEstagioVendas: '   ' } })
  const out2 = await refinarEstagiosComFrameworks({
    genProvider: genVazio, pool: {}, log: null, empresaId: 'e1', contextoId: 'c1',
    estagios: base, conhecimento: 'x',
  })
  assert.equal(out2.nucleo, 'n')
  assert.equal(out2.fechamento, 'fc')
})

// ─── mockPool para o fluxo gerarTudo ──────────────────────────────────────────
function mockPool() {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      const has = (s) => sql.includes(s)

      if (has("status <> 'analisado'")) return { rows: [] }                 // 1) fontes pendentes
      if (has("status = 'analisado'")) return { rows: [{ id: 'f1', tipo: 'link', url: 'https://x.com', filename: null, titulo: 't', resumo_json: {} }] }
      if (has('UPDATE app.empresa_contextos') && has('contexto_form_json = $3')) return { rows: [] } // 2) persist contexto1
      if (has('UPDATE app.empresa_contextos') && has('estagios_json = $3')) {  // 5) salvar estágios
        return { rows: [{ id: params[0], estagios_json: JSON.parse(params[2]), runtime_ativo: false }] }
      }
      if (has('estagios_json, runtime_ativo, thumbnail_url')) {              // getContextoComEstagios
        return { rows: [{ id: params[0], empresa_id: params[1], nome: 'Ctx', conteudo: '', contexto_form_json: { servicos: 'Sites e sistemas sob medida' }, estagios_json: {}, runtime_ativo: false, thumbnail_url: null }] }
      }
      if (has('SELECT id, contexto_form_json FROM app.empresa_contextos')) { // sugerir: ctx atual
        return { rows: [{ id: params[0], contexto_form_json: {} }] }
      }
      if (has('FROM app.empresas')) return { rows: [{ id: params[0], nome: 'Empresa', slug: 'emp', plano: 'free' }] }
      if (has('SELECT id, nome, conteudo, contexto_form_json FROM app.empresa_contextos')) { // playbook ctx
        return { rows: [{ id: params[0], nome: 'Ctx', conteudo: '', contexto_form_json: { servicos: 'Sites e sistemas sob medida' } }] }
      }
      if (has('MAX(versao)')) return { rows: [{ max_versao: 0 }] }
      if (has('INSERT INTO app.empresa_contexto_versoes')) return { rows: [{ id: 'v-1', versao: 1, status: 'rascunho', conteudo_json: {}, conteudo_markdown: 'ok' }] }
      return { rows: [] }
    },
  }
}

// ─── 3) gerarTudo: encadeia tudo e retorna estágios refinados + playbook ──────
test('gerarTudo: encadeia Contexto 1 → estágios refinados → playbook (com gen provider injetado)', async () => {
  estagiosSvc.invalidarGenericoCache() // determinístico: força chamar o provider nos genéricos
  const pool = mockPool()
  const genProvider = fakeGenProvider()

  const out = await gerarTudo({
    pool, log: null, empresaId: 'e1', contextoId: 'c1', userId: 'u1', aiProvider: genProvider,
  })

  // estágios salvos = refinados nas 6 etapas
  for (const chave of estagiosSvc.CHAVES_ETAPA) assert.equal(out.estagios[chave], 'REFINADO')

  // playbook (rascunho) criado
  assert.equal(out.playbook.versao, 1)
  assert.equal(out.playbook.versao_id, 'v-1')

  // contexto 1 aplicado (mesclado e persistido)
  assert.ok(out.contexto1 && typeof out.contexto1 === 'object')

  // passos registrados na ordem esperada
  const etapas = out.passos.map((p) => p.etapa)
  assert.ok(etapas.includes('estagios_salvos'))
  assert.ok(etapas.includes('playbook'))
  assert.ok(etapas.includes('estagios_refinados'))

  // usou o provider de geração para os passos criativos
  const tasks = genProvider.calls.map((c) => c.task)
  assert.ok(tasks.includes('refinarEstagioVendas'))
  assert.ok(tasks.includes('generateContextPlaybook'))
})

// ─── 4) rederivarOuLimpar: sem fontes restantes → limpa Contexto 1/estágios + arquiva playbook
test('rederivarOuLimpar: sem fontes, limpa derivados e arquiva o playbook ativo', async () => {
  const sqls = []
  const pool = {
    async query(sql, params) {
      sqls.push(sql)
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }] }
      return { rows: [], params }
    },
  }
  const out = await rederivarOuLimpar({ pool, log: null, empresaId: 'e1', contextoId: 'c1' })
  assert.deepEqual(out, { limpo: true })
  assert.ok(sqls.some((s) => /UPDATE app\.empresa_contextos[\s\S]*contexto_form_json = '\{\}'/.test(s)))
  assert.ok(sqls.some((s) => /UPDATE app\.empresa_contexto_versoes[\s\S]*'arquivado'/.test(s)))
})
