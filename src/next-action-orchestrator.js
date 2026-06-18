'use strict'

const { canonicalizarPerfilLead, norm } = require('./lead-profile-canonical')

const ACOES_VALIDAS = new Set([
  'primeiro_contato',
  'diagnostico',
  'conexao_valor',
  'responder_preco_sem_contexto',
  'explicar_projeto_sob_medida',
  'consultar_agenda',
  'convite_reuniao',
  'confirmacao_reuniao',
  'pedir_email',
  'pedido_humano',
  'lead_pesquisando',
  'opt_out',
  'responder_duvida',
  'fallback_seguro',
])

const ORDEM_DADOS = ['negocio', 'cidade', 'necessidade', 'origem_clientes']

// Ordem canonica dos estagios. Maior numero = mais avancado.
// Lead em proposta (3) ou acima nao pode regredir automaticamente para
// primeiro_contato (0) ou diagnostico (1) sem motivo explicito.
const STAGE_ORDER = Object.freeze({
  primeiro_contato: 0,
  novo: 0,
  coleta_basica: 1,
  diagnostico: 1,
  conexao_valor: 2,
  qualificacao_caminho: 2,
  proposta: 3,
  sob_medida_contexto: 3,
  agendamento_pendente: 4,
  sob_medida_agenda_oferecida: 4,
  reuniao_agendada: 5,
  fechamento: 5,
  handoff_humano: 6,
  handoff: 6,
  opt_out: 6,
  desqualificado: 6,
})

function estagioPeso(estagio) {
  const key = String(estagio || '').trim().toLowerCase()
  return STAGE_ORDER[key] != null ? STAGE_ORDER[key] : 0
}

function isLeadHistoricoAvancado({ historico = [], etapaAtual = null, perfil = {} } = {}) {
  if (Array.isArray(historico) && historico.length >= 10) return true
  if (estagioPeso(etapaAtual) >= STAGE_ORDER.proposta) return true
  if (estagioPeso(perfil && perfil.etapa_atual) >= STAGE_ORDER.proposta) return true
  if (perfil && (perfil.reuniao_confirmada || (perfil.reuniao_proposta && perfil.reuniao_proposta.horario_confirmado))) return true
  return false
}

function textoDeMensagem(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg
  if (typeof msg.content === 'string') return msg.content
  if (msg.content == null) return ''
  return String(msg.content)
}

function ultimoTextoAssistente(historico = []) {
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const m = historico[i]
    if (m && m.role === 'assistant') return textoDeMensagem(m).trim()
  }
  return ''
}

function ultimaPergunta(historico = []) {
  const last = ultimoTextoAssistente(historico)
  const matches = last.match(/[^?.!]*\?/g)
  if (matches && matches.length) return matches[matches.length - 1].trim()
  return ''
}

// Detecta o "eco": o lead cola de volta a ultima pergunta do bot (as vezes com
// uma resposta curta no fim, ex.: "...site, sistema ou solucao sob medida?\nPode
// ser"). Sem isto, o extrator lia dados da PERGUNTA colada (ex.: "indicacao,
// Instagram ou Google" virava origem_clientes) e o funil reabria a mesma
// pergunta em loop. Retorna { ehEco, restante }: `restante` e a resposta real do
// lead (o que vem depois do "?" colado), ou '' quando ele so colou a pergunta.
function separarEcoDaUltimaPergunta(mensagem, historico = []) {
  const original = String(mensagem || '').trim()
  const ultimaAssist = ultimoTextoAssistente(historico)
  if (!original || !ultimaAssist) return { ehEco: false, restante: original }
  const nMsg = norm(original)
  const perguntas = (ultimaAssist.match(/[^?]*\?/g) || [])
    .map((p) => norm(p))
    .filter((p) => p.length >= 15)
  const ehEco = perguntas.some((p) => nMsg.includes(p))
  if (!ehEco) return { ehEco: false, restante: original }
  const restante = original.includes('?') ? original.split('?').pop().trim() : ''
  return { ehEco: true, restante }
}

// Detecta se o bot ja perguntou sobre a origem dos clientes em QUALQUER turno
// anterior. Evita reabrir a pergunta (e travar a conversa) quando o lead
// respondeu de forma que o extrator nao conseguiu interpretar.
const RE_PERGUNTA_ORIGEM = /(clientes te encontram|clientes chegam|chegam mais por|indica[cç][aã]o.*instagram|instagram.*google)/
function jaPerguntouOrigemClientes(historico = []) {
  if (!Array.isArray(historico)) return false
  for (const m of historico) {
    if (!m || m.role !== 'assistant') continue
    if (RE_PERGUNTA_ORIGEM.test(norm(textoDeMensagem(m)))) return true
  }
  return false
}

// Detecta se o bot ja perguntou um dado BASICO (negocio/cidade/necessidade) em
// qualquer turno anterior. Se ja perguntamos e o lead respondeu algo que o
// extrator nao entendeu, NAO repetimos a pergunta — avancamos. Sem isto, o
// funil ficava preso no diagnostico re-perguntando "qual e o tipo do seu
// negocio?" / "voce procura um site, um sistema ou um agente de IA?" em loop.
// Espelha PERGUNTA_JA_FEITA do action-response-validator (mantido local para
// evitar dependencia circular entre os modulos).
// O regex de necessidade e propositalmente AMPLO: o LLM pergunta a necessidade
// em dezenas de redacoes livres ("Qual seria sua necessidade atual em relacao a
// solucoes digitais?", "o que voce gostaria de alcancar com a solucao digital?")
// e qualquer uma delas deve contar como "ja perguntada". A palavra "necessidade"
// num turno do assistente e, na pratica, sempre essa pergunta — preferimos NAO
// repetir a re-perguntar em loop.
const PERGUNTA_BASICA_JA_FEITA = {
  negocio: /(tipo do seu neg[oó]cio|qual.*neg[oó]cio|com o que voce trabalha|qual.*ramo)/,
  cidade: /(em qual cidade|qual cidade|qual.*regi[aã]o|onde voce atende)/,
  necessidade: /(necessidade|solucao digital|solucoes digitais|site,?\s*sistema|um site,?\s*um sistema|procura\s+(?:um\s+)?(?:site|sistema)|sistema ou um agente de ia|o que voce (?:quer|gostaria|deseja|pretende)[^?]*(?:construir|melhorar|alcancar|resolver|digital)|quer construir ou melhorar)/,
}

const RE_PERGUNTA_TEM_SITE = /(ja tem.*site|seria o primeiro|primeiro site|voce tem site|tem algum site)/
const RE_RESPOSTA_TEM_SITE = /\b(primeiro|seria o primeiro|nao tenho|n[aã]o tenho|ainda nao|ainda n[aã]o|sem site|ja tenho|j[aá] tenho|tenho site|tenho um site|tenho uma pagina|site antigo|sim)\b/

function jaPerguntouDadoBasico(campo, historico = []) {
  const re = PERGUNTA_BASICA_JA_FEITA[campo]
  if (!re || !Array.isArray(historico)) return false
  for (const m of historico) {
    if (!m || m.role !== 'assistant') continue
    if (re.test(norm(textoDeMensagem(m)))) return true
  }
  return false
}

function ultimaPerguntaPedeTemSite(historico = []) {
  const pergunta = ultimaPergunta(historico)
  return RE_PERGUNTA_TEM_SITE.test(norm(pergunta))
}

function respondeuTemSite(texto) {
  return RE_RESPOSTA_TEM_SITE.test(norm(texto))
}

function extrairHorario(texto) {
  const m = String(texto || '').match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})\b/)
  if (!m) return null
  let hora = Math.max(0, Math.min(23, parseInt(m[1], 10)))
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)))
  if (hora < 12 && hora + 12 >= 19 && hora + 12 <= 21) hora += 12
  return `${String(hora).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Detecta a preferencia de DIA que o lead expressou ao responder uma oferta de
// reuniao. Retorna 'outro_dia' (lead recusou hoje / pediu outro dia: amanha,
// semana que vem, etc.), 'hoje' (lead reforcou hoje/agora), ou null. Quando e
// 'outro_dia', o fluxo reconsulta a agenda a partir de amanha (proximo dia util
// disponivel) em vez de re-ofertar hoje. Escopo proposital: nao mapeia dia da
// semana especifico — qualquer pedido de "outro dia" cai no proximo disponivel.
function extrairPreferenciaDia(texto) {
  const s = norm(texto)
  if (!s) return null
  // "outro dia" tem prioridade: cobre "hoje nao, so amanha".
  if (
    /\bamanha\b/.test(s) ||
    /\bdepois de amanha\b/.test(s) ||
    /\bsemana que vem\b|\bproxima semana\b|\bsemana proxima\b/.test(s) ||
    /\boutro dia\b|\boutra data\b|\bem outro dia\b/.test(s)
  ) {
    return 'outro_dia'
  }
  if (/\bhoje\b|\bagora\b|\bja\b/.test(s)) return 'hoje'
  return null
}

// Stop-words que NUNCA podem virar "negocio" do lead — sao palavras do nosso catalogo
const NEGOCIO_STOP_WORDS = new Set([
  'site', 'sites', 'sistema', 'sistemas', 'automacao', 'automacoes', 'automação', 'automações',
  'agente de ia', 'agente', 'ia', 'landing page', 'landing', 'solucao', 'solução',
  'solucoes', 'soluções', 'projeto', 'sob medida', 'website', 'pagina', 'página',
  'paginas', 'páginas', 'app', 'aplicativo', 'integracao', 'integração',
  'integracoes', 'integrações', 'crm', 'erp', 'dashboard', 'painel',
])

function isNegocioStopWord(valor) {
  const s = norm(valor)
  if (!s) return true
  if (NEGOCIO_STOP_WORDS.has(s)) return true
  // Match no inicio: "site" / "site bonito" / "sistema crm" etc
  for (const w of NEGOCIO_STOP_WORDS) {
    if (s === w) return true
    if (s.startsWith(w + ' ')) return true
  }
  return false
}

function extrairDadosMensagem(texto) {
  const raw = String(texto || '').trim()
  const s = norm(raw)
  const out = {}

  const mTrabalho = raw.match(/\b(?:trabalho|atuo|sou|tenho|fa[cç]o|atendo)\s+(?:em|com|de|uma|um)?\s*([^,.;\n]{2,80})/i)
  if (mTrabalho && /\bcom\b/i.test(raw)) {
    const partes = raw.split(/\bcom\b/i)
    const antes = partes[0] || ''
    const depois = partes.slice(1).join(' com ')
    const cidade = antes.match(/\b(?:em|de|na|no)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ\w' ]{2,40})/i)
    if (cidade) out.cidade = normalizarCidade(cidade[1])
    if (depois) {
      const candidato = limparNegocioCurto(depois)
      if (candidato && !isNegocioStopWord(candidato)) out.negocio = candidato
    }
  }

  if (!out.cidade) {
    const cidade = raw.match(/\b(?:em|de|na|no|cidade\s+de)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40})(?=[,.;]|\s+com\b|\s+e\b|$)/i)
    if (cidade) out.cidade = normalizarCidade(cidade[1])
    else if (/\b(sbc|sao bernardo|são bernardo)\b/i.test(raw)) out.cidade = 'Sao Bernardo do Campo'
  }

  if (!out.negocio) {
    const negocio = raw.match(/\b(?:trabalho com|atuo com|fa[cç]o|tenho uma|tenho um|sou)\s+([^,.;\n]{2,60})/i)
    if (negocio && !/\b(site|sistema|autom|agente|integracao|integração)\b/i.test(negocio[1])) {
      const candidato = limparNegocioCurto(negocio[1])
      if (candidato && !isNegocioStopWord(candidato)) out.negocio = candidato
    }
  }

  // "saite", "sait", "saiti", "saiti" sao typos comuns de "site" no WhatsApp
  // — interpretamos como interesse em site/presenca digital.
  if (/\b(site|sites|saite|sait|saiti|landing|pagina|p[aá]gina|paginha|website|web ?site|page|pages)\b/.test(s)) out.necessidade = 'site'
  // Contexto livre do lead que SINALIZA necessidade de presenca digital (site):
  // intencao de captar/atrair clientes, divulgar, aparecer, mostrar trabalho,
  // impulsionar/anunciar, vender online, ou compartilhar Instagram/Facebook.
  // Capturamos pra NAO ignorar o que o lead ja disse nem re-perguntar a
  // necessidade — e o agente conecta valor em cima disso. Sinais mais
  // especificos (sistema/automacao/IA) abaixo sobrescrevem este default.
  if (
    !out.necessidade && (
      /\b(atrair|atrai|buscar|captar|capta|conseguir|conquistar|ganhar|ter)\s+(?:mais\s+|novos?\s+)?clientes?\b/.test(s) ||
      /\b(divulgar|divulgacao|aparecer|ser encontrad[oa]|presenca|mostrar\s+(?:meu|meus|o|os)?\s*trabalho|impulsionar|anunciar)\b/.test(s) ||
      /\bvender\s+(?:mais\s+)?(?:pela|na|no)\s+(?:internet|digital|online)\b/.test(s) ||
      /(?:instagram|facebook)\.com|\binsta\b/.test(s)
    )
  ) out.necessidade = 'site'
  if (/\b(sistema|crm|erp|painel|dashboard)\b/.test(s)) out.necessidade = 'sistema'
  if (/\b(automacao|automatizacao|automatizar|integracao|integrar)\b/.test(s)) out.necessidade = 'automacao'
  if (/\bagente\s+de\s+ia\b|\bia\b/.test(s)) out.necessidade = 'agente de IA'

  if (/\b(google|instagram|indicacao|indicacao|whatsapp|trafego|tr[aá]fego)\b/.test(s)) {
    out.origem_clientes = raw.slice(0, 80)
  }

  if (
    /\b(aparecer|google|seo|busca|pesquisa|whatsapp|zap|contatos?|chamadas?|leads?|clientes?|confianca|credibilidade|apresentar|mostrar|portfolio|servicos?)\b/.test(s) &&
    /\b(site|google|whatsapp|zap|contatos?|chamadas?|leads?|clientes?|confianca|credibilidade|aparecer|apresentar|mostrar)\b/.test(s)
  ) {
    out.objetivo_site = raw.slice(0, 160)
  }

  const horario = extrairHorario(raw)
  if (horario) out.horario = horario

  const preferenciaDia = extrairPreferenciaDia(raw)
  if (preferenciaDia) out.preferencia_dia = preferenciaDia
  return out
}

function normalizarCidade(cidade) {
  const v = String(cidade || '').trim().replace(/\s+/g, ' ')
  if (/^sbc$/i.test(v) || /^sao bernardo$/i.test(norm(v))) return 'Sao Bernardo do Campo'
  return v
}

function limparDadoCurto(v) {
  return String(v || '')
    .replace(/\b(eu\s+)?quero\b.*$/i, '')
    .replace(/\b(procuro|preciso)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

// Limpeza especifica para o campo "negocio" (ramo do lead). Alem do corte curto,
// remove clausula de localizacao ("restaurante em sp ...") e continuacao de frase
// corrida ("... e e meu primeiro site", "... como faco para criar") que o regex
// captura junto quando o lead escreve tudo numa linha. Rejeita ('') o que sobrar
// se ainda parecer frase (verbo) ou for termo do catalogo (site/sistema = a
// necessidade, nao o ramo), deixando a extracao da IA prevalecer.
function limparNegocioCurto(v) {
  const base = limparDadoCurto(v)
    .replace(/\s+(?:em|na|no|nas|nos)\s+.+$/i, '')
    .replace(/\s+e\s+(?:e|é|sou|to|tou|estou|tenho|preciso|quero|gostaria|meu|minha)\b.*$/i, '')
    .replace(/\s+(?:que|como|pra|para|porque|pois)\s+.+$/i, '')
    .replace(/\s+(?:meu|minha|meus|minhas)\s+.+$/i, '')
    .trim()
  if (!base || base.length < 2 || base.length > 45) return ''
  const sb = norm(base)
  if (/\b(faco|fazer|criar|criando|montar|desenvolver|gostaria|preciso|comecar)\b/.test(sb)) return ''
  if (/\b(site|sites|sistema|automacao|landing|pagina|aplicativo|app|agente)\b/.test(sb)) return ''
  return base
}

function textoPedeHumano(s) {
  return /\b(humano|atendente|pessoa|vendedor|equipe|falar com alguem|falar com alguém|me liga|ligacao|ligação)\b/.test(s)
}

function textoPedePreco(s) {
  return /\b(quanto custa|preco|preço|valor|investimento|mensalidade|custa quanto|quanto fica|or[cç]amento)\b/.test(s)
}

function textoPerguntaComoFunciona(s) {
  return /\bcomo funciona\b/.test(s)
}

function textoSoPesquisando(s) {
  return /\b(so|s[oÃ³]mente|apenas)\s+(estou\s+)?(pesquisando|olhando|vendo|cotando|or[cÃ§]ando)\b|\bestou\s+(pesquisando|olhando|vendo|cotando|or[cÃ§]ando)\b/.test(s)
}

function textoSemInteresse(s) {
  return /\b(n[aÃ£]o tenho interesse|sem interesse|n[aÃ£]o me interessa|n[aÃ£]o quero|n[aÃ£]o preciso|pare|para de mandar|encerrar|cancela)\b/.test(s)
}

function textoAceita(s) {
  return /\b(quero|aceito|fechado|pode mandar|manda o link|envia o link|vou assinar|gostei|pode ser|bora|vamos fechar)\b/.test(s)
}

function textoSobMedida(s) {
  return /\b(sistema|automacao|automatizacao|agente de ia|integracao|painel|dashboard|crm|erp|sob medida|personalizado|personalizada|exclusivo|cadastro|agendamento)\b/.test(s)
}

function textoSaudacao(s) {
  return /^(oi|ola|ol[aá]|opa|bom dia|boa tarde|boa noite|tudo bem)[!?.\s]*$/.test(s)
}

function dadosFaltantes(perfil) {
  return ORDEM_DADOS.filter((campo) => {
    const v = perfil[campo]
    return v == null || v === ''
  })
}

// Mapeia a necessidade canonica do classificador IA (agente_ia,
// solucao_sob_medida) para o vocabulario que o orquestrador e o
// inferirRotaComercial entendem (com espacos), preservando os demais valores.
function mapearNecessidadeIA(valor) {
  const s = norm(valor)
  if (!s) return null
  if (s === 'agente_ia' || s === 'agente de ia') return 'agente de IA'
  if (s === 'solucao_sob_medida' || s === 'solucao sob medida') return 'solucao sob medida'
  if (s === 'automacao') return 'automacao'
  if (s === 'sistema') return 'sistema'
  if (s === 'site') return 'site'
  return valor
}

// Funde a extracao do classificador IA sobre a do regex: a IA vence onde tem
// valor; o regex permanece como fallback (quando a IA falha/timeout). Mapeia os
// nomes de campo da IA (cidade_base -> cidade, necessidade canonica) para o
// shape que o orquestrador usa.
function mesclarDadosExtraidosIA(regex = {}, ia = null) {
  if (!ia || typeof ia !== 'object') return regex || {}
  const out = { ...(regex || {}) }
  if (ia.negocio) out.negocio = ia.negocio
  if (ia.cidade_base) out.cidade = ia.cidade_base
  else if (ia.regiao_atendimento && !out.cidade) out.cidade = ia.regiao_atendimento
  const nec = mapearNecessidadeIA(ia.necessidade)
  if (nec) out.necessidade = nec
  if (ia.origem_clientes) out.origem_clientes = ia.origem_clientes
  if (ia.objetivo_site) out.objetivo_site = ia.objetivo_site
  return out
}

function mergePerfilCanonico(perfil, dados) {
  return {
    ...perfil,
    negocio: perfil.negocio || dados.negocio || null,
    cidade: perfil.cidade || dados.cidade || null,
    necessidade: perfil.necessidade || dados.necessidade || null,
    origem_clientes: perfil.origem_clientes || dados.origem_clientes || null,
    objetivo_site: perfil.objetivo_site || dados.objetivo_site || null,
  }
}

function rotaPorTexto(perfil, s) {
  if (perfil.rota_comercial) return perfil.rota_comercial
  if (textoSobMedida(s)) return 'projeto_sob_medida'
  return null
}

function decidirProximaAcao(input = {}) {
  const mensagemAtual = String(input.mensagemAtual || '').trim()
  const historico = Array.isArray(input.historico) ? input.historico : []
  const etapaAtual = input.etapaAtual || input.etapa_atual || 'primeiro_contato'
  const perfilCanonico = canonicalizarPerfilLead(input.perfil || {}, etapaAtual)
  // Guarda de eco: se o lead colou a pergunta do bot de volta, extraimos dados
  // apenas da resposta real (o que veio depois do "?"), nunca da pergunta colada.
  const eco = separarEcoDaUltimaPergunta(mensagemAtual, historico)
  const mensagemEfetiva = eco.ehEco ? eco.restante : mensagemAtual
  const s = norm(mensagemEfetiva)
  // Fase 2: a extracao do classificador IA (quando o caller a injeta) e a fonte
  // primaria; o regex preenche apenas o que a IA nao trouxe (fallback).
  const dados_extraidos = mesclarDadosExtraidosIA(extrairDadosMensagem(mensagemEfetiva), input.dadosExtraidosIA)
  const perfil = mergePerfilCanonico(perfilCanonico, dados_extraidos)
  const rota = rotaPorTexto(perfil, s)
  const faltantes = dadosFaltantes(perfil)
  const temAssistente = historico.some((m) => m && m.role === 'assistant')
  const horarioEscolhido = dados_extraidos.horario || null
  const horariosOferecidos = perfil.horarios_oferecidos || []
  const base = {
    acao_decidida: 'fallback_seguro',
    etapa_sugerida: etapaAtual,
    rota_comercial: rota,
    dados_faltantes: faltantes,
    dados_extraidos,
    motivo_decisao: 'fallback_sem_regra_especifica',
    acoes_proibidas: montarAcoesProibidas(rota),
    ultima_pergunta: ultimaPergunta(historico),
  }

  const leadAvancado = isLeadHistoricoAvancado({ historico, etapaAtual, perfil: perfilCanonico })
  const pesoAtual = Math.max(estagioPeso(etapaAtual), estagioPeso(perfilCanonico.etapa_atual))

  const finish = (patch) => {
    const out = { ...base, ...patch }
    if (!ACOES_VALIDAS.has(out.acao_decidida)) out.acao_decidida = 'fallback_seguro'

    // Protecao contra regressao de estagio.
    const pesoSugerido = estagioPeso(out.etapa_sugerida)
    if (pesoSugerido < pesoAtual && etapaAtual && etapaAtual !== out.etapa_sugerida) {
      const ehAcaoNeutra = !['primeiro_contato', 'diagnostico'].includes(out.acao_decidida)
      const original = { etapa: out.etapa_sugerida, acao: out.acao_decidida }
      out.etapa_sugerida = etapaAtual
      // Se a acao proposta era a "primeira pergunta" generica e o lead ja esta avancado,
      // troca para responder_duvida (continuidade segura, sem reiniciar funil).
      if (!ehAcaoNeutra) {
        out.acao_decidida = 'responder_duvida'
        out.motivo_decisao = 'estagio_protegido_lead_avancado'
      }
      out._estagio_protegido = { de: original.etapa, para: etapaAtual, acao_original: original.acao }
    }

    // Lead com historico longo nao deve receber pergunta inicial generica.
    if (leadAvancado && ['primeiro_contato'].includes(out.acao_decidida)) {
      out.acao_decidida = 'responder_duvida'
      out.motivo_decisao = 'lead_avancado_evitando_reiniciar_funil'
    }

    const extras = Array.isArray(patch.acoes_proibidas) ? patch.acoes_proibidas : []
    out.acoes_proibidas = [...new Set([...montarAcoesProibidas(out.rota_comercial, out.acao_decidida), ...extras])]
    return out
  }

  // Lead apenas ecoou a pergunta do bot, sem dar resposta propria: nao repetimos
  // a mesma pergunta (deterministica). Caimos em responder_duvida, que deixa o
  // LLM acolher e reengajar lendo o contexto, em vez de reabrir o loop.
  if (eco.ehEco && !s) {
    return finish({
      acao_decidida: 'responder_duvida',
      etapa_sugerida: etapaAtual,
      motivo_decisao: 'lead_ecoou_pergunta_sem_resposta',
    })
  }

  if (textoPedeHumano(s)) {
    return finish({
      acao_decidida: 'pedido_humano',
      etapa_sugerida: 'handoff_humano',
      motivo_decisao: 'lead_pediu_humano',
    })
  }

  if (textoSemInteresse(s)) {
    return finish({
      acao_decidida: 'opt_out',
      etapa_sugerida: 'opt_out',
      motivo_decisao: 'lead_sem_interesse',
    })
  }

  if (perfil.reuniao_confirmada && !perfil.email) {
    return finish({
      acao_decidida: 'pedir_email',
      etapa_sugerida: 'reuniao_agendada',
      rota_comercial: 'projeto_sob_medida',
      motivo_decisao: 'reuniao_confirmada_sem_email',
    })
  }

  if (horarioEscolhido) {
    if (horariosOferecidos.includes(horarioEscolhido)) {
      return finish({
        acao_decidida: 'confirmacao_reuniao',
        etapa_sugerida: 'reuniao_agendada',
        rota_comercial: 'projeto_sob_medida',
        motivo_decisao: 'horario_escolhido_entre_oferecidos',
      })
    }
    return finish({
      acao_decidida: 'consultar_agenda',
      etapa_sugerida: 'sob_medida_agenda_oferecida',
      rota_comercial: 'projeto_sob_medida',
      motivo_decisao: 'horario_nao_oferecido',
    })
  }

  if (!temAssistente && textoSaudacao(s)) {
    return finish({
      acao_decidida: 'primeiro_contato',
      etapa_sugerida: 'coleta_basica',
      motivo_decisao: 'saudacao_inicial',
    })
  }

  if (textoSoPesquisando(s)) {
    return finish({
      acao_decidida: 'lead_pesquisando',
      etapa_sugerida: 'diagnostico',
      rota_comercial: rota || null,
      motivo_decisao: 'lead_so_pesquisando',
    })
  }

  if (textoPedePreco(s)) {
    return finish({
      acao_decidida: 'responder_preco_sem_contexto',
      etapa_sugerida: 'diagnostico',
      rota_comercial: rota || null,
      motivo_decisao: 'pergunta_preco_sem_rota_definida',
    })
  }

  if (textoPerguntaComoFunciona(s)) {
    return finish({
      acao_decidida: 'responder_duvida',
      etapa_sugerida: etapaAtual,
      rota_comercial: rota || null,
      motivo_decisao: 'lead_perguntou_como_funciona_antes_da_coleta',
      acoes_proibidas: ['coletar_antes_de_explicar', 'oferecer_reuniao'],
    })
  }

  if (ultimaPerguntaPedeTemSite(historico) && !respondeuTemSite(mensagemEfetiva)) {
    return finish({
      acao_decidida: 'responder_duvida',
      etapa_sugerida: etapaAtual,
      rota_comercial: rota || 'projeto_sob_medida',
      motivo_decisao: 'lead_nao_respondeu_pergunta_tem_site_reformular_com_explicacao',
      proximo_dado: 'tem_site',
      acoes_proibidas: ['oferecer_reuniao', 'avancar_funil', 'ignorar_pergunta_pendente'],
    })
  }

  const interesseSite = norm(perfil.necessidade).includes('site') || norm(perfil.produto_sugerido).includes('site')
  const contextoMinimoSiteCompleto = Boolean(perfil.negocio && perfil.cidade && perfil.objetivo_site)

  if (rota === 'projeto_sob_medida') {
    if (faltantes.includes('negocio') || faltantes.includes('cidade') || faltantes.includes('necessidade')) {
      return finish({
        acao_decidida: 'explicar_projeto_sob_medida',
        etapa_sugerida: 'sob_medida_contexto',
        rota_comercial: 'projeto_sob_medida',
        motivo_decisao: 'projeto_sob_medida_precisa_contexto_minimo',
      })
    }
    if (interesseSite && !contextoMinimoSiteCompleto) {
      return finish({
        acao_decidida: 'conexao_valor',
        etapa_sugerida: 'qualificacao_caminho',
        rota_comercial: 'projeto_sob_medida',
        motivo_decisao: 'site_sob_medida_precisa_objetivo_antes_reuniao',
      })
    }
    return finish({
      acao_decidida: 'consultar_agenda',
      etapa_sugerida: 'sob_medida_agenda_oferecida',
      rota_comercial: 'projeto_sob_medida',
      motivo_decisao: 'projeto_sob_medida_com_contexto_minimo',
    })
  }

  // Coleta de dados basicos — mas SO pergunta um dado que ainda nao foi
  // perguntado. Se ja perguntamos negocio/cidade/necessidade e o lead respondeu
  // algo ininteligivel (ou um menu de bot da outra empresa), NAO repetimos a
  // pergunta: caimos no avanco abaixo (conexao de valor / reuniao / duvida).
  const FALTANTES_BASICOS = ['negocio', 'cidade', 'necessidade']
  const faltanteBasicoNaoPerguntado = FALTANTES_BASICOS
    .filter((c) => faltantes.includes(c))
    .find((c) => !jaPerguntouDadoBasico(c, historico))
  if (faltanteBasicoNaoPerguntado) {
    return finish({
      acao_decidida: temAssistente ? 'diagnostico' : 'primeiro_contato',
      etapa_sugerida: 'coleta_basica',
      motivo_decisao: 'coleta_dados_basicos',
      proximo_dado: faltanteBasicoNaoPerguntado,
    })
  }

  if (interesseSite && contextoMinimoSiteCompleto && !perfil.reuniao_confirmada && !perfil.reuniao_proposta?.horario_confirmado) {
    return finish({
      acao_decidida: 'consultar_agenda',
      etapa_sugerida: 'sob_medida_agenda_oferecida',
      rota_comercial: 'projeto_sob_medida',
      motivo_decisao: 'site_com_negocio_cidade_objetivo_avancar_para_reuniao',
    })
  }

  // Perfil completo (negocio + cidade + necessidade) E conversa ja longa:
  // chega de diagnostico, oferece reuniao. Evita o loop "voce ja tem site
  // tambem ou so o Instagram? > so o instagram > ... > nova pergunta" que
  // o LLM as vezes produz quando nao tem regra clara para avancar.
  if (historico.length >= 8 && !perfil.reuniao_confirmada && !perfil.reuniao_proposta?.horario_confirmado) {
    return finish({
      acao_decidida: 'consultar_agenda',
      etapa_sugerida: 'sob_medida_agenda_oferecida',
      rota_comercial: rota || 'projeto_sob_medida',
      motivo_decisao: 'perfil_completo_historico_longo_avancar_para_reuniao',
    })
  }

  // Conecta valor e pergunta a origem dos clientes — mas APENAS uma vez. Se ja
  // perguntamos antes e o lead nao deu uma resposta interpretavel, seguimos em
  // frente (responder_duvida) em vez de insistir e entrar em loop.
  if (!perfil.origem_clientes && !jaPerguntouOrigemClientes(historico)) {
    return finish({
      acao_decidida: 'conexao_valor',
      etapa_sugerida: 'qualificacao_caminho',
      motivo_decisao: 'dados_basicos_coletados_conectar_valor',
    })
  }

  return finish({
    acao_decidida: 'responder_duvida',
    etapa_sugerida: etapaAtual,
    motivo_decisao: 'continuidade_sem_acao_critica',
  })
}

function montarAcoesProibidas(rota, acao = null) {
  const comuns = [
    'criar_acao_nova',
    'alterar_etapa',
    'inventar_concorrente',
    'prometer_google',
    'pedir_cpf_cnpj_endereco_pagamento',
    'usar_mais_de_2_bolhas',
    'fazer_mais_de_1_pergunta',
  ]
  if (rota === 'projeto_sob_medida') {
    comuns.push('informar_preco_sob_medida')
  }
  if (acao !== 'convite_reuniao' && acao !== 'confirmacao_reuniao') {
    comuns.push('confirmar_horario', 'oferecer_horario_sem_agenda')
  }
  return comuns
}

module.exports = {
  ACOES_VALIDAS,
  decidirProximaAcao,
  extrairDadosMensagem,
  mesclarDadosExtraidosIA,
  separarEcoDaUltimaPergunta,
  jaPerguntouOrigemClientes,
  extrairHorario,
  extrairPreferenciaDia,
  STAGE_ORDER,
  estagioPeso,
  isLeadHistoricoAvancado,
  isNegocioStopWord,
  NEGOCIO_STOP_WORDS,
  textoSemInteresse,
  textoSoPesquisando,
}
