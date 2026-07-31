const test = require('node:test')
const assert = require('node:assert/strict')

const { resumoSinais } = require('./ligacao-sinais-resumo')

// Semântica espelhada de src/db/ligacoes.js → derivarEtapasDeSinais (fonte oficial).
test('resumoSinais conta cada tipo e pega a ULTIMA etapa de cada um', () => {
  const r = resumoSinais([
    { tipo: 'interesse', etapa_tipo: 'abertura' },
    { tipo: 'resistencia', etapa_tipo: 'situacao' },
    { tipo: 'interesse', etapa_tipo: 'qualificacao' },
  ])
  assert.equal(r.interesse, 2)
  assert.equal(r.resistencia, 1)
  assert.equal(r.etapaMaiorInteresse, 'qualificacao')
  assert.equal(r.etapaPerda, 'situacao')
})

test('resumoSinais sem sinais => zeros e nulls', () => {
  assert.deepEqual(resumoSinais([]), { interesse: 0, resistencia: 0, etapaMaiorInteresse: null, etapaPerda: null })
})

test('resumoSinais tolera lista indefinida e itens vazios', () => {
  assert.equal(resumoSinais(undefined).interesse, 0)
  assert.equal(resumoSinais([null, { tipo: 'interesse', etapa_tipo: 'abertura' }]).interesse, 1)
})

test('resumoSinais conta o sinal mesmo sem etapa, mas nao usa como etapa derivada', () => {
  const r = resumoSinais([
    { tipo: 'interesse', etapa_tipo: 'abertura' },
    { tipo: 'interesse', etapa_tipo: null },
  ])
  assert.equal(r.interesse, 2)
  assert.equal(r.etapaMaiorInteresse, 'abertura')
})
