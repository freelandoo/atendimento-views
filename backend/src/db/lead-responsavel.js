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
// So' para LER os dois sinais de risco (reuniao futura / conversa aberta) na devolucao em lote —
// nunca para gatear nada aqui. `services/lead-distribuicao.js` continua sendo quem decide se um
// lead pode ser movido AUTOMATICAMENTE; a devolucao por saida de equipe e' ato humano explicito e
// devolve TODOS os leads da pessoa, de proposito (decisao do operador, 2026-09-21).
const D = require('../services/lead-distribuicao')
const { candidatosTelefoneBR } = require('../telefone-br')
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
 * A MESMA gravacao, para VARIOS leads que sofreram a MESMA mudanca — em duas instrucoes.
 *
 * Existe porque a distribuicao por equipe move ate' `TETO_MOVIMENTOS` leads dentro da transacao
 * que adiciona a pessoa a equipe: duas consultas por lead seriam mil idas ao banco segurando
 * aquela transacao aberta. O conteudo gravado e' identico ao de `registrarMudanca` — e e' por isso
 * que mora AQUI, e nao no modulo de distribuicao: `app.lead_responsavel_historico` tem um dono so'.
 *
 * Uma linha por LEAD, nunca uma por operacao: "distribuiu 40 leads" nao e' um evento, sao 40
 * mudancas de dono, e e' por lead que alguem vai querer saber quem decidiu (cabecalho da 072).
 */
async function registrarMudancasEmLote(client, { empresaId, prospectIds, anterior, novo, usuarioId, acao, motivo }) {
  const ids = [...new Set((prospectIds || []).map(String).filter(Boolean))]
  if (!ids.length) return 0
  const texto = motivo ? String(motivo).slice(0, 500) : null
  await client.query(
    `INSERT INTO app.lead_responsavel_historico
       (empresa_id, prospect_id, responsavel_anterior_id, responsavel_novo_id, usuario_id, acao, motivo)
     SELECT $1::uuid, x.id, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::text
       FROM UNNEST($2::uuid[]) AS x(id)`,
    [empresaId, ids, anterior || null, novo || null, usuarioId || null, acao, texto]
  )
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     SELECT $1::uuid, $2::uuid, 'prospect', x.id, $3::text, $4::text, $5::text, $6::jsonb
       FROM UNNEST($7::uuid[]) AS x(id)`,
    // Sem nome e sem telefone: o id do prospect ja aponta para tudo.
    [empresaId, usuarioId || null, `lead_responsavel_${acao}`, anterior || null, novo || null,
      JSON.stringify({ acao, motivo: texto }), ids]
  )
  return ids.length
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

/**
 * Devolve para a fila de LIVRES todos os leads do nicho que estao com `origemId`.
 *
 * ⚠️ NAO filtra por "protegido" (`services/lead-distribuicao.js`) — de proposito. O rebalanceamento
 * AUTOMATICO so' toca em lead intocado; esta funcao roda quando uma PESSOA sai da equipe, decisao
 * humana explicita, e o operador decidiu (2026-09-21) que TODOS os leads dela voltam, inclusive os
 * ja' trabalhados — senao carteira ficaria presa com quem nao esta mais no time. Os dois contadores
 * de risco sao so' INFORMACAO para a tela avisar, nunca bloqueio.
 *
 * Roda dentro da transacao de quem chama (`db/equipes-comerciais.js`, saida de participante).
 */
async function liberarLeadsDoMembro(client, { empresaId, nichoId, origemId, usuarioId, motivo } = {}) {
  const vazio = { liberados: 0, com_reuniao_futura: 0, com_conversa_aberta: 0 }
  if (!empresaId || !nichoId || !origemId) return vazio

  const { rows: candidatos } = await client.query(
    `SELECT p.id,
            ${D.sqlReuniaoFutura('p')}  AS tem_reuniao_futura,
            ${D.sqlConversaAberta('p')} AS tem_conversa_aberta
       FROM prospectador.prospects p
      WHERE p.empresa_id = $1 AND p.nicho_id = $2::uuid AND p.responsavel_id = $3::uuid
        AND p.qualificacao IN ('aprovado', 'legado')`,
    [empresaId, nichoId, origemId]
  )
  if (!candidatos.length) return vazio

  const ids = candidatos.map((c) => c.id)
  await client.query(
    `UPDATE prospectador.prospects
        SET responsavel_id = NULL, responsavel_desde = NULL
      WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND responsavel_id = $3::uuid`,
    [empresaId, ids, origemId]
  )
  await registrarMudancasEmLote(client, {
    empresaId, prospectIds: ids, anterior: origemId, novo: null,
    usuarioId, acao: ACOES.LIBEROU, motivo,
  })
  return {
    liberados: ids.length,
    com_reuniao_futura: candidatos.filter((c) => c.tem_reuniao_futura).length,
    com_conversa_aberta: candidatos.filter((c) => c.tem_conversa_aberta).length,
  }
}

/**
 * Resolve o prospect pelo TELEFONE da conversa e devolve a linha do tempo de donos dele.
 *
 * Mesma identidade de `db/lead-nome-maps.js` (empresa + digitos do telefone, sem FK entre
 * `vendas.conversas` e `prospectador.prospects`) e a MESMA expressao indexada
 * (`idx_prospects_empresa_telefone_digitos`, migration 065) — mudar uma sem a outra faz o indice
 * parar de ser usado em silencio.
 *
 * Sem prospect correspondente, devolve historico VAZIO — nao e' erro, e' contato que a Aquisicao
 * nunca coletou (conversa pode existir sem lead algum no Banco de Leads).
 */
async function historicoPorTelefone(pool, empresaId, numero, { limit = 50 } = {}) {
  const vazio = { prospect_id: null, itens: [] }
  const candidatos = candidatosTelefoneBR(numero)
  if (!empresaId || !candidatos.length) return vazio

  const { rows } = await pool.query(
    `SELECT id FROM prospectador.prospects
      WHERE empresa_id = $1
        AND regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = ANY($2::text[])
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [empresaId, candidatos]
  )
  const prospectId = rows[0]?.id || null
  if (!prospectId) return vazio
  return { prospect_id: prospectId, itens: await historicoDoLead(pool, empresaId, prospectId, { limit }) }
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
  registrarMudancasEmLote,
  assumirLead,
  definirResponsavel,
  atribuirEmLote,
  liberarLeadsDoMembro,
  historicoDoLead,
  historicoPorTelefone,
  contagemPorResponsavel,
  assertResponsavelDaEmpresa,
}
