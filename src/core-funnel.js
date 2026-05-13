'use strict'

const { FOLLOWUP_SNIPPET_MAX_CHARS } = require('./config')
const {
  sanitizarMencoesPessoaParaEquipe,
  sanitizarTermosInternosParaLead,
  textoContemPrecoParaLead,
} = require('./institutional-language')

function perfilIndicaProjetoSobMedida(perfil = {}, resultado = null) {
  const partes = [
    perfil?.plano,
    perfil?.plano_sugerido,
    perfil?.produto_sugerido,
    perfil?.tipo_projeto,
    perfil?.servico_principal,
    perfil?.servico_foco,
    resultado?.atualizar_perfil?.plano_sugerido,
    resultado?.atualizar_perfil?.produto_sugerido,
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const rp = perfil?.reuniao_proposta || resultado?.atualizar_perfil?.reuniao_proposta || {}
  return Boolean(
    perfil?.projeto_sob_medida === true ||
    perfil?.sob_medida === true ||
    perfil?.precisa_sistema === true ||
    resultado?.atualizar_perfil?.projeto_sob_medida === true ||
    resultado?.atualizar_perfil?.precisa_sistema === true ||
    rp?.necessaria === true ||
    /\b(personalizado|personalizada|sob\s*medida|projeto_sob_medida|site\s+personalizado|sistema|automacao|automatizacao|agente\s+de\s+ia|ia|painel|dashboard|integracao|escopo|proposta\s+personalizada)\b/.test(partes)
  )
}

function createCoreFunnel(deps = {}) {
  const {
    logger,
    pool,
    normalizarHistoricoMensagens,
    buscarConversa,
    buscarPerfil,
    garantirConcorrentesReaisNoPerfil,
    diagnosticoCompletoParaPreco,
    calcularPreco,
    atualizarPerfil,
    chamarClaude,
    historicoCresceuSoComUsers,
    aplicarGuardrailReuniaoProposta,
    buscarSlotsDisponiveis,
    sanitizarPlaceholderEmpresaNaSaidaTexto,
    sanitizarCpfNaSaidaTexto,
    enviarPrintLocal,
    filtrarLinksSugeridosParaEnvio,
    enviarComBotoes,
    enviarMensagem,
    enviarSequenciaMensagens,
    extrairValoresReaisDoTextoBrasil,
    registrarEventoComercial,
    gerarEEnviarPreviewSite,
    salvarConversa,
    limparFalhaResposta,
    persistirAgendamentoFollowupExplicito,
    atualizarCamadaMemoriaVendasPosResposta,
    registrarLacunaConhecimento,
    alertarLacunaConhecimento,
    marcarFechada,
    alertarVendaFechadaOperadores,
    gerarAprendizado,
    notificarVictorWhatsapp,
    alertarHandoff,
    decidirProximaResposta,
    podeGerarRespostaAutomatica,
    parsearHorarioReuniao,
    calcularFimReuniao,
    dataInicioReuniao,
  } = deps

  const MOTIVOS_HANDOFF = [
    'lead_pediu_humano',
    'mencionou_pagamento',
    'objecao_repetida_2x',
    'fora_do_icp',
    'ja_tem_site',
    'termometro_baixo_persistente',
    'conversa_longa_sem_avanco',
    'mencao_juridica',
    'aceitou_proposta',
    'roi_baixo_complexidade_alta',
    'pediu_funcionalidade_fora_catalogo',
    'pediu_desconto_fora_padrao',
    'coleta_incompleta',
    'aprovacao_valor',
    'agendou_reuniao_proposta',
    'proposta_personalizada',
  ]
  
  function normalizarMotivoHandoff(raw) {
    if (raw == null || raw === '') return null
    const s = String(raw).trim()
    if (MOTIVOS_HANDOFF.includes(s)) return s
    logger.warn('⚠️ motivo_handoff fora do enum, usando lead_pediu_humano:', raw)
    return 'lead_pediu_humano'
  }
  
  function historicoComInstrucaoOperadorParaClaude(historico, instrucao) {
    const ins = typeof instrucao === 'string' ? instrucao.trim() : ''
    if (!ins) return historico
    const h = normalizarHistoricoMensagens(historico)
    if (!h.length) return h
    const last = h[h.length - 1]
    if (!last || last.role !== 'user') return h
    const base =
      typeof last.content === 'string' ? last.content : String(last.content ?? '')
    const nota =
      `\n\n---\nDirecionamento do operador (não envie este bloco ao lead; integre o foco na resposta JSON):\n${ins}`
    return [...h.slice(0, -1), { role: 'user', content: `${base}${nota}` }]
  }

  function resultadoBase(overrides = {}) {
    return {
      mensagem_pro_lead: '',
      mensagens_bolhas: null,
      atualizar_perfil: {},
      etapa_proxima: null,
      solicitar_calculo_preco: false,
      solicitar_classificacao_nicho: false,
      handoff: false,
      motivo_handoff: null,
      links_sugeridos: [],
      registrar_lacuna: false,
      tema_lacuna: '',
      detalhe_lacuna: '',
      resumo_handoff: null,
      enviar_print: null,
      caption_print: null,
      solicitar_preview_site: false,
      preview_site_modelo: null,
      agendar_followup_auto: null,
      project_handoff: null,
      ...overrides,
    }
  }

  async function resultadoAgendaPorDecisao(decisao, perfil, estagioLive, historico) {
    if (!decisao || !decisao.deve_sobrescrever_modelo) return null
    if (decisao.resultado) return resultadoBase(decisao.resultado)
    if (decisao.proxima_acao === 'reagendar') {
      const slots = typeof buscarSlotsDisponiveis === 'function'
        ? await buscarSlotsDisponiveis({ dataInicial: new Date(), quantidade: 2 })
        : null
      const horarios = Array.isArray(slots?.horarios_sugeridos) ? slots.horarios_sugeridos.filter(Boolean) : []
      const label = slots?.data_label || 'amanha'
      const frase = decisao.prioridade_aplicada === 'dados_minimos_coletados'
        ? (horarios.length > 1
          ? `Com essas informacoes, o ideal e uma conversa rapida com a equipe da PJ Codeworks para entender o escopo e te apresentar estrutura, prazo e investimento.\n\nTenho ${label} as ${horarios[0]} ou ${horarios[1]} disponiveis. Qual fica melhor?`
          : `Com essas informacoes, o ideal e uma conversa rapida com a equipe da PJ Codeworks para entender o escopo e te apresentar estrutura, prazo e investimento.\n\nPosso verificar os proximos horarios disponiveis?`)
        : horarios.length > 1
        ? `Sem problema. Posso remarcar. Tenho ${label} às ${horarios[0]} ou ${horarios[1]}. Qual fica melhor?`
        : `Sem problema. Posso remarcar. Tenho ${label} às ${horarios[0] || '20:15'}. Fica bom pra você?`
      return resultadoBase({
        mensagem_pro_lead: frase,
        atualizar_perfil: {
          intencao_principal: decisao.interpretacao.intencao_principal,
          estado_comercial: decisao.estado_comercial,
          reuniao_proposta: {
            ...((perfil && perfil.reuniao_proposta) || {}),
            necessaria: true,
            data_sugerida: slots?.data_sugerida || null,
            horarios_sugeridos: horarios,
            horario_confirmado: null,
          },
        },
        etapa_proxima: 'agendamento_pendente',
      })
    }
    if (decisao.proxima_acao === 'consultar_agenda_e_oferecer_horarios') {
      const slots = typeof buscarSlotsDisponiveis === 'function'
        ? await buscarSlotsDisponiveis({ dataInicial: new Date(), quantidade: 2 })
        : null
      const horarios = Array.isArray(slots?.horarios_sugeridos) ? slots.horarios_sugeridos.filter(Boolean) : []
      const label = slots?.data_label || 'em um próximo horário'
      const frase = horarios.length > 1
        ? `Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks te mostra estrutura, prazo e investimento na reunião, sem chute.\n\nTenho ${label} às ${horarios[0]} ou ${horarios[1]} disponíveis. Qual fica melhor?`
        : `Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks analisa o escopo, entende o objetivo e te mostra estrutura, prazo e investimento na reunião.\n\nPosso marcar uma conversa rápida de até 15 minutos com a equipe?`
      return resultadoBase({
        mensagem_pro_lead: frase,
        atualizar_perfil: {
          intencao_principal: decisao.interpretacao.intencao_principal,
          estado_comercial: decisao.estado_comercial,
          projeto_sob_medida: true,
          eventos_conversa: { perguntou_preco: true },
          reuniao_proposta: {
            ...((perfil && perfil.reuniao_proposta) || {}),
            necessaria: true,
            data_sugerida: slots?.data_sugerida || null,
            horarios_sugeridos: horarios,
            horario_confirmado: null,
            duracao_maxima_minutos: 15,
          },
        },
        etapa_proxima: 'agendamento_pendente',
        solicitar_calculo_preco: false,
        resumo_handoff: perfil?.preco_calculado
          ? `Valor interno para referencia da equipe: R$ ${perfil.preco_calculado}. Nao foi informado ao lead.`
          : null,
      })
    }
    if (decisao.proxima_acao === 'confirmar_reuniao') {
      const parsed = typeof parsearHorarioReuniao === 'function'
        ? parsearHorarioReuniao(decisao.interpretacao?.dados_extraidos?.horario || '')
        : null
      const horario = parsed?.normalizado || decisao.interpretacao?.dados_extraidos?.horario
      const reuniao = (perfil && typeof perfil.reuniao_proposta === 'object') ? perfil.reuniao_proposta : {}
      const dataSugerida = reuniao.data_sugerida || reuniao.data_confirmada || null
      const fim = typeof calcularFimReuniao === 'function' && horario ? calcularFimReuniao(horario) : null
      const dataInicio = typeof dataInicioReuniao === 'function' && dataSugerida && horario
        ? dataInicioReuniao(dataSugerida, horario)
        : null
      return resultadoBase({
        mensagem_pro_lead: `Perfeito. Reunião marcada para ${dataSugerida || 'a data combinada'} às ${horario} com a equipe da PJ Codeworks. Vai ser uma conversa rápida, de até 15 minutos, para alinhar estrutura, prazo e investimento.\n\nPra deixar tudo organizado para a equipe, qual melhor e-mail para contato?`,
        atualizar_perfil: {
          intencao_principal: decisao.interpretacao.intencao_principal,
          estado_comercial: decisao.estado_comercial,
          reuniao_proposta: {
            ...reuniao,
            necessaria: true,
            horario_confirmado: horario,
            data_sugerida: dataSugerida,
            data_inicio: dataInicio ? dataInicio.toISOString() : null,
            duracao_maxima_minutos: 15,
          },
        },
        etapa_proxima: 'reuniao_agendada',
        handoff: true,
        motivo_handoff: 'agendou_reuniao_proposta',
        resumo_handoff: `Lead confirmou reunião com a equipe da PJ Codeworks para ${dataSugerida || 'data sugerida'} às ${horario}. Estágio: ${estagioLive}. Intenção: escolha_horario. Valor interno para referencia da equipe: ${perfil?.preco_calculado ? `R$ ${perfil.preco_calculado}` : 'não calculado'}. Não foi informado ao lead.`,
      })
    }
    return null
  }
  
  /**
   * Histórico já deve estar persistido terminando em mensagem do user.
   * Só grava a resposta do assistente no BD depois do envio ao WhatsApp (permite reprocessar se falhar antes).
   * @param {null|{ instrucaoOperador?: string }} [opcoes] — instrução do dashboard; enriquece só o input do Claude.
   * @returns {Promise<{ destino: string, trecho_resposta: string }|{ stale: true }>}
   */
  async function gerarEEnviarRespostaWhatsapp(
    numero,
    historicoBruto,
    estagio,
    conversa,
    visaoUltimaMensagem = null,
    opcoes = null
  ) {
    const conversaLive = await buscarConversa(numero)
    const historico = normalizarHistoricoMensagens(conversaLive?.historico ?? historicoBruto)
    const estagioLive = conversaLive?.estagio || estagio || 'primeiro_contato'
    const conversaUsada = conversaLive || conversa
    let respostaEnviadaAoLead = false
  
    if (typeof podeGerarRespostaAutomatica === 'function' && !podeGerarRespostaAutomatica({ ...conversaUsada, historico })) {
      logger.info(`Resposta automatica bloqueada: ultima mensagem nao e lead real (${numero})`)
      return { skipped: true, reason: 'ultima_mensagem_nao_lead_real' }
    }
    const ultima = historico[historico.length - 1]
    if (!ultima || ultima.role !== 'user') {
      throw new Error('Última mensagem do histórico deve ser do usuário')
    }
    let perfil = await buscarPerfil(numero)
    if (!perfil.numero) perfil = { ...perfil, numero }
  
    // Enriquece perfil com concorrentes reais via Google CSE (1x por lead, idempotente).
    // No-op se GOOGLE_CSE_KEY/ID não configurados ou se o perfil já tem concorrentes.
    // Fica fora do caminho crítico: se falhar, a conversa segue sem concorrentes reais.
    try {
      const reais = await garantirConcorrentesReaisNoPerfil(numero, perfil)
      if (Array.isArray(reais) && reais.length > 0 && (!perfil.concorrentes || perfil.concorrentes.length === 0)) {
        perfil = { ...perfil, concorrentes: reais }
      }
    } catch (_) { /* defensivo */ }
  
    // Pre-calcula o preço antes de chamar o Claude para que ele já tenha precificacao_json
    // disponível apenas para decisão interna e handoff, nunca para projeto sob medida.
    if (diagnosticoCompletoParaPreco(perfil) && !perfil.preco_calculado) {
      try {
        const preco = calcularPreco(perfil)
        const aplicadoPrecoAntecipado = await atualizarPerfil(numero, {
          preco_calculado: preco.total,
          entrada: preco.entrada,
          parcela: preco.parcela,
          precificacao_json: preco.precificacao_json,
        })
        perfil = { ...perfil, ...preco, ...aplicadoPrecoAntecipado }
        logger.info(
          `💰 [pre-calc] Plano: ${preco.precificacao_json.plano_recomendado} | ROI: ${preco.precificacao_json.roi_score} | R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})`
        )
      } catch (e) {
        logger.warn('⚠️ Pre-cálculo de preço falhou:', e.message)
      }
    }
  
    const instr =
      opcoes && typeof opcoes === 'object' && typeof opcoes.instrucaoOperador === 'string'
        ? opcoes.instrucaoOperador.trim()
        : ''
    const historicoParaClaude = instr
      ? historicoComInstrucaoOperadorParaClaude(historico, instr)
      : historico
  
    const historicoPreClaudeLen = historico.length
    let resultado
    const textoUltimaMensagem =
      typeof ultima.content === 'string' ? ultima.content : String(ultima.content || '')
    const decisao = typeof decidirProximaResposta === 'function'
      ? decidirProximaResposta({
        texto: textoUltimaMensagem,
        perfil,
        estagio: estagioLive,
        historico,
      })
      : null
    const resultadoDireto = await resultadoAgendaPorDecisao(decisao, perfil, estagioLive, historico)
    if (resultadoDireto && decisao?.deve_sobrescrever_modelo) {
      resultado = resultadoDireto
      logger.info(`decisao intencao/contexto aplicada antes do modelo: ${decisao.proxima_acao}`)
    } else {
    try {
      resultado = await chamarClaude(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
        stale_retry: opcoes?.stale_retry === true,
      })
    } catch (parseErr) {
      if (/mensagem utilizável|JSON válido com mensagem/i.test(parseErr.message) && !opcoes?.parse_retry) {
        logger.warn(`⚠️ modelo_parse — retry com max_tokens=4000 para ${numero}`)
        resultado = await chamarClaude(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
          stale_retry: opcoes?.stale_retry === true,
          max_tokens_override: 4000,
          parse_retry: true,
        })
      } else {
        throw parseErr
      }
    }
    }
  
    if (!resultadoDireto) {
      const conversaPosClaude = await buscarConversa(numero)
      const historicoPos = normalizarHistoricoMensagens(conversaPosClaude?.historico || [])
      if (historicoCresceuSoComUsers(historicoPreClaudeLen, historicoPos)) {
        return { stale: true }
      }
    }
  
    resultado = await aplicarGuardrailReuniaoProposta(resultado, perfil, new Date(), buscarSlotsDisponiveis ?? null)
  
    if (Object.keys(resultado.atualizar_perfil || {}).length > 0) {
      const aplicadoPerfil = await atualizarPerfil(numero, resultado.atualizar_perfil)
      perfil = { ...perfil, ...aplicadoPerfil }
    }
  
    const motivoNorm = normalizarMotivoHandoff(resultado.motivo_handoff)
  
    // Permite recalcular quando o bot muda explicitamente de plano via atualizar_perfil
    const planoMudou =
      resultado.atualizar_perfil?.plano_sugerido &&
      resultado.atualizar_perfil.plano_sugerido !== perfil.precificacao_json?.plano_recomendado
  
    const podeCalcularPreco =
      diagnosticoCompletoParaPreco(perfil) &&
      (!perfil.preco_calculado || planoMudou) &&
      resultado.solicitar_calculo_preco !== false
  
    let precoCalculadoNestaResposta = null
    if (podeCalcularPreco) {
      const preco = calcularPreco(perfil)
      precoCalculadoNestaResposta = preco
      const aplicadoPreco = await atualizarPerfil(numero, {
        preco_calculado: preco.total,
        entrada: preco.entrada,
        parcela: preco.parcela,
        precificacao_json: preco.precificacao_json,
      })
      perfil = { ...perfil, ...preco, ...aplicadoPreco }
      logger.info(
        `💰 Plano: ${preco.precificacao_json.plano_recomendado} | ROI: ${preco.precificacao_json.roi_score} | R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})`
      )
    }

    if (perfilIndicaProjetoSobMedida(perfil, resultado)) {
      const textoLead = [
        resultado.mensagem_pro_lead || '',
        ...(Array.isArray(resultado.mensagens_bolhas) ? resultado.mensagens_bolhas : []),
      ].join('\n')
      if (textoContemPrecoParaLead(textoLead)) {
        const slots = typeof buscarSlotsDisponiveis === 'function'
          ? await buscarSlotsDisponiveis({ dataInicial: new Date(), quantidade: 2 })
          : null
        const horarios = Array.isArray(slots?.horarios_sugeridos) ? slots.horarios_sugeridos.filter(Boolean) : []
        const label = slots?.data_label || 'em um próximo horário'
        resultado.mensagem_pro_lead = horarios.length > 1
          ? `Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks te mostra estrutura, prazo e investimento na reunião, sem chute.\n\nTenho ${label} às ${horarios[0]} ou ${horarios[1]} disponíveis. Qual fica melhor?`
          : `Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks analisa o escopo, entende o objetivo e te mostra estrutura, prazo e investimento na reunião.\n\nPosso marcar uma conversa rápida de até 15 minutos com a equipe?`
        resultado.mensagens_bolhas = null
        resultado.solicitar_calculo_preco = false
        resultado.etapa_proxima = 'agendamento_pendente'
        resultado.atualizar_perfil = {
          ...(resultado.atualizar_perfil || {}),
          projeto_sob_medida: true,
          eventos_conversa: {
            ...((resultado.atualizar_perfil && resultado.atualizar_perfil.eventos_conversa) || {}),
            perguntou_preco: true,
          },
          reuniao_proposta: {
            ...((perfil && perfil.reuniao_proposta) || {}),
            ...((resultado.atualizar_perfil && resultado.atualizar_perfil.reuniao_proposta) || {}),
            necessaria: true,
            data_sugerida: slots?.data_sugerida || resultado.atualizar_perfil?.reuniao_proposta?.data_sugerida || null,
            horarios_sugeridos: horarios.length ? horarios : (resultado.atualizar_perfil?.reuniao_proposta?.horarios_sugeridos || []),
            horario_confirmado: null,
            duracao_maxima_minutos: 15,
          },
        }
        resultado.resumo_handoff = [
          resultado.resumo_handoff,
          perfil?.preco_calculado ? `Valor interno para referencia da equipe: R$ ${perfil.preco_calculado}. Nao foi informado ao lead.` : null,
        ].filter(Boolean).join('\n')
        const aplicadoPerfilSobMedida = await atualizarPerfil(numero, resultado.atualizar_perfil)
        perfil = { ...perfil, ...aplicadoPerfilSobMedida }
      }
    }
  
    const textoRespostaBruto = (resultado.mensagem_pro_lead || '').trim()
    if (!textoRespostaBruto) {
      throw new Error('Modelo retornou mensagem vazia para o lead')
    }
    const textoResposta = sanitizarTermosInternosParaLead(
      sanitizarMencoesPessoaParaEquipe(
        sanitizarPlaceholderEmpresaNaSaidaTexto(
          sanitizarCpfNaSaidaTexto(textoRespostaBruto)
        )
      )
    )
  
    const bolhasSanitizadas =
      Array.isArray(resultado.mensagens_bolhas) && resultado.mensagens_bolhas.length > 0
        ? resultado.mensagens_bolhas
            .map((x) => sanitizarTermosInternosParaLead(
              sanitizarMencoesPessoaParaEquipe(
                sanitizarPlaceholderEmpresaNaSaidaTexto(sanitizarCpfNaSaidaTexto(String(x || '').trim()))
              )
            ))
            .filter((x) => x.length > 0)
        : null
  
    if (typeof resultado.enviar_print === 'string' && resultado.enviar_print.trim()) {
      const captionPrint = typeof resultado.caption_print === 'string' && resultado.caption_print.trim()
        ? resultado.caption_print.trim()
        : ''
      await enviarPrintLocal(numero, resultado.enviar_print.trim(), captionPrint).catch(
        (e) => logger.error('❌ enviar_print falhou:', e.message)
      )
    }
  
    const linksExtra = filtrarLinksSugeridosParaEnvio(resultado.links_sugeridos, textoResposta)
    const textoHistoricoAssist =
      linksExtra.length > 0 ? `${textoResposta}\n\n${linksExtra.join('\n')}` : textoResposta
  
    let historicoNovo = [...historico, { role: 'assistant', content: textoHistoricoAssist }]
    if (historicoNovo.length > 40) historicoNovo = historicoNovo.slice(-40)
  
    const precisaHandoff = !!resultado.handoff
    const novoStatus = precisaHandoff ? 'aguardando_handoff' : (conversaUsada?.status || 'ativo')
  
    /**
     * Se motivo é aprovacao_valor, NÃO enviar a mensagem ao lead agora.
     * A mensagem fica salva no histórico mas o envio real ao WhatsApp é bloqueado.
     * O Victor recebe o preview e, ao aprovar, o operador envia manualmente ou retoma.
     */
    const reterMensagemParaAprovacao = precisaHandoff && motivoNorm === 'aprovacao_valor'
  
    if (!reterMensagemParaAprovacao) {
      const botoes = extrairBotoes(textoRespostaBruto)
      const bolhasModelo = bolhasSanitizadas && bolhasSanitizadas.length > 0
  
      if (botoes) {
        await enviarComBotoes(numero, textoResposta, botoes)
        if (linksExtra.length > 0) {
          await enviarMensagem(numero, linksExtra.join('\n'))
        }
      } else if (bolhasModelo) {
        await enviarSequenciaMensagens(numero, bolhasSanitizadas)
        if (linksExtra.length > 0) {
          await enviarMensagem(numero, linksExtra.join('\n'))
        }
      } else {
        const partesHeur = dividirTextoPorQuebrasHeuristico(textoResposta)
        if (partesHeur.length > 1) {
          await enviarSequenciaMensagens(numero, partesHeur)
          if (linksExtra.length > 0) {
            await enviarMensagem(numero, linksExtra.join('\n'))
          }
        } else {
          await enviarMensagem(numero, textoHistoricoAssist)
        }
      }
      respostaEnviadaAoLead = true
      const precoEvento = precoCalculadoNestaResposta || (
        perfil && perfil.preco_calculado
          ? { total: perfil.preco_calculado, entrada: perfil.entrada, parcela: perfil.parcela }
          : null
      )
      if (precoEvento && extrairValoresReaisDoTextoBrasil(textoHistoricoAssist).length > 0) {
        await registrarEventoComercial(numero, 'recebeu_proposta', {
          total: Number(precoEvento.total) || null,
          entrada: Number(precoEvento.entrada) || null,
          parcela: Number(precoEvento.parcela) || null,
          etapa: resultado.etapa_proxima || estagioLive,
        })
      }
      if (resultado.solicitar_preview_site) {
        const jaRecebeu = await pool.query(
          'SELECT 1 FROM vendas.eventos_comerciais WHERE numero = $1 AND tipo = $2 LIMIT 1',
          [numero, 'recebeu_preview']
        )
        if (jaRecebeu.rows.length > 0) {
          logger.info(`⚠️ Preview ja enviado para este lead — ignorando solicitar_preview_site`)
        } else {
          try {
            const imagensPreview = visaoUltimaMensagem ? [visaoUltimaMensagem] : []
            await gerarEEnviarPreviewSite(numero, perfil, historico, {
              modelo: resultado.preview_site_modelo || perfil?.plano_sugerido || null,
              imagens: imagensPreview,
            })
          } catch (e) {
            logger.error('Preview de site falhou:', e.response?.data || e.message)
            await enviarMensagem(
              numero,
              'Tentei montar a previa visual agora, mas nao consegui gerar a imagem nesse momento. Vamos continuar a conversa normalmente.'
            ).catch(() => {})
          }
        }
      }
    } else {
      logger.info(`⏸️  Mensagem retida (aprovacao_valor) — aguardando OK do Operador`)
      respostaEnviadaAoLead = false
    }
    try {
      logger.info(`✉️  [${resultado.etapa_proxima || estagioLive}] Resposta enviada`)
  
      await salvarConversa(numero, historicoNovo, resultado.etapa_proxima || estagioLive, novoStatus)
      await limparFalhaResposta(numero)
  
      if (respostaEnviadaAoLead && !precisaHandoff && resultado.agendar_followup_auto) {
        try {
          await persistirAgendamentoFollowupExplicito(
            numero,
            resultado.agendar_followup_auto,
            resultado.etapa_proxima || estagioLive
          )
        } catch (e) {
          logger.error('Erro ao agendar follow-up explicito:', e.message)
        }
      }
  
      try {
        await atualizarCamadaMemoriaVendasPosResposta(
          numero,
          historicoNovo,
          perfil,
          resultado.etapa_proxima || estagioLive,
          textoHistoricoAssist
        )
      } catch (e) {
        logger.warn('⚠️ Camada memória vendas:', e.message)
      }
  
      if (
        resultado.registrar_lacuna &&
        (resultado.tema_lacuna || resultado.detalhe_lacuna)
      ) {
        try {
          const lacunaId = await registrarLacunaConhecimento(
            numero,
            resultado.tema_lacuna,
            resultado.detalhe_lacuna
          )
          if (lacunaId != null) {
            const temaAlerta = resultado.tema_lacuna?.trim() || 'geral'
            const detAlerta =
              resultado.detalhe_lacuna?.trim() || resultado.tema_lacuna?.trim() || ''
            await alertarLacunaConhecimento(numero, temaAlerta, detAlerta)
            logger.info(`📌 Lacuna de conhecimento registrada (id ${lacunaId})`)
          }
        } catch (e) {
          logger.error('❌ Lacuna de conhecimento:', e.message)
        }
      }
  
      if (precisaHandoff && motivoNorm === 'aceitou_proposta') {
        await marcarFechada(numero)
        await alertarVendaFechadaOperadores(numero, perfil, {
          total: perfil.preco_calculado || 0,
          entrada: perfil.entrada || 0,
          parcela: perfil.parcela || 0,
        }, resumoHandoff)
        logger.info(`🎉 Venda fechada (aceitou_proposta): ${numero}`)
        gerarAprendizado().catch(e => logger.error('Aprendizado erro:', e.message))
      }
  
      if (precisaHandoff && motivoNorm === 'aprovacao_valor') {
        const preco = {
          total:   perfil.preco_calculado || 0,
          entrada: perfil.entrada || 0,
          parcela: perfil.parcela || 0,
        }
        const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
        const previewValor =
          `[PREVIEW DE VALOR — AGUARDANDO APROVAÇÃO]\n` +
          `Lead: ${phone} | ${perfil.negocio || '?'} — ${perfil.cidade || '?'}\n` +
          `Plano sugerido: ${perfil.plano_sugerido || '?'}\n` +
          (preco.total > 0
            ? `Valor total: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
            : `Valor: a calcular\n`) +
          `Temperatura: ${perfil.temperatura_lead || '?'} | Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10\n` +
          `✅ Responda OK para confirmar e eu envio ao lead, ou ajuste o valor.`
        await notificarVictorWhatsapp(previewValor)
        logger.info(`💬 Preview de valor enviado aos operadores para aprovação: ${phone}`)
      }
  
      if (precisaHandoff) {
        const preco = {
          total:   perfil.preco_calculado || 0,
          entrada: perfil.entrada || 0,
          parcela: perfil.parcela || 0,
        }
        const resumoHandoff = typeof resultado.resumo_handoff === 'string' && resultado.resumo_handoff.trim()
          ? resultado.resumo_handoff.trim()
          : null
        await alertarHandoff(numero, perfil, preco, motivoNorm || 'handoff', resumoHandoff, {
          resultado,
        })
      }
  
      const destino = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
      return {
        destino,
        trecho_resposta: textoHistoricoAssist.slice(0, 200),
        texto_metrica_followup: textoHistoricoAssist.slice(0, FOLLOWUP_SNIPPET_MAX_CHARS),
      }
    } catch (err) {
      if (respostaEnviadaAoLead) err.leadMessageSent = true
      throw err
    }
  }
  
  // ─── WEBHOOK ──────────────────────────────────────────────────────────────────
  
  /** Chave estável por mensagem WhatsApp (Evolution pode reenviar o mesmo evento). */
  
  function extrairBotoes(texto) {
    const fraseCurta = texto.match(/\b(pix|cartão|segunda|quinta|suporte|crescimento|essa semana|semana que vem|entrada|parcel\w+)\b.{0,30}\bou\b.{0,30}\b(pix|cartão|segunda|quinta|suporte|crescimento|essa semana|semana que vem|entrada|parcel\w+)\b/i)
    if (fraseCurta) {
      const partes = fraseCurta[0].split(/\bou\b/i)
      if (partes.length === 2) {
        const op1 = partes[0].trim().replace(/[^a-zA-ZÀ-ú\s]/g, '').trim().substring(0, 20)
        const op2 = partes[1].trim().replace(/[^a-zA-ZÀ-ú\s]/g, '').trim().substring(0, 20)
        if (op1.length > 2 && op2.length > 2) return [op1, op2]
      }
    }
    return null
  }
  
  
  function dividirTextoPorQuebrasHeuristico(texto) {
    const MAX_MENSAGENS_BOLHAS = 4
    const t = (texto || '').trim()
    if (!t) return []
    const raw = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
    if (raw.length <= 1) return [t]
    return raw.slice(0, MAX_MENSAGENS_BOLHAS)
  }

  return {
    normalizarMotivoHandoff,
    historicoComInstrucaoOperadorParaClaude,
    gerarEEnviarRespostaWhatsapp,
    extrairBotoes,
    dividirTextoPorQuebrasHeuristico,
  }
}

module.exports = { createCoreFunnel }
