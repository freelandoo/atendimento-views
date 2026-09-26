'use strict'

const { pool } = require('../db')

function json(valor) {
  return JSON.stringify(valor == null ? null : valor)
}

function limite(valor, padrao = 50, max = 200) {
  return Math.min(Math.max(Number.parseInt(valor, 10) || padrao, 1), max)
}

async function salvarCache(dados, client = pool) {
  const { rows: [row] } = await client.query(
    `INSERT INTO app.fiscal_cnpj_cache
       (cnpj_digits, razao_social, nome_fantasia, situacao_cadastral, cnae_principal,
        cnae_descricao, municipio, uf, endereco, qsa, fonte, dados, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,NOW())
     ON CONFLICT (cnpj_digits) DO UPDATE SET
       razao_social = EXCLUDED.razao_social,
       nome_fantasia = EXCLUDED.nome_fantasia,
       situacao_cadastral = EXCLUDED.situacao_cadastral,
       cnae_principal = EXCLUDED.cnae_principal,
       cnae_descricao = EXCLUDED.cnae_descricao,
       municipio = EXCLUDED.municipio,
       uf = EXCLUDED.uf,
       endereco = EXCLUDED.endereco,
       qsa = EXCLUDED.qsa,
       fonte = EXCLUDED.fonte,
       dados = EXCLUDED.dados,
       atualizado_em = NOW()
     RETURNING *`,
    [
      dados.cnpj_digits,
      dados.razao_social || null,
      dados.nome_fantasia || null,
      dados.situacao_cadastral || null,
      dados.cnae_principal || null,
      dados.cnae_descricao || null,
      dados.municipio || null,
      dados.uf || null,
      json(dados.endereco || null),
      json(dados.qsa || null),
      dados.fonte || 'desconhecida',
      json(dados.dados || null),
    ]
  )
  return row
}

async function buscarCachePorCnpj(cnpjDigits, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM app.fiscal_cnpj_cache WHERE cnpj_digits = $1 LIMIT 1`,
    [cnpjDigits]
  )
  return rows[0] || null
}

async function buscarCachePorNome({ nome, cidade = null, uf = null, limit = 10 } = {}, client = pool) {
  const busca = String(nome || '').trim()
  if (busca.length < 3) return []
  const params = [`%${busca}%`]
  const where = [`(razao_social ILIKE $1 OR nome_fantasia ILIKE $1)`]
  if (uf) { params.push(String(uf).toUpperCase()); where.push(`uf = $${params.length}`) }
  if (cidade) { params.push(String(cidade)); where.push(`municipio ILIKE $${params.length}`) }
  params.push(limite(limit, 10, 50))
  const { rows } = await client.query(
    `SELECT *
       FROM app.fiscal_cnpj_cache
      WHERE ${where.join(' AND ')}
      ORDER BY atualizado_em DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

async function registrarCruzamento(dados, client = pool) {
  const { rows: [row] } = await client.query(
    `INSERT INTO app.fiscal_cruzamentos
       (empresa_id, prospect_id, lead_numero, origem, nome_informado, cidade_informada,
        uf_informada, cnpj_digits, status, fonte, confianca, custo_creditos, erro,
        resultado, consultado_por)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::uuid)
     RETURNING *`,
    [
      dados.empresa_id || null,
      dados.prospect_id || null,
      dados.lead_numero || null,
      dados.origem || 'manual',
      dados.nome_informado || null,
      dados.cidade_informada || null,
      dados.uf_informada || null,
      dados.cnpj_digits || null,
      dados.status,
      dados.fonte,
      Math.max(0, Math.min(100, Number.parseInt(dados.confianca, 10) || 0)),
      Math.max(0, Number.parseInt(dados.custo_creditos, 10) || 0),
      dados.erro || null,
      json(dados.resultado || null),
      dados.consultado_por || null,
    ]
  )
  return row
}

async function listarCruzamentos({ status = null, limit = 50 } = {}, client = pool) {
  const params = []
  const where = []
  if (status) { params.push(status); where.push(`fc.status = $${params.length}`) }
  params.push(limite(limit))
  const { rows } = await client.query(
    `SELECT fc.*, e.nome AS empresa_nome, u.nome AS consultado_por_nome
       FROM app.fiscal_cruzamentos fc
       LEFT JOIN app.empresas e ON e.id = fc.empresa_id
       LEFT JOIN app.usuarios u ON u.id = fc.consultado_por
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY fc.consultado_em DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

async function resumo(client = pool) {
  const [{ rows: [r] }, { rows: recentes }] = await Promise.all([
    client.query(
      `SELECT
         COUNT(*)::int AS total_cruzamentos,
         COUNT(*) FILTER (WHERE status IN ('encontrado','possivel'))::int AS encontrados,
         COUNT(*) FILTER (WHERE status = 'erro')::int AS erros,
         COALESCE(SUM(custo_creditos), 0)::int AS creditos_total,
         COALESCE(SUM(custo_creditos) FILTER (WHERE consultado_em >= date_trunc('day', NOW())), 0)::int AS creditos_hoje,
         (SELECT COUNT(*)::int FROM app.fiscal_cnpj_cache) AS cnpjs_em_cache`
    ),
    listarCruzamentos({ limit: 12 }, client),
  ])
  return { ...r, recentes }
}

module.exports = {
  salvarCache,
  buscarCachePorCnpj,
  buscarCachePorNome,
  registrarCruzamento,
  listarCruzamentos,
  resumo,
}
