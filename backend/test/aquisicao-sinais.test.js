'use strict'
// Regras do Assistente de Oportunidades (services/aquisicao-sinais.js).
//
// O que estes testes protegem:
//   - amostra pequena NÃO vira recomendação (ruído ≠ sinal);
//   - dado contraditório (mercado esgotado de coleta mas convertendo) não manda pausar;
//   - a assinatura só muda quando a evidência muda de FAIXA — é ela que impede uma
//     sugestão dispensada de voltar sem motivo novo;
//   - "Campinas - SP" e "Campinas"/UF SP são o mesmo mercado (senão o assistente
//     sugeriria criar uma rotina que já existe).

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  avaliarOportunidades,
  desempenhoColeta,
  chaveMercado,
  cidadeBase,
} = require('../src/services/aquisicao-sinais')

const rotina = (over = {}) => ({
  id: 'rot-1',
  nicho: 'dentista',
  cidade: 'Campinas',
  uf: 'SP',
  ativo: true,
  estado: 'concluida',
  falhas_consecutivas: 0,
  intervalo_horas: 6,
  quantidade: 200,
  ultimo_erro: null,
  ...over,
})

const coleta = (over = {}) => ({
  rotina_id: 'rot-1', status: 'concluido', coletados: 100, novos: 50, ...over,
})

const mercado = (over = {}) => ({
  nicho: 'dentista', cidade: 'Campinas - SP', total: 100, enviados: 40, respostas: 4, reunioes: 1, ...over,
})

function so(tipo, resultado) {
  return resultado.candidatos.filter((c) => c.tipo === tipo)
}

test('sinais: sem rotina, sem coleta e sem lead → dados insuficientes, nenhuma recomendação', () => {
  const r = avaliarOportunidades({ rotinas: [], coletas: [], mercados: [] })
  assert.equal(r.suficiente, false)
  assert.deepEqual(r.candidatos, [])
  assert.match(r.motivo_insuficiencia, /não há rotinas nem leads/i)
})

test('sinais: falhas seguidas viram "revisar" com a maior prioridade', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina({ estado: 'precisa_atencao', falhas_consecutivas: 3, ultimo_erro: 'timeout' })],
    coletas: [],
    mercados: [],
  })
  const [c] = r.candidatos
  assert.equal(c.tipo, 'revisar_rotina')
  assert.equal(c.rotina_id, 'rot-1')
  assert.equal(c.prioridade, 95)
  assert.equal(c.evidencias.falhas_consecutivas, 3)
})

test('sinais: rotina saturada (quase tudo repetido) vira "pausar"', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina()],
    coletas: [coleta({ coletados: 100, novos: 4 }), coleta({ coletados: 120, novos: 3 })],
    mercados: [],
  })
  const [c] = so('pausar_rotina', r)
  assert.ok(c, 'esperava sugestão de pausa')
  assert.equal(c.evidencias.execucoes_avaliadas, 2)
  assert.equal(c.evidencias.novos, 7)
  assert.ok(c.evidencias.taxa_novos_pct < 10)
})

test('sinais: UMA coleta não basta para acusar saturação (amostra insuficiente)', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina()],
    coletas: [coleta({ coletados: 100, novos: 1 })],
    mercados: [],
  })
  assert.deepEqual(r.candidatos, [])
})

test('sinais: dado contraditório — mercado esgotado de coleta MAS convertendo não manda pausar', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina()],
    coletas: [coleta({ coletados: 100, novos: 2 }), coleta({ coletados: 100, novos: 3 })],
    mercados: [mercado({ respostas: 6 })],
  })
  assert.equal(so('pausar_rotina', r).length, 0, 'não pode sugerir pausar um mercado que responde')
  const [c] = so('revisar_rotina', r)
  assert.ok(c, 'esperava rebaixamento para revisão humana')
  assert.equal(c.evidencias.respostas_no_mercado, 6)
})

test('sinais: mercado que repõe devagar → propõe dobrar o intervalo (teto de 168h)', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina({ intervalo_horas: 12 })],
    coletas: [coleta({ coletados: 100, novos: 20 }), coleta({ coletados: 100, novos: 18 })],
    mercados: [],
  })
  const [c] = so('ajustar_rotina', r)
  assert.equal(c.parametros.intervalo_horas, 24)
  assert.equal(c.evidencias.intervalo_atual_horas, 12)
})

test('sinais: mercado fértil com limite baixo → propõe importar mais por execução', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina({ quantidade: 50 })],
    coletas: [coleta({ coletados: 100, novos: 80 }), coleta({ coletados: 100, novos: 90 })],
    mercados: [],
  })
  const [c] = so('ajustar_rotina', r)
  assert.equal(c.parametros.quantidade, 200)
  assert.equal(c.evidencias.quantidade_atual, 50)
})

test('sinais: mercado JÁ comprovado e sem rotina vira "criar rotina" (pausada por padrão do fluxo)', () => {
  const r = avaliarOportunidades({
    rotinas: [],
    coletas: [],
    mercados: [mercado({ nicho: 'clínica odontológica', cidade: 'Campinas - SP', enviados: 40, respostas: 6, reunioes: 2 })],
  })
  const [c] = so('criar_rotina', r)
  assert.equal(c.rotina_id, null)
  assert.equal(c.cidade, 'Campinas', 'a UF sai da cidade e vai para o campo próprio')
  assert.equal(c.uf, 'SP')
  assert.equal(c.evidencias.respostas, 6)
  assert.equal(c.parametros.quantidade, 200)
})

test('sinais: mercado comprovado que JÁ tem rotina não vira sugestão de criar', () => {
  const r = avaliarOportunidades({
    // A rotina guarda cidade e UF separadas; o prospect guarda "Campinas - SP".
    rotinas: [rotina({ nicho: 'clínica odontológica', cidade: 'Campinas', uf: 'SP' })],
    coletas: [],
    mercados: [mercado({ nicho: 'clínica odontológica', cidade: 'Campinas - SP', enviados: 40, respostas: 6 })],
  })
  assert.equal(so('criar_rotina', r).length, 0)
})

test('sinais: mercado com poucos abordados não vira recomendação', () => {
  const r = avaliarOportunidades({
    rotinas: [rotina({ id: 'outra', nicho: 'pet shop', cidade: 'Santos' })],
    coletas: [],
    mercados: [mercado({ nicho: 'advogado', cidade: 'Recife - PE', enviados: 5, respostas: 2 })],
  })
  assert.equal(so('criar_rotina', r).length, 0)
})

test('sinais: candidatos saem ordenados por prioridade', () => {
  const r = avaliarOportunidades({
    rotinas: [
      rotina({ id: 'rot-1', quantidade: 50 }),
      rotina({ id: 'rot-2', nicho: 'pet shop', estado: 'precisa_atencao', falhas_consecutivas: 3 }),
    ],
    coletas: [
      coleta({ rotina_id: 'rot-1', coletados: 100, novos: 80 }),
      coleta({ rotina_id: 'rot-1', coletados: 100, novos: 85 }),
    ],
    mercados: [],
  })
  assert.equal(r.candidatos[0].tipo, 'revisar_rotina', 'falha vem antes de otimização')
  assert.ok(r.candidatos[0].prioridade > r.candidatos[1].prioridade)
})

test('sinais: assinatura é estável em variação pequena e muda quando a evidência muda de faixa', () => {
  const comNovos = (novos) => avaliarOportunidades({
    rotinas: [rotina()],
    coletas: [coleta({ coletados: 100, novos }), coleta({ coletados: 100, novos })],
    mercados: [],
  }).candidatos[0].assinatura

  // 2% e 4% caem na mesma faixa de saturação: dispensou uma vez, não volta.
  assert.equal(comNovos(2), comNovos(4))
  // 4% → 25% é mudança material: vira outra recomendação, com outra assinatura.
  assert.notEqual(comNovos(4), comNovos(25))
})

test('sinais: helpers de mercado tratam a UF colada na cidade', () => {
  assert.equal(cidadeBase('Campinas - SP'), 'Campinas')
  assert.equal(cidadeBase('São Bernardo do Campo'), 'São Bernardo do Campo')
  assert.equal(chaveMercado('Dentista', 'Campinas - SP'), chaveMercado('dentista', 'Campinas'))
})

test('sinais: coleta que não encontrou nada tem taxa 0 (e não NaN)', () => {
  const d = desempenhoColeta([{ status: 'concluido', coletados: 0, novos: 0 }])
  assert.equal(d.taxa_novos, 0)
  assert.equal(d.execucoes, 1)
})
