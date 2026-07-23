'use strict'

function normalizarTexto(valor, max = 160) {
  return String(valor == null ? '' : valor).trim().slice(0, max)
}

function adicionarFiltroMercado(where, params, query = {}, options = {}) {
  const alias = options.alias ? `${options.alias}.` : ''
  const mercado = normalizarTexto(query.mercado || query.nicho || query.categoria, 160)
  const cidade = normalizarTexto(query.cidade || query.local, 160)

  if (mercado) {
    params.push(`%${mercado}%`)
    const i = params.length
    where.push(`(${alias}nicho ILIKE $${i} OR ${alias}categoria_perfil ILIKE $${i})`)
  }

  if (cidade) {
    params.push(`%${cidade}%`)
    where.push(`${alias}cidade ILIKE $${params.length}`)
  }
}

function termoBuscaProspect(query = {}) {
  return normalizarTexto(query.busca || query.q || query.pesquisa, 160)
}

async function listarOpcoesFiltrosMercado(pool, {
  empresaId,
  origem,
  origemIn,
  statusAny,
  status,
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

  params.push(Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200))
  const limitParam = params.length
  const whereSql = where.join(' AND ')

  const [nichos, categorias, cidades] = await Promise.all([
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
  ])

  return {
    nichos: nichos.rows,
    categorias: categorias.rows,
    cidades: cidades.rows,
  }
}

module.exports = {
  normalizarTexto,
  adicionarFiltroMercado,
  termoBuscaProspect,
  listarOpcoesFiltrosMercado,
}
