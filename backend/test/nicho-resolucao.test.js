'use strict'
// Resolucao AUTOMATICA de prospects.nicho_id ao APROVAR um lead (2026-09-21).
// Regra PURA + guardas de regressao que LEEM O FONTE. Nenhum banco, nenhuma rede.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const N = require('../src/services/nicho-resolucao')

const raiz = path.join(__dirname, '..')
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8')
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

// ─── A expressao de casamento ────────────────────────────────────────────────────────────

test('sqlCasamentoNicho: correspondencia EXATA, sem fuzzy (decisao D1)', () => {
  const sql = N.sqlCasamentoNicho('p.nicho', 'n.nome')
  assert.match(sql, /lower\(BTRIM\(n\.nome,/, 'lado do catalogo')
  assert.match(sql, /lower\(BTRIM\(p\.nicho,/, 'lado do lead')
  assert.match(sql, /\)\s*=\s*lower\(BTRIM\(p\.nicho,/, 'igualdade exata entre os dois lados')
  for (const proibido of ['ILIKE', 'LIKE', 'similarity', 'levenshtein', 'soundex']) {
    assert.ok(!sql.toUpperCase().includes(proibido.toUpperCase()), `nao pode usar ${proibido}`)
  }
})

test('sqlCasamentoNicho: BTRIM cobre espaco, tab, LF e CR — nao so TRIM()', () => {
  // Medido em producao (2026-09-18): TRIM() sozinho preserva quebra de linha no fim do termo de
  // busca da Aquisicao, e o mesmo nicho aparecia duas vezes no raio-x com veredito oposto.
  const sql = N.sqlCasamentoNicho('p.nicho', 'n.nome')
  assert.ok(!/\bTRIM\(/.test(sql.replace(/BTRIM\(/g, '')), 'TRIM() sozinho nao basta')
  for (const chr of ['chr(32)', 'chr(9)', 'chr(10)', 'chr(13)']) {
    assert.ok(sql.includes(chr), `precisa limpar ${chr}`)
  }
})

// ─── A subquery de resolucao ─────────────────────────────────────────────────────────────

test('sqlResolverNichoId: escopa pela empresa da PROPRIA linha, nunca casa entre tenants', () => {
  const sql = N.sqlResolverNichoId({ empresaCol: 'empresa_id', nichoCol: 'nicho' })
  assert.match(sql, /n\.empresa_id\s*=\s*empresa_id/)
  assert.match(sql, /LIMIT 1/)
})

test('sqlResolverNichoId: usa a MESMA expressao de casamento, nao uma segunda copia', () => {
  const sql = N.sqlResolverNichoId({ empresaCol: 'p.empresa_id', nichoCol: 'p.nicho' })
  assert.equal(sql.includes(N.sqlCasamentoNicho('p.nicho', 'n.nome')), true)
})

test('sqlResolverNichoId: parametros customizados (coluna/placeholder) sao respeitados', () => {
  const sql = N.sqlResolverNichoId({ empresaCol: '$1::uuid', nichoCol: '$2' })
  assert.match(sql, /n\.empresa_id\s*=\s*\$1::uuid/)
  assert.match(sql, /lower\(BTRIM\(\$2,/)
})

// ─── Guardas de regressao: salvamento/aprovacao reusam a mesma fonte ─────────────────────

test('GUARDA: salvarProspect resolve nicho_id ao materializar lead novo sem fuzzy', () => {
  const src = ler('src/prospecting.js')
  const bloco = src.slice(src.indexOf('async function salvarProspect('), src.indexOf('async function salvarProspects'))
  assert.match(src, /SQL_RESOLVER_NICHO_AO_SALVAR = sqlResolverNichoId/)
  assert.match(bloco, /nicho_id\s*\)/, 'INSERT precisa incluir nicho_id')
  assert.match(bloco, /nicho_id = COALESCE\(prospectador\.prospects\.nicho_id, EXCLUDED\.nicho_id\)/,
    'recoleta nao pode mover lead entre equipes em silencio')
})

test('GUARDA: atualizarStatusProspect (aprovar 1 a 1) resolve nicho_id so ao APROVAR', () => {
  const src = ler('src/prospecting.js')
  const bloco = src.slice(src.indexOf('async function atualizarStatusProspect('), src.indexOf('async function atualizarStatusProspectsLote'))
  assert.match(bloco, /SQL_RESOLVER_NICHO_AO_APROVAR/)
  assert.match(bloco, /qualificacao === QUALIFICACAO\.APROVADO/, 'so grava nicho_id quando a decisao e aprovar')
})

test('GUARDA: atualizarStatusProspectsLote (aprovar em lote) resolve nicho_id so ao APROVAR', () => {
  const src = ler('src/prospecting.js')
  const bloco = src.slice(src.indexOf('async function atualizarStatusProspectsLote('), src.indexOf('function calcularPerdaEstimadaProspect'))
  assert.match(bloco, /SQL_RESOLVER_NICHO_AO_APROVAR/)
  assert.match(bloco, /qualificacao === QUALIFICACAO\.APROVADO/)
})

test('GUARDA: aprovarPendentes (Aprovar e distribuir) resolve nicho_id na MESMA instrucao', () => {
  const src = ler('src/db/prospeccao-distribuicao.js')
  const bloco = src.slice(src.indexOf('async function aprovarPendentes'), src.indexOf('async function atribuirSelecionados'))
  assert.match(bloco, /sqlResolverNichoId/)
  assert.match(bloco, /COALESCE\(nicho_id,/, 'nunca sobrescreve um vinculo ja gravado')
})

test('GUARDA: nenhum dos tres pontos define uma SEGUNDA expressao de casamento', () => {
  // Duplicar "lower(BTRIM(...)) = lower(BTRIM(...))" faria os tres divergirem na primeira
  // mudanca — foi essa classe de defeito que a migration/backfill ja documentou.
  for (const arq of ['src/prospecting.js', 'src/db/prospeccao-distribuicao.js']) {
    const src = semComentarios(ler(arq))
    assert.ok(!/lower\(BTRIM\(/.test(src), `${arq} nao pode montar a expressao de casamento por conta propria`)
  }
})

test('GUARDA: a resolucao NUNCA sobrescreve nicho_id ja gravado — sempre COALESCE', () => {
  for (const arq of ['src/prospecting.js', 'src/db/prospeccao-distribuicao.js']) {
    const src = ler(arq)
    if (!src.includes('sqlResolverNichoId') && !src.includes('SQL_RESOLVER_NICHO_AO_APROVAR')) continue
    assert.match(src, /nicho_id\s*=\s*COALESCE\(nicho_id,/, `${arq} precisa envolver a resolucao em COALESCE`)
  }
})

test('GUARDA: o modulo de resolucao e PURO — sem banco, sem HTTP, sem IA', () => {
  const src = semComentarios(ler('src/services/nicho-resolucao.js'))
  for (const proibido of ["require('pg')", 'pool.query', 'axios', 'fetch(', 'generateAIResponse']) {
    assert.ok(!src.includes(proibido), `nicho-resolucao.js nao pode conter '${proibido}'`)
  }
})

test('GUARDA: o backfill (scripts/backfill-prospects-nicho.js) reusa a MESMA fonte, nao duplica', () => {
  const src = ler('scripts/backfill-prospects-nicho.js')
  assert.match(src, /require\(['"]\.\.\/src\/services\/nicho-resolucao['"]\)/)
  const B = require('../scripts/backfill-prospects-nicho')
  assert.equal(B.CASAMENTO, N.sqlCasamentoNicho('p.nicho', 'n.nome'))
})
