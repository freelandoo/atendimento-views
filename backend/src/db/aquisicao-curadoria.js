'use strict'
// Assistente de Oportunidades (por lead) — acesso a dados.
//
// Só SQL + isolamento por empresa. As regras de fila/aprendizado vivem em
// services/aquisicao-curadoria-ranking.js (puro) e a orquestração em
// services/aquisicao-curadoria.js.
//
// Este módulo NÃO importa leads e NÃO dispara coleta: a Busca avulsa continua sendo a
// única origem de prospects. O que ele faz é mover um lead que já existe de
// 'aguardando' para 'aprovado'/'rejeitado' e registrar por quê.

const SESSAO_COLUNAS = `
  id, empresa_id, usuario_id, nicho, cidade, uf, escopo_ampliado,
  meta, aprovados, descartados, fila_json, status,
  criado_em, atualizado_em, encerrado_em
`

// Decisões antigas descrevem uma operação que talvez não exista mais.
const APRENDIZADO_JANELA_DIAS = 180

function erro(mensagem, statusCode = 400) {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  return e
}

// UUID nulo: o mesmo default do índice único parcial de "uma sessão ativa por operador".
// Sem ele, sessões com usuario_id NULL não colidiriam entre si (NULL nunca é igual a NULL).
const USUARIO_ANONIMO = '00000000-0000-0000-0000-000000000000'

async function obterSessaoAtiva(pool, empresaId, usuarioId = null) {
  const { rows } = await pool.query(
    `SELECT ${SESSAO_COLUNAS}
       FROM prospectador.curadoria_sessoes
      WHERE empresa_id = $1
        AND COALESCE(usuario_id, $2::uuid) = COALESCE($3::uuid, $2::uuid)
        AND status = 'ativa'
      LIMIT 1`,
    [empresaId, USUARIO_ANONIMO, usuarioId]
  )
  return rows[0] || null
}

async function obterSessao(pool, empresaId, sessaoId) {
  const { rows } = await pool.query(
    `SELECT ${SESSAO_COLUNAS} FROM prospectador.curadoria_sessoes
      WHERE empresa_id = $1 AND id = $2::uuid`,
    [empresaId, sessaoId]
  )
  return rows[0] || null
}

/**
 * Abre a sessão. Colidir no índice único (dois cliques no botão) NÃO é erro: devolve a
 * sessão que já estava aberta, que é exatamente o que o operador queria ver.
 */
async function criarSessao(pool, empresaId, { usuarioId = null, nicho = null, cidade = null, uf = null, meta } = {}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO prospectador.curadoria_sessoes (empresa_id, usuario_id, nicho, cidade, uf, meta)
       VALUES ($1, $2::uuid, $3, $4, $5, $6::int)
       RETURNING ${SESSAO_COLUNAS}`,
      [empresaId, usuarioId, nicho, cidade, uf, meta]
    )
    return rows[0]
  } catch (err) {
    if (err && err.code === '23505') {
      const existente = await obterSessaoAtiva(pool, empresaId, usuarioId)
      if (existente) return existente
    }
    throw err
  }
}

async function salvarFila(pool, empresaId, sessaoId, fila) {
  const { rows } = await pool.query(
    `UPDATE prospectador.curadoria_sessoes
        SET fila_json = $3::jsonb, atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'ativa'
      RETURNING ${SESSAO_COLUNAS}`,
    [empresaId, sessaoId, JSON.stringify(Array.isArray(fila) ? fila : [])]
  )
  return rows[0] || null
}

async function ampliarEscopo(pool, empresaId, sessaoId) {
  const { rows } = await pool.query(
    `UPDATE prospectador.curadoria_sessoes
        SET escopo_ampliado = true, fila_json = '[]'::jsonb, atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'ativa'
      RETURNING ${SESSAO_COLUNAS}`,
    [empresaId, sessaoId]
  )
  return rows[0] || null
}

async function encerrarSessao(pool, empresaId, sessaoId, status = 'encerrada') {
  const { rows } = await pool.query(
    `UPDATE prospectador.curadoria_sessoes
        SET status = $3, encerrado_em = NOW(), atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'ativa'
      RETURNING ${SESSAO_COLUNAS}`,
    [empresaId, sessaoId, status]
  )
  return rows[0] || null
}

/**
 * Candidatos da fila: leads DESTA empresa que ainda estão aguardando decisão.
 * `ampliado=false` limita ao mercado da sessão — a cidade casa por PREFIXO porque a
 * coleta grava "Campinas - SP" quando há UF e "Campinas" quando não há.
 */
async function listarCandidatos(pool, empresaId, { nicho = null, cidade = null, ampliado = false, excluirIds = [], limite = 40 } = {}) {
  const where = [`p.empresa_id = $1`, `p.status = 'aguardando'`]
  const params = [empresaId]

  if (!ampliado && nicho) {
    params.push(nicho)
    where.push(`p.nicho ILIKE $${params.length}`)
  }
  if (!ampliado && cidade) {
    params.push(`${cidade}%`)
    where.push(`p.cidade ILIKE $${params.length}`)
  }
  const ids = (Array.isArray(excluirIds) ? excluirIds : []).filter(Boolean)
  if (ids.length) {
    params.push(ids)
    where.push(`p.id <> ALL($${params.length}::uuid[])`)
  }
  params.push(Math.max(1, Math.min(200, parseInt(limite, 10) || 40)))

  const { rows } = await pool.query(
    `SELECT p.*
       FROM prospectador.prospects p
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

// Quantos leads ainda restam para avaliar (usado para dizer "acabaram as opções"
// sem prometer mais do que existe).
async function contarCandidatos(pool, empresaId, { nicho = null, cidade = null, ampliado = false } = {}) {
  const where = [`empresa_id = $1`, `status = 'aguardando'`]
  const params = [empresaId]
  if (!ampliado && nicho) {
    params.push(nicho)
    where.push(`nicho ILIKE $${params.length}`)
  }
  if (!ampliado && cidade) {
    params.push(`${cidade}%`)
    where.push(`cidade ILIKE $${params.length}`)
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM prospectador.prospects WHERE ${where.join(' AND ')}`,
    params
  )
  return rows[0]?.total || 0
}

// Matéria-prima do aprendizado: as decisões desta empresa, da mais recente para a mais
// antiga. Só a característica (faixas) e o veredito — nunca dado do lead.
async function historicoDecisoes(pool, empresaId, limite = 400) {
  const { rows } = await pool.query(
    `SELECT decisao, caracteristicas
       FROM prospectador.curadoria_decisoes
      WHERE empresa_id = $1
        AND criado_em > NOW() - make_interval(days => $3::int)
      ORDER BY criado_em DESC
      LIMIT $2::int`,
    [empresaId, Math.max(1, Math.min(1000, parseInt(limite, 10) || 400)), APRENDIZADO_JANELA_DIAS]
  )
  return rows
}

/**
 * Registra a decisão do operador. TUDO em uma transação:
 *   1. CLAIM do lead — só muda quem ainda está 'aguardando'. Se nada mudou, a decisão
 *      é repetição (recarregou, clicou duas vezes) e NÃO conta para a meta;
 *   2. registro da decisão, idempotente por (sessão, lead);
 *   3. contadores + fila da sessão, no mesmo COMMIT — nunca sobra estado pela metade.
 *
 * Retorna { contou, repetida, sessao, prospect }.
 */
async function decidir(pool, {
  empresaId,
  sessaoId,
  prospectId,
  decisao,
  usuarioId = null,
  justificativa = null,
  caracteristicas = {},
  filaRestante = [],
} = {}) {
  if (!empresaId || !sessaoId || !prospectId) throw erro('Decisão incompleta.', 400)
  if (!['aprovado', 'descartado'].includes(decisao)) throw erro('Decisão inválida.', 400)
  const statusNovo = decisao === 'aprovado' ? 'aprovado' : 'rejeitado'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: sessaoRows } = await client.query(
      `SELECT ${SESSAO_COLUNAS} FROM prospectador.curadoria_sessoes
        WHERE empresa_id = $1 AND id = $2::uuid FOR UPDATE`,
      [empresaId, sessaoId]
    )
    const sessao = sessaoRows[0]
    if (!sessao) throw erro('Sessão não encontrada.', 404)
    if (sessao.status !== 'ativa') throw erro('Esta sessão já foi encerrada.', 409)

    // 1. CLAIM: 0 linhas = alguém (ou você mesmo) já decidiu este lead.
    const { rows: claim } = await client.query(
      `UPDATE prospectador.prospects
          SET status = $3, updated_at = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid AND status = 'aguardando'
        RETURNING id, nome, status`,
      [empresaId, prospectId, statusNovo]
    )
    const novo = claim.length > 0
    const contou = novo && decisao === 'aprovado'

    // 2. Registro (idempotente na sessão).
    const { rows: registro } = await client.query(
      `INSERT INTO prospectador.curadoria_decisoes
         (empresa_id, sessao_id, prospect_id, decisao, contou_meta, justificativa, caracteristicas, usuario_id)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, $8::uuid)
       ON CONFLICT (sessao_id, prospect_id) WHERE sessao_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        empresaId, sessaoId, prospectId, decisao, contou,
        justificativa ? String(justificativa).slice(0, 500) : null,
        JSON.stringify(caracteristicas && typeof caracteristicas === 'object' ? caracteristicas : {}),
        usuarioId,
      ]
    )
    const repetida = registro.length === 0

    // 3. Contadores + fila. Repetição não mexe em contador nenhum.
    const incAprovados = !repetida && contou ? 1 : 0
    const incDescartados = !repetida && novo && decisao === 'descartado' ? 1 : 0
    const { rows: atualizada } = await client.query(
      `UPDATE prospectador.curadoria_sessoes
          SET aprovados = aprovados + $3::int,
              descartados = descartados + $4::int,
              fila_json = $5::jsonb,
              status = CASE WHEN aprovados + $3::int >= meta THEN 'concluida' ELSE status END,
              encerrado_em = CASE WHEN aprovados + $3::int >= meta THEN NOW() ELSE encerrado_em END,
              atualizado_em = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING ${SESSAO_COLUNAS}`,
      [
        empresaId, sessaoId, incAprovados, incDescartados,
        JSON.stringify(Array.isArray(filaRestante) ? filaRestante : []),
      ]
    )

    await client.query('COMMIT')
    return { contou: incAprovados === 1, repetida, novo, sessao: atualizada[0], prospect: claim[0] || null }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Histórico do card: as últimas sessões desta empresa, com o que cada uma rendeu.
async function historicoSessoes(pool, empresaId, limite = 5) {
  const { rows } = await pool.query(
    `SELECT id, nicho, cidade, uf, meta, aprovados, descartados, status, criado_em, encerrado_em
       FROM prospectador.curadoria_sessoes
      WHERE empresa_id = $1 AND status <> 'ativa'
      ORDER BY criado_em DESC
      LIMIT $2`,
    [empresaId, Math.max(1, Math.min(20, parseInt(limite, 10) || 5))]
  )
  return rows
}

module.exports = {
  APRENDIZADO_JANELA_DIAS,
  obterSessaoAtiva,
  obterSessao,
  criarSessao,
  salvarFila,
  ampliarEscopo,
  encerrarSessao,
  listarCandidatos,
  contarCandidatos,
  historicoDecisoes,
  decidir,
  historicoSessoes,
}
