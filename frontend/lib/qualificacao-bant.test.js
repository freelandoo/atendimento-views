const test = require('node:test')
const assert = require('node:assert/strict')
const { traduzirQualificacaoBant } = require('./qualificacao-bant')

test('traduz veredito do backend sem recalcular a qualificação', () => {
  const leitura = traduzirQualificacaoBant({
    status: 'qualificado',
    pronto_para_assuncao: true,
    necessidade: { status: 'confirmada', evidencia: 'Perde contatos.' },
    timing: { status: 'curto_prazo' },
    autoridade: { status: 'decisor' },
    budget: { status: 'faixa_compativel' },
  })
  assert.equal(leitura.prontoParaAssuncao, true)
  assert.deepEqual(leitura.dimensoes.map((item) => item.letra), ['N', 'T', 'A', 'B'])
  assert.equal(leitura.dimensoes[0].estado, 'confirmado')
  assert.equal(leitura.dimensoes[0].evidencia, 'Perde contatos.')
})

test('trata falta de caixa como pendência de entendimento, não descarte automático', () => {
  const leitura = traduzirQualificacaoBant({
    budget: { status: 'sem_caixa_agora', precisa_esclarecer: true },
  })
  const budget = leitura.dimensoes.find((item) => item.chave === 'budget')
  assert.equal(budget.estado, 'pendente')
  assert.equal(budget.valor, 'Precisa esclarecer')
})

test('mostra vermelho somente para bloqueio explícito informado pela API', () => {
  const leitura = traduzirQualificacaoBant({ necessidade: { status: 'sem_necessidade' } })
  assert.equal(leitura.dimensoes[0].estado, 'negativo')
  assert.equal(traduzirQualificacaoBant(null).dimensoes[0].estado, 'pendente')
})

test('influenciador é pendência de autoridade, não confirmação verde', () => {
  const leitura = traduzirQualificacaoBant({ autoridade: { status: 'influenciador' } })
  const autoridade = leitura.dimensoes.find((item) => item.chave === 'autoridade')
  assert.equal(autoridade.estado, 'pendente')
  assert.equal(autoridade.valor, 'Influenciador')
})
