'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Guarda de regressao: nenhum arquivo de `scripts/` pode casar com o padrao de DESCOBERTA de
// testes do Node.
//
// ══ POR QUE ISTO EXISTE ══
// `scripts/` guarda ferramenta OPERACIONAL: envio real de WhatsApp, backfill que grava,
// medicao contra producao. `node --test` SEM argumento varre o projeto e executa tudo o que
// casa com `test-*.js`, `*.test.js` ou `test.js` — e ate 2026-09-24 havia ali um
// `test-evolution-send.js`, que **manda mensagem real para um numero real**. Bastava alguem
// digitar `node --test` (o comando obvio) para disparar.
//
// O `npm test` usa o glob `test/*.test.js` justamente para nao alcancar `scripts/`. Isso
// protege quem usa o comando do projeto; esta guarda protege quem usa o comando do Node.
// Renomear resolveu o caso concreto (`enviar-teste-evolution.js`); a guarda impede o proximo.

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts')

// Espelha o padrao do Node (`lib/internal/test_runner/utils.js`): dentro de uma pasta que NAO
// se chama `test/`, ele descobre `test.js`, `test-*.js` e `*.test.js`.
function pareceTesteParaONode(nome) {
  const semExt = /\.(js|mjs|cjs)$/i.test(nome)
  if (!semExt) return false
  const base = nome.replace(/\.(js|mjs|cjs)$/i, '')
  return base === 'test' || base.startsWith('test-') || base.endsWith('.test')
}

test('nenhum script operacional e descoberto por `node --test`', () => {
  const arquivos = fs.existsSync(SCRIPTS_DIR) ? fs.readdirSync(SCRIPTS_DIR) : []
  const perigosos = arquivos.filter(pareceTesteParaONode)
  assert.deepEqual(
    perigosos, [],
    'Arquivo em scripts/ casando com a descoberta de testes do Node: ' + perigosos.join(', ') +
    '\nRenomeie (ex.: `enviar-teste-x.js` no lugar de `test-x.js`). Scripts de scripts/ executam\n' +
    'acao real — envio de WhatsApp, backfill, consulta a producao — e `node --test` sem argumento\n' +
    'os RODARIA.'
  )
})

test('o padrao que a guarda espelha esta certo', () => {
  // Se este teste mentir, a guarda acima vira decoracao.
  for (const nome of ['test.js', 'test-evolution-send.js', 'algo.test.js', 'test-x.mjs']) {
    assert.equal(pareceTesteParaONode(nome), true, `${nome} deveria ser considerado descobrivel`)
  }
  for (const nome of ['enviar-teste-evolution.js', 'testar.js', 'protest.js', 'notas.md', 'x.sh']) {
    assert.equal(pareceTesteParaONode(nome), false, `${nome} nao deveria ser considerado descobrivel`)
  }
})
