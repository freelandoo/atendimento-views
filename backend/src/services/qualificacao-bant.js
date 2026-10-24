'use strict'

// BANT aqui é uma leitura de qualificação, não um roteiro rígido. A ordem de
// condução é N → T → A → B, mas uma resposta pode preencher mais de um eixo.
const BANT_ORDEM = ['necessidade', 'timing', 'autoridade', 'budget']

const STATUS_VALIDOS = {
  necessidade: new Set(['desconhecida', 'confirmada', 'sem_necessidade']),
  timing: new Set(['desconhecido', 'agora', 'curto_prazo', 'futuro', 'sem_prioridade']),
  autoridade: new Set(['desconhecida', 'decisor', 'influenciador', 'precisa_aprovacao', 'nao_decisor']),
  budget: new Set([
    'desconhecido', 'aberto_a_avaliar', 'faixa_compativel', 'sem_caixa_agora',
    'sem_prioridade', 'sem_urgencia', 'precisa_aprovacao', 'nao_tem_orcamento',
  ]),
}

const STATUS_DESCONHECIDO = {
  necessidade: 'desconhecida',
  timing: 'desconhecido',
  autoridade: 'desconhecida',
  budget: 'desconhecido',
}

function textoSeguro(value, max = 280) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizarEixo(eixo, valor = {}) {
  const raw = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}
  const status = STATUS_VALIDOS[eixo].has(raw.status) ? raw.status : STATUS_DESCONHECIDO[eixo]
  const out = { status, evidencia: textoSeguro(raw.evidencia) }
  if (eixo === 'budget') out.precisa_esclarecer = raw.precisa_esclarecer === true
  return out
}

function normalizarQualificacaoBant(valor = {}) {
  const raw = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}
  const out = {}
  for (const eixo of BANT_ORDEM) out[eixo] = normalizarEixo(eixo, raw[eixo])
  return out
}

function eixoTemDado(eixo, valor) {
  if (!valor || valor.status === STATUS_DESCONHECIDO[eixo]) return false
  return eixo !== 'budget' || valor.precisa_esclarecer !== true
}

function eixoConfirmadoParaQualificacao(eixo, valor) {
  if (!eixoTemDado(eixo, valor)) return false
  if (eixo === 'necessidade') return valor.status === 'confirmada'
  if (eixo === 'timing') return ['agora', 'curto_prazo', 'futuro'].includes(valor.status)
  if (eixo === 'autoridade') return valor.status === 'decisor'
  return ['aberto_a_avaliar', 'faixa_compativel'].includes(valor.status)
}

function mesclarQualificacaoBant(anterior, atual) {
  const prev = normalizarQualificacaoBant(anterior)
  const next = normalizarQualificacaoBant(atual)
  const merged = {}

  for (const eixo of BANT_ORDEM) {
    // Uma extração sem dado nunca apaga uma resposta já confirmada. Um dado novo
    // explícito, por outro lado, pode corrigir o estado anterior.
    merged[eixo] = eixoTemDado(eixo, next[eixo]) || next[eixo].evidencia
      ? { ...prev[eixo], ...next[eixo] }
      : prev[eixo]
  }
  return avaliarQualificacaoBant(merged)
}

function avaliarQualificacaoBant(valor) {
  const bant = normalizarQualificacaoBant(valor)
  const temImpedimento =
    bant.necessidade.status === 'sem_necessidade' ||
    bant.timing.status === 'sem_prioridade' ||
    bant.budget.status === 'nao_tem_orcamento'
  const lacunas = temImpedimento
    ? []
    : BANT_ORDEM.filter((eixo) => !eixoConfirmadoParaQualificacao(eixo, bant[eixo]))

  let status = 'em_qualificacao'
  if (!lacunas.length && !temImpedimento) {
    status = 'pronto_para_assuncao'
  } else if (temImpedimento) {
    status = 'nao_qualificado'
  }

  return {
    ...bant,
    status,
    pronto_para_assuncao: status === 'pronto_para_assuncao',
    nao_qualificado: status === 'nao_qualificado',
    proxima_dimensao: status === 'em_qualificacao' ? (lacunas[0] || null) : null,
    campos_confirmados: BANT_ORDEM.filter((eixo) => eixoConfirmadoParaQualificacao(eixo, bant[eixo])),
    campos_pendentes: lacunas,
  }
}

function resumoQualificacaoBant(valor) {
  const bant = avaliarQualificacaoBant(valor)
  const partes = []
  for (const eixo of BANT_ORDEM) {
    const dado = bant[eixo]
    if (!eixoTemDado(eixo, dado)) continue
    const titulo = eixo === 'budget' ? 'Orçamento' : `${eixo[0].toUpperCase()}${eixo.slice(1)}`
    partes.push(`${titulo}: ${dado.evidencia || dado.status.replace(/_/g, ' ')}`)
  }
  return partes.join(' · ')
}

module.exports = {
  BANT_ORDEM,
  normalizarQualificacaoBant,
  mesclarQualificacaoBant,
  avaliarQualificacaoBant,
  resumoQualificacaoBant,
}
