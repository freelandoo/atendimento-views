'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  COLUNAS_EXPORT, selecionarColunasExport, camposSqlExport, cabecalhoExport, linhaExport,
} = require('../src/services/banco-leads-export')

const FONTE_MODULO = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'banco-leads-export.js'), 'utf8')
const FONTE_ROTA = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'api-banco-leads.js'), 'utf8')

test('sem parametro, o arquivo sai com o catalogo inteiro (comportamento historico)', () => {
  const colunas = selecionarColunasExport(undefined)
  assert.equal(colunas.length, COLUNAS_EXPORT.length)
  assert.deepEqual(cabecalhoExport(colunas), [
    'Origem', 'Status', 'Nome', 'Telefone', 'Email', 'Instagram',
    'Nicho', 'Cidade', 'Site', 'Seguidores', 'Criado em', 'Atualizado em',
  ])
})

test('recorta pelas chaves pedidas', () => {
  const colunas = selecionarColunasExport('nome,telefone')
  assert.deepEqual(cabecalhoExport(colunas), ['Nome', 'Telefone'])
  assert.deepEqual(camposSqlExport(colunas), ['nome', 'telefone'])
})

test('aceita array, ignora espaco e caixa', () => {
  assert.deepEqual(cabecalhoExport(selecionarColunasExport([' Nome ', 'CIDADE'])), ['Nome', 'Cidade'])
})

test('a ordem e a do CATALOGO, nao a do clique — duas exportacoes iguais saem iguais', () => {
  assert.deepEqual(
    cabecalhoExport(selecionarColunasExport('cidade,nome,origem')),
    cabecalhoExport(selecionarColunasExport('origem,nome,cidade'))
  )
  assert.deepEqual(cabecalhoExport(selecionarColunasExport('cidade,nome')), ['Nome', 'Cidade'])
})

test('chave desconhecida e IGNORADA — nunca entra no SELECT', () => {
  const colunas = selecionarColunasExport('nome,password_hash,telefone')
  assert.deepEqual(camposSqlExport(colunas), ['nome', 'telefone'])
})

test('selecao que nao sobra nada cai no catalogo inteiro (pedido malformado nao gera arquivo vazio)', () => {
  assert.equal(selecionarColunasExport('').length, COLUNAS_EXPORT.length)
  assert.equal(selecionarColunasExport('inexistente').length, COLUNAS_EXPORT.length)
})

test('linha respeita a ordem das colunas, converte data e trata ausencia', () => {
  const colunas = selecionarColunasExport('nome,criado_em,seguidores')
  // A ordem e a do catalogo: Nome → Seguidores → Criado em.
  const linha = linhaExport(
    { nome: 'Padaria', created_at: '2026-09-20T12:00:00.000Z', seguidores: null }, colunas)
  assert.deepEqual(linha, ['Padaria', '', '2026-09-20T12:00:00.000Z'])
})

test('zero nao vira vazio (ausencia e outra coisa que valor zero)', () => {
  const colunas = selecionarColunasExport('seguidores')
  assert.deepEqual(linhaExport({ seguidores: 0 }, colunas), [0])
})

// ─── Guardas de regressao ────────────────────────────────────────────────────
// O que estas guardas protegem: o campo SQL do CSV nunca pode vir da requisicao. Foi essa a
// razao de o catalogo existir; um `SELECT ${req.query.colunas}` seria injecao direta.

test('guarda: todo campo do catalogo e um identificador simples de coluna', () => {
  for (const c of COLUNAS_EXPORT) {
    assert.match(c.campo, /^[a-z][a-z0-9_]*$/, `campo suspeito no catalogo: ${c.campo}`)
    assert.match(c.chave, /^[a-z][a-z0-9_]*$/, `chave suspeita no catalogo: ${c.chave}`)
  }
})

test('guarda: o modulo e PURO — sem banco, HTTP ou dependencia externa', () => {
  assert.doesNotMatch(FONTE_MODULO, /require\(['"](\.\.\/db|pg|axios|node-fetch)/)
  assert.doesNotMatch(FONTE_MODULO, /\bpool\.query\b|\bfetch\(/)
})

test('guarda: a rota nao concatena o parametro do cliente no SELECT', () => {
  const trecho = FONTE_ROTA.slice(FONTE_ROTA.indexOf("router.get('/export.csv'"))
  assert.doesNotMatch(trecho, /SELECT \$\{req\.query/)
  assert.match(trecho, /camposSqlExport\(colunas\)/)
  assert.match(trecho, /selecionarColunasExport\(req\.query\.colunas\)/)
})

test('guarda: `colunas` escolhe COLUNA, nunca quais leads — o WHERE continua o da listagem', () => {
  const trecho = FONTE_ROTA.slice(FONTE_ROTA.indexOf("router.get('/export.csv'"))
  assert.match(trecho, /montarFiltro\(req\.empresa\.id, req\.query\)/)
})
