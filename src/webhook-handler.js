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
          }
          return
        }
    
        const chaveEvtPreMedia = construirChaveIdempotenciaWebhookMensagem(msg)
        if (!(await webhookMensagemDeveSerProcessada(chaveEvtPreMedia, numero))) {
          webhookLog.info({ dedupe_key: chaveEvt }, 'Webhook ignorado por duplicata')
          return
        }
    
        const { texto, visao } = await extrairTextoEMidiaDoWebhook(msg)
        if (!texto && !visao) return
    
        const chaveEvt = construirChaveIdempotenciaWebhookMensagem(msg)
        if (false && !(await webhookMensagemDeveSerProcessada(chaveEvt, numero))) {
          webhookLog.info({ dedupe_key: chaveEvtPreMedia }, 'Webhook ignorado por duplicata')
          return
        }
    
        const textoHistorico = texto || '(Cliente enviou conteúdo de mídia.)'
        const logLinha = textoHistorico.length > 200 ? `${textoHistorico.slice(0, 200)}…` : textoHistorico
        webhookLog.info({ tem_imagem: !!visao, trecho: logLinha }, 'Mensagem recebida no webhook')
    
        let conversa = await buscarConversa(numero)
        let historico = normalizarHistoricoMensagens(conversa?.historico)
        let estagio = conversa?.estagio || 'primeiro_contato'
    
        const prospectRespondido = await marcarProspectComoRespondeuPorNumero(numero).catch(() => null)
        const contextoProspeccao = prospectRespondido
          ? await buscarContextoProspeccao(numero).catch(() => null)
          : null
        if (!conversa && contextoProspeccao?.prospect) {
          const p = contextoProspeccao.prospect
          const d = contextoProspeccao.diagnostico || {}
          const autoReplyDetectado = textoEhAutoReplyWhatsApp(textoHistorico)
          await atualizarPerfil(numero, {
            negocio: p.nicho || undefined,
            cidade: p.cidade || undefined,
            origem: 'prospeccao',
            contexto_prospeccao: {
              prospect_id: p.id || null,
              nome: p.nome || '',
              nicho: p.nicho || '',
              cidade: p.cidade || '',
              telefone: p.telefone || '',
              tem_site: !!p.tem_site,
              site: p.site || '',
              rating: p.rating ?? null,
              avaliacoes: p.avaliacoes ?? null,
              score: p.score ?? null,
              dor_principal: d.dor_principal || '',
              perda_estimada: d.perda_estimada ?? null,
              mensagem_enviada: d.mensagem_editada || d.mensagem_gerada || '',
              auto_reply_detectado: autoReplyDetectado,
            },
          })
          if (autoReplyDetectado) {
            webhookLog.info('Auto-reply do WhatsApp Business detectada; agente vai usar regra P-PROSP-3')
          }
          const primeiraMensagemProspeccao = d.mensagem_editada || d.mensagem_gerada || ''
          if (primeiraMensagemProspeccao) {
            historico = [
              { role: 'assistant', content: primeiraMensagemProspeccao },
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
