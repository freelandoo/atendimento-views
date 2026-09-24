'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  adicionarFiltroMercado,
  termoBuscaProspect,
  normalizarOrigemFiltro,
  normalizarFiltroSite,
  normalizarFiltroRedeSocial,
  listarOpcoesFiltrosMercado,
} = require('../src/services/prospect-filters')

test('prospect filters: mercado consulta nicho ou categoria_perfil com SQL parametrizado', () => {
  const where = ['p.empresa_id = $1']
  const params = ['empresa-1']

  adicionarFiltroMercado(where, params, { mercado: 'barbearia', cidade: 'Santo Andre', pais: 'pt' }, { alias: 'p' })

  assert.equal(params.length, 4)
  assert.equal(params[1], '%barbearia%')
  assert.equal(params[2], '%Santo Andre%')
  assert.equal(params[3], 'PT')
  assert.match(where.join(' AND '), /\(p\.nicho ILIKE \$2 OR p\.categoria_perfil ILIKE \$2\)/)
  assert.match(where.join(' AND '), /p\.cidade ILIKE \$3/)
  assert.match(where.join(' AND '), /UPPER\(p\.pais\) = \$4/)
})

test('prospect filters: aceita nicho ou categoria como aliases de mercado', () => {
  const whereNicho = []
  const paramsNicho = []
  adicionarFiltroMercado(whereNicho, paramsNicho, { nicho: 'dentistas' })

  const whereCategoria = []
  const paramsCategoria = []
  adicionarFiltroMercado(whereCategoria, paramsCategoria, { categoria: 'clinica' })

  assert.equal(paramsNicho[0], '%dentistas%')
  assert.match(whereNicho[0], /nicho ILIKE \$1 OR categoria_perfil ILIKE \$1/)
  assert.equal(paramsCategoria[0], '%clinica%')
  assert.match(whereCategoria[0], /nicho ILIKE \$1 OR categoria_perfil ILIKE \$1/)
})

test('prospect filters: termoBuscaProspect normaliza busca, q ou pesquisa', () => {
  assert.equal(termoBuscaProspect({ busca: '  lead  ' }), 'lead')
  assert.equal(termoBuscaProspect({ q: '  mercado  ' }), 'mercado')
  assert.equal(termoBuscaProspect({ pesquisa: '  cidade  ' }), 'cidade')
})

test('prospect filters: opcoes de mercado ficam escopadas por empresa, origem e status', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [{ valor: 'barbearia', total: 2 }] }
    },
  }

  const out = await listarOpcoesFiltrosMercado(pool, {
    empresaId: 'empresa-1',
    origemIn: ['manual', 'automatico'],
    statusAny: ['aguardando', 'aprovado'],
    limit: 10,
  })

  assert.equal(out.nichos[0].valor, 'barbearia')
  assert.equal(queries.length, 4)
  for (const q of queries) {
    assert.match(q.sql, /empresa_id = \$1/)
    assert.match(q.sql, /origem = ANY\(\$2\)/)
    assert.match(q.sql, /status = ANY\(\$3\)/)
    assert.deepEqual(q.params, ['empresa-1', ['manual', 'automatico'], ['aguardando', 'aprovado'], 10])
  }
})

test('prospect filters: opcoes de mercado respeitam carteira e porta de aprovados', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [] }
    },
  }

  await listarOpcoesFiltrosMercado(pool, {
    empresaId: 'empresa-1',
    escopoSql: '(responsavel_id = $1 OR responsavel_id IS NULL)',
    escopoUsaUsuario: true,
    usuarioId: 'usuario-1',
    somenteAprovados: true,
    limit: 5,
  })

  assert.equal(queries.length, 4)
  for (const q of queries) {
    assert.match(q.sql, /empresa_id = \$1/)
    assert.match(q.sql, /\(responsavel_id = \$2 OR responsavel_id IS NULL\)/)
    assert.match(q.sql, /qualificacao = 'aprovado'/)
    assert.deepEqual(q.params, ['empresa-1', 'usuario-1', 5])
  }
})

test('prospect filters: opcoes de mercado respeitam recorte por nicho da equipe', async () => {
  const queries = []
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [] }
    },
  }

  await listarOpcoesFiltrosMercado(pool, {
    empresaId: 'empresa-1',
    nichoEquipeId: '00000000-0000-4000-8000-000000000001',
    limit: 5,
  })

  assert.equal(queries.length, 4)
  for (const q of queries) {
    assert.match(q.sql, /empresa_id = \$1/)
    assert.match(q.sql, /nicho_id = \$2::uuid/)
    assert.deepEqual(q.params, ['empresa-1', '00000000-0000-4000-8000-000000000001', 5])
  }
})

// A origem e' normalizada num lugar so: a listagem (/prospects) e a contagem por status
// (/metricas) precisam recortar o MESMO universo, senao o numero do filtro nao bate com a lista.
// ⚠️ ESTES DOIS TESTES FORAM REESCRITOS EM 2026-09-22, e o que eles afirmavam antes era o
// DEFEITO: "desconhecido cai em manual". Com aquela regra, `?origem=instagram` virava
// `WHERE origem = 'manual'` e a Aquisicao devolvia leads do Google Places para quem pediu
// Instagram — em silencio. O normalizador passou a delegar ao dono do vocabulario
// (`services/lead-origem.js`), que e' travado contra a CHECK `prospects_origem_chk`.
test('prospect filters: cada origem alcanca o que ela promete', () => {
  assert.deepEqual(normalizarOrigemFiltro('automatico'), ['automatico'])
  assert.deepEqual(normalizarOrigemFiltro('  AUTOMATICO '), ['automatico'])
  assert.deepEqual(normalizarOrigemFiltro('manual'), ['manual'])
  assert.deepEqual(normalizarOrigemFiltro('meta_ads'), ['meta_ads'])
  assert.deepEqual(normalizarOrigemFiltro('  META_ADS '), ['meta_ads'])
  // O que o defeito escondia: as duas origens sociais agora recortam de verdade.
  assert.deepEqual(normalizarOrigemFiltro('instagram'), ['instagram'])
  assert.deepEqual(normalizarOrigemFiltro('places'), ['manual', 'automatico'])
})

test('prospect filters: origem desconhecida NAO vira outra origem', () => {
  // Antes, "rotina" e "qualquer-coisa" viravam `manual` e a tela mostrava lead de Places
  // afirmando ser outra coisa. Hoje o filtro simplesmente nao entra no WHERE.
  assert.equal(normalizarOrigemFiltro('rotina'), null)
  assert.equal(normalizarOrigemFiltro('qualquer-coisa'), null)
})

test('prospect filters: origem vazia nao filtra nada — e nunca devolve lista vazia', () => {
  // `null` e nao `[]`: `origem = ANY('{}')` nao casa com lead nenhum e esvaziaria a tela.
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(normalizarOrigemFiltro(v), null, `"${v}" deveria significar "sem filtro"`)
  }
})

test('prospect filters: filtros de presenca digital aceitam apenas com ou sem', () => {
  assert.equal(normalizarFiltroSite('com'), 'com')
  assert.equal(normalizarFiltroSite(' SEM '), 'sem')
  assert.equal(normalizarFiltroSite('talvez'), '')
  assert.equal(normalizarFiltroSite(null), '')

  assert.equal(normalizarFiltroRedeSocial('com'), 'com')
  assert.equal(normalizarFiltroRedeSocial(' SEM '), 'sem')
  assert.equal(normalizarFiltroRedeSocial('ativa'), '')
  assert.equal(normalizarFiltroRedeSocial(undefined), '')
})
