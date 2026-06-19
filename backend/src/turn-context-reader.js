'use strict'

const { canonicalizarPerfilLead, norm } = require('./lead-profile-canonical')

function textoDeMensagem(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  if (typeof msg.content === 'string') return msg.content
  if (msg.content == null) return ''
  return String(msg.content)
}

function normalizarHistorico(historico = []) {
  return Array.isArray(historico)
    ? historico.filter((m) => m && (m.role === 'assistant' || m.role === 'user' || m.role === 'operator'))
    : []
}

function ultimaMensagemPorRole(historico = [], role) {
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const m = historico[i]
    if (m && m.role === role) return m
  }
  return null
}

function ultimaPerguntaDoAssistente(historico = []) {
  const last = ultimaMensagemPorRole(historico, 'assistant')
  const texto = textoDeMensagem(last)
  const matches = texto.match(/[^?.!]*\?/g)
  if (!matches || !matches.length) return ''
  return matches[matches.length - 1].trim()
}

function categoriasDaPergunta(texto = '') {
  const s = norm(texto)
  const out = []
  if (/(tipo do seu negocio|qual.*negocio|qual.*ramo|com o que voce trabalha)/.test(s)) out.push('negocio')
  if (/(em qual cidade|qual cidade|qual.*regiao|onde voce atende|onde atua)/.test(s)) out.push('cidade_regiao')
  if (/(ja tem.*site|seria o primeiro|primeiro site|voce tem site|tem algum site)/.test(s)) out.push('tem_site')
  if (/(clientes te encontram|clientes chegam|chegam mais por|indicacao.*instagram|instagram.*google|origem dos clientes)/.test(s)) out.push('origem_clientes')
  if (/(objetivo do site|objetivo|receber contatos|aparecer.*google|apresentar a empresa|atrair clientes)/.test(s)) out.push('objetivo')
  if (/(site,?\s*sistema|procura site|procura.*sistema|solucao sob medida|automacao|agente de ia)/.test(s)) out.push('interesse')
  if (/(horario|reuniao|agenda|disponiveis|qual fica melhor|conversa rapida)/.test(s)) out.push('reuniao')
  if (/(preco|valor|investimento|quanto custa|orcamento|mensalidade)/.test(s)) out.push('preco')
  if (/(email|e-mail|convite)/.test(s)) out.push('email')
  return [...new Set(out)]
}

function textoCurto(texto = '') {
  const t = String(texto || '').trim()
  if (!t) return false
  const palavras = norm(t).split(/\s+/).filter(Boolean)
  return palavras.length <= 4 && t.length <= 50
}

function textoPedePreco(texto = '') {
  return /\b(quanto custa|preco|preço|valor|investimento|orcamento|orçamento|mensalidade|quanto fica)\b/i.test(String(texto || ''))
}

function textoConfuso(texto = '') {
  return /\b(nao entendi|não entendi|como funciona|complicado|parece complicado|nao sei|não sei|explica|me explica|fiquei confuso|fiquei confusa)\b/i.test(String(texto || ''))
}

function textoAceita(texto = '') {
  return /\b(sim|claro|pode ser|pode|ok|blz|beleza|fechado|quero|vamos|bora|manda|aceito|perfeito)\b/i.test(String(texto || ''))
}

function textoRecusa(texto = '') {
  return /\b(nao quero|não quero|sem interesse|nao tenho interesse|não tenho interesse|deixa|deixar|agora nao|agora não|pare|cancela)\b/i.test(String(texto || ''))
}

function interpretarRespostaCurta({ texto, categoriasUltimaPergunta = [] } = {}) {
  const s = norm(texto)
  const out = {
    respondeu: false,
    tipo: null,
    valor: null,
    descricao: '',
  }

  if (!s) return out
  if (categoriasUltimaPergunta.includes('tem_site')) {
    if (/\b(primeiro|seria o primeiro|nao tenho|não tenho|ainda nao|ainda não|sem site)\b/.test(s)) {
      return { respondeu: true, tipo: 'tem_site', valor: false, descricao: 'lead informou que sera o primeiro site' }
    }
    if (/\b(ja tenho|já tenho|tenho|sim)\b/.test(s)) {
      return { respondeu: true, tipo: 'tem_site', valor: true, descricao: 'lead informou que ja tem site' }
    }
  }

  if (categoriasUltimaPergunta.includes('reuniao') && textoAceita(texto)) {
    return { respondeu: true, tipo: 'aceite_reuniao', valor: true, descricao: 'lead aceitou seguir para reuniao/horarios' }
  }

  if (categoriasUltimaPergunta.includes('origem_clientes') && s && !/^(sim|nao|não|ok|blz|beleza)$/.test(s)) {
    return { respondeu: true, tipo: 'origem_clientes', valor: String(texto || '').trim(), descricao: 'lead respondeu como clientes chegam hoje' }
  }

  if (categoriasUltimaPergunta.includes('cidade_regiao') && s.length >= 2) {
    return { respondeu: true, tipo: 'cidade_regiao', valor: String(texto || '').trim(), descricao: 'lead respondeu cidade ou regiao' }
  }

  if (categoriasUltimaPergunta.includes('interesse') && textoAceita(texto)) {
    return { respondeu: true, tipo: 'interesse', valor: 'site', descricao: 'lead respondeu positivamente ao interesse em solucao/site' }
  }

  return out
}

function fatoStatus(valor) {
  if (valor === true) return { definido: true, valor: 'sim' }
  if (valor === false) return { definido: true, valor: 'nao' }
  if (valor != null && String(valor).trim() !== '') return { definido: true, valor: String(valor).trim() }
  return { definido: false, valor: null }
}

function construirFactMemory(perfilCanonico = {}, respostaCurta = {}) {
  const reuniao = perfilCanonico.reuniao_proposta || {}
  const temSiteResposta = respostaCurta.tipo === 'tem_site' ? respostaCurta.valor : null
  const origemResposta = respostaCurta.tipo === 'origem_clientes' ? respostaCurta.valor : null
  const cidadeResposta = respostaCurta.tipo === 'cidade_regiao' ? respostaCurta.valor : null
  const interesseResposta = respostaCurta.tipo === 'interesse' ? respostaCurta.valor : null

  return {
    negocio: fatoStatus(perfilCanonico.negocio),
    cidade_regiao: fatoStatus(perfilCanonico.cidade || cidadeResposta),
    tem_site: fatoStatus(perfilCanonico.tem_site != null ? perfilCanonico.tem_site : temSiteResposta),
    objetivo: fatoStatus(perfilCanonico.objetivo_site),
    origem_clientes: fatoStatus(perfilCanonico.origem_clientes || origemResposta),
    interesse: fatoStatus(perfilCanonico.necessidade || interesseResposta),
    preco_perguntado: { definido: false, valor: null },
    reuniao_oferecida: fatoStatus(
      Boolean(
        perfilCanonico.reuniao_confirmada ||
        reuniao.necessaria ||
        (Array.isArray(perfilCanonico.horarios_oferecidos) && perfilCanonico.horarios_oferecidos.length)
      )
    ),
    horario_escolhido: fatoStatus(reuniao.horario_confirmado || null),
    email: fatoStatus(perfilCanonico.email || null),
  }
}

function primeiroFatoPendente(factMemory = {}) {
  const ordem = ['negocio', 'cidade_regiao', 'interesse', 'tem_site', 'objetivo', 'origem_clientes']
  return ordem.find((k) => !factMemory[k]?.definido) || null
}

function perguntasBloqueadasPorFatos(factMemory = {}) {
  const bloqueadas = []
  if (factMemory.negocio?.definido) bloqueadas.push('perguntar_negocio')
  if (factMemory.cidade_regiao?.definido) bloqueadas.push('perguntar_cidade')
  if (factMemory.tem_site?.definido) bloqueadas.push('perguntar_tem_site')
  if (factMemory.objetivo?.definido) bloqueadas.push('perguntar_objetivo_site')
  if (factMemory.origem_clientes?.definido) bloqueadas.push('perguntar_origem_clientes')
  if (factMemory.interesse?.definido) bloqueadas.push('perguntar_interesse')
  return bloqueadas
}

function estadoDoTurno({ historico, mensagemAtual, ultimaPergunta, categoriasUltimaPergunta, respostaCurta, perfilCanonico }) {
  const last = historico[historico.length - 1]
  if (last?.role === 'operator') return 'operador_assumiu'
  if (last?.role === 'assistant' && ultimaPergunta) return 'aguardando_resposta_do_lead'
  if (textoPedePreco(mensagemAtual)) return 'lead_pediu_preco'
  if (textoConfuso(mensagemAtual)) return 'lead_confuso'
  if (textoRecusa(mensagemAtual)) return 'lead_recusou'
  if (respostaCurta.tipo === 'aceite_reuniao') return 'lead_aceitou_reuniao'
  if (textoCurto(mensagemAtual) && respostaCurta.respondeu) return 'lead_resposta_curta_contextual'
  if (respostaCurta.respondeu) return 'lead_respondeu_pergunta'
  if (categoriasUltimaPergunta.length) return 'lead_resposta_fora_da_pergunta'
  if (perfilCanonico.reuniao_confirmada) return 'continuidade_pos_reuniao'
  return 'continuidade_normal'
}

function construirActionPolicy({ turnState, factMemory, ultimaPergunta, respostaCurta }) {
  const acoesBloqueadas = [
    ...perguntasBloqueadasPorFatos(factMemory),
    'fazer_mais_de_1_pergunta',
    'ignorar_memoria_factual',
  ]

  if (ultimaPergunta) acoesBloqueadas.push('mandar_followup_sem_silencio_real')
  if (turnState === 'lead_confuso') acoesBloqueadas.push('oferecer_reuniao', 'avancar_funil')
  if (turnState === 'lead_resposta_fora_da_pergunta') acoesBloqueadas.push('oferecer_reuniao', 'avancar_funil', 'ignorar_pergunta_pendente')
  if (factMemory.horario_escolhido?.definido) acoesBloqueadas.push('voltar_para_diagnostico', 'oferecer_novos_horarios')
  if (factMemory.reuniao_oferecida?.definido) acoesBloqueadas.push('repetir_convite_reuniao_sem_resposta')

  const proximoDado = primeiroFatoPendente(factMemory)
  let acaoPermitida = 'responder_com_continuidade'
  if (turnState === 'lead_confuso') acaoPermitida = 'explicar_sem_avancar'
  else if (turnState === 'lead_resposta_fora_da_pergunta') acaoPermitida = 'explicar_e_reformular_pergunta_pendente'
  else if (turnState === 'lead_pediu_preco') acaoPermitida = 'responder_preco_com_contexto'
  else if (turnState === 'lead_aceitou_reuniao') acaoPermitida = 'consultar_agenda_ou_confirmar_horario'
  else if (proximoDado) acaoPermitida = `coletar_${proximoDado}`
  else if (!factMemory.reuniao_oferecida?.definido) acaoPermitida = 'oferecer_reuniao'

  return {
    acao_permitida: acaoPermitida,
    acoes_bloqueadas: [...new Set(acoesBloqueadas)],
    proximo_dado_util: proximoDado,
    followup_permitido: !ultimaPergunta && turnState !== 'aguardando_resposta_do_lead',
    motivo: respostaCurta?.descricao || 'usar memoria factual e continuidade do historico',
  }
}

function linhaFato(label, fato) {
  return `${label}: ${fato?.definido ? `definido - ${fato.valor}` : 'pendente'}`
}

function montarPromptBlock({ turnState, ultimaPergunta, mensagemAtual, respostaCurta, factMemory, actionPolicy }) {
  return [
    '--- LEITURA DO TURNO ATUAL (obrigatorio obedecer) ---',
    `Estado do turno: ${turnState}`,
    `Ultima pergunta do bot: ${ultimaPergunta || '(nenhuma)'}`,
    `Resposta atual do lead: ${String(mensagemAtual || '').trim() || '(nenhuma)'}`,
    `Interpretacao da resposta: ${respostaCurta?.descricao || 'continuidade normal'}`,
    `Pergunta pendente: ${turnState === 'aguardando_resposta_do_lead' ? 'sim' : 'nao'}`,
    `Follow-up permitido: ${actionPolicy.followup_permitido ? 'sim' : 'nao'}`,
    '',
    '--- MEMORIA FACTUAL DO LEAD ---',
    linhaFato('Negocio', factMemory.negocio),
    linhaFato('Cidade/regiao', factMemory.cidade_regiao),
    linhaFato('Tem site', factMemory.tem_site),
    linhaFato('Objetivo', factMemory.objetivo),
    linhaFato('Origem dos clientes', factMemory.origem_clientes),
    linhaFato('Interesse', factMemory.interesse),
    linhaFato('Preco perguntado', factMemory.preco_perguntado),
    linhaFato('Reuniao oferecida', factMemory.reuniao_oferecida),
    linhaFato('Horario escolhido', factMemory.horario_escolhido),
    linhaFato('Email', factMemory.email),
    '',
    '--- POLITICA DE ACAO ---',
    `Acao permitida: ${actionPolicy.acao_permitida}`,
    `Proximo dado util: ${actionPolicy.proximo_dado_util || '(nenhum; avance sem repetir pergunta)'}`,
    'Acoes proibidas:',
    ...actionPolicy.acoes_bloqueadas.map((a) => `- ${a}`),
    '',
    'REGRAS PARA ESCREVER:',
    '- Use os fatos definidos como verdade; nao pergunte de novo.',
    '- Se a resposta do lead foi curta, interprete contra a ultima pergunta do bot.',
    '- Faca no maximo uma pergunta.',
    '- Se o lead estiver confuso, explique antes de vender ou oferecer reuniao.',
    '- Nao mande follow-up nem reengajamento quando houver pergunta pendente.',
    '--- FIM LEITURA DO TURNO ---',
  ].join('\n')
}

function buildTurnContext({ historico = [], perfil = {}, estagio = null, mensagemAtual = null } = {}) {
  const msgs = normalizarHistorico(historico)
  const last = msgs[msgs.length - 1] || null
  const textoAtual = mensagemAtual != null ? String(mensagemAtual || '') : textoDeMensagem(last)
  const perfilCanonico = canonicalizarPerfilLead(perfil || {}, estagio)
  const ultimaPergunta = ultimaPerguntaDoAssistente(msgs)
  const categoriasUltimaPergunta = categoriasDaPergunta(ultimaPergunta)
  const respostaCurta = interpretarRespostaCurta({ texto: textoAtual, categoriasUltimaPergunta })
  const factMemory = construirFactMemory(perfilCanonico, respostaCurta)
  factMemory.preco_perguntado = fatoStatus(textoPedePreco(textoAtual) ? 'sim' : null)
  const turnState = estadoDoTurno({
    historico: msgs,
    mensagemAtual: textoAtual,
    ultimaPergunta,
    categoriasUltimaPergunta,
    respostaCurta,
    perfilCanonico,
  })
  const actionPolicy = construirActionPolicy({ turnState, factMemory, ultimaPergunta, respostaCurta })
  const promptBlock = montarPromptBlock({
    turnState,
    ultimaPergunta,
    mensagemAtual: textoAtual,
    respostaCurta,
    factMemory,
    actionPolicy,
  })

  return {
    turn_state: turnState,
    ultima_pergunta_bot: ultimaPergunta,
    categorias_ultima_pergunta: categoriasUltimaPergunta,
    resposta_contextual: respostaCurta,
    fact_memory: factMemory,
    action_policy: actionPolicy,
    prompt_block: promptBlock,
  }
}

module.exports = {
  buildTurnContext,
  categoriasDaPergunta,
  interpretarRespostaCurta,
  ultimaPerguntaDoAssistente,
}
