const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const { ORIGENS, GRUPOS, origensDoFiltro, grupoDaOrigem, usaReguaPlaces } = require('../src/services/lead-origem')

const raiz = path.join(__dirname, '..')
const mig091 = fs.readFileSync(path.join(raiz, 'sql', 'migrations', '091_leads_meta_ads.sql'), 'utf8')
const fonteRota = fs.readFileSync(path.join(raiz, 'src', 'routes', 'api-banco-leads.js'), 'utf8')
const fonteModulo = fs.readFileSync(path.join(raiz, 'src', 'services', 'lead-origem.js'), 'utf8')

// ── ANTI-DRIFT contra a CHECK do banco ────────────────────────────────────────
// A CHECK e' a unica lista que o Postgres respeita. Se ela alargar e este modulo nao, a origem
// nova entra no banco e desaparece de todo filtro — que e' exatamente o que aconteceu com
// `meta_ads` entre a migration 091 e esta correcao.
test('ORIGENS bate com a CHECK prospects_origem_chk (migration 091)', () => {
  const m = mig091.match(/prospects_origem_chk[\s\S]*?\bIN\s*\(([^)]*)\)/)
  assert.ok(m, 'nao achei a CHECK de origem na migration 091')
  const noSql = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual([...ORIGENS].sort(), noSql.sort(),
    'lead-origem.js divergiu da CHECK: origem nova precisa entrar nos DOIS lados, no mesmo diff')
})

test('todo grupo aponta apenas para origens que existem na CHECK', () => {
  for (const [grupo, origens] of Object.entries(GRUPOS)) {
    for (const o of origens) {
      assert.ok(ORIGENS.includes(o), `grupo "${grupo}" aponta para origem inexistente: ${o}`)
    }
  }
})

test('toda origem da CHECK e alcancavel por algum filtro', () => {
  for (const o of ORIGENS) {
    assert.ok(origensDoFiltro(o), `origem "${o}" nao e alcancavel por filtro nenhum`)
  }
})

// ── O defeito relatado ────────────────────────────────────────────────────────
test('meta_ads e um filtro de verdade (antes era ignorado em silencio)', () => {
  assert.deepEqual(origensDoFiltro('meta_ads'), ['meta_ads'])
})

test('meta_ads NAO e tratado como Instagram', () => {
  assert.equal(grupoDaOrigem('meta_ads'), 'meta_ads')
  assert.ok(!GRUPOS.instagram.includes('meta_ads'))
  assert.ok(!GRUPOS.social.includes('meta_ads'), 'o alias legado "social" nao pode absorver a Meta')
})

// ── Ausencia de filtro e' `null`, nunca lista vazia ───────────────────────────
// Lista vazia viraria `origem = ANY('{}')`, que nao casa com lead nenhum: o operador digitaria
// um valor errado e a carteira apareceria VAZIA em vez de inteira.
test('valor vazio ou desconhecido devolve null (sem filtro), nunca lista vazia', () => {
  for (const v of ['', null, undefined, '   ', 'tiktok', 'places ou instagram']) {
    assert.equal(origensDoFiltro(v), null, `"${v}" deveria significar "sem filtro"`)
  }
})

test('grupos e aliases continuam valendo (link salvo e filtro em sessao nao quebram)', () => {
  assert.deepEqual(origensDoFiltro('places'), ['manual', 'automatico'])
  assert.deepEqual(origensDoFiltro('social'), ['instagram', 'linkedin'])
  assert.deepEqual(origensDoFiltro('instagram'), ['instagram'])
  assert.deepEqual(origensDoFiltro('PLACES'), ['manual', 'automatico'], 'o valor vem da URL: caixa nao pode importar')
})

// ── Regua de cadastro ─────────────────────────────────────────────────────────
test('a regua de Places cobre manual e automatico, e mais ninguem', () => {
  assert.equal(usaReguaPlaces('manual'), true)
  assert.equal(usaReguaPlaces('automatico'), true)
  for (const o of ['instagram', 'linkedin', 'meta_ads']) assert.equal(usaReguaPlaces(o), false)
})

test('origem desconhecida nao vira Instagram nem Places', () => {
  assert.equal(grupoDaOrigem('tiktok'), 'desconhecida')
  assert.equal(grupoDaOrigem(''), 'desconhecida')
  assert.equal(usaReguaPlaces('tiktok'), false)
})

// ── Guardas de regressao que leem o fonte ─────────────────────────────────────
test('a rota nao guarda mais a sua propria lista de origens', () => {
  assert.ok(!/ORIGENS_VALIDAS/.test(fonteRota),
    'api-banco-leads.js voltou a ter lista propria de origens — foi assim que meta_ads ficou de fora')
  assert.ok(!/const ORIGENS_PLACES\s*=/.test(fonteRota),
    'api-banco-leads.js voltou a definir ORIGENS_PLACES por conta propria')
})

// O cabecalho do modulo CITA esses campos para dizer que nao os usa — por isso a guarda inspeciona
// so' o codigo, com os comentarios removidos (mesma disciplina da guarda de SQL em follow-ups).
const codigoDoModulo = fonteModulo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('o modulo nao DEDUZ origem a partir de dado do lead', () => {
  for (const campo of ['instagram_handle', 'place_id', 'link_original', 'maps_url', 'classificarLead']) {
    assert.ok(!codigoDoModulo.includes(campo),
      `lead-origem.js passou a ler "${campo}": origem e' o que o coletor gravou, nunca deducao`)
  }
})

test('o modulo e PURO — sem banco, HTTP, IA ou rede', () => {
  assert.ok(!/require\(/.test(codigoDoModulo), 'lead-origem.js passou a importar algo: ele nao pode ter dependencia')
})
