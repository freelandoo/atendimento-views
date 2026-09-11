'use strict'
// Ownership do lead — acesso a dados. CRM em equipe, Etapa 4.
// Regras puras em services/lead-responsavel.js; aqui só SQL, transação e isolamento por empresa.
//
// O CLAIM É A VERDADE, NÃO A CHECAGEM
// `assumirLead` é `UPDATE ... WHERE responsavel_id IS NULL RETURNING`. Dois vendedores clicando no
// mesmo segundo: um recebe linha, o outro recebe zero — e o segundo recebe 409 com o nome de quem
// ganhou. É o MESMO padrão do claim da curadoria (migration 055) e do índice único parcial das
// ligações (migration 048): a corrida é resolvida pelo banco, nunca por um `SELECT` seguido de
// `UPDATE`, que tem janela entre os dois.

const {
  ACOES, acaoDaMudanca, avaliarAssumir, avaliarLiberar, avaliarTransferir, rotuloMotivo,
} = require('../services/lead-responsavel')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

// Colunas devolvidas ao cliente. Não inclui `raw_json` (é grande e tem dado cru da coleta).
const COLS = `id, nome, telefone, qualificacao, responsavel_id, responsavel_desde, status`

async function withTx(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * O responsável precisa ser um membro ATIVO desta empresa.
 * Mesma validação de `assertResponsavelDaEmpresa` (db/follow-ups.js) e `definirResponsaveis`
 * (db/campanhas.js) — atribuir lead a alguém de outro tenant seria vazamento por atribuição.
 */
async function assertResponsavelDaEmpresa(exec, empresaId, usuarioId) {
  const { rows } = await exec.query(
    `SELECT 1 FROM app.usuarios_empresas ue
      JOIN app.usuarios u ON u.id = ue.usuario_id
     WHERE ue.empresa_id = $1 AND ue.usuario_id = $2::uuid AND ue.ativo = true AND u.ativo = true
     LIMIT 1`,
    [empresaId, usuarioId]
  )
  if (!rows[0]) throw erro('Responsável não é um membro ativo desta empresa.', 400, 'RESPONSAVEL_INVALIDO')
}

/** Nome de quem ganhou a corrida, para a mensagem de 409 ser útil. Nunca e-mail. */
async function nomeDoResponsavel(exec, usuarioId) {
  if (!usuarioId) return null
  const { rows } = await exec.query(`SELECT nome FROM app.usuarios WHERE id = $1::uuid LIMIT 1`, [usuarioId])
  return rows[0]?.nome || null
}

/** Registra a mudança no histórico E na auditoria. Ver o cabeçalho da migration 072. */
async function registrarMudanca(client, { empresaId, prospectId, anterior, novo, usuarioId, acao, motivo }) {
  await client.query(
    `INSERT INTO app.lead_responsavel_historico
       (empresa_id, prospect_id, responsavel_anterior_id, responsavel_novo_id, usuario_id, acao, motivo)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7)`,
    [empresaId, prospectId, anterior || null, novo || null, usuarioId || null, acao,
      motivo ? String(motivo).slice(0, 500) : null]
  )
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2::uuid, 'prospect', $3::uuid, $4, $5, $6, $7::jsonb)`,
    [empresaId, usuarioId || null, prospectId, `lead_responsavel_${acao}`,
      anterior || null, novo || null,
      // Sem nome, sem telefone: o id do prospect já aponta para tudo.
      JSON.stringify({ acao })]
  )
}

/**
 * O vendedor pega um lead LIVRE.
 *
 * A porta de qualificação é conferida NO `WHERE`, não antes: um lead pode ser descartado entre a
 * leitura da tela e o clique, e conferir em dois passos deixaria a janela aberta.
 */
async function assumirLead(pool, empresaId, prospectId, usuarioId) {
  if (!usuarioId) throw erro('Usuário não identificado.', 401, 'UNAUTHORIZED')
  return withTx(pool, async (client) => {
    await assertResponsavelDaEmpresa(client, empresaId, usuarioId)

    const { rows } = await client.query(
      `UPDATE prospectador.prospects
          SET responsavel_id = $3::uuid, responsavel_desde = NOW()
        WHERE empresa_id = $1 AND id = $2::uuid
          AND responsavel_id IS NULL
          AND qualificacao IN ('aprovado', 'legado')
        RETURNING ${COLS}`,
      [empresaId, prospectId, usuarioId]
    )
    if (rows[0]) {
      await registrarMudanca(client, {
        empresaId, prospectId, anterior: null, novo: usuarioId, usuarioId, acao: ACOES.ASSUMIU,
      })
      return { ...rows[0], assumido: true }
    }

    // 0 linhas: descobrir POR QUE. As três causas pedem ações diferentes — "outro pegou primeiro"
    // é informação útil; "falta triar" e "não existe" são outra conversa.
    const { rows: atual } = await client.query(
      `SELECT ${COLS} FROM prospectador.prospects WHERE empresa_id = $1 AND id = $2::uuid`,
      [empresaId, prospectId]
    )
    const lead = atual[0]
    if (!lead) throw erro('Lead não encontrado nesta empresa.', 404, 'NOT_FOUND')

    const veredito = avaliarAssumir(lead, usuarioId)
    if (!veredito.permitido) {
      const nome = await nomeDoResponsavel(client, lead.responsavel_id)
      throw erro(
        nome ? `Este lead já está com ${nome}.` : rotuloMotivo(veredito.motivo),
        409, 'LEAD_JA_TEM_RESPONSAVEL'
      )
    }
    // Passou pelo julgamento de dono mas o UPDATE não pegou: só sobra a porta de qualificação.
    throw erro('Este lead ainda não foi liberado para a operação comercial.', 409, 'LEAD_NAO_QUALIFICADO')
  })
}

/**
 * Define/troca/remove o responsável.
 *
 * `destinoId = null` devolve o lead para a fila de livres. Quem pode fazer isso:
 *   - o PRÓPRIO dono, sempre (devolver o que é seu não é transferência);
 *   - quem tem `LEAD_TRANSFERIR`, para qualquer lead.
 * O veredito da capacidade chega pronto em `podeTransferir` — a matriz de permissão não vaza
 * para esta camada.
 */
async function definirResponsavel(pool, empresaId, prospectId, { destinoId, usuarioId, podeTransferir, motivo } = {}) {
  return withTx(pool, async (client) => {
    const { rows: atual } = await client.query(
      `SELECT ${COLS} FROM prospectador.prospects
        WHERE empresa_id = $1 AND id = $2::uuid FOR UPDATE`,
      [empresaId, prospectId]
    )
    const lead = atual[0]
    if (!lead) throw erro('Lead não encontrado nesta empresa.', 404, 'NOT_FOUND')

    const veredito = avaliarTransferir(lead, { usuarioId, podeTransferir, destinoId })
    if (!veredito.permitido) {
      const status = veredito.motivo === 'sem_permissao' ? 403 : 409
      throw erro(rotuloMotivo(veredito.motivo), status, 'RESPONSAVEL_NAO_PERMITIDO')
    }
    if (destinoId) await assertResponsavelDaEmpresa(client, empresaId, destinoId)

    const acao = destinoId
      ? (String(destinoId) === String(usuarioId) && !lead.responsavel_id ? ACOES.ASSUMIU : acaoDaMudanca(lead.responsavel_id, destinoId))
      : acaoDaMudanca(lead.responsavel_id, null)
    if (!acao) return { ...lead, alterado: false }   // nada mudou: não infla histórico

    const { rows } = await client.query(
      `UPDATE prospectador.prospects
          SET responsavel_id = $3::uuid,
              responsavel_desde = CASE WHEN $3::uuid IS NULL THEN NULL ELSE NOW() END
        WHERE empresa_id = $1 AND id = $2::uuid
        RETURNING ${COLS}`,
      [empresaId, prospectId, destinoId || null]
    )
    await registrarMudanca(client, {
      empresaId, prospectId, anterior: lead.responsavel_id, novo: destinoId || null,
      usuarioId, acao, motivo,
    })
    logger.info({ empresa_id: empresaId, acao }, '[lead-responsavel] responsavel alterado')
    return { ...rows[0], alterado: true, acao }
  })
}

/**
 * Atribui vários leads de uma vez (distribuição pelo admin).
 *
 * Em UMA transação, com uma linha de histórico por lead: "distribuiu 40 leads" não é um evento,
 * são 40 mudanças de dono, e é por lead que alguém vai querer saber quem decidiu.
 * Leads que já têm dono são RECUSADOS em lote (não sobrescritos em silêncio): tomar o lead de um
 * colega precisa ser um ato por lead, com o histórico dizendo de quem para quem.
 */
async function atribuirEmLote(pool, empresaId, prospectIds, { destinoId, usuarioId, motivo } = {}) {
  const ids = [...new Set((prospectIds || []).map(String).filter(Boolean))]
  if (!ids.length) throw erro('Selecione ao menos um lead.')
  if (!destinoId) throw erro('Informe o responsável.')

  return withTx(pool, async (client) => {
    await assertResponsavelDaEmpresa(client, empresaId, destinoId)
    const { rows } = await client.query(
      `UPDATE prospectador.prospects
          SET responsavel_id = $3::uuid, responsavel_desde = NOW()
        WHERE empresa_id = $1 AND id = ANY($2::uuid[])
          AND responsavel_id IS NULL
          AND qualificacao IN ('aprovado', 'legado')
        RETURNING id`,
      [empresaId, ids, destinoId]
    )
    for (const r of rows) {
      await registrarMudanca(client, {
        empresaId, prospectId: r.id, anterior: null, novo: destinoId, usuarioId,
        acao: ACOES.ATRIBUIU, motivo,
      })
    }
    return {
      atribuidos: rows.length,
      // A diferença é informação, não erro: cobre "já tinha dono" e "não passou pela porta".
      nao_atribuidos: ids.length - rows.length,
    }
  })
}

/** A linha do tempo de donos de um lead, com nomes resolvidos. Nunca e-mail. */
async function historicoDoLead(pool, empresaId, prospectId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT h.id, h.acao, h.motivo, h.ocorrido_em,
            h.responsavel_anterior_id, h.responsavel_novo_id, h.usuario_id,
            ua.nome AS responsavel_anterior_nome,
            un.nome AS responsavel_novo_nome,
            uq.nome AS usuario_nome
       FROM app.lead_responsavel_historico h
       LEFT JOIN app.usuarios ua ON ua.id = h.responsavel_anterior_id
       LEFT JOIN app.usuarios un ON un.id = h.responsavel_novo_id
       LEFT JOIN app.usuarios uq ON uq.id = h.usuario_id
      WHERE h.empresa_id = $1 AND h.prospect_id = $2::uuid
      ORDER BY h.ocorrido_em DESC
      LIMIT $3`,
    [empresaId, prospectId, Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200)]
  )
  return rows
}

/** Quantos leads cada responsável tem. Alimenta o painel do admin (Etapa 12). */
async function contagemPorResponsavel(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT p.responsavel_id, u.nome, COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE p.qualificacao = 'aprovado')::int AS aprovados
       FROM prospectador.prospects p
       LEFT JOIN app.usuarios u ON u.id = p.responsavel_id
      WHERE p.empresa_id = $1 AND p.qualificacao IN ('aprovado', 'legado')
      GROUP BY p.responsavel_id, u.nome
      ORDER BY leads DESC`,
    [empresaId]
  )
  return rows
}

module.exports = {
  assumirLead,
  definirResponsavel,
  atribuirEmLote,
  historicoDoLead,
  contagemPorResponsavel,
  assertResponsavelDaEmpresa,
}
