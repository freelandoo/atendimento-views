'use strict'

/**
 * Classifica o estágio atual de uma conversa de forma determinística (sem LLM).
 *
 * Estágios possíveis:
 *   new_lead           → Primeiro contato, sem histórico com o bot
 *   qualification      → Coletando dados básicos (negócio, cidade, serviço)
 *   diagnosis          → Apurando dor, complexidade e fit com a solução
 *   solution_explanation → Apresentando a solução antes de falar preço
 *   price_question     → Lead perguntou preço (qualquer estágio)
 *   objection          → Lead sinalizou resistência ou adiamento
 *   meeting_offer      → Bot ofertou reunião, aguardando confirmação
 *   meeting_scheduled  → Horário de reunião confirmado
 *   follow_up          → Mensagem de follow-up (automático ou manual)
 *   closed             → Conversa encerrada com sucesso (proposta aceita)
 *   lost               → Lead perdido ou desqualificado
 */

const VALID_STAGES = [
  'new_lead',
  'qualification',
  'diagnosis',
  'solution_explanation',
  'price_question',
  'objection',
  'meeting_offer',
  'meeting_scheduled',
  'follow_up',
  'closed',
  'lost',
]

const OBJECTION_PATTERNS = [
  /car[ao]|muito caro|ficou caro|achei caro/i,
  /sem verba|sem budget|sem dinheiro|sem investimento/i,
  /não tenho (budget|verba|grana|dinheiro)/i,
  /vou (pensar|ver|avaliar|decidir depois|passar)/i,
  /já (tenho|uso|contratei|trabalho com)/i,
  /outro (fornecedor|prestador|profissional|dev)/i,
  /não preciso|não quero|não tenho interesse/i,
  /agora não|depois|mais pra frente|numa próxima/i,
]

const PRICE_PATTERNS = /quanto(?: custa| é| fica| seria)?|preço|valor|investimento|mensalidade|plano|tabela de preço|quanto cobr/i

/**
 * Classifica o estágio da conversa.
 *
 * @param {object}  ctx
 * @param {string}  ctx.texto      Última mensagem do lead
 * @param {object}  ctx.perfil     Perfil do lead (vendas.perfil_lead)
 * @param {string}  ctx.estagio    Estágio do funil (vendas.conversa.estagio)
 * @param {Array}   ctx.historico  Histórico de mensagens
 * @param {string}  [ctx.status]   Status da conversa ('fechado', 'perdido', …)
 * @param {string}  [ctx.tipo]     Tipo do job ('followup_auto', 'webhook_resposta', …)
 *
 * @returns {{ stage: string, reason: string }}
 */
function classifyConversationStage(ctx = {}) {
  const texto = String(ctx.texto || '').trim()
  const perfil = ctx.perfil || {}
  const estagio = ctx.estagio || 'novo'
  const historico = Array.isArray(ctx.historico) ? ctx.historico : []
  const status = ctx.status || null
  const tipo = ctx.tipo || null

  // ── Terminais ─────────────────────────────────────────────────────────────

  if (status === 'fechado' || _profileIndicatesClosed(perfil)) {
    return { stage: 'closed', reason: 'Conversa encerrada com sucesso — proposta aceita ou contrato assinado.' }
  }

  if (status === 'perdido') {
    return { stage: 'lost', reason: 'Lead marcado como perdido ou desqualificado.' }
  }

  // ── Follow-up ──────────────────────────────────────────────────────────────

  if (tipo === 'followup_auto' || tipo === 'followup_manual') {
    return { stage: 'follow_up', reason: 'Mensagem originada de follow-up automático ou manual.' }
  }

  // ── Reunião confirmada (estado persistido no perfil) ───────────────────────

  const reuniao = typeof perfil.reuniao_proposta === 'object' && perfil.reuniao_proposta !== null
    ? perfil.reuniao_proposta
    : {}

  if (reuniao.horario_confirmado) {
    return {
      stage: 'meeting_scheduled',
      reason: `Reunião confirmada para ${reuniao.horario_confirmado}.`,
    }
  }

  // ── Overrides por intenção na mensagem atual ───────────────────────────────
  // Valem para qualquer estágio do funil — intenção > contexto

  if (texto && PRICE_PATTERNS.test(texto)) {
    return {
      stage: 'price_question',
      reason: 'Lead perguntou sobre preço ou investimento nesta mensagem.',
    }
  }

  if (texto && _messageHasObjection(texto)) {
    return {
      stage: 'objection',
      reason: 'Lead sinalizou resistência, objeção de preço ou adiamento.',
    }
  }

  // ── Primeiro contato (sem histórico do bot) ───────────────────────────────

  if (_isNewLead(historico, estagio)) {
    return { stage: 'new_lead', reason: 'Primeiro contato detectado — sem histórico de resposta do bot.' }
  }

  // ── Classificação baseada no estágio do funil ─────────────────────────────

  switch (estagio) {
    case 'primeiro_contato':
    case 'novo':
      return _classifyWithinQualification(perfil)

    case 'diagnostico':
      return { stage: 'diagnosis', reason: 'Funil em diagnóstico — apurando dor, complexidade e fit.' }

    case 'proposta': {
      if (reuniao.necessaria || _botOfferedMeetingRecently(historico)) {
        return {
          stage: 'meeting_offer',
          reason: 'Bot ofertou reunião — aguardando escolha de horário pelo lead.',
        }
      }
      if (_priceWasDiscussedByLead(historico)) {
        return {
          stage: 'price_question',
          reason: 'Preço foi mencionado pelo lead no histórico recente.',
        }
      }
      return {
        stage: 'solution_explanation',
        reason: 'Fase de proposta ativa — apresentando a solução antes de falar em preço.',
      }
    }

    case 'fechamento':
      return {
        stage: 'meeting_offer',
        reason: 'Fase de fechamento — aguardando confirmação de reunião ou próximo passo.',
      }

    default:
      return {
        stage: 'qualification',
        reason: `Estágio desconhecido ("${estagio}") — tratando como qualificação por segurança.`,
      }
  }
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _isNewLead(historico, estagio) {
  const botAlreadyReplied = historico.some((m) => m && m.role === 'assistant')
  const isEarlyStage = !estagio || estagio === 'novo' || estagio === 'primeiro_contato'
  return !botAlreadyReplied && isEarlyStage
}

function _classifyWithinQualification(perfil) {
  const missing = []
  if (!perfil.negocio) missing.push('tipo de negócio')
  if (!perfil.cidade && !perfil.regiao_atendimento) missing.push('cidade ou região')
  if (!perfil.servico_principal && !perfil.servico_foco && !perfil.necessidade
      && !perfil.produto_sugerido && !perfil.dor_principal) missing.push('serviço de interesse')

  const reason = missing.length
    ? `Lead ainda não informou: ${missing.join(', ')}.`
    : 'Dados básicos coletados — pronto para avançar ao diagnóstico.'

  return { stage: 'qualification', reason }
}

function _messageHasObjection(texto) {
  return OBJECTION_PATTERNS.some((pattern) => pattern.test(texto))
}

function _profileIndicatesClosed(perfil) {
  const closedMotivos = ['aceitou_proposta', 'pagamento_confirmado', 'contrato_assinado']
  return closedMotivos.includes(perfil.motivo_handoff) || perfil.status === 'fechado'
}

function _botOfferedMeetingRecently(historico) {
  const MEETING_SIGNALS = [
    /posso marcar|vou marcar|quer marcar|marcar uma conversa|reunião rápida|15 minutos/i,
    /horários disponíveis|qual horário|confirma o horário|escolha um horário/i,
  ]
  return historico
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .some((m) => MEETING_SIGNALS.some((p) => p.test(String(m.content || ''))))
}

function _priceWasDiscussedByLead(historico) {
  return historico
    .filter((m) => m && m.role === 'user')
    .slice(-6)
    .some((m) => PRICE_PATTERNS.test(String(m.content || '')))
}

module.exports = { classifyConversationStage, VALID_STAGES }
