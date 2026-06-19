'use strict'

const { renderPublicReplyFromAiResponse } = require('./ai-response')
const {
  validarSemTermosInternos,
  validarSemMencaoVictor,
  validarSemFrasesProibidas,
  validarSemMarkdown,
  validarSemPrecoSobMedida,
  validarNaoVazio,
  validarSemResumoHandoffNoLead,
  validarCurta,
  validarSemConsultoriaLonga,
} = require('./agent-validators')
const { textoContemPrecoParaLead } = require('./institutional-language')
const { validarRespostaPorAcao } = require('./action-response-validator')
const {
  decidirProximaAcao: decidirProximaAcaoOrquestrador,
  extrairDadosMensagem,
} = require('./next-action-orchestrator')

/**
 * Rotas para teste de IA — permite simular respostas sem efeitos colaterais
 * Rota: POST /dashboard/teste-ia
 * Sem envio WhatsApp, sem alterar dados reais, apenas diagnóstico
 */

// Guardrails de sandbox: esta rota NUNCA afeta produção, independente do que o cliente enviar
const TEST_MODE_GUARDS = Object.freeze({
  dryRun: true,
  doNotSendWhatsapp: true,
  doNotPersistRealConversation: true,
  doNotCreateFollowup: true,
  doNotCreateRealBooking: true,
})

// Estágios reconhecidos pelo simulador (agente + classifier)
const VALID_STAGES_SIMULATOR = new Set([
  'primeiro_contato', 'coleta_basica', 'diagnostico', 'proposta_enviada', 'negociacao', 'fechamento',
  'new_lead', 'qualification', 'diagnosis', 'solution_explanation', 'price_question',
  'objection', 'meeting_offer', 'meeting_scheduled', 'follow_up', 'closed', 'lost',
])

// Estágios iniciais onde preço é prematuro
const EARLY_PRICE_STAGES = new Set(['primeiro_contato', 'new_lead', 'coleta_basica', 'qualification'])

// Lista para extração de termos bloqueados do texto
const TERMOS_INTERNOS_LISTA = [
  'aprofundar dor', 'lead quente', 'lead frio', 'score_dor', 'score de dor',
  'funil', 'gatilho', 'diagnóstico comercial', 'diagnóstico interno',
  'icp', 'pipeline', 'estratégia interna', 'etapa do funil',
  'não vou ficar aprofundando',
]

/**
 * Valida a resposta gerada pela IA no contexto do simulador de testes.
 * Reutiliza os validators de produção sem acionar efeitos colaterais.
 *
 * @param {object} params
 * @param {string|null} params.botMessage  Mensagem extraída para o lead
 * @param {boolean}     params.jsonValid   Se o raw veio como JSON estruturado
 * @param {object}      params.context     Contexto do lead (stage, customProject, etc.)
 * @returns {object} { valid, score, total, checks, warnings, errors, blockedTerms }
 */
function validarRespostaTesteIA({ botMessage, jsonValid, context }) {
  const checks = {}
  const errors = []
  const warnings = []
  const blockedTerms = []

  // ─ 1. JSON válido ─
  checks.jsonValid = { ok: jsonValid === true, label: 'JSON válido' }
  if (!checks.jsonValid.ok) warnings.push('Resposta não veio como JSON estruturado — foi extraída como texto livre')

  // ─ 2. Existe mensagem para o lead ─
  const emptyResult = validarNaoVazio(botMessage)
  checks.hasBotMessage = { ok: emptyResult.ok, label: 'Mensagem existe' }
  if (!emptyResult.ok) errors.push(emptyResult.erro || 'Mensagem vazia')

  if (botMessage && emptyResult.ok) {
    // ─ 3. Sem menção a Victor ─
    const victorResult = validarSemMencaoVictor(botMessage)
    checks.noVictorMention = { ok: victorResult.ok, label: 'Sem menção a Victor' }
    if (!victorResult.ok) errors.push(victorResult.erro)

    // ─ 4. Sem termos internos do funil ─
    const termsResult = validarSemTermosInternos(botMessage)
    checks.noInternalTerms = { ok: termsResult.ok, label: 'Sem termos internos' }
    if (!termsResult.ok) {
      errors.push(termsResult.erro)
      const lower = botMessage.toLowerCase()
      for (const termo of TERMOS_INTERNOS_LISTA) {
        if (lower.includes(termo.toLowerCase())) blockedTerms.push(termo)
      }
    }

    // ─ 5. Sem frases proibidas (inclui Google-centrismo) ─
    const phrasesResult = validarSemFrasesProibidas(botMessage)
    checks.noProhibitedPhrases = { ok: phrasesResult.ok, label: 'Sem frases proibidas' }
    if (!phrasesResult.ok) errors.push(phrasesResult.erro)

    // ─ 6. Sem markdown indevido ─
    const mdResult = validarSemMarkdown(botMessage)
    checks.noMarkdown = { ok: mdResult.ok, label: 'Sem markdown' }
    if (!mdResult.ok) warnings.push(mdResult.erro)

    // ─ 7. Preço adequado ao contexto ─
    if (context?.customProject) {
      const sobMedidaResult = validarSemPrecoSobMedida(botMessage, { projeto_sob_medida: true })
      checks.noInventedPrice = { ok: sobMedidaResult.ok, label: 'Preço (sob medida)' }
      if (!sobMedidaResult.ok) errors.push(sobMedidaResult.erro)
    } else if (EARLY_PRICE_STAGES.has(context?.stage)) {
      const hasPrice = textoContemPrecoParaLead(botMessage)
      checks.noInventedPrice = { ok: !hasPrice, label: 'Preço prematuro' }
      if (hasPrice) warnings.push('Preço mencionado em estágio inicial — verifique se é adequado')
    } else {
      checks.noInventedPrice = { ok: true, label: 'Preço OK' }
    }

    // ─ 8. Tamanho da mensagem ─
    const curtoResult = validarCurta(botMessage)
    checks.notTooLong = { ok: curtoResult.ok, label: `Tamanho (${botMessage.length} chars)` }
    if (!curtoResult.ok) warnings.push(curtoResult.erro)

    // ─ 9. Sem trecho de handoff interno na mensagem ─
    const handoffResult = validarSemResumoHandoffNoLead(botMessage)
    checks.noHandoffInternal = { ok: handoffResult.ok, label: 'Sem handoff interno' }
    if (!handoffResult.ok) errors.push(handoffResult.erro)

    // ─ 10. Não é consultoria longa ─
    const consultoriaResult = validarSemConsultoriaLonga(botMessage)
    checks.notConsultoria = { ok: consultoriaResult.ok, label: 'Não é consultoria' }
    if (!consultoriaResult.ok) warnings.push(consultoriaResult.erro)
  } else {
    // Mensagem vazia: restantes marcados como não aplicável
    for (const k of ['noVictorMention','noInternalTerms','noProhibitedPhrases','noMarkdown','noInventedPrice','notTooLong','noHandoffInternal','notConsultoria']) {
      checks[k] = { ok: null, label: k }
    }
  }

  // ─ 11. Estágio válido ─
  const stageToCheck = context?.stage
  checks.stageValid = {
    ok: !stageToCheck || VALID_STAGES_SIMULATOR.has(stageToCheck),
    label: 'Estágio válido',
  }
  if (!checks.stageValid.ok) warnings.push(`Estágio "${stageToCheck}" não reconhecido`)

  const allChecks = Object.values(checks).filter(c => c.ok !== null)
  const passedCount = allChecks.filter(c => c.ok === true).length

  return {
    valid: errors.length === 0,
    score: passedCount,
    total: allChecks.length,
    checks,
    warnings,
    errors,
    blockedTerms,
  }
}

module.exports = function registerAITestRoutes(app, deps = {}) {
  const {
    pool,
    logger,
    aiProvider,
    montarSystemPromptDinamico,
  } = deps

  if (!aiProvider) {
    logger.warn('AI Test Routes: aiProvider não configurado')
    return
  }

  // POST /dashboard/teste-ia — Testar resposta da IA
  app.post('/dashboard/teste-ia', async (req, res) => {
    try {
      const user = req.dashboardUser
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Não autenticado' })
      }

      // Sandbox sempre ativo — flags do cliente são ignoradas intencionalmente
      const sandboxGuards = { ...TEST_MODE_GUARDS }

      const { leadMessage, context, history = [], testSessionId } = req.body

      if (!leadMessage || typeof leadMessage !== 'string') {
        return res.status(400).json({ ok: false, error: 'leadMessage é obrigatória' })
      }

      const messageTrim = leadMessage.trim()
      if (!messageTrim) {
        return res.status(400).json({ ok: false, error: 'Mensagem vazia' })
      }

      // Preparar contexto do lead
      const leadContext = {
        numero: context?.phone || 'test-lead',
        nome: context?.leadName || 'Lead Teste',
        negocio: context?.businessType || null,
        cidade: context?.city || null,
        necessidade: context?.need || null,
        temperatura_lead: context?.temperature || 'morno',
        precisa_sistema: context?.customProject || false,
      }

      // Limitar histórico a 20 mensagens para evitar excesso de tokens
      const MAX_HISTORY = 20
      const rawHistorico = (Array.isArray(history) ? history : [])
        .filter(m => m.role && m.content && typeof m.content === 'string')
      const historicoNormalizado = rawHistorico.slice(-MAX_HISTORY)
      const historyTruncated = rawHistorico.length > historicoNormalizado.length

      // Adicionar mensagem atual
      historicoNormalizado.push({
        role: 'user',
        content: messageTrim
      })

      // Chamar AI Provider (simulado, sem envio)
      const inicio = Date.now()
      let aiResponse = null
      let fallbackUsed = false
      let aiProvider_used = 'anthropic'
      let aiModel = 'desconhecido'
      let aiTemperature = 0.7
      let rawResponseType = 'text'
      let rawText = ''
      let parsed = null
      let parseError = null
      let primaryError = null
      let publicMessages = []
      let systemPromptBuilt = ''
      let messagesForAI = []

      const estagio = context?.stage || 'primeiro_contato'

      try {
        // Montar perfil a partir do contexto do teste
        const perfil = {
          nome: leadContext.nome,
          numero: leadContext.numero,
          negocio: leadContext.negocio,
          cidade: leadContext.cidade,
          necessidade: leadContext.necessidade,
          temperatura_lead: leadContext.temperatura_lead,
          precisa_sistema: leadContext.precisa_sistema,
        }

        // Montar system prompt dinâmico real (igual ao agente em produção)
        systemPromptBuilt = montarSystemPromptDinamico
          ? montarSystemPromptDinamico(estagio, perfil, null, {}, historicoNormalizado)
          : 'Você é o assistente de vendas da PJ Codeworks.'

        // Montar messages array com o histórico + mensagem atual
        messagesForAI = historicoNormalizado.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }))

        const result = await aiProvider.generateAIResponse(
          {
            systemPrompt: systemPromptBuilt,
            messages: messagesForAI,
            task: 'ai_test',
            maxTokens: 1200,
            timeoutMs: 20000,
            disableFallback: false,
          },
          pool,
          logger
        )

        rawText = result?.text || ''
        // Agent responds with JSON; render only public bubbles in the simulator chat.
        const rendered = renderPublicReplyFromAiResponse(rawText, { channel: 'test', etapa: estagio })
        parsed = rendered.parsedResponse || null
        parseError = rendered.ok ? null : rendered.error
        publicMessages = rendered.publicMessages || []
        aiResponse = rendered.reply || '[sem resposta]'
        rawResponseType = rendered.ok ? 'json' : 'fallback'

        // ─── VALIDADOR DE ACAO (paridade com o bot real) ─────────────────
        // Antes essa rota chamava o LLM e renderizava direto, sem passar
        // pelo validarRespostaPorAcao do core-funnel. Resultado: simulador
        // mostrava re-greeting, re-pergunta de necessidade, horario
        // inventado etc. — coisas que o bot real bloqueia. Agora rodamos
        // a mesma logica que o WhatsApp real para garantir paridade.
        try {
          const historicoSemUltima = historicoNormalizado.slice(0, -1)
          const perfilDoHistorico = inferirPerfilDoHistorico(historicoSemUltima)
          const perfilValidacao = {
            ...leadContext,
            ...perfilDoHistorico,
            ...(parsed?.atualizar_perfil || {}),
          }
          if (parsed?.reuniao_proposta && typeof parsed.reuniao_proposta === 'object') {
            perfilValidacao.reuniao_proposta = parsed.reuniao_proposta
          }
          const decisaoSimulador = decidirProximaAcaoOrquestrador({
            mensagemAtual: messageTrim,
            perfil: perfilValidacao,
            historico: historicoSemUltima,
            etapaAtual: estagio,
          })
          const decisaoParaValidar = (parsed?.reuniao_proposta?.necessaria || Array.isArray(parsed?.reuniao_proposta?.horarios_sugeridos))
            ? {
                ...decisaoSimulador,
                acao_decidida: 'consultar_agenda',
                etapa_sugerida: parsed?.etapa_proxima || decisaoSimulador.etapa_sugerida || 'proposta',
              }
            : decisaoSimulador
          const bolhasParaValidar = Array.isArray(publicMessages) && publicMessages.length
            ? publicMessages
            : (aiResponse && !aiResponse.startsWith('[') ? [aiResponse] : [])
          const horariosValidacao = Array.isArray(parsed?.reuniao_proposta?.horarios_sugeridos)
            ? parsed.reuniao_proposta.horarios_sugeridos
            : (perfilValidacao?.reuniao_proposta?.horarios_sugeridos || perfilValidacao?.horarios_oferecidos || [])
          const resultadoParaValidar = {
            mensagem_pro_lead: bolhasParaValidar.join('\n\n'),
            mensagens_bolhas: bolhasParaValidar,
            atualizar_perfil: parsed?.atualizar_perfil || {},
            etapa_proxima: parsed?.etapa_proxima || decisaoParaValidar.etapa_sugerida || null,
            solicitar_calculo_preco: false,
            handoff: false,
            motivo_handoff: null,
          }
          if (bolhasParaValidar.length) {
            const validacao = validarRespostaPorAcao(resultadoParaValidar, {
              decisao: decisaoParaValidar,
              perfil: perfilValidacao,
              etapaAtual: estagio,
              mensagemAtual: messageTrim,
              dados_extraidos: decisaoParaValidar.dados_extraidos || {},
              horarios_disponiveis: horariosValidacao,
              historico: historicoNormalizado,
              numero: leadContext.numero,
            })
            if (validacao.bloqueado) {
              const motivos = (validacao.erros || []).map((e) => e.erro)
              logger.warn('[ai-test] resposta bloqueada pelo validador de acao', {
                acao: decisaoParaValidar.acao_decidida,
                motivos,
                testSessionId,
              })
              // Substitui resposta pela fallback contextual
              const novasMensagens = Array.isArray(validacao.resultado?.mensagens_bolhas) && validacao.resultado.mensagens_bolhas.length
                ? validacao.resultado.mensagens_bolhas
                : [validacao.resultado?.mensagem_pro_lead || validacao.mensagemFallback || '']
              publicMessages = novasMensagens.filter(Boolean)
              aiResponse = publicMessages.join('\n\n') || '[fallback vazio]'
              rawResponseType = 'fallback'
            }
          }
        } catch (errValidador) {
          logger.warn({ err: errValidador.message }, '[ai-test] falha no validador de acao (continuando sem bloqueio)')
        }
        logger.info(`[AI_RESPONSE] raw received: ${Boolean(rawText)}`)
        logger.info(`[AI_RESPONSE] code fence detected: ${rendered.codeFenceDetected === true}`)
        logger.info(`[AI_RESPONSE] json parse success: ${rendered.parseSuccess === true}`)
        logger.info(`[AI_RESPONSE] schema valid: ${rendered.schemaValid === true}`)
        logger.info(`[AI_RESPONSE] bubbles count: ${rendered.bubblesCount || publicMessages.length || 0}`)
        logger.info(`[AI_RESPONSE] public messages generated: ${rendered.publicMessagesGenerated === true}`)
        logger.info(`[AI_SEND_GUARD] blocked raw json leak: ${rendered.guardBlocked === true}`)
        logger.info('[AI_SEND_GUARD] channel: test')
        aiProvider_used = result?.provider || 'anthropic'
        aiModel = result?.model || 'desconhecido'
        fallbackUsed = result?.fallback_used === true
        primaryError = result?.primary_error || null
      } catch (err) {
        logger.error({ err: err.message, sandbox: true }, 'Erro ao chamar AI Provider no teste')
        aiResponse = `[Erro ao chamar IA: ${err.message}]`
        rawResponseType = 'fallback'
      }

      const latency = Date.now() - inicio

      // Detectar intenção (simplificado)
      const intent = detectarIntencao(messageTrim, leadContext)

      // Próxima ação (simplificado)
      const nextAction = decidirProximaAcao(intent, leadContext)

      // Dados extraídos (simplificado)
      const extractedData = {
        businessType: extrairNegocio(messageTrim),
        city: extrairCidade(messageTrim),
        need: extrairNecessidade(messageTrim),
        selectedTime: extrairHorario(messageTrim),
      }

      // Estágio antes/depois (simplificado)
      const stageBefore = context?.stage || 'primeiro_contato'
      const stageAfter = decidirEstagio(messageTrim, stageBefore, leadContext)

      // Guardrails: validar resposta gerada (sem efeitos colaterais)
      const guardrails = validarRespostaTesteIA({
        botMessage: (aiResponse && !aiResponse.startsWith('[')) ? aiResponse : null,
        jsonValid: rawResponseType === 'json',
        context: {
          stage: estagio,
          customProject: leadContext.precisa_sistema,
        },
      })

      const sandboxBlock = {
        enabled: sandboxGuards.dryRun,
        whatsappSendBlocked: sandboxGuards.doNotSendWhatsapp,
        realConversationPersistBlocked: sandboxGuards.doNotPersistRealConversation,
        followupBlocked: sandboxGuards.doNotCreateFollowup,
        realBookingBlocked: sandboxGuards.doNotCreateRealBooking,
      }

      // Debug: prompt, input, output — mascarados antes de expor ao frontend
      const PROMPT_PREVIEW_LEN = 500
      const RAW_PREVIEW_LEN = 600
      const systemPromptDebug = textoPromptDebug(systemPromptBuilt)
      const promptMascarado = mascarar(systemPromptDebug)
      const debugPrompt = {
        systemPromptPreview: promptMascarado.slice(0, PROMPT_PREVIEW_LEN) + (promptMascarado.length > PROMPT_PREVIEW_LEN ? '…' : ''),
        systemPromptFull: promptMascarado,
        systemPromptLength: systemPromptDebug.length,
        promptVisible: true,
      }
      const debugAiInput = {
        historyUsed: messagesForAI.map(m => ({ role: m.role, content: mascarar(m.content) })),
        historyCount: messagesForAI.length,
        historyTruncated,
        leadMessage: mascarar(messageTrim),
        contextUsed: {
          stage: estagio,
          leadName: mascarar(leadContext.nome || ''),
          phone: mascarar(leadContext.numero || ''),
          businessType: mascarar(leadContext.negocio || ''),
          city: mascarar(leadContext.cidade || ''),
          need: leadContext.necessidade,
          temperature: leadContext.temperatura_lead,
          customProject: leadContext.precisa_sistema,
        },
      }
      const rawMascarado = mascarar(rawText)
      const debugAiOutput = {
        rawResponseType,
        rawResponsePreview: rawMascarado.slice(0, RAW_PREVIEW_LEN) + (rawMascarado.length > RAW_PREVIEW_LEN ? '…' : ''),
        rawResponseFull: rawMascarado,
        parsedResponse: parsed ? mascararObjeto(parsed) : null,
        parseError,
        primaryError: primaryError ? mascarar(primaryError) : null,
      }

      // Retornar resultado com bloco sandbox explícito e sessionId de volta
      res.json({
        ok: true,
        testSessionId: testSessionId || null,
        result: {
          reply: aiResponse,
          publicMessages,
          intent,
          nextAction,
          extractedData,
          stageBefore,
          stageAfter,
          warnings: [],
          ai: {
            provider: aiProvider_used,
            model: aiModel,
            temperature: aiTemperature,
            fallbackUsed,
            latencyMs: latency,
          },
          sandbox: sandboxBlock,
        },
        diagnostics: {
          testSessionId: testSessionId || null,
          sandbox: sandboxBlock,
          provider: aiProvider_used,
          model: aiModel,
          latencyMs: latency,
          stageBefore,
          stageAfter,
          historyCount: historicoNormalizado.length,
          historyTruncated,
          rawResponseType,
          publicMessagesCount: publicMessages.length,
          guardrails,
          prompt: debugPrompt,
          aiInput: debugAiInput,
          aiOutput: debugAiOutput,
        },
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Erro no teste de IA')
      res.status(500).json({
        ok: false,
        error: err.message || 'Erro ao testar IA',
      })
    }
  })
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// ─── MASCARAMENTO DE DADOS SENSÍVEIS (diagnóstico) ───────────────────────────
// Aplicado antes de expor dados de debug ao frontend (best-effort).

function mascarar(text) {
  if (typeof text !== 'string') return text != null ? String(text) : ''
  return text
    // Email: j***@dominio.com
    .replace(/\b([a-zA-Z0-9])[a-zA-Z0-9._%+\-]{2,}(@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6})\b/g,
      (_, f, d) => `${f}***${d}`)
    // Telefone com código +55: +5511999999999 → +55****9999
    .replace(/\+55\d{10,11}/g, m => `+55****${m.slice(-4)}`)
    // CPF com ou sem formatação: 123.456.789-01
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}\b/g, '***.***.***-**')
    // CNPJ com ou sem formatação: 12.345.678/0001-90
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}[-.]?\d{2}\b/g, '**.***.***/***/***')
}

function mascararObjeto(obj) {
  if (typeof obj === 'string') return mascarar(obj)
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(mascararObjeto)
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = mascarar(v)
    else if (typeof v === 'object' && v !== null) out[k] = mascararObjeto(v)
    else out[k] = v
  }
  return out
}

function textoPromptDebug(prompt) {
  if (typeof prompt === 'string') return prompt
  if (Array.isArray(prompt)) {
    return prompt.map((parte) => {
      if (typeof parte === 'string') return parte
      if (parte && typeof parte === 'object' && typeof parte.text === 'string') return parte.text
      return ''
    }).filter(Boolean).join('\n\n')
  }
  if (prompt && typeof prompt === 'object' && typeof prompt.text === 'string') return prompt.text
  return String(prompt || '')
}

function inferirPerfilDoHistorico(historico = []) {
  const out = {}
  for (const item of Array.isArray(historico) ? historico : []) {
    if (!item || item.role !== 'user' || typeof item.content !== 'string') continue
    const dados = extrairDadosMensagem(item.content)
    if (dados.negocio && !out.negocio) out.negocio = dados.negocio
    if (dados.cidade && !out.cidade) out.cidade = dados.cidade
    if (dados.necessidade && !out.necessidade) out.necessidade = dados.necessidade
    if (dados.origem_clientes && !out.origem_clientes) out.origem_clientes = dados.origem_clientes
  }
  return out
}

function detectarIntencao(msg, context) {
  const lower = msg.toLowerCase()

  if (lower.match(/\d{1,2}:\d{2}/)) return 'escolheu_horario'
  if (lower.match(/quanto|preço|valor|custa/)) return 'pergunta_preco'
  if (lower.match(/quer falar|humano|pessoa|operador/)) return 'pedido_humano'
  if (lower.match(/não entendi|como assim|o quê/)) return 'duvida'
  if (lower.match(/não consigo|não posso|amanhã/)) return 'reagendamento'
  if (lower.match(/site|sistema|app|automação|ia|marketing|tráfego/)) return 'expressa_necessidade'

  return 'sem_intencao_clara'
}

function decidirProximaAcao(intent, context) {
  const actions = {
    escolheu_horario: 'confirmar_horario_e_pedir_email',
    pergunta_preco: context.precisa_sistema
      ? 'explicar_preco_sob_medida_sem_valor'
      : 'enviar_tabela_preco',
    pedido_humano: 'oferecer_handoff',
    duvida: 'esclarecer_e_continuar',
    reagendamento: 'confirmar_novo_horario',
    expressa_necessidade: 'aprofundar_com_perguntas',
  }

  return actions[intent] || 'continuar_coleta'
}

function decidirEstagio(msg, stageBefore, context) {
  // Lógica simplificada
  if (msg.match(/\d{1,2}:\d{2}/)) return 'fechamento'
  if (msg.match(/site|sistema|app/)) return 'diagnostico'
  return stageBefore
}

function extrairNegocio(msg) {
  const patterns = [
    /trabalho com (.+?)(?:,|e|e |$)/i,
    /sou (.+?)(?:,|e|e |$)/i,
  ]

  for (const pattern of patterns) {
    const match = msg.match(pattern)
    if (match) return match[1].trim()
  }

  return null
}

function extrairCidade(msg) {
  const cidades = ['são paulo', 'são bernardo', 'santos', 'osasco', 'abc', 'são caetano']
  const lower = msg.toLowerCase()

  for (const cidade of cidades) {
    if (lower.includes(cidade)) return cidade
  }

  return null
}

function extrairNecessidade(msg) {
  const necessidades = ['site', 'sistema', 'app', 'marketing', 'tráfego', 'automação', 'ia']
  const lower = msg.toLowerCase()

  for (const nec of necessidades) {
    if (lower.includes(nec)) return nec
  }

  return null
}

function extrairHorario(msg) {
  const match = msg.match(/(\d{1,2}):(\d{2})/)
  if (match) return `${match[1]}:${match[2]}`
  return null
}
