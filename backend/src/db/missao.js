'use strict'
// Missao da Operacao Comercial (Etapa 2) — acesso a dados.
// Regras PURAS em src/services/missao.js. Aqui so' ha I/O.
//
// ─── A MEDIDA E' EMPRESTADA, NAO REESCRITA ──────────────────────────────────────────────
// "Faturamento pago originado" ja e' um fato reconciliado pela camada de comissao (083):
// `app.vendas.comissao_base`, das vendas com comissao LIBERADA (o momento em que o pagamento do
// cliente foi confirmado). A missao soma exatamente isso dentro da janela dela.
//
// Escrever uma consulta propria de "resultado" criaria uma SEGUNDA definicao da mesma coisa — e
// no dia em que uma venda fosse cancelada, o painel de comissao e o da missao passariam a
// discordar sobre quanto a pessoa fez. Por isso o status vem de `services/comissao.js`
// (`VENDA_STATUS`), nunca de literal escrito aqui.
//
// ─── NAO EXISTE TABELA DE CONQUISTA ─────────────────────────────────────────────────────
// Quem alcancou o alvo e' DERIVADO desta mesma soma. Como a missao e' imutavel depois de
// publicada e as vendas nao somem, a lista continua reconstruivel para sempre, inclusive depois
// do encerramento. Ver o cabecalho da migration 085.
//
// ─── IMUTABILIDADE ──────────────────────────────────────────────────────────────────────
// Nao ha UPDATE de `titulo`, `alvo_valor`, `recompensa_*`, `metrica`, `inicio` ou `fim` neste
// arquivo, e nao deve haver: publicada, a missao e' imutavel. O unico UPDATE existente escreve
// as colunas de ENCERRAMENTO. Guarda de regressao em test/missao.test.js le este fonte.

const { pool } = require('../db')
const M = require('../services/missao')
const { VENDA_STATUS } = require('../services/comissao')
const { logger } = require('../logger')

function erro(mensagem, statusCode = 400, code = 'BAD_REQUEST') {
  const e = new Error(mensagem)
  e.statusCode = statusCode
  e.code = code
  return e
}

const COLS = `
  id, empresa_id, titulo, descricao, metrica, alvo_valor, moeda, inicio, fim,
  recompensa_descricao, recompensa_valor, status,
  encerrada_em, encerrada_por, encerrada_motivo, criado_por, criado_em`

// Os dois status em que o dinheiro ja foi confirmado. `cancelada` e `aguardando_pagamento` ficam
// de fora: a missao mede o que o cliente PAGOU.
const STATUS_PAGOS = [VENDA_STATUS.COMISSAO_LIBERADA, VENDA_STATUS.COMISSAO_PAGA]

// ─── Leitura ─────────────────────────────────────────────────────────────────────────────

async function missaoAtiva(empresaId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM app.missoes
      WHERE empresa_id = $1 AND status = $2
      LIMIT 1`,
    [empresaId, M.STATUS.ATIVA]
  )
  return rows[0] || null
}

async function obterMissao(empresaId, missaoId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.missoes WHERE empresa_id = $1 AND id = $2::uuid LIMIT 1`,
    [empresaId, missaoId]
  )
  return rows[0] || null
}

async function listarMissoes(empresaId, { limite = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM app.missoes
      WHERE empresa_id = $1
      ORDER BY inicio DESC, criado_em DESC
      LIMIT $2`,
    [empresaId, Math.min(Math.max(Number(limite) || 20, 1), 100)]
  )
  return rows
}

// ─── A medida ────────────────────────────────────────────────────────────────────────────

// A janela é fechada nas duas pontas: `inicio` 00:00 até o FIM do dia `fim`. O `< fim + 1 dia`
// existe porque `comissao_liberada_em` é TIMESTAMPTZ e `fim` é DATE — comparar direto deixaria
// de fora tudo que foi liberado no último dia depois da meia-noite, que é o dia inteiro.
const JANELA_SQL = `
  v.comissao_liberada_em >= $3::date
  AND v.comissao_liberada_em < ($4::date + INTERVAL '1 day')`

/**
 * Quanto ESTA pessoa originou de faturamento pago dentro da janela da missao.
 * Recebe uma pessoa por vez, de proposito: progresso e' pessoal (ver services/missao.js).
 */
async function progressoDaPessoa(empresaId, missao, usuarioId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(v.comissao_base), 0) AS valor, COUNT(*)::int AS vendas
       FROM app.vendas v
      WHERE v.empresa_id = $1
        AND v.originador_id = $2::uuid
        AND v.status = ANY($5::text[])
        AND ${JANELA_SQL}`,
    [empresaId, usuarioId, missao.inicio, missao.fim, STATUS_PAGOS]
  )
  return { valor: Number(rows[0].valor), vendas: rows[0].vendas }
}

/**
 * Quem ALCANCOU o alvo — para o dono, que precisa saber a quem pagar a recompensa.
 *
 * ⚠️ Devolve SO' quem ja bateu o alvo, nunca o progresso parcial de quem nao bateu. A decisao do
 * operador (2026-09-18) e' que o progresso e' pessoal; o que o dono precisa e' o FATO consumado,
 * porque sem ele a recompensa nao tem como ser paga. A ordenacao e' por NOME, nao por valor:
 * ordenar gente por resultado e' ranking, que e' outra etapa e outra decisao.
 */
async function alcancaramOAlvo(empresaId, missao) {
  const { rows } = await pool.query(
    `SELECT v.originador_id AS usuario_id, u.nome,
            SUM(v.comissao_base) AS valor, COUNT(*)::int AS vendas
       FROM app.vendas v
       LEFT JOIN app.usuarios u ON u.id = v.originador_id
      WHERE v.empresa_id = $1
        AND v.originador_id IS NOT NULL
        AND v.status = ANY($5::text[])
        AND ${JANELA_SQL}
      GROUP BY v.originador_id, u.nome
     HAVING SUM(v.comissao_base) >= $2::numeric
      ORDER BY u.nome ASC`,
    [empresaId, missao.alvo_valor, missao.inicio, missao.fim, STATUS_PAGOS]
  )
  return rows.map((r) => ({
    usuario_id: r.usuario_id,
    nome: r.nome || null,
    valor: Number(r.valor),
    vendas: r.vendas,
  }))
}

// ─── Auditoria ───────────────────────────────────────────────────────────────────────────

// Dentro da transacao do chamador: publicar e encerrar um desafio com recompensa sao decisoes
// que precisam de autoria. Mesma escolha de db/membros.js e db/programa-aceite.js.
async function auditar(client, { empresaId, usuarioId, acao, entidadeId, estadoAnterior, estadoNovo, contexto }) {
  await client.query(
    `INSERT INTO app.auditoria_eventos
       (empresa_id, usuario_id, entidade_tipo, entidade_id, acao, estado_anterior, estado_novo, contexto)
     VALUES ($1, $2, 'missao', $3, $4, $5, $6, $7::jsonb)`,
    [empresaId, usuarioId || null, entidadeId || null, acao,
      estadoAnterior || null, estadoNovo || null, JSON.stringify(contexto || {})]
  )
}

// ─── Escrita ─────────────────────────────────────────────────────────────────────────────

/**
 * Publica a missao. Uma transacao so'.
 *
 * Com uma missao ativa cuja janela JA ACABOU, ela e' encerrada por `prazo` aqui dentro — e' o
 * mesmo movimento de `publicarPlano` (comissao), que arquiva o plano ativo anterior. Com uma
 * missao ativa e VALENDO, RECUSA com 409: encerrar um desafio antes da hora e' uma decisao
 * (tem gente contando com a recompensa), nao efeito colateral de publicar outro.
 *
 * A unicidade real e' do BANCO (`missoes_uma_ativa_por_empresa_uk`): duas publicacoes
 * simultaneas nao produzem duas missoes ativas — a segunda quebra no indice e volta atras.
 */
async function publicarMissao(empresaId, dados, autorId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const ativa = await missaoAtiva(empresaId, client)
    const veredito = M.avaliarPublicacao(ativa)
    if (!veredito.permitido) {
      throw erro(
        'Já existe uma missão em andamento. Encerre-a antes de publicar outra.',
        409, 'MISSAO_ATIVA_EM_ANDAMENTO'
      )
    }

    if (veredito.veredito === M.VEREDITO_PUBLICACAO.ENCERRA_A_ANTERIOR) {
      await client.query(
        `UPDATE app.missoes
            SET status = $3, encerrada_em = NOW(), encerrada_por = $4, encerrada_motivo = $5
          WHERE id = $1 AND empresa_id = $2 AND status = $6`,
        [ativa.id, empresaId, M.STATUS.ENCERRADA, autorId || null,
          M.MOTIVO_ENCERRAMENTO.PRAZO, M.STATUS.ATIVA]
      )
      await auditar(client, {
        empresaId, usuarioId: autorId, acao: 'missao_encerrada', entidadeId: ativa.id,
        estadoAnterior: M.STATUS.ATIVA, estadoNovo: M.STATUS.ENCERRADA,
        contexto: { motivo: M.MOTIVO_ENCERRAMENTO.PRAZO },
      })
    }

    const { rows } = await client.query(
      `INSERT INTO app.missoes
         (empresa_id, titulo, descricao, metrica, alvo_valor, inicio, fim,
          recompensa_descricao, recompensa_valor, status, criado_por)
       VALUES ($1, $2, $3, $4, $5::numeric, $6::date, $7::date, $8, $9::numeric, $10, $11)
       RETURNING ${COLS}`,
      [empresaId, dados.titulo, dados.descricao, dados.metrica, dados.alvo_valor,
        dados.inicio, dados.fim, dados.recompensa_descricao, dados.recompensa_valor,
        M.STATUS.ATIVA, autorId || null]
    )
    const missao = rows[0]

    await auditar(client, {
      empresaId, usuarioId: autorId, acao: 'missao_publicada', entidadeId: missao.id,
      estadoNovo: M.STATUS.ATIVA,
      // Sem PII: titulo e recompensa sao texto escrito pelo dono sobre o PROGRAMA, nunca sobre
      // uma pessoa. Nenhum nome, e-mail ou telefone entra aqui.
      contexto: {
        metrica: missao.metrica,
        alvo_valor: String(missao.alvo_valor),
        inicio: dados.inicio,
        fim: dados.fim,
        recompensa_valor: missao.recompensa_valor === null ? null : String(missao.recompensa_valor),
      },
    })

    await client.query('COMMIT')
    logger.info({ empresa_id: empresaId, missao_id: missao.id }, '[missao] publicada')
    return missao
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e.code === '23505') {
      throw erro('Já existe uma missão ativa nesta empresa.', 409, 'MISSAO_ATIVA_EM_ANDAMENTO')
    }
    throw e
  } finally {
    client.release()
  }
}

/**
 * Encerra a missao por DECISAO de alguem (antes ou depois do prazo).
 *
 * O UPDATE e' guardado por `status = 'ativa'`: dois cliques simultaneos nao produzem dois
 * encerramentos, e o segundo recebe 409 em vez de sobrescrever a autoria do primeiro.
 * Encerrar NAO apaga nada — a missao vira historico e quem alcancou continua calculavel.
 */
async function encerrarMissao(empresaId, missaoId, usuarioId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE app.missoes
          SET status = $3, encerrada_em = NOW(), encerrada_por = $4, encerrada_motivo = $5
        WHERE id = $1::uuid AND empresa_id = $2 AND status = $6
        RETURNING ${COLS}`,
      [missaoId, empresaId, M.STATUS.ENCERRADA, usuarioId || null,
        M.MOTIVO_ENCERRAMENTO.DECISAO, M.STATUS.ATIVA]
    )
    if (!rows[0]) {
      await client.query('ROLLBACK')
      return null
    }
    await auditar(client, {
      empresaId, usuarioId, acao: 'missao_encerrada', entidadeId: missaoId,
      estadoAnterior: M.STATUS.ATIVA, estadoNovo: M.STATUS.ENCERRADA,
      contexto: { motivo: M.MOTIVO_ENCERRAMENTO.DECISAO },
    })
    await client.query('COMMIT')
    return rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// ─── A BAIXA DA RECOMPENSA (Etapa 4, migration 086) ──────────────────────────────────────

/** As baixas ja registradas nesta missao. Leitura barata, lida junto de quem alcancou. */
async function recompensasDaMissao(empresaId, missaoId) {
  const { rows } = await pool.query(
    `SELECT usuario_id, valor_pago, moeda, referencia, observacao, pago_por, pago_em
       FROM app.missao_recompensas
      WHERE empresa_id = $1 AND missao_id = $2::uuid`,
    [empresaId, missaoId]
  )
  return rows.map((r) => ({ ...r, valor_pago: r.valor_pago === null ? null : Number(r.valor_pago) }))
}

/**
 * Registra que o premio SAIU para uma pessoa. Uma transacao so'.
 *
 * ⚠️ A CONQUISTA E' RECONFERIDA AQUI, NO ATO, com o numero lido do banco — nunca com um
 * "alcancou: true" vindo do cliente, que deixaria qualquer requisicao pagar premio a quem
 * quisesse. Quem nao alcancou recebe 409 e NADA e' gravado.
 *
 * O retrato (`originado_no_pagamento`, `alvo_no_pagamento`) e' CONGELADO pelo mesmo motivo do
 * percentual da comissao (083): a conquista continua sendo recalculada das vendas, e sem o
 * retrato "por que paguei este valor?" deixaria de ser respondivel se uma venda fosse cancelada
 * depois da baixa.
 *
 * A idempotencia real e' do BANCO (`missao_recompensas_pessoa_uk`): dois cliques simultaneos nao
 * pagam o premio duas vezes — o segundo quebra no indice e vira 409.
 */
async function registrarRecompensaPaga(empresaId, missao, dados, autorId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // A MESMA soma de `progressoDaPessoa`, dentro da transacao. Não se aceita o valor de fora.
    const { rows: somaRows } = await client.query(
      `SELECT COALESCE(SUM(v.comissao_base), 0) AS valor
         FROM app.vendas v
        WHERE v.empresa_id = $1
          AND v.originador_id = $2::uuid
          AND v.status = ANY($5::text[])
          AND ${JANELA_SQL}`,
      [empresaId, dados.usuario_id, missao.inicio, missao.fim, STATUS_PAGOS]
    )
    const originado = Number(somaRows[0].valor)
    const alvo = Number(missao.alvo_valor)

    if (!(originado >= alvo)) {
      throw erro(
        'Esta pessoa ainda não alcançou o alvo desta missão.',
        409, 'MISSAO_ALVO_NAO_ALCANCADO'
      )
    }

    const { rows } = await client.query(
      `INSERT INTO app.missao_recompensas
         (empresa_id, missao_id, usuario_id, valor_pago, originado_no_pagamento,
          alvo_no_pagamento, referencia, observacao, pago_por)
       VALUES ($1, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::numeric, $7, $8, $9)
       RETURNING usuario_id, valor_pago, pago_em`,
      [empresaId, missao.id, dados.usuario_id, dados.valor_pago, originado, alvo,
        dados.referencia, dados.observacao, autorId || null]
    )

    await auditar(client, {
      empresaId, usuarioId: autorId, acao: 'missao_recompensa_paga', entidadeId: missao.id,
      estadoNovo: 'paga',
      // Sem PII: o id do beneficiario e' chave, nao dado pessoal; nenhum nome, e-mail ou telefone.
      contexto: {
        beneficiario_id: dados.usuario_id,
        valor_pago: dados.valor_pago === null ? null : String(dados.valor_pago),
        originado_no_pagamento: String(originado),
        alvo_no_pagamento: String(alvo),
      },
    })

    await client.query('COMMIT')
    logger.info({ empresa_id: empresaId, missao_id: missao.id }, '[missao] recompensa registrada')
    return { ...rows[0], valor_pago: rows[0].valor_pago === null ? null : Number(rows[0].valor_pago) }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e.code === '23505') {
      throw erro('O prêmio desta missão já foi registrado para esta pessoa.', 409, 'MISSAO_RECOMPENSA_JA_PAGA')
    }
    throw e
  } finally {
    client.release()
  }
}

module.exports = {
  missaoAtiva,
  obterMissao,
  listarMissoes,
  progressoDaPessoa,
  alcancaramOAlvo,
  publicarMissao,
  encerrarMissao,
  recompensasDaMissao,
  registrarRecompensaPaga,
}
