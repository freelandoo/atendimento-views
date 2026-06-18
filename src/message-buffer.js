'use strict'

/**
 * Buffer de mensagens por lead.
 *
 * Resolve o problema de WhatsApp multipart: lead manda "Oi", depois "Tenho
 * interesse", depois "Quanto fica?", depois "Sou de Santo André" — cada uma
 * em mensagem separada. A IA não pode responder ao "Oi" sem contexto do resto.
 *
 * Funcionamento:
 *   recebeu mensagem → guarda no buffer → reseta timer
 *   timer expira sem nova mensagem → flush → consolidate → processa tudo junto
 *
 * Relação com WEBHOOK_REPLY_DEBOUNCE_MS (2,5s):
 *   O debounce existente batcha mensagens ultrarrápidas antes de enfileirar o job.
 *   Este buffer atua ANTES, acumulando mensagens que chegam com 3-15s de intervalo.
 *   Camadas: Buffer(10-20s) → Debounce(2,5s) → Job Queue → IA
 *
 * O MessageBuffer é testável via injeção de timer:
 *   new MessageBuffer({ _setTimeout: fakeTimeout, _clearTimeout: fakeClear })
 */

const DEFAULT_BUFFER_WINDOW_MS = 15_000  // 15 segundos
const MIN_BUFFER_WINDOW_MS = 10_000
const MAX_BUFFER_WINDOW_MS = 20_000

// ─── Consolidação (função pura) ───────────────────────────────────────────────

/**
 * Consolida um array de mensagens em um único texto para processamento.
 *
 * Regras:
 *   - Mensagens vazias são ignoradas
 *   - Mensagens idênticas consecutivas são deduplicadas
 *   - Mensagem única retorna sem alteração
 *
 * @param {string[]} messages
 * @returns {string}
 */
function consolidateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''

  const cleaned = messages
    .map((m) => String(m || '').trim())
    .filter((m) => m.length > 0)

  if (cleaned.length === 0) return ''
  if (cleaned.length === 1) return cleaned[0]

  // Deduplica consecutivos idênticos (ex: lead clicou 2x no mesmo botão)
  const deduped = cleaned.filter((m, i) => i === 0 || m !== cleaned[i - 1])

  return deduped.join('\n')
}

/**
 * Extrai as N últimas mensagens de usuário de um histórico WhatsApp
 * e as consolida para uso como contexto combinado.
 *
 * @param {Array<{role: string, content: string}>} historico
 * @param {number} [limit=10]  Máximo de mensagens a considerar
 * @returns {string}
 */
function consolidateFromHistory(historico, limit = 10) {
  if (!Array.isArray(historico) || historico.length === 0) return ''

  const userMessages = historico
    .filter((m) => m && m.role === 'user')
    .slice(-limit)
    .map((m) => String(m.content || '').trim())

  return consolidateMessages(userMessages)
}

// ─── MessageBuffer ────────────────────────────────────────────────────────────

class MessageBuffer {
  /**
   * @param {object} [options]
   * @param {number}   [options.bufferWindowMs=15000]  Janela de espera em ms
   * @param {function} [options.onFlush]               Callback quando o buffer dispara
   * @param {function} [options._setTimeout]            Injeção de timer (para testes)
   * @param {function} [options._clearTimeout]          Injeção de cancel (para testes)
   */
  constructor(options = {}) {
    this.bufferWindowMs = Math.min(
      Math.max(options.bufferWindowMs || DEFAULT_BUFFER_WINDOW_MS, MIN_BUFFER_WINDOW_MS),
      MAX_BUFFER_WINDOW_MS
    )
    this.onFlush = options.onFlush || null
    this._setTimeout = options._setTimeout || setTimeout
    this._clearTimeout = options._clearTimeout || clearTimeout
    this._buffers = new Map()  // leadId → BufferEntry
  }

  /**
   * Adiciona uma mensagem ao buffer do lead e reinicia o timer.
   * Retorna o estado atual do buffer desse lead.
   *
   * @param {string} leadId    Identificador do lead (número WhatsApp, e.g. "5511999999999")
   * @param {string} message   Texto da mensagem
   * @returns {{ leadId, messages, lastMessageAt, messageCount }}
   */
  add(leadId, message) {
    const entry = this._getOrCreate(leadId)
    const text = String(message || '').trim()
    if (text) {
      entry.messages.push(text)
      entry.lastMessageAt = new Date()
    }
    this._resetTimer(leadId, entry)
    return this._snapshot(leadId, entry)
  }

  /**
   * Força o flush imediato do buffer sem esperar o timer.
   * Remove o buffer do lead e retorna os dados consolidados.
   * Retorna null se não há buffer para esse lead.
   *
   * @param {string} leadId
   * @returns {{ leadId, messages, consolidated, lastMessageAt, messageCount } | null}
   */
  flush(leadId) {
    const entry = this._buffers.get(leadId)
    if (!entry) return null
    this._clearTimer(entry)
    const result = {
      leadId,
      messages: [...entry.messages],
      consolidated: consolidateMessages(entry.messages),
      lastMessageAt: entry.lastMessageAt,
      messageCount: entry.messages.length,
    }
    this._buffers.delete(leadId)
    return result
  }

  /**
   * Retorna o estado atual do buffer sem removê-lo.
   * Retorna null se não há buffer para esse lead.
   *
   * @param {string} leadId
   * @returns {{ leadId, messages, lastMessageAt, messageCount } | null}
   */
  peek(leadId) {
    const entry = this._buffers.get(leadId)
    if (!entry) return null
    return this._snapshot(leadId, entry)
  }

  /**
   * Retorna true se há mensagens em buffer para esse lead.
   *
   * @param {string} leadId
   * @returns {boolean}
   */
  has(leadId) {
    return this._buffers.has(leadId)
  }

  /**
   * Número de leads com buffer ativo.
   *
   * @returns {number}
   */
  size() {
    return this._buffers.size
  }

  /**
   * Cancela e remove o buffer de um lead sem processar.
   *
   * @param {string} leadId
   */
  cancel(leadId) {
    const entry = this._buffers.get(leadId)
    if (entry) this._clearTimer(entry)
    this._buffers.delete(leadId)
  }

  /**
   * Cancela e remove todos os buffers ativos.
   */
  cancelAll() {
    for (const entry of this._buffers.values()) {
      this._clearTimer(entry)
    }
    this._buffers.clear()
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  _getOrCreate(leadId) {
    if (!this._buffers.has(leadId)) {
      this._buffers.set(leadId, {
        messages: [],
        lastMessageAt: new Date(),
        timer: null,
      })
    }
    return this._buffers.get(leadId)
  }

  _resetTimer(leadId, entry) {
    this._clearTimer(entry)
    entry.timer = this._setTimeout(() => {
      const result = this.flush(leadId)
      if (result && this.onFlush) {
        try { this.onFlush(result) } catch (_) { /* caller error, não propaga */ }
      }
    }, this.bufferWindowMs)
  }

  _clearTimer(entry) {
    if (entry.timer !== null) {
      this._clearTimeout(entry.timer)
      entry.timer = null
    }
  }

  _snapshot(leadId, entry) {
    return {
      leadId,
      messages: [...entry.messages],
      lastMessageAt: entry.lastMessageAt,
      messageCount: entry.messages.length,
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria uma instância de MessageBuffer com as opções fornecidas.
 *
 * @param {object} [options]
 * @returns {MessageBuffer}
 */
function createMessageBuffer(options = {}) {
  return new MessageBuffer(options)
}

module.exports = {
  DEFAULT_BUFFER_WINDOW_MS,
  MIN_BUFFER_WINDOW_MS,
  MAX_BUFFER_WINDOW_MS,
  consolidateMessages,
  consolidateFromHistory,
  MessageBuffer,
  createMessageBuffer,
}
