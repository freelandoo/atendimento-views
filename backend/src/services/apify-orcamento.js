'use strict'
// Orcamento de consumo do Apify — a trava que decide se uma busca PAGA de anuncios pode sair.
//
// MODULO PURO: sem banco, sem HTTP, sem rede. Ele nao sabe quanto foi consumido — recebe os
// numeros e devolve o VEREDITO. Quem tem o banco na mao aplica (`db/apify-consumo.js`).
//
// So' teto DIARIO por enquanto — nao ha' "reserva" como o `brightdata-orcamento.js` porque, ate'
// aqui, existe um UNICO consumidor (busca de anuncios pelo nicho). Reserva existe para proteger
// um canal do outro; sem um segundo canal ainda, seria abstracao para um problema que nao existe.

const MOTIVO = Object.freeze({
  LIBERADO: 'liberado',
  TETO_DIARIO: 'teto_diario',
})

const PADRAO_TETO_DIARIO = 200 // ~2 buscas de nicho por dia, no volume tipico da sonda

function inteiroNaoNegativo(valor, padrao) {
  const n = Number.parseInt(valor, 10)
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

/** Teto diario de RESULTADOS de anuncio consumidos do Apify. `0` desliga a trava. */
function tetoDiarioMetaAds() {
  return inteiroNaoNegativo(process.env.APIFY_META_ADS_TETO_DIARIO, PADRAO_TETO_DIARIO)
}

/**
 * Esta busca paga pode sair?
 *
 * `custoEstimado` e' o teto de resultados que a busca pode devolver (`resultsLimit`), nao uma
 * media — mesma disciplina do `brightdata-orcamento.js`: o custo real so' e' conhecido quando a
 * resposta volta, e ai' ja' foi pago.
 */
function avaliarOrcamento({
  consumidoHoje = 0,
  custoEstimado = 0,
  teto = tetoDiarioMetaAds(),
} = {}) {
  const gasto = Math.max(0, Number(consumidoHoje) || 0)
  const custo = Math.max(0, Number(custoEstimado) || 0)
  const restanteHoje = teto > 0 ? Math.max(0, teto - gasto) : null

  const base = { consumido_hoje: gasto, custo_estimado: custo, teto_diario: teto, restante_hoje: restanteHoje }

  if (teto > 0 && gasto + custo > teto) {
    return {
      ...base,
      permitido: false,
      motivo: MOTIVO.TETO_DIARIO,
      mensagem: `Teto diario de anuncios consumidos do Apify atingido (${gasto}/${teto} hoje). `
        + 'A busca recomeca amanha, ou ajuste APIFY_META_ADS_TETO_DIARIO.',
    }
  }

  return { ...base, permitido: true, motivo: MOTIVO.LIBERADO, mensagem: null }
}

module.exports = {
  MOTIVO,
  PADRAO_TETO_DIARIO,
  tetoDiarioMetaAds,
  avaliarOrcamento,
}
