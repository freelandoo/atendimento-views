'use strict'

const PJ_CODEWORKS_ID = '00000000-0000-0000-0000-000000000001'

// Cache simples: instanceName → { empresaId, at }
const _cache = new Map()
const CACHE_TTL_MS = 120_000

function _cacheGet(instanceName) {
  const entry = _cache.get(instanceName)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    _cache.delete(instanceName)
    return undefined
  }
  return entry.empresaId
}

function _cacheSet(instanceName, empresaId) {
  _cache.set(instanceName, { empresaId, at: Date.now() })
}

/**
 * Resolve empresa_id a partir do nome da Evolution instance.
 * Fallback: PJ Codeworks (UUID fixo) se não encontrar no banco.
 * @returns {Promise<string>} empresa_id UUID
 */
async function resolverEmpresaPorInstance(pool, instanceName, log) {
  if (!instanceName) return PJ_CODEWORKS_ID
  const cached = _cacheGet(instanceName)
  if (cached !== undefined) return cached

  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM app.empresa_whatsapp_instances
       WHERE evolution_instance = $1 AND ativo = true
       LIMIT 1`,
      [instanceName]
    )
    const empresaId = rows.length ? rows[0].empresa_id : PJ_CODEWORKS_ID
    if (!rows.length && log) {
      log.warn({ evolution_instance: instanceName }, 'Evolution instance sem empresa registrada — usando empresa padrão do sistema')
    }
    _cacheSet(instanceName, empresaId)
    return empresaId
  } catch (err) {
    if (log) log.warn({ err: err.message, evolution_instance: instanceName }, 'Falha ao resolver empresa por instance — usando fallback')
    return PJ_CODEWORKS_ID
  }
}

// ─── Usa agenda? POR INSTÂNCIA (config_json.usa_agenda) ─────────────────────────
// Regra de cada instância, não da empresa. Default LIGADO (ausência/erro = true)
// para preservar o comportamento atual. Quando false, o agente daquela instância
// NUNCA oferece/agenda reunião e a geração de contexto não cria regras de reunião.
// Cache curto fail-open (= agenda ON), igual ao resolver de empresa.
const _agendaCache = new Map() // evolution_instance -> { usa, at }
const AGENDA_TTL_MS = 30_000

async function instanciaUsaAgenda(pool, instanceName, log) {
  if (!instanceName) return true
  const c = _agendaCache.get(instanceName)
  if (c && Date.now() - c.at < AGENDA_TTL_MS) return c.usa
  try {
    const { rows } = await pool.query(
      `SELECT config_json->>'usa_agenda' AS usa_agenda
         FROM app.empresa_whatsapp_instances
        WHERE evolution_instance = $1
        LIMIT 1`,
      [instanceName]
    )
    const usa = rows[0]?.usa_agenda !== 'false' // ausência = true
    _agendaCache.set(instanceName, { usa, at: Date.now() })
    return usa
  } catch (err) {
    if (log) log.warn({ err: err.message, evolution_instance: instanceName }, 'Falha ao resolver usa_agenda da instância — fail-open (agenda ON)')
    return true
  }
}

function invalidarCacheAgendaInstancia(instanceName) {
  if (instanceName) _agendaCache.delete(instanceName)
  else _agendaCache.clear()
}

module.exports = { resolverEmpresaPorInstance, instanciaUsaAgenda, invalidarCacheAgendaInstancia }
