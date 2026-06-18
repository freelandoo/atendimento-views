'use strict'

function registerWebhookRoute(app, deps = {}) {
  const {
    webhookAutorizado,
    gerarRequestIdAnthropic,
    loggerForWebhook,
    logger,
    canonicoRemoteJidParaConversa,
    listarOperadoresAtivos,
    jidIgual,
    processarComandosOperadorChat,
    isConversaLeadUmAUm,
    processarIntervencaoOperadorNoLead,
    tratarPossivelReuniaoOperador,
    construirChaveIdempotenciaWebhookMensagem,
    webhookMensagemDeveSerProcessada,
    extrairTextoEMidiaDoWebhook,
    buscarConversa,
    normalizarHistoricoMensagens,
    marcarProspectComoRespondeuPorNumero,
    buscarContextoProspeccao,
    textoEhAutoReplyWhatsApp,
    atualizarPerfil,
    salvarConversa,
    cancelarFollowupsAutoPendentes,
    textoPedePreco,
    registrarEventoComercial,
    marcarRespostaFollowupSeAplicavel,
    serializeError,
    obterEstadoDebounceResposta,
    textoJaProcessadoRecentemente,
    enfileirarJobRespostaWebhook,
    registrarRespostaLembreteReuniao,
    podeGerarRespostaAutomatica,
  } = deps

  app.post('/webhook', async (req, res) => {
      if (!webhookAutorizado(req)) {
        return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
      }
      const requestId = gerarRequestIdAnthropic()
      let webhookLog = loggerForWebhook({ request_id: requestId })
      res.json({ ok: true })
    
      try {
        const event = req.body?.event
        webhookLog = webhookLog.child({ event })
        if (event !== 'messages.upsert') return
    
        const msg = req.body?.data?.messages?.[0] || req.body?.data
        if (!msg) return
    
        const remoteJidOriginal = msg.key?.remoteJid
        if (!isConversaLeadUmAUm(remoteJidOriginal)) {
          webhookLog.info({ remote_jid: remoteJidOriginal }, 'Webhook ignorado: conversa nao e 1:1 com lead')
          return
        }

        const numero = canonicoRemoteJidParaConversa(msg.key) || remoteJidOriginal
        if (!numero) return
        webhookLog = webhookLog.child({ numero })
        if (/@lid$/i.test(numero) && !msg.key?.remoteJidAlt) {
          webhookLog.warn(
            '⚠️ Webhook: conversa só com @lid e sem remoteJidAlt — atualize a Evolution API ou aguarde evento com JID de telefone; comandos/DB podem falhar.'
          )
        }
    
        const fromMe = !!msg.key?.fromMe
    
        // Verifica se o remetente é qualquer operador autorizado (suporta lista separada por vírgula)
        const operadoresAtivos = await listarOperadoresAtivos()
        const jidRemetente = operadoresAtivos.find(op => jidIgual(numero, op.jid))?.jid ?? null
        if (jidRemetente && !fromMe) {
          await processarComandosOperadorChat(msg, jidRemetente)
          return
        }
    
        if (fromMe) {
          if (isConversaLeadUmAUm(numero)) {
            await processarIntervencaoOperadorNoLead(msg, numero)
            // #4: o operador pode ter fechado uma reuniao nesta mensagem.
            if (typeof tratarPossivelReuniaoOperador === 'function') {
              await tratarPossivelReuniaoOperador(numero).catch((err) =>
                webhookLog.warn({ err: serializeError(err) }, '#4 tratarPossivelReuniaoOperador falhou (operador)')
              )
            }
          }
          return
        }
    
        const chaveEvt = construirChaveIdempotenciaWebhookMensagem(msg)
        if (!(await webhookMensagemDeveSerProcessada(chaveEvt, numero))) {
          webhookLog.info({ dedupe_key: chaveEvt }, 'Webhook ignorado por duplicata')
          return
        }

        const { texto, visao } = await extrairTextoEMidiaDoWebhook(msg)
        if (!texto && !visao) return

        // ── TRAVA 1: auto-reply do WhatsApp Business (vale para qualquer lead) ──────────
        // Detectado antes de salvar histórico, cancelar follow-ups ou criar job.
        // Follow-ups pendentes permanecem ativos: auto-reply não é resposta real do lead.
        if (texto && textoEhAutoReplyWhatsApp(texto)) {
          webhookLog.info({ trecho: texto.slice(0, 120) }, 'Auto-reply WhatsApp Business detectado — mensagem ignorada, sem job')
          await registrarEventoComercial(numero, 'auto_reply_detectado', { trecho: texto.slice(0, 200) }).catch(() => {})
          return
        }

        // ── TRAVA 2: dedupe por conteúdo normalizado + janela de 5 min ───────────────────
        // Captura loops onde diferentes message_ids chegam com o mesmo texto em sequência.
        if (texto && typeof textoJaProcessadoRecentemente === 'function' && textoJaProcessadoRecentemente(numero, texto)) {
          webhookLog.info({ trecho: texto.slice(0, 120) }, 'Conteúdo já processado recentemente — mensagem deduplicada')
          return
        }

        const textoHistorico = texto || '(Cliente enviou conteúdo de mídia.)'
        const logLinha = textoHistorico.length > 200 ? `${textoHistorico.slice(0, 200)}…` : textoHistorico
        webhookLog.info({ tem_imagem: !!visao, trecho: logLinha }, 'Mensagem recebida no webhook')
    
        let conversa = await buscarConversa(numero)
        let historico = normalizarHistoricoMensagens(conversa?.historico)
        let estagio = conversa?.estagio || 'primeiro_contato'
        let perfilProspeccaoPatch = null
    
        // Best-effort: marca o prospect como 'respondeu' (efeito colateral). NÃO
        // gateia a identificação — antes, se isto falhasse/não casasse, o lead
        // prospectado nunca era reconhecido. A identificação roda independente.
        await marcarProspectComoRespondeuPorNumero(numero).catch((e) => {
          webhookLog.warn({ err: serializeError ? serializeError(e) : String(e) }, 'marcarProspectComoRespondeuPorNumero falhou')
        })
        // Identificação: se o número casa um prospect enviado/respondeu, é lead prospectado.
        const contextoProspeccao = await buscarContextoProspeccao(numero).catch((e) => {
          webhookLog.warn({ err: serializeError ? serializeError(e) : String(e) }, 'buscarContextoProspeccao falhou')
          return null
        })
        if (contextoProspeccao?.prospect) {
          const p = contextoProspeccao.prospect
          const d = contextoProspeccao.diagnostico || {}
          const fila = contextoProspeccao.fila || {}
          const contextoVendas = contextoProspeccao.contexto_vendas || {}
          const mensagemEnviadaProspeccao = contextoVendas.mensagem_enviada || contextoProspeccao.mensagem_enviada || d.mensagem_editada || d.mensagem_gerada || fila.mensagem_editada || fila.mensagem_gerada || ''
          const autoReplyDetectado = textoEhAutoReplyWhatsApp(textoHistorico)
          const contextoPerfilProspeccao = {
            prospect_id: p.id || contextoVendas.prospect_id || null,
            nome: contextoVendas.nome || p.nome || '',
            nicho: contextoVendas.nicho || p.nicho || '',
            categoria: contextoVendas.categoria || contextoVendas.nicho || p.nicho || '',
            cidade: contextoVendas.cidade || p.cidade || '',
            estado: contextoVendas.estado || '',
            endereco: contextoVendas.endereco || p.endereco || '',
            regiao_atendimento: contextoVendas.regiao_atendimento || '',
            telefone: contextoVendas.telefone || p.telefone || '',
            tem_site: !!(contextoVendas.tem_site || p.tem_site),
            site: contextoVendas.site || p.site || '',
            maps_url: contextoVendas.maps_url || p.maps_url || '',
            place_id: contextoVendas.place_id || p.place_id || '',
            rating: contextoVendas.rating ?? p.rating ?? null,
            avaliacoes: contextoVendas.avaliacoes ?? p.avaliacoes ?? null,
            score: contextoVendas.score ?? p.score ?? null,
            motivo_score: contextoVendas.motivo_score || p.motivo_score || '',
            fila_id: fila.id || contextoVendas.fila_id || null,
            slot_envio: fila.slot_envio || contextoVendas.slot_envio || null,
            dor_principal: contextoVendas.dor_principal || d.dor_principal || '',
            perda_estimada: contextoVendas.perda_estimada ?? d.perda_estimada ?? null,
            mensagem_enviada: mensagemEnviadaProspeccao,
            auto_reply_detectado: autoReplyDetectado,
          }
          perfilProspeccaoPatch = {
            negocio: contextoPerfilProspeccao.nicho || undefined,
            cidade: contextoPerfilProspeccao.cidade || undefined,
            origem: 'prospeccao',
            produto_sugerido: 'site',
            dor_principal: contextoPerfilProspeccao.dor_principal || undefined,
            contexto_prospeccao: contextoPerfilProspeccao,
          }
          if (autoReplyDetectado) {
            webhookLog.info('Auto-reply do WhatsApp Business detectada; agente vai usar regra P-PROSP-3')
          }
          if (!conversa && mensagemEnviadaProspeccao) {
            historico = [
              { role: 'assistant', content: mensagemEnviadaProspeccao },
              { role: 'user', content: textoHistorico },
            ]
            estagio = 'diagnostico'
          } else {
            historico.push({ role: 'user', content: textoHistorico })
          }
        } else {
          historico.push({ role: 'user', content: textoHistorico })
        }
    
        await salvarConversa(numero, historico, estagio, conversa?.status || 'ativo')
        if (perfilProspeccaoPatch) {
          await atualizarPerfil(numero, perfilProspeccaoPatch)
        }
        let respostaLembrete = null
        if (typeof registrarRespostaLembreteReuniao === 'function') {
          respostaLembrete = await registrarRespostaLembreteReuniao(numero, textoHistorico).catch((err) =>
            webhookLog.warn({ err: serializeError(err) }, 'Falha ao registrar resposta de lembrete')
          )
        }
        await cancelarFollowupsAutoPendentes(numero, 'lead_respondeu')
        if (textoPedePreco(textoHistorico)) {
          await registrarEventoComercial(numero, 'pediu_preco', {
            trecho: textoHistorico.slice(0, 200),
          })
        }
        await marcarRespostaFollowupSeAplicavel(numero)
        if (respostaLembrete?.resposta === 'reagendamento_pendente' && respostaLembrete?.mensagem_enviada) {
          webhookLog.info('Resposta de lembrete gerou sugestao automatica de reagendamento; IA nao sera acionada neste turno')
          return
        }
    
        if (conversa?.agente_pausado) {
          webhookLog.info('Agente pausado; mensagem registrada sem resposta automatica')
          // #4: com o agente pausado (operador no comando), o lead pode estar
          // confirmando um horario que o operador propos. Detecta o fechamento.
          if (typeof tratarPossivelReuniaoOperador === 'function') {
            await tratarPossivelReuniaoOperador(numero).catch((err) =>
              webhookLog.warn({ err: serializeError(err) }, '#4 tratarPossivelReuniaoOperador falhou (lead pausado)')
            )
          }
          return
        }

        const conversaParaResposta = { ...(conversa || {}), historico }
        if (typeof podeGerarRespostaAutomatica === 'function' && !podeGerarRespostaAutomatica(conversaParaResposta)) {
          webhookLog.info('Resposta automatica bloqueada: ultima mensagem real nao e do lead')
          return
        }
    
        const stDeb = obterEstadoDebounceResposta(numero)
        if (visao) stDeb.visaoLote = visao
        if (stDeb.geracaoEmAndamento) {
          stDeb.pendenteAposGeracao = true
          return
        }
        await enfileirarJobRespostaWebhook(numero, requestId)
      } catch (err) {
        webhookLog.error({ err: serializeError(err) }, 'Erro webhook')
      }
  })
}

module.exports = { registerWebhookRoute }
