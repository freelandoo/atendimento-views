const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('gerarRelatorioIA repassa empresaId para o log de uso do provider', async () => {
  const aiPath = require.resolve('../src/ai-provider')
  const relatorioPath = require.resolve('../src/services/relatorio')
  const originalAi = require.cache[aiPath]
  const originalRelatorio = require.cache[relatorioPath]
  let captured = null

  require.cache[aiPath] = {
    id: aiPath,
    filename: aiPath,
    loaded: true,
    exports: {
      generateReport: async (args) => {
        captured = args
        return { text: 'ok', provider: 'openai', model: 'gpt-4o-mini' }
      },
    },
  }
  delete require.cache[relatorioPath]

  try {
    const { gerarRelatorioIA } = require('../src/services/relatorio')
    const out = await gerarRelatorioIA({}, {
      empresaId: '00000000-0000-0000-0000-000000000001',
      tipo: 'geral',
      dados: { conversas: 1 },
    })

    assert.equal(out.texto, 'ok')
    assert.equal(captured.empresaId, '00000000-0000-0000-0000-000000000001')
    assert.equal(captured.refType, undefined)
  } finally {
    if (originalAi) require.cache[aiPath] = originalAi
    else delete require.cache[aiPath]
    if (originalRelatorio) require.cache[relatorioPath] = originalRelatorio
    else delete require.cache[relatorioPath]
  }
})

test('resumo de relatorios usa ai_logs, a mesma fonte do painel Uso & Custo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'relatorio.js'), 'utf8')
  assert.match(src, /FROM vendas\.ai_logs/)
  assert.doesNotMatch(src, /FROM vendas\.llm_chamadas/)
})

test('rota /resumo reusa coletarDadosRelatorio em vez de duplicar as queries', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-relatorios.js'), 'utf8')
  assert.match(src, /coletarDadosRelatorio\(pool, req\.empresa\.id\)/)
  assert.doesNotMatch(src, /FROM vendas\.conversas/)
})

test('coletarDadosRelatorio inclui temperatura e llm_30d (a mesma analise via IA usa)', async () => {
  const { coletarDadosRelatorio } = require('../src/services/relatorio')
  const queries = []
  const poolFake = {
    async query(sql, params) {
      queries.push(sql)
      if (/FROM vendas\.conversas WHERE empresa_id = \$1`?$/m.test(sql) || /AS ativas/.test(sql)) {
        return { rows: [{ ativas: '1', fechadas: '0', arquivadas: '0', total: '1' }] }
      }
      if (/GROUP BY estagio/.test(sql)) return { rows: [{ estagio: 'diagnostico', total: '1' }] }
      if (/FROM vendas\.followup_envios/.test(sql)) return { rows: [{ enviados: '0', respondidos: '0' }] }
      if (/FROM vendas\.ai_logs/.test(sql)) return { rows: [{ chamadas: '2', input_tokens: '10', output_tokens: '5', latencia_media_ms: '100' }] }
      if (/FROM vendas\.lead_profiles/.test(sql)) return { rows: [{ quente: '1', morno: '0', frio: '0', prontos_handoff: '1' }] }
      return { rows: [] }
    },
  }
  const data = await coletarDadosRelatorio(poolFake, '00000000-0000-0000-0000-000000000001')
  assert.equal(data.temperatura.quente, '1')
  assert.equal(data.llm_30d.chamadas, '2')
  assert.equal(queries.length, 5)
})
