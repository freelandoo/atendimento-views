'use strict'

const crypto = require('crypto')
const { FOLLOWUP_SNIPPET_MAX_CHARS } = require('./config')
const {
  sanitizarMencoesPessoaParaEquipe,
  sanitizarTermosInternosParaLead,
  sanitizarFrasesProibidasDaResposta,
  textoContemPrecoParaLead,
} = require('./institutional-language')
const { validarRespostaAntesDeEnviar } = require('./agent-validators')
const { limitarBolhasPorEtapa } = require('./message-limits')
const { decidirProximaAcao, separarEcoDaUltimaPergunta } = require('./next-action-orchestrator')
const { canonicalizarPerfilLead } = require('./lead-profile-canonical')
const { validarRespostaPorAcao } = require('./action-response-validator')
const { buildTurnContext } = require('./turn-context-reader')

/**
 * Mescla os sinais do lead (insights_lead) capturados pela IA num turno com o que já
 * estava salvo. Escalares: o novo só sobrescreve se vier preenchido. Arrays
 * (concorrentes/sinais/objeções): união + dedup (cap 12). `score` vira coluna
 * `score_lead` (0-100). Sem inventar — só usa o que a IA devolveu.
 * @returns patch p/ atualizarPerfil `{ insights_lead?, score_lead? }` ou null.
 */
function mesclarInsightsLead(atual, novo) {
  if (!novo || typeof novo !== 'object' || Array.isArray(novo)) return null
  const base = atual && typeof atual === 'object' && !Array.isArray(atual) ? atual : {}
  const out = { ...base }
  delete out.score
  const setStr = (k) => {
    const v = novo[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 280)
  }
  const setEnum = (k, vals) => {
    const v = String(novo[k] == null ? '' : novo[k]).trim().toLowerCase()
    if (vals.includes(v)) out[k] = v
  }
  const mergeArr = (k, cap = 12) => {
    const prev = Array.isArray(base[k]) ? base[k] : []
    const add = Array.isArray(novo[k]) ? novo[k] : []
    if (!prev.length && !add.length) return
    const seen = new Set()
    const uni = []
    for (const x of [...prev, ...add]) {
      const s = String(x == null ? '' : x).trim()
      if (!s) continue
      const key = s.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      uni.push(s.slice(0, 160))
      if (uni.length >= cap) break
    }
    if (uni.length) out[k] = uni
  }
  setStr('origem_clientes')
  setStr('prazo')
  setStr('orcamento_mencionado')
  setStr('observacao_curta')
  setEnum('urgencia', ['baixa', 'media', 'alta'])
  setEnum('eh_decisor', ['sim', 'nao', 'desconhecido'])
  mergeArr('concorrentes_mencionados')
  mergeArr('sinais_compra')
  mergeArr('objecoes')
  const patch = {}
  if (Object.keys(out).length) patch.insights_lead = out
  const sc = Number(novo.score)
  if (Number.isFinite(sc) && sc > 0) patch.score_lead = Math.max(0, Math.min(100, Math.round(sc)))
  return Object.keys(patch).length ? patch : null
}

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
    gerarTextoIA,
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
    buscarDisponibilidadeSemana,
    validarSlotReuniao,
    gerarPreviaValorIA,
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
    interpretarIntencaoMensagemIA,
    podeGerarRespostaAutomatica,
    parsearHorarioReuniao,
    calcularFimReuniao,
    dataInicioReuniao,
    // Roteamento multiempresa (Contexto 2 / playbook). Opcionais: se ausentes,
    // o funil roda 100% no agente legado (PJ Codeworks), comportamento atual.
    getContextoAtivoEmpresa,
    processarMensagemComPlaybook,
    // Modelo unificado: contexto ativo com estágios próprios (Núcleo + 5). Opcional.
    getContextoAtivoComEstagios,
    // Pause global do agente por empresa (config.agente_pausado). Opcional.
    empresaAgentePausada,
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
    'falha_resposta_automatica',
  ]
  const alertasGuardrailCriticoRecentes = new Map()
  
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

  function cloneJsonSeguro(value) {
    if (value == null) return value
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (_) {
      return null
    }
  }

  function truncarAuditoria(texto, max = 500) {
    const s = typeof texto === 'string' ? texto.trim() : String(texto ?? '').trim()
    if (!s) return ''
    return s.length > max ? `${s.slice(0, max)}...` : s
  }

  function textoPublicoAuditoria(resultado) {
    if (!resultado || typeof resultado !== 'object') return ''
    if (Array.isArray(resultado.mensagens_bolhas) && resultado.mensagens_bolhas.length) {
      return resultado.mensagens_bolhas
        .filter((m) => typeof m === 'string')
        .join('\n\n')
    }
    return typeof resultado.mensagem_pro_lead === 'string' ? resultado.mensagem_pro_lead : ''
  }

  function hashLeadId(numero) {
    return crypto
      .createHash('sha256')
      .update(String(numero || ''))
      .digest('hex')
      .slice(0, 16)
  }

  function resumirPerfilAuditoria(perfil = {}) {
    const p = perfil && typeof perfil === 'object' ? perfil : {}
    return cloneJsonSeguro({
      numero: p.numero ? String(p.numero).replace(/\d(?=\d{4})/g, '*') : undefined,
      nome: p.nome || p.apelido || undefined,
      negocio: p.negocio || p.businessType || null,
      cidade: p.cidade || p.city || p.regiao_atendimento || null,
      necessidade: p.necessidade || p.servico_principal || p.produto_sugerido || null,
      tem_site: p.tem_site ?? p.hasWebsite ?? p.maturidade_digital?.tem_site ?? null,
      origem_clientes: p.origem_clientes || p.canal_aquisicao || null,
      estagio: p.estagio || p.estado_comercial?.estagio_funil || null,
      intencao_principal: p.intencao_principal || null,
      projeto_sob_medida: p.projeto_sob_medida === true || p.sob_medida === true,
      reuniao_proposta: p.reuniao_proposta || null,
    })
  }

  function motivoAlertaOperador(erro) {
    if (!erro) return null
    if (typeof erro === 'string') return erro
    if (erro.alertaOperador === true) return erro.codigo || erro.erro || null
    return null
  }

  function notificarBloqueioCriticoGuardrail({ numero, perfil = {}, estagio, camada, motivos = [], trechoOriginal = '', acao = null } = {}) {
    if (typeof notificarVictorWhatsapp !== 'function') return
    const motivosLimpos = motivos.map(motivoAlertaOperador).filter(Boolean)
    if (!motivosLimpos.length) return

    const phone = String(numero || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    const chaveBase = JSON.stringify({
      n: phone || String(numero || ''),
      c: camada || 'guardrail',
      m: motivosLimpos,
      t: hashLeadId(trechoOriginal || ''),
    })
    const agora = Date.now()
    const anterior = alertasGuardrailCriticoRecentes.get(chaveBase)
    if (anterior && agora - anterior < 10 * 60 * 1000) return
    alertasGuardrailCriticoRecentes.set(chaveBase, agora)
    if (alertasGuardrailCriticoRecentes.size > 200) {
      for (const [k, ts] of alertasGuardrailCriticoRecentes) {
        if (agora - ts > 10 * 60 * 1000) alertasGuardrailCriticoRecentes.delete(k)
      }
    }

    const resumoLead = [
      perfil?.negocio || perfil?.businessType || null,
      perfil?.cidade || perfil?.regiao_atendimento || perfil?.city || null,
    ].filter(Boolean).join(' | ')
    const texto =
      'Alerta guardrail - resposta da IA bloqueada\n' +
      `Lead: ${phone || String(numero || '?')}\n` +
      `Etapa: ${estagio || '?'}${acao ? ` | Acao: ${acao}` : ''}\n` +
      (resumoLead ? `Contexto: ${resumoLead}\n` : '') +
      `Camada: ${camada || 'final'}\n` +
      `Motivo: ${motivosLimpos.join(', ')}\n` +
      `Trecho IA: ${truncarAuditoria(trechoOriginal, 260) || 'sem trecho'}\n` +
      'Acao: fallback seguro enviado; revisar a conversa no dashboard.'

    setImmediate(() => {
      notificarVictorWhatsapp(texto)
        .then((enviou) => {
          if (enviou && logger && typeof logger.info === 'function') {
            logger.info('[guardrail] operador notificado sobre bloqueio critico', {
              numero: String(numero || '').replace(/\d(?=\d{4})/g, '*'),
              camada,
              motivos: motivosLimpos,
            })
          }
        })
        .catch((e) => {
          if (logger && typeof logger.error === 'function') {
            logger.error('[guardrail] falha ao notificar operador sobre bloqueio critico:', e.message)
          }
        })
    })
  }

  function inferirPerguntouDado(decisao, resultado, mensagem = '') {
    const acao = String(decisao?.proxima_acao || '').toLowerCase()
    const texto = String(mensagem || resultado?.mensagem_pro_lead || '').toLowerCase()
    if (/coletar_tipo_negocio|tipo_negocio|negocio/.test(acao) || /qual .*neg[oó]cio|tipo do seu neg/.test(texto)) return 'negocio'
    if (/cidade|regiao/.test(acao) || /qual cidade|em qual cidade|regi[aã]o/.test(texto)) return 'cidade'
    if (/necessidade|servico|solucao/.test(acao) || /site, sistema|procura site|solu[cç][aã]o/.test(texto)) return 'necessidade'
    if (/canal_aquisicao|origem/.test(acao) || /indica[cç][aã]o|instagram|google|whatsapp/.test(texto)) return 'origem_clientes'
    if (/tem_site/.test(acao) || /j[aá] tem.*site|seria o primeiro/.test(texto)) return 'tem_site'
    return null
  }

  function registrarLogDecisaoTurno(auditoria) {
    if (!logger || typeof logger.info !== 'function') return
    const payload = cloneJsonSeguro(auditoria) || auditoria
    try {
      logger.info(payload, '[AI_DECISION_TURN]')
    } catch (_) {
      try {
        logger.info('[AI_DECISION_TURN]', payload)
      } catch (_) {}
    }
  }

  function registrarMetricasTurno(auditoria) {
    if (!logger || typeof logger.info !== 'function') return
    const metricas = {
      total_conversas: 1,
      respostas_bloqueadas_validador: auditoria?.resultadoValidador?.bloqueado ? 1 : 0,
      fallbacks_seguros: auditoria?.fallbackUsado ? 1 : 0,
      convites_reuniao: auditoria?.acaoDecidida === 'convite_reuniao' || auditoria?.acaoDecidida === 'consultar_agenda_e_oferecer_horarios' ? 1 : 0,
      reunioes_confirmadas: auditoria?.acaoDecidida === 'confirmacao_reuniao' || auditoria?.acaoDecidida === 'confirmar_reuniao' ? 1 : 0,
      pedidos_humanos: auditoria?.handoffAcionado ? 1 : 0,
      falhas_agenda: auditoria?.agendaFalhou ? 1 : 0,
      json_invalido_ia: auditoria?.jsonInvalidoIA ? 1 : 0,
    }
    try {
      logger.info({
        conversation_id: auditoria?.conversationId || null,
        lead_hash: auditoria?.leadHash || null,
        metricas,
      }, '[AI_PROD_METRICS]')
    } catch (_) {
      try {
        logger.info('[AI_PROD_METRICS]', { metricas })
      } catch (_) {}
    }
  }

  const MENSAGEM_AGENDA_INDISPONIVEL = 'Nao consegui consultar a agenda agora. Vou pedir para a equipe da PJ Codeworks verificar os proximos horarios e te chamar por aqui.'
  const MENSAGEM_PRECO_SITE_DIAGNOSTICO = 'Depende do tipo de site.\n\nUma pagina simples de apresentacao e diferente de uma estrutura mais completa com servicos, SEO local, integracao com WhatsApp e paginas especificas.\n\nPara eu te passar a direcao certa: voce quer algo mais simples para comecar ou uma estrutura mais completa para gerar contatos?'
  const MENSAGEM_SITE_ENTRADA = 'Perfeito. Para eu te orientar do jeito certo, me fala rapidinho:\n\n1. Qual e o seu negocio?\n2. Qual cidade ou regiao voce atende?\n3. O objetivo do site e mais apresentar a empresa, receber contatos pelo WhatsApp ou aparecer melhor no Google?'
  const MENSAGEM_LEAD_PESQUISANDO = 'Sem problema. Posso te orientar sem compromisso.\n\nNormalmente, para site, existem dois caminhos: uma estrutura mais simples para apresentar sua empresa e WhatsApp, ou algo mais completo para fortalecer presenca, servicos e conversao.\n\nVoce esta pesquisando mais para entender valores ou pensa em criar o site em breve?'
  const MENSAGEM_OPT_OUT = 'Tudo bem, sem problema. Vou encerrar por aqui para nao te incomodar.\n\nSe em outro momento fizer sentido criar um site ou alguma solucao digital, e so chamar.'
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
   * Da TOM DE IA a uma mensagem de reuniao mantendo os FATOS travados. A IA so
   * reescreve o texto; horarios, data, handoff, persistencia e criacao do evento
   * permanecem deterministicos. Valida que a IA preservou exatamente os horarios
   * e a data; se divergir (ou faltar gerarTextoIA), mantem o texto deterministico.
   * @returns {Promise<string|null>} novo texto aprovado, ou null pra manter o atual.
   */
  async function reformularTextoReuniaoComIA({ acao, textoBase, horariosObrig = [], dataObrig = null, perfil = {} }) {
    if (typeof gerarTextoIA !== 'function' || !textoBase) return null
    const fatos = []
    if (acao === 'convite_reuniao') {
      fatos.push(`- Horarios disponiveis (ofereca EXATAMENTE estes, nenhum outro): ${horariosObrig.join(', ')}`)
      if (dataObrig) fatos.push(`- Dia: ${dataObrig}`)
      fatos.push('- Termine perguntando qual horario fica melhor. No maximo 1 pergunta.')
    } else {
      if (horariosObrig[0]) fatos.push(`- Reuniao CONFIRMADA para ${dataObrig ? `o dia ${dataObrig} ` : ''}as ${horariosObrig[0]}.`)
      fatos.push('- Termine pedindo o melhor e-mail para enviar o convite. No maximo 1 pergunta.')
    }
    if (perfil && perfil.negocio) fatos.push(`- Negocio do lead: ${perfil.negocio}`)
    const system =
      'Voce e o assistente de vendas da PJ Codeworks no WhatsApp. Reescreva a mensagem de forma calorosa, humana e curta (no maximo 2 frases). Portugues brasileiro, sem markdown, sem bullets, sem emojis em excesso.'
    const user = [
      'Reescreva a mensagem abaixo mantendo EXATAMENTE os fatos. NUNCA invente, troque ou omita horario, dia ou valor. NUNCA cite preco em reais.',
      '',
      'FATOS OBRIGATORIOS:',
      ...fatos,
      '',
      `Mensagem base: "${textoBase}"`,
      '',
      'Responda somente com a mensagem final para o lead.',
    ].join('\n')
    const texto = await gerarTextoIA({
      system,
      user,
      maxTokens: 220,
      temperature: 0.5,
      task: acao === 'convite_reuniao' ? 'reformular_convite_reuniao' : 'reformular_confirmacao_reuniao',
    })
    if (!texto) return null
    // Validacao de fatos: todos os horarios obrigatorios presentes; nenhum
    // horario fora do conjunto; data presente (quando ha); sem preco.
    const setObrig = new Set(horariosObrig)
    const encontrados = horariosNoTexto(texto)
    const todosPresentes = horariosObrig.every((h) => texto.includes(h))
    const semExtras = encontrados.every((h) => setObrig.has(h))
    const dataOk = !dataObrig || dataObrig === 'a data combinada' || texto.includes(dataObrig)
    const semPreco = !/R\$\s*\d|\breais\b|entrada|parcela|\b3x\b|a partir de/i.test(texto)
    if (todosPresentes && semExtras && dataOk && semPreco) {
      logger.info(`[reuniao-ia] texto reformulado por IA aceito (${acao})`)
      return texto
    }
    logger.info(`[reuniao-ia] reformulacao rejeitada (fatos divergentes) — mantendo deterministico (${acao})`)
    return null
  }

  function etapaLegadaDaNova(etapa) {
    const map = {
      novo: 'primeiro_contato',
      coleta_basica: 'diagnostico',
      qualificacao_caminho: 'diagnostico',
      sob_medida_contexto: 'diagnostico',
      sob_medida_agenda_oferecida: 'proposta',
      reuniao_agendada: 'fechamento',
      handoff_humano: 'fechamento',
      encerrado: 'fechamento',
    }
    return map[etapa] || etapa || 'diagnostico'
  }

  function patchPerfilPorDecisao(decisao, perfil = {}, extra = {}) {
    const dados = decisao?.dados_extraidos || {}
    const patch = {}
    if (dados.negocio && !perfil.negocio) patch.negocio = dados.negocio
    if (dados.cidade && !perfil.cidade) patch.cidade = dados.cidade
    if (dados.necessidade && !perfil.produto_sugerido && !perfil.dor_principal) {
      patch.produto_sugerido = dados.necessidade
      patch.dor_principal = dados.necessidade
    }

    // eventos_conversa e o unico campo whitelisted onde origem_clientes pode
    // ser persistido (nao ha coluna dedicada; o canonicalizador le
    // `eventos.origem_clientes`). Sem gravar aqui, o dado se perdia a cada
    // turno e o funil repetia "como seus clientes te encontram?" em loop.
    const eventosAtuais = (perfil && perfil.eventos_conversa) || {}
    const jaTemOrigem = perfil.origem_clientes || perfil.canal_aquisicao || eventosAtuais.origem_clientes
    let eventosPatch = null
    if (dados.origem_clientes && !jaTemOrigem) {
      eventosPatch = { ...eventosAtuais, origem_clientes: dados.origem_clientes }
    }
    if (dados.objetivo_site && !eventosAtuais.objetivo_site && !perfil.objetivo_site) {
      eventosPatch = { ...(eventosPatch || eventosAtuais), objetivo_site: dados.objetivo_site }
    }

    if (decisao?.rota_comercial) {
      eventosPatch = {
        ...(eventosPatch || eventosAtuais),
        rota_comercial: decisao.rota_comercial,
        ultima_acao: decisao.acao_decidida,
      }
      if (decisao.rota_comercial === 'projeto_sob_medida' && extra.reuniao_proposta) {
        patch.reuniao_proposta = {
          ...((perfil && perfil.reuniao_proposta) || {}),
          necessaria: true,
          ...extra.reuniao_proposta,
        }
      }
    }
    if (eventosPatch) patch.eventos_conversa = eventosPatch
    return patch
  }

  function montarResumoHistorico(historico = []) {
    return normalizarHistoricoMensagens(historico)
      .slice(-8)
      .map((m) => {
        const role = m.role === 'assistant' ? 'bot' : (m.role === 'operator' ? 'operador' : 'lead')
        const texto = typeof m.content === 'string' ? m.content : String(m.content || '')
        return `${role}: ${texto.replace(/\s+/g, ' ').trim().slice(0, 180)}`
      })
      .filter((x) => !/:\s*$/.test(x))
      .join('\n')
  }

  function instrucaoAcaoParaLLM(acao) {
    // Guia curta enviada ao LLM junto com o contexto. Diz O QUE escrever
    // (nao a frase literal), deixando o tom e a personalizacao por conta
    // do modelo + tom-referencia.
    switch (acao) {
      case 'convite_reuniao':
        return 'Convide o lead para uma conversa rapida de ate 15 minutos com a equipe da PJ Codeworks e FECHE O HORARIO de forma assertiva e CURTA: em 1-2 bolhas curtas, proponha DOIS horarios concretos de "horarios_disponiveis" com o dia (data_label, ex.: "hoje"/"amanha") e peca para o lead escolher UM — ex.: "Consigo hoje as 20:00 ou 20:15 — qual fica melhor?". NAO escreva recapitulacao longa nem pergunte de forma aberta "que dia voce prefere?" sem dar opcoes concretas. USE APENAS os horarios de "horarios_disponiveis"; NUNCA invente horario ou dia. Cite o negocio do lead (perfil.negocio + perfil.cidade) so se couber em uma frase curta. Se dados_extraidos.horario indicar um horario fora dos slots, reconheca a proposta antes de reofertar (ex.: "Entendi, X. Pra alinhar com a janela da equipe..."). Tom leve e humano, nunca pressao.'
      case 'responder_preco_sem_contexto':
        return 'Explique brevemente que tem dois caminhos: assinatura de site (rapido) ou projeto sob medida (estrutura, sistema, automacao etc.). Pergunte qual faz mais sentido. NAO mencione valores em reais — preco so na reuniao.'
      case 'confirmacao_reuniao':
        return 'Confirme a reuniao agendada e peca o melhor email para enviar o convite.'
      case 'pedir_email':
        return 'Peca o email do lead de forma direta e simpatica para enviar o convite da reuniao.'
      case 'diagnostico':
        return 'Avance no diagnostico perguntando UM unico dado faltante (de dados_faltantes). Se o dado faltante for a "necessidade", apresente as opcoes de forma direta e simples: pergunte se o lead procura um site, um sistema ou um agente de IA (exatamente essas tres opcoes, sem menu longo). NUNCA repita uma pergunta que ja aparece no resumo_historico — se o lead ja respondeu algo, siga em frente. Se nao houver dado faltante, va para conexao de valor ou convite de reuniao.'
      case 'primeiro_contato':
        return 'Cumprimente curto (ex.: "Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋") e pergunte o tipo do negocio. Uma pergunta apenas.'
      case 'conexao_valor':
        return 'Conecte o que o lead disse com a solucao da PJ Codeworks. Termine perguntando como os clientes chegam hoje (Google/Instagram/indicacao).'
      case 'responder_duvida':
        return 'Responda direto a duvida do lead com base no historico. Se o lead perguntou "como funciona", explique de forma clara antes de coletar dados e depois reformule com simpatia, por exemplo: "Pelo que voce falou, parece que seria um site para o restaurante. E isso mesmo ou voce estava pensando em outra coisa?". Se houver pergunta pendente em turn_context ou acoes_proibidas incluir oferecer_reuniao, explique de forma clara e reformule a pergunta pendente com simpatia, sem avancar para reuniao. Se nao houver pergunta pendente, a duvida estiver resolvida e o perfil estiver completo, ofereca a reuniao.'
      case 'explicar_projeto_sob_medida':
        return 'Explique brevemente que projeto sob medida envolve sistema/automacao/estrutura personalizada. NAO mencione valores. Conduza para reuniao quando fizer sentido.'
      default:
        return null
    }
  }

  function montarContextoAcaoParaLLM({ decisao, perfil, etapaAtual, historico, horariosDisponiveis = [], slots = null, disponibilidade = null, observacaoAgenda = null }) {
    const canonico = canonicalizarPerfilLead(perfil, etapaAtual)
    const ultimaUser = [...normalizarHistoricoMensagens(historico)].reverse().find((m) => m?.role === 'user')
    const turnContext = buildTurnContext({
      historico,
      perfil,
      estagio: etapaAtual,
      mensagemAtual: ultimaUser ? String(ultimaUser.content || '').trim() : '',
    })
    return {
      acao_decidida: decisao.acao_decidida,
      etapa_atual: etapaAtual,
      etapa_sugerida: decisao.etapa_sugerida,
      rota_comercial: decisao.rota_comercial,
      perfil: canonico,
      dados_faltantes: decisao.dados_faltantes || [],
      dados_extraidos: decisao.dados_extraidos || {},
      horarios_disponiveis: horariosDisponiveis,
      data_label_agenda: slots?.data_label || null,
      data_sugerida_agenda: slots?.data_sugerida || null,
      agenda: slots,
      // Disponibilidade da semana (ate 7 dias uteis): a IA usa para oferecer
      // qualquer dia/horario da janela com flexibilidade. O codigo valida a
      // escolha ao vivo (validarSlotReuniao) antes de agendar.
      disponibilidade_semana: disponibilidade,
      observacao_agenda: observacaoAgenda || null,
      links_autorizados: [],
      acoes_proibidas: decisao.acoes_proibidas || [],
      ultima_pergunta: decisao.ultima_pergunta || '',
      turn_context: {
        turn_state: turnContext.turn_state,
        ultima_pergunta_bot: turnContext.ultima_pergunta_bot,
        resposta_contextual: turnContext.resposta_contextual,
        fact_memory: turnContext.fact_memory,
        action_policy: turnContext.action_policy,
      },
      turn_context_prompt: turnContext.prompt_block,
      instrucao_da_acao: instrucaoAcaoParaLLM(decisao.acao_decidida),
      resumo_historico: montarResumoHistorico(historico),
    }
  }

  function resultadoDeterministicoPorAcao(decisao, perfil, slots = null) {
    const etapa = etapaLegadaDaNova(decisao?.etapa_sugerida)
    if (!decisao) return null
    if (decisao.acao_decidida === 'opt_out') {
      return resultadoBase({
        mensagem_pro_lead: MENSAGEM_OPT_OUT,
        mensagens_bolhas: [MENSAGEM_OPT_OUT],
        atualizar_perfil: {
          ...patchPerfilPorDecisao(decisao, perfil),
        },
        etapa_proxima: 'opt_out',
        handoff: false,
        motivo_handoff: null,
      })
    }
    if (decisao.acao_decidida === 'lead_pesquisando') {
      return resultadoBase({
        mensagem_pro_lead: MENSAGEM_LEAD_PESQUISANDO,
        mensagens_bolhas: [MENSAGEM_LEAD_PESQUISANDO],
        atualizar_perfil: patchPerfilPorDecisao(decisao, perfil),
        etapa_proxima: 'diagnostico',
      })
    }
    if (decisao.acao_decidida === 'responder_preco_sem_contexto') {
      return resultadoBase({
        mensagem_pro_lead: MENSAGEM_PRECO_SITE_DIAGNOSTICO,
        mensagens_bolhas: [MENSAGEM_PRECO_SITE_DIAGNOSTICO],
        atualizar_perfil: patchPerfilPorDecisao(decisao, perfil),
        etapa_proxima: 'diagnostico',
      })
    }
    if (
      decisao.acao_decidida === 'primeiro_contato' &&
      decisao.dados_extraidos?.necessidade === 'site' &&
      (decisao.dados_faltantes || []).includes('negocio')
    ) {
      return resultadoBase({
        mensagem_pro_lead: MENSAGEM_SITE_ENTRADA,
        mensagens_bolhas: [MENSAGEM_SITE_ENTRADA],
        atualizar_perfil: patchPerfilPorDecisao(decisao, perfil),
        etapa_proxima: 'diagnostico',
      })
    }
    // Fase 3: conexao_valor NAO tem mais template deterministico. Cai no LLM, que
    // conecta negocio+cidade+necessidade lendo o contexto e fecha com a pergunta
    // de origem — sem repetir verbatim (regras anti-repeticao do prompt + validador).
    // O texto fixo era a raiz da repeticao robotica vista em producao.
    if (decisao.acao_decidida === 'pedido_humano') {
      return resultadoBase({
        mensagem_pro_lead: 'Claro. Vou chamar a equipe da PJ Codeworks para te ajudar diretamente por aqui.',
        mensagens_bolhas: ['Claro. Vou chamar a equipe da PJ Codeworks para te ajudar diretamente por aqui.'],
        atualizar_perfil: patchPerfilPorDecisao(decisao, perfil),
        etapa_proxima: etapa,
        handoff: true,
        motivo_handoff: 'lead_pediu_humano',
      })
    }
    // CONFIRMACAO DE REUNIAO — deterministica de proposito. O lead escolheu um
    // horario que JA foi oferecido; nao deixamos isso pro LLM porque a criacao do
    // evento na Agenda depende de gravar reuniao_proposta.horario_confirmado +
    // data_sugerida e disparar handoff com motivo 'agendou_reuniao_proposta'
    // (alertarHandoff cria o evento). Garante: confirmacao com data/hora + evento.
    if (decisao.acao_decidida === 'confirmacao_reuniao') {
      const reuniao =
        perfil && typeof perfil.reuniao_proposta === 'object' && perfil.reuniao_proposta
          ? perfil.reuniao_proposta
          : {}
      const parsed =
        typeof parsearHorarioReuniao === 'function'
          ? parsearHorarioReuniao(decisao.dados_extraidos?.horario || '')
          : null
      const horario = parsed?.normalizado || decisao.dados_extraidos?.horario || null
      // So confirma se o horario REALMENTE foi oferecido. Senao, retorna null e o
      // fluxo segue (LLM/validador re-oferecem a agenda real).
      if (horario && horarioFoiOferecido(horario, reuniao)) {
        const dataSugerida = reuniao.data_sugerida || reuniao.data_confirmada || null
        const dataInicio =
          typeof dataInicioReuniao === 'function' && parsed
            ? dataInicioReuniao(dataSugerida, parsed.hora, parsed.min)
            : null
        const dataFim =
          typeof calcularFimReuniao === 'function' && dataInicio ? calcularFimReuniao(dataInicio, 15) : null
        const dataLabel = formatarDataReuniao(dataSugerida)
        const reuniaoConfirmada = {
          ...reuniao,
          necessaria: true,
          horario_confirmado: horario,
          data_sugerida: dataSugerida,
          data_inicio: dataInicio ? dataInicio.toISOString() : null,
          data_fim: dataFim ? dataFim.toISOString() : null,
          duracao_maxima_minutos: 15,
        }
        const resumoHandoff =
          `Lead confirmou reuniao para ${dataSugerida || 'data combinada'} as ${horario}. ` +
          `Estagio: reuniao_agendada.` +
          (perfil?.preco_calculado
            ? ` Valor interno para a equipe: R$ ${perfil.preco_calculado}. Nao informado ao lead.`
            : '')
        return resultadoBase({
          mensagem_pro_lead:
            `Perfeito! Sua reunião está marcada para ${dataLabel} às ${horario} com a equipe da PJ Codeworks. ` +
            `Vai ser rápida, de até 15 minutos. Qual é o melhor e-mail para eu te enviar o convite?`,
          mensagens_bolhas: [
            `Perfeito! Sua reunião está marcada para ${dataLabel} às ${horario} com a equipe da PJ Codeworks — vai ser rápida, de até 15 minutos.`,
            'Qual é o melhor e-mail para eu te enviar o convite?',
          ],
          atualizar_perfil: {
            ...patchPerfilPorDecisao(decisao, perfil),
            reuniao_proposta: reuniaoConfirmada,
          },
          etapa_proxima: 'reuniao_agendada',
          handoff: true,
          motivo_handoff: 'agendou_reuniao_proposta',
          resumo_handoff: resumoHandoff,
        })
      }
    }
    // CONVITE DE REUNIAO — mensagem deterministica baseada NOS SLOTS REAIS
    // consultados na agenda. Garante que os horarios oferecidos ao lead sao
    // exatamente os disponiveis (sem o LLM variar/inventar horario). Os slots ja
    // foram persistidos em reuniao_proposta no upgrade consultar_agenda->convite.
    // No proximo turno o lead escolhe e confirmacao_reuniao (acima) fecha com
    // data/hora e dispara a criacao do evento na Agenda.
    if (decisao.acao_decidida === 'convite_reuniao' && slots && agendaTemSlots(slots)) {
      const intro =
        perfil && perfil.negocio
          ? 'Perfeito! Pra te mostrar na prática como a PJ Codeworks pode ajudar o seu negócio, dá pra alinhar numa conversa rápida de 15 minutos com a equipe.'
          : 'Perfeito! Pra te mostrar como ficaria na prática, dá pra alinhar numa conversa rápida de 15 minutos com a equipe da PJ Codeworks.'
      const msg = montarMensagemOfertaAgenda(slots, intro)
      return resultadoBase({
        mensagem_pro_lead: msg,
        mensagens_bolhas: [msg],
        atualizar_perfil: {
          ...patchPerfilPorDecisao(decisao, perfil),
          reuniao_proposta: {
            ...((perfil && perfil.reuniao_proposta) || {}),
            necessaria: true,
            data_sugerida: slots.data_sugerida,
            data_label: slots.data_label,
            horarios_sugeridos: horariosValidosAgenda(slots),
            horario_confirmado: null,
            duracao_maxima_minutos: 15,
          },
        },
        etapa_proxima: 'agendamento_pendente',
      })
    }
    // Demais acoes seguem no LLM (responder_preco_sem_contexto, diagnostico):
    // o LLM compoe a mensagem com base em perfil + historico. O validator barra
    // horario inventado, preco em rota sob_medida, re-greeting, repeticao, etc.
    // Atalho de erro tecnico: consultar_agenda quando a agenda FALHOU.
    if (decisao.acao_decidida === 'consultar_agenda' && slots && !agendaTemSlots(slots)) {
      return resultadoBase({
        mensagem_pro_lead: MENSAGEM_AGENDA_INDISPONIVEL,
        mensagens_bolhas: [MENSAGEM_AGENDA_INDISPONIVEL],
        atualizar_perfil: patchPerfilPorDecisao(decisao, perfil),
        etapa_proxima: 'diagnostico',
      })
    }
    return null
  }

  async function consultarSlotsAgendaSeguro(opts = {}) {
    const { __audit: audit, ...agendaOpts } = opts || {}
    if (typeof buscarSlotsDisponiveis !== 'function') {
      if (audit) {
        audit.horariosConsultados = []
        audit.agendaFalhou = true
      }
      return { data_sugerida: null, data_label: null, horarios_sugeridos: [], erro: 'agenda_nao_configurada' }
    }
    try {
      const slots = await buscarSlotsDisponiveis(agendaOpts)
      if (audit) {
        audit.horariosConsultados = horariosValidosAgenda(slots)
        audit.agendaFalhou = Boolean(slots?.erro)
      }
      return slots
    } catch (err) {
      logger.error('[AGENDA] buscarSlotsDisponiveis falhou; nenhum horario sera oferecido', { erro: err.message })
      if (audit) {
        audit.horariosConsultados = []
        audit.agendaFalhou = true
      }
      return { data_sugerida: null, data_label: null, horarios_sugeridos: [], erro: 'agenda_indisponivel' }
    }
  }

  async function resultadoAgendaPorDecisao(decisao, perfil, estagioLive, historico, audit = null) {
    if (!decisao || !decisao.deve_sobrescrever_modelo) return null
    if (decisao.resultado) return resultadoBase(decisao.resultado)
    if (decisao.proxima_acao === 'reagendar') {
      const slots = await consultarSlotsAgendaSeguro({ dataInicial: new Date(), quantidade: 2, __audit: audit })
      {
        const horarios = horariosValidosAgenda(slots)
        const intro = decisao.prioridade_aplicada === 'dados_minimos_coletados'
          ? 'Com essas informações, o ideal é uma conversa rápida com a equipe da PJ Codeworks para entender o escopo e te apresentar estrutura, prazo e investimento.'
          : 'Sem problema. Posso remarcar.'
        const frase = montarMensagemOfertaAgenda(slots, intro)
        return resultadoBase({
          mensagem_pro_lead: frase,
          atualizar_perfil: {
            intencao_principal: decisao.interpretacao.intencao_principal,
            estado_comercial: decisao.estado_comercial,
            reuniao_proposta: {
              ...((perfil && perfil.reuniao_proposta) || {}),
              necessaria: true,
              data_sugerida: agendaTemSlots(slots) ? slots.data_sugerida : null,
              horarios_sugeridos: horarios,
              horario_confirmado: null,
            },
          },
          etapa_proxima: 'agendamento_pendente',
        })
      }
    }
    if (decisao.proxima_acao === 'consultar_agenda_e_oferecer_horarios') {
      const slots = await consultarSlotsAgendaSeguro({ dataInicial: new Date(), quantidade: 2, __audit: audit })
      {
        const horarios = horariosValidosAgenda(slots)
        const veioDeAceiteConvite = decisao.prioridade_aplicada === 'aceite_convite_reuniao'
        const frase = montarMensagemOfertaAgenda(
          slots,
          veioDeAceiteConvite
            ? 'Perfeito. Vou verificar os proximos horarios disponiveis para uma conversa rapida com a equipe da PJ Codeworks.'
            : 'Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks te mostra estrutura, prazo e investimento na reunião, sem chute.'
        )
        return resultadoBase({
          mensagem_pro_lead: frase,
          atualizar_perfil: {
            intencao_principal: decisao.interpretacao.intencao_principal,
            estado_comercial: decisao.estado_comercial,
            projeto_sob_medida: true,
            eventos_conversa: {
              ...((perfil && perfil.eventos_conversa) || {}),
              ...(veioDeAceiteConvite ? { aceitou_convite_reuniao: true } : { perguntou_preco: true }),
            },
            reuniao_proposta: {
              ...((perfil && perfil.reuniao_proposta) || {}),
              necessaria: true,
              data_sugerida: agendaTemSlots(slots) ? slots.data_sugerida : null,
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
    }
    if (decisao.proxima_acao === 'confirmar_reuniao') {
      const parsed = typeof parsearHorarioReuniao === 'function'
        ? parsearHorarioReuniao(decisao.interpretacao?.dados_extraidos?.horario || '')
        : null
      const horario = parsed?.normalizado || decisao.interpretacao?.dados_extraidos?.horario
      const reuniao = (perfil && typeof perfil.reuniao_proposta === 'object') ? perfil.reuniao_proposta : {}
      {
        if (!horario || !horarioFoiOferecido(horario, reuniao)) {
          return resultadoBase({
            mensagem_pro_lead: MENSAGEM_AGENDA_INDISPONIVEL,
            atualizar_perfil: {
              intencao_principal: decisao.interpretacao.intencao_principal,
              estado_comercial: decisao.estado_comercial,
              reuniao_proposta: {
                ...reuniao,
                necessaria: true,
                horario_confirmado: null,
              },
            },
            etapa_proxima: 'agendamento_pendente',
          })
        }
        const dataSugeridaConfirmada = reuniao.data_sugerida || reuniao.data_confirmada || null
        const dataInicioConfirmada = typeof dataInicioReuniao === 'function' && dataSugeridaConfirmada && parsed
          ? dataInicioReuniao(dataSugeridaConfirmada, parsed.hora, parsed.min)
          : null
        const fimConfirmado = typeof calcularFimReuniao === 'function' && dataInicioConfirmada ? calcularFimReuniao(dataInicioConfirmada, 15) : null
        const dataLabel = formatarDataReuniao(dataSugeridaConfirmada)
        const perfilConfirmacao = {
          intencao_principal: decisao.interpretacao.intencao_principal,
          estado_comercial: decisao.estado_comercial,
          reuniao_proposta: {
            ...reuniao,
            necessaria: true,
            horario_confirmado: horario,
            data_sugerida: dataSugeridaConfirmada,
            data_inicio: dataInicioConfirmada ? dataInicioConfirmada.toISOString() : null,
            data_fim: fimConfirmado ? fimConfirmado.toISOString() : null,
            duracao_maxima_minutos: 15,
          },
        }
        const resumoHandoff = `Lead confirmou reuniao com a equipe da PJ Codeworks para ${dataSugeridaConfirmada || 'data sugerida'} as ${horario}. Estagio: ${estagioLive}. Intencao: escolha_horario. Valor interno para referencia da equipe: ${perfil?.preco_calculado ? `R$ ${perfil.preco_calculado}` : 'nao calculado'}. Nao foi informado ao lead.`
        if (decisao.deve_sobrescrever_modelo === false) {
          return {
            _merge_after: perfilConfirmacao,
            _force_fields: {
              handoff: true,
              motivo_handoff: 'agendou_reuniao_proposta',
              etapa_proxima: 'reuniao_agendada',
              resumo_handoff: resumoHandoff,
            },
            _contexto_confirmacao: { horario, dataLabel },
          }
        }
        return resultadoBase({
          mensagem_pro_lead: `Fechado: reunião marcada para ${dataLabel} às ${horario} com a equipe da PJ Codeworks. Vai ser uma conversa rápida, de até 15 minutos, para alinhar estrutura, prazo e investimento. Qual é o melhor e-mail para contato?`,
          atualizar_perfil: perfilConfirmacao,
          etapa_proxima: 'reuniao_agendada',
          handoff: true,
          motivo_handoff: 'agendou_reuniao_proposta',
          resumo_handoff: resumoHandoff,
        })
      }
    }
    return null
  }

  /**
   * Resposta para empresas com Contexto 2 (playbook) ATIVO — NÃO usa o agente
   * legado (prompts PJ Codeworks). Cada empresa responde com o próprio contexto.
   * Caminho aditivo: só é chamado quando getContextoAtivoEmpresa retorna playbook.
   * Limite v1: sem agenda/reunião automática nem follow-up rico (isso vive no
   * fluxo legado). Atende empresas novas/simples; handoff pausa a conversa.
   * @returns {Promise<{ ok: true, via: 'playbook' }|{ skipped: true, reason: string }>}
   */
  async function responderComPlaybookEmpresa({ numero, empresaId, conversaUsada, historico, estagioLive }) {
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

    // ── Agenda (reunião) v1 — reusa os helpers/booking do funil legado ────────
    // Mesma agenda/operador da PJ (decisão do produto). Aditivo: se o playbook
    // não sinalizar reunião, nada muda. Falha aqui não derruba a resposta.
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
    // Mantém o estágio atual (a progressão do playbook vive em lead_insights;
    // etapa_proxima é texto livre que normalizarEstagio coagiria). Em handoff,
    // pausa a conversa para um humano assumir.
    await salvarConversa(numero, historicoNovo, estagioLive, status, precisaHandoff ? true : undefined, empresaId, evolutionInstance)
    await limparFalhaResposta(numero).catch(() => {})
    logger.info(
      { empresa_id: empresaId, numero, etapa: res?.decisao?.etapa_proxima || estagioLive, handoff: precisaHandoff, via: 'playbook' },
      'Resposta multiempresa (Contexto 2) enviada'
    )
    return { ok: true, via: 'playbook' }
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

    const empresaIdConversa = conversaUsada?.empresa_id || null
    const evolutionInstanceConversa = conversaUsada?.evolution_instance || null
    const whatsappOpts = evolutionInstanceConversa ? { instanceName: evolutionInstanceConversa } : {}

    // ── Pause global do agente por empresa (config.agente_pausado) ────────────
    // Vale para PJ e para qualquer empresa: se a empresa está pausada, o agente
    // não responde automaticamente (a mensagem do lead já foi salva no webhook).
    // Fail-open: erro de leitura nunca bloqueia.
    if (empresaIdConversa && typeof empresaAgentePausada === 'function') {
      let pausado = false
      try {
        pausado = await empresaAgentePausada(empresaIdConversa)
      } catch (_) { pausado = false }
      if (pausado) {
        logger.info({ empresa_id: empresaIdConversa, numero }, 'Agente da empresa pausado — sem resposta automática')
        return { skipped: true, reason: 'empresa_agente_pausado' }
      }
    }

    // ── Modelo unificado: contexto ATIVO com estágios próprios ────────────────
    // Se a empresa tem um contexto ativo COM estágios salvos, o agente roda pelo
    // MESMO fluxo legado (agenda, follow-up, etc.), porém com Núcleo + estágio +
    // conhecimento DAQUELE contexto injetados no system prompt (via chamarClaudeTurno).
    let ctxEstagiosTurno = null
    if (empresaIdConversa && typeof getContextoAtivoComEstagios === 'function') {
      try {
        ctxEstagiosTurno = await getContextoAtivoComEstagios(pool, empresaIdConversa)
      } catch (e) {
        logger.warn({ err: e.message, empresa_id: empresaIdConversa }, 'Falha ao carregar contexto ativo com estágios — seguindo sem injeção')
        ctxEstagiosTurno = null
      }
    }

    // ── Roteamento de playbook (TRANSITÓRIO) ──────────────────────────────────
    // Só quando NÃO há contexto com estágios. Empresa com Contexto 2 ativo (sem
    // estágios) ainda responde pelo playbook. PJ sem nada cai no fluxo legado.
    if (
      !ctxEstagiosTurno &&
      empresaIdConversa &&
      typeof getContextoAtivoEmpresa === 'function' &&
      typeof processarMensagemComPlaybook === 'function'
    ) {
      let playbookAtivo = null
      try {
        playbookAtivo = await getContextoAtivoEmpresa(pool, empresaIdConversa)
      } catch (e) {
        logger.warn(
          { err: e.message, empresa_id: empresaIdConversa },
          'Falha ao checar Contexto 2 ativo — seguindo no agente legado'
        )
      }
      if (playbookAtivo) {
        return await responderComPlaybookEmpresa({
          numero,
          empresaId: empresaIdConversa,
          conversaUsada,
          historico,
          estagioLive,
        })
      }
    }

    // Toda chamada ao Claude deste turno injeta os estágios+conhecimento do
    // contexto ativo (quando houver). Sem contexto ativo, é o chamarClaude normal.
    const chamarClaudeTurno = (h, e, p, v, opc = {}) =>
      ctxEstagiosTurno
        ? chamarClaude(h, e, p, v, {
          ...opc,
          _flags_extras: { ...(opc && opc._flags_extras ? opc._flags_extras : {}), contextoEstagios: ctxEstagiosTurno },
        })
        : chamarClaude(h, e, p, v, opc)

    let perfil = await buscarPerfil(numero)
    if (!perfil.numero) perfil = { ...perfil, numero }
    const perfilAntesTurno = resumirPerfilAuditoria(perfil)
  
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
    // Orquestrador novo sempre ativo (flag NEXT_ACTION_ORCHESTRATOR_ENABLED
    // removida): a conversa roda pelo orquestrador + IA-primaria; o caminho
    // legado (templates fixos) nao e mais usado.
    const usarOrquestradorNovo = true
    const auditoriaTurno = {
      conversationId: conversaUsada?.id || conversaUsada?.conversation_id || hashLeadId(numero),
      leadId: hashLeadId(numero),
      leadHash: hashLeadId(numero),
      mensagemAtual: truncarAuditoria(textoUltimaMensagem),
      orquestradorNovoAtivo: usarOrquestradorNovo,
      perfilAntes: perfilAntesTurno,
      perfilDepois: null,
      dadosExtraidos: null,
      etapaAnterior: estagioLive,
      etapaNova: null,
      acaoDecidida: null,
      motivoDecisao: null,
      rotaComercial: null,
      perguntouDado: null,
      horariosConsultados: [],
      agendaFalhou: false,
      resultadoValidador: null,
      handoffAcionado: false,
      linkEnviado: false,
      fallbackUsado: false,
      jsonInvalidoIA: false,
      mensagensGeradas: [],
      mensagensEnviadas: [],
    }
    // Fase 2: o classificador IA roda 1x por turno e vira a extracao primaria do
    // orquestrador novo; o regex segue como fallback dentro de decidirProximaAcao.
    // A mesma analise alimenta o caminho legado (analiseIAPrecomputada), evitando
    // chamada dupla. So roda quando o orquestrador novo esta ativo. Passa pelo
    // mesmo recorte de eco da Fase 0, pra a IA tambem nao extrair da pergunta colada.
    let analiseIA = null
    if (usarOrquestradorNovo && typeof interpretarIntencaoMensagemIA === 'function') {
      const ecoClassif = separarEcoDaUltimaPergunta(textoUltimaMensagem, historico)
      const textoClassif = ecoClassif.ehEco ? ecoClassif.restante : textoUltimaMensagem
      if (textoClassif && textoClassif.trim()) {
        try {
          analiseIA = await interpretarIntencaoMensagemIA({
            texto: textoClassif,
            perfil,
            estagio: estagioLive,
            historico,
          })
        } catch (_) { analiseIA = null }
      }
    }
    let decisaoNova = usarOrquestradorNovo
      ? decidirProximaAcao({
        mensagemAtual: textoUltimaMensagem,
        historico,
        perfil,
        etapaAtual: estagioLive,
        ultimoContexto: conversaUsada || null,
        dadosExtraidosIA: analiseIA?.dados_extraidos || null,
      })
      : null
    let slotsNova = null
    let horariosDisponiveisNova = []
    if (usarOrquestradorNovo) {
      const patchInicial = patchPerfilPorDecisao(decisaoNova, perfil)
      if (Object.keys(patchInicial).length > 0) {
        const aplicado = await atualizarPerfil(numero, patchInicial)
        perfil = { ...perfil, ...aplicado }
      }
    }
    if (usarOrquestradorNovo && decisaoNova.acao_decidida === 'consultar_agenda') {
      // Se o lead pediu OUTRO dia ("so amanha", "semana que vem"), nao re-ofertamos
      // hoje: consultamos a partir do proximo dia util disponivel (amanha).
      const incluirHoje = decisaoNova.dados_extraidos?.preferencia_dia !== 'outro_dia'
      slotsNova = await consultarSlotsAgendaSeguro({ dataInicial: new Date(), quantidade: 2, incluirHoje, __audit: auditoriaTurno })
      horariosDisponiveisNova = horariosValidosAgenda(slotsNova)
      if (agendaTemSlots(slotsNova)) {
        decisaoNova = {
          ...decisaoNova,
          acao_decidida: 'convite_reuniao',
          dados_extraidos: {
            ...(decisaoNova.dados_extraidos || {}),
            data_sugerida: slotsNova.data_sugerida,
            horarios_sugeridos: horariosDisponiveisNova,
          },
          motivo_decisao: `${decisaoNova.motivo_decisao || 'agenda'};agenda_com_slots_reais`,
        }
        const aplicadoAgenda = await atualizarPerfil(numero, {
          reuniao_proposta: {
            ...((perfil && perfil.reuniao_proposta) || {}),
            necessaria: true,
            data_sugerida: slotsNova.data_sugerida,
            data_label: slotsNova.data_label,
            horarios_sugeridos: horariosDisponiveisNova,
            horario_confirmado: null,
            duracao_maxima_minutos: 15,
          },
          eventos_conversa: {
            ...((perfil && perfil.eventos_conversa) || {}),
            rota_comercial: 'projeto_sob_medida',
            ultima_acao: 'convite_reuniao',
          },
        })
        perfil = { ...perfil, ...aplicadoAgenda }
      } else if (slotsNova) {
        decisaoNova = {
          ...decisaoNova,
          etapa_sugerida: 'coleta_basica',
          motivo_decisao: `${decisaoNova.motivo_decisao || 'agenda'};agenda_indisponivel`,
        }
      }
    }
    if (usarOrquestradorNovo) {
      auditoriaTurno.dadosExtraidos = cloneJsonSeguro(decisaoNova.dados_extraidos || {})
      auditoriaTurno.acaoDecidida = decisaoNova.acao_decidida
      auditoriaTurno.motivoDecisao = decisaoNova.motivo_decisao
      auditoriaTurno.rotaComercial = decisaoNova.rota_comercial || null
    }
    // [REMOVIDO] chamada morta a decidirProximaResposta (caminho legado): com o
    // orquestrador novo sempre ativo, o resultado era SEMPRE descartado. Mantinha
    // a interpretacao legada por regex viva no fluxo de resposta a toa.
    // Funil IA-primaria (sempre ativo): a LLM conduz a conversa (estagio/dados/
    // mensagem saem do JSON dela; o programa so extrai). O deterministico fica
    // restrito a EXECUTAR agenda (horarios reais / confirmacao) — guardrail contra
    // horario inventado. As demais acoes caem na LLM consultiva, sem template fixo
    // e sem o contexto restritivo de acao.
    const acaoEhAgenda = ['convite_reuniao', 'confirmacao_reuniao', 'consultar_agenda']
      .includes(decisaoNova?.acao_decidida)
    const slotsPersistidos = Array.isArray(perfil?.reuniao_proposta?.horarios_sugeridos)
      ? perfil.reuniao_proposta.horarios_sugeridos.filter(Boolean)
      : []
    const temSlotsReais = agendaTemSlots(slotsNova) || slotsPersistidos.length > 0
    // A OFERTA de reuniao e a CAPTURA da escolha do lead passam pela IA: ela
    // recebe os slots REAIS no contexto (travados) e devolve reuniao_escolha no
    // JSON; o codigo valida contra os slots e agenda. So fica deterministico:
    //  - confirmacao por regex (horario explicito ja casado -> booking seguro);
    //  - agenda SEM slots reais (nao deixar a IA inventar horario -> msg de
    //    indisponivel).
    // Isso evita o loop em que "19 e30"/"o primeiro" nao casavam no regex e o
    // template determinIstico reofertava a mesma frase varias vezes.
    const manterDeterministicoAgenda = acaoEhAgenda && (
      decisaoNova?.acao_decidida === 'confirmacao_reuniao' || !temSlotsReais
    )
    // Oferta de reuniao ja feita e aguardando o lead escolher dia/horario. Nesse
    // estado, MESMO que o orquestrador roteie para uma acao nao-agenda, o lead
    // pode estar negociando o dia em linguagem natural ("queria segunda que vem",
    // "que dias tem?"). Tratamos como turno de agenda para a IA receber a
    // disponibilidade da semana e conseguir oferecer/confirmar o dia preferido.
    const ofertaPendente = slotsPersistidos.length > 0 && !perfil?.reuniao_proposta?.horario_confirmado
    const turnoDeAgenda = acaoEhAgenda || ofertaPendente
    const pularDeterministicoConversa = usarOrquestradorNovo && !turnoDeAgenda
    const resultadoNovoDireto = (usarOrquestradorNovo && manterDeterministicoAgenda)
      ? resultadoDeterministicoPorAcao(decisaoNova, perfil, slotsNova)
      : null
    // Disponibilidade da semana (ate 7 dias uteis) para a IA oferecer reuniao com
    // flexibilidade — sempre que a agenda vai pela IA ou ha oferta pendente.
    let disponibilidadeSemana = null
    if (usarOrquestradorNovo && turnoDeAgenda && !manterDeterministicoAgenda && typeof buscarDisponibilidadeSemana === 'function') {
      try {
        disponibilidadeSemana = await buscarDisponibilidadeSemana({ dataInicial: new Date(), dias: 7 })
      } catch (_) { disponibilidadeSemana = null }
    }
    // Quando o novo orquestrador esta ativo, NAO deixamos o caminho legado
    // (resultadoAgendaPorDecisao) sobrescrever a decisao do orquestrador.
    // Antes esse caminho era usado quando o atalho deterministico retornava
    // null — mas agora que removemos os atalhos de convite_reuniao /
    // responder_preco_sem_contexto, queremos que o
    // LLM componha a mensagem. Manter o legado aqui re-introduziria os
    // templates fixos.
    const resultadoDireto = resultadoNovoDireto
    if (resultadoNovoDireto) {
      resultado = resultadoNovoDireto
      logger.info(`nova arquitetura aplicou acao deterministica: ${decisaoNova.acao_decidida}`)
    } else {
    try {
      const nextActionContext = (usarOrquestradorNovo && !pularDeterministicoConversa)
        ? montarContextoAcaoParaLLM({
          decisao: decisaoNova,
          perfil,
          etapaAtual: estagioLive,
          historico,
          horariosDisponiveis: horariosDisponiveisNova,
          slots: slotsNova,
          disponibilidade: disponibilidadeSemana,
        })
        : null
      resultado = await chamarClaudeTurno(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
        stale_retry: opcoes?.stale_retry === true,
        ...(nextActionContext ? { nextActionContext } : {}),
      })
    } catch (parseErr) {
      if (/mensagem utilizável|JSON válido com mensagem/i.test(parseErr.message) && !opcoes?.parse_retry) {
        auditoriaTurno.jsonInvalidoIA = true
        logger.warn(`⚠️ modelo_parse — retry com max_tokens=4000 para ${numero}`)
        const nextActionContextRetry = (usarOrquestradorNovo && !pularDeterministicoConversa)
          ? montarContextoAcaoParaLLM({
            decisao: decisaoNova,
            perfil,
            etapaAtual: estagioLive,
            historico,
            horariosDisponiveis: horariosDisponiveisNova,
            slots: slotsNova,
            disponibilidade: disponibilidadeSemana,
          })
          : null
        resultado = await chamarClaudeTurno(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
          stale_retry: opcoes?.stale_retry === true,
          max_tokens_override: 4000,
          parse_retry: true,
          ...(nextActionContextRetry ? { nextActionContext: nextActionContextRetry } : {}),
        })
      } else {
        auditoriaTurno.jsonInvalidoIA = /mensagem utilizável|JSON válido|JSON/i.test(parseErr.message)
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

    // #2 REPARO DIRIGIDO (rede de seguranca da captura): turno de agenda, com slots
    // ja ofertados, o lead deu sinal de escolha, mas a IA NAO devolveu reuniao_escolha.
    // Re-chama UMA vez (cap AI_REPAIR_MAX_RETRIES, default 1) pedindo o campo, e o bloco
    // abaixo processa normalmente. Logado p/ medir custo por retry. Cobre o fallback
    // Anthropic e qualquer caso em que o Structured Outputs nao se aplique.
    const maxRepair = (() => {
      const n = parseInt(process.env.AI_REPAIR_MAX_RETRIES, 10)
      return Number.isFinite(n) ? Math.max(0, n) : 1
    })()
    const leadDeuSinalEscolha = /(\bsim\b|\bpode\b|\bok\b|\bisso\b|fechad|combinad|\d)/i.test(String(textoUltimaMensagem || ''))
    if (
      maxRepair > 0 && !resultadoNovoDireto && turnoDeAgenda &&
      slotsPersistidos.length > 0 && !(resultado && resultado.reuniao_escolha) &&
      !perfil?.reuniao_proposta?.horario_confirmado && leadDeuSinalEscolha
    ) {
      const numMasc = String(numero).replace(/\d(?=\d{4})/g, '*')
      logger.info(`[ai-repair] retry=1 motivo=reuniao_escolha_ausente numero=${numMasc} (max=${maxRepair})`)
      try {
        const ctxRep = montarContextoAcaoParaLLM({
          decisao: { ...decisaoNova, acao_decidida: 'confirmacao_reuniao', etapa_sugerida: 'agendamento_pendente' },
          perfil,
          etapaAtual: estagioLive,
          historico,
          horariosDisponiveis: horariosDisponiveisNova,
          slots: slotsNova,
          disponibilidade: disponibilidadeSemana,
          observacaoAgenda: `O lead parece ter escolhido um horario, mas voce NAO devolveu reuniao_escolha. Se ele escolheu um dos horarios ofertados (${slotsPersistidos.join(', ')}), devolva reuniao_escolha {data, horario} com esse horario. Se NAO escolheu, conduza normalmente (sem inventar horario).`,
        })
        const repRes = await chamarClaudeTurno(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
          stale_retry: opcoes?.stale_retry === true,
          nextActionContext: ctxRep,
        })
        if (repRes && repRes.reuniao_escolha) {
          resultado = repRes
          auditoriaTurno.acaoDecidida = 'reuniao_escolha_reparada'
        }
        auditoriaTurno.repairRetry = (auditoriaTurno.repairRetry || 0) + 1
      } catch (eRep) {
        logger.warn(`[ai-repair] reparo de reuniao_escolha falhou: ${eRep.message}`)
      }
    }

    // AGENDA POR IA: a LLM conversa com o lead sobre dia/horario e captura a
    // escolha no JSON (`reuniao_escolha: { data, horario }`). O CODIGO valida o
    // horario contra os slots REAIS ofertados (persistidos em
    // reuniao_proposta.horarios_sugeridos no turno da oferta) e so entao agenda.
    // Guardrail: a IA conduz a conversa livremente, mas nunca marca um horario que
    // nao saiu da lista real. Cobre a linguagem natural ("o primeiro", "pode a
    // noite") que o regex de confirmacao do orquestrador nao pega; o regex segue
    // como rede para horarios explicitos ("19:30").
    // Guard anti-autoconflito: se o lead JÁ tem reunião confirmada nesse mesmo
    // horário, o modelo (com Structured Outputs/prompt) pode re-emitir
    // reuniao_escolha repetindo o horário. Reprocessar faria validarSlotReuniao ver
    // o PRÓPRIO evento do lead como "ocupado" → reoferta falsa ("X já foi preenchido"
    // logo após confirmar). Nesse caso, ignoramos a re-emissão (já está agendado).
    const escolhaRepeteConfirmado = (() => {
      const rp = perfil && typeof perfil.reuniao_proposta === 'object' ? perfil.reuniao_proposta : null
      if (!rp || !rp.horario_confirmado || !resultado || !resultado.reuniao_escolha) return false
      const h = (typeof parsearHorarioReuniao === 'function'
        ? parsearHorarioReuniao(resultado.reuniao_escolha.horario || '')?.normalizado
        : null) || resultado.reuniao_escolha.horario || null
      return h === rp.horario_confirmado
    })()
    if (escolhaRepeteConfirmado) {
      logger.info('[agenda-ia] reuniao_escolha repete horario ja confirmado — ignorando (sem revalidar/reofertar)')
    }
    if (resultado && resultado.reuniao_escolha && !resultadoNovoDireto && !escolhaRepeteConfirmado) {
      const rpAtual = (perfil && typeof perfil.reuniao_proposta === 'object' && perfil.reuniao_proposta) || {}
      const ofertados = Array.isArray(rpAtual.horarios_sugeridos) ? rpAtual.horarios_sugeridos.filter(Boolean) : []
      const parsedEscolha = typeof parsearHorarioReuniao === 'function'
        ? parsearHorarioReuniao(resultado.reuniao_escolha.horario || '')
        : null
      const horarioEscolhido = parsedEscolha?.normalizado || resultado.reuniao_escolha.horario || null
      const escolhaData = resultado.reuniao_escolha.data || rpAtual.data_sugerida || null
      // Gate AO VIVO e autoritativo: so agenda horario que esteja REALMENTE livre na
      // agenda agora (validarSlotReuniao consulta o banco). Cobre tanto o slot ja
      // ofertado quanto outro dia/horario da janela (flexibilidade de ate 7 dias) e
      // pega o caso "ofertado mas ocupado nesse meio-tempo" antes de confirmar.
      let escolhaValida = false
      if (horarioEscolhido && escolhaData && typeof validarSlotReuniao === 'function') {
        try {
          escolhaValida = await validarSlotReuniao({ data: escolhaData, horario: horarioEscolhido })
        } catch (_) { escolhaValida = false }
      } else if (
        horarioEscolhido && ofertados.includes(horarioEscolhido) &&
        (!resultado.reuniao_escolha.data || resultado.reuniao_escolha.data === rpAtual.data_sugerida)
      ) {
        // Sem validador disponivel: aceita se bate com um slot ja ofertado.
        escolhaValida = true
      }
      if (escolhaValida) {
        const dataSugerida = escolhaData
        const dataInicio = (typeof dataInicioReuniao === 'function' && parsedEscolha)
          ? dataInicioReuniao(dataSugerida, parsedEscolha.hora, parsedEscolha.min)
          : null
        const dataFim = (typeof calcularFimReuniao === 'function' && dataInicio) ? calcularFimReuniao(dataInicio, 15) : null
        resultado.atualizar_perfil = {
          ...(resultado.atualizar_perfil || {}),
          reuniao_proposta: {
            ...rpAtual,
            necessaria: true,
            horario_confirmado: horarioEscolhido,
            data_sugerida: dataSugerida,
            data_inicio: dataInicio ? dataInicio.toISOString() : null,
            data_fim: dataFim ? dataFim.toISOString() : null,
            duracao_maxima_minutos: 15,
          },
        }
        resultado.handoff = true
        resultado.motivo_handoff = 'agendou_reuniao_proposta'
        resultado.etapa_proxima = 'reuniao_agendada'
        resultado.resumo_handoff = resultado.resumo_handoff
          || `Lead confirmou reuniao para ${dataSugerida || 'data combinada'} as ${horarioEscolhido} (escolha capturada pela IA).`
        // Alinha a decisao/perfil para o validador tratar como confirmacao legitima
        // (horario ja validado contra a agenda real acima).
        decisaoNova.acao_decidida = 'confirmacao_reuniao'
        decisaoNova.dados_extraidos = { ...(decisaoNova.dados_extraidos || {}), horario: horarioEscolhido }
        perfil = { ...perfil, horarios_oferecidos: [...new Set([...ofertados, horarioEscolhido])] }
        auditoriaTurno.acaoDecidida = 'confirmacao_reuniao_ia'
        logger.info(`[agenda-ia] escolha do JSON validada e agendada: ${horarioEscolhido} (${dataSugerida || 's/data'})`)
      } else {
        // O horario pedido nao esta livre (ja foi preenchido ou fora da janela).
        // NAO deixamos sair uma confirmacao falsa: regeneramos o turno pela IA com
        // disponibilidade FRESCA e uma instrucao corretiva. A IA escreve a reoferta
        // (sem template) avisando que o horario nao esta mais livre, oferece os reais
        // e segue tratando qualquer outra duvida do cliente — sem travar na agenda.
        logger.info(`[agenda-ia] reuniao_escolha indisponivel — regenerando reoferta via IA: ${horarioEscolhido || '?'} em ${escolhaData || 's/data'} (ofertados: [${ofertados.join(', ')}])`)
        let dispFresca = disponibilidadeSemana
        if (typeof buscarDisponibilidadeSemana === 'function') {
          try { dispFresca = await buscarDisponibilidadeSemana({ dataInicial: new Date(), dias: 7 }) } catch (_) {}
        }
        const observacaoAgenda =
          `O cliente pediu ${horarioEscolhido || 'um horario'}${escolhaData ? ` em ${escolhaData}` : ''}, ` +
          'mas esse horario NAO esta mais disponivel na agenda. Avise com naturalidade que ele ja foi ' +
          'preenchido, ofereca os horarios reais de disponibilidade_semana e pergunte qual prefere ' +
          '(NAO confirme nenhum horario agora). Se o cliente deixou outra duvida em aberto, responda ' +
          'tambem — nao trave so na agenda.'
        try {
          const decisaoReoferta = { ...decisaoNova, acao_decidida: 'consultar_agenda', etapa_sugerida: 'agendamento_pendente' }
          const ctxReoferta = montarContextoAcaoParaLLM({
            decisao: decisaoReoferta,
            perfil,
            etapaAtual: estagioLive,
            historico,
            horariosDisponiveis: horariosDisponiveisNova,
            slots: slotsNova,
            disponibilidade: dispFresca,
            observacaoAgenda,
          })
          resultado = await chamarClaudeTurno(historicoParaClaude, estagioLive, perfil, visaoUltimaMensagem, {
            stale_retry: opcoes?.stale_retry === true,
            nextActionContext: ctxReoferta,
          })
          decisaoNova.acao_decidida = 'consultar_agenda'
          auditoriaTurno.acaoDecidida = 'reoferta_agenda_ia'
        } catch (eReoferta) {
          logger.warn(`[agenda-ia] falha ao regenerar reoferta de agenda: ${eReoferta.message}`)
        }
      }
    }

    // VALIDADOR FINAL (defesa em profundidade — ponto unico antes de enviar).
    // Sanitiza problemas de texto e bloqueia apenas riscos criticos: dados sensiveis,
    // pagamento/Pix/cartao, link nao autorizado, JSON/handoff interno ou horario
    // confirmado indevidamente.
    if (usarOrquestradorNovo) {
      const trechoOriginalAcao = textoPublicoAuditoria(resultado)
      const validacaoAcao = validarRespostaPorAcao(resultado, {
        decisao: decisaoNova,
        perfil,
        etapaAtual: estagioLive,
        mensagemAtual: textoUltimaMensagem,
        dados_extraidos: decisaoNova.dados_extraidos || {},
        horarios_disponiveis: horariosDisponiveisNova,
        horario_escolhido: decisaoNova.dados_extraidos?.horario || null,
        historico,
        numero,
      })
      auditoriaTurno.resultadoValidador = {
        camada: 'acao',
        bloqueado: validacaoAcao.bloqueado,
        erros: validacaoAcao.erros.map((e) => e.erro),
      }
      if (validacaoAcao.bloqueado) {
        auditoriaTurno.fallbackUsado = true
        notificarBloqueioCriticoGuardrail({
          numero,
          perfil,
          estagio: estagioLive,
          camada: 'acao',
          acao: decisaoNova.acao_decidida,
          motivos: validacaoAcao.motivosAlertaOperador || [],
          trechoOriginal: trechoOriginalAcao,
        })
        logger.warn('[validador-acao] resposta bloqueada pela nova arquitetura', {
          numero: String(numero || '').replace(/\d(?=\d{4})/g, '*'),
          acao: decisaoNova.acao_decidida,
          motivos: validacaoAcao.erros.map((e) => e.erro),
        })
      }
      resultado = validacaoAcao.resultado
    }

    if (typeof validarRespostaAntesDeEnviar === 'function') {
      const numeroMascarado = String(numero || '').replace(/\d(?=\d{4})/g, '*')
      const relatorio = validarRespostaAntesDeEnviar(resultado, perfil, {
        contexto: { estagio: estagioLive, numero },
        onErro: ({ erros, trechoOriginal }) => {
          auditoriaTurno.fallbackUsado = true
          notificarBloqueioCriticoGuardrail({
            numero,
            perfil,
            estagio: estagioLive,
            camada: 'final',
            motivos: erros,
            trechoOriginal,
          })
          logger.warn('[validador] resposta bloqueada pelo validador final', {
            numero: numeroMascarado,
            estagio: estagioLive,
            motivos: erros.map((e) => ({ campo: e.campo, erro: e.erro })),
            trecho: trechoOriginal,
            fallback_usado: true,
          })
        },
      })

      // Tenta regenerar 1x com instrução de correção quando:
      //   - a resposta foi bloqueada
      //   - o resultado veio do Claude (não da pipeline determinística)
      //   - não é já uma tentativa de correção
      logger.info(`[AI_SEND_GUARD] blocked raw json leak: ${relatorio.erros.some((e) => /JSON bruto|schema interno/i.test(e.erro))}`)
      logger.info('[AI_SEND_GUARD] channel: whatsapp')
      auditoriaTurno.resultadoValidador = {
        camada: auditoriaTurno.resultadoValidador?.camada || 'final',
        bloqueado: Boolean(auditoriaTurno.resultadoValidador?.bloqueado || relatorio.bloqueado),
        erros: [
          ...((auditoriaTurno.resultadoValidador && auditoriaTurno.resultadoValidador.erros) || []),
          ...relatorio.erros.map((e) => e.erro),
        ],
      }
      if (relatorio.bloqueado) auditoriaTurno.fallbackUsado = true
      const veioDoModelo = !resultadoNovoDireto && !(resultadoDireto && decisaoNova?.deve_sobrescrever_modelo)
      if (relatorio.shouldRegenerate && veioDoModelo && !opcoes?.correction_retry) {
        const motivosBloco = relatorio.erros.map((e) => e.erro).slice(0, 3).join('; ')
        const instrucaoCorrecao =
          `CORREÇÃO OBRIGATÓRIA: Resposta anterior recusada por: ${motivosBloco}. ` +
          `Responda SOMENTE com JSON válido. Proibido: pedir CPF/CNPJ/endereco/pagamento, enviar Pix/cartao, link nao autorizado, confirmar horario que nao foi oferecido ou vazar JSON/handoff interno. ` +
          `Campo mensagem_pro_lead: mensagem publica curta e segura.`
        try {
          logger.warn('[validador] tentando regenerar resposta bloqueada', { numero: numeroMascarado, estagio: estagioLive })
          const histCorrecao = historicoComInstrucaoOperadorParaClaude(historicoParaClaude, instrucaoCorrecao)
          const resultadoCorrigido = await chamarClaudeTurno(histCorrecao, estagioLive, perfil, visaoUltimaMensagem, {
            stale_retry: false,
            correction_retry: true,
            max_tokens_override: 800,
          })
          const relatorioCorrigido = validarRespostaAntesDeEnviar(resultadoCorrigido, perfil, {
            contexto: { estagio: estagioLive, numero },
            onErro: ({ erros }) => {
              notificarBloqueioCriticoGuardrail({
                numero,
                perfil,
                estagio: estagioLive,
                camada: 'final_retry',
                motivos: erros,
                trechoOriginal: textoPublicoAuditoria(resultadoCorrigido),
              })
              logger.warn('[validador] resposta de correção também bloqueada — usando fallback', {
                numero: numeroMascarado,
                estagio: estagioLive,
                motivos: erros.map((e) => e.erro),
              })
            },
          })
          resultado = relatorioCorrigido.resultado
          if (!relatorioCorrigido.bloqueado) {
            logger.info('[validador] resposta corrigida aceita após retry de correção', { numero: numeroMascarado })
          }
        } catch (corrErr) {
          logger.error('[validador] retry de correção falhou — usando fallback do validador original', {
            numero: numeroMascarado,
            erro: corrErr.message,
          })
          resultado = relatorio.resultado
        }
      } else {
        resultado = relatorio.resultado
      }
    }
  
    if (Object.keys(resultado.atualizar_perfil || {}).length > 0) {
      const aplicadoPerfil = await atualizarPerfil(numero, resultado.atualizar_perfil)
      perfil = { ...perfil, ...aplicadoPerfil }
    }

    // SINAIS DO LEAD (IA): captura por turno em resultado.insights_lead. O código
    // acumula (escalares: sobrescreve só se vier preenchido; arrays: união + dedup) e
    // grava insights_lead (JSONB, replace) + score_lead (0-100). Sem inventar — só o
    // que a IA devolveu. Não bloqueia o turno se falhar.
    try {
      const patchInsights = mesclarInsightsLead(perfil?.insights_lead, resultado.insights_lead)
      if (patchInsights) {
        const aplicadoInsights = await atualizarPerfil(numero, patchInsights)
        perfil = { ...perfil, ...aplicadoInsights }
      }
    } catch (eIns) {
      logger.warn('insights_lead merge/persist falhou:', eIns.message)
    }

    const motivoNorm = normalizarMotivoHandoff(resultado.motivo_handoff)
    auditoriaTurno.handoffAcionado = Boolean(resultado.handoff)
    auditoriaTurno.linkEnviado = false
    auditoriaTurno.fallbackUsado = Boolean(
      auditoriaTurno.fallbackUsado ||
      resultado.__fallback_usado === true ||
      (auditoriaTurno.resultadoValidador && auditoriaTurno.resultadoValidador.bloqueado)
    )

    // TOM DE IA na oferta/confirmacao de reuniao — SO o texto. Os fatos
    // (horarios, data, handoff, persistencia, evento na Agenda) ja foram
    // travados deterministicamente acima. So reescrevemos quando o resultado
    // determinIstico passou limpo (sem fallback do validador); se a IA divergir
    // dos fatos, mantemos o texto deterministico.
    if (
      resultadoNovoDireto &&
      !auditoriaTurno.fallbackUsado &&
      (decisaoNova.acao_decidida === 'convite_reuniao' || decisaoNova.acao_decidida === 'confirmacao_reuniao')
    ) {
      const rp = (resultado.atualizar_perfil && resultado.atualizar_perfil.reuniao_proposta) || {}
      const ehConvite = decisaoNova.acao_decidida === 'convite_reuniao'
      const horariosObrig = ehConvite
        ? horariosValidosAgenda(slotsNova)
        : (rp.horario_confirmado ? [rp.horario_confirmado] : [])
      const dataObrig = ehConvite
        ? (slotsNova?.data_label || formatarDataReuniao(slotsNova?.data_sugerida))
        : formatarDataReuniao(rp.data_sugerida)
      const textoIA = await reformularTextoReuniaoComIA({
        acao: decisaoNova.acao_decidida,
        textoBase: resultado.mensagem_pro_lead,
        horariosObrig,
        dataObrig,
        perfil,
      })
      if (textoIA) {
        resultado.mensagem_pro_lead = textoIA
        resultado.mensagens_bolhas = [textoIA]
      }
    }

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
        const slots = await consultarSlotsAgendaSeguro({ dataInicial: new Date(), quantidade: 2, __audit: auditoriaTurno })
        {
          const horariosSeguros = horariosValidosAgenda(slots)
          resultado.mensagem_pro_lead = montarMensagemOfertaAgenda(
            slots,
            'Boa pergunta. Como é um projeto sob medida, o valor depende da estrutura que sua empresa precisa.\n\nA equipe da PJ Codeworks te mostra estrutura, prazo e investimento na reunião, sem chute.'
          )
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
              data_sugerida: agendaTemSlots(slots) ? slots.data_sugerida : null,
              horarios_sugeridos: horariosSeguros,
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
  
    const etapaEnvio = estagioLive === 'primeiro_contato'
      ? 'primeiro_contato'
      : (resultado.etapa_proxima || estagioLive)
    const bolhasSanitizadas =
      Array.isArray(resultado.mensagens_bolhas) && resultado.mensagens_bolhas.length > 0
        ? limitarBolhasPorEtapa({
            etapa: etapaEnvio,
            mensagens: resultado.mensagens_bolhas,
          })
            .map((x) => sanitizarTermosInternosParaLead(
              sanitizarMencoesPessoaParaEquipe(
                sanitizarPlaceholderEmpresaNaSaidaTexto(sanitizarCpfNaSaidaTexto(String(x || '').trim()))
              )
            ))
            .filter((x) => x.length > 0)
        : null
    auditoriaTurno.etapaNova = resultado.etapa_proxima || estagioLive
    auditoriaTurno.perguntouDado = inferirPerguntouDado(decisaoNova, resultado, textoResposta)
    auditoriaTurno.rotaComercial = auditoriaTurno.rotaComercial ||
      perfil?.eventos_conversa?.rota_comercial ||
      resultado?.atualizar_perfil?.eventos_conversa?.rota_comercial ||
      null
    auditoriaTurno.mensagensGeradas = (
      bolhasSanitizadas && bolhasSanitizadas.length > 0
        ? bolhasSanitizadas
        : dividirTextoPorQuebrasHeuristico(textoResposta, etapaEnvio)
    ).map((msg) => truncarAuditoria(msg))
  
    if (typeof resultado.enviar_print === 'string' && resultado.enviar_print.trim()) {
      const captionPrint = typeof resultado.caption_print === 'string' && resultado.caption_print.trim()
        ? resultado.caption_print.trim()
        : ''
      await enviarPrintLocal(numero, resultado.enviar_print.trim(), captionPrint, whatsappOpts).catch(
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
  
    // Fluxo de "aprovação de valor" removido (2026-06-06): o projeto não tem
    // aprovação — só reunião agendada com prévia de valor (uso interno do operador).
    // A mensagem da IA nunca mais é retida aguardando OK.
    const reterMensagemParaAprovacao = false
    const mensagensEnviadasAuditoria = []
  
    if (!reterMensagemParaAprovacao) {
      const botoes = extrairBotoes(textoRespostaBruto)
      const bolhasModelo = bolhasSanitizadas && bolhasSanitizadas.length > 0
  
      if (botoes) {
        await enviarComBotoes(numero, textoResposta, botoes, whatsappOpts)
        mensagensEnviadasAuditoria.push(textoResposta)
        if (linksExtra.length > 0) {
          await enviarMensagem(numero, linksExtra.join('\n'), whatsappOpts)
          mensagensEnviadasAuditoria.push(linksExtra.join('\n'))
        }
      } else if (bolhasModelo) {
        await enviarSequenciaMensagens(numero, bolhasSanitizadas, whatsappOpts)
        mensagensEnviadasAuditoria.push(...bolhasSanitizadas)
        if (linksExtra.length > 0) {
          await enviarMensagem(numero, linksExtra.join('\n'), whatsappOpts)
          mensagensEnviadasAuditoria.push(linksExtra.join('\n'))
        }
      } else {
        const partesHeur = dividirTextoPorQuebrasHeuristico(textoResposta, etapaEnvio)
        if (partesHeur.length > 1) {
          await enviarSequenciaMensagens(numero, partesHeur, whatsappOpts)
          mensagensEnviadasAuditoria.push(...partesHeur)
          if (linksExtra.length > 0) {
            await enviarMensagem(numero, linksExtra.join('\n'), whatsappOpts)
            mensagensEnviadasAuditoria.push(linksExtra.join('\n'))
          }
        } else {
          await enviarMensagem(numero, textoHistoricoAssist, whatsappOpts)
          mensagensEnviadasAuditoria.push(textoHistoricoAssist)
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
              instanceName: evolutionInstanceConversa,
            })
          } catch (e) {
            logger.error('Preview de site falhou:', e.response?.data || e.message)
            const fallbackPreview =
              'Tentei montar a previa visual agora, mas nao consegui gerar a imagem nesse momento. Vamos continuar a conversa normalmente.'
            await enviarMensagem(
              numero,
              fallbackPreview,
              whatsappOpts
            ).catch(() => {})
            mensagensEnviadasAuditoria.push(fallbackPreview)
          }
        }
      }
    } else {
      logger.info(`⏸️  Mensagem retida (aprovacao_valor) — aguardando OK do Operador`)
      respostaEnviadaAoLead = false
    }
    try {
      logger.info(`✉️  [${resultado.etapa_proxima || estagioLive}] Resposta enviada`)
  
      auditoriaTurno.mensagensEnviadas = mensagensEnviadasAuditoria.map((msg) => truncarAuditoria(msg))
      auditoriaTurno.perfilDepois = resumirPerfilAuditoria(perfil)
      registrarLogDecisaoTurno(auditoriaTurno)
      registrarMetricasTurno(auditoriaTurno)
      await salvarConversa(
        numero,
        historicoNovo,
        resultado.etapa_proxima || estagioLive,
        novoStatus,
        undefined,
        empresaIdConversa,
        evolutionInstanceConversa
      )
      await limparFalhaResposta(numero)

      // Opt-out: arquiva a conversa para retirá-la do follow-up automático
      // (a elegibilidade exige arquivado=false). Substitui o antigo
      // followup_enabled (campo inexistente, descartado pela whitelist).
      if (resultado.etapa_proxima === 'opt_out') {
        await pool.query(
          `UPDATE vendas.conversas
           SET arquivado = true, motivo_arquivamento = 'opt_out', arquivado_em = NOW()
           WHERE numero = $1 AND COALESCE(arquivado, false) = false`,
          [numero]
        )
      }
  
      if (respostaEnviadaAoLead && !precisaHandoff && resultado.agendar_followup_auto) {
        try {
          await persistirAgendamentoFollowupExplicito(
            numero,
            resultado.agendar_followup_auto,
            resultado.etapa_proxima || estagioLive,
            historico
          )
        } catch (e) {
          logger.error('Erro ao agendar follow-up explicito:', e.message)
        }
      }

      // Sinal de conversa marcado pela IA (padrão IA-decide / código-executa):
      //  - 'desinteresse' → encerra: arquiva (sai do follow-up automático, igual opt-out).
      //  - 'adiamento' → garante RETOMADA: agenda follow-up p/ o próximo dia (~10h BRT)
      //    quando a IA não emitiu um agendamento explícito. Passa historico=null de
      //    propósito p/ NÃO cair no auto-cancel do fallback (a IA já decidiu que é adiamento).
      try {
        if (resultado.sinal_conversa === 'desinteresse') {
          await pool.query(
            `UPDATE vendas.conversas
             SET arquivado = true, motivo_arquivamento = 'desinteresse', arquivado_em = NOW()
             WHERE numero = $1 AND COALESCE(arquivado, false) = false`,
            [numero]
          )
        } else if (
          resultado.sinal_conversa === 'adiamento' &&
          respostaEnviadaAoLead && !precisaHandoff && !resultado.agendar_followup_auto
        ) {
          const retomada = new Date()
          retomada.setUTCDate(retomada.getUTCDate() + 1)
          retomada.setUTCHours(13, 0, 0, 0) // 10:00 America/Sao_Paulo (UTC-3, sem horário de verão)
          await persistirAgendamentoFollowupExplicito(
            numero,
            {
              agendar_para: retomada.toISOString(),
              instrucao_followup: 'O lead pediu para falar depois. Retome leve, sem cobrança: pergunte se agora é um bom momento para continuar de onde paramos.',
            },
            resultado.etapa_proxima || estagioLive,
            null
          )
        }
      } catch (e) {
        logger.warn('captura de sinal_conversa falhou:', e.message)
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
  
      if (precisaHandoff) {
        const preco = {
          total:   perfil.preco_calculado || 0,
          entrada: perfil.entrada || 0,
          parcela: perfil.parcela || 0,
        }
        const resumoHandoff = typeof resultado.resumo_handoff === 'string' && resultado.resumo_handoff.trim()
          ? resultado.resumo_handoff.trim()
          : null
        // Prévia de valor (IA) — só no handoff de reunião agendada. Uso interno do
        // operador (não vai ao lead). Chamada dedicada; não bloqueia o alerta se falhar.
        let previaValor = null
        if (motivoNorm === 'agendou_reuniao_proposta' && typeof gerarPreviaValorIA === 'function') {
          try { previaValor = await gerarPreviaValorIA(perfil) } catch (_) { previaValor = null }
        }
        await alertarHandoff(numero, perfil, preco, motivoNorm || 'handoff', resumoHandoff, {
          resultado,
          previaValor,
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
  
  
  function dividirTextoPorQuebrasHeuristico(texto, etapa = null) {
    const t = (texto || '').trim()
    if (!t) return []
    const raw = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
    const mensagens = raw.length <= 1 ? [t] : raw
    return limitarBolhasPorEtapa({ etapa, mensagens })
  }

  return {
    normalizarMotivoHandoff,
    historicoComInstrucaoOperadorParaClaude,
    gerarEEnviarRespostaWhatsapp,
    resultadoDeterministicoPorAcao,
    reformularTextoReuniaoComIA,
    extrairBotoes,
    dividirTextoPorQuebrasHeuristico,
  }
}

module.exports = { createCoreFunnel, mesclarInsightsLead }
