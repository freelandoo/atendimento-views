'use strict'
const { pool } = require('../db')
const {
  MODO_GLOBAL_PADRAO,
  normalizarModo,
  resolverModoGlobal,
} = require('../services/conversa-modo-ia')

async function findEmpresaById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE id = $1 AND ativo = true',
    [id]
  )
  return rows[0] || null
}

async function findEmpresaBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM app.empresas WHERE slug = $1 AND ativo = true',
    [slug]
  )
  return rows[0] || null
}

/**
 * Empresa + INSTÂNCIA a partir do nome da instância Evolution.
 *
 * Substitui `findEmpresaByEvolutionInstance` (que devolvia só a empresa e tinha este
 * middleware como único chamador). A atribuição de anúncio precisa do id da instância:
 * cada instância é um negócio separado, e o NOME que vem no payload não serve como
 * chave — `app.empresa_whatsapp_instances.id` serve.
 *
 * @returns {Promise<{empresa: object, instanciaId: string}|null>} null quando a
 *   instância não está mapeada ou está inativa — é o caso em que o chamador NÃO pode
 *   dizer que a empresa foi comprovada.
 */
async function findEmpresaEInstanciaPorEvolution(instanceName) {
  const { rows } = await pool.query(
    `SELECT e.*, ewi.id AS _instancia_id
     FROM app.empresas e
     JOIN app.empresa_whatsapp_instances ewi ON ewi.empresa_id = e.id
     WHERE ewi.evolution_instance = $1 AND ewi.ativo = true AND e.ativo = true`,
    [instanceName]
  )
  const row = rows[0]
  if (!row) return null
  const { _instancia_id: instanciaId, ...empresa } = row
  return { empresa, instanciaId }
}

async function usuarioPertenceAEmpresa(usuario_id, empresa_id) {
  const { rows } = await pool.query(
    `SELECT 1 FROM app.usuarios_empresas
     WHERE usuario_id = $1 AND empresa_id = $2 AND ativo = true`,
    [usuario_id, empresa_id]
  )
  return rows.length > 0
}

// ─── Pause global do agente por empresa (config.agente_pausado) ────────────────
// Lido no caminho de resposta (core-funnel). Cache curto pra não bater no banco a
// cada mensagem; o toggle na API invalida o cache para efeito imediato. Fail-open:
// erro de leitura NUNCA bloqueia resposta.
const _pauseCache = new Map() // empresaId -> { paused, at }
const PAUSE_TTL_MS = 30_000

async function empresaAgentePausada(empresaId) {
  if (!empresaId) return false
  const c = _pauseCache.get(empresaId)
  if (c && Date.now() - c.at < PAUSE_TTL_MS) return c.paused
  try {
    const { rows } = await pool.query('SELECT config FROM app.empresas WHERE id = $1', [empresaId])
    const paused = !!(rows[0]?.config?.agente_pausado)
    _pauseCache.set(empresaId, { paused, at: Date.now() })
    return paused
  } catch {
    return false
  }
}

function invalidarCachePauseEmpresa(empresaId) {
  if (empresaId) _pauseCache.delete(empresaId)
  else _pauseCache.clear()
}

// ─── Modo padrao da IA por empresa (config.modo_ia_padrao) ─────────────────────
// O padrao da Central de Mensagens: vale para toda conversa cuja preferencia e' `herdar`.
// Mesmo molde do pause acima (JSONB de config + cache curto + invalidacao no PATCH), por
// isso nao ha migration para ele.
//
// A ENTRADA que nunca expira e a diferenca em relacao ao pause. Aqui o cache guarda o
// ultimo valor CONHECIDO para sempre; o TTL so decide quando vale a pena reconsultar. Numa
// falha transitoria de banco, servir o ultimo valor conhecido (ainda que vencido) e' melhor
// que cair no padrao de fabrica — cair no padrao apagaria, por alguns segundos, uma decisao
// que o operador tomou, e poderia soltar o bot numa Central que ele colocou em Analise.
// A precedencia (leitura > cache vencido > padrao) e' regra PURA, definida em
// services/conversa-modo-ia.js; aqui so' se faz o I/O.
const _modoIaCache = new Map() // empresaId -> { modo, at }
const MODO_IA_TTL_MS = 30_000

async function modoIaPadraoEmpresa(empresaId) {
  if (!empresaId) return MODO_GLOBAL_PADRAO
  const c = _modoIaCache.get(empresaId)
  if (c && Date.now() - c.at < MODO_IA_TTL_MS) return c.modo
  let lido = null
  try {
    const { rows } = await pool.query('SELECT config FROM app.empresas WHERE id = $1', [empresaId])
    // Empresa sem a chave = padrao de fabrica (comportamento historico), e isso e' uma
    // leitura BEM-SUCEDIDA: vira cache normalmente.
    lido = normalizarModo(rows[0]?.config?.modo_ia_padrao)
  } catch {
    lido = null
  }
  const { modo, fonte } = resolverModoGlobal({ lido, ultimoConhecido: c?.modo })
  // Cache so' e' reescrito com leitura fresca; senao o valor vencido seria "renovado" sem
  // nunca mais tentar o banco.
  if (fonte === 'leitura') _modoIaCache.set(empresaId, { modo, at: Date.now() })
  return modo
}

function invalidarCacheModoIaPadrao(empresaId) {
  if (empresaId) _modoIaCache.delete(empresaId)
  else _modoIaCache.clear()
}

// ─── Nome de exibição da empresa (para mensagens automáticas/lembretes) ─────────
// Resolve app.empresas.nome com cache curto. Fallback (empresa nula/desconhecida)
// = EMPRESA_NOME_PADRAO. EM PRODUÇÃO defina EMPRESA_NOME_PADRAO com a marca real:
// aí {{empresa}} e qualquer "PJ Codeworks" legado viram essa marca em TODA saída e
// em todo prompt, sem depender de cada empresa. O default de código 'PJ Codeworks'
// é só o último recurso (nunca aparece quando a empresa resolve ou a env está setada).
const NOME_PADRAO = process.env.EMPRESA_NOME_PADRAO || 'nossa empresa'
const _nomeCache = new Map() // empresaId -> { nome, at }
const NOME_TTL_MS = 60_000

async function nomeEmpresa(empresaId) {
  if (!empresaId) return NOME_PADRAO
  const c = _nomeCache.get(empresaId)
  if (c && Date.now() - c.at < NOME_TTL_MS) return c.nome
  try {
    const { rows } = await pool.query('SELECT nome FROM app.empresas WHERE id = $1', [empresaId])
    const nome = (rows[0]?.nome || '').trim() || NOME_PADRAO
    _nomeCache.set(empresaId, { nome, at: Date.now() })
    return nome
  } catch {
    return NOME_PADRAO
  }
}

function invalidarCacheNomeEmpresa(empresaId) {
  if (empresaId) _nomeCache.delete(empresaId)
  else _nomeCache.clear()
}

// ─── Protocolo de abertura (saudação → 1 pergunta → CTA) ───────────────────────
// Sequência fixa e determinística dos primeiros turnos, lida no caminho de resposta
// (core-funnel) para NÃO deixar a IA improvisar/interrogar na abertura. Opt-in.
// Resolução POR INSTÂNCIA (1 número = 1 negócio): se a instância tem o próprio
// protocolo em config_json.opener_protocolo, usa esse; senão cai no da empresa
// (app.empresas.config.opener_protocolo). Cache curto; fail-open (nulo => IA).
// Formato esperado: { saudacao, pergunta, cta_provedor, cta_cliente } (strings).
const _openerCache = new Map() // `${empresaId}:${instance||''}` -> { data, at }
const OPENER_TTL_MS = 30_000

function _normalizarOpener(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) return null
  const s = (k) => (typeof op[k] === 'string' ? op[k].trim() : '')
  const out = { saudacao: s('saudacao'), pergunta: s('pergunta'), cta_provedor: s('cta_provedor'), cta_cliente: s('cta_cliente') }
  // Só vale como protocolo se houver ao menos a saudação ou um CTA configurado.
  return (out.saudacao || out.cta_provedor || out.cta_cliente) ? out : null
}

async function openerProtocolo(empresaId, evolutionInstance = null) {
  if (!empresaId) return null
  const cacheKey = `${empresaId}:${evolutionInstance || ''}`
  const c = _openerCache.get(cacheKey)
  if (c && Date.now() - c.at < OPENER_TTL_MS) return c.data
  let data = null
  try {
    // 1) Protocolo da própria INSTÂNCIA (config_json.opener_protocolo).
    if (evolutionInstance) {
      const { rows } = await pool.query(
        `SELECT config_json FROM app.empresa_whatsapp_instances
          WHERE evolution_instance = $1 AND empresa_id = $2 AND ativo = true LIMIT 1`,
        [evolutionInstance, empresaId]
      )
      data = _normalizarOpener(rows[0]?.config_json?.opener_protocolo)
    }
    // 2) Fallback: protocolo da empresa (app.empresas.config.opener_protocolo).
    if (!data) {
      const { rows } = await pool.query('SELECT config FROM app.empresas WHERE id = $1', [empresaId])
      data = _normalizarOpener(rows[0]?.config?.opener_protocolo)
    }
  } catch { data = null }
  _openerCache.set(cacheKey, { data, at: Date.now() })
  return data
}

function invalidarCacheOpener(empresaId) {
  if (!empresaId) return _openerCache.clear()
  for (const k of _openerCache.keys()) {
    if (k === empresaId || k.startsWith(`${empresaId}:`)) _openerCache.delete(k)
  }
}

module.exports = {
  findEmpresaById,
  findEmpresaBySlug,
  findEmpresaEInstanciaPorEvolution,
  usuarioPertenceAEmpresa,
  empresaAgentePausada,
  invalidarCachePauseEmpresa,
  modoIaPadraoEmpresa,
  invalidarCacheModoIaPadrao,
  nomeEmpresa,
  NOME_PADRAO,
  invalidarCacheNomeEmpresa,
  openerProtocolo,
  invalidarCacheOpener,
}
