'use strict'
// Orquestrador "Gerar tudo": encadeia ingestão → Contexto 1 → estágios → refino (frameworks
// de venda + auto-crítica) → Contexto 2 playbook, usando a LLM de GERAÇÃO (one-shot).
// Editar/salvar manual continua existindo nas rotas de estágios/contextos.

const { makeGenerationProvider } = require('../ai-provider')
const estagiosSvc = require('./contexto-estagios')
const { gerarContexto2Playbook, invalidarCacheEmpresa } = require('./contexto-empresa')
const servicosSvc = require('./contexto-servicos')
const {
  analisarFonteComIA,
  sugerirContexto1APartirDasFontes,
  mesclarSugestaoNoContexto1,
} = require('./knowledge-ingestion')
const { MAPA_POR_ETAPA, REFINO_SYSTEM } = require('./geracao-frameworks')
const mensagensSvc = require('./mensagens-automaticas')

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
    estagiosSvc.CHAVES_FUNIL.map(async (etapa) => {
      try {
        const texto = await _refinarUmaEtapa({ genProvider, pool, log, empresaId, contextoId, etapa, texto: base[etapa], conhecimento })
        return [etapa, texto]
      } catch (_) {
        return [etapa, base[etapa]]
      }
    })
  )
  // Preserva o bloco de informações (não é refinado pela IA).
  const out = { [estagiosSvc.CHAVE_INFO]: base[estagiosSvc.CHAVE_INFO] }
  for (const [k, v] of entradas) out[k] = v
  return estagiosSvc.normalizarEstagios(out)
}

// Etapas do fluxo "Gerar tudo", na ordem real de execução. Usadas pelo endpoint
// de progresso (a UI mostra exatamente em qual passo o pipeline está).
const ETAPAS_GERAR_TUDO = [
  'analisar_fontes',
  'contexto1',
  'servicos',
  'estagios_base',
  'estagios_refinados',
  'playbook',
  ...mensagensSvc.CHAVES_GRUPO.map((g) => `mensagens_${g}`),
]

/**
 * Fluxo único "Gerar tudo". Roda com a LLM de geração (ou um aiProvider injetado em testes).
 * Cada passo é tolerante a falha e registrado em `passos`; o que der pra gerar, gera.
 * `onEtapa(chave, status, extra)` (opcional) recebe 'rodando'|'ok'|'erro' no início/fim
 * de cada etapa de ETAPAS_GERAR_TUDO — alimenta o progresso em tempo real da UI.
 * @returns {{ contexto1, estagios, playbook, passos }}
 */
async function gerarTudo({ pool, log, empresaId, contextoId, userId, aiProvider, onEtapa } = {}) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('gerarTudo: pool, empresaId, contextoId obrigatórios')
  }
  const genProvider = aiProvider || makeGenerationProvider()
  const passos = []
  const marcar = (etapa, info = {}) => {
    passos.push({ etapa, ...info })
    if (log && typeof log.info === 'function') log.info({ etapa, ...info }, 'gerarTudo')
  }
  const progresso = (etapa, status, extra = {}) => {
    if (typeof onEtapa !== 'function') return
    try { onEtapa(etapa, status, extra) } catch (_) { /* progresso nunca quebra o fluxo */ }
  }

  // 1) Analisar fontes ainda não analisadas (extração — modelo padrão, não é o passo criativo).
  progresso('analisar_fontes', 'rodando')
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
  progresso('analisar_fontes', 'ok')

  // 2) Sugerir Contexto 1 das fontes + mesclar (preserva o manual) + persistir.
  progresso('contexto1', 'rodando')
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
    progresso('contexto1', 'ok')
  } catch (e) {
    marcar('contexto1', { erro: e.message })
    progresso('contexto1', 'erro', { erro: e.message })
  }

  // 2b) Servicos estruturados: separa ofertas individuais detectadas nas fontes
  // (ex.: SEO, criacao de site, sistemas) em itens editaveis por contexto.
  progresso('servicos', 'rodando')
  let servicos = []
  try {
    const baseCtx = contexto1Aplicado || {}
    servicos = await servicosSvc.gerarServicosDoContexto({
      pool, empresaId, contextoId, contexto1: baseCtx,
    })
    marcar('servicos', { total: servicos.length })
    progresso('servicos', 'ok')
  } catch (e) {
    marcar('servicos', { erro: e.message })
    progresso('servicos', 'erro', { erro: e.message })
    servicos = null
  }

  // 3) Estágios: genéricos (estrutura PJ) → adaptar ao conhecimento (modelo de geração).
  progresso('estagios_base', 'rodando')
  const ctxRow = await estagiosSvc.getContextoComEstagios(pool, empresaId, contextoId)
  const conhecimento = estagiosSvc.montarConhecimentoDoContexto(ctxRow)
  const genericos = await estagiosSvc.gerarEstagiosGenericos({ pool, log, aiProvider: genProvider })
  let estagios = await estagiosSvc.adaptarEstagios({
    pool, log, aiProvider: genProvider, empresaId, contextoId, estagios: genericos, conhecimento,
  })
  marcar('estagios_base', {})
  progresso('estagios_base', 'ok')

  // 4) Auto-crítica/refino aplicando os frameworks de venda.
  progresso('estagios_refinados', 'rodando')
  estagios = await refinarEstagiosComFrameworks({ genProvider, pool, log, empresaId, contextoId, estagios, conhecimento })
  marcar('estagios_refinados', {})

  // 4b) Bloco de informações (fatos): auto-preenchido do formulário, fora da IA.
  estagios = estagiosSvc.preencherInformacoesEstagio(estagios, ctxRow, { sobrescrever: true })

  // 5) Salvar estágios no contexto.
  const saved = await estagiosSvc.salvarEstagiosNoContexto(pool, empresaId, contextoId, estagios)
  const estagiosSalvos = estagiosSvc.normalizarEstagios(saved && saved.estagios_json)
  marcar('estagios_salvos', {})
  progresso('estagios_refinados', 'ok')

  // 6) Gerar Contexto 2 playbook (rascunho) com o modelo de geração.
  progresso('playbook', 'rodando')
  let playbook = null
  try {
    const r = await gerarContexto2Playbook({ pool, log, empresaId, contextoId, userId, aiProvider: genProvider, catalogoServicos: servicos })
    playbook = { versao_id: r && r.versao && r.versao.id, versao: r && r.versao && r.versao.versao }
    marcar('playbook', { versao: playbook.versao })
    progresso('playbook', 'ok')
  } catch (e) {
    marcar('playbook', { erro: e.message })
    progresso('playbook', 'erro', { erro: e.message })
  }

  // 7) Mensagens automáticas (saudações + gatilhos da agenda): adapta os defaults
  //    ao conhecimento da empresa (mesmo modelo de geração) e salva no contexto.
  //    Tolerante a falha por grupo — o que der pra gerar, gera.
  const mensagens = {}
  for (const grupo of mensagensSvc.CHAVES_GRUPO) {
    progresso(`mensagens_${grupo}`, 'rodando')
    try {
      const gerado = await mensagensSvc.gerarGrupo({
        pool, log, aiProvider: genProvider, empresaId, contextoId, grupo, conhecimento,
      })
      const salvoGrupo = await mensagensSvc.salvarGrupo(pool, empresaId, contextoId, grupo, gerado)
      mensagens[grupo] = salvoGrupo || gerado
      marcar(`mensagens_${grupo}`, {})
      progresso(`mensagens_${grupo}`, 'ok')
    } catch (e) {
      marcar(`mensagens_${grupo}`, { erro: e.message })
      progresso(`mensagens_${grupo}`, 'erro', { erro: e.message })
    }
  }
  mensagensSvc.invalidarCacheAtivo(empresaId)

  return { contexto1: contexto1Aplicado, servicos, estagios: estagiosSalvos, playbook, mensagens, passos }
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

module.exports = { gerarTudo, refinarEstagiosComFrameworks, rederivarOuLimpar, ETAPAS_GERAR_TUDO }
