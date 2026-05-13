'use strict'

// Cache TTL: 60 s por empresa_id
const _cache = new Map()
const CACHE_TTL_MS = 60_000

function _cacheGet(empresaId) {
  const entry = _cache.get(empresaId)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    _cache.delete(empresaId)
    return undefined
  }
  return entry.value
}

function _cacheSet(empresaId, value) {
  _cache.set(empresaId, { value, at: Date.now() })
}

/**
 * Busca a versão ativa do Contexto 2 para uma empresa.
 * Retorna conteudo_json (object) ou null se não houver versão ativa.
 */
async function getContextoAtivoEmpresa(pool, empresaId) {
  if (!empresaId) return null
  const cached = _cacheGet(empresaId)
  if (cached !== undefined) return cached

  const { rows } = await pool.query(
    `SELECT ecv.conteudo_json
     FROM app.empresa_contexto_versoes ecv
     WHERE ecv.empresa_id = $1 AND ecv.status = 'ativo'
     ORDER BY ecv.ativado_em DESC NULLS LAST
     LIMIT 1`,
    [empresaId]
  )

  const result = rows.length > 0 ? rows[0].conteudo_json : null
  _cacheSet(empresaId, result)
  return result
}

function _formatarValor(val, indent) {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    return val
      .map((item) => `${indent}- ${_formatarValor(item, indent + '  ')}`)
      .join('\n')
  }
  if (typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        const formatted = _formatarValor(v, indent + '  ')
        if (!formatted) return null
        return Array.isArray(v) || (typeof v === 'object' && v !== null)
          ? `${indent}${label}:\n${formatted}`
          : `${indent}${label}: ${formatted}`
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * Converte o JSON do Contexto 2 em texto legível para injeção no system prompt.
 * Retorna string ou null se o JSON estiver vazio/inválido.
 */
function formatarContexto2ParaPrompt(json) {
  if (!json || typeof json !== 'object' || Object.keys(json).length === 0) return null
  const corpo = _formatarValor(json, '')
  if (!corpo.trim()) return null
  return `===== CONTEXTO DA EMPRESA (Contexto 2 — gerado por IA) =====\n\n${corpo.trim()}\n`
}

module.exports = { getContextoAtivoEmpresa, formatarContexto2ParaPrompt }
