'use strict'
// Estágios POR contexto. Cada contexto (card) guarda seus 6 estágios (Núcleo + 5).
// - "Gerar estágios"  -> clona a ESTRUTURA dos estágios da PJ em versão GENÉRICA (IA).
// - "Adaptar estágios"-> roda o CONHECIMENTO do contexto por cima dos estágios (IA).
// - "Salvar estágios" -> persiste em app.empresa_contextos.estagios_json.
// - Ativar/desativar  -> só UM contexto ativo por empresa.
// Aditivo: o runtime só passa a ler isto na fase seguinte.

const prompts = require('../prompts')

// Etapas e a referência (prompt da PJ) usada como ESTRUTURA para genericizar.
const ETAPAS = [
  { chave: 'nucleo', label: 'Núcleo — regras gerais do agente', ref: 'SYSTEM_CORE_BASE' },
  { chave: 'primeiro_contato', label: 'Estágio: Primeiro contato', ref: 'SYSTEM_PRIMEIRO_CONTATO_BASE' },
  { chave: 'diagnostico', label: 'Estágio: Diagnóstico', ref: 'SYSTEM_DIAGNOSTICO_BASE' },
  { chave: 'proposta', label: 'Estágio: Proposta', ref: 'SYSTEM_PROPOSTA_BASE' },
  { chave: 'objecao', label: 'Estágio: Objeção', ref: 'SYSTEM_OBJECAO_BASE' },
  { chave: 'fechamento', label: 'Estágio: Fechamento', ref: 'SYSTEM_FECHAMENTO_BASE' },
]
const CHAVES_ETAPA = ETAPAS.map((e) => e.chave)

function _str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

// Lê os prompts atuais da PJ (system-core.md + system-*.md) como referência estrutural.
function estagiosPjReferencia() {
  const out = {}
  for (const e of ETAPAS) out[e.chave] = _str(prompts[e.ref]).trim()
  return out
}

// Garante objeto com as 6 chaves (strings). Descarta chaves desconhecidas.
function normalizarEstagios(input) {
  const out = {}
  const src = input && typeof input === 'object' ? input : {}
  for (const chave of CHAVES_ETAPA) out[chave] = _str(src[chave]).trim()
  return out
}

function estagiosVazios(estagios) {
  return CHAVES_ETAPA.every((c) => !_str(estagios?.[c]).trim())
}

// ─── Geração GENÉRICA (IA) — cacheada em memória (independe do contexto) ──────
let _genericoCache = null

function invalidarGenericoCache() { _genericoCache = null }

const GENERICO_SYSTEM = `Você recebe o prompt de UMA etapa do funil de vendas de uma empresa específica (PJ Codeworks, que vende criação de sites/sistemas).

Reescreva-o como um TEMPLATE GENÉRICO da mesma etapa, que sirva para QUALQUER empresa:
- REMOVA tudo que é específico do negócio da PJ: preços (ex.: R$200–3000), prévia/preview de site, nomes próprios (ex.: Victor), nichos, links, números e cases.
- MANTENHA a estrutura, o objetivo da etapa, o tom consultivo e as boas práticas de venda.
- Onde havia um dado específico, use um placeholder neutro (ex.: "[serviço/produto da empresa]", "[faixa de preço, se houver]").
- Não invente dados.

Responda APENAS com o texto do prompt genérico (sem comentários, sem markdown de cerca).`

async function _genericoDeUmaEtapa({ etapa, refTexto, aiProvider, pool, log }) {
  const provider = aiProvider || require('../ai-provider')
  if (!refTexto.trim()) return ''
  const userPrompt = `ETAPA: ${etapa}\n\nPROMPT ESPECÍFICO DA PJ (use só como ESTRUTURA):\n${refTexto}\n\nReescreva como template genérico desta etapa.`
  const result = await provider.generateAIResponse(
    {
      systemPrompt: GENERICO_SYSTEM,
      userPrompt,
      task: 'gerarEstagioGenerico',
      maxTokens: Number(process.env.ESTAGIOS_MAX_TOKENS) || 4000,
      timeoutMs: Number(process.env.ESTAGIOS_TIMEOUT_MS) || 90000,
      refType: 'contexto',
    },
    pool, log
  )
  return _str(result?.text).trim()
}

/**
 * Gera (ou retorna do cache) os 6 estágios genéricos a partir da estrutura da PJ.
 * Resultado independe do contexto — por isso é cacheável e reutilizável.
 */
async function gerarEstagiosGenericos({ pool, log, aiProvider, force = false } = {}) {
  if (_genericoCache && !force) return _genericoCache
  const ref = estagiosPjReferencia()
  const resultados = await Promise.all(
    ETAPAS.map(async (e) => [e.chave, await _genericoDeUmaEtapa({ etapa: e.chave, refTexto: ref[e.chave], aiProvider, pool, log })])
  )
  const out = {}
  for (const [chave, texto] of resultados) out[chave] = texto
  _genericoCache = normalizarEstagios(out)
  return _genericoCache
}

// ─── Adaptação ao contexto (IA) ───────────────────────────────────────────────
const ADAPTAR_SYSTEM = `Você recebe o TEMPLATE GENÉRICO de uma etapa do funil de vendas e o CONHECIMENTO de uma empresa.

Reescreva o prompt da etapa ADAPTANDO ao negócio descrito no conhecimento:
- Substitua os placeholders e o que for genérico pelos dados reais do conhecimento (serviços/produtos, tom de voz, links, regras, formas de pagamento, etc.).
- MANTENHA a estrutura e o objetivo da etapa.
- NÃO invente dados que não estejam no conhecimento; se algo não existir, deixe neutro.
- Não copie dados de outras empresas.

Responda APENAS com o texto do prompt adaptado (sem comentários, sem markdown de cerca).`

async function _adaptarUmaEtapa({ etapa, generico, conhecimento, aiProvider, pool, log, empresaId, contextoId }) {
  const provider = aiProvider || require('../ai-provider')
  if (!generico.trim()) return ''
  const userPrompt = `ETAPA: ${etapa}\n\nCONHECIMENTO DA EMPRESA:\n${conhecimento || '(sem conhecimento — mantenha neutro)'}\n\nTEMPLATE GENÉRICO DA ETAPA:\n${generico}\n\nReescreva adaptado a esta empresa.`
  const result = await provider.generateAIResponse(
    {
      systemPrompt: ADAPTAR_SYSTEM,
      userPrompt,
      task: 'adaptarEstagio',
      maxTokens: Number(process.env.ESTAGIOS_MAX_TOKENS) || 4000,
      timeoutMs: Number(process.env.ESTAGIOS_TIMEOUT_MS) || 90000,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  return _str(result?.text).trim()
}

/**
 * Adapta um conjunto de estágios (genéricos ou atuais) ao conhecimento do contexto.
 */
async function adaptarEstagios({ pool, log, aiProvider, empresaId, contextoId, estagios, conhecimento }) {
  const base = normalizarEstagios(estagios)
  const resultados = await Promise.all(
    ETAPAS.map(async (e) => {
      const generico = base[e.chave]
      const adaptado = await _adaptarUmaEtapa({
        etapa: e.chave, generico, conhecimento, aiProvider, pool, log, empresaId, contextoId,
      })
      return [e.chave, adaptado || generico]
    })
  )
  const out = {}
  for (const [chave, texto] of resultados) out[chave] = texto
  return normalizarEstagios(out)
}

/** Adapta UMA etapa ao conhecimento do contexto (reusa _adaptarUmaEtapa). */
async function adaptarUmaEtapa({ pool, log, aiProvider, empresaId, contextoId, etapa, generico, conhecimento }) {
  if (!CHAVES_ETAPA.includes(etapa)) throw new Error(`etapa inválida: ${etapa}`)
  const texto = await _adaptarUmaEtapa({
    etapa, generico: _str(generico), conhecimento, aiProvider, pool, log, empresaId, contextoId,
  })
  return texto || _str(generico).trim()
}

/** Gera UMA etapa genérica (reusa _genericoDeUmaEtapa). Não usa cache. */
async function gerarUmaEtapaGenerica({ pool, log, aiProvider, etapa }) {
  if (!CHAVES_ETAPA.includes(etapa)) throw new Error(`etapa inválida: ${etapa}`)
  const ref = estagiosPjReferencia()
  return await _genericoDeUmaEtapa({ etapa, refTexto: ref[etapa], aiProvider, pool, log })
}

// ─── Conhecimento do contexto (texto p/ alimentar a adaptação e, depois, o runtime) ─
function montarConhecimentoDoContexto(ctxRow) {
  if (!ctxRow) return ''
  const form = ctxRow.contexto_form_json && typeof ctxRow.contexto_form_json === 'object'
    ? ctxRow.contexto_form_json
    : null
  if (form && Object.keys(form).length > 0) {
    const linhas = Object.entries(form)
      .filter(([, v]) => _str(v).trim())
      .map(([k, v]) => `${k.replace(/_/g, ' ').toUpperCase()}: ${_str(v).trim()}`)
    if (linhas.length) return linhas.join('\n')
  }
  return _str(ctxRow.conteudo).trim()
}

// ─── Persistência / ativação ──────────────────────────────────────────────────
async function getContextoComEstagios(pool, empresaId, contextoId) {
  const { rows: [ctx] } = await pool.query(
    `SELECT id, empresa_id, nome, conteudo, contexto_form_json, estagios_json, runtime_ativo, thumbnail_url
       FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2`,
    [contextoId, empresaId]
  )
  return ctx || null
}

async function salvarEstagiosNoContexto(pool, empresaId, contextoId, estagios) {
  const norm = normalizarEstagios(estagios)
  const { rows: [ctx] } = await pool.query(
    `UPDATE app.empresa_contextos
        SET estagios_json = $3::jsonb, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2
      RETURNING id, estagios_json, runtime_ativo`,
    [contextoId, empresaId, JSON.stringify(norm)]
  )
  return ctx || null
}

async function ativarContexto(pool, empresaId, contextoId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE app.empresa_contextos SET runtime_ativo = false, atualizado_em = NOW()
        WHERE empresa_id = $1 AND runtime_ativo = true AND id <> $2`,
      [empresaId, contextoId]
    )
    const { rows: [ctx] } = await client.query(
      `UPDATE app.empresa_contextos SET runtime_ativo = true, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2
        RETURNING id, runtime_ativo`,
      [contextoId, empresaId]
    )
    await client.query('COMMIT')
    return ctx || null
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function desativarContexto(pool, empresaId, contextoId) {
  const { rows: [ctx] } = await pool.query(
    `UPDATE app.empresa_contextos SET runtime_ativo = false, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2
      RETURNING id, runtime_ativo`,
    [contextoId, empresaId]
  )
  return ctx || null
}

/** Runtime: contexto runtime-ativo da empresa com seus estágios + conhecimento. */
async function getContextoAtivoComEstagios(pool, empresaId) {
  if (!empresaId) return null
  const { rows: [ctx] } = await pool.query(
    `SELECT id, nome, conteudo, contexto_form_json, estagios_json, thumbnail_url
       FROM app.empresa_contextos
      WHERE empresa_id = $1 AND runtime_ativo = true
      LIMIT 1`,
    [empresaId]
  )
  if (!ctx) return null
  const estagios = normalizarEstagios(ctx.estagios_json)
  if (estagiosVazios(estagios)) return null
  return {
    contexto_id: ctx.id,
    nome: ctx.nome,
    estagios,
    conhecimento: montarConhecimentoDoContexto(ctx),
  }
}

module.exports = {
  ETAPAS,
  CHAVES_ETAPA,
  estagiosPjReferencia,
  normalizarEstagios,
  estagiosVazios,
  gerarEstagiosGenericos,
  invalidarGenericoCache,
  adaptarEstagios,
  adaptarUmaEtapa,
  gerarUmaEtapaGenerica,
  montarConhecimentoDoContexto,
  getContextoComEstagios,
  salvarEstagiosNoContexto,
  ativarContexto,
  desativarContexto,
  getContextoAtivoComEstagios,
}
