'use strict'
// Persistencia da comissao do comercial.
//
// Regras PURAS em `src/services/comissao.js`. Aqui vive o I/O — e as duas garantias que so' o
// banco consegue dar:
//
//   1. SERIALIZACAO do credito por (empresa, originador, competencia). O percentual de uma venda
//      depende do acumulado ANTES dela; dois pagamentos registrados ao mesmo tempo leriam o mesmo
//      acumulado e as duas vendas entrariam na faixa antiga. `pg_advisory_xact_lock` resolve sem
//      segurar linha nenhuma — a alternativa (`FOR UPDATE` nas vendas do mes) nao trava o GAP,
//      que e' exatamente onde a segunda venda entra.
//   2. IDEMPOTENCIA do recebimento, pelo indice unico parcial em `referencia`.

const { pool } = require('../db')
const CM = require('../services/comissao')

const COLS_VENDA = `
  v.id, v.empresa_id, v.prospect_id, v.agenda_evento_id, v.telefone_digitos, v.descricao,
  v.valor, v.moeda, v.fechada_em, v.originador_id, v.originador_origem,
  v.plano_slug, v.plano_versao, v.comissao_percentual, v.comissao_base, v.comissao_valor,
  v.competencia, v.comissao_liberada_em, v.comissao_paga_em, v.comissao_pagamento_ref,
  v.status, v.cancelada_motivo, v.criado_em
`

// ─── Plano ───────────────────────────────────────────────────────────────────────────

async function planoAtivo(exec, empresaId) {
  const { rows } = await exec.query(
    `SELECT id, nome, slug, versao, faixas_json, gatilho, moeda, criado_em
       FROM app.comissao_planos
      WHERE empresa_id = $1 AND status = 'ativo'
      LIMIT 1`,
    [empresaId]
  )
  return rows[0] || null
}

/**
 * Publica uma VERSAO NOVA. Nunca um UPDATE no plano vigente: venda ja creditada aponta para a
 * versao sob a qual foi creditada, e reescrever aquela linha mudaria, retroativamente, o que a
 * empresa ja pagou. O plano anterior vira `arquivado` — some da vigencia e continua consultavel.
 */
async function publicarPlano(empresaId, { nome, faixas, gatilho }, usuarioId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const atual = await planoAtivo(client, empresaId)
    const slug = atual?.slug || 'sdr-v1'
    const versao = (atual?.versao || 0) + 1

    if (atual) {
      await client.query(
        `UPDATE app.comissao_planos SET status = 'arquivado', atualizado_em = NOW() WHERE id = $1`,
        [atual.id]
      )
    }

    const { rows } = await client.query(
      `INSERT INTO app.comissao_planos
         (empresa_id, nome, slug, versao, status, faixas_json, gatilho, moeda, criado_por)
       VALUES ($1, $2, $3, $4::int, 'ativo', $5::jsonb, $6, 'BRL', $7::uuid)
       RETURNING id, nome, slug, versao, faixas_json, gatilho, moeda, criado_em`,
      [empresaId, nome, slug, versao, JSON.stringify(faixas), gatilho, usuarioId || null]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Originador ──────────────────────────────────────────────────────────────────────

/**
 * Quem ORIGINOU o lead: a PRIMEIRA pessoa que o assumiu, lida do historico append-only da
 * migration 072. Nao e' `prospects.responsavel_id` — esse diz quem esta com o lead HOJE, e a
 * comissao e' de quem originou, nao de quem herdou.
 *
 * Decisao humana vence inferencia: se o operador informou o originador, ele ganha (o mesmo
 * principio de "follow-up registrado > recomendacao do call score").
 */
async function resolverOriginador(exec, { empresaId, prospectId, informadoId }) {
  if (informadoId) return { id: informadoId, origem: CM.ORIGINADOR_ORIGEM.OPERADOR }
  if (!prospectId) return { id: null, origem: CM.ORIGINADOR_ORIGEM.SEM_ORIGINADOR }

  const { rows } = await exec.query(
    `SELECT responsavel_novo_id
       FROM app.lead_responsavel_historico
      WHERE empresa_id = $1 AND prospect_id = $2::uuid AND responsavel_novo_id IS NOT NULL
      ORDER BY ocorrido_em ASC
      LIMIT 1`,
    [empresaId, prospectId]
  )
  if (rows[0]?.responsavel_novo_id) {
    return { id: rows[0].responsavel_novo_id, origem: CM.ORIGINADOR_ORIGEM.HISTORICO_LEAD }
  }
  return { id: null, origem: CM.ORIGINADOR_ORIGEM.SEM_ORIGINADOR }
}

// ─── Venda ───────────────────────────────────────────────────────────────────────────

async function registrarVenda(empresaId, dados, usuarioId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const originador = await resolverOriginador(client, {
      empresaId,
      prospectId: dados.prospect_id,
      informadoId: dados.originador_id,
    })

    const { rows } = await client.query(
      `INSERT INTO app.vendas
         (empresa_id, prospect_id, agenda_evento_id, telefone_digitos, descricao,
          valor, moeda, fechada_em, originador_id, originador_origem, registrada_por)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::numeric, $7,
               COALESCE($8::timestamptz, NOW()), $9::uuid, $10, $11::uuid)
       RETURNING id`,
      [
        empresaId, dados.prospect_id, dados.agenda_evento_id, dados.telefone_digitos,
        dados.descricao, dados.valor, dados.moeda, dados.fechada_em,
        originador.id, originador.origem, usuarioId || null,
      ]
    )

    // D1: quando a venda veio de uma REUNIAO, a mesma transacao mantem o valor no evento de
    // agenda. E' ele que o `meta-dispatch` le para emitir o `Purchase` da Meta — e evento aceito
    // pela Meta NAO se estorna. Um unico caminho de escrita, dois consumidores, sem divergencia.
    if (dados.agenda_evento_id) {
      await client.query(
        `UPDATE app.agenda_eventos
            SET venda_valor = $3::numeric,
                venda_moeda = $4,
                venda_registrada_em = COALESCE(venda_registrada_em, NOW()),
                atualizado_em = NOW()
          WHERE id = $2::uuid AND empresa_id = $1 AND tipo = 'reuniao'`,
        [empresaId, dados.agenda_evento_id, dados.valor, dados.moeda]
      )
    }

    await client.query('COMMIT')
    return obterVenda(empresaId, rows[0].id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function obterVenda(empresaId, vendaId) {
  const { rows } = await pool.query(
    `SELECT ${COLS_VENDA},
            u.nome AS originador_nome,
            COALESCE((SELECT SUM(p.valor) FROM app.venda_pagamentos p WHERE p.venda_id = v.id), 0) AS total_pago
       FROM app.vendas v
       LEFT JOIN app.usuarios u ON u.id = v.originador_id
      WHERE v.empresa_id = $1 AND v.id = $2::uuid`,
    [empresaId, vendaId]
  )
  return rows[0] || null
}

/**
 * `originadorId` nao e' filtro de tela: e' o ALCANCE de quem esta olhando. O SDR ve as vendas
 * que ele originou, e ponto — a carteira dos colegas nao e' recorte dele.
 */
async function listarVendas(empresaId, { originadorId = null, competencia = null, status = null, limite = 100 } = {}) {
  const params = [empresaId]
  const where = ['v.empresa_id = $1']
  if (originadorId) { params.push(originadorId); where.push(`v.originador_id = $${params.length}::uuid`) }
  if (competencia) { params.push(competencia); where.push(`v.competencia = $${params.length}::date`) }
  if (status) { params.push(status); where.push(`v.status = $${params.length}`) }
  params.push(Math.min(Math.max(Number(limite) || 100, 1), 500))

  const { rows } = await pool.query(
    `SELECT ${COLS_VENDA},
            u.nome AS originador_nome,
            COALESCE((SELECT SUM(p.valor) FROM app.venda_pagamentos p WHERE p.venda_id = v.id), 0) AS total_pago
       FROM app.vendas v
       LEFT JOIN app.usuarios u ON u.id = v.originador_id
      WHERE ${where.join(' AND ')}
      ORDER BY v.fechada_em DESC
      LIMIT $${params.length}`,
    params
  )
  return rows
}

async function listarPagamentos(empresaId, vendaId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.valor, p.moeda, p.recebido_em, p.metodo, p.referencia, p.observacao,
            p.criado_em, u.nome AS registrado_por_nome
       FROM app.venda_pagamentos p
       LEFT JOIN app.usuarios u ON u.id = p.registrado_por
      WHERE p.empresa_id = $1 AND p.venda_id = $2::uuid
      ORDER BY p.recebido_em ASC, p.criado_em ASC`,
    [empresaId, vendaId]
  )
  return rows
}

// ─── O credito ───────────────────────────────────────────────────────────────────────

/**
 * Registra um recebimento e, se ele for o gatilho, CREDITA a comissao — tudo numa transacao.
 *
 * A ordem importa: o lock vem antes da leitura do acumulado, senao a serializacao nao serve para
 * nada. E o acumulado soma `comissao_base` das vendas JA creditadas na competencia, nunca o
 * `valor` de vendas so' fechadas: o programa e' "faturamento PAGO no mes".
 */
async function registrarPagamento(empresaId, vendaId, dados, usuarioId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: vendaRows } = await client.query(
      `SELECT id, valor, moeda, status, originador_id, comissao_liberada_em
         FROM app.vendas
        WHERE empresa_id = $1 AND id = $2::uuid
        FOR UPDATE`,
      [empresaId, vendaId]
    )
    const venda = vendaRows[0]
    if (!venda) { await client.query('ROLLBACK'); return { ok: false, motivo: 'nao_encontrada' } }
    if (venda.status === CM.VENDA_STATUS.CANCELADA) {
      await client.query('ROLLBACK'); return { ok: false, motivo: CM.MOTIVO.CANCELADA }
    }

    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(valor), 0) AS total FROM app.venda_pagamentos WHERE venda_id = $1::uuid`,
      [vendaId]
    )
    const totalPagoAntes = Number(totalRows[0].total)

    const { rows: pagRows } = await client.query(
      `INSERT INTO app.venda_pagamentos
         (empresa_id, venda_id, valor, moeda, recebido_em, metodo, referencia, observacao, registrado_por)
       VALUES ($1, $2::uuid, $3::numeric, $4, $5::date, $6, $7, $8, $9::uuid)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        empresaId, vendaId, dados.valor, dados.moeda, dados.recebido_em,
        dados.metodo, dados.referencia, dados.observacao, usuarioId || null,
      ]
    )
    // Idempotencia: a referencia ja tinha sido lancada. Liberar comissao de novo sobre dinheiro
    // que entrou uma vez so' e exatamente o erro que o indice unico existe para impedir.
    if (!pagRows[0]) {
      await client.query('ROLLBACK')
      return { ok: false, motivo: 'pagamento_duplicado' }
    }

    let credito = null
    const plano = await planoAtivo(client, empresaId)

    if (
      !venda.comissao_liberada_em &&
      plano &&
      venda.originador_id &&
      CM.liberaComissao({ gatilho: plano.gatilho, totalPagoAntes, valorPagamento: dados.valor })
    ) {
      const competencia = CM.competenciaDe(dados.recebido_em)

      // SERIALIZACAO (ver o cabecalho). A chave e' (empresa, originador, competencia): dois
      // creditos do MESMO SDR no MESMO mes nao podem ler o mesmo acumulado.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [`${empresaId}:${venda.originador_id}`, competencia]
      )

      const { rows: acumRows } = await client.query(
        `SELECT COALESCE(SUM(comissao_base), 0) AS acumulado
           FROM app.vendas
          WHERE empresa_id = $1 AND originador_id = $2::uuid AND competencia = $3::date
            AND status IN ('comissao_liberada', 'comissao_paga')`,
        [empresaId, venda.originador_id, competencia]
      )
      const acumuladoAntes = Number(acumRows[0].acumulado)

      credito = CM.calcularCredito({ valorVenda: venda.valor, acumuladoAntes, plano })
      if (credito) {
        await client.query(
          `UPDATE app.vendas
              SET plano_id = $3::uuid, plano_slug = $4, plano_versao = $5::int,
                  comissao_percentual = $6::numeric, comissao_base = $7::numeric,
                  comissao_valor = $8::numeric, competencia = $9::date,
                  comissao_liberada_em = NOW(), status = 'comissao_liberada', atualizado_em = NOW()
            WHERE empresa_id = $1 AND id = $2::uuid`,
          [
            empresaId, vendaId, credito.plano_id, credito.plano_slug, credito.plano_versao,
            credito.comissao_percentual, credito.comissao_base, credito.comissao_valor, competencia,
          ]
        )
        credito.competencia = competencia
        credito.acumulado_antes = acumuladoAntes
      }
    }

    await client.query('COMMIT')
    return { ok: true, pagamento_id: pagRows[0].id, credito }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Marca a comissao como PAGA ao SDR (o lote semanal). Só sai de `comissao_liberada`. */
async function marcarComissaoPaga(empresaId, vendaId, { referencia = null } = {}, usuarioId) {
  const { rows } = await pool.query(
    `UPDATE app.vendas
        SET status = 'comissao_paga', comissao_paga_em = NOW(),
            comissao_paga_por = $4::uuid, comissao_pagamento_ref = $3, atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'comissao_liberada'
      RETURNING id, comissao_paga_em`,
    [empresaId, vendaId, referencia, usuarioId || null]
  )
  return rows[0] || null
}

/**
 * Cancelar so' e' permitido ANTES do credito. Depois de liberada, a comissao e um fato — o SDR
 * ja viu o numero no painel dele e pode ja ter recebido. Desfazer ali seria reescrever o passado,
 * que e' a coisa que este modulo inteiro existe para impedir.
 */
async function cancelarVenda(empresaId, vendaId, motivo) {
  const { rows } = await pool.query(
    `UPDATE app.vendas
        SET status = 'cancelada', cancelada_motivo = $3, atualizado_em = NOW()
      WHERE empresa_id = $1 AND id = $2::uuid AND status = 'aguardando_pagamento'
      RETURNING id`,
    [empresaId, vendaId, String(motivo || '').trim().slice(0, 300) || null]
  )
  return rows[0] || null
}

// ─── Painel e ranking ────────────────────────────────────────────────────────────────

async function acumuladoDoMes(empresaId, originadorId, competencia) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(comissao_base), 0) AS originado,
            COALESCE(SUM(comissao_valor), 0) AS comissao,
            COALESCE(SUM(comissao_valor) FILTER (WHERE status = 'comissao_paga'), 0) AS comissao_paga,
            COUNT(*)::int AS vendas
       FROM app.vendas
      WHERE empresa_id = $1 AND originador_id = $2::uuid AND competencia = $3::date
        AND status IN ('comissao_liberada', 'comissao_paga')`,
    [empresaId, originadorId, competencia]
  )
  return {
    originado: Number(rows[0].originado),
    comissao: Number(rows[0].comissao),
    comissao_paga: Number(rows[0].comissao_paga),
    vendas: rows[0].vendas,
  }
}

/**
 * O ranking devolve NOME e FATURAMENTO ORIGINADO — nunca a comissao de cada um. Quanto o colega
 * ganha e' assunto dele com a empresa (decisao D4, 2026-09-18); o placar mede resultado da
 * operacao, nao contracheque alheio.
 */
async function rankingDoMes(empresaId, competencia) {
  const { rows } = await pool.query(
    `SELECT v.originador_id AS usuario_id, u.nome,
            SUM(v.comissao_base) AS originado,
            COUNT(*)::int AS vendas
       FROM app.vendas v
       LEFT JOIN app.usuarios u ON u.id = v.originador_id
      WHERE v.empresa_id = $1 AND v.competencia = $2::date
        AND v.status IN ('comissao_liberada', 'comissao_paga')
        AND v.originador_id IS NOT NULL
      GROUP BY v.originador_id, u.nome`,
    [empresaId, competencia]
  )
  return CM.montarRanking(rows)
}

module.exports = {
  planoAtivo,
  publicarPlano,
  resolverOriginador,
  registrarVenda,
  obterVenda,
  listarVendas,
  listarPagamentos,
  registrarPagamento,
  marcarComissaoPaga,
  cancelarVenda,
  acumuladoDoMes,
  rankingDoMes,
}
