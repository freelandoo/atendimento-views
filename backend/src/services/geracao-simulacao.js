'use strict'
// Slice 4 — loop "gera → simula → corrige".
// Para cada etapa: (1) o modelo de GERAÇÃO inventa a mensagem mais difícil de um lead cético;
// (2) o modelo de ATENDIMENTO (o barato, que atende de verdade) responde usando o estágio atual;
// (3) o modelo de GERAÇÃO critica a resposta e REESCREVE o estágio pra ficar mais robusto.
// Ajusta o playbook PARA o modelo que vai executá-lo. Opt-in (rota/botão separados).

const aiProviderModulo = require('../ai-provider')
const { makeGenerationProvider } = require('../ai-provider')
const estagiosSvc = require('./contexto-estagios')
const { parsearRespostaJsonClaude } = require('../string-utils')
const { FRAMEWORKS_VENDA, GUARDRAIL_ETICO, MAPA_POR_ETAPA } = require('./geracao-frameworks')

// Etapas onde "lidar com lead difícil" mais importa (default da simulação).
const ETAPAS_PADRAO_SIMULACAO = ['diagnostico', 'objecao', 'fechamento']

const SIM_MAX_TOKENS = Number(process.env.SIMULACAO_MAX_TOKENS) || 4000
const SIM_TIMEOUT_MS = Number(process.env.SIMULACAO_TIMEOUT_MS) || 90000

function _str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

const LEAD_SYSTEM = `Você simula um LEAD CÉTICO e difícil conversando por WhatsApp com o vendedor de uma empresa.
Mande UMA única mensagem curta, realista e desafiadora, típica da etapa indicada
(objeção forte, dúvida de preço, comparação com concorrente, desconfiança, pressa, "vou pensar"...).
Use o conhecimento da empresa pra ser específico. Responda SÓ com a mensagem do lead — sem aspas, sem rótulo.`

async function _gerarMensagemDificil({ genProvider, etapa, conhecimento, pool, log, empresaId, contextoId }) {
  const userPrompt = `EMPRESA (conhecimento):\n${conhecimento || '(genérico)'}\n\nETAPA DO FUNIL: ${etapa}\n\nGere a mensagem mais difícil que esse lead mandaria nesta etapa.`
  const r = await genProvider.generateAIResponse(
    {
      systemPrompt: LEAD_SYSTEM, userPrompt,
      task: 'simularLeadDificil', maxTokens: 600, timeoutMs: SIM_TIMEOUT_MS,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  return _str(r && r.text).trim()
}

async function _responderComoAgente({ runtimeProvider, estagio, conhecimento, mensagemCliente, pool, log, empresaId, contextoId }) {
  const systemPrompt = `${estagio}\n\nCONHECIMENTO DA EMPRESA:\n${conhecimento || '(sem conhecimento)'}\n\nResponda como o agente comercial, no tom da empresa, em 1 mensagem de WhatsApp.`
  const r = await runtimeProvider.generateAIResponse(
    {
      systemPrompt, userPrompt: mensagemCliente,
      task: 'simularRespostaAgente', maxTokens: 800, timeoutMs: SIM_TIMEOUT_MS,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  return _str(r && r.text).trim()
}

function _criticaSystem(etapa) {
  const tecnica = MAPA_POR_ETAPA[etapa] || ''
  return `Você é um especialista sênior em vendas consultivas, copywriting e neuromarketing ÉTICO.
Recebe: o PROMPT de uma etapa do funil, uma mensagem DIFÍCIL de um lead e a RESPOSTA que o modelo de atendimento deu usando esse prompt.

Sua tarefa: avaliar criticamente a resposta e REESCREVER o prompt da etapa para que o modelo de atendimento
responda melhor a situações difíceis como essa — mantendo objetivo, estrutura e tom da etapa.

TÉCNICA PRIORIZADA DESTA ETAPA: ${tecnica}

${FRAMEWORKS_VENDA}

${GUARDRAIL_ETICO}

Responda APENAS com JSON válido: {"critica": "<o que falhou e por quê, 1-3 frases>", "estagio": "<o prompt da etapa reescrito, denso e honesto>"}`
}

async function _criticarERefinar({ genProvider, etapa, estagio, mensagemCliente, respostaAgente, conhecimento, pool, log, empresaId, contextoId }) {
  const userPrompt = `ETAPA: ${etapa}

PROMPT ATUAL DA ETAPA:
${estagio}

CONHECIMENTO DA EMPRESA:
${conhecimento || '(sem conhecimento)'}

MENSAGEM DIFÍCIL DO LEAD:
${mensagemCliente}

RESPOSTA QUE O MODELO DE ATENDIMENTO DEU:
${respostaAgente}

Critique e reescreva o prompt da etapa.`
  const r = await genProvider.generateAIResponse(
    {
      systemPrompt: _criticaSystem(etapa), userPrompt,
      task: 'criticarRefinarEstagio', maxTokens: SIM_MAX_TOKENS, timeoutMs: SIM_TIMEOUT_MS,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  let parsed = {}
  try { parsed = parsearRespostaJsonClaude(_str(r && r.text)) || {} } catch (_) { parsed = {} }
  const novo = _str(parsed.estagio).trim()
  return {
    critica: _str(parsed.critica).trim(),
    estagio: novo || estagio, // se a IA não devolver, mantém o atual (não apaga)
  }
}

/**
 * Roda o loop simular→corrigir sobre as etapas indicadas (ou as 3 mais difíceis).
 * @returns {{ estagios, simulacoes: Array<{etapa, mensagem_lead, resposta_agente, critica, mudou}> }}
 */
async function simularERefinar({ pool, log, empresaId, contextoId, genProvider, runtimeProvider, estagios, conhecimento, etapas } = {}) {
  const gen = genProvider || makeGenerationProvider()
  const runtime = runtimeProvider || aiProviderModulo
  const base = estagiosSvc.normalizarEstagios(estagios)
  const alvo = (Array.isArray(etapas) && etapas.length ? etapas : ETAPAS_PADRAO_SIMULACAO)
    .filter((e) => estagiosSvc.CHAVES_ETAPA.includes(e) && _str(base[e]).trim())

  const simulacoes = []
  const out = { ...base }
  for (const etapa of alvo) {
    try {
      const mensagem = await _gerarMensagemDificil({ genProvider: gen, etapa, conhecimento, pool, log, empresaId, contextoId })
      const resposta = await _responderComoAgente({ runtimeProvider: runtime, estagio: base[etapa], conhecimento, mensagemCliente: mensagem, pool, log, empresaId, contextoId })
      const { critica, estagio } = await _criticarERefinar({ genProvider: gen, etapa, estagio: base[etapa], mensagemCliente: mensagem, respostaAgente: resposta, conhecimento, pool, log, empresaId, contextoId })
      out[etapa] = estagio
      simulacoes.push({ etapa, mensagem_lead: mensagem, resposta_agente: resposta, critica, mudou: estagio !== base[etapa] })
    } catch (e) {
      simulacoes.push({ etapa, erro: e.message })
    }
  }
  return { estagios: estagiosSvc.normalizarEstagios(out), simulacoes }
}

/**
 * Carrega estágios+conhecimento do contexto, roda simularERefinar e SALVA os estágios refinados.
 */
async function simularERefinarContexto({ pool, log, empresaId, contextoId, genProvider, runtimeProvider, etapas } = {}) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('simularERefinarContexto: pool, empresaId, contextoId obrigatórios')
  }
  const ctxRow = await estagiosSvc.getContextoComEstagios(pool, empresaId, contextoId)
  if (!ctxRow) throw new Error('Contexto não encontrado.')
  const estagiosAtuais = estagiosSvc.normalizarEstagios(ctxRow.estagios_json)
  if (estagiosSvc.estagiosVazios(estagiosAtuais)) {
    throw new Error('Gere os estágios (Gerar tudo) antes de simular.')
  }
  const conhecimento = estagiosSvc.montarConhecimentoDoContexto(ctxRow)
  const { estagios, simulacoes } = await simularERefinar({
    pool, log, empresaId, contextoId, genProvider, runtimeProvider, estagios: estagiosAtuais, conhecimento, etapas,
  })
  const saved = await estagiosSvc.salvarEstagiosNoContexto(pool, empresaId, contextoId, estagios)
  return { estagios: estagiosSvc.normalizarEstagios(saved && saved.estagios_json), simulacoes }
}

module.exports = {
  ETAPAS_PADRAO_SIMULACAO,
  simularERefinar,
  simularERefinarContexto,
}
