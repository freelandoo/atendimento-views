'use strict'

// Enviador do Contexto 2 (multiempresa / playbook), relocado de core-funnel.js
// como factory com injeção de dependência (mesmo padrão de createCoreFunnel),
// para que o motor legado possa ser removido sem matar este caminho.
//
// Mantém a infra (DB, WhatsApp, agenda, handoff) injetada pelo chamador (agent.js),
// preservando o wiring exato das factories (createDbCrud, createHandoffAlerts, etc.).
// Os helpers de agenda abaixo são puros e foram trazidos inline do core-funnel.

const MENSAGEM_AGENDA_INDISPONIVEL =
  'Nao consegui consultar a agenda agora. Vou pedir para a equipe da {{empresa}} verificar os proximos horarios e te chamar por aqui.'

function horariosValidosAgenda(slots) {
  return Array.isArray(slots?.horarios_sugeridos) ? slots.horarios_sugeridos.filter(Boolean) : []
}

function agendaTemSlots(slots) {
  return Boolean(slots && !slots.erro && slots.data_sugerida && horariosValidosAgenda(slots).length > 0)
}

function formatarDataReuniao(dataIso) {
  const s = String(dataIso || '').trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return 'a data combinada'
  return `${m[3]}/${m[2]}`
}

function montarMensagemOfertaAgenda(slots, intro) {
  if (!agendaTemSlots(slots)) return MENSAGEM_AGENDA_INDISPONIVEL
  const horarios = horariosValidosAgenda(slots)
  const label = slots.data_label || formatarDataReuniao(slots.data_sugerida)
  const opcoes = horarios.length > 1 ? `${horarios[0]} ou ${horarios[1]}` : horarios[0]
  return `${intro}\n\nTenho ${label} às ${opcoes} disponíveis. Qual fica melhor?`
}

function horarioFoiOferecido(horario, reuniao = {}) {
  const horarios = Array.isArray(reuniao.horarios_sugeridos) ? reuniao.horarios_sugeridos.filter(Boolean) : []
  return horarios.length > 0 && horarios.includes(horario)
}

function horariosNoTexto(texto) {
  return (String(texto || '').match(/\b\d{1,2}\s*[:h]\s*\d{2}\b/g) || [])
    .map((h) => h.replace(/\s*[:h]\s*/, ':'))
}

/**
 * Cria o enviador do Contexto 2. Recebe as MESMAS dependências já montadas no
 * agent.js (injeção), garantindo wiring idêntico ao do funil legado.
 * @returns {{ responderContexto2: Function }}
 */
function createContexto2Responder(deps = {}) {
  const {
    pool,
    logger,
    processarMensagemComPlaybook,
    buscarPerfil,
    atualizarPerfil,
    salvarConversa,
    limparFalhaResposta,
    alertarHandoff,
    enviarMensagem,
    buscarSlotsDisponiveis,
    validarSlotReuniao,
  } = deps

  /**
   * Resposta para empresas com Contexto 2 (playbook) ATIVO. Cada empresa responde
   * com o próprio contexto. Reusa a agenda/handoff da infra. Handoff pausa a conversa.
   * @returns {Promise<{ ok: true, via: 'playbook' }|{ skipped: true, reason: string }>}
   */
  async function responderContexto2({ numero, empresaId, conversaUsada, historico, estagioLive }) {
    const ultima = historico[historico.length - 1]
    const mensagem = typeof ultima?.content === 'string' ? ultima.content : String(ultima?.content || '')
    const status = conversaUsada?.status || 'ativo'

    let res
    try {
      res = await processarMensagemComPlaybook({
        pool,
        log: logger,
        empresaId,
        conversaId: conversaUsada?.id || null,
        leadPhone: numero,
        mensagem,
        historico,
      })
    } catch (e) {
      logger.error({ err: e.message, empresa_id: empresaId, numero }, 'Playbook multiempresa falhou — sem resposta automática neste turno')
      return { skipped: true, reason: 'playbook_erro' }
    }

    const extracao = res?.extracao || {}
    const decisao = res?.decisao || {}
    let texto = typeof decisao.mensagem_pro_lead === 'string' ? decisao.mensagem_pro_lead.trim() : ''
    const precisaHandoff = !!decisao.precisa_handoff

    // ── Agenda (reunião) — reusa os helpers/booking da infra ───────────────────
    let reuniaoConfirmada = false
    try {
      const perfilPb = await buscarPerfil(numero).catch(() => ({}))
      const reuniaoProp = perfilPb?.reuniao_proposta && typeof perfilPb.reuniao_proposta === 'object' ? perfilPb.reuniao_proposta : {}
      const temOfertaPendente = Array.isArray(reuniaoProp.horarios_sugeridos) && reuniaoProp.horarios_sugeridos.length > 0 && !!reuniaoProp.data_sugerida

      // CONFIRMAR: já ofertamos horários e o lead escolheu um deles
      if (temOfertaPendente) {
        const escolhido = horariosNoTexto(mensagem).find((h) => horarioFoiOferecido(h, reuniaoProp))
        if (escolhido) {
          const valido = await validarSlotReuniao({ data: reuniaoProp.data_sugerida, horario: escolhido }).catch(() => false)
          if (valido) {
            const rpConfirm = { ...reuniaoProp, horario_confirmado: escolhido }
            await atualizarPerfil(numero, { reuniao_proposta: { ...rpConfirm, horarios_sugeridos: [] } }).catch(() => {})
            await alertarHandoff(
              numero,
              { ...perfilPb, reuniao_proposta: rpConfirm },
              null,
              'agendou_reuniao_proposta',
              `Reunião agendada via playbook (empresa ${empresaId})`,
              { resultado: { atualizar_perfil: { reuniao_proposta: rpConfirm } } }
            ).catch((e) => logger.warn({ err: e.message, numero }, 'Playbook: alertarHandoff (agenda) falhou'))
            reuniaoConfirmada = true
            if (!texto) texto = `Fechado! Marquei para ${formatarDataReuniao(reuniaoProp.data_sugerida)} às ${escolhido}. Qualquer coisa, é só me chamar.`
          }
        }
      }

      // OFERTAR: playbook sinaliza reunião e ainda não há oferta pendente
      if (!reuniaoConfirmada && !temOfertaPendente && ['deve_oferecer', 'aceita'].includes(extracao.reuniao_status)) {
        const slots = await buscarSlotsDisponiveis({ quantidade: 2 }).catch(() => null)
        if (agendaTemSlots(slots)) {
          const intro = texto || 'Posso marcar uma conversa rápida com a equipe.'
          texto = montarMensagemOfertaAgenda(slots, intro)
          await atualizarPerfil(numero, {
            reuniao_proposta: {
              data_sugerida: slots.data_sugerida,
              data_label: slots.data_label,
              horarios_sugeridos: horariosValidosAgenda(slots),
            },
          }).catch(() => {})
        }
      }
    } catch (e) {
      logger.warn({ err: e.message, empresa_id: empresaId, numero }, 'Playbook: bloco de agenda falhou — seguindo com a mensagem do playbook')
    }

    if (!texto) {
      logger.warn({ empresa_id: empresaId, numero }, 'Playbook não produziu mensagem — nada enviado neste turno')
      return { skipped: true, reason: 'playbook_sem_mensagem' }
    }

    const evolutionInstance = conversaUsada?.evolution_instance || null
    const whatsappOpts = evolutionInstance ? { instanceName: evolutionInstance } : {}
    await enviarMensagem(numero, texto, whatsappOpts)
    const historicoNovo = [...historico, { role: 'assistant', content: texto }]
    // Mantém o estágio atual; em handoff, pausa a conversa para um humano assumir.
    await salvarConversa(numero, historicoNovo, estagioLive, status, precisaHandoff ? true : undefined, empresaId, evolutionInstance)
    await limparFalhaResposta(numero).catch(() => {})
    logger.info(
      { empresa_id: empresaId, numero, etapa: res?.decisao?.etapa_proxima || estagioLive, handoff: precisaHandoff, via: 'playbook' },
      'Resposta multiempresa (Contexto 2) enviada'
    )
    return { ok: true, via: 'playbook' }
  }

  return { responderContexto2 }
}

module.exports = { createContexto2Responder }
