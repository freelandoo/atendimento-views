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
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api-relatorios.js'), 'utf8')
  assert.match(src, /FROM vendas\.ai_logs/)
  assert.doesNotMatch(src, /FROM vendas\.llm_chamadas/)
})
