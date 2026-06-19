'use strict'

const ESTAGIOS_INTERESSE_ALTO = new Set([
  'proposta',
  'fechamento',
  'handoff',
  'reuniao_agendada',
  'agendamento_pendente',
])

const ESTAGIOS_INTERESSE_MEDIO = new Set(['diagnostico', 'qualificacao'])

const RX = {
  precoProposta: /\b(quanto|preco|valor|orcamento|investimento|custa|custaria|plano|proposta|parcel|pix|cartao|boleto|pagamento)\b/,
  proximoPasso: /\b(quero|vamos|bora|pode|posso|manda|envia|enviar|fechado|contratar|comecar|iniciar|seguir|assinar)\b.{0,70}\b(comecar|iniciar|fechar|contratar|proposta|orcamento|link|pagamento|agendar|marcar|reuniao)\b|\b(fecha|fechado|pode ser|vamos fechar|bora fechar|pode mandar)\b/,
  reuniao: /\b(reuniao|call|ligacao|video|horario|agenda|agendar|marcar|sabado|domingo|segunda|terca|quarta|quinta|sexta|amanha|hoje)\b/,
  dor: /\b(preciso|precisamos|dificuldade|problema|poucos clientes|sem clientes|nao tenho site|nao aparece|aparecer no google|vender mais|aumentar vendas|movimento fraco|ta fraco|esta fraco)\b/,
  urgencia: /\b(urgente|rapido|logo|agora|hoje|amanha|essa semana|o quanto antes|ja|pra ontem)\b/,
  decisaoOrcamento: /\b(sou dono|sou a dona|responsavel|decido|eu decido|orcamento|tenho verba|posso pagar|pagamento|pix|cartao|boleto|entrada)\b/,
  semInteresse: /\b(sem interesse|nao tenho interesse|nao quero|nao preciso|para de mandar|remover|cancelar|desistir)\b/,
  postergar: /\b(vou ver|vou pensar|depois|mais pra frente|mais tarde|outro momento|nao e agora|agora nao|te aviso|qualquer coisa|so pesquisando|so olhando|apenas pesquisando)\b/,
  bloqueioFinanceiro: /\b(muito caro|caro demais|sem dinheiro|sem grana|apertado|sem orcamento|nao tenho orcamento)\b/,
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)))
}

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function textoMensagem(m) {
  return String((m && (m.content || m.text)) || '').trim()
}

function resumoTexto(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 140)
}

function safeObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

function tem(v) {
  return v != null && String(v).trim() !== ''
}

function temObjeto(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
}

function prepararLeadMessages(historico) {
  return (Array.isArray(historico) ? historico : [])
    .filter((m) => m && m.role === 'user')
    .map((m) => textoMensagem(m))
    .filter((txt) => txt && !/^\[operador humano\]:/i.test(txt))
    .map((txt) => ({ raw: txt, norm: norm(txt), len: txt.length }))
}

function achar(textos, rx) {
  return textos.find((t) => rx.test(t.norm)) || null
}

function ultimaRole(historico) {
  const h = Array.isArray(historico) ? historico : []
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i] && h[i].role) return String(h[i].role)
  }
  return ''
}

function faixaInteresse(score) {
  if (score >= 70) return { faixa: 'alto', label: 'Interesse alto', resumo: 'Prioridade comercial agora' }
  if (score >= 40) return { faixa: 'medio', label: 'Interesse medio', resumo: 'Precisa nutrir ou confirmar proximo passo' }
  return { faixa: 'baixo', label: 'Interesse baixo', resumo: 'Pouco sinal de compra no momento' }
}

function calcularHorasSemResposta(historico, atualizadoEm, nowInput) {
  if (ultimaRole(historico) !== 'assistant') return null
  const updated = new Date(atualizadoEm || '').getTime()
  const now = nowInput ? new Date(nowInput).getTime() : Date.now()
  if (!Number.isFinite(updated) || !Number.isFinite(now) || now <= updated) return null
  return Math.floor((now - updated) / 36e5)
}

function calcularScoreInteresseLead(perfil = {}, ctx = {}) {
  const historico = Array.isArray(ctx.historico) ? ctx.historico : (Array.isArray(perfil.historico) ? perfil.historico : [])
  const leadMsgs = prepararLeadMessages(historico)
  const insights = safeObj(perfil.insights_lead)
  const criterios = []
  let score = 0

  const add = (delta, titulo, detalhe, tipo = delta >= 0 ? 'positivo' : 'negativo') => {
    criterios.push({ delta, titulo, detalhe: detalhe || '', tipo })
    score += delta
  }

  if (leadMsgs.length === 0) {
    add(0, 'Sem fala do lead', 'Ainda nao ha mensagens suficientes para medir interesse.', 'neutro')
  }

  const semInteresse = achar(leadMsgs, RX.semInteresse)
  if (semInteresse) add(-45, 'Recusou ou sinalizou falta de interesse', resumoTexto(semInteresse.raw))

  const postergar = achar(leadMsgs, RX.postergar)
  if (postergar) add(-25, 'Postergou ou esta so pesquisando', resumoTexto(postergar.raw))

  const bloqueioFinanceiro = achar(leadMsgs, RX.bloqueioFinanceiro)
  if (bloqueioFinanceiro) add(-18, 'Bloqueio financeiro declarado', resumoTexto(bloqueioFinanceiro.raw))

  const preco = achar(leadMsgs, RX.precoProposta)
  if (preco) add(22, 'Pediu preco, proposta ou condicoes', resumoTexto(preco.raw))

  const proximo = achar(leadMsgs, RX.proximoPasso)
  if (proximo) add(25, 'Indicou proximo passo de compra', resumoTexto(proximo.raw))

  const reuniao = achar(leadMsgs, RX.reuniao)
  if (reuniao || temObjeto(perfil.reuniao_proposta)) {
    add(18, 'Falou de reuniao ou horario', reuniao ? resumoTexto(reuniao.raw) : 'Reuniao registrada no perfil.')
  }

  const dor = achar(leadMsgs, RX.dor)
  if (tem(perfil.dor_principal) || dor) {
    add(15, 'Dor ou necessidade concreta', tem(perfil.dor_principal) ? resumoTexto(perfil.dor_principal) : resumoTexto(dor.raw))
  }

  if (tem(perfil.intencao_principal) || tem(perfil.produto_sugerido)) {
    add(10, 'Intencao/produto identificado', resumoTexto(perfil.intencao_principal || perfil.produto_sugerido))
  }

  const urgenciaLead = String(insights.urgencia || '').toLowerCase()
  const urgenciaMsg = achar(leadMsgs, RX.urgencia)
  if (urgenciaLead === 'alta' || urgenciaMsg) {
    add(15, 'Urgencia declarada', urgenciaMsg ? resumoTexto(urgenciaMsg.raw) : 'Urgencia alta no perfil.')
  } else if (urgenciaLead === 'media') {
    add(8, 'Urgencia media', 'O lead demonstrou alguma pressa, mas sem decisao imediata.')
  }

  const decisaoOrcamento = achar(leadMsgs, RX.decisaoOrcamento)
  if (String(insights.eh_decisor || '').toLowerCase() === 'sim' || tem(insights.orcamento_mencionado) || decisaoOrcamento) {
    add(8, 'Sinal de decisor ou orcamento', decisaoOrcamento ? resumoTexto(decisaoOrcamento.raw) : resumoTexto(insights.orcamento_mencionado || 'Decisor identificado.'))
  } else if (String(insights.eh_decisor || '').toLowerCase() === 'nao') {
    add(-10, 'Nao parece ser decisor', 'Pode depender de outra pessoa para fechar.')
  }

  if (tem(perfil.negocio)) add(5, 'Negocio identificado', resumoTexto(perfil.negocio))

  const temperatura = String(perfil.temperatura_lead || '').toLowerCase()
  if (temperatura === 'quente') add(10, 'Temperatura quente', 'Classificacao comercial atual do perfil.')
  else if (temperatura === 'morno') add(5, 'Temperatura morna', 'Existe interesse, mas ainda sem sinal forte.')
  else if (temperatura === 'frio') add(-5, 'Temperatura fria', 'Perfil classificado como frio.')

  const estagio = String(ctx.estagio || perfil.estagio || '').toLowerCase()
  if (ESTAGIOS_INTERESSE_ALTO.has(estagio)) add(15, 'Etapa comercial avancada', estagio)
  else if (ESTAGIOS_INTERESSE_MEDIO.has(estagio)) add(6, 'Etapa de diagnostico/qualificacao', estagio)

  if (leadMsgs.length >= 6) add(12, 'Engajamento alto', `${leadMsgs.length} mensagens do lead.`)
  else if (leadMsgs.length >= 3) add(8, 'Engajamento medio', `${leadMsgs.length} mensagens do lead.`)
  else if (leadMsgs.length >= 1) add(2, 'Primeiro sinal de contato', `${leadMsgs.length} mensagem do lead.`)

  const msgDetalhada = leadMsgs.find((m) => m.len >= 60)
  if (msgDetalhada) add(8, 'Resposta com contexto', resumoTexto(msgDetalhada.raw))

  const apenasCurto = leadMsgs.length > 0 && leadMsgs.every((m) => m.len <= 12)
  if (apenasCurto && !preco && !proximo && !reuniao) {
    add(-12, 'Respostas muito curtas', 'Pouco contexto para inferir compra real.')
  }

  const horasSemResposta = calcularHorasSemResposta(historico, ctx.atualizadoEm || perfil.atualizado_em, ctx.now)
  if (horasSemResposta != null) {
    if (horasSemResposta >= 168) add(-25, 'Sem resposta ha 7 dias ou mais', `${horasSemResposta}h desde a ultima mensagem do agente.`)
    else if (horasSemResposta >= 72) add(-15, 'Sem resposta ha mais de 72h', `${horasSemResposta}h desde a ultima mensagem do agente.`)
  }

  const scoreFinal = clampScore(score)
  const faixa = faixaInteresse(scoreFinal)
  return {
    score: scoreFinal,
    ...faixa,
    criterios,
    mensagens_lead: leadMsgs.length,
  }
}

module.exports = {
  calcularScoreInteresseLead,
  faixaInteresse,
}
