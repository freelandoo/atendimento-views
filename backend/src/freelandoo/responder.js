'use strict'

// Processa uma mensagem RECEBIDA numa conversa Freelandoo e responde usando o
// MESMO motor do WhatsApp (Contexto 2 / playbook). A instância Freelandoo é uma
// linha em app.empresa_whatsapp_instances — logo tem contexto 1:1 e "usa agenda?"
// próprios; a resolução do playbook é por instância (evolutionInstance), idêntica
// ao caminho WhatsApp. O bot NUNCA inicia conversa — só responde as existentes.

const { pool } = require('../db')
const { logger } = require('../logger')
const aiProvider = require('../ai-provider')
const { criarCliente, tipoDaConversa } = require('./client')
const { processarMensagemComPlaybook } = require('../services/contexto2-runtime')
const {
  buscarConexaoDescriptografada, marcarEventoProcessado, marcarEventoErro, somarTokensUsados,
} = require('../db/freelandoo')

// Provider com CONTADOR: intercepta generateAIResponse e acumula os tokens
// reais (usage do provedor; fallback ~chars/4). Usado pelo limite por ciclo
// do Atendimento IA — cada instância provisionada tem token_limit_monthly.
function criarProviderContado(base) {
  let total = 0
  const wrapped = {
    ...base,
    async generateAIResponse(...args) {
      const r = await base.generateAIResponse(...args)
      const u = r?.usage
      if (u && (u.input_tokens || u.output_tokens)) {
        total += (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0)
      } else if (r?.text) {
        total += Math.ceil(String(r.text).length / 4)
      }
      return r
    },
  }
  return { provider: wrapped, tokensGastos: () => total }
}

// Monta o histórico {role, content} a partir da thread da conversa (mais recente
// por último). Fail-open: se a leitura falhar, usa só a mensagem recebida.
async function montarHistorico(cliente, conversationId, mensagemTexto) {
  try {
    const { mensagens } = await cliente.listMessages(conversationId, { limit: 30 })
    const hist = (mensagens || [])
      .filter((m) => (m.texto || '').trim())
      .map((m) => ({ role: m.mine ? 'assistant' : 'user', content: m.texto }))
    const ultima = hist[hist.length - 1]
    if (mensagemTexto && (!ultima || ultima.role !== 'user' || ultima.content !== mensagemTexto)) {
      hist.push({ role: 'user', content: mensagemTexto })
    }
    return hist
  } catch (e) {
    logger.warn({ err: e.message, conversationId }, 'Freelandoo: falha ao listar mensagens — usando só a recebida')
    return mensagemTexto ? [{ role: 'user', content: mensagemTexto }] : []
  }
}

// Processa 1 evento (idempotência garantida pelo chamador, via id_message).
// Retorna { ok, texto } ou { skipped, reason }.
async function processarEventoWebhook({ instanceId, conversationId, mensagemTexto }) {
  const conexao = await buscarConexaoDescriptografada(instanceId)
  if (!conexao) return { skipped: true, reason: 'conexao_nao_encontrada' }
  if (!conexao.ativo) {
    logger.info({ instanceId, conversationId }, 'Freelandoo: instância inativa — não responde')
    return { skipped: true, reason: 'inativa' }
  }
  if (!conexao.token) return { skipped: true, reason: 'sem_token' }

  // ─── Gates do Atendimento IA (instância provisionada pela Freelandoo) ─────
  const config = conexao.config && typeof conexao.config === 'object' ? conexao.config : {}
  if (config.paused === true) {
    logger.info({ instanceId, conversationId }, 'Freelandoo: bot pausado pelo vendedor — não responde')
    return { skipped: true, reason: 'pausado' }
  }
  const tipo = tipoDaConversa(conversationId)
  if (tipo === 'dm' && config.answer_dm === false) {
    return { skipped: true, reason: 'dm_desligado' }
  }
  if (tipo === 'os' && config.answer_os === false) {
    return { skipped: true, reason: 'os_desligado' }
  }
  // Limite de tokens do ciclo: bateu, o bot PARA até o próximo invoice.paid
  // (a Freelandoo re-push com cycle_start novo, que zera o contador).
  if (conexao.tokenLimitMonthly && conexao.tokensUsed >= conexao.tokenLimitMonthly) {
    logger.info(
      { instanceId, conversationId, used: conexao.tokensUsed, limit: conexao.tokenLimitMonthly },
      'Freelandoo: limite de tokens do ciclo atingido — não responde'
    )
    return { skipped: true, reason: 'limite_tokens' }
  }

  const cliente = criarCliente({ baseUrl: conexao.baseUrl, token: conexao.token })
  const historico = await montarHistorico(cliente, conversationId, mensagemTexto)
  const ultima = historico[historico.length - 1]
  const mensagem = mensagemTexto || (ultima && ultima.role === 'user' ? ultima.content : '')
  if (!mensagem) return { skipped: true, reason: 'sem_mensagem' }

  const { provider, tokensGastos } = criarProviderContado(aiProvider)

  // leadPhone sintético estável = id da conversa; a engine usa como chave de
  // insights/perfil (colunas TEXT), o que preserva o estado entre turnos.
  let res
  try {
    res = await processarMensagemComPlaybook({
      pool,
      log: logger,
      empresaId: conexao.empresaId,
      conversaId: conversationId,
      leadPhone: conversationId,
      mensagem,
      historico,
      evolutionInstance: conexao.evolutionInstance,
      aiProvider: provider,
    })
  } finally {
    // Conta o gasto mesmo em turno com erro parcial — a LLM já rodou.
    const gastos = tokensGastos()
    if (gastos > 0) await somarTokensUsados(instanceId, gastos).catch(() => {})
  }
  if (!res) {
    logger.warn({ instanceId, conversationId }, 'Freelandoo: sem playbook ativo na instância — nada enviado')
    return { skipped: true, reason: 'sem_playbook' }
  }
  const texto = String(res?.decisao?.mensagem_pro_lead || '').trim()
  if (!texto) return { skipped: true, reason: 'sem_resposta' }

  await cliente.sendMessage(conversationId, texto)
  await cliente.markRead(conversationId).catch(() => {})
  logger.info(
    { instanceId, conversationId, handoff: !!res?.decisao?.precisa_handoff },
    'Freelandoo: resposta automática enviada'
  )
  return { ok: true, texto }
}

// Processa em background e atualiza o status do evento (processado|erro).
// Idempotência real vem do UNIQUE(id_message) na fila — aqui só marcamos status.
function processarEventoEmBackground({ idMessage, instanceId, conversationId, mensagemTexto }) {
  setImmediate(async () => {
    try {
      const r = await processarEventoWebhook({ instanceId, conversationId, mensagemTexto })
      await marcarEventoProcessado(idMessage).catch(() => {})
      if (r?.skipped) {
        logger.info({ idMessage, conversationId, reason: r.reason }, 'Freelandoo: evento sem resposta automática')
      }
    } catch (err) {
      logger.error({ err: err.message, idMessage, conversationId }, 'Freelandoo: falha ao processar evento')
      await marcarEventoErro(idMessage, err.message).catch(() => {})
    }
  })
}

module.exports = { processarEventoWebhook, processarEventoEmBackground, montarHistorico }
