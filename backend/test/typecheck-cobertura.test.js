'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// ─── A COBERTURA DO TYPECHECK SO' SOBE ───────────────────────────────────────────────────
//
// Ate 2026-09-21 o `npm run typecheck` era quase decorativo: `checkJs: false` e um unico
// arquivo `.ts` no projeto inteiro. Ele pegava erro de sintaxe e pouco mais — passava verde
// sobre 252 arquivos JavaScript que ninguem verificava.
//
// A adocao e' OPT-IN por arquivo (`// @ts-check` na primeira linha), porque ligar `checkJs`
// global produz 13.060 erros. Mas opt-in tem um modo de falha obvio: quando o typecheck
// reclamar, e' mais facil apagar o pragma do que corrigir o codigo. Este teste fecha essa
// saida — o numero de arquivos verificados nao pode cair.
//
// ⚠️ O piso NAO e' meta: e' catraca. Anotou um arquivo novo? Este teste falha pedindo para
// SUBIR o piso, e esse diff vira o registro do avanco.

const SRC = path.join(__dirname, '..', 'src')

// Estado congelado em 2026-09-23: 80 arquivos de src/ verificados.
const PISO_ARQUIVOS_VERIFICADOS = 83

function arquivosJs(dir, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules') continue
    const completo = path.join(dir, entrada.name)
    if (entrada.isDirectory()) arquivosJs(completo, acc)
    else if (entrada.name.endsWith('.js')) acc.push(completo)
  }
  return acc
}

const TODOS = arquivosJs(SRC)
const COM_PRAGMA = TODOS.filter((f) => /@ts-check/.test(fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(0, 3).join('\n')))

test('a cobertura do typecheck nao encolhe', () => {
  assert.ok(
    COM_PRAGMA.length >= PISO_ARQUIVOS_VERIFICADOS,
    `A cobertura CAIU: ${COM_PRAGMA.length} arquivos verificados contra o piso de ${PISO_ARQUIVOS_VERIFICADOS}.\n` +
    'Apagar `// @ts-check` faz o erro sumir sem que o defeito tenha sido corrigido.\n' +
    'Se o arquivo foi removido de proposito, baixe o piso explicando por que no commit.'
  )
  assert.equal(
    COM_PRAGMA.length, PISO_ARQUIVOS_VERIFICADOS,
    `A cobertura subiu para ${COM_PRAGMA.length} — otimo. Suba PISO_ARQUIVOS_VERIFICADOS neste\n` +
    'arquivo para travar o novo patamar.'
  )
})

test('o pragma esta na PRIMEIRA linha — fora dela o TypeScript o ignora em silencio', () => {
  // Este e' o erro caro: `// @ts-check` depois do `'use strict'` nao entra na leading trivia
  // do arquivo, entao o TypeScript simplesmente nao verifica nada. O arquivo PARECE coberto,
  // o teste de contagem passa, e a verificacao nao acontece.
  const forasDeLugar = COM_PRAGMA
    .filter((f) => !/^\/\/ @ts-check/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/'))
  assert.deepEqual(forasDeLugar, [], 'mova o pragma para a linha 1, antes do \'use strict\'')
})

test('ninguem silencia um arquivo com @ts-nocheck', () => {
  // A contrapartida do pragma: `@ts-nocheck` desliga a verificacao de um arquivo inteiro. Se
  // aparecer, a cobertura vira teatro — o arquivo conta como verificado e nao e'.
  const silenciados = TODOS
    .filter((f) => /@ts-nocheck/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/'))
  assert.deepEqual(silenciados, [], 'corrija o tipo ou deixe o arquivo fora do opt-in, mas nao silencie')
})

test('o tsconfig mantem a verificacao como OPT-IN', () => {
  // `checkJs: true` ligaria os 252 arquivos de uma vez (13.060 erros) e o portao viraria ruido
  // permanente — que e' como um portao morre.
  const bruto = fs.readFileSync(path.join(__dirname, '..', 'tsconfig.json'), 'utf8')
  const semComentarios = bruto.replace(/^\s*\/\/.*$/gm, '')
  assert.match(semComentarios, /"checkJs"\s*:\s*false/, 'a adocao e por arquivo, via pragma')
})
