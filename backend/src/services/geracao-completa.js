'use strict'
// Orquestrador "Gerar tudo": encadeia ingestão → Contexto 1 → estágios → refino (frameworks
// de venda + auto-crítica) → Contexto 2 playbook, usando a LLM de GERAÇÃO (one-shot).
// Editar/salvar manual continua existindo nas rotas de estágios/contextos.

const { makeGenerationProvider } = require('../ai-provider')
const estagiosSvc = require('./contexto-estagios')
const { gerarContexto2Playbook, invalidarCacheEmpresa } = require('./contexto-empresa')
const {
  analisarFonteComIA,
  sugerirContexto1APartirDasFontes,
  mesclarSugestaoNoContexto1,
} = require('./knowledge-ingestion')
const { MAPA_POR_ETAPA, REFINO_SYSTEM } = require('./geracao-frameworks')

const REFINO_MAX_TOKENS = Number(process.env.ESTAGIOS_MAX_TOKENS) || 4000
const REFINO_TIMEOUT_MS = Number(process.env.ESTAGIOS_TIMEOUT_MS) || 90000

async function _refinarUmaEtapa({ genProvider, pool, log, empresaId, contextoId, etapa, texto, conhecimento }) {
  if (!texto || !texto.trim()) return texto || ''
  const tecnica = MAPA_POR_ETAPA[etapa] || ''
  const userPrompt = `ETAPA: ${etapa}
TÉCNICA PRIORIZADA NESTA ETAPA: ${tecnica}

CONHECIMENTO DA EMPRESA:
${conhecimento || '(sem conhecimento — mantenha neutro e honesto)'}

PROMPT ATUAL DA ETAPA (a refinar):
${texto}

Reescreva aplicando as técnicas, honesto e denso.`
  const result = await genProvider.generateAIResponse(
    {
      systemPrompt: REFINO_SYSTEM,
      userPrompt,
      task: 'refinarEstagioVendas',
      maxTokens: REFINO_MAX_TOKENS,
      timeoutMs: REFINO_TIMEOUT_MS,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  const out = String(result?.text || '').trim()
  return out || texto
}

/**
 * Passe de auto-crítica/refino: reescreve cada um dos 6 estágios aplicando os
 * frameworks de venda (mapa por etapa) com o modelo de geração. Em caso de
 * falha/vazio numa etapa, mantém o texto original (degrada sem quebrar).
 */
async function refinarEstagiosComFrameworks({ genProvider, pool, log, empresaId, contextoId, estagios, conhecimento }) {
  const base = estagiosSvc.normalizarEstagios(estagios)
  const entradas = await Promise.all(
    estagiosSvc.CHAVES_ETAPA.map(async (etapa) => {
      try {
        const texto = await _refinarUmaEtapa({ genProvider, pool, log, empresaId, contextoId, etapa, texto: base[etapa], conhecimento })
        return [etapa, texto]
      } catch (_) {
        return [etapa, base[etapa]]
      }
    })
  )
  const out = {}
  for (const [k, v] of entradas) out[k] = v
  return estagiosSvc.normalizarEstagios(out)
}

/**
 * Fluxo único "Gerar tudo". Roda com a LLM de geração (ou um aiProvider injetado em testes).
 * Cada passo é tolerante a falha e registrado em `passos`; o que der pra gerar, gera.
 * @returns {{ contexto1, estagios, playbook, passos }}
 */
async function gerarTudo({ pool, log, empresaId, contextoId, userId, aiProvider } = {}) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('gerarTudo: pool, empresaId, contextoId obrigatórios')
  }
  const genProvider = aiProvider || makeGenerationProvider()
  const passos = []
  const marcar = (etapa, info = {}) => {
    passos.push({ etapa, ...info })
    if (log && typeof log.info === 'function') log.info({ etapa, ...info }, 'gerarTudo')
  }

  // 1) Analisar fontes ainda não analisadas (extração — modelo padrão, não é o passo criativo).
  const { rows: fontesPend } = await pool.query(
    `SELECT id FROM app.empresa_fontes_conhecimento
      WHERE empresa_id = $1 AND contexto_id = $2
        AND status <> 'analisado' AND length(COALESCE(conteudo_extraido, '')) > 0`,
    [empresaId, contextoId]
  )
  for (const f of fontesPend) {
    try { await analisarFonteComIA(pool, log, { empresaId, fonteId: f.id }) }
    catch (e) { marcar('analisar_fonte', { fonteId: f.id, erro: e.message }) }
  }
  marcar('analisar_fontes', { pendentes: fontesPend.length })

  // 2) Sugerir Contexto 1 das fontes + mesclar (preserva o manual) + persistir.
  let contexto1Aplicado = null
  try {
    const { sugestao, contexto_atual } = await sugerirContexto1APartirDasFontes(
      pool, log, { empresaId, contextoId, aiProvider: genProvider }
    )
    const merged = mesclarSugestaoNoContexto1({ contextoAtual: contexto_atual, sugestao, modo: 'merge_preserva_manual' })
    await pool.query(
      `UPDATE app.empresa_contextos SET contexto_form_json = $3::jsonb, atualizado_em = NOW()
        WHERE id = $1 AND empresa_id = $2`,
      [contextoId, empresaId, JSON.stringify(merged)]
    )
    contexto1Aplicado = merged
    marcar('contexto1', { aplicado: true })
  } catch (e) {
    marcar('contexto1', { erro: e.message })
  }

  // 3) Estágios: genéricos (estrutura PJ) → adaptar ao conhecimento (modelo de geração).
  const ctxRow = await estagiosSvc.getContextoComEstagios(pool, empresaId, contextoId)
  const conhecimento = estagiosSvc.montarConhecimentoDoContexto(ctxRow)
  const genericos = await estagiosSvc.gerarEstagiosGenericos({ pool, log, aiProvider: genProvider })
  let estagios = await estagiosSvc.adaptarEstagios({
    pool, log, aiProvider: genProvider, empresaId, contextoId, estagios: genericos, conhecimento,
  })
  marcar('estagios_base', {})

  // 4) Auto-crítica/refino aplicando os frameworks de venda.
  estagios = await refinarEstagiosComFrameworks({ genProvider, pool, log, empresaId, contextoId, estagios, conhecimento })
  marcar('estagios_refinados', {})

  // 5) Salvar estágios no contexto.
  const saved = await estagiosSvc.salvarEstagiosNoContexto(pool, empresaId, contextoId, estagios)
  const estagiosSalvos = estagiosSvc.normalizarEstagios(saved && saved.estagios_json)
  marcar('estagios_salvos', {})

  // 6) Gerar Contexto 2 playbook (rascunho) com o modelo de geração.
  let playbook = null
  try {
    const r = await gerarContexto2Playbook({ pool, log, empresaId, contextoId, userId, aiProvider: genProvider })
    playbook = { versao_id: r && r.versao && r.versao.id, versao: r && r.versao && r.versao.versao }
    marcar('playbook', { versao: playbook.versao })
  } catch (e) {
    marcar('playbook', { erro: e.message })
  }

  return { contexto1: contexto1Aplicado, estagios: estagiosSalvos, playbook, passos }
}

/**
 * Pós-remoção de fonte: se ainda há fontes no contexto, re-deriva tudo (gerarTudo);
 * se não sobrou nenhuma, limpa Contexto 1 + estágios e arquiva a versão ativa do playbook.
 */
async function rederivarOuLimpar({ pool, log, empresaId, contextoId, userId } = {}) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('rederivarOuLimpar: pool, empresaId, contextoId obrigatórios')
  }
  const { rows: [c] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM app.empresa_fontes_conhecimento WHERE empresa_id = $1 AND contexto_id = $2`,
    [empresaId, contextoId]
  )
  if ((c && c.n) > 0) {
    const r = await gerarTudo({ pool, log, empresaId, contextoId, userId })
    return { rederivado: true, ...r }
  }
  // Sem fontes: limpa derivados e arquiva o playbook ativo (mantém o histórico de versões).
  await pool.query(
    `UPDATE app.empresa_contextos
        SET contexto_form_json = '{}'::jsonb, estagios_json = '{}'::jsonb, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2`,
    [contextoId, empresaId]
  )
  await pool.query(
    `UPDATE app.empresa_contexto_versoes SET status = 'arquivado'
      WHERE contexto_id = $1 AND empresa_id = $2 AND status = 'ativo'`,
    [contextoId, empresaId]
  )
  invalidarCacheEmpresa(empresaId)
  return { limpo: true }
}

module.exports = { gerarTudo, refinarEstagiosComFrameworks, rederivarOuLimpar }
