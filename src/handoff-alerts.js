'use strict'

const { ALERTA_FALHA_RESPOSTA_DEDUPE_MS } = require('./config')
const { buildProjectHandoff, formatarMensagemHandoffEnriquecida } = require('./project-handoff-build')
const { parsearHorarioReuniao, calcularFimReuniao, dataInicioReuniao } = require('./date-utils')

function createHandoffAlerts(deps = {}) {
  const {
    axios,
    logger,
    enviarMensagem,
    listarOperadoresAtivos,
    numeroDisplayDoJid,
    resumirTextoOperacional,
    criarEventoAgenda,
    slotEstaOcupado,
  } = deps

  const alertaFalhaRespostaPorJid = new Map()

  function obterHoraLocalBrasil(dataRef = new Date()) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = dtf.formatToParts(dataRef)
    let weekdayStr = 'Sun'
    let hour = 0
    let minute = 0
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value
      if (p.type === 'hour') hour = parseInt(p.value, 10)
      if (p.type === 'minute') minute = parseInt(p.value, 10)
    }
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const weekday = map[weekdayStr] ?? 0
    return { weekday, minutes: hour * 60 + minute }
  }
  
  /** Permite aviso imediato ao operador e orientar handoff sem pessoa especifica ao lead. */
  function estaNoHorarioRedirecionamentoImediatoVictor(dataRef = new Date()) {
    const { weekday, minutes } = obterHoraLocalBrasil(dataRef)
    if (weekday === 0) return false
    const inicio = 9 * 60
    const fimSemana = 18 * 60
    const fimSabado = 15 * 60
    if (weekday >= 1 && weekday <= 5) {
      return minutes >= inicio && minutes <= fimSemana
    }
    if (weekday === 6) {
      return minutes >= inicio && minutes <= fimSabado
    }
    return false
  }
  
  /** Injetado no system prompt para o modelo alinhar tom (instantes vs. fora do expediente). */
  function textoContextoHorarioVictorParaPrompt() {
    const agora = new Date()
    const permitido = estaNoHorarioRedirecionamentoImediatoVictor(agora)
    const horaLegivel = agora.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const linhas = [
      `Data/hora de referência (America/Sao_Paulo): ${horaLegivel}`,
      `Redirecionamento imediato para a equipe da PJ Codeworks permitido AGORA: ${permitido ? 'SIM' : 'NÃO'}`,
      'Regras: segunda a sexta 9h–18h; sábado 9h–15h; domingo sem redirecionamento imediato.',
    ]
    if (permitido) {
      linhas.push(
        'Com handoff true: diga que a equipe da PJ Codeworks assume a conversa em breve, sem citar pessoa especifica.'
      )
    } else {
      linhas.push(
        'Com handoff true: NÃO prometa urgência imediata. Diga com naturalidade que a equipe da PJ Codeworks vai analisar e retornar com atenção. Registre handoff normalmente (handoff: true).'
      )
    }
    return linhas.join('\n')
  }
  
  // ─── ALERTAS AO VICTOR (WhatsApp + Telegram opcional) ─────────────────────────
  
  function montarAnexoPrecificacaoMotor(perfil, preco) {
    const pj = perfil.precificacao_json
    const temPreco = preco.total > 0
    let linhaPrecificacao = ''
    if (pj && typeof pj === 'object') {
      linhaPrecificacao =
        `\n📊 Precificação (motor) — plano: ${pj.plano_recomendado ?? '?'} | ROI: ${pj.roi_score ?? '?'}\n` +
        `Valor personalizado: R$ ${pj.valor_personalizado ?? '?'} (faixa R$${pj.range_min ?? '?'}–R$${pj.range_max ?? '?'})\n` +
        `Iniciante R$ ${pj.iniciante_valor ?? '?'} · Padrão R$ ${pj.padrao_valor ?? '?'} · Premium R$ ${pj.premium_valor ?? '?'}\n` +
        `Upgrades: Inic→Pad R$ ${pj.upgrade_iniciante_para_padrao ?? '?'} · Pad→Prem R$ ${pj.upgrade_padrao_para_premium ?? '?'}\n`
    }
    const linhaPreco = temPreco
      ? `💰 Preço calculado: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
      : ''
    const linhaExtra =
      (perfil.plano_sugerido ? `📋 Plano sugerido (perfil): ${perfil.plano_sugerido}\n` : '') +
      (perfil.complexidade ? `🔧 Complexidade: ${perfil.complexidade}\n` : '') +
      `🌡️ Termômetro/dor (perfil): ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10\n`
    if (!linhaPrecificacao && !linhaPreco && !linhaExtra.trim()) return ''
    return `\n---\n${linhaPreco}${linhaExtra}${linhaPrecificacao}`
  }

  /** Handoff: WhatsApp sempre que houver número; Telegram só no horário de redirecionamento imediato (reserva). */
  async function alertarHandoff(numero, perfil, preco, motivo, resumoHandoff, extras = {}) {
    const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    const motivoStr = String(motivo ?? '')

    const { resultado } = extras || {}

    const temPreco = preco.total > 0
    const montarTextoLegado = () => {
      const linhaPreco = temPreco
        ? `💰 Preço: R$ ${preco.total} (entrada R$ ${preco.entrada} + 3x R$ ${preco.parcela})\n`
        : ''
      const linhaPlano = perfil.plano_sugerido ? `📋 Plano: ${perfil.plano_sugerido}\n` : ''
      const linhaTemp = perfil.temperatura_lead ? `🌡️ Temperatura: ${perfil.temperatura_lead}\n` : ''
      const linhaComplexidade = perfil.complexidade ? `🔧 Complexidade: ${perfil.complexidade}\n` : ''
      const linhaDor = perfil.score_dor != null ? `😟 Score dor: ${perfil.score_dor}/10\n` : ''
      const linhaResumo = resumoHandoff ? `\n📝 Resumo:\n${resumoHandoff}\n` : ''
      let linhaPrecificacao = ''
      const pj = perfil.precificacao_json
      if (pj && typeof pj === 'object') {
        linhaPrecificacao =
          `\n📊 Precificação — plano: ${pj.plano_recomendado ?? '?'} | ROI: ${pj.roi_score ?? '?'}\n` +
          `Valor personalizado: R$ ${pj.valor_personalizado ?? '?'} (faixa R$${pj.range_min ?? '?'}–R$${pj.range_max ?? '?'})\n` +
          `Iniciante R$ ${pj.iniciante_valor ?? '?'} · Padrão R$ ${pj.padrao_valor ?? '?'} · Premium R$ ${pj.premium_valor ?? '?'}\n` +
          `Upgrades: Inic→Pad R$ ${pj.upgrade_iniciante_para_padrao ?? '?'} · Pad→Prem R$ ${pj.upgrade_padrao_para_premium ?? '?'}\n`
      }
      return (
        `🔔 HANDOFF — PJ Codeworks\n` +
        `Lead: ${phone}\n` +
        `Nicho: ${perfil.negocio || '?'} | ${perfil.cidade || '?'}\n` +
        `Motivo: ${motivoStr}\n` +
        linhaPreco +
        linhaPlano +
        linhaTemp +
        linhaComplexidade +
        linhaDor +
        linhaPrecificacao +
        `🌡️ Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10` +
        linhaResumo
      )
    }

    let textoWa
    try {
      const built = buildProjectHandoff({
        numero,
        perfil,
        preco,
        motivo: motivoStr,
        resumoHandoff,
        resultado: resultado && typeof resultado === 'object' ? resultado : {},
      })
      const { handoff } = built

      textoWa =
        formatarMensagemHandoffEnriquecida(handoff, { motivo: motivoStr }) +
        montarAnexoPrecificacaoMotor(perfil, preco)
    } catch (e) {
      logger.error('❌ Handoff enriquecido falhou, usando formato legado:', e.message)
      textoWa = montarTextoLegado()
    }

    const enviouWa = await notificarVictorWhatsapp(textoWa)
    if (enviouWa) {
      logger.info('📲 Handoff notificado ao operador (WhatsApp):', motivoStr)
    }

    if (motivoStr === 'agendou_reuniao_proposta' && typeof criarEventoAgenda === 'function') {
      try {
        const { resultado } = extras || {}
        // reuniao_proposta fica em atualizar_perfil após resultadoParseadoParaObjeto
        const rp =
          (resultado && typeof resultado === 'object'
            ? resultado.atualizar_perfil?.reuniao_proposta || resultado.reuniao_proposta
            : null) || {}
        const horarioTexto = String(rp.horario_confirmado || '')
        const parsed = parsearHorarioReuniao(horarioTexto)
        if (!parsed) {
          logger.error('❌ Agenda: horario_confirmado ausente ou inválido — evento de reunião não criado.', {
            horario_confirmado: rp.horario_confirmado,
            horarios_sugeridos: rp.horarios_sugeridos,
          })
        } else {
          const { hora, min } = parsed
          const dataInicio = dataInicioReuniao(rp.data_sugerida, hora, min)
          const dataFim = calcularFimReuniao(dataInicio, 15)

          // Re-valida disponibilidade antes de inserir para evitar overbooking
          if (typeof slotEstaOcupado === 'function') {
            try {
              const ocupado = await slotEstaOcupado(dataInicio, dataFim)
              if (ocupado) {
                logger.error('⚠️ Agenda: horário escolhido ficou ocupado — evento não criado para evitar overbooking.', {
                  horario: horarioTexto,
                  data_sugerida: rp.data_sugerida,
                  data_inicio: dataInicio.toISOString(),
                  data_fim: dataFim.toISOString(),
                })
                return
              }
            } catch (eVal) {
              logger.warn('⚠️ Agenda: falha na re-validação de disponibilidade, prosseguindo com criação:', eVal.message)
            }
          }

          const titulo = `Reunião de proposta — ${perfil.negocio || phone}`
          await criarEventoAgenda({
            titulo: titulo.slice(0, 160),
            descricao: resumoHandoff || '',
            tipo: 'reuniao',
            prioridade: 'urgente',
            dataInicio,
            dataFim,
            metadata: {
              lead_numero: phone,
              negocio: perfil.negocio || null,
              cidade: perfil.cidade || null,
              plano_sugerido: perfil.plano_sugerido || null,
              horario_confirmado_texto: horarioTexto || null,
              motivo_handoff: motivoStr,
            },
            origem: 'handoff',
          })
          logger.info('📅 Evento de reunião criado na Agenda via handoff:', motivoStr)
        }
      } catch (e) {
        logger.error('❌ Agenda: falha ao criar evento de reunião via handoff:', e.message)
      }
    }

    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) return
    if (!estaNoHorarioRedirecionamentoImediatoVictor()) return

    await axios
      .post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: textoWa.slice(0, 3900),
      })
      .catch((e) => logger.error('❌ Telegram handoff:', e.message))
  }
  
  /** Lacuna: WhatsApp direto; Telegram opcional (mesmo texto, sem duplicar lógica longa). */
  async function alertarLacunaConhecimento(numero, tema, detalhe) {
    const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    const temaLinha = String(tema || '?').trim()
    const det = String(detalhe || '').trim()
    const detCorte = det.length > 400 ? `${det.slice(0, 397)}…` : det
    const textoWa =
      `📌 Lacuna de conhecimento — PJ Codeworks\n` +
      `Tema: ${temaLinha}\n` +
      `Lead: ${phone || '?'}\n` +
      detCorte
  
    const enviouWa = await notificarVictorWhatsapp(textoWa)
    if (enviouWa) {
      logger.info('📲 Lacuna notificada aos operadores (WhatsApp):', temaLinha)
    }
  
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) return
  
    const texto =
      `📌 *Lacuna — PJ Codeworks*\n` +
      `Tema: \`${String(tema || '?').replace(/`/g, "'")}\`\n` +
      `Lead: \`${phone || '?'}\`\n` +
      detCorte
  
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: texto, parse_mode: 'Markdown' }
    ).catch((e) => logger.error('❌ Telegram lacuna:', e.message))
  }
  
  /**
   * Insere lacuna se não houver registro idêntico (mesmo número + tema) nas últimas 24h.
   * @returns {Promise<number|null>} id inserido ou null (duplicata ou sem inserção)
   */

  function mensagemFalhaRespostaParaAssinatura(falha) {
    const resumo = resumirTextoOperacional(falha?.resumo || '', 140)
    const detalhe = resumirTextoOperacional(falha?.detalhe || '', 500)
    return [resumo, detalhe].filter(Boolean).join(' | ')
  }

  async function notificarVictorWhatsapp(texto) {
    const t = String(texto || '').trim()
    if (!t) return false
    const operadores = await listarOperadoresAtivos({ alertas: true })
    if (operadores.length === 0) return false
    let enviados = 0
    const erros = []
    try {
      for (const op of operadores) {
        try {
          await enviarMensagem(op.jid, t)
          enviados++
        } catch (e) {
          erros.push(`${op.jid}: ${e.message}`)
        }
      }
      if (erros.length) logger.error('❌ WhatsApp operadores (alerta):', erros.join(' | '))
      return enviados > 0
    } catch (e) {
      logger.error('❌ WhatsApp operadores (alerta):', e.message)
      return false
    }
  }
  
  async function alertarVendaFechadaOperadores(numero, perfil = {}, preco = {}, resumoHandoff = null) {
    const phone = numeroDisplayDoJid(numero)
    const total = Number(preco.total || perfil.preco_calculado || 0)
    const entrada = Number(preco.entrada || perfil.entrada || 0)
    const parcela = Number(preco.parcela || perfil.parcela || 0)
    const linhaValor = total > 0
      ? `Valor: R$ ${total} (entrada R$ ${entrada || 0} + 3x R$ ${parcela || 0})\n`
      : ''
    const resumo = String(resumoHandoff || '').trim()
    const texto =
      `✅ Venda fechada — PJ Codeworks\n` +
      `Lead: ${phone || numero}\n` +
      `Nicho: ${perfil.negocio || '?'} | ${perfil.cidade || '?'}\n` +
      (perfil.plano_sugerido ? `Plano: ${perfil.plano_sugerido}\n` : '') +
      linhaValor +
      (perfil.temperatura_lead ? `Temperatura: ${perfil.temperatura_lead}\n` : '') +
      `Termômetro: ${perfil.termometro_dor ?? perfil.score_dor ?? '?'}/10\n` +
      (resumo ? `Resumo: ${resumirTextoOperacional(resumo, 320)}\n` : '') +
      `Ação sugerida: confirmar dados finais e seguir com contrato/pagamento.`
    const enviou = await notificarVictorWhatsapp(texto)
    if (enviou) logger.info('📲 Venda fechada notificada aos operadores:', phone || numero)
    return enviou
  }
  
  function deveAlertarFalhaResposta(numero, falha) {
    const assinatura = `${falha?.codigo || 'desconhecido'}|${mensagemFalhaRespostaParaAssinatura(falha) || ''}`
    const atual = Date.now()
    const prev = alertaFalhaRespostaPorJid.get(numero)
    if (prev && prev.assinatura === assinatura && atual - prev.timestamp < ALERTA_FALHA_RESPOSTA_DEDUPE_MS) {
      return false
    }
    alertaFalhaRespostaPorJid.set(numero, { assinatura, timestamp: atual })
    return true
  }
  
  async function alertarFalhaResposta(numero, falha) {
    if (!deveAlertarFalhaResposta(numero, falha)) return false
    const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    const detalhe = resumirTextoOperacional(falha?.detalhe || falha?.resumo || '', 280)
    const texto =
      `⚠️ Falha de resposta automática — PJ Codeworks\n` +
      `Lead: ${phone || numero}\n` +
      `Código: ${falha?.codigo || 'resposta_falhou'}\n` +
      `Resumo: ${falha?.resumo || 'falha ao gerar ou enviar resposta'}\n` +
      `Detalhe: ${detalhe || 'sem detalhe adicional'}\n` +
      `Ação sugerida: revisar no dashboard e usar Reenviar resposta se fizer sentido.`
    const enviou = await notificarVictorWhatsapp(texto)
    if (enviou) {
      logger.info('📲 Falha de resposta notificada aos operadores (WhatsApp):', falha?.codigo || 'resposta_falhou')
    }
    return enviou
  }

  return {
    obterHoraLocalBrasil,
    estaNoHorarioRedirecionamentoImediatoVictor,
    textoContextoHorarioVictorParaPrompt,
    alertarHandoff,
    alertarLacunaConhecimento,
    notificarVictorWhatsapp,
    alertarVendaFechadaOperadores,
    deveAlertarFalhaResposta,
    alertarFalhaResposta,
  }
}

module.exports = { createHandoffAlerts }
