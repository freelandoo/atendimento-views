'use strict'

/**
 * Delay humanizado de resposta.
 *
 * Dois mecanismos complementares:
 *
 * 1. calculateReplyDelay(userMessage, botReply)
 *    Delay dinâmico baseado no tamanho das mensagens. Simula tempo de leitura
 *    da mensagem do lead + tempo de digitação da resposta.
 *
 * 2. MULTI_MESSAGE_BUFFER_SECONDS / isMultiMessageSequence
 *    Quando o lead manda várias mensagens em sequência (digitando em partes),
 *    a IA aguarda esse buffer antes de responder para não interromper o lead
 *    no meio do raciocínio.
 *
 * Limites:
 *   MIN_DELAY_SECONDS = 3   → nunca responde instantaneamente
 *   MAX_DELAY_SECONDS = 30  → nunca espera mais de 30s
 *   MULTI_MESSAGE_BUFFER_SECONDS = 15 → janela de espera para mensagens sequenciais
 *
 * Nota sobre integração com o sistema existente:
 *   WEBHOOK_REPLY_DEBOUNCE_MS (2,5s) já batcha mensagens muito rápidas no webhook.
 *   Este módulo atua DEPOIS do processamento — é o delay antes de enviar a resposta.
 */

const MIN_DELAY_SECONDS = 3
const MAX_DELAY_SECONDS = 30
const MULTI_MESSAGE_BUFFER_SECONDS = 15

// Janela de tempo considerada "sequência rápida" de mensagens
const MULTI_MESSAGE_WINDOW_MS = 30_000  // 30 segundos

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Calcula o delay de resposta em segundos baseado no tamanho das mensagens.
 *
 * Lógica:
 *   base = 5s
 *   + 5s se userMessage > 100 chars  (lead escreveu um parágrafo)
 *   + 8s se userMessage > 300 chars  (lead escreveu muito — precisa ler com cuidado)
 *   + 6s se botReply > 500 chars     (resposta longa — simula tempo de digitação)
 *   clamped em [3, 30] segundos
 *
 * @param {string} userMessage  Última mensagem do lead
 * @param {string} botReply     Resposta completa que será enviada
 * @returns {number}  Segundos de delay
 */
function calculateReplyDelay(userMessage, botReply) {
  const userLength = String(userMessage || '').length
  const replyLength = String(botReply || '').length

  let delay = 5

  if (userLength > 100) delay += 5
  if (userLength > 300) delay += 8
  if (replyLength > 500) delay += 6

  return Math.min(Math.max(delay, MIN_DELAY_SECONDS), MAX_DELAY_SECONDS)
}

/**
 * Detecta se o lead está em modo de "mensagens sequenciais" —
 * mandando várias mensagens curtas em sequência dentro de uma janela de tempo.
 *
 * Aceita dois formatos:
 *   - Array de timestamps em ms: [1715000000, 1715000010000, ...]
 *   - Array de objetos: [{ timestamp: number }, ...]
 *   - Número simples: count de mensagens no lote atual
 *
 * @param {number[]|object[]|number} input  Timestamps, objetos com timestamp, ou count
 * @param {number} [windowMs]              Janela de detecção (padrão: 30s)
 * @returns {boolean}
 */
function isMultiMessageSequence(input, windowMs = MULTI_MESSAGE_WINDOW_MS) {
  // Aceita count numérico simples (ex: job_queue batch size)
  if (typeof input === 'number') {
    return input >= 2
  }

  if (!Array.isArray(input) || input.length < 2) return false

  // Normaliza para array de timestamps
  const timestamps = input.map((item) => {
    if (typeof item === 'number') return item
    if (typeof item === 'object' && item !== null) {
      return item.timestamp || item.created_at || item.ts || 0
    }
    return 0
  }).filter((t) => t > 0)

  if (timestamps.length < 2) return false

  const newest = Math.max(...timestamps)
  const oldest = Math.min(...timestamps)

  return (newest - oldest) <= windowMs
}

/**
 * Calcula o delay final considerando contexto de múltiplas mensagens.
 * Se o lead está em modo de mensagens sequenciais, garante o buffer mínimo.
 *
 * @param {string}              userMessage      Última mensagem do lead
 * @param {string}              botReply         Resposta a ser enviada
 * @param {number[]|object[]|number} [recentUserMessages]  Para detecção multi-message
 * @returns {{ seconds: number, isMultiMessage: boolean, breakdown: object }}
 */
function calculateDelayWithContext(userMessage, botReply, recentUserMessages = 1) {
  const baseDelay = calculateReplyDelay(userMessage, botReply)
  const multiMessage = isMultiMessageSequence(recentUserMessages)

  // Se multi-message, garante no mínimo MULTI_MESSAGE_BUFFER_SECONDS
  const seconds = multiMessage
    ? Math.min(Math.max(baseDelay, MULTI_MESSAGE_BUFFER_SECONDS), MAX_DELAY_SECONDS)
    : baseDelay

  const userLength = String(userMessage || '').length
  const replyLength = String(botReply || '').length

  return {
    seconds,
    isMultiMessage: multiMessage,
    breakdown: {
      base: 5,
      userReadingTime: userLength > 300 ? 13 : userLength > 100 ? 5 : 0,
      replyTypingTime: replyLength > 500 ? 6 : 0,
      multiMessageBuffer: multiMessage ? Math.max(0, MULTI_MESSAGE_BUFFER_SECONDS - baseDelay) : 0,
    },
  }
}

/**
 * Converte segundos em milissegundos.
 *
 * @param {number} seconds
 * @returns {number}
 */
function delayToMs(seconds) {
  return Math.round(seconds * 1000)
}

/**
 * Aguarda o delay calculado. Retorna o número de ms esperados.
 *
 * @param {number} seconds
 * @returns {Promise<number>}
 */
async function sleep(seconds) {
  const ms = delayToMs(seconds)
  await new Promise((resolve) => setTimeout(resolve, ms))
  return ms
}

module.exports = {
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  MULTI_MESSAGE_BUFFER_SECONDS,
  MULTI_MESSAGE_WINDOW_MS,
  calculateReplyDelay,
  isMultiMessageSequence,
  calculateDelayWithContext,
  delayToMs,
  sleep,
}
