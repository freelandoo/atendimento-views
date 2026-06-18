'use strict'

const { enviarMensagem: enviarMensagemDefault, classificarErroEvolution } = require('../whatsapp')
const { canProspectLead, normalizarNumeroProspeccao } = require('./prospecting-eligibility')

const TIPO_MENSAGEM = 'abordagem_inicial'
const CANAL = 'whatsapp'
const STATUS_ENFILEIRADOS = new Set(['simulado', 'agendado'])

function normalizarId(valor) {
  return String(valor == null ? '' : valor).trim()
}

function mensagemFinalFila(row = {}) {
  return String(row.mensagem_editada || row.mensagem_gerada || '').trim()
}

function idempotencyKeyFila(filaId) {
  return `prospeccao:fila_diaria:${filaId}:${TIPO_MENSAGEM}:${CANAL}`
}

async function buscarItemFilaEnvio(pool, filaId) {
  const safeId = normalizarId(filaId)
  if (!safeId) {
    const err = new Error('fila_id obrigatorio.')
    err.statusCode = 400
    throw err
  }
  const { rows } = await pool.query(
    `
    SELECT
      f.*,
      p.nome AS prospect_nome,
      p.telefone AS prospect_telefone,
      p.status AS prospect_status,
      p.nicho AS prospect_nicho,
      p.cidade AS prospect_cidade
    FROM prospectador.prospeccao_fila_diaria f
    LEFT JOIN prospectador.prospects p ON p.id = f.prospect_id
    WHERE f.id = $1::uuid
    LIMIT 1
    `,
    [safeId]
  )
  const row = rows[0]
  if (!row) {
    const err = new Error('Item da fila nao encontrado.')
    err.statusCode = 404
    throw err
  }
  return row
}

function validarItemParaEnvio(row) {
  if (row.status === 'enviado' || row.status === 'respondido') {
    return { deduplicado: true, motivo: 'fila_ja_enviada' }
  }
  if (!STATUS_ENFILEIRADOS.has(row.status)) {
    const err = new Error('Item da fila precisa estar simulado ou agendado para envio.')
    err.statusCode = 409
    throw err
  }
  if (!row.slot_envio) {
    const err = new Error('Item sem slot_envio nao pode ser enviado.')
    err.statusCode = 409
    throw err
  }
  if (!row.prospect_id) {
    const err = new Error('Item sem prospect_id nao pode ser enviado.')
    err.statusCode = 409
    throw err
  }
  if (!mensagemFinalFila(row)) {
    const err = new Error('Item sem mensagem gerada/editada nao pode ser enviado.')
    err.statusCode = 409
    throw err
  }
  return null
}

async function reservarFilaParaEnvio(pool, filaId, jobId) {
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'enviando',
        job_id = COALESCE($2::bigint, job_id),
        tentativas = tentativas + 1,
        ultimo_erro = NULL,
        atualizado_em = NOW()
    WHERE id = $1::uuid
      AND status IN ('simulado', 'agendado')
      AND slot_envio IS NOT NULL
      AND COALESCE(NULLIF(BTRIM(mensagem_editada), ''), NULLIF(BTRIM(mensagem_gerada), '')) IS NOT NULL
    RETURNING *
    `,
    [filaId, jobId || null]
  )
  return rows[0] || null
}

async function reservarTentativaFila(pool, row, mensagem, jobId) {
  const numeroNormalizado = normalizarNumeroProspeccao(row.telefone_normalizado || row.prospect_telefone || '')
  const idempotencyKey = idempotencyKeyFila(row.id)
  try {
    const { rows } = await pool.query(
      `
      INSERT INTO prospectador.send_attempts (
        prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta,
        tipo_mensagem, canal, numero_normalizado, job_id, tentativas
      ) VALUES (
        $1::uuid, $2, md5($3), 'processing', NULL, '{}'::jsonb,
        $4, $5, $6, $7::bigint, 0
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET status = 'processing',
          erro = NULL,
          mensagem_hash = EXCLUDED.mensagem_hash,
          numero_normalizado = COALESCE(EXCLUDED.numero_normalizado, prospectador.send_attempts.numero_normalizado),
          job_id = COALESCE(EXCLUDED.job_id, prospectador.send_attempts.job_id),
          updated_at = NOW()
      WHERE prospectador.send_attempts.status IN ('failed', 'scheduled')
      RETURNING *
      `,
      [row.prospect_id, idempotencyKey, mensagem, TIPO_MENSAGEM, CANAL, numeroNormalizado, jobId || null]
    )
    if (!rows[0]) return { reservado: false, motivo: 'tentativa_ja_processada', idempotencyKey, numeroNormalizado }
    return { reservado: true, tentativa: rows[0], idempotencyKey, numeroNormalizado }
  } catch (err) {
    if (err?.code === '23505') return { reservado: false, motivo: 'numero_ou_prospect_ja_enviado', idempotencyKey, numeroNormalizado }
    throw err
  }
}

async function atualizarTentativa(pool, { row, mensagem, idempotencyKey, numeroNormalizado, jobId, status, erro = null, evolutionResposta = {} }) {
  await pool.query(
    `
    INSERT INTO prospectador.send_attempts (
      prospect_id, idempotency_key, mensagem_hash, status, erro, evolution_resposta,
      tipo_mensagem, canal, numero_normalizado, job_id, tentativas, enviado_em
    ) VALUES (
      $1::uuid, $2, md5($3), $4, $5, $6::jsonb,
      $7, $8, $9, $10::bigint, 1, CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET status = EXCLUDED.status,
        erro = EXCLUDED.erro,
        evolution_resposta = EXCLUDED.evolution_resposta,
        mensagem_hash = EXCLUDED.mensagem_hash,
        numero_normalizado = COALESCE(EXCLUDED.numero_normalizado, prospectador.send_attempts.numero_normalizado),
        job_id = COALESCE(EXCLUDED.job_id, prospectador.send_attempts.job_id),
        tentativas = prospectador.send_attempts.tentativas + 1,
        enviado_em = CASE WHEN EXCLUDED.status = 'sent' THEN NOW() ELSE prospectador.send_attempts.enviado_em END,
        updated_at = NOW()
    `,
    [
      row.prospect_id,
      idempotencyKey,
      mensagem,
      status,
      erro || null,
      JSON.stringify(evolutionResposta || {}),
      TIPO_MENSAGEM,
      CANAL,
      numeroNormalizado || null,
      jobId || null,
    ]
  )
}

async function marcarFilaBloqueada(pool, filaId, status, erro) {
  const finalStatus = status === 'cancelado' ? 'cancelado' : 'falhou'
  await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = $2,
        ultimo_erro = $3,
        atualizado_em = NOW()
    WHERE id = $1::uuid
    `,
    [filaId, finalStatus, String(erro || '').slice(0, 800) || null]
  )
}

async function marcarFilaEnviada(pool, row, evolutionResposta) {
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'enviado',
        ultimo_erro = NULL,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb,
        atualizado_em = NOW()
    WHERE id = $1::uuid
    RETURNING *
    `,
    [
      row.id,
      JSON.stringify({
        envio: {
          enviado_em: new Date().toISOString(),
          provider: 'evolution',
        },
      }),
    ]
  )
  await pool.query(
    `
    UPDATE prospectador.prospects
    SET status = 'enviado',
        updated_at = NOW()
    WHERE id = $1::uuid
      AND status IN ('aguardando', 'aprovado')
    `,
    [row.prospect_id]
  ).catch(() => {})
  return { item: rows[0] || null, evolution: evolutionResposta || null }
}

async function processarEnvioFilaAgendado(pool, filaId, deps = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('pool com query() e obrigatorio.')

  const jobId = deps.jobId || deps.job_id || null
  const enviarMensagemFn = typeof deps.enviarMensagemFn === 'function' ? deps.enviarMensagemFn : enviarMensagemDefault
  const row = await buscarItemFilaEnvio(pool, filaId)
  const validacaoInicial = validarItemParaEnvio(row)
  if (validacaoInicial?.deduplicado) return { ok: true, deduplicado: true, motivo: validacaoInicial.motivo, fila_id: row.id }

  const telefone = normalizarNumeroProspeccao(row.telefone_normalizado || row.prospect_telefone || '')
  const elegibilidade = await canProspectLead(pool, telefone, {
    prospectId: row.prospect_id,
    filaId: row.id,
    jobId,
  })
  if (!elegibilidade.allowed) {
    await marcarFilaBloqueada(pool, row.id, 'cancelado', `elegibilidade:${elegibilidade.reason}`)
    return { ok: false, fila_id: row.id, bloqueado: true, motivo: elegibilidade.reason }
  }

  const reservadoFila = await reservarFilaParaEnvio(pool, row.id, jobId)
  if (!reservadoFila) {
    const atual = await buscarItemFilaEnvio(pool, row.id).catch(() => null)
    return { ok: true, deduplicado: true, motivo: atual?.status === 'enviado' ? 'fila_ja_enviada' : 'fila_nao_reservada', fila_id: row.id }
  }

  const mensagem = mensagemFinalFila({ ...row, ...reservadoFila })
  const reserva = await reservarTentativaFila(pool, row, mensagem, jobId)
  if (!reserva.reservado) {
    await marcarFilaBloqueada(pool, row.id, 'cancelado', reserva.motivo)
    return { ok: true, deduplicado: true, motivo: reserva.motivo, fila_id: row.id }
  }

  try {
    const evolution = await enviarMensagemFn(telefone, mensagem)
    await atualizarTentativa(pool, {
      row,
      mensagem,
      idempotencyKey: reserva.idempotencyKey,
      numeroNormalizado: reserva.numeroNormalizado,
      jobId,
      status: 'sent',
      evolutionResposta: evolution,
    })
    const enviado = await marcarFilaEnviada(pool, row, evolution)
    return {
      ok: true,
      fila_id: row.id,
      prospect_id: row.prospect_id,
      status: 'enviado',
      item: enviado.item,
      evolution,
    }
  } catch (err) {
    const classificacao = err.evolutionClassificacao || classificarErroEvolution(err)
    const erroEstruturado = {
      message: err.message || 'falha_envio',
      tipo: classificacao.tipo,
      retryable: classificacao.retryable,
      motivo: classificacao.motivo,
      http_status: err.response?.status || null,
    }
    await atualizarTentativa(pool, {
      row,
      mensagem,
      idempotencyKey: reserva.idempotencyKey,
      numeroNormalizado: reserva.numeroNormalizado,
      jobId,
      status: 'failed',
      erro: JSON.stringify(erroEstruturado),
      evolutionResposta: err.response?.data || {},
    })
    await pool.query(
      `
      UPDATE prospectador.prospeccao_fila_diaria
      SET status = $2,
          ultimo_erro = $3,
          atualizado_em = NOW()
      WHERE id = $1::uuid
      `,
      [row.id, classificacao.retryable ? 'agendado' : 'falhou', erroEstruturado.message]
    )
    // numero_inexistente = WhatsApp respondeu exists:false. Marca o prospect
    // como 'rejeitado' pra que a query de candidatos (que filtra por status
    // IN ('aguardando','aprovado')) nunca mais o selecione. Auto-cicatrizante:
    // proxima rodada diaria nem o considera. Solucao para os 18+ HTTP 400 de
    // fixos sem WhatsApp gerados todo dia.
    if (classificacao.tipo === 'numero_inexistente' && row.prospect_id) {
      await pool.query(
        `
        UPDATE prospectador.prospects
        SET status = 'rejeitado',
            motivo_score = COALESCE(motivo_score, '') || ' | numero_sem_whatsapp',
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status NOT IN ('rejeitado', 'respondeu')
        `,
        [row.prospect_id]
      ).catch(() => {})
    }
    if (classificacao.retryable) {
      err.evolutionRetryable = true
      err.evolutionTipo = classificacao.tipo
      throw err
    }
    return { ok: false, fila_id: row.id, erro: erroEstruturado.message, retryable: false, tipo_erro: classificacao.tipo }
  }
}

async function prepararItemFilaParaJobEnvio(pool, filaId) {
  const row = await buscarItemFilaEnvio(pool, filaId)
  validarItemParaEnvio(row)
  return {
    ok: true,
    fila_id: row.id,
    prospect_id: row.prospect_id,
    slot_envio: row.slot_envio,
    mensagem_final: mensagemFinalFila(row),
  }
}

async function marcarJobAgendadoNaFila(pool, filaId, jobId) {
  const { rows } = await pool.query(
    `
    UPDATE prospectador.prospeccao_fila_diaria
    SET status = 'agendado',
        job_id = $2::bigint,
        atualizado_em = NOW()
    WHERE id = $1::uuid
      AND status IN ('simulado', 'agendado')
    RETURNING *
    `,
    [filaId, jobId]
  )
  return rows[0] || null
}

module.exports = {
  TIPO_MENSAGEM,
  CANAL,
  STATUS_ENFILEIRADOS,
  mensagemFinalFila,
  idempotencyKeyFila,
  buscarItemFilaEnvio,
  processarEnvioFilaAgendado,
  prepararItemFilaParaJobEnvio,
  marcarJobAgendadoNaFila,
}
