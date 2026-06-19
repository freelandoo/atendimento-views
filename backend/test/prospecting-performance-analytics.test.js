'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarPeriodo,
  montarFiltrosWhere,
  obterDashboardEstrategicoProspeccao,
} = require('../src/services/prospecting-performance-analytics')

function fakePoolAnalytics() {
  const calls = []
  const rankingRows = {
    categoria: [
      { chave: 'restaurante', total_itens: 6, mensagens_enviadas: 4, falhas: 1, respostas: 2, diagnostico: 2, proposta: 1, reunioes: 1, fechados: 1 },
      { chave: 'barbearia', total_itens: 3, mensagens_enviadas: 2, falhas: 0, respostas: 1, diagnostico: 1, proposta: 0, reunioes: 0, fechados: 0 },
    ],
    cidade: [
      { chave: 'Salvador/BA', total_itens: 5, mensagens_enviadas: 4, falhas: 0, respostas: 2, diagnostico: 2, proposta: 1, reunioes: 1, fechados: 1 },
    ],
    modo: [
      { chave: 'automatico', total_itens: 4, mensagens_enviadas: 3, falhas: 1, respostas: 2, diagnostico: 1, proposta: 1, reunioes: 1, fechados: 1 },
    ],
    horario: [
      { chave: '09:00', total_itens: 3, mensagens_enviadas: 3, falhas: 0, respostas: 2, diagnostico: 1, proposta: 1, reunioes: 1, fechados: 1 },
    ],
  }
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params })
      if (/GROUP BY COALESCE\(f\.categoria, p\.nicho/i.test(sql)) return { rows: rankingRows.categoria }
      if (/GROUP BY CONCAT_WS/i.test(sql)) return { rows: rankingRows.cidade }
      if (/GROUP BY COALESCE\(e\.modo/i.test(sql)) return { rows: rankingRows.modo }
      if (/GROUP BY COALESCE\(to_char\(f\.slot_envio/i.test(sql)) return { rows: rankingRows.horario }
      if (/COALESCE\(f\.slot_envio::date, f\.criado_em::date\) AS dia/i.test(sql)) {
        return { rows: [
          { dia: '2026-05-01', enviados: 3, respostas: 1, falhas: 0 },
          { dia: '2026-05-02', enviados: 4, respostas: 2, falhas: 1 },
        ] }
      }
      return {
        rows: [{
          total_itens: 8,
          mensagens_enviadas: 5,
          falhas: 2,
          respostas: 2,
          diagnostico: 2,
          proposta: 1,
          reunioes: 1,
          fechados: 1,
        }],
      }
    },
  }
}

test('normalizarPeriodo usa janela padrao de 30 dias quando inicio nao vem', () => {
  const p = normalizarPeriodo({ fim: '2026-05-24' })
  assert.deepEqual(p, { inicio: '2026-04-25', fim: '2026-05-24' })
})

test('montarFiltrosWhere monta periodo e filtros estrategicos', () => {
  const f = montarFiltrosWhere({
    inicio: '2026-05-01',
    fim: '2026-05-24',
    categoria: 'restaurante',
    cidade: 'Salvador',
    estado: 'ba',
    modo: 'automatico',
    status: 'respondido',
  })
  assert.deepEqual(f.params, ['2026-05-01', '2026-05-24', '%restaurante%', '%Salvador%', 'BA', 'automatico', 'respondido'])
  assert.match(f.whereSql, /COALESCE\(f\.categoria, p\.nicho/)
  assert.match(f.whereSql, /COALESCE\(f\.cidade, p\.cidade/)
  assert.match(f.whereSql, /UPPER\(COALESCE\(f\.estado/)
  assert.match(f.whereSql, /e\.modo/)
  assert.match(f.whereSql, /f\.status = \$7 OR c\.estagio = \$7/)
})

test('dashboard estrategico retorna metricas, rankings e custo por oportunidade', async () => {
  const pool = fakePoolAnalytics()
  const r = await obterDashboardEstrategicoProspeccao(pool, {
    inicio: '2026-05-01',
    fim: '2026-05-24',
    categoria: 'restaurante',
    cidade: 'Salvador',
    estado: 'BA',
    modo: 'automatico',
    status: 'respondido',
    custo_total: '300',
  })
  assert.equal(r.ok, true)
  assert.equal(r.metricas.mensagens_enviadas, 5)
  assert.equal(r.metricas.falhas, 2)
  assert.equal(r.metricas.respostas, 2)
  assert.equal(r.metricas.taxa_resposta, 0.4)
  assert.equal(r.metricas.diagnostico, 2)
  assert.equal(r.metricas.proposta, 1)
  assert.equal(r.metricas.reunioes, 1)
  assert.equal(r.metricas.fechados, 1)
  assert.equal(r.metricas.custo_por_oportunidade, 150)
  assert.equal(r.melhores.categoria.chave, 'restaurante')
  assert.equal(r.melhores.cidade.chave, 'Salvador/BA')
  assert.equal(r.melhores.horario.chave, '09:00')
  assert.equal(r.rankings.categorias[0].taxa_resposta, 0.5)
  // série diária para o gráfico de crescimento
  assert.equal(r.serie_diaria.length, 2)
  assert.deepEqual(r.serie_diaria[0], { dia: '2026-05-01', enviados: 3, respostas: 1, falhas: 0 })
  assert.equal(r.serie_diaria[1].respostas, 2)
  assert.equal(pool.calls.length, 6)
})

test('dashboard estrategico deixa custo por oportunidade nulo sem custo total', async () => {
  const pool = fakePoolAnalytics()
  const r = await obterDashboardEstrategicoProspeccao(pool, { inicio: '2026-05-01', fim: '2026-05-24' })
  assert.equal(r.metricas.custo_total, null)
  assert.equal(r.metricas.custo_por_oportunidade, null)
})
