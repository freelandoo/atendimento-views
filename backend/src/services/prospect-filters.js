'use strict'
const { origensDoFiltro } = require('./lead-origem')
const { normalizarPais } = require('./paises')
const { sqlNichoDaEquipe } = require('./equipes-comerciais')

function normalizarTexto(valor, max = 160) {
  return String(valor == null ? '' : valor).trim().slice(0, max)
}

function adicionarFiltroMercado(where, params, query = {}, options = {}) {
  const alias = options.alias ? `${options.alias}.` : ''
  const mercado = normalizarTexto(query.mercado || query.nicho || query.categoria, 160)
  const cidade = normalizarTexto(query.cidade || query.local, 160)
  const pais = normalizarTexto(query.pais || query.country, 8)

  if (mercado) {
    params.push(`%${mercado}%`)
    const i = params.length
    where.push(`(${alias}nicho ILIKE $${i} OR ${alias}categoria_perfil ILIKE $${i})`)
  }

  if (cidade) {
    params.push(`%${cidade}%`)
    where.push(`${alias}cidade ILIKE $${params.length}`)
  }

  if (pais) {
    params.push(normalizarPais(pais))
    where.push(`UPPER(${alias}pais) = $${params.length}`)
  }
}

function termoBuscaProspect(query = {}) {
  return normalizarTexto(query.busca || query.q || query.pesquisa, 160)
}

/**
 * Origem do prospect no recorte da listagem — delega ao DONO do vocabulário
 * (`services/lead-origem.js`, travado contra a CHECK `prospects_origem_chk`).
 *
 * ⚠️ DEFEITO CORRIGIDO (2026-09-22): a versão anterior mandava **qualquer valor não vazio que
 * não fosse `meta_ads`/`automatico` para `'manual'`**. Ou seja, `?origem=instagram` virava
 * `WHERE origem = 'manual'` — a Aquisição respondia com leads do Google Places para quem pediu
 * Instagram, em silêncio. É a MESMA classe do defeito que `ORIGENS_VALIDAS` tinha no Banco de
 * Leads, e some pelo mesmo caminho: o vocabulário tem um dono só.
 *
 * Devolve uma LISTA de origens (grupo ou origem isolada), ou `null` para "sem filtro". `null`
 * e nunca lista vazia: `origem = ANY('{}')` não casa com lead nenhum e esvaziaria a tela em vez
 * de ignorar um valor desconhecido.
 *
 * Vive aqui, junto dos demais filtros, porque a listagem e a contagem por status precisam
 * recortar exatamente o mesmo universo — duas normalizações diferentes dariam dois números.
 */
function normalizarOrigemFiltro(v) {
  return origensDoFiltro(v)
}

function normalizarFiltroSite(v) {
  const filtro = String(v || '').trim().toLowerCase()
  return filtro === 'com' || filtro === 'sem' ? filtro : ''
}

function normalizarFiltroRedeSocial(v) {
  const filtro = String(v || '').trim().toLowerCase()
  return filtro === 'com' || filtro === 'sem' ? filtro : ''
}

async function listarOpcoesFiltrosMercado(pool, {
  empresaId,
  origem,
  origemIn,
  statusAny,
  status,
  escopoSql,
  escopoUsaUsuario = false,
  usuarioId = null,
  nichoEquipeId = null,
  somenteAprovados = false,
  somenteSociais = false,
  limit = 80,
} = {}) {
  const params = [empresaId]
  const where = [`empresa_id = $1`]

  if (somenteSociais) {
    where.push(`origem IN ('instagram','linkedin')`)
  }

  if (Array.isArray(origemIn) && origemIn.length) {
    params.push(origemIn)
    where.push(`origem = ANY($${params.length})`)
  } else if (origem) {
    params.push(origem)
    where.push(`origem = $${params.length}`)
  }

  if (Array.isArray(statusAny) && statusAny.length) {
    params.push(statusAny)
    where.push(`status = ANY($${params.length})`)
  } else if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }

  if (escopoSql) {
    if (escopoUsaUsuario) params.push(usuarioId)
    where.push(String(escopoSql).replace('$1', `$${params.length}`))
  }

  if (somenteAprovados) {
    where.push(`qualificacao = 'aprovado'`)
  }

  if (nichoEquipeId) {
    params.push(nichoEquipeId)
    where.push(sqlNichoDaEquipe({ placeholder: `$${params.length}` }))
  }

  params.push(Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200))
  const limitParam = params.length
  const whereSql = where.join(' AND ')

  const [nichos, categorias, cidades, paises] = await Promise.all([
    pool.query(
      `SELECT nicho AS valor, COUNT(*)::int AS total
         FROM prospectador.prospects
        WHERE ${whereSql} AND NULLIF(TRIM(nicho), '') IS NOT NULL
        GROUP BY nicho
        ORDER BY total DESC, valor ASC
        LIMIT $${limitParam}`,
      params
    ),
    pool.query(
      `SELECT categoria_perfil AS valor, COUNT(*)::int AS total
         FROM prospectador.prospects
        WHERE ${whereSql} AND NULLIF(TRIM(categoria_perfil), '') IS NOT NULL
        GROUP BY categoria_perfil
        ORDER BY total DESC, valor ASC
        LIMIT $${limitParam}`,
      params
    ),
    pool.query(
      `SELECT cidade AS valor, COUNT(*)::int AS total
         FROM prospectador.prospects
        WHERE ${whereSql} AND NULLIF(TRIM(cidade), '') IS NOT NULL
        GROUP BY cidade
        ORDER BY total DESC, valor ASC
        LIMIT $${limitParam}`,
      params
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(TRIM(pais), ''), 'BR') AS valor, COUNT(*)::int AS total
         FROM prospectador.prospects
        WHERE ${whereSql}
        GROUP BY COALESCE(NULLIF(TRIM(pais), ''), 'BR')
        ORDER BY total DESC, valor ASC
        LIMIT $${limitParam}`,
      params
    ),
  ])

  return {
    nichos: nichos.rows,
    categorias: categorias.rows,
    cidades: cidades.rows,
    paises: paises.rows,
  }
}

module.exports = {
  normalizarTexto,
  adicionarFiltroMercado,
  termoBuscaProspect,
  normalizarOrigemFiltro,
  normalizarFiltroSite,
  normalizarFiltroRedeSocial,
  listarOpcoesFiltrosMercado,
}
