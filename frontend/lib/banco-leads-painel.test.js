import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cartoesDeFunil, itensMaisAcoes, validarExportacao,
  COLUNAS_CSV, COLUNAS_CSV_PADRAO, LIMPEZA,
} from './banco-leads-painel.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const FONTE = fs.readFileSync(path.join(AQUI, 'banco-leads-painel.js'), 'utf8')
// As guardas olham o CÓDIGO, não o comentário: o arquivo explica por escrito que não decide
// permissão, e uma varredura ingênua acusaria justamente a frase que promete o contrário.
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ABAS = [
  { valor: 'sem_contato', label: 'Sem contato ainda' },
  { valor: 'conversou', label: 'Já conversou' },
  { valor: 'fecharam', label: 'Fecharam' },
  { valor: 'agendados', label: 'Agendados' },
  { valor: 'descartados', label: 'Descartados' },
]

// ─── Cartões do funil ────────────────────────────────────────────────────────

test('cartão traz total e participação no total das abas', () => {
  const cartoes = cartoesDeFunil(ABAS, { abas: { sem_contato: 60, conversou: 20, fecharam: 10, agendados: 10, descartados: 0 } })
  assert.equal(cartoes.length, 5)
  assert.equal(cartoes[0].total, 60)
  assert.equal(cartoes[0].percentual, 60)
  assert.equal(cartoes[4].total, 0)
  assert.equal(cartoes[4].percentual, 0)
})

test('sem resumo, total e percentual são NULL — "0%" afirmaria estágio vazio sem ninguém ter contado', () => {
  const [primeiro] = cartoesDeFunil(ABAS, null)
  assert.equal(primeiro.total, null)
  assert.equal(primeiro.percentual, null)
})

test('carteira zerada não divide por zero', () => {
  const cartoes = cartoesDeFunil(ABAS, { abas: {} })
  assert.equal(cartoes[0].total, 0)
  assert.equal(cartoes[0].percentual, null)
})

test('todo cartão carrega rótulo em texto — cor nunca é o único sinal', () => {
  for (const c of cartoesDeFunil(ABAS, { abas: { sem_contato: 1 } })) {
    assert.ok(c.label && c.label.trim().length > 2, `cartão sem rótulo: ${c.valor}`)
    assert.ok(c.tom)
  }
})

test('aba desconhecida não quebra e nasce neutra', () => {
  const [c] = cartoesDeFunil([{ valor: 'novissima', label: 'Nova' }], { abas: { novissima: 3 } })
  assert.equal(c.tom, 'neutro')
  assert.equal(c.percentual, 100)
})

// ─── Menu "Mais ações" ───────────────────────────────────────────────────────

test('sem capacidade nenhuma, o menu não existe — botão inerte só convida ao clique', () => {
  assert.deepEqual(itensMaisAcoes({}), [])
  assert.deepEqual(itensMaisAcoes(), [])
})

test('cada capacidade traz só o seu item, e limpar é marcado como perigo', () => {
  assert.deepEqual(itensMaisAcoes({ podeExportar: true }).map((i) => i.chave), ['exportar'])
  const limpar = itensMaisAcoes({ podeLimpar: true })
  assert.deepEqual(limpar.map((i) => i.chave), ['limpar'])
  assert.equal(limpar[0].tom, 'perigo')
  assert.deepEqual(itensMaisAcoes({ podeExportar: true, podeLimpar: true }).map((i) => i.chave),
    ['exportar', 'limpar'])
})

// ─── Exportação ──────────────────────────────────────────────────────────────

test('seleção vazia é recusada COM motivo, não com botão apagado', () => {
  const r = validarExportacao({ colunas: [], nomeArquivo: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /pelo menos uma coluna/i)
  assert.deepEqual(r.colunas, [])
})

test('nome do arquivo é saneado e termina em .csv uma vez só', () => {
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: 'meus leads.csv' }).nome, 'meus leads.csv')
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: 'a/b\\c:d' }).nome, 'a-b-c-d.csv')
  assert.equal(validarExportacao({ colunas: ['nome'], nomeArquivo: '   ' }).nome, 'banco-leads.csv')
  assert.equal(validarExportacao({ colunas: ['nome'] }).nome, 'banco-leads.csv')
})

test('o padrão do arquivo é do chamador (a aba entra no nome)', () => {
  assert.equal(validarExportacao({ colunas: ['nome'], padrao: 'banco-leads-sem_contato' }).nome,
    'banco-leads-sem_contato.csv')
})

test('colunas em branco são descartadas antes da validação', () => {
  assert.equal(validarExportacao({ colunas: ['', '  '], nomeArquivo: 'x' }).ok, false)
  assert.deepEqual(validarExportacao({ colunas: [' nome ', 'telefone'], nomeArquivo: 'x' }).colunas,
    ['nome', 'telefone'])
})

test('o padrão de colunas é o catálogo inteiro', () => {
  assert.equal(COLUNAS_CSV_PADRAO.length, COLUNAS_CSV.length)
})

// ─── Guardas de regressão ────────────────────────────────────────────────────

test('guarda: toda coluna oferecida existe no catálogo FECHADO do backend', () => {
  const backend = fs.readFileSync(
    path.join(AQUI, '..', '..', 'backend', 'src', 'services', 'banco-leads-export.js'), 'utf8')
  for (const c of COLUNAS_CSV) {
    assert.match(backend, new RegExp(`chave: '${c.chave}'`),
      `a tela oferece a coluna "${c.chave}", que o backend não conhece — o arquivo sairia sem ela`)
  }
})

test('guarda: o módulo não decide permissão nem lê capacidade por conta própria', () => {
  assert.doesNotMatch(CODIGO, /temCapacidade|capacidades|papel|owner|'admin'|'comercial'/)
})

test('guarda: o módulo é PURO — sem React, rede ou DOM', () => {
  assert.doesNotMatch(FONTE, /\bfetch\(|useState|useEffect|document\.|window\./)
})

test('guarda: o texto da limpeza não promete exclusão por filtro ou por seleção', () => {
  const texto = `${LIMPEZA.titulo} ${LIMPEZA.corpo} ${LIMPEZA.aviso} ${LIMPEZA.rotuloConfirmar}`
  assert.match(texto, /sem e-mail e sem telefone|não têm e-mail nem telefone/i)
  assert.match(LIMPEZA.aviso, /irreversível/i)
  assert.doesNotMatch(texto, /todos os leads|leads filtrados|leads selecionados/i)
})
