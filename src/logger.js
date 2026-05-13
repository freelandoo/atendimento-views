// @ts-check
'use strict'

const util = require('util')
const pino = require('pino')

const SECRET_ENV_KEYS = [
  'ANTHROPIC_KEY',
  'OPENAI_KEY',
  'EVOLUTION_API_KEY',
  'REPROCESS_SECRET',
  'WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_CSE_KEY',
  'GOOGLE_PLACES_API_KEY',
]

const SECRET_FIELD_RE = /(authorization|apikey|api_key|x-api-key|token|secret|password|senha|key)$/i
const PHONE_FIELD_RE = /(telefone|phone|numero|number|jid|remoteJid|remoteJidAlt)$/i
const MAX_STRING_LENGTH = 2000

/**
 * @typedef {Record<string, unknown>} LogContext
 * @typedef {{ id?: number|string, tipo?: string, dedupe_key?: string, payload?: unknown }} JobPayload
 * @typedef {{ request_id?: string, flow?: string, numero?: string, event?: string }} WebhookLogContext
 * @typedef {{ message?: string, code?: string, response?: { status?: number, data?: unknown } }} ExternalErrorLike
 * @typedef {'trace'|'debug'|'info'|'warn'|'error'|'fatal'} LogLevel
 */

const secretValues = SECRET_ENV_KEYS
  .map((key) => String(process.env[key] || '').trim())
  .filter((value) => value.length >= 6)

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function redactPhone(value) {
  const raw = String(value || '')
  if (!raw) return raw
  const suffix = /@([a-z0-9.-]+)$/i.exec(raw)?.[0] || ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return raw
  const last4 = digits.slice(-4)
  const first2 = digits.length >= 12 ? digits.slice(0, 2) : ''
  return `${first2 ? `${first2}***` : '***'}${last4}${suffix}`
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactSecretsInString(value) {
  let out = value
  for (const secret of secretValues) {
    out = out.split(secret).join('[REDACTED_SECRET]')
  }
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1[REDACTED_SECRET]')
  out = out.replace(/((?:x-api-key|apikey|api_key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED_SECRET]')
  return out
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactPhonesInString(value) {
  return value.replace(/(?:\+?55\D*)?(?:\(?\d{2}\)?\D*)?9?\d{4}\D*\d{4}(?:@s\.whatsapp\.net|@lid)?/gi, (/** @type {string} */ match) => {
    const digits = match.replace(/\D/g, '')
    return digits.length >= 8 ? redactPhone(match) : match
  })
}

/**
 * @param {string} value
 * @returns {string}
 */
function redactString(value) {
  const truncated = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value
  return redactPhonesInString(redactSecretsInString(truncated))
}

/**
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function redactValue(value, key = '') {
  if (value == null) return value
  if (typeof value === 'string') {
    if (SECRET_FIELD_RE.test(key)) return '[REDACTED_SECRET]'
    if (PHONE_FIELD_RE.test(key)) return redactPhone(value)
    return redactString(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key))
  if (!isPlainObject(value)) return redactString(String(value))

  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELD_RE.test(k)) {
      out[k] = '[REDACTED_SECRET]'
    } else if (PHONE_FIELD_RE.test(k)) {
      out[k] = typeof v === 'string' || typeof v === 'number' ? redactPhone(v) : redactValue(v, k)
    } else {
      out[k] = redactValue(v, k)
    }
  }
  return out
}

/**
 * @param {unknown} err
 * @returns {Record<string, unknown>|null}
 */
function serializeError(err) {
  if (!err) return null
  const e = /** @type {ExternalErrorLike & Error} */ (err)
  /** @type {Record<string, unknown>} */
  const out = {
    type: e.name || 'Error',
    message: redactString(e.message || String(err)),
  }
  if (e.code) out.code = redactString(String(e.code))
  if (e.response) {
    out.http_status = e.response.status || null
    out.response_data = redactValue(e.response.data)
  }
  if (e.stack) out.stack = redactString(e.stack)
  return out
}

/**
 * @param {unknown[]} args
 * @returns {string}
 */
function safeFormat(args) {
  return redactString(util.format(...args.map((arg) => {
    if (arg instanceof Error) return arg.message
    if (typeof arg === 'object' && arg !== null) return redactValue(arg)
    return arg
  })))
}

/**
 * @param {import('pino').Logger} base
 */
function createLogger(base) {
  const wrapped = {
    /**
     * @param {LogContext} bindings
     */
    child(bindings) {
      return createLogger(base.child(redactValue(bindings) || {}))
    },
    /** @param {...unknown} args */
    trace(...args) {
      write('trace', args)
    },
    /** @param {...unknown} args */
    debug(...args) {
      write('debug', args)
    },
    /** @param {...unknown} args */
    info(...args) {
      write('info', args)
    },
    /** @param {...unknown} args */
    warn(...args) {
      write('warn', args)
    },
    /** @param {...unknown} args */
    error(...args) {
      write('error', args)
    },
    /** @param {...unknown} args */
    fatal(...args) {
      write('fatal', args)
    },
  }

  /**
   * @param {LogLevel} level
   * @param {unknown[]} args
   */
  function write(level, args) {
    const first = args[0]
    if (first instanceof Error) {
      base[level]({ err: serializeError(first) }, args.length > 1 ? safeFormat(args.slice(1)) : undefined)
      return
    }
    if (isPlainObject(first)) {
      const obj = redactValue(first) || {}
      const rest = args.slice(1)
      if (rest.length) base[level](obj, safeFormat(rest))
      else base[level](obj)
      return
    }
    base[level](safeFormat(args))
  }

  return wrapped
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: 'pjcodeworks-agent',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

const logger = createLogger(baseLogger)

/**
 * @param {WebhookLogContext} context
 */
function loggerForWebhook(context) {
  return logger.child({ flow: 'webhook', ...context })
}

/**
 * @param {JobPayload|null|undefined} job
 * @param {LogContext} [context]
 */
function loggerForJob(job, context = {}) {
  return logger.child({
    flow: 'job',
    job_id: job?.id || null,
    job_tipo: job?.tipo || null,
    dedupe_key: job?.dedupe_key || null,
    ...context,
  })
}

module.exports = {
  logger,
  loggerForWebhook,
  loggerForJob,
  redactPhone,
  redactValue,
  serializeError,
}
