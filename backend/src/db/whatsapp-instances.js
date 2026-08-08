'use strict'

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

function invalidarCacheEmpresaInstancia(instanceName) {
  if (instanceName) _cache.delete(instanceName)
  else _cache.clear()
}

/**
 * Resolve empresa_id a partir do nome da Evolution instance.
 *
 * NÃO EXISTE EMPRESA PADRÃO. Instância sem vínculo ativo — nome ausente, instância não
 * mapeada ou falha ao consultar — devolve `null`, nunca a PJ Codeworks. O fallback anterior
 * marcava o dado de um negócio qualquer como sendo da PJ; medido em produção em 2026-08-08,
 * das 6 conversas atribuídas à PJ apenas 1 era PJ de verdade. Quem chamar isto tem de tratar
 * a ausência (é o que a quarentena de webhook faz), não escolher uma empresa por ela.
 *
 * O resolvedor do webhook é `findEmpresaEInstanciaPorEvolution` (`src/db/empresas.js`), que
 * além da empresa devolve a instância e a procedência. Esta função é o atalho que responde
 * só "de quem é esta instância?".
 *
 * @returns {Promise<string|null>} empresa_id UUID, ou null quando não há vínculo comprovado
 */
async function resolverEmpresaPorInstance(pool, instanceName, log) {
  if (!instanceName) return null
  const cached = _cacheGet(instanceName)
  if (cached !== undefined) return cached

  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM app.empresa_whatsapp_instances
       WHERE evolution_instance = $1 AND ativo = true
       LIMIT 1`,
      [instanceName]
    )
    const empresaId = rows.length ? rows[0].empresa_id : null
    if (!rows.length && log) {
      log.warn({ evolution_instance: instanceName }, 'Evolution instance sem empresa registrada — sem empresa resolvida')
    }
    _cacheSet(instanceName, empresaId)
    return empresaId
  } catch (err) {
    // Falha TÉCNICA não vira veredito de negócio: não é cacheada, para que a próxima
    // tentativa volte a consultar o banco.
    if (log) log.warn({ err: err.message, evolution_instance: instanceName }, 'Falha ao resolver empresa por instance — sem empresa resolvida')
    return null
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

// Apaga o contexto somente quando nenhuma outra instância ainda o referencia.
// Isso preserva o recurso de compartilhamento de contexto entre instâncias.
async function removerContextoSeOrfao(pool, empresaId, contextoId) {
  if (!pool || !empresaId || !contextoId) return false
  const { rowCount = 0 } = await pool.query(
    `DELETE FROM app.empresa_contextos ec
      WHERE ec.id = $1 AND ec.empresa_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM app.empresa_whatsapp_instances ewi
           WHERE ewi.contexto_id = ec.id
        )`,
    [contextoId, empresaId]
  )
  return rowCount > 0
}

module.exports = {
  resolverEmpresaPorInstance,
  instanciaUsaAgenda,
  invalidarCacheEmpresaInstancia,
  invalidarCacheAgendaInstancia,
  removerContextoSeOrfao,
}
