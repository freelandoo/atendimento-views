'use strict'
// Acesso a banco do POOL do trial. As REGRAS (elegibilidade, teto) vivem em
// services/pool-trial.js; aqui só há SQL. ⚠️ D21: a leitura é CROSS-TENANT de propósito (sem
// filtro de empresa) — mas SÓ de leads SEM DONO, via `sqlElegivel`. A ESCRITA (puxar) grava na
// empresa do trial. A conexão roda no timezone do app (db.js), então `::date` é o dia local.
const { pool } = require('../db')
const { sqlElegivel } = require('../services/pool-trial')

// Mercados (nicho+cidade+uf) disponíveis no pool — o seletor da busca do trial só oferece o que
// existe (nada de prometer busca onde não há dado).
async function mercadosDoPool({ limite = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT nicho, cidade, uf, COUNT(*)::int AS leads
       FROM prospectador.prospects p
      WHERE ${sqlElegivel('p')}
      GROUP BY nicho, cidade, uf
      ORDER BY leads DESC, nicho ASC
      LIMIT $1`,
    [limite]
  )
  return rows
}

// Leads elegíveis do pool, por mercado. CROSS-TENANT (D21) — nenhum filtro de empresa.
async function listarPool({ nicho, cidade, uf, limite = 30 } = {}) {
  const cond = []
  const params = []
  if (nicho) { params.push(nicho); cond.push(`p.nicho = $${params.length}`) }
  if (cidade) { params.push(cidade); cond.push(`p.cidade = $${params.length}`) }
  if (uf) { params.push(uf); cond.push(`p.uf = $${params.length}`) }
  params.push(limite)
  const filtro = cond.length ? `AND ${cond.join(' AND ')}` : ''
  const { rows } = await pool.query(
    `SELECT id, nome, telefone, nicho, cidade, uf, endereco, rating, avaliacoes, tem_site, site, maps_url
       FROM prospectador.prospects p
      WHERE ${sqlElegivel('p')} ${filtro}
      ORDER BY p.rating DESC NULLS LAST, p.avaliacoes DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  )
  return rows
}

// Quantos leads a empresa já puxou do pool HOJE (reusa auditoria — sem tabela nova).
async function puxadasHoje(empresaId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app.auditoria_eventos
      WHERE empresa_id = $1 AND acao = 'pool_trial_lead_puxado' AND criado_em::date = NOW()::date`,
    [empresaId]
  )
  return rows[0] ? rows[0].n : 0
}

// Copia um lead do pool para a empresa do trial (linha própria), ATOMICO:
//  1. re-confere elegibilidade da fonte (não puxar o que virou de alguém entre a lista e o clique);
//  2. INSERT...SELECT das colunas PÚBLICAS, dono = empresa do trial, qualificacao 'aprovado'
//     (trabalhável), status 'aguardando'; ON CONFLICT (empresa_id, place_id) DO NOTHING;
//  3. audita `pool_trial_lead_puxado` — é o que conta o teto diário.
// Retorna { resultado: 'puxado'|'ja_tinha'|'nao_elegivel', prospectId? }.
async function puxarDoPool({ empresaId, prospectId, usuarioId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: elig } = await client.query(
      `SELECT 1 FROM prospectador.prospects p WHERE p.id = $1 AND ${sqlElegivel('p')} FOR UPDATE`,
      [prospectId]
    )
    if (!elig[0]) { await client.query('ROLLBACK'); return { resultado: 'nao_elegivel' } }
    const { rows: ins } = await client.query(
      `INSERT INTO prospectador.prospects
         (empresa_id, place_id, nome, telefone, nicho, cidade, uf, pais, endereco, avaliacoes, rating,
          tem_site, site, link_original, classificacao_url, maps_url, origem, status, qualificacao, raw_json)
       SELECT $1, place_id, nome, telefone, nicho, cidade, uf, pais, endereco, avaliacoes, rating,
          tem_site, site, link_original, classificacao_url, maps_url, origem, 'aguardando', 'aprovado', raw_json
         FROM prospectador.prospects WHERE id = $2
       ON CONFLICT (empresa_id, place_id) DO NOTHING
       RETURNING id`,
      [empresaId, prospectId]
    )
    const novo = ins[0]
    if (!novo) { await client.query('ROLLBACK'); return { resultado: 'ja_tinha' } }
    await client.query(
      `INSERT INTO app.auditoria_eventos (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, contexto)
       VALUES ($1, $2, 'prospect', $3, 'pool_trial_lead_puxado', $4::jsonb)`,
      [empresaId, usuarioId || null, novo.id, JSON.stringify({ origem_prospect_id: prospectId })]
    )
    await client.query('COMMIT')
    return { resultado: 'puxado', prospectId: novo.id }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { mercadosDoPool, listarPool, puxadasHoje, puxarDoPool }
