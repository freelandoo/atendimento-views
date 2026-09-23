'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// ─── TODA VARIAVEL DE AMBIENTE LIDA PELO CODIGO ESTA NO .env.example ─────────────────────
//
// O `AGENTS.md` e o `architecture-rules.md` dizem, ha muito tempo, que variavel nova so' pode
// existir documentada. Era uma promessa sem verificacao: em 2026-09-21 havia 20 variaveis
// lidas pelo codigo e ausentes do `.env.example` — entre elas timeouts de IA, o fuso das
// rotinas de aquisicao e a flag que decide se o envio confere a conexao da instancia antes de
// disparar. Quem fosse configurar o projeto nao tinha como saber que existiam.
//
// Este teste fecha a torneira: `process.env.X` novo sem entrada no `.env.example` quebra o
// build, com o nome da variavel e o arquivo onde ela aparece.
//
// ⚠️ Documentar e' escrever a LINHA, nao so' citar o nome. Vale entrada ativa (`X=valor`),
// comentada (`# X=valor`) ou LAPIDE (`# X — APOSENTADA ...`) — as tres dizem ao leitor que a
// variavel existe e o que ela faz. A lapide conta de proposito: variavel aposentada que some
// sem explicacao e' variavel que alguem readiciona seis meses depois.

const RAIZ = path.join(__dirname, '..')

function arquivosJs(dir, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules') continue
    const completo = path.join(dir, entrada.name)
    if (entrada.isDirectory()) arquivosJs(completo, acc)
    else if (entrada.name.endsWith('.js')) acc.push(completo)
  }
  return acc
}

const FONTES = [
  ...arquivosJs(path.join(RAIZ, 'src')),
  path.join(RAIZ, 'index.js'),
  ...arquivosJs(path.join(RAIZ, 'scripts')),
]

function lidasNoCodigo() {
  const achadas = new Map()
  for (const arquivo of FONTES) {
    const texto = fs.readFileSync(arquivo, 'utf8')
    const re = /process\.env\.([A-Z_0-9]+)/g
    let m
    while ((m = re.exec(texto))) {
      if (!achadas.has(m[1])) achadas.set(m[1], path.relative(RAIZ, arquivo).replace(/\\/g, '/'))
    }
  }
  return achadas
}

function documentadas() {
  const linhas = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8').split(/\r?\n/)
  const nomes = new Set()
  for (const linha of linhas) {
    // Minimo 2 caracteres: `TZ` e um nome real e ficava de fora com um limite maior.
    const atribuicao = linha.match(/^#?\s*([A-Z_0-9]{2,})\s*=/)
    if (atribuicao) nomes.add(atribuicao[1])
    const lapide = linha.match(/^#\s*([A-Z_0-9]{4,})\b/)
    if (lapide) nomes.add(lapide[1])
  }
  return nomes
}

test('toda variavel de ambiente lida pelo codigo esta no .env.example', () => {
  const lidas = lidasNoCodigo()
  const docs = documentadas()

  const ausentes = [...lidas.entries()]
    .filter(([nome]) => !docs.has(nome))
    .map(([nome, arquivo]) => `${nome} (lida em ${arquivo})`)
    .sort()

  assert.deepEqual(
    ausentes, [],
    'Variavel de ambiente sem documentacao no .env.example:\n  ' + ausentes.join('\n  ') +
    '\n\nAcrescente a linha no `.env.example` (com o default REAL do codigo e uma frase do que ela faz).\n' +
    'Se for configuracao de uma area inteira, explique tambem no AGENTS.md: la mora o porque.'
  )
})

test('o .env.example cobre pelo menos as variaveis obrigatorias do boot', () => {
  // Estas sao verificadas por `validarSecretsBoot` (index.js): sem elas o processo ABORTA.
  // Quem clona o repositorio e nao as encontra no exemplo descobre isso do jeito ruim.
  const obrigatorias = [
    'EVOLUTION_API_KEY',
    'REPROCESS_SECRET',
    'DASHBOARD_ADMIN_EMAIL',
    'DASHBOARD_ADMIN_PASSWORD',
    'JWT_SECRET',
  ]
  const docs = documentadas()
  const faltando = obrigatorias.filter((n) => !docs.has(n))
  assert.deepEqual(faltando, [], `obrigatorias no boot e ausentes do .env.example: ${faltando.join(', ')}`)
})
