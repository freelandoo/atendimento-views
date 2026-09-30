'use strict'
// Guard de FONTE para o painel comercial: os testes de serviço são puros e NÃO exercem o SQL,
// então um erro de coluna (ex.: a LATERAL não expor `p.pais`) só aparecia em produção como 500.
// Este teste lê o fonte de db/painel-comercial.js e garante que a LATERAL de agenda
// (JOIN_PROSPECT_AGENDA) exponha TODA coluna que `condLead` referencia sob o alias `p`.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const FONTE = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'painel-comercial.js'), 'utf8')

/** Recorta o corpo de uma função `function nome(...) { ... }` (chaves balanceadas). */
function corpoDaFuncao(src, nome) {
  const ini = src.indexOf(`function ${nome}(`)
  assert.ok(ini >= 0, `função ${nome} não encontrada`)
  const abre = src.indexOf('{', ini)
  let nivel = 0
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '{') nivel++
    else if (src[i] === '}') { nivel--; if (nivel === 0) return src.slice(abre, i + 1) }
  }
  throw new Error(`não fechei as chaves de ${nome}`)
}

test('a LATERAL de agenda expõe toda coluna que condLead usa (senão o painel dá 500)', () => {
  // Colunas que condLead referencia sob o alias `p` (`${p}.<col>`), ex.: p.nicho_id, p.pais…
  const usadasPorCondLead = new Set(
    [...corpoDaFuncao(FONTE, 'condLead').matchAll(/\$\{p\}\.(\w+)/g)].map((m) => m[1])
  )
  assert.ok(usadasPorCondLead.size >= 4, 'esperava condLead referenciando várias colunas de p')

  // Colunas que a LATERAL JOIN_PROSPECT_AGENDA expõe (SELECT pp.<col>, …).
  const bloco = FONTE.slice(FONTE.indexOf('JOIN_PROSPECT_AGENDA'))
  const selectLateral = bloco.slice(bloco.indexOf('SELECT'), bloco.indexOf('FROM'))
  const expostasPelaLateral = new Set([...selectLateral.matchAll(/pp\.(\w+)/g)].map((m) => m[1]))

  for (const col of usadasPorCondLead) {
    assert.ok(
      expostasPelaLateral.has(col),
      `condLead usa p.${col}, mas a LATERAL de agenda NÃO expõe "${col}" — isso dá "column p.${col} does not exist" (500). Adicione pp.${col} ao SELECT da LATERAL.`
    )
  }
})
