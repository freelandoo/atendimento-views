'use strict'

const { ALERTA_FALHA_RESPOSTA_DEDUPE_MS } = require('./config')
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
  
  // Rótulo humano do motivo do handoff (cabeçalho do ping compacto).
  const MOTIVO_LABEL = {
    agendou_reuniao_proposta: 'Reunião agendada',
    aceitou_proposta: 'Proposta aceita',
    lead_pediu_humano: 'Lead pediu humano',
    conversa_longa_sem_avanco: 'Conversa longa sem avanço',
    mencionou_pagamento: 'Mencionou pagamento',
    mencao_juridica: 'Menção jurídica',
    ja_tem_site: 'Já tem site',
    coleta_incompleta: 'Coleta incompleta',
    reagendou_reuniao: 'Reagendamento (lead)',
  }

  function formatarReuniaoCurta(perfil = {}) {
    const rp = (perfil && typeof perfil.reuniao_proposta === 'object' && perfil.reuniao_proposta) || {}
    const dataIso = String(rp.data_confirmada || rp.data_sugerida || '').trim()
    const hora = String(rp.horario_confirmado || '').trim()
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataIso)
    const dataBr = m ? `${m[3]}/${m[2]}` : dataIso
    if (dataBr && hora) return `${dataBr} ${hora}`
    return hora || dataBr || ''
  }

  // URL pública conhecida do painel (produção Railway). Serve de padrão quando
  // nenhuma env aponta a base — assim o link funciona sem config manual. Pode ser
  // sobreposta por DASHBOARD_URL (ex.: domínio próprio) ou RAILWAY_PUBLIC_DOMAIN.
  const DASHBOARD_URL_PADRAO = 'https://pjcodeworks-agent-production.up.railway.app'

  // Link para o perfil do lead no painel. Ordem: DASHBOARD_URL → RAILWAY_PUBLIC_DOMAIN
  // → padrão de produção. Lê process.env em tempo de chamada (testável/override em runtime).
  function linkPainelLead(numero) {
    const raw = process.env.DASHBOARD_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
      || DASHBOARD_URL_PADRAO
    const base = String(raw || '').trim().replace(/\/+$/, '')
    if (!base) return ''
    return `${base}/perfil-lead.html?numero=${encodeURIComponent(numero)}`
  }

  function formatarPreviaValor(previa) {
    if (!previa || typeof previa !== 'object') return ''
    if (previa.plano === 'sob_medida') {
      const just = previa.justificativa ? `\n"${previa.justificativa}"` : ''
      return `💡 Prévia de valor (IA): sob medida — alinhar escopo na reunião${just}`
    }
    let valorTxt = ''
    if (previa.faixa_min && previa.faixa_max) {
      valorTxt = previa.faixa_min === previa.faixa_max
        ? `R$ ${previa.faixa_min}`
        : `R$ ${previa.faixa_min}–${previa.faixa_max}`
      if (previa.valor_alvo) valorTxt += ` (alvo ~R$ ${previa.valor_alvo})`
    } else if (previa.valor_alvo) {
      valorTxt = `~R$ ${previa.valor_alvo}`
    }
    if (!valorTxt) return ''
    const planoTxt = previa.plano ? ` · plano ${previa.plano}` : ''
    const just = previa.justificativa ? `\n"${previa.justificativa}"` : ''
    return `💡 Prévia de valor (IA): ${valorTxt}${planoTxt}${just}`
  }

  /**
   * Ping COMPACTO ao operador. Só o que decide a ação em segundos; o briefing rico
   * fica no dashboard (link). Funde o antigo "preview de valor" como prévia informativa
   * (sem aprovação) no handoff de reunião agendada.
   */
  function montarPingOperador({ numero, perfil = {}, preco = {}, motivo, resumoHandoff, previaValor } = {}) {
    const phone = numeroDisplayDoJid(numero)
    const nome = String(perfil.apelido || perfil.nome || '').trim()
    const leadLinha = nome ? `${nome} · ${phone}` : String(phone || numero || '?')
    const nicho = String(perfil.negocio || '').trim() || '?'
    const cidade = String(perfil.cidade || perfil.regiao_atendimento || '').trim()
    const negCidade = [nicho, cidade].filter(Boolean).join(' · ')
    const term = perfil.termometro_dor ?? perfil.score_dor
    const termLinha = (term != null && term !== '') ? ` · 🌡️${term}/10` : ''
    const titulo = MOTIVO_LABEL[String(motivo || '')] || 'Lead encaminhado'

    const linhas = [`🔔 ${titulo} — PJ Codeworks`, leadLinha, `${negCidade}${termLinha}`]

    const reuniao = formatarReuniaoCurta(perfil)
    if (reuniao) linhas.push(`📅 ${reuniao}`)

    const dor = String(perfil.dor_principal || '').trim()
    if (dor) linhas.push(`Dor: ${resumirTextoOperacional(dor, 120)}`)

    const previaTxt = formatarPreviaValor(previaValor)
    if (previaTxt) linhas.push('', previaTxt)

    const resumo = String(resumoHandoff || '').trim()
    if (resumo) linhas.push(`📝 ${resumirTextoOperacional(resumo, 160)}`)

    const link = linkPainelLead(numero)
    if (link) linhas.push(`▶ ${link}`)

    return linhas.join('\n')
  }

  /** Handoff: WhatsApp sempre que houver número; Telegram só no horário de redirecionamento imediato (reserva). */
  async function alertarHandoff(numero, perfil, preco, motivo, resumoHandoff, extras = {}) {
    const phone = String(numero).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    const motivoStr = String(motivo ?? '')

    const { previaValor } = extras || {}

    const textoWa = montarPingOperador({
      numero,
      perfil,
      preco,
      motivo: motivoStr,
      resumoHandoff,
      previaValor: previaValor || null,
    })

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

  // Avisa o operador que o LEAD pediu para remarcar — reaproveita o ping de handoff,
  // só sinalizando que a alteração partiu do lead.
  async function alertarReagendamentoReuniao(numero, perfil = {}, detalhe = {}) {
    const texto = montarPingOperador({
      numero,
      perfil,
      preco: {},
      motivo: 'reagendou_reuniao',
      resumoHandoff: detalhe.nota || 'O lead pediu para remarcar a reunião.',
      previaValor: null,
    })
    const enviou = await notificarVictorWhatsapp(texto)
    if (enviou) logger.info('📲 Reagendamento (lead) notificado ao operador:', numeroDisplayDoJid(numero))
    return enviou
  }

  return {
    obterHoraLocalBrasil,
    estaNoHorarioRedirecionamentoImediatoVictor,
    textoContextoHorarioVictorParaPrompt,
    montarPingOperador,
    alertarReagendamentoReuniao,
    alertarHandoff,
    alertarLacunaConhecimento,
    notificarVictorWhatsapp,
    alertarVendaFechadaOperadores,
    deveAlertarFalhaResposta,
    alertarFalhaResposta,
  }
}

module.exports = { createHandoffAlerts }
