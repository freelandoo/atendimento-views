'use strict'
// Ownership da CONVERSA — acesso a dados. CRM em equipe, Etapa 7.
// Regras puras em services/conversa-responsavel.js.
//
// DUAS COISAS QUE ESTE MÓDULO NÃO FAZ, DE PROPÓSITO:
//  1. **Não toca `atualizado_em`.** A Central de Mensagens ordena por ele, e assumir uma conversa
//     não é mensagem nova — reordenaria a lista debaixo do operador. Mesmo cuidado que a migration
//     065 tomou com `nome_whatsapp`.
//  2. **Não toca `modo_ia` nem `agente_pausado`.** Trocar de atendente e ligar/desligar a IA são
//     decisões independentes (AGENTS.md: "os dois convivem e o envio automático exige os dois
//     liberados"). Acoplar aqui faria uma transferência religar a IA sem ninguém decidir isso.

const {
  ACOES, acaoDaMudanca, avaliarAssumir, avaliarTransferir, rotuloMotivo,
} = require('../services/conversa-responsavel')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

// `numero` é a chave de `vendas.conversas` e é UNIQUE **GLOBAL** — por isso toda consulta aqui
// leva `empresa_id` no WHERE. Sem ele, um número de outro tenant seria alcançável por id.
const COLS = `id, numero, empresa_id, responsavel_id, responsavel_desde, operador_assumiu_em, status`

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

/** O responsável precisa ser membro ATIVO desta empresa (mesma validação da Etapa 4). */
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

async function nomeDoResponsavel(exec, usuarioId) {
  if (!usuarioId) return null
  const { rows } = await exec.query(`SELECT nome FROM app.usuarios WHERE id = $1::uuid LIMIT 1`, [usuarioId])
  return rows[0]?.nome || null
}

/** Grava no histórico de gestão E na auditoria. Ver o cabeçalho da migration 074. */
async function registrarMudanca(client, { empresaId, numero, anterior, novo, usuarioId, acao, motivo }) {
  await client.query(
    `INSERT INTO app.conversa_responsavel_historico
       (empresa_id, conversa_numero, responsavel_anterior_id, responsavel_novo_id, usuario_id, acao, motivo)
     VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7)`,
    [empresaId, numero, anterior || null, novo || null, usuarioId || null, acao,
      motivo ? String(motivo).slice(0, 500) : null]
  )
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2::uuid, 'conversa', $3, $4, $5, $6::jsonb)`,
    [empresaId, usuarioId || null, `conversa_responsavel_${acao}`, anterior || null, novo || null,
      // Só dígitos e sem JID: o padrão que as migrations 063 e 066 já usam na auditoria de conversa.
      JSON.stringify({ acao, telefone_digitos: String(numero || '').replace(/\D+/g, '') })]
  )
}

/**
 * O atendente assume uma conversa SEM dono (claim atômico).
 *
 * Escreve `operador_assumiu_em` junto — a coluna que existia desde sempre e registrava só o
 * "quando". A partir daqui as duas andam juntas, e é `COALESCE` de propósito: se a conversa já
 * tinha sido assumida antes (pelo fluxo antigo, sem quem), preserva-se o instante original.
 */
async function assumirConversa(pool, empresaId, numero, usuarioId) {
  if (!usuarioId) throw erro('Usuário não identificado.', 401, 'UNAUTHORIZED')
  return withTx(pool, async (client) => {
    await assertResponsavelDaEmpresa(client, empresaId, usuarioId)

    const { rows } = await client.query(
      `UPDATE vendas.conversas
          SET responsavel_id = $3::uuid,
              responsavel_desde = NOW(),
              operador_assumiu_em = COALESCE(operador_assumiu_em, NOW())
        WHERE empresa_id = $1 AND numero = $2
          AND responsavel_id IS NULL
        RETURNING ${COLS}`,
      [empresaId, numero, usuarioId]
    )
    if (rows[0]) {
      await registrarMudanca(client, {
        empresaId, numero, anterior: null, novo: usuarioId, usuarioId, acao: ACOES.ASSUMIU,
      })
      return { ...rows[0], assumida: true }
    }

    const { rows: atual } = await client.query(
      `SELECT ${COLS} FROM vendas.conversas WHERE empresa_id = $1 AND numero = $2`,
      [empresaId, numero]
    )
    const conversa = atual[0]
    if (!conversa) throw erro('Conversa não encontrada nesta empresa.', 404, 'NOT_FOUND')

    const veredito = avaliarAssumir(conversa, usuarioId)
    const nome = await nomeDoResponsavel(client, conversa.responsavel_id)
    throw erro(
      nome ? `Esta conversa já está sendo atendida por ${nome}.` : rotuloMotivo(veredito.motivo),
      409, 'CONVERSA_JA_TEM_RESPONSAVEL'
    )
  })
}

/**
 * Define/troca/remove o responsável. `destinoId = null` devolve para a fila de não atribuídas.
 * `podeTransferir` chega pronto da avaliação de capacidade.
 */
async function definirResponsavel(pool, empresaId, numero, { destinoId, usuarioId, podeTransferir, motivo } = {}) {
  return withTx(pool, async (client) => {
    const { rows: atual } = await client.query(
      `SELECT ${COLS} FROM vendas.conversas
        WHERE empresa_id = $1 AND numero = $2 FOR UPDATE`,
      [empresaId, numero]
    )
    const conversa = atual[0]
    if (!conversa) throw erro('Conversa não encontrada nesta empresa.', 404, 'NOT_FOUND')

    const veredito = avaliarTransferir(conversa, { usuarioId, podeTransferir, destinoId })
    if (!veredito.permitido) {
      const status = veredito.motivo === 'sem_permissao' ? 403 : 409
      throw erro(rotuloMotivo(veredito.motivo), status, 'RESPONSAVEL_NAO_PERMITIDO')
    }
    if (destinoId) await assertResponsavelDaEmpresa(client, empresaId, destinoId)

    const acao = destinoId && !conversa.responsavel_id && String(destinoId) === String(usuarioId)
      ? ACOES.ASSUMIU
      : acaoDaMudanca(conversa.responsavel_id, destinoId || null)
    if (!acao) return { ...conversa, alterado: false }

    const { rows } = await client.query(
      `UPDATE vendas.conversas
          SET responsavel_id = $3::uuid,
              responsavel_desde = CASE WHEN $3::uuid IS NULL THEN NULL ELSE NOW() END
        WHERE empresa_id = $1 AND numero = $2
        RETURNING ${COLS}`,
      [empresaId, numero, destinoId || null]
    )
    await registrarMudanca(client, {
      empresaId, numero, anterior: conversa.responsavel_id, novo: destinoId || null,
      usuarioId, acao, motivo,
    })
    logger.info({ empresa_id: empresaId, acao }, '[conversa-responsavel] responsavel alterado')
    return { ...rows[0], alterado: true, acao }
  })
}

/** Linha do tempo de atendentes. O telefone sai MASCARADO — a conversa já é conhecida por quem lê. */
async function historicoDaConversa(pool, empresaId, numero, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT h.id, h.acao, h.motivo, h.ocorrido_em,
            h.responsavel_anterior_id, h.responsavel_novo_id, h.usuario_id,
            ua.nome AS responsavel_anterior_nome,
            un.nome AS responsavel_novo_nome,
            uq.nome AS usuario_nome
       FROM app.conversa_responsavel_historico h
       LEFT JOIN app.usuarios ua ON ua.id = h.responsavel_anterior_id
       LEFT JOIN app.usuarios un ON un.id = h.responsavel_novo_id
       LEFT JOIN app.usuarios uq ON uq.id = h.usuario_id
      WHERE h.empresa_id = $1 AND h.conversa_numero = $2
      ORDER BY h.ocorrido_em DESC
      LIMIT $3`,
    [empresaId, numero, Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200)]
  )
  return rows
}

/** Quantas conversas cada atendente tem. Alimenta o painel do admin (Etapa 12). */
async function contagemPorResponsavel(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT c.responsavel_id, u.nome, COUNT(*)::int AS conversas,
            COUNT(*) FILTER (WHERE c.status = 'ativo')::int AS ativas
       FROM vendas.conversas c
       LEFT JOIN app.usuarios u ON u.id = c.responsavel_id
      WHERE c.empresa_id = $1 AND COALESCE(c.arquivado, false) = false
      GROUP BY c.responsavel_id, u.nome
      ORDER BY conversas DESC`,
    [empresaId]
  )
  return rows
}

module.exports = {
  assumirConversa,
  definirResponsavel,
  historicoDaConversa,
  contagemPorResponsavel,
}
