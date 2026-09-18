'use strict'
// Equipes por Nicho: pre-requisito `prospects.nicho_id`.
//
// Esta suite protege a fase estrutural: schema + backfill. Ela nao testa banco real; testa o
// contrato dos SQLs e das mensagens para impedir que o recorte futuro nasca em cima de palpite.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const B = require('../scripts/backfill-prospects-nicho')

const RAIZ = path.join(__dirname, '..')
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

test('CASAMENTO e exato por nome dentro da empresa, sem fuzzy', () => {
  // Dos dois lados: nome do catalogo e texto do lead, ambos limpos e em minusculas.
  assert.ok(B.CASAMENTO.includes('lower(BTRIM(n.nome,'), 'lado do catalogo')
  assert.ok(B.CASAMENTO.includes('lower(BTRIM(p.nicho,'), 'lado do lead')
  assert.match(B.CASAMENTO, /\)\s*=\s*lower\(BTRIM\(p\.nicho,/, 'igualdade exata entre os dois')
  for (const proibido of ['ILIKE', 'similarity', 'levenshtein', 'soundex', 'LIKE']) {
    assert.ok(!B.CASAMENTO.toUpperCase().includes(proibido.toUpperCase()), `nao pode usar ${proibido}`)
  }
})

test('o casamento limpa QUEBRA DE LINHA, nao so espaco', () => {
  // Medido em producao (2026-09-18): o termo da Aquisicao chega com quebra de linha no fim, e
  // `TRIM()` do Postgres remove SO' espaco. O sintoma foi "funilaria e pintura automotiva"
  // aparecendo duas vezes no raio-x, uma casando com o catalogo e outra nao — mesmo texto na
  // tela, veredito oposto. Sem isto, milhares de leads ficam fora do recorte por um caractere
  // invisivel.
  assert.ok(!/\bTRIM\(/.test(B.CASAMENTO.replace(/BTRIM\(/g, '')), 'TRIM() sozinho nao basta')
  for (const chr of ['chr(32)', 'chr(9)', 'chr(10)', 'chr(13)']) {
    assert.ok(B.CASAMENTO.includes(chr), `precisa limpar ${chr}`)
  }
})

test('GUARDA: nenhuma consulta do script ficou com TRIM() sozinho', () => {
  // Uma unica consulta esquecida faria o relatorio prometer um numero e a gravacao entregar
  // outro — exatamente o que este script existe para nao cometer.
  const src = fonte('scripts/backfill-prospects-nicho.js')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n')
  const trimsSozinhos = (src.match(/(?<!B)TRIM\(/g) || []).length
  assert.equal(trimsSozinhos, 0, 'use limpo(coluna), que remove tab e quebra de linha tambem')
})

test('montarAchados declara simulacao e nao transforma falta de catalogo em erro', () => {
  const achados = B.montarAchados(
    { totalLeads: 10, semTexto: 1, casaveis: 6, semCatalogo: 3, criados: 0 },
    { aplicar: false, criarNichos: false }
  )
  assert.ok(achados.some((a) => a.includes('10 lead(s) sem nicho_id')))
  assert.ok(achados.some((a) => a.includes('SIMULACAO')))
  assert.ok(achados.some((a) => a.includes('fica em NULL de proposito')))
  assert.ok(achados.some((a) => a.includes('--criar-nichos')))
})

test('montarAchados explica criacao opt-in de nichos observados', () => {
  const simulado = B.montarAchados(
    { totalLeads: 4, semTexto: 0, casaveis: 0, semCatalogo: 4, criados: 2 },
    { aplicar: false, criarNichos: true }
  )
  assert.ok(simulado.some((a) => a.includes('seriam criados')))

  const aplicado = B.montarAchados(
    { totalLeads: 4, semTexto: 0, casaveis: 4, semCatalogo: 0, criados: 2 },
    { aplicar: true, criarNichos: true }
  )
  assert.ok(aplicado.some((a) => a.includes('criado(s)')))
  assert.ok(!aplicado.some((a) => a.includes('SIMULACAO')))
})

test('script simula por padrao e exige DATABASE_URL so na execucao CLI', () => {
  const src = fonte('scripts/backfill-prospects-nicho.js')
  assert.match(src, /const aplicar = argv\.includes\('--aplicar'\)/)
  assert.match(src, /if \(!url\)/)
  assert.doesNotThrow(() => require('../scripts/backfill-prospects-nicho'))
})

test('script nunca vincula lead sem empresa nem sobrescreve nicho_id existente', () => {
  const src = fonte('scripts/backfill-prospects-nicho.js')
  assert.match(src, /p\.nicho_id IS NULL/)
  assert.match(src, /p\.empresa_id IS NOT NULL/)
  assert.match(src, /n\.empresa_id = p\.empresa_id/)
  assert.match(src, /alvo\.nicho_id IS NULL/)
  assert.ok(!/SET\s+nicho\s*=/.test(src), 'texto cru prospects.nicho nao pode ser reescrito')
})

test('script nao chama rede nem servico pago', () => {
  const src = fonte('scripts/backfill-prospects-nicho.js')
  for (const proibido of ['fetch(', 'axios', 'anthropic', 'openai', 'brightdata', 'google']) {
    assert.ok(!src.toLowerCase().includes(proibido.toLowerCase()), `backfill nao pode conter ${proibido}`)
  }
})

test('migration e aditiva: coluna nullable sem default, indice e nenhuma mutacao de dados', () => {
  const sql = fonte('sql/migrations/087_prospects_nicho_id.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS nicho_id UUID/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_prospects_empresa_nicho/)
  assert.match(sql, /WHERE nicho_id IS NOT NULL/)
  const sqlSemComentarios = sql.replace(/--[^\n]*/g, '')
  assert.ok(!/DEFAULT\s+/.test(sqlSemComentarios), 'nicho_id nao pode ter DEFAULT')
  assert.ok(!/(^|;)\s*(UPDATE|DELETE|INSERT)\b/i.test(sqlSemComentarios),
    'migration nao deve mutar dados existentes')
})

test('migration usa FK composta e ON DELETE limpa so nicho_id, preservando empresa_id', () => {
  const sql = fonte('sql/migrations/087_prospects_nicho_id.sql')
  assert.match(sql, /FOREIGN KEY \(nicho_id, empresa_id\)/)
  assert.match(sql, /REFERENCES app\.nichos \(id, empresa_id\)/)
  assert.match(sql, /ON DELETE SET NULL \(nicho_id\)/)
  assert.ok(!/ON DELETE SET NULL\s*;/.test(sql), 'SET NULL sem lista limparia empresa_id tambem')
})

test('package.json expoe o comando de backfill e inclui esta suite', () => {
  const pkg = JSON.parse(fonte('package.json'))
  assert.equal(pkg.scripts['backfill:prospects-nicho'], 'node scripts/backfill-prospects-nicho.js')
  assert.ok(pkg.scripts.test.includes('test/backfill-prospects-nicho.test.js'))
})

test('com --minimo, so os nichos CRIADOS saem da pendencia', () => {
  // Defeito medido em producao (2026-09-18): o relatorio anunciou "5063 casam, 0 fora do
  // catalogo" quando o banco tinha 4195 vinculados e 870 pendentes. O UPDATE estava certo — ele
  // so' casa com o catalogo real —, mas quem lesse o relatorio pararia ali, com 870 leads fora
  // do recorte por nicho e sem saber.
  const achados = B.montarAchados(
    { totalLeads: 5065, semTexto: 2, casaveis: 4193, semCatalogo: 870, criados: 17, vinculados: 4195 },
    { aplicar: true, criarNichos: true }
  ).join(' | ')
  assert.match(achados, /4195 lead\(s\) vinculados/)
  assert.match(achados, /870 lead\(s\) continuam SEM nicho_id/)
  assert.match(achados, /fora do recorte por equipe/)
})

test('sem pendencia restante, o relatorio nao inventa alarme', () => {
  const achados = B.montarAchados(
    { totalLeads: 100, semTexto: 0, casaveis: 100, semCatalogo: 0, criados: 3, vinculados: 100 },
    { aplicar: true, criarNichos: true }
  ).join(' | ')
  assert.match(achados, /100 lead\(s\) vinculados/)
  assert.ok(!/continuam SEM nicho_id/.test(achados))
})
