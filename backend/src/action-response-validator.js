'use strict'

const { ACOES_VALIDAS, extrairHorario, extrairPreferenciaDia } = require('./next-action-orchestrator')
const { canonicalizarPerfilLead, norm } = require('./lead-profile-canonical')
const { logAiGuardrail } = require('./guardrail-logger')

// Decisao do dono (2026-06-06): "LLM 100% no controle". O validador NAO substitui
// mais a mensagem da IA por fallback exceto quando NAO HA mensagem valida pra enviar
// (travas tecnicas). Todos os guardrails de CONTEUDO (preco, horario, PII, link,
// repeticao, menu...) viram AVISO (telemetria) e a resposta da IA segue para o lead.
// Os codigos continuam sendo computados abaixo apenas para observabilidade (avisos).
const ERROS_BLOQUEANTES_ACAO = new Set([
  // Tecnicos (sem mensagem valida pra enviar):
  'json_invalido',
  'acao_invalida',
  'sem_mensagem_publica',
])

// Sem alerta ao operador por guardrail de conteudo (LLM no controle).
const ERROS_ALERTA_OPERADOR_ACAO = new Set([])

// Stop-words que NUNCA podem ser aceitas como "negocio" do lead.
// Sao palavras do nosso proprio catalogo, nao tipos de negocio.
const NEGOCIO_STOP_WORDS = new Set([
  'site', 'sistema', 'sistemas', 'automacao', 'automacoes',
  'agente de ia', 'agente', 'ia', 'landing page', 'landing',
  'solucao', 'solucoes', 'projeto', 'sob medida',
  'website', 'pagina', 'paginas', 'app', 'aplicativo',
  'integracao', 'integracoes', 'crm', 'erp', 'dashboard', 'painel',
])

const ASSISTANT_REPETITION_SIMILARITY_THRESHOLD = 0.9

function isErroBloqueanteAcao(erro) {
  return ERROS_BLOQUEANTES_ACAO.has(String(erro || ''))
}

function isErroAlertaOperadorAcao(erro) {
  return ERROS_ALERTA_OPERADOR_ACAO.has(String(erro || ''))
}

function mensagensPublicas(resultado) {
  if (!resultado || typeof resultado !== 'object') return []
  if (Array.isArray(resultado.mensagens_bolhas) && resultado.mensagens_bolhas.length) {
    return resultado.mensagens_bolhas.filter((m) => typeof m === 'string').map((m) => m.trim()).filter(Boolean)
  }
  if (typeof resultado.mensagem_pro_lead === 'string' && resultado.mensagem_pro_lead.trim()) {
    return [resultado.mensagem_pro_lead.trim()]
  }
  return []
}

function resultadoComMensagens(resultado, bolhas) {
  const mensagens = Array.isArray(bolhas) ? bolhas.filter(Boolean).slice(0, 2) : []
  return {
    ...(resultado || {}),
    mensagem_pro_lead: mensagens.join('\n\n'),
    mensagens_bolhas: mensagens,
  }
}

function normalizarParaComparacao(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s?]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function similaridade(a, b) {
  const A = normalizarParaComparacao(a)
  const B = normalizarParaComparacao(b)
  if (!A || !B) return 0
  if (A === B) return 1
  const tokensA = new Set(A.split(' ').filter(Boolean))
  const tokensB = new Set(B.split(' ').filter(Boolean))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let inter = 0
  for (const t of tokensA) if (tokensB.has(t)) inter += 1
  const union = tokensA.size + tokensB.size - inter
  return union === 0 ? 0 : inter / union
}

function extrairUltimasBolhasAssistente(historico) {
  if (!Array.isArray(historico)) return []
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const m = historico[i]
    if (!m || m.role !== 'assistant') continue
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (c && c.text) || '').join('\n')
        : String(m.content || '')
    return content.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function extrairPerguntaPrincipal(texto) {
  const t = String(texto || '')
  const m = t.match(/[^?.!\n]*\?/g)
  if (m && m.length) return normalizarParaComparacao(m[m.length - 1])
  return ''
}

// Interrogativas que sinalizam pergunta embutida (BR-PT). Usadas para detectar
// duas perguntas dentro do MESMO bloco "?" -- ex.: "Qual o tipo do seu negocio
// e em qual cidade voce atende?" (1 "?" mas 2 perguntas). Cobertura razoavel
// sem virar falso-positivo em pronomes relativos.
const RE_INTERROGATIVA = /\b(qual|quais|como|onde|quando|quanto|quantas|quantos|quem|por\s+que|porque|em\s+qual|de\s+qual|para\s+qual|com\s+qual)\b/g

function contarPerguntasReais(texto) {
  const partes = String(texto || '').match(/[^?.!\n]*\?/g) || []
  let total = 0
  for (const parte of partes) {
    const p = norm(parte)
    if (!p) continue
    // Cumprimentos perguntativos ("tudo bem?", "como vai?") nao contam.
    if (/^(oi|ola|opa|bom dia|boa tarde|boa noite)?\s*(tudo bem|tudo certo|como vai|beleza)\?$/.test(p)) continue
    // Conta interrogativas embutidas; bloco sem interrogativa explicita ainda
    // conta como 1 (frase tipo "Pode ser?" ou "Posso verificar um horario?").
    const matches = (p.match(RE_INTERROGATIVA) || []).length
    total += Math.max(1, matches)
  }
  return total
}

// Meta-language proibida pelo system-core.md: o bot nunca deve narrar
// que vai reformular/avancar/desculpar -- conduz como uma pessoa faria.
const RE_META_LANGUAGE = /(vou\s+avancar|sem\s+repetir\s+essa\s+pergunta|deixa\s+eu\s+reformular|deixe[-\s]me\s+reformular|vou\s+reformular|reformulando|so\s+confirmando\s+uma\s+coisa|houve\s+(?:um\s+)?mal[\-\s]?entendido|desculp[ea],?\s*parece\s+que|perdao,?\s*parece\s+que)/

function contemMetaLanguage(texto) {
  return RE_META_LANGUAGE.test(norm(texto))
}

// Menu fechado de produtos do catalogo PJ. Proibido em primeiro_contato
// (system-primeiro-contato.md:3); permitido em diagnostico quando
// `perfil.necessidade` ainda nao esta definido (system-diagnostico.md:28).
// O caller decide quando flag-ar como erro baseado na etapa.
function contemMenuProdutosCatalogo(texto) {
  const s = norm(texto)
  if (/\bsite,?\s*sistema,?\s*(?:automa[cç][aã]o|automacao)/.test(s)) return true
  if (/\bsite\s+ou\s+sistema\s+ou\s+(?:automa[cç][aã]o|automacao|ia|agente)/.test(s)) return true
  if (/\bsite,?\s*sistema(?:\s+ou\s+\w+)?,?\s*automa[cç][aã]o/.test(s)) return true
  return false
}

/**
 * Bloqueia mensagem repetida em relacao ao ultimo turno do assistente.
 *
 * Retorna { repetida: true, motivo, ... } quando deve bloquear; { repetida: false } caso contrario.
 */
function isRepeatedAssistantMessage({ newMessages, lastAssistantMessages, threshold = ASSISTANT_REPETITION_SIMILARITY_THRESHOLD } = {}) {
  const novas = Array.isArray(newMessages) ? newMessages.filter(Boolean) : []
  const ultimas = Array.isArray(lastAssistantMessages) ? lastAssistantMessages.filter(Boolean) : []
  if (!novas.length || !ultimas.length) return { repetida: false }

  const textoNovoConsolidado = novas.join('\n\n')
  const textoUltimoConsolidado = ultimas.join('\n\n')

  if (normalizarParaComparacao(textoNovoConsolidado) === normalizarParaComparacao(textoUltimoConsolidado)) {
    return { repetida: true, motivo: 'mensagem_identica_normalizada', similaridade: 1 }
  }

  const simConsolidada = similaridade(textoNovoConsolidado, textoUltimoConsolidado)
  if (simConsolidada >= threshold) {
    return { repetida: true, motivo: 'similaridade_alta_consolidada', similaridade: simConsolidada }
  }

  for (const bolhaNova of novas) {
    for (const bolhaUltima of ultimas) {
      if (normalizarParaComparacao(bolhaNova) === normalizarParaComparacao(bolhaUltima)) {
        return { repetida: true, motivo: 'bolha_identica_normalizada', similaridade: 1 }
      }
      const sim = similaridade(bolhaNova, bolhaUltima)
      if (sim >= threshold) {
        return { repetida: true, motivo: 'similaridade_alta_bolha', similaridade: sim }
      }
    }
  }

  const pNova = extrairPerguntaPrincipal(textoNovoConsolidado)
  const pUltima = extrairPerguntaPrincipal(textoUltimoConsolidado)
  if (pNova && pUltima && similaridade(pNova, pUltima) >= threshold) {
    return { repetida: true, motivo: 'pergunta_principal_repetida', similaridade: similaridade(pNova, pUltima) }
  }

  return { repetida: false }
}

function validarRespostaPorAcao(resultado, contexto = {}) {
  const decisao = contexto.decisao || {}
  const perfil = canonicalizarPerfilLead(contexto.perfil || {}, contexto.etapaAtual || decisao.etapa_sugerida)
  const acao = decisao.acao_decidida
  const historico = Array.isArray(contexto.historico) ? contexto.historico : []
  const erros = []

  if (!resultado || typeof resultado !== 'object') {
    return bloquear(resultado, ['json_invalido'], contexto)
  }
  if (!ACOES_VALIDAS.has(acao)) erros.push('acao_invalida')

  const bolhas = mensagensPublicas(resultado)
  if (!bolhas.length) erros.push('sem_mensagem_publica')
  if (bolhas.length > 2) erros.push('mais_de_2_bolhas')

  const texto = bolhas.join('\n\n')
  const s = norm(texto)
  const perguntas = contarPerguntasReais(texto)
  if (perguntas > 1) erros.push('mais_de_1_pergunta')

  if (contemMetaLanguage(texto)) erros.push('meta_language_proibida')

  // Menu de produtos so e proibido em primeiro_contato. Em diagnostico
  // com necessidade nula, o system-diagnostico.md autoriza explicitamente.
  const etapaContexto = String(contexto.etapaAtual || decisao.etapa_sugerida || '').trim()
  if (etapaContexto === 'primeiro_contato' && contemMenuProdutosCatalogo(texto)) {
    erros.push('menu_proibido_em_primeiro_contato')
  }

  if (/\b(cpf|cnpj|endere[cç]o|pix|cart[aã]o|dados de pagamento|pagamento por aqui)\b/.test(s)) {
    erros.push('pediu_dado_ou_pagamento_proibido')
  }
  if (/\bprimeira pagina|primeira p[aá]gina|topo do google|garantir.*google|garanto.*google|posi[cç][aã]o no google\b/.test(s)) {
    erros.push('promessa_google')
  }
  if (/\bconcorrente|concorrentes\b/.test(s) && (!Array.isArray(perfil.concorrentes) || perfil.concorrentes.length === 0)) {
    erros.push('concorrente_sem_dado_real')
  }
  if (perfil.rota_comercial === 'projeto_sob_medida' && contemPreco(texto)) {
    erros.push('preco_sob_medida')
  }
  if (resultado.etapa_proxima && decisao.etapa_sugerida && !etapasCompativeis(resultado.etapa_proxima, decisao.etapa_sugerida)) {
    erros.push('ia_alterou_etapa')
  }

  const horariosDisponiveis = normalizarLista(contexto.horarios_disponiveis || perfil.horarios_oferecidos)
  const horariosTexto = extrairTodosHorarios(texto)
  const acoesConvite = acao === 'convite_reuniao' || acao === 'consultar_agenda'

  if (acoesConvite) {
    // Janela/noite/tarde sem horario concreto e suspeito. Se a mensagem ja
    // contem hora especifica (ex.: "19:30"), essas palavras sao OK como
    // texto de contexto e nao devem ser bloqueadas.
    if (mencionaHoraSemNumero(s) && !horariosTexto.length) {
      erros.push('mencionou_janela_sem_agenda')
    }
    if (horariosTexto.length) {
      if (!horariosDisponiveis.length) {
        // Mantemos o codigo legado 'ofereceu_horario_fora_da_agenda' para
        // compatibilidade com testes/telemetria, e adicionamos 'sem_agenda'
        // para sinalizar a causa raiz (agenda vazia/indisponivel).
        erros.push('ofereceu_horario_fora_da_agenda')
        erros.push('ofereceu_horario_sem_agenda')
      } else {
        // O lead pode ter PROPOSTO um horario fora dos slots no turno
        // atual (ex.: lead disse "14:00", agenda tem 19:30/21:30). Nesse
        // caso a mensagem do bot vai conter os DOIS horarios: o do lead
        // (reconhecido) e os da agenda (reofertados). Esse padrao e
        // legitimo, entao excluimos da checagem o horario que veio da
        // mensagem do lead.
        const horarioPropostoLead = extrairHorario(contexto.mensagemAtual || '')
        const fora = horariosTexto
          .filter((h) => h !== horarioPropostoLead)
          .filter((h) => !horariosDisponiveis.includes(h))
        if (fora.length) erros.push('ofereceu_horario_fora_da_agenda')
      }
    }
  }
  if (acao === 'confirmacao_reuniao') {
    const escolhido = contexto.horario_escolhido || contexto.dados_extraidos?.horario || decisao.dados_extraidos?.horario || extrairHorario(contexto.mensagemAtual || '')
    if (!escolhido || !normalizarLista(perfil.horarios_oferecidos).includes(escolhido)) {
      erros.push('confirmou_horario_nao_oferecido')
    }
  } else if (/\b(confirmad[oa]|marcad[oa]|agendad[oa])\b/.test(s) && horariosTexto.length) {
    erros.push('confirmou_horario_sem_acao')
  }

  const repetida = perguntaRepetidaRespondida(texto, perfil)
  if (repetida) erros.push(`repetiu_pergunta_${repetida}`)

  if (negocioInvalidoMencionado(texto)) {
    erros.push('negocio_stop_word_no_template')
  }

  // Re-greeting: se o bot ja se apresentou em turnos anteriores, nao pode
  // se apresentar de novo. E sinal forte de regressao (LLM "esqueceu" o
  // contexto). Bloqueamos quando ha 2+ turnos do assistant no historico.
  if (botReGreeting(texto, historico)) {
    erros.push('regreeting_apos_apresentacao')
  }

  const ultimasAssistente = extrairUltimasBolhasAssistente(historico)
  // Excecao: quando a acao e re-oferta de agenda apos o lead pedir um horario
  // que nao foi oferecido, repetir a oferta com os horarios reais e o
  // comportamento correto (e nao um loop). Pulamos a checagem nesse caso.
  const ultimoTextoUsuario = String(contexto.mensagemAtual || '').trim()
  const usuarioTentouHorario = /\b\d{1,2}\s*(?:h|:)\s*\d{2}\b/.test(ultimoTextoUsuario)
  // Lead que pede OUTRO dia ("so amanha") tambem legitima a re-oferta: a agenda
  // sera reconsultada no novo dia e os horarios podem coincidir com os de antes.
  // Sem isto, "Tenho amanha as 19:30 ou 19:45" seria barrado como repeticao.
  const usuarioPrefereOutroDia = extrairPreferenciaDia(ultimoTextoUsuario) === 'outro_dia'
  // Quando o lead tenta um horario invalido OU pede outro dia, re-oferecer a
  // agenda real e o comportamento correto. Aceitamos isso tanto para
  // 'consultar_agenda' (antes do upgrade) quanto para 'convite_reuniao' (apos
  // upgrade interno quando ha slots reais).
  const reOferecendoAgenda =
    (acao === 'consultar_agenda' || acao === 'convite_reuniao') &&
    (usuarioTentouHorario || usuarioPrefereOutroDia)
  if (!reOferecendoAgenda) {
    const repeticao = isRepeatedAssistantMessage({ newMessages: bolhas, lastAssistantMessages: ultimasAssistente })
    if (repeticao.repetida) {
      erros.push(`mensagem_repetida:${repeticao.motivo}`)
    }
  }

  const errosBloqueantes = erros.filter(isErroBloqueanteAcao)
  const avisos = erros.filter((erro) => !isErroBloqueanteAcao(erro))
  if (errosBloqueantes.length) return bloquear(resultado, errosBloqueantes, contexto, avisos)

  const sane = resultadoComMensagens(resultado, bolhas)
  sane.etapa_proxima = resultado.etapa_proxima || decisao.etapa_sugerida || null
  return {
    ok: true,
    bloqueado: false,
    erros: [],
    avisos: avisos.map((erro) => ({ erro, severidade: 'avisar', campo: 'acao' })),
    resultado: sane,
  }
}

function bloquear(resultado, erros, contexto, avisos = []) {
  const fallback = fallbackContextual(contexto, erros)
  // Quando o fallback escolhido e o escalonamento de reuniao (ja convidamos e
  // seguimos sem horario marcado), acionamos o handoff pra equipe da PJ
  // Codeworks marcar o horario concreto, em vez de repetir o convite em loop.
  const escalarReuniao = fallback === MENSAGEM_HANDOFF_REUNIAO
  const out = {
    ok: false,
    bloqueado: true,
    erros: erros.map((erro) => ({ erro, severidade: 'bloquear', campo: 'acao' })),
    avisos: avisos.map((erro) => ({ erro, severidade: 'avisar', campo: 'acao' })),
    alertarOperador: erros.some(isErroAlertaOperadorAcao),
    motivosAlertaOperador: erros.filter(isErroAlertaOperadorAcao),
    resultado: resultadoComMensagens(
      {
        ...(resultado && typeof resultado === 'object' ? resultado : {}),
        etapa_proxima: escalarReuniao
          ? 'agendamento_pendente'
          : (contexto?.decisao?.etapa_sugerida || contexto?.etapaAtual || null),
        solicitar_calculo_preco: false,
        handoff: escalarReuniao,
        motivo_handoff: escalarReuniao ? 'conversa_longa_sem_avanco' : null,
        __fallback_usado: true,
      },
      [fallback]
    ),
    mensagemFallback: fallback,
  }

  // Telemetria: gravar guardrail (best effort, nao bloqueia se falhar)
  const originalTexto = mensagensPublicas(resultado).join('\n\n')
  setImmediate(() => {
    logAiGuardrail({
      numero: contexto?.numero || contexto?.conversationId || null,
      rule: 'action-response-validator',
      severity: 'bloquear',
      action: 'fallback_seguro',
      erros,
      originalMessage: originalTexto,
      sanitizedMessage: fallback,
      metadata: {
        acao: contexto?.decisao?.acao_decidida || null,
        etapa: contexto?.etapaAtual || null,
        rota: contexto?.perfil?.rota_comercial || null,
        avisos,
      },
    }).catch(() => {})
  })

  return out
}

function fallbackContextual(contexto = {}, erros = []) {
  if (erros.some((e) => typeof e === 'string' && e.startsWith('mensagem_repetida'))) {
    return fallbackPorRepeticao(contexto)
  }
  // Re-greeting ou re-pergunta de necessidade: bot regrediu. Avancamos
  // para o proximo dado faltante OU para handoff, em vez de re-saudar.
  if (erros.includes('regreeting_apos_apresentacao') || erros.includes('repetiu_pergunta_necessidade')) {
    return fallbackPorRepeticao(contexto)
  }
  if (erros.includes('negocio_stop_word_no_template')) {
    return 'Entendi que voce procura um site. Qual e o tipo do seu negocio?'
  }
  if (erros.includes('mencionou_janela_sem_agenda') ||
      erros.includes('ofereceu_horario_sem_agenda') ||
      erros.includes('ofereceu_horario_fora_da_agenda')) {
    return 'Nao consegui consultar a agenda agora. Vou pedir para a equipe da {{empresa}} verificar os proximos horarios e te chamar por aqui.'
  }
  if ((contexto?.decisao?.acao_decidida === 'convite_reuniao' || contexto?.decisao?.acao_decidida === 'consultar_agenda') &&
      normalizarLista(contexto.horarios_disponiveis || contexto.perfil?.horarios_oferecidos).length === 0) {
    return 'Nao consegui consultar a agenda agora. Vou pedir para a equipe da {{empresa}} verificar os proximos horarios e te chamar por aqui.'
  }
  // ia_alterou_etapa: a mensagem do LLM provavelmente esta ok mas o
  // campo etapa_proxima divergiu. Usamos fallback que avanca o funil
  // perguntando o proximo dado faltante (curto e contextual), em vez
  // do default antigo que listava o menu proibido.
  if (erros.includes('ia_alterou_etapa') ||
      erros.includes('mais_de_1_pergunta') ||
      erros.includes('mais_de_2_bolhas') ||
      erros.includes('meta_language_proibida') ||
      erros.includes('menu_proibido_em_primeiro_contato')) {
    return fallbackPorRepeticao(contexto)
  }
  return fallbackSeguroPorAcao(contexto)
}

function proximoDadoFaltante(perfil = {}) {
  const ORDEM = ['negocio', 'cidade', 'necessidade', 'origem_clientes']
  for (const campo of ORDEM) {
    const v = perfil[campo]
    if (v == null || v === '') return campo
  }
  return null
}

function perguntaParaDado(campo) {
  if (campo === 'negocio') return 'qual e o tipo do seu negocio?'
  if (campo === 'cidade') return 'em qual cidade ou regiao voce atende?'
  if (campo === 'necessidade') return 'voce procura um site, um sistema ou um agente de IA?'
  if (campo === 'origem_clientes') return 'como os seus clientes te encontram hoje?'
  return null
}

// Padroes que indicam que o bot JA perguntou um dado em algum turno anterior.
// Usado para nao reabrir a mesma pergunta quando o lead respondeu de forma que
// o extrator nao conseguiu interpretar (ex.: "Ess4", "Essa") — nesses casos
// seguimos em frente em vez de insistir e travar a conversa.
const PERGUNTA_JA_FEITA = {
  negocio: /(tipo do seu neg[oó]cio|qual.*neg[oó]cio|com o que voce trabalha|qual.*ramo)/,
  cidade: /(em qual cidade|qual cidade|qual.*regi[aã]o|onde voce atende)/,
  // Amplo de proposito: qualquer redacao da pergunta de necessidade conta como
  // ja perguntada (inclui "necessidade", "solucao/solucoes digitais", "o que
  // voce gostaria de alcancar..."). Evita o loop visto em conversas reais.
  necessidade: /(necessidade|solucao digital|solucoes digitais|site,?\s*sistema|um site,?\s*um sistema|procura\s+(?:um\s+)?(?:site|sistema)|sistema ou um agente de ia|o que voce (?:quer|gostaria|deseja|pretende)[^?]*(?:construir|melhorar|alcancar|resolver|digital)|quer construir ou melhorar)/,
  origem_clientes: /(clientes te encontram|clientes chegam|chegam mais por|indica[cç][aã]o.*instagram|instagram.*google)/,
}

function jaPerguntouDado(campo, historico) {
  if (!Array.isArray(historico)) return false
  const re = PERGUNTA_JA_FEITA[campo]
  if (!re) return false
  for (const m of historico) {
    if (!m || m.role !== 'assistant') continue
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (c && c.text) || '').join(' ')
        : String(m.content || '')
    if (re.test(norm(content))) return true
  }
  return false
}

function capitalizar(str) {
  const s = String(str || '').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// Convite de reuniao (primeira vez): convite leve, sem horario concreto — o
// horario real vem do caminho consultar_agenda do orquestrador.
const MENSAGEM_OFERTA_REUNIAO =
  'Show, ja tenho um bom panorama do seu caso. Posso ver um horario rapido com a equipe da {{empresa}} pra te mostrar como ficaria na pratica?'
// Escalonamento: ja convidamos antes e seguimos sem horario marcado. Em vez de
// repetir o mesmo convite, passamos pra equipe confirmar o horario concreto.
const MENSAGEM_HANDOFF_REUNIAO =
  'Perfeito! Vou passar seu caso pra equipe da {{empresa}} confirmar o melhor horario com voce por aqui. Eles te chamam em instantes. 👍'

// Detecta se o bot JA convidou o lead para uma reuniao em algum turno anterior
// (convite leve OU oferta de horario concreto). Usado para nao repetir o mesmo
// convite em loop — escalamos para a equipe marcar o horario.
const RE_CONVITE_REUNIAO_FEITO = /(bom panorama do seu caso|posso ver um horario|ver um horario rapido|horario rapido com a equipe|qual fica melhor|marcar uma (?:conversa|reuniao)|confirmar o melhor horario)/
function jaConvidouParaReuniao(historico = []) {
  if (!Array.isArray(historico)) return false
  for (const m of historico) {
    if (!m || m.role !== 'assistant') continue
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (c && c.text) || '').join(' ')
        : String(m.content || '')
    if (RE_CONVITE_REUNIAO_FEITO.test(norm(content))) return true
  }
  return false
}

function fallbackPorRepeticao(contexto = {}) {
  const perfilCanon = canonicalizarPerfilLead(contexto.perfil || {}, contexto.etapaAtual)
  // Considera o dado recem-extraido da mensagem atual: nunca re-perguntamos
  // algo que o lead ACABOU de responder neste mesmo turno.
  const dados = contexto.dados_extraidos || {}
  const perfilTurno = {
    ...perfilCanon,
    negocio: perfilCanon.negocio || dados.negocio || null,
    cidade: perfilCanon.cidade || dados.cidade || null,
    necessidade: perfilCanon.necessidade || dados.necessidade || null,
    origem_clientes: perfilCanon.origem_clientes || dados.origem_clientes || null,
  }
  const historico = Array.isArray(contexto.historico) ? contexto.historico : []

  // Pega o primeiro dado faltante que AINDA nao foi perguntado. Se um campo ja
  // foi perguntado e segue vazio (lead respondeu algo ininteligivel), pulamos
  // para nao entrar em loop.
  let faltante = proximoDadoFaltante(perfilTurno)
  while (faltante && jaPerguntouDado(faltante, historico)) {
    perfilTurno[faltante] = '__ja_perguntado__'
    faltante = proximoDadoFaltante(perfilTurno)
  }

  if (faltante) {
    return `Boa! ${capitalizar(perguntaParaDado(faltante))}`
  }
  // Todos os dados essenciais ja existem (ou ja foram perguntados): o caminho
  // natural e a reuniao. Se ja convidamos antes e seguimos sem horario marcado,
  // NAO repetimos o convite — escalamos pra equipe confirmar o horario concreto
  // (handoff e acionado em bloquear quando esta mensagem e a escolhida).
  if (jaConvidouParaReuniao(historico)) {
    return MENSAGEM_HANDOFF_REUNIAO
  }
  return MENSAGEM_OFERTA_REUNIAO
}

function fallbackSeguroPorAcao(contexto = {}) {
  const acao = contexto?.decisao?.acao_decidida
  if (acao === 'responder_preco_sem_contexto') return 'Temos dois caminhos: algo mais simples para comecar rapido, ou um projeto sob medida quando precisa de algo mais personalizado. Pra eu te orientar certo: o que voce quer construir agora?'
  if (acao === 'convite_reuniao' || acao === 'consultar_agenda') return 'Nao consegui consultar a agenda agora. Vou pedir para a equipe da {{empresa}} verificar os proximos horarios e te chamar por aqui.'
  if (acao === 'confirmacao_reuniao') return 'Esse horario precisa estar entre as opcoes disponiveis que eu te enviei. Vou verificar novamente os horarios reais com a equipe.'
  if (acao === 'pedido_humano') return 'Claro. Vou chamar a equipe da {{empresa}} para te ajudar diretamente por aqui.'
  if (acao === 'primeiro_contato') return 'Oi! Tudo bem? Aqui e o assistente da {{empresa}}. Com o que voce trabalha hoje?'
  // Para diagnostico / conexao_valor / responder_duvida sem fallback
  // especifico, avanca para o proximo dado faltante OU pede handoff.
  return fallbackPorRepeticao(contexto)
}

function contemPreco(texto) {
  return /R\$\s*\d|entrada\s+de|parcelas?|3x|a\s+partir\s+de|faixa\s+de|mensalidade\s+de\s+R\$/i.test(String(texto || ''))
}

function normalizarLista(value) {
  return Array.isArray(value) ? value.map((x) => String(x || '').trim()).filter(Boolean) : []
}

function etapaCanonicaCompat(etapa) {
  const raw = String(etapa || '').trim()
  const map = {
    primeiro_contato: 'diagnostico',
    novo: 'diagnostico',
    coleta_basica: 'diagnostico',
    qualificacao_caminho: 'diagnostico',
    conexao_valor: 'diagnostico',
    sob_medida_contexto: 'diagnostico',
    sob_medida_agenda_oferecida: 'agendamento_pendente',
    reuniao_agendada: 'fechamento',
    handoff_humano: 'fechamento',
  }
  return map[raw] || raw
}

function etapasCompativeis(etapaResultado, etapaSugerida) {
  const inicial = new Set(['primeiro_contato', 'novo', 'coleta_basica', 'diagnostico'])
  const rawResultado = String(etapaResultado || '').trim()
  const rawSugerida = String(etapaSugerida || '').trim()
  if (inicial.has(rawResultado) || inicial.has(rawSugerida)) {
    return inicial.has(rawResultado) && inicial.has(rawSugerida)
  }
  return etapaCanonicaCompat(etapaResultado) === etapaCanonicaCompat(etapaSugerida)
}

function extrairTodosHorarios(texto) {
  const out = []
  const re = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/g
  let m
  while ((m = re.exec(String(texto || ''))) !== null) {
    const h = extrairHorario(m[0])
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

function mencionaHoraSemNumero(s) {
  // Detecta frases tipo "hoje a noite", "amanha cedo" sem horario explicito
  return /\b(hoje (a|à) noite|amanha (a|à) noite|hoje cedo|amanha cedo|essa noite|essa tarde|noite|janela)\b/.test(s)
}

/**
 * Detecta re-cumprimento do bot apos ja ter se apresentado.
 *
 * Sinal forte de regressao: LLM "esqueceu" que ja esta no meio da
 * conversa e refez a apresentacao inicial.
 *
 * Regra: se o historico tem >=2 turnos do assistant, qualquer nova
 * mensagem que comece com saudacao + auto-apresentacao da {{empresa}}
 * e bloqueada.
 */
function botReGreeting(texto, historico) {
  if (!Array.isArray(historico)) return false
  const turnosAssistente = historico.filter((m) => m && m.role === 'assistant').length
  if (turnosAssistente < 2) return false

  const s = norm(String(texto || '').slice(0, 220))
  // Cobre variantes "Ola!", "Oi!", "Bom dia/tarde/noite" + auto-apresentacao
  const saudacao = /^(oi|ola|opa|hey|bom\s+dia|boa\s+tarde|boa\s+noite|e\s+ai)[!?,.\s]/
  const apresenta = /(sou\s+(o\s+|a\s+)?assistente|sou\s+(o\s+|a\s+)?bot|aqui\s+e\s+o\s+assistente|aqui\s+e\s+a\s+pj|eu\s+sou\s+(o\s+|a\s+)?assistente|sou\s+da\s+pj\s+codeworks|assistente\s+(virtual\s+)?da\s+pj\s+codeworks|pj\s+codeworks\s+👋|aqui\s+e\s+o\s+assistente\s+da\s+pj)/
  return saudacao.test(s) && apresenta.test(s)
}

function negocioInvalidoMencionado(texto) {
  const s = norm(texto)
  // Detecta template malformado tipo "voce trabalha com X" onde X e stop-word ou vazio.
  // Pula artigos opcionais (um/uma/o/a/uns/umas) e checa se a palavra-conteudo e stop-word.
  const m1 = s.match(/voce trabalha com\s+(?:um\s+|uma\s+|o\s+|a\s+|uns\s+|umas\s+)?([a-z]{0,40})/)
  if (m1) {
    const cap = (m1[1] || '').trim()
    if (!cap) return true
    if (NEGOCIO_STOP_WORDS.has(cap)) return true
    for (const w of NEGOCIO_STOP_WORDS) {
      if (cap === w + 's') return true
    }
  }
  // Template "entendi: voce trabalha com ." (campo vazio antes do ponto)
  if (/entendi:?\s*voce trabalha com\s*[.,;]/.test(s)) return true
  return false
}

function perguntaRepetidaRespondida(texto, perfil) {
  const s = norm(texto)
  if (perfil.negocio && /\b(qual|tipo).*(negocio|ramo)|com o que voce trabalha|qual e o seu negocio\b/.test(s)) return 'negocio'
  if (perfil.cidade && /\b(qual|em qual).*(cidade|regiao)|onde voce atende\b/.test(s)) return 'cidade'
  // Detecta a pergunta de "menu de servicos" em VARIAS formas verbais —
  // "voce procura/precisa de/busca/quer/esta procurando site, sistema..."
  // Capturamos quando perfil.necessidade ja esta setado (o lead ja disse).
  if (perfil.necessidade && /\b(voce\s+(procura|precisa|busca|quer)|esta\s+procurando|esta\s+buscando|precisa\s+de|procurando\s+(?:por\s+)?site|busca\s+(?:por\s+)?site)\b.*\b(site|sistema|automacao|solucao|presenca|presença|google|ia)\b/.test(s)) return 'necessidade'
  // Mesmo sem perfil.necessidade, a pergunta-menu "site, sistema, automacao OU
  // X" e o template proibido pra leads que ja demonstraram interesse claro.
  // So permitimos se ela aparece de forma exploratoria (sem "ou" listando opcoes).
  if (perfil.necessidade && /\b(site|saite),?\s*sistema,?\s*(?:automacao|automa[cç][aã]o)/.test(s)) return 'necessidade'
  if (perfil.origem_clientes && /\b(clientes chegam|indicacao|instagram|google|whatsapp).*\?/.test(s)) return 'origem_clientes'
  return null
}

module.exports = {
  validarRespostaPorAcao,
  fallbackSeguroPorAcao,
  fallbackContextual,
  mensagensPublicas,
  isRepeatedAssistantMessage,
  similaridade,
  normalizarParaComparacao,
  NEGOCIO_STOP_WORDS,
  negocioInvalidoMencionado,
  contarPerguntasReais,
  contemMetaLanguage,
  contemMenuProdutosCatalogo,
  isErroBloqueanteAcao,
  isErroAlertaOperadorAcao,
}
