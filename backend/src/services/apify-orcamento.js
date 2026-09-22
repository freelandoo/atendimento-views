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

// SEM TETO por padrao — decisao do operador (2026-09-22), depois de o teto de 200 recusar a
// primeira busca do dia: o orcamento reserva o pedido INTEIRO pelo pior caso, entao uma busca
// pedindo 200 nunca caberia num teto de 200 com qualquer credito ja gasto.
//
// O QUE AINDA PROTEGE, e por isso tirar o teto nao deixa o canal sem freio nenhum:
//   * `buscarAnunciantes` limita CADA busca a 200 resultados (clamp no worker);
//   * a busca e' SOB DEMANDA — nao ha' rotina agendada neste canal, cada gasto tem um clique;
//   * o ledger (`prospectador.apify_consumo`) continua registrando tudo, entao o gasto
//     permanece auditavel mesmo sem trava.
// O mecanismo NAO foi removido: basta `APIFY_META_ADS_TETO_DIARIO=<n>` para religar a trava.
const PADRAO_TETO_DIARIO = 0

function inteiroNaoNegativo(valor, padrao) {
  const n = Number.parseInt(valor, 10)
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

/**
 * Teto diario de RESULTADOS de anuncio consumidos do Apify. `0` desliga a trava — e' o PADRAO
 * hoje (ver `PADRAO_TETO_DIARIO`). Definir um numero na env religa o teto sem mexer em codigo.
 */
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

const PADRAO_TETO_PAGINAS = 150

/**
 * Teto diario de CREDITOS Bright Data do cross-reference de paginas do Facebook.
 *
 * Existe separado de `BRIGHTDATA_ENRIQUECIMENTO_TETO_DIARIO` porque, dividindo o mesmo balde
 * com o perfil de Instagram, uma varredura grande na Biblioteca de Anuncios atrasaria em
 * silencio o enriquecimento dos leads do Maps — dois canais competindo por uma cota que nenhum
 * dos dois declarou dividir. `0` desliga.
 */
function tetoDiarioPaginasFacebook() {
  return inteiroNaoNegativo(process.env.BRIGHTDATA_META_PAGINAS_TETO_DIARIO, PADRAO_TETO_PAGINAS)
}

module.exports = {
  MOTIVO,
  PADRAO_TETO_DIARIO,
  PADRAO_TETO_PAGINAS,
  tetoDiarioMetaAds,
  tetoDiarioPaginasFacebook,
  avaliarOrcamento,
}
