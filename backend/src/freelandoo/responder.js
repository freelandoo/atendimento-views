'use strict'

// Processa uma mensagem RECEBIDA numa conversa Freelandoo e responde usando o
// MESMO motor do WhatsApp (Contexto 2 / playbook). A instância Freelandoo é uma
// linha em app.empresa_whatsapp_instances — logo tem contexto 1:1 e "usa agenda?"
// próprios; a resolução do playbook é por instância (evolutionInstance), idêntica
// ao caminho WhatsApp. O bot NUNCA inicia conversa — só responde as existentes.

const { pool } = require('../db')
const { logger } = require('../logger')
const aiProvider = require('../ai-provider')
const { criarCliente } = require('./client')
const { processarMensagemComPlaybook } = require('../services/contexto2-runtime')
const { buscarConexaoDescriptografada, marcarEventoProcessado, marcarEventoErro } = require('../db/freelandoo')

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

  const cliente = criarCliente({ baseUrl: conexao.baseUrl, token: conexao.token })
  const historico = await montarHistorico(cliente, conversationId, mensagemTexto)
  const ultima = historico[historico.length - 1]
  const mensagem = mensagemTexto || (ultima && ultima.role === 'user' ? ultima.content : '')
  if (!mensagem) return { skipped: true, reason: 'sem_mensagem' }

  // leadPhone sintético estável = id da conversa; a engine usa como chave de
  // insights/perfil (colunas TEXT), o que preserva o estado entre turnos.
  const res = await processarMensagemComPlaybook({
    pool,
    log: logger,
    empresaId: conexao.empresaId,
    conversaId: conversationId,
    leadPhone: conversationId,
    mensagem,
    historico,
    evolutionInstance: conexao.evolutionInstance,
    aiProvider,
  })
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
