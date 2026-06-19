'use strict'

const {
  FOLLOWUP_INSTRUCAO_MAX_CHARS,
  FOLLOWUP_SNIPPET_MAX_CHARS,
  LEAD_CONTEXTO_PROMPT_LIMIT,
} = require('./config')

const FOLLOWUP_HORAS_CONTINUACAO = 6
const FOLLOWUP_HORAS_DISTANCIADO = 24

function createFollowupExecution(deps = {}) {
  const {
    axios,
    pool,
    aiProvider,
    logger,
    prompts,
    normalizarHistoricoMensagens,
    buscarLeadContextos,
    montarBlocoContextoInterno,
    buscarAprendizadosAtivos,
    montarBlocoCorrecoesAprendizados,
    gerarRequestIdAnthropic,
    registrarChamadaAnthropic,
    statusHttpDeErroAnthropic,
    codigoErroAnthropic,
    mensagemErroAnthropic,
    parsearRespostaJsonClaude,
    buscarConversa,
    gerarEEnviarRespostaWhatsapp,
    buscarPerfil,
    enviarMensagem,
    salvarConversa,
    registrarFollowupEnvio,
    // Reengajamento multiempresa (Contexto 2). Opcionais: se ausentes, usa só PJ.
    getContextoAtivoEmpresa,
    gerarFollowupComPlaybook,
  } = deps

  function perfilResumidoParaFollowup(perfil) {
    if (!perfil || typeof perfil !== 'object') return {}
    const { id: _id, ...rest } = perfil
    const out = {}
    for (const [k, v] of Object.entries(rest)) {
      if (v != null && v !== '') out[k] = v
    }
    return out
  }
  
  /**
   * Texto curto em português para o intervalo desde `atualizado_em` até agora.
   * @param {number} diffMs
   */
  function formatarIntervaloAproximadoPt(diffMs) {
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'tempo indisponível'
    const minutos = Math.floor(diffMs / 60000)
    if (minutos < 1) return 'menos de 1 minuto'
    if (minutos < 60) {
      return minutos === 1 ? 'cerca de 1 minuto' : `cerca de ${minutos} minutos`
    }
    const horas = Math.round(diffMs / 3600000)
    if (horas < 24) {
      return horas <= 1 ? 'cerca de 1 hora' : `cerca de ${horas} horas`
    }
    const dias = Math.round(diffMs / 86400000)
    return dias <= 1 ? 'cerca de 1 dia' : `cerca de ${dias} dias`
  }
  
  /**
   * Contexto de tempo para o prompt de follow-up manual (usa `atualizado_em` da conversa).
   * @param {Date|string|null|undefined} atualizadoEm
   * @param {unknown[]} historicoNormalizado resultado de `normalizarHistoricoMensagens`
   */
  function contextoTempoFollowup(atualizadoEm, historicoNormalizado) {
    const agora = new Date().toISOString()
    const msgs = Array.isArray(historicoNormalizado) ? historicoNormalizado : []
    const ultimo = msgs.length ? msgs[msgs.length - 1] : null
    let ultima_mensagem_no_historico = 'desconhecido'
    if (ultimo && typeof ultimo.role === 'string') {
      if (ultimo.role === 'user') ultima_mensagem_no_historico = 'user'
      else if (ultimo.role === 'assistant') ultima_mensagem_no_historico = 'assistant'
      else if (ultimo.role === 'operator') ultima_mensagem_no_historico = 'operator'
    }
  
    let ultima_atualizacao_conversa = null
    let intervalo_aproximado = 'tempo indisponível'
    /** @type {'continuacao'|'continuacao_leve'|'followup_retomada'|'neutro'} */
    let tom_sugerido = 'neutro'
  
    const t =
      atualizadoEm instanceof Date
        ? atualizadoEm
        : atualizadoEm != null && String(atualizadoEm).trim() !== ''
          ? new Date(atualizadoEm)
          : null
  
    if (t && !Number.isNaN(t.getTime())) {
      ultima_atualizacao_conversa = t.toISOString()
      let diffMs = Date.now() - t.getTime()
      if (diffMs < 0) diffMs = 0
      intervalo_aproximado = formatarIntervaloAproximadoPt(diffMs)
      const horas = diffMs / 3600000
      if (horas < FOLLOWUP_HORAS_CONTINUACAO) tom_sugerido = 'continuacao'
      else if (horas < FOLLOWUP_HORAS_DISTANCIADO) tom_sugerido = 'continuacao_leve'
      else tom_sugerido = 'followup_retomada'
    }
  
    return {
      agora,
      ultima_atualizacao_conversa,
      intervalo_aproximado,
      ultima_mensagem_no_historico,
      tom_sugerido,
    }
  }
  
  /**
   * Bloco de texto injetado no user message do follow-up (português, uso interno do modelo).
   * @param {ReturnType<typeof contextoTempoFollowup>|null|undefined} ctx
   */
  function textoBlocoContextoTempoFollowup(ctx) {
    if (!ctx || typeof ctx !== 'object') {
      return `\n\n--- CONTEXTO DE TEMPO (uso interno; não copie labels ao lead) ---
  Tempo desde a última atualização da conversa: indisponível. Tom neutro e natural.
  Última mensagem no histórico: desconhecido.\n`
    }
    const ultMsg = ctx.ultima_mensagem_no_historico || 'desconhecido'
    const ultAt =
      ctx.ultima_atualizacao_conversa != null ? String(ctx.ultima_atualizacao_conversa) : 'indisponível'
    return `\n\n--- CONTEXTO DE TEMPO (uso interno; não copie labels ao lead) ---
  Referência de agora (UTC): ${ctx.agora}
  Última atualização gravada da conversa (aprox. último evento): ${ultAt}
  Intervalo aproximado desde então: ${ctx.intervalo_aproximado}
  Quem falou por último no histórico: ${ultMsg} (user=cliente, assistant=assistente, operator=operador)
  Tom sugerido (siga as regras do sistema): ${ctx.tom_sugerido}\n`
  }
  
  /** Lembrete curto no user message do follow-up quando há motor de precificação no perfil. */
  function textoBlocoPrecificacaoFollowup(perfil) {
    const raw = perfil && perfil.precificacao_json
    if (raw == null) return ''
    let pj = raw
    if (typeof pj === 'string') {
      try {
        pj = JSON.parse(pj)
      } catch (_) {
        return ''
      }
    }
    if (!pj || typeof pj !== 'object' || Array.isArray(pj)) return ''
    const vp = pj.valor_personalizado
    if (vp == null || !Number.isFinite(Number(vp))) return ''
    const sIni  = Number.isFinite(Number(pj.iniciante_valor)) ? `R$ ${pj.iniciante_valor}` : '?'
    const sPad  = Number.isFinite(Number(pj.padrao_valor))    ? `R$ ${pj.padrao_valor}`    : '?'
    const sPrem = Number.isFinite(Number(pj.premium_valor))   ? `R$ ${pj.premium_valor}`   : '?'
    const sEnt  = Number.isFinite(Number(pj.parcelamento_recomendado?.entrada)) ? `R$ ${pj.parcelamento_recomendado.entrada}` : '?'
    const sPar  = Number.isFinite(Number(pj.parcelamento_recomendado?.parcela)) ? `R$ ${pj.parcelamento_recomendado.parcela}` : '?'
    return `\n\n---\nPrecificação já calculada no perfil: plano=${pj.plano_recomendado ?? '?'} | ROI=${pj.roi_score ?? '?'} | valor_personalizado=R$ ${vp} (faixa R$${pj.range_min ?? '?'}–R$${pj.range_max ?? '?'}); parcelamento: entrada ${sEnt} + 3x ${sPar}. Três planos (mesmo ROI): Iniciante ${sIni} / Padrão ${sPad} / Premium ${sPrem}. Upgrades: Inic→Pad R$ ${pj.upgrade_iniciante_para_padrao ?? '?'} · Pad→Prem R$ ${pj.upgrade_padrao_para_premium ?? '?'}. Use só estes números; não invente cifras.\n`
  }
  
  async function chamarClaudeFollowup(historico, estagio, perfil, opcoes = {}) {
    const instrucao =
      opcoes &&
      typeof opcoes.instrucao === 'string' &&
      opcoes.instrucao.trim().length > 0
        ? opcoes.instrucao.trim()
        : null
    if (instrucao && instrucao.length > FOLLOWUP_INSTRUCAO_MAX_CHARS) {
      throw new Error(`Instrução excede ${FOLLOWUP_INSTRUCAO_MAX_CHARS} caracteres`)
    }
    const msgs = normalizarHistoricoMensagens(historico)
    const trechos = msgs.slice(-30).map((m) => {
      const role =
        m.role === 'user'
          ? 'Cliente'
          : m.role === 'assistant'
            ? 'Assistente'
            : m.role === 'operator'
              ? 'Operador'
              : m.role
      let text = m.content
      if (typeof text !== 'string') {
        if (text == null) text = ''
        else if (Array.isArray(text)) {
          text = text
            .map((b) => (b && typeof b === 'object' && 'text' in b ? b.text : JSON.stringify(b)))
            .join('')
        } else text = String(text)
      }
      return `${role}: ${text}`
    })
    const historicoTexto = trechos.length ? trechos.join('\n\n') : '(Sem mensagens no histórico.)'
  
    const baseFollow = prompts.FOLLOWUP_PROMPT_BASE.trim() ||
      `Escreva uma mensagem curta de follow-up para WhatsApp. Responda APENAS com JSON: {"mensagem":"..."}`
  
    const blocoDirecionamento = instrucao
      ? `\n\n---\nDIRECIONAMENTO DO OPERADOR (não envie este texto ao lead; integre o foco de forma natural na mensagem final, sem citar que foi instrução interna):\n${instrucao}\n`
      : ''
  
    const ctxTempo =
      opcoes && opcoes.contextoTempo != null && typeof opcoes.contextoTempo === 'object'
        ? opcoes.contextoTempo
        : null
    const blocoContextoTempo = textoBlocoContextoTempoFollowup(ctxTempo)
    const blocoPrecificacao = textoBlocoPrecificacaoFollowup(perfil)
    const contextosInternosFollowup = perfil?.numero ? await buscarLeadContextos(perfil.numero, LEAD_CONTEXTO_PROMPT_LIMIT) : []
    const blocoContextoInternoFollowup = montarBlocoContextoInterno(contextosInternosFollowup)
    const aprendFollow = await buscarAprendizadosAtivos('followup')
    const blocoAprendFollow = montarBlocoCorrecoesAprendizados(aprendFollow)
  
    const userContent = `HISTÓRICO DA CONVERSA:\n${historicoTexto}\n\n---\nESTÁGIO ATUAL NO FUNIL: ${estagio}\n\nPERFIL DO LEAD (JSON):\n${JSON.stringify(perfilResumidoParaFollowup(perfil), null, 2)}${blocoPrecificacao}${blocoDirecionamento}${blocoContextoTempo}\nGere a mensagem de follow-up conforme as instruções do sistema. Responda APENAS com um JSON válido: {"mensagem":"..."}`
  
    const userContentFinal = userContent.replace(
      `${blocoPrecificacao}${blocoDirecionamento}`,
      `${blocoPrecificacao}${blocoContextoInternoFollowup}${blocoDirecionamento}`
    )
  
    // Regra de BREVIDADE imposta em codigo (sobrepoe o prompt-base): follow-up que vira
    // recapitulacao longa e ignorado pelo lead. Forca um cutuque curto e direto.
    const REGRA_BREVIDADE_FOLLOWUP =
      'REGRA OBRIGATORIA DE FORMATO (sobrepoe qualquer outra instrucao de tamanho): o follow-up e um ' +
      'CUTUQUE curto, nao uma recapitulacao. No MAXIMO 1 bolha, 1-2 frases curtas. NAO resuma a conversa ' +
      'anterior nem repita o que o lead ja disse. Foque em UM unico ponto: uma pergunta leve OU um proximo ' +
      'passo concreto. Se fizer sentido chamar para a conversa rapida, proponha 1-2 horarios concretos e ' +
      'peca para escolher. Tom humano e leve, sem pressao.'

    // Concatena prompt + aprendizados num unico system string (compativel com qualquer provedor).
    const systemFollowupStr = (blocoAprendFollow
      ? `${baseFollow}\n\n${blocoAprendFollow.trim()}`
      : baseFollow) + `\n\n${REGRA_BREVIDADE_FOLLOWUP}`

    const requestId = opcoes?.request_id || gerarRequestIdAnthropic()
    const inicio = Date.now()
    let result
    try {
      result = await aiProvider.generateAIResponse(
        {
          systemPrompt: systemFollowupStr,
          userPrompt: userContentFinal,
          task: 'followup',
          // Teto baixo reforca a brevidade (mensagem curta + wrapper JSON cabem folgados).
          maxTokens: 512,
          extraHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
          responseFormatJson: true,
        },
        pool,
        logger
      )
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'followup',
          numero: perfil?.numero || null,
          model: result.model,
          estagio,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus || 200,
          stop_reason: result.stopReason || null,
          usage: result.usage,
          metadata: { tem_instrucao: !!instrucao, fallback_used: result.fallback_used === true },
        })
      }
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'followup',
        numero: perfil?.numero || null,
        model: 'desconhecido',
        estagio,
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
        metadata: { tem_instrucao: !!instrucao },
      })
      throw e
    }

    const bruto = String(result?.text || '')
    const parsed = parsearRespostaJsonClaude(bruto)
    let texto = parsed && typeof parsed.mensagem === 'string' ? parsed.mensagem.trim() : ''
    if (!texto) {
      texto = (bruto || '').trim()
    }
    if (!texto) {
      throw new Error('Modelo retornou mensagem de follow-up vazia')
    }
    return texto
  }
  
  /**
   * Follow-up manual para um JID: se a última mensagem for do cliente, usa o mesmo fluxo do webhook (funil + system.md);
   * caso contrário, mensagem curta via followup.md (reengajamento).
   * @param {string} numero JID normalizado
   * @param {string|null} instrucao texto opcional de direcionamento do operador (já validado no handler)
   */
  async function executarFollowupUmNumero(numero, instrucao) {
    const conversa = await buscarConversa(numero)
    if (!conversa) {
      throw new Error('Conversa não encontrada para este número.')
    }
    const instrTrim = instrucao && String(instrucao).trim() ? String(instrucao).trim() : null
    const snippetInstr = instrTrim ? instrTrim.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS) : null
    const historicoBruto = normalizarHistoricoMensagens(conversa.historico)
    const ultima = historicoBruto[historicoBruto.length - 1]
    const modo = ultima && ultima.role === 'user' ? 'fluxo_funil' : 'reengajamento'
    const estagio = conversa.estagio || 'primeiro_contato'
  
    const funnelOpcoes =
      instrTrim
        ? { instrucaoOperador: instrTrim }
        : {}
  
    try {
      if (ultima && ultima.role === 'user') {
        let info = await gerarEEnviarRespostaWhatsapp(
          numero,
          historicoBruto,
          estagio,
          conversa,
          null,
          funnelOpcoes
        )
        if (info && info.stale) {
          const c2 = await buscarConversa(numero)
          if (!c2) {
            throw new Error('Conversa não encontrada para este número.')
          }
          const h2 = normalizarHistoricoMensagens(c2.historico)
          info = await gerarEEnviarRespostaWhatsapp(
            numero,
            h2,
          c2.estagio || 'primeiro_contato',
          c2,
          null,
          { ...funnelOpcoes, stale_retry: true }
        )
        }
        if (info && info.stale) {
          throw new Error('Histórico mudou durante a geração; tente novamente.')
        }
        const preview =
          (info && typeof info.texto_metrica_followup === 'string' && info.texto_metrica_followup) ||
          (info && typeof info.trecho_resposta === 'string' && info.trecho_resposta) ||
          ''
        await registrarFollowupEnvio(numero, {
          modo: 'fluxo_funil',
          instrucao_snippet: snippetInstr,
          mensagem_preview: preview.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
          envio_ok: true,
          erro: null,
        })
        return info
      }
  
      const perfil = await buscarPerfil(numero)
      if (!perfil.numero) perfil.numero = numero
      const contextoTempo = contextoTempoFollowup(conversa.atualizado_em, historicoBruto)
      const opcoesFollow = { contextoTempo, ...(instrTrim ? { instrucao: instrTrim } : {}) }

      // Bifurcação multiempresa: empresa com Contexto 2 ativo gera o follow-up com
      // o PRÓPRIO playbook (não com os prompts da PJ). PJ usa chamarClaudeFollowup.
      const empresaIdFollow = conversa.empresa_id || null
      let textoFollowup
      let playbookFollow = null
      if (empresaIdFollow && typeof getContextoAtivoEmpresa === 'function' && typeof gerarFollowupComPlaybook === 'function') {
        playbookFollow = await getContextoAtivoEmpresa(pool, empresaIdFollow).catch(() => null)
      }
      if (playbookFollow) {
        textoFollowup = await gerarFollowupComPlaybook({
          pool, log: logger, empresaId: empresaIdFollow, leadPhone: numero,
          historico: historicoBruto, playbook: playbookFollow, contextoTempo,
        })
      } else {
        textoFollowup = await chamarClaudeFollowup(historicoBruto, estagio, perfil, opcoesFollow)
      }
      await enviarMensagem(numero, textoFollowup)
  
      let historicoNovo = [...historicoBruto, { role: 'assistant', content: textoFollowup }]
      if (historicoNovo.length > 40) historicoNovo = historicoNovo.slice(-40)
  
      await salvarConversa(numero, historicoNovo, estagio, conversa.status || 'ativo', undefined, empresaIdFollow)
  
      await registrarFollowupEnvio(numero, {
        modo: 'reengajamento',
        instrucao_snippet: snippetInstr,
        mensagem_preview: textoFollowup.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
        envio_ok: true,
        erro: null,
      })
  
      const destino = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
      return { destino, trecho_resposta: textoFollowup.slice(0, 200) }
    } catch (e) {
      const msg = (e && e.message) || String(e)
      await registrarFollowupEnvio(numero, {
        modo,
        instrucao_snippet: snippetInstr,
        mensagem_preview: null,
        envio_ok: false,
        erro: msg,
      })
      throw e
    }
  }

  return {
    perfilResumidoParaFollowup,
    formatarIntervaloAproximadoPt,
    contextoTempoFollowup,
    textoBlocoContextoTempoFollowup,
    textoBlocoPrecificacaoFollowup,
    chamarClaudeFollowup,
    executarFollowupUmNumero,
  }
}

module.exports = { createFollowupExecution }
