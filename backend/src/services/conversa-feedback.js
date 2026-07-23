'use strict'

const crypto = require('crypto')
const {
  buscarContexto2Ativo,
  registrarSugestaoAprendizadoContexto,
} = require('./contexto-empresa')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'
const TIPOS = new Set(['positivo', 'negativo'])
const TAGS_VALIDAS = new Set([
  'tom_ruim',
  'nao_respondeu',
  'inventou_informacao',
  'preco_link_errado',
  'repetiu_pergunta',
  'fora_do_contexto',
])

function httpError(statusCode, code, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  return err
}

function textoMensagem(m) {
  return String(m?.content || m?.text || '').trim()
}

function truncar(texto, max = 1200) {
  const s = String(texto || '')
  return s.length > max ? `${s.slice(0, max)}...` : s
}

function normalizarTags(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  for (const raw of tags) {
    const tag = String(raw || '').trim()
    if (TAGS_VALIDAS.has(tag) && !out.includes(tag)) out.push(tag)
  }
  return out.slice(0, 8)
}

function hashMensagem(index, mensagem) {
  const h = crypto.createHash('sha256')
  h.update(String(index))
  h.update('|')
  h.update(String(mensagem?.role || ''))
  h.update('|')
  h.update(String(mensagem?.timestamp || ''))
  h.update('|')
  h.update(textoMensagem(mensagem))
  return h.digest('hex')
}

function montarSnapshot(historico, index) {
  const inicio = Math.max(0, index - 2)
  const fim = Math.min(historico.length, index + 3)
  return {
    mensagem: {
      index,
      role: historico[index]?.role || null,
      timestamp: historico[index]?.timestamp || null,
      content: truncar(textoMensagem(historico[index]), 1600),
    },
    janela: historico.slice(inicio, fim).map((m, offset) => ({
      index: inicio + offset,
      role: m?.role || null,
      timestamp: m?.timestamp || null,
      content: truncar(textoMensagem(m), 700),
    })),
  }
}

function montarEvidenciaFeedback({ observacao, tags, mensagem }) {
  const partes = [
    'Feedback negativo do operador sobre uma resposta real do agente.',
    `Observacao do operador: ${observacao}`,
  ]
  if (tags.length) partes.push(`Tags: ${tags.join(', ')}`)
  partes.push(`Trecho da resposta criticada: ${truncar(mensagem, 700)}`)
  return partes.join('\n')
}

function montarSugestaoMarkdown({ observacao, tags }) {
  return [
    'Revisar o Playbook ativo de forma minima e cirurgica para evitar repetir este erro em conversas futuras.',
    `Motivo reportado pelo operador: ${observacao}`,
    tags.length ? `Categorias do problema: ${tags.join(', ')}` : null,
    'Nao reescrever o playbook inteiro; ajustar apenas a regra, resposta-base, limite ou orientacao diretamente relacionada.',
  ].filter(Boolean).join('\n')
}

async function registrarFeedbackConversa({
  pool,
  empresaId,
  numero,
  mensagemIndex,
  tipo,
  tags = [],
  observacao = '',
  usuarioId = null,
  log = null,
  _buscarContexto2Ativo = buscarContexto2Ativo,
  _registrarSugestaoAprendizadoContexto = registrarSugestaoAprendizadoContexto,
} = {}) {
  if (!pool || !empresaId || !numero) {
    throw httpError(400, 'BAD_REQUEST', 'Dados obrigatorios ausentes.')
  }
  const tipoNorm = String(tipo || '').trim()
  if (!TIPOS.has(tipoNorm)) throw httpError(400, 'BAD_FEEDBACK_TYPE', 'Tipo de feedback invalido.')

  const idx = Number.parseInt(mensagemIndex, 10)
  if (!Number.isInteger(idx) || idx < 0) throw httpError(400, 'BAD_MESSAGE_INDEX', 'Indice de mensagem invalido.')

  const obs = truncar(String(observacao || '').trim(), 2000)
  if (tipoNorm === 'negativo' && !obs) {
    throw httpError(400, 'OBSERVATION_REQUIRED', 'Explique o motivo do feedback negativo.')
  }
  const tagsNorm = normalizarTags(tags)

  const { rows: [conversa] } = await pool.query(
    `SELECT c.id, c.numero, c.historico, c.evolution_instance
       FROM vendas.conversas c
      WHERE (c.empresa_id = $1 OR ($1::uuid = $2::uuid AND c.empresa_id IS NULL))
        AND c.numero = $3`,
    [empresaId, PJ_EMPRESA_ID, numero]
  )
  if (!conversa) throw httpError(404, 'NOT_FOUND', 'Conversa nao encontrada.')

  const historico = Array.isArray(conversa.historico) ? conversa.historico : []
  const mensagem = historico[idx]
  if (!mensagem) throw httpError(400, 'MESSAGE_NOT_FOUND', 'Mensagem nao encontrada no historico.')
  if (mensagem.role !== 'assistant') {
    throw httpError(400, 'MESSAGE_NOT_ASSISTANT', 'Feedback so pode ser registrado em resposta do agente.')
  }

  const texto = textoMensagem(mensagem)
  const snapshot = montarSnapshot(historico, idx)
  const ativo = await _buscarContexto2Ativo(pool, empresaId, conversa.evolution_instance || null).catch((err) => {
    if (log && typeof log.warn === 'function') {
      log.warn({ err: err.message, empresaId }, 'Falha ao buscar playbook ativo para feedback')
    }
    return null
  })

  const client = await pool.connect()
  let feedback
  let sugestao = null
  try {
    await client.query('BEGIN')
    const { rows: [fb] } = await client.query(
      `INSERT INTO app.conversa_feedbacks
        (empresa_id, conversa_id, lead_phone, evolution_instance, mensagem_index, mensagem_hash,
         tipo, tags, observacao, mensagem_snapshot, contexto_versao_id, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        empresaId,
        conversa.id ? String(conversa.id) : null,
        conversa.numero,
        conversa.evolution_instance || null,
        idx,
        hashMensagem(idx, mensagem),
        tipoNorm,
        JSON.stringify(tagsNorm),
        obs || null,
        JSON.stringify(snapshot),
        ativo?.versao_id || null,
        usuarioId || null,
      ]
    )
    feedback = fb
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  if (tipoNorm === 'negativo' && ativo?.versao_id) {
    try {
      sugestao = await _registrarSugestaoAprendizadoContexto({
        pool,
        empresaId,
        contextoVersaoId: ativo.versao_id,
        conversaId: conversa.id ? String(conversa.id) : null,
        leadPhone: conversa.numero,
        tipo: 'feedback_resposta',
        evidencia: montarEvidenciaFeedback({ observacao: obs, tags: tagsNorm, mensagem: texto }),
        sugestaoJson: {
          origem: 'conversa_feedback',
          feedback_id: feedback.id,
          tags: tagsNorm,
          mensagem_index: idx,
        },
        sugestaoMarkdown: montarSugestaoMarkdown({ observacao: obs, tags: tagsNorm }),
        confianca: 'media',
        impactoComercial: 'Feedback humano sobre resposta do agente no historico de conversa.',
        feedbackId: feedback.id,
      })
    } catch (err) {
      if (log && typeof log.warn === 'function') {
        log.warn({ err: err.message, feedbackId: feedback.id }, 'Falha ao criar sugestao a partir de feedback')
      }
      sugestao = null
    }
    if (sugestao?.id) {
      await pool.query(
        `UPDATE app.conversa_feedbacks
            SET sugestao_id = $2
          WHERE id = $1 AND empresa_id = $3`,
        [feedback.id, sugestao.id, empresaId]
      ).catch((err) => {
        if (log && typeof log.warn === 'function') {
          log.warn({ err: err.message, feedbackId: feedback.id }, 'Falha ao vincular sugestao ao feedback')
        }
      })
    }
  }

  return {
    feedback,
    sugestao,
    criou_sugestao: !!sugestao,
    contexto_versao_id: ativo?.versao_id || null,
  }
}

module.exports = {
  registrarFeedbackConversa,
  _internals: {
    normalizarTags,
    hashMensagem,
    montarSnapshot,
  },
}
