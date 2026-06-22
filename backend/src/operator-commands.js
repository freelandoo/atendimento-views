'use strict'

// As chamadas a LLM neste modulo passam por aiProvider.generateAIResponse,
// que respeita o provedor/modelo configurado no Motor de IA.

function createOperatorCommands(deps = {}) {
  const {
    pool,
    logger,
    axios,
    aiProvider,
    normalizarNumeroParaJid,
    normalizarHistoricoMensagens,
    extrairTextoEMidiaDoWebhook,
    buscarConversa,
    salvarConversa,
    cancelarFollowupsAutoPendentes,
    limparDebounceResposta,
    nomeOperadorPorJid,
    enviarMensagem,
    extrairTextoInterativo,
    gerarRequestIdAnthropic,
    registrarChamadaAnthropic,
    statusHttpDeErroAnthropic,
    codigoErroAnthropic,
    mensagemErroAnthropic,
    buscarPerfil,
    gerarApresentacaoOperador,
    enviarPrintLocal,
    executarFollowupUmNumero,
  } = deps

  function parseComandoOperadorWhatsApp(texto) {
    const t = (texto || '').trim()
    if (!t) return null
    let mInstr = t.match(/^([\d\s]+?)\s+NUMERO\s+INSTRUÇÃO:\s*([\s\S]+)$/i)
    if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+NUMERO\s+INTRUÇÃO:\s*([\s\S]+)$/i)
    if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+INSTRUÇÃO:\s*([\s\S]+)$/i)
    if (!mInstr) mInstr = t.match(/^([\d\s]+?)\s+INTRUÇÃO:\s*([\s\S]+)$/i)
    if (mInstr) {
      const jidLead = normalizarNumeroParaJid(mInstr[1].trim())
      const instrucao = (mInstr[2] || '').trim()
      if (!jidLead || !instrucao) return null
      return { tipo: 'instrucao', jidLead, instrucao }
    }
    const mPausa = t.match(/^([\d\s]+?)\s+PAUSAR\s*$/i)
    if (mPausa) {
      const jidLead = normalizarNumeroParaJid(mPausa[1].trim())
      if (!jidLead) return null
      return { tipo: 'pausar', jidLead }
    }
    const mRetoma = t.match(/^([\d\s]+?)\s+RETOMAR\s*$/i)
    if (mRetoma) {
      const jidLead = normalizarNumeroParaJid(mRetoma[1].trim())
      if (!jidLead) return null
      return { tipo: 'retomar', jidLead }
    }
    const mApres = t.match(/^([\d\s]+?)\s+APRESENTA[CÇ][AÃ]O\s*$/i)
    if (mApres) {
      const jidLead = normalizarNumeroParaJid(mApres[1].trim())
      if (!jidLead) return null
      return { tipo: 'apresentacao', jidLead }
    }
    return null
  }
  
  /**
   * Normaliza texto para comparação de eco: lowercase, colapsa whitespace, trim.
   * Garante que pequenas variações de espaço/quebra de linha não quebrem a detecção.
   */
  function normalizarParaComparacaoEco(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  }
  
  /**
   * Detecta se uma mensagem "fromMe" recebida pelo webhook é eco da própria
   * mensagem que o agente acabou de enviar. Evolution às vezes reenvia como
   * webhook o que a gente próprio mandou; sem este filtro, cada turno do agente
   * era gravado duas vezes no histórico (uma como assistant, outra como operator)
   * E o agente ficava auto-pausado sem motivo.
   *
   * Critério: texto normalizado bate exato com alguma das últimas N mensagens
   * assistant do histórico (janela pequena — mensagens muito antigas não contam).
   */
  function ehEcoDoAgente(textoIncoming, historico) {
    if (!textoIncoming || !Array.isArray(historico) || historico.length === 0) return false
    const alvo = normalizarParaComparacaoEco(textoIncoming)
    if (!alvo) return false
    const JANELA = 6
    const ultimas = historico.slice(-JANELA)
    for (const m of ultimas) {
      if (!m || m.role !== 'assistant') continue
      const c = normalizarParaComparacaoEco(m.content)
      if (!c) continue
      if (c === alvo) return true
      // Tolerância: uma das strings contém a outra completamente (caso de bolhas enviadas
      // concatenadas no assistant mas recebidas como bolha única em webhook ou vice-versa)
      if (c.length > 20 && alvo.length > 20 && (c.includes(alvo) || alvo.includes(c))) return true
    }
    return false
  }
  
  async function processarIntervencaoOperadorNoLead(msg, numero) {
    const { texto } = await extrairTextoEMidiaDoWebhook(msg, { remetenteCliente: false })
    const textoHistorico =
      texto || (msg.message?.imageMessage || msg.message?.audioMessage ? '(Operador enviou mídia.)' : null)
    if (!textoHistorico) return
  
    // Carrega historico primeiro para checar se é eco do proprio agente
    let conversa = await buscarConversa(numero)
    let historico = normalizarHistoricoMensagens(conversa?.historico)
  
    if (texto && ehEcoDoAgente(texto, historico)) {
      logger.info(`🔁 Ignorado eco do agente em ${numero} (fromMe bate com último assistant do histórico)`)
      return
    }
  
    const logLinha = textoHistorico.length > 200 ? `${textoHistorico.slice(0, 200)}…` : textoHistorico
    logger.info(`👤 [operador→lead] ${numero}: ${logLinha}`)
  
    let estagio = conversa?.estagio || 'primeiro_contato'
    historico.push({ role: 'operator', content: textoHistorico })
    if (historico.length > 40) historico = historico.slice(-40)
  
    await salvarConversa(numero, historico, estagio, conversa?.status || 'ativo', true)
    // Medição: registra a 1ª vez que o operador assumiu esta conversa (idempotente via
    // COALESCE). Torna mensurável quantos leads o humano fecha fora do bot.
    await pool.query(
      `UPDATE vendas.conversas SET operador_assumiu_em = COALESCE(operador_assumiu_em, NOW()) WHERE numero = $1`,
      [numero]
    ).catch((e) => logger.warn(`operador_assumiu_em falhou em ${numero}: ${e.message}`))
    await cancelarFollowupsAutoPendentes(numero, 'operador_interveio')
    limparDebounceResposta(numero)
    logger.info(`⏸️ Agente pausado automaticamente após intervenção em ${numero}`)
  }
  
  /** Regex que detecta cumprimentos e mensagens de abertura de conversa. */
  const REGEX_CUMPRIMENTO_OPERADOR =
    /^(oi|olá|ola|oioi|opa|e aí|eae|eaê|eai|hey|hello|hi|bom dia|boa tarde|boa noite|tudo bem|tudo bom|me responde|alô|alo|salve|fala|falou|menu|opções|opcoes|ajuda|help)\b/i
  
  /** Monta o texto do menu de 6 ações do operador (fallback texto plano). */
  function montarMenuOperador(nome) {
    return [
      `Oi, ${nome}! O que você quer fazer agora? 👇`,
      '',
      '1️⃣ Responder lead — orientar o agente',
      '2️⃣ Enviar apresentação — modelos + planos para lead',
      '3️⃣ Agendamentos — ver reuniões marcadas',
      '4️⃣ Simular abordagem — treinar o script',
      '5️⃣ Relatório do dia — resumo de leads',
      '6️⃣ Ajustar configuração — regras e scripts',
      '',
      'Responda com o número da opção desejada 👆',
    ].join('\n')
  }
  
  /**
   * Envia o menu de ações como lista interativa (botão "Ver opções").
   * Se a API não suportar sendList (ex.: número com @lid), cai em texto plano.
   */
  async function enviarMenuListaOperador(jidOperador, nome) {
    const numLimpo = String(jidOperador).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
  
    // sendList e sendButtons são bloqueados pelo WhatsApp em conexões Baileys (API não oficial).
    // Menu em texto numerado é o único formato confiável.
    await enviarMensagem(jidOperador, montarMenuOperador(nome))
  }
  
  /** Consulta DB e retorna texto com agendamentos dos leads em estágio handoff. */
  async function textoAgendamentosOperador() {
    try {
      const res = await pool.query(
        `SELECT c.numero, c.estagio, c.atualizado_em,
                p.negocio, p.cidade, p.temperatura_lead
         FROM vendas.conversas c
         LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
         WHERE c.estagio IN ('handoff', 'proposta_enviada', 'negociacao')
           AND c.status = 'ativo'
         ORDER BY c.atualizado_em DESC
         LIMIT 10`
      )
      if (res.rows.length === 0) return '📅 Nenhum lead em etapa de reunião/proposta no momento.'
      const linhas = res.rows.map(r => {
        const num = String(r.numero).replace(/@s\.whatsapp\.net$/i, '')
        const neg = r.negocio || 'sem info'
        const cid = r.cidade || ''
        const temp = r.temperatura_lead ? ` 🌡️ ${r.temperatura_lead}` : ''
        const data = r.atualizado_em ? new Date(r.atualizado_em).toLocaleDateString('pt-BR') : ''
        return `• ${neg}${cid ? ` | ${cid}` : ''}${temp} — ${num} (${data})`
      })
      return `📅 *Leads em reunião/proposta (${res.rows.length}):*\n\n${linhas.join('\n')}`
    } catch (e) {
      logger.error('❌ Agendamentos operador:', e.message)
      return '❌ Não foi possível consultar os agendamentos agora.'
    }
  }
  
  /** Consulta DB e retorna texto com relatório do dia. */
  async function textoRelatorioOperador() {
    try {
      const res = await pool.query(
        `SELECT c.numero, c.estagio, c.status, c.venda_fechada, c.agente_pausado,
                c.atualizado_em, p.negocio, p.cidade, p.temperatura_lead,
                p.termometro_dor, p.score_dor
         FROM vendas.conversas c
         LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
         WHERE c.atualizado_em >= NOW() - INTERVAL '24 hours'
         ORDER BY c.atualizado_em DESC
         LIMIT 15`
      )
      if (res.rows.length === 0) return '📊 Nenhuma conversa atualizada nas últimas 24h.'
      const fechados = res.rows.filter(r => r.venda_fechada)
      const ativos = res.rows.filter(r => !r.venda_fechada && r.status === 'ativo')
      const pausados = res.rows.filter(r => r.agente_pausado)
  
      const linhaLead = r => {
        const num = String(r.numero).replace(/@s\.whatsapp\.net$/i, '')
        const neg = r.negocio ? `${r.negocio}${r.cidade ? ` | ${r.cidade}` : ''}` : num
        const temp = r.temperatura_lead ? ` 🌡️ ${r.temperatura_lead}` : ''
        const dor = r.termometro_dor != null ? ` dor:${r.termometro_dor}/10` : ''
        return `  • ${neg}${temp}${dor}`
      }
  
      const partes = [`📊 *Relatório — últimas 24h (${res.rows.length} leads):*`]
      if (fechados.length) partes.push(`\n✅ *Vendas fechadas (${fechados.length}):*\n${fechados.map(linhaLead).join('\n')}`)
      if (pausados.length) partes.push(`\n⏸️ *Pausados (${pausados.length}):*\n${pausados.map(linhaLead).join('\n')}`)
      if (ativos.length) partes.push(`\n🔥 *Ativos (${ativos.length}):*\n${ativos.map(linhaLead).join('\n')}`)
      return partes.join('\n')
    } catch (e) {
      logger.error('❌ Relatório operador:', e.message)
      return '❌ Não foi possível gerar o relatório agora.'
    }
  }
  
  /**
   * Executa a opção selecionada pelo operador no menu (1–6).
   */
  async function executarOpcaoOperador(opcao, msg, jidOperador) {
    const nome = (await nomeOperadorPorJid(jidOperador)) || (msg.pushName || '').trim() || 'parceiro'
    try {
      switch (opcao) {
        case 1:
          await enviarMensagem(jidOperador,
            '✍️ *Responder lead*\n\nUse o formato:\n`5511999999999 INSTRUÇÃO: seu texto`\n\nO agente vai incluir sua orientação na próxima resposta ao lead.'
          )
          break
        case 2:
          await enviarMensagem(jidOperador,
            '📸 *Enviar apresentação*\n\nUse o formato:\n`5511999999999 APRESENTAÇÃO`\n\nO agente envia as imagens de modelos + planos com mensagem complementar para o lead.'
          )
          break
        case 3: {
          const texto = await textoAgendamentosOperador()
          await enviarMensagem(jidOperador, texto)
          break
        }
        case 4:
          await enviarMensagem(jidOperador,
            '🎯 *Simular abordagem*\n\nMe descreva o perfil do lead e eu respondo como se fosse ele:\n\nEx: "Simula lead: pintor de paredes em São Paulo, não aparece no Google, ticket R$500"\n\nVou jogar o papel do lead para você treinar o script.'
          )
          break
        case 5: {
          const texto = await textoRelatorioOperador()
          await enviarMensagem(jidOperador, texto)
          break
        }
        case 6:
          await enviarMensagem(jidOperador,
            '⚙️ *Ajustar configuração*\n\nPara ajustar scripts, preços ou regras do agente, acesse o painel ou fale diretamente com a equipe da {{empresa}}.\n\nPara comandos rápidos:\n`5511999999999 INSTRUÇÃO: novo contexto para o agente`'
          )
          break
        default:
          await enviarMenuListaOperador(jidOperador, nome)
      }
    } catch (e) {
      logger.error('❌ Opção operador:', e.message)
    }
  }
  
  function textoAjudaOperadorProgramada() {
    return [
      'Comando não reconhecido.',
      '',
      'Use um destes formatos:',
      '5511999999999 INSTRUÇÃO: texto para orientar o agente',
      '5511999999999 PAUSAR',
      '5511999999999 RETOMAR',
      '5511999999999 APRESENTAÇÃO',
      '',
      'Para ver o menu, envie: menu',
    ].join('\n')
  }
  
  /**
   * Responde ao operador de forma contextual:
   * - Cumprimentos / "menu" → menu completo com 6 opções
   * - Número 1–6 → executa a opção selecionada
   * - Outras mensagens -> ajuda programada
   */
  async function processarMensagemLivreOperador(msg, jidOperador) {
    const nomeConfig = await nomeOperadorPorJid(jidOperador)
    const nome = nomeConfig || (msg.pushName || '').trim() || 'parceiro'
    const textoInterativo = extrairTextoInterativo(msg.message)
    const texto = (
      textoInterativo ||
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ''
    ).trim()
  
    try {
      // Seleção numerada do menu (aceita "1", "1.", "1)" etc.)
      const mOpcao = texto.match(/^([1-6])[.):\s]?\s*$/)
      if (mOpcao) {
        await executarOpcaoOperador(parseInt(mOpcao[1]), msg, jidOperador)
        return
      }
  
      // Verificar se é modo de simulação de lead
      if (/^simula\b/i.test(texto)) {
        await executarSimulacaoLead(texto, jidOperador, nome)
        return
      }
  
      if (!texto || REGEX_CUMPRIMENTO_OPERADOR.test(texto)) {
        // Cumprimento, "menu", "opções" → menu completo
        await enviarMenuListaOperador(jidOperador, nome)
      } else {
        // Pergunta livre -> ajuda programada
        await enviarMensagem(jidOperador, textoAjudaOperadorProgramada())
      }
    } catch (e) {
      logger.error('❌ Menu operador:', e.message)
    }
  }
  
  /**
   * Modo de simulação: Claude joga o papel de um lead baseado na descrição do operador.
   */
  async function executarSimulacaoLead(descricao, jidOperador, nomeOperador) {
    const system = [
      `Você é um lead (cliente em potencial) de pequeno negócio no Brasil.`,
      `Responda APENAS como o lead responderia — curto, direto, natural, como em WhatsApp.`,
      `Perfil descrito pelo operador: ${descricao}`,
      `Não quebre o personagem. Não explique que é uma simulação. Se o operador enviar uma abordagem de vendas, responda como o lead reagiria.`,
    ].join(' ')
    const requestId = gerarRequestIdAnthropic()
    const inicio = Date.now()
    try {
      const result = await aiProvider.generateAIResponse(
        {
          systemPrompt: system,
          userPrompt: `[Início da simulação. O operador vai te abordar agora. Primeiro, apresente-se brevemente como o lead.]`,
          task: 'simulacao',
          maxTokens: 200,
          timeoutMs: 15000,
        },
        pool,
        logger
      )
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'simulacao',
          numero: jidOperador,
          model: result.model,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus || 200,
          stop_reason: result.stopReason || null,
          usage: result.usage,
          metadata: { fallback_used: result.fallback_used === true },
        })
      }
      const fala = String(result?.text || '').trim()
      await enviarMensagem(jidOperador, `🎯 *Simulação iniciada!*\n\nPerfil: ${descricao}\n\n_Lead diz:_\n${fala}\n\n_(Responda normalmente para continuar o roleplay)_`)
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'simulacao',
        numero: jidOperador,
        model: 'desconhecido',
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
      })
      logger.error('❌ Simulação lead:', e.message)
      await enviarMensagem(jidOperador, '❌ Não foi possível iniciar a simulação agora.')
    }
  }
  
  /**
   * Chama Claude Haiku com prompt leve para responder perguntas conversacionais do operador.
   */
  async function chamarClaudeAssistenteOperador(pergunta, nomeOperador) {
    const system = [
      `Assistente interno da {{empresa}} respondendo ao operador ${nomeOperador}.`,
      `Funcionalidades disponíveis no chat:`,
      `1 - Responder lead: [número] INSTRUÇÃO: texto`,
      `2 - Enviar apresentação: [número] APRESENTAÇÃO`,
      `3 - Agendamentos: responder "3" no menu`,
      `4 - Simular abordagem: "Simula lead: [descrição]"`,
      `5 - Relatório do dia: responder "5" no menu`,
      `6 - Ajustar configuração: contato com a equipe da {{empresa}}`,
      `Responda em português, direto, máximo 3 frases. Não invente funcionalidades.`,
    ].join(' ')
    const requestId = gerarRequestIdAnthropic()
    const inicio = Date.now()
    try {
      const result = await aiProvider.generateAIResponse(
        {
          systemPrompt: system,
          userPrompt: pergunta,
          task: 'operador_assistente',
          maxTokens: 256,
          timeoutMs: 15000,
        },
        pool,
        logger
      )
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'operador_assistente',
          model: result.model,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus || 200,
          stop_reason: result.stopReason || null,
          usage: result.usage,
          metadata: { fallback_used: result.fallback_used === true },
        })
      }
      return String(result?.text || '').trim() || null
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'operador_assistente',
        model: 'desconhecido',
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
      })
      logger.error('❌ Assistente operador:', e.message)
      return null
    }
  }
  
  async function processarComandosOperadorChat(msg, jidOperador) {
    // Suporte a respostas interativas (lista / botões) além de texto livre
    const textoInterativo = extrairTextoInterativo(msg.message)
    const texto = (
      textoInterativo ||
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ''
    ).trim()
    if (!texto) return
  
    const parsed = parseComandoOperadorWhatsApp(texto)
    if (!parsed) {
      // Seleção do menu (1–6): encaminha para processarMensagemLivreOperador que executa a opção
      const mOpcaoMenu = texto.match(/^([1-6])[.):\s]?\s*$/)
      if (mOpcaoMenu) {
        await processarMensagemLivreOperador(msg, jidOperador)
        return
      }
      if (/^\s*\d{5,}/.test(texto)) {
        // Parece um comando com número de lead mas está mal formatado — mostra o formato correto
        try {
          await enviarMensagem(
            jidOperador,
            'Formato:\n5511999999999 PAUSAR\n5511999999999 RETOMAR\n5511999999999 INSTRUÇÃO: texto\n5511999999999 APRESENTAÇÃO'
          )
        } catch (e) {
          logger.error('❌ Aviso ao operador:', e.message)
        }
      } else {
        // Mensagem conversacional — saudação, pergunta ou seleção de menu
        await processarMensagemLivreOperador(msg, jidOperador)
      }
      return
    }
  
    const { jidLead, tipo } = parsed
  
    // APRESENTAÇÃO não requer conversa prévia
    if (tipo === 'apresentacao') {
      try {
        const num = String(jidLead).replace(/@s\.whatsapp\.net$/i, '')
        const perfilLead = await buscarPerfil(jidLead).catch(() => ({}))
        const conversaLead = await buscarConversa(jidLead).catch(() => null)
        const historicoLead = normalizarHistoricoMensagens(conversaLead?.historico)
        const apres = await gerarApresentacaoOperador(perfilLead, historicoLead, jidLead)
        await enviarMensagem(jidLead, apres.intro)
        await enviarPrintLocal(jidLead, 'modelos-site', apres.captionModelos)
        await enviarPrintLocal(jidLead, 'planos-mensais', apres.captionPlanos)
        await enviarMensagem(jidLead, apres.fechamento)
        await enviarMensagem(jidOperador, `✅ Apresentação enviada ao lead ${num}.`)
      } catch (e) {
        logger.error('❌ Apresentação ao lead:', e.message)
        try { await enviarMensagem(jidOperador, `❌ Erro ao enviar apresentação: ${e.message}`) } catch (_) {}
      }
      return
    }
  
    const conversa = await buscarConversa(jidLead)
    if (!conversa) {
      try {
        await enviarMensagem(jidOperador, `Não há conversa salva para ${jidLead}.`)
      } catch (e) {
        logger.error('❌ Aviso ao operador:', e.message)
      }
      return
    }
  
    try {
      if (tipo === 'pausar') {
        await pool.query(
          `UPDATE vendas.conversas SET agente_pausado = true, atualizado_em = NOW() WHERE numero = $1`,
          [jidLead]
        )
        await enviarMensagem(jidOperador, `✅ Agente pausado para ${jidLead}`)
        return
      }
      if (tipo === 'retomar') {
        await pool.query(
          `UPDATE vendas.conversas SET agente_pausado = false, atualizado_em = NOW() WHERE numero = $1`,
          [jidLead]
        )
        await enviarMensagem(jidOperador, `✅ Agente retomado para ${jidLead}`)
        return
      }
      let historico = normalizarHistoricoMensagens(conversa.historico)
      historico.push({ role: 'operator', content: parsed.instrucao })
      if (historico.length > 40) historico = historico.slice(-40)
      await salvarConversa(jidLead, historico, conversa.estagio || 'primeiro_contato', conversa.status || 'ativo')
      try {
        const { trecho_resposta } = await executarFollowupUmNumero(jidLead, parsed.instrucao)
        const preview = trecho_resposta
          ? `\n\nTrecho enviado ao lead:\n${trecho_resposta}${trecho_resposta.length >= 200 ? '…' : ''}`
          : ''
        await enviarMensagem(
          jidOperador,
          `✅ Instrução registrada e mensagem enviada ao lead ${jidLead}.${preview}`
        )
      } catch (eFollowup) {
        logger.error('❌ Follow-up após INSTRUÇÃO:', eFollowup.message)
        try {
          await enviarMensagem(
            jidOperador,
            `⚠️ Instrução salva no histórico, mas não foi possível enviar a mensagem ao lead: ${eFollowup.message}`
          )
        } catch (_) {}
      }
    } catch (e) {
      logger.error('❌ Comando operador:', e.message)
      try {
        await enviarMensagem(jidOperador, `Erro: ${e.message}`)
      } catch (_) {}
    }
  }

  return {
    parseComandoOperadorWhatsApp,
    normalizarParaComparacaoEco,
    ehEcoDoAgente,
    processarIntervencaoOperadorNoLead,
    montarMenuOperador,
    enviarMenuListaOperador,
    textoAgendamentosOperador,
    textoRelatorioOperador,
    executarOpcaoOperador,
    textoAjudaOperadorProgramada,
    processarMensagemLivreOperador,
    executarSimulacaoLead,
    chamarClaudeAssistenteOperador,
    processarComandosOperadorChat,
  }
}

module.exports = { createOperatorCommands }
