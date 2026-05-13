'use strict'

/** Faixas de preço por plano (min-max em R$). */
const PLANOS_RANGES = {
  iniciante: { min: 200,  max: 600  },
  padrao:    { min: 600,  max: 1000 },
  premium:   { min: 1000, max: 2000 },
}

/** Peso de ROI por ticket do cliente (0 = ROI mínimo, 1 = ROI máximo). */
const TICKET_ROI_PESO = { baixo: 0.0, medio: 0.33, alto: 0.66, premium: 1.0 }

/** Fallback de plano quando plano_sugerido não estiver definido no perfil. */
const COMPLEXIDADE_PARA_PLANO = { landing: 'iniciante', servicos: 'padrao', sistema: 'premium' }

function parcelamento40_60(t) {
  const t0 = Math.round(Number(t) || 0)
  return {
    entrada: Math.round(t0 * 0.4),
    parcela: Math.round((t0 * 0.6) / 3),
  }
}

/** ROI score 0-1: média de fator_ticket e fator_dor. */
function calcularRoiScore(ticket, score_dor) {
  const ticketFator = TICKET_ROI_PESO[ticket] ?? 0.5
  const dorFator = Math.min(1, Math.max(0, (Number(score_dor) || 5) / 10))
  return Math.round((ticketFator + dorFator) / 2 * 100) / 100
}

/** Preço dentro da faixa do plano com base no ROI score. */
function precoDentroDoPlano(plano, roiScore) {
  const range = PLANOS_RANGES[plano] ?? PLANOS_RANGES.padrao
  return Math.round(range.min + roiScore * (range.max - range.min))
}

/** Motor de preço: faixas fixas por plano, valor personalizado por ROI (ticket + score_dor). */
function calcularPreco(perfil) {
  if (!perfil || typeof perfil !== 'object') {
    throw new Error('calcularPreco: perfil ausente ou invalido')
  }

  const plano = PLANOS_RANGES[perfil.plano_sugerido]
    ? perfil.plano_sugerido
    : (COMPLEXIDADE_PARA_PLANO[perfil.complexidade] ?? 'padrao')

  const ticket = perfil.ticket_cliente_final || 'medio'
  const roiScore = calcularRoiScore(ticket, perfil.score_dor)

  const valorPersonalizado = precoDentroDoPlano(plano, roiScore)
  const iniciante_valor    = precoDentroDoPlano('iniciante', roiScore)
  const padrao_valor       = precoDentroDoPlano('padrao',    roiScore)
  const premium_valor      = precoDentroDoPlano('premium',   roiScore)

  if (!Number.isFinite(valorPersonalizado) || valorPersonalizado <= 0) {
    throw new Error(`calcularPreco: valorPersonalizado invalido (${valorPersonalizado})`)
  }

  const range = PLANOS_RANGES[plano]
  const precificacao_json = {
    plano_recomendado: plano,
    roi_score: roiScore,
    valor_personalizado: valorPersonalizado,
    range_min: range.min,
    range_max: range.max,
    iniciante_valor,
    padrao_valor,
    premium_valor,
    parcelamento_recomendado: parcelamento40_60(valorPersonalizado),
    upgrade_iniciante_para_padrao: Math.round(padrao_valor - iniciante_valor * 0.7),
    upgrade_padrao_para_premium:   Math.round(premium_valor - padrao_valor * 0.7),
  }

  for (const [k, v] of Object.entries(precificacao_json)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new Error(`calcularPreco: campo ${k} nao finito (${v})`)
    }
  }

  const ref = parcelamento40_60(valorPersonalizado)
  if (!Number.isFinite(ref?.entrada) || !Number.isFinite(ref?.parcela)) {
    throw new Error(`calcularPreco: parcelamento invalido (entrada=${ref?.entrada}, parcela=${ref?.parcela})`)
  }

  return {
    total: valorPersonalizado,
    entrada: ref.entrada,
    parcela: ref.parcela,
    precificacao_json,
  }
}

function campoTextoPreenchido(s) {
  return typeof s === 'string' && s.trim().length > 0
}

/** Campos mínimos antes de calcular preço. Aceita plano_sugerido ou complexidade para determinar o plano. */
function diagnosticoCompletoParaPreco(perfil) {
  const temPlano =
    Object.keys(PLANOS_RANGES).includes(perfil.plano_sugerido) ||
    ['landing', 'servicos', 'sistema'].includes(perfil.complexidade)
  return (
    campoTextoPreenchido(perfil.negocio) &&
    campoTextoPreenchido(perfil.cidade) &&
    temPlano &&
    ['baixo', 'medio', 'alto', 'premium'].includes(perfil.ticket_cliente_final) &&
    perfil.score_dor != null &&
    Number.isFinite(Number(perfil.score_dor))
  )
}

module.exports = {
  PLANOS_RANGES,
  TICKET_ROI_PESO,
  COMPLEXIDADE_PARA_PLANO,
  parcelamento40_60,
  calcularRoiScore,
  precoDentroDoPlano,
  calcularPreco,
  campoTextoPreenchido,
  diagnosticoCompletoParaPreco,
}
