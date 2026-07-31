'use strict'
// Roteiros humanos versionados (modulo Prospeccao & Inteligencia Comercial). Acesso a
// banco ISOLADO por empresa (tenant): TODA query filtra empresa_id. Regra central de
// IMUTABILIDADE: versao 'publicada'/'arquivada' nunca muda — editar cria nova versao.
// Tabelas: app.roteiros / app.roteiro_versoes / app.roteiro_etapas (migration 033).
const { ROTEIRO_ETAPA_TIPO } = require('../domain-enums')

const TIPOS = new Set(ROTEIRO_ETAPA_TIPO)

function erroEntrada(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

// --- Validacao PURA (testavel sem banco) -----------------------------------------
function asLista(v) { return Array.isArray(v) ? v : [] }

function validarEtapas(etapasRaw) {
  if (!Array.isArray(etapasRaw)) throw erroEntrada('etapas deve ser uma lista.')
  const ordensVistas = new Set()
  return etapasRaw.map((e, i) => {
    const tipo = String(e?.tipo || '').trim()
    if (!TIPOS.has(tipo)) throw erroEntrada(`etapa ${i + 1}: tipo invalido (${tipo || 'vazio'}).`)
    const ordem = Number.isInteger(e?.ordem) ? e.ordem : i + 1
    if (ordem < 1) throw erroEntrada(`etapa ${i + 1}: ordem deve ser >= 1.`)
    if (ordensVistas.has(ordem)) throw erroEntrada(`ordem duplicada (${ordem}).`)
    ordensVistas.add(ordem)
    const txt = (v, max) => (v != null && String(v).trim() ? String(v).slice(0, max) : null)
    return {
      ordem,
      tipo,
      titulo: txt(e.titulo, 200),
      objetivo: txt(e.objetivo, 2000),
      frase_sugerida: txt(e.frase_sugerida, 2000),
      perguntas: asLista(e.perguntas).map(String).slice(0, 50),
      sinais_interesse: asLista(e.sinais_interesse).map(String).slice(0, 50),
      sinais_resistencia: asLista(e.sinais_resistencia).map(String).slice(0, 50),
      objecoes: asLista(e.objecoes).slice(0, 50), // [{objecao, resposta}]
    }
  })
}

async function withTx(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw e
  } finally {
    client.release()
  }
}

// --- CRUD (sempre tenant-scoped) --------------------------------------------------
async function listarRoteiros(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.nome, r.descricao, r.nicho, r.ativo, r.criado_em, r.atualizado_em,
            (SELECT v.versao FROM app.roteiro_versoes v
              WHERE v.roteiro_id = r.id AND v.status = 'publicada'
              ORDER BY v.versao DESC LIMIT 1) AS versao_publicada,
            (SELECT COUNT(*)::int FROM app.roteiro_versoes v WHERE v.roteiro_id = r.id) AS total_versoes
       FROM app.roteiros r
      WHERE r.empresa_id = $1
      ORDER BY r.atualizado_em DESC`,
    [empresaId]
  )
  return rows
}

// Cria o roteiro + a versao 1 (rascunho) numa unica operacao atomica.
async function criarRoteiro(pool, empresaId, { nome, descricao, nicho, criadoPor } = {}) {
  const n = String(nome || '').trim()
  if (!n) throw erroEntrada('nome e obrigatorio.')
  const { rows } = await pool.query(
    `WITH r AS (
       INSERT INTO app.roteiros (empresa_id, nome, descricao, nicho, criado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, descricao, nicho, ativo, criado_em
     ), v AS (
       INSERT INTO app.roteiro_versoes (roteiro_id, empresa_id, versao, status, criado_por)
       SELECT id, $1, 1, 'rascunho', $5 FROM r
       RETURNING id, versao, status
     )
     SELECT r.id AS roteiro_id, r.nome, r.descricao, r.nicho,
            v.id AS versao_id, v.versao, v.status
       FROM r, v`,
    [empresaId, n, descricao != null ? String(descricao).slice(0, 2000) : null,
      nicho != null ? String(nicho).slice(0, 120) : null, criadoPor || null]
  )
  return rows[0]
}

async function obterRoteiro(pool, empresaId, roteiroId) {
  const { rows } = await pool.query(
    `SELECT id, nome, descricao, nicho, ativo, criado_em, atualizado_em
       FROM app.roteiros WHERE id = $1 AND empresa_id = $2`,
    [roteiroId, empresaId]
  )
  if (!rows[0]) return null
  const { rows: versoes } = await pool.query(
    `SELECT id, versao, status, criado_em, publicada_em, arquivada_em
       FROM app.roteiro_versoes WHERE roteiro_id = $1 AND empresa_id = $2
      ORDER BY versao DESC`,
    [roteiroId, empresaId]
  )
  return { ...rows[0], versoes }
}

async function obterVersaoComEtapas(pool, empresaId, versaoId) {
  const { rows } = await pool.query(
    `SELECT id, roteiro_id, versao, status, criado_em, publicada_em, arquivada_em
       FROM app.roteiro_versoes WHERE id = $1 AND empresa_id = $2`,
    [versaoId, empresaId]
  )
  if (!rows[0]) return null
  const { rows: etapas } = await pool.query(
    `SELECT id, ordem, tipo, titulo, objetivo, frase_sugerida,
            perguntas_json, sinais_interesse_json, sinais_resistencia_json, objecoes_json
       FROM app.roteiro_etapas WHERE versao_id = $1 AND empresa_id = $2
      ORDER BY ordem ASC`,
    [versaoId, empresaId]
  )
  return { ...rows[0], etapas }
}

// Cria nova versao (rascunho); opcionalmente COPIA as etapas de uma versao base.
async function criarNovaVersao(pool, empresaId, roteiroId, { basearEmVersaoId = null, criadoPor = null } = {}) {
  const { rows: rr } = await pool.query(
    `SELECT id FROM app.roteiros WHERE id = $1 AND empresa_id = $2`, [roteiroId, empresaId]
  )
  if (!rr[0]) throw erroEntrada('Roteiro nao encontrado.', 404)
  return withTx(pool, async (client) => {
    const { rows: nv } = await client.query(
      `INSERT INTO app.roteiro_versoes (roteiro_id, empresa_id, versao, status, criado_por)
       SELECT $1, $2, COALESCE(MAX(versao), 0) + 1, 'rascunho', $3
         FROM app.roteiro_versoes WHERE roteiro_id = $1 AND empresa_id = $2
       RETURNING id, versao`,
      [roteiroId, empresaId, criadoPor]
    )
    const novaId = nv[0].id
    if (basearEmVersaoId) {
      // So copia se a versao base for do MESMO tenant (empresa_id no WHERE).
      await client.query(
        `INSERT INTO app.roteiro_etapas
           (versao_id, empresa_id, ordem, tipo, titulo, objetivo, frase_sugerida,
            perguntas_json, sinais_interesse_json, sinais_resistencia_json, objecoes_json)
         SELECT $1, empresa_id, ordem, tipo, titulo, objetivo, frase_sugerida,
                perguntas_json, sinais_interesse_json, sinais_resistencia_json, objecoes_json
           FROM app.roteiro_etapas WHERE versao_id = $2 AND empresa_id = $3`,
        [novaId, basearEmVersaoId, empresaId]
      )
    }
    return { versao_id: novaId, versao: nv[0].versao, status: 'rascunho' }
  })
}

// Substitui as etapas de uma versao — SO se ela estiver 'rascunho' (imutabilidade).
async function salvarEtapas(pool, empresaId, versaoId, etapasRaw) {
  const etapas = validarEtapas(etapasRaw)
  const { rows } = await pool.query(
    `SELECT id, status FROM app.roteiro_versoes WHERE id = $1 AND empresa_id = $2`,
    [versaoId, empresaId]
  )
  const v = rows[0]
  if (!v) throw erroEntrada('Versao nao encontrada.', 404)
  if (v.status !== 'rascunho') {
    throw erroEntrada('Versao publicada/arquivada e imutavel — crie uma nova versao para editar.', 409)
  }
  return withTx(pool, async (client) => {
    await client.query(
      `DELETE FROM app.roteiro_etapas WHERE versao_id = $1 AND empresa_id = $2`,
      [versaoId, empresaId]
    )
    for (const e of etapas) {
      await client.query(
        `INSERT INTO app.roteiro_etapas
           (versao_id, empresa_id, ordem, tipo, titulo, objetivo, frase_sugerida,
            perguntas_json, sinais_interesse_json, sinais_resistencia_json, objecoes_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
        [versaoId, empresaId, e.ordem, e.tipo, e.titulo, e.objetivo, e.frase_sugerida,
          JSON.stringify(e.perguntas), JSON.stringify(e.sinais_interesse),
          JSON.stringify(e.sinais_resistencia), JSON.stringify(e.objecoes)]
      )
    }
    return { versao_id: versaoId, etapas: etapas.length }
  })
}

// Publica a versao (rascunho -> publicada) e ARQUIVA a versao publicada anterior do
// mesmo roteiro (mantem 1 "atual"). Historico preservado: ligacoes apontam versao fixa.
async function publicarVersao(pool, empresaId, versaoId) {
  const { rows } = await pool.query(
    `WITH pub AS (
       UPDATE app.roteiro_versoes SET status = 'publicada', publicada_em = NOW()
        WHERE id = $1 AND empresa_id = $2 AND status = 'rascunho'
        RETURNING id, roteiro_id
     ), arch AS (
       UPDATE app.roteiro_versoes SET status = 'arquivada', arquivada_em = NOW()
        WHERE empresa_id = $2 AND status = 'publicada'
          AND roteiro_id = (SELECT roteiro_id FROM pub) AND id <> $1
        RETURNING id
     )
     SELECT p.id, p.roteiro_id, (SELECT COUNT(*)::int FROM arch) AS arquivadas
       FROM pub p`,
    [versaoId, empresaId]
  )
  if (!rows[0]) throw erroEntrada('Versao nao encontrada ou nao esta em rascunho.', 409)
  return rows[0]
}

async function arquivarVersao(pool, empresaId, versaoId) {
  const { rows } = await pool.query(
    `UPDATE app.roteiro_versoes SET status = 'arquivada', arquivada_em = NOW()
      WHERE id = $1 AND empresa_id = $2 AND status <> 'arquivada'
      RETURNING id`,
    [versaoId, empresaId]
  )
  if (!rows[0]) throw erroEntrada('Versao nao encontrada.', 404)
  return { id: rows[0].id }
}

module.exports = {
  validarEtapas,
  listarRoteiros,
  criarRoteiro,
  obterRoteiro,
  obterVersaoComEtapas,
  criarNovaVersao,
  salvarEtapas,
  publicarVersao,
  arquivarVersao,
}
