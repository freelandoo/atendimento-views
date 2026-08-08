'use strict'

const {
  eventoSaudeDeWebhook: eventoSaudeDeWebhookDefault,
  registrarEventoSaudeInstancia: registrarEventoSaudeInstanciaDefault,
} = require('./db/whatsapp-instance-events')
const { classificarLead } = require('./services/site-classificacao')
const {
  avaliarAtribuicao,
  resumoDiagnostico,
  diagnosticoLigado,
} = require('./services/ctwa-atribuicao')
const {
  registrarAtribuicao: registrarAtribuicaoDefault,
} = require('./db/atribuicao-anuncios')
const {
  registrarPendencia: registrarPendenciaDefault,
} = require('./db/webhook-quarentena')
const { hashMensagemId, resumoPendencia } = require('./services/webhook-quarentena')
const { pool: poolDefault } = require('./db')

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
    eventoSaudeDeWebhook = eventoSaudeDeWebhookDefault,
    registrarEventoSaudeInstancia = registrarEventoSaudeInstanciaDefault,
    registrarAtribuicaoAnuncio = registrarAtribuicaoDefault,
    registrarPendenciaQuarentena = registrarPendenciaDefault,
    pool: poolAtribuicao = poolDefault,
    capturarNomeContato,
  } = deps

  /**
   * O webhook chegou sem dono comprovado?
   *
   * Substitui o fallback para a PJ. Antes, instância ausente, não mapeada ou com erro de
   * consulta produziam o `empresa_id` da PJ e o atendimento seguia normalmente — gravando
   * conversa, perfil de lead e evento comercial de um negócio que não é a PJ dentro do
   * tenant da PJ. Agora o fluxo PARA aqui: nada de conversa, lead, reunião, atribuição
   * CTWA, follow-up, resposta automática ou evento Meta em nome de tenant nenhum.
   *
   * O custo aceito e declarado: a mensagem não é reencenada depois. Mapeada a instância,
   * o lead volta a ser atendido na PRÓXIMA mensagem — guardar a conversa de um negócio
   * sem dono conhecido seria criar o mesmo dado sujo, só que em repouso.
   *
   * Nunca lança: uma falha ao registrar a pendência não pode virar erro no webhook (o
   * Evolution reentregaria), e muito menos liberar o fluxo barrado.
   *
   * @returns {Promise<boolean>} true quando o fluxo deve parar.
   */
  async function barrarSemDonoComprovado(req, log) {
    const pendencia = req.tenantPendencia
    if (!pendencia) return false

    // Id da mensagem só para IDEMPOTÊNCIA, e só como hash — nunca em claro, nunca em log.
    const msg = req.body?.data?.messages?.[0] || req.body?.data
    const mensagemHash = hashMensagemId(msg?.key?.id)

    try {
      const { novaOcorrencia } = await registrarPendenciaQuarentena(poolAtribuicao, pendencia, mensagemHash)
      log.warn(
        resumoPendencia(pendencia, { etapa: novaOcorrencia ? 'aberta' : 'reincidente', event: req.body?.event || null }),
        'Webhook sem dono comprovado — mensagem em quarentena, nada foi gravado'
      )
    } catch (err) {
      // Mesmo sem conseguir registrar, o fluxo continua barrado: preferimos perder a
      // pendência a gravar dado sob a empresa errada.
      log.error(
        resumoPendencia(pendencia, { etapa: 'falha_registro', err: serializeError ? serializeError(err) : String(err) }),
        'Falha ao registrar a pendência de quarentena — webhook segue barrado'
      )
    }
    return true
  }

  /**
   * Captura a atribuição de anúncio (CTWA) da mensagem recebida.
   *
   * Três desfechos, todos deliberados (regras em services/ctwa-atribuicao.js):
   *   - mensagem não veio de anúncio        → nada acontece, nem log;
   *   - veio de anúncio SEM dono comprovado → NÃO grava. Escrever um telefone sob uma
   *     empresa que só o fallback resolveu produziria exatamente o dado sujo que esta
   *     captura existe para evitar. O motivo vai para o log, sem PII;
   *   - veio de anúncio COM empresa e instância comprovadas → grava (idempotente pelo
   *     id da mensagem). Sem `ctwa_clid` a linha nasce não-confiável: fica visível para
   *     auditoria e jamais é enviada à Meta.
   *
   * Nunca lança: o chamador já trata, mas o atendimento não pode depender disto.
   */
  async function capturarAtribuicaoAnuncio(msg, ctx, log) {
    // Observabilidade TEMPORÁRIA — responde "externalAdReply chega no webhook?" em
    // produção sem um deploy de código novo. Desligada por padrão; o resumo só carrega
    // booleanos e nomes de campo de lista fechada (jamais telefone, texto ou clid).
    if (diagnosticoLigado()) {
      log.info(resumoDiagnostico(msg, ctx), 'Diagnóstico CTWA do webhook')
    }

    const veredito = avaliarAtribuicao({ msg, ...ctx })
    if (!veredito.capturar) {
      if (veredito.motivo) {
        // Sem PII: motivo, procedência da empresa e se havia instância. Nada mais.
        log.warn({
          operation: 'ctwa_atribuicao',
          etapa: 'descartada',
          motivo: veredito.motivo,
          empresa_origem: ctx.empresaOrigem || null,
          tem_instancia: !!ctx.instanciaId,
        }, 'Atribuição de anúncio descartada')
      }
      return
    }

    const { registro } = veredito
    const { criado } = await registrarAtribuicaoAnuncio(poolAtribuicao, registro.empresaId, registro)
    log.info({
      operation: 'ctwa_atribuicao',
      etapa: criado ? 'registrada' : 'ja_registrada',
      empresa_id: registro.empresaId,
      instancia_id: registro.instanciaId,
      confiavel: registro.elegivel,
      motivo: registro.motivo,
      // Dica de 4 caracteres, nunca o identificador do clique.
      ctwa_clid_hint: registro.ctwaClidHint,
    }, 'Atribuição de anúncio capturada no webhook')
  }

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

        // ── QUARENTENA ─────────────────────────────────────────────────────────────
        // Primeira coisa depois do 2xx: sem empresa E instância comprovadas pela
        // `evolution_instance`, NADA deste webhook é gravado sob tenant nenhum. Vale para
        // todo evento, inclusive os de saúde da instância — atribuir a saúde de um número
        // desconhecido a uma empresa seria a mesma invenção de dono.
        if (await barrarSemDonoComprovado(req, webhookLog)) return

        const eventoSaude = eventoSaudeDeWebhook(req.body, req.empresaId, req.evolutionInstance)
        if (eventoSaude) {
          await registrarEventoSaudeInstancia(eventoSaude).catch((err) => {
            webhookLog.warn({ err: serializeError(err) }, 'Falha ao registrar evento de saude da instancia')
          })
          webhookLog.info({
            risk_level: eventoSaude.risk_level,
            state: eventoSaude.state,
            disconnect_code: eventoSaude.disconnect_code,
          }, 'Evento de saude da instancia registrado')
        }
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

        // ── ATRIBUIÇÃO DE ANÚNCIO (CTWA) ────────────────────────────────────────────
        // Único ponto do sistema em que telefone real + empresa resolvida pela instância
        // + instância de origem existem ao mesmo tempo. A mineração de
        // `evolution."Message"` que isto substitui nunca teve o telefone (o lead de
        // anúncio chega como `@lid`) — ver services/ctwa-atribuicao.js.
        //
        // Roda ANTES das travas de auto-reply/mídia de propósito: o clique no anúncio é
        // um fato do lead, independente de o bot responder ou não àquela mensagem.
        // Best-effort e isolado: falhar aqui NUNCA pode derrubar o atendimento.
        await capturarAtribuicaoAnuncio(msg, {
          empresaId: req.empresaId,
          empresaOrigem: req.empresaOrigem,
          instanciaId: req.whatsappInstanciaId,
          evolutionInstance: req.evolutionInstance,
          numero,
        }, webhookLog).catch((err) =>
          webhookLog.warn({ err: serializeError(err) }, 'Falha ao capturar atribuição de anúncio')
        )

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
            // Canonico: um lead cujo unico link e' o Instagram entra na conversa como SEM
            // site. Antes ele chegava como "ja tem site" e o bot oferecia melhoria de site
            // inexistente. `contextoVendas.tem_site` (o que o LEAD declarou na conversa)
            // continua tendo precedencia — ali a fonte e' a fala humana, nao a URL.
            tem_site: contextoVendas.tem_site === true ? true : classificarLead(p).tem_site,
            site: contextoVendas.site || classificarLead(p).site || '',
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
    
        // Empresa COMPROVADA pela instância Evolution (resolveEmpresaFromWebhook). Não há
        // fallback: se o código chegou aqui, `barrarSemDonoComprovado` já deixou passar,
        // e `req.empresaId` é o dono real. Fixa o dono da conversa na criação.
        await salvarConversa(numero, historico, estagio, conversa?.status || 'ativo', undefined, req.empresaId, req.evolutionInstance)
        if (perfilProspeccaoPatch) {
          await atualizarPerfil(numero, perfilProspeccaoPatch)
        }
        if (typeof capturarNomeContato === 'function') {
          await capturarNomeContato(numero, { pushName: msg.pushName, texto: textoHistorico }, webhookLog).catch((err) =>
            webhookLog.warn({ err: serializeError(err) }, 'Falha ao capturar apelido do contato')
          )
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
