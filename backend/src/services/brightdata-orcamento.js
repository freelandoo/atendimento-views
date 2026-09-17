'use strict'
// Orcamento de creditos da Bright Data — a trava que decide se uma coleta PAGA pode sair.
//
// POR QUE EXISTE. Medido em 2026-09-16: `pesquisarPlaces` nao consultava orcamento nenhum. Uma
// rotina de aquisicao dispara a cada 6h importando ate' 200 registros — 800 creditos/dia por
// rotina ativa, sem trava. Com 4.760 creditos gratuitos, uma unica rotina esgota a conta em ~6
// dias. O teto existia so' na captacao social (`BRIGHTDATA_CAPTACAO_TETO_DIARIO`), justamente o
// canal que gasta menos.
//
// MODULO PURO: sem banco, sem HTTP, sem rede. Ele nao sabe quanto foi consumido — recebe os
// numeros e devolve o VEREDITO. Quem tem o banco na mao aplica.
//
// SAO DUAS TRAVAS, e elas respondem a perguntas diferentes:
//   TETO DIARIO  — "quanto pode queimar por dia?"  Controla a VELOCIDADE do gasto.
//   RESERVA      — "quanto nao pode ser tocado?"   Protege o SALDO para outro uso.
// So' a segunda impede que a Aquisicao consuma os creditos destinados ao enriquecimento. Um teto
// diario sozinho nao resolve isso: 400/dia ainda zera a conta em 12 dias.

/** Tipos de scraper que consomem credito. Lista FECHADA — espelha o CHECK da migration 081. */
const SCRAPER = Object.freeze({
  MAPS_DESCOBERTA: 'maps_descoberta',
  IG_DESCOBERTA: 'ig_descoberta',
  IG_PERFIS: 'ig_perfis',
  IG_POSTS: 'ig_posts',
  LI_DESCOBERTA: 'li_descoberta',
  LI_PERFIS: 'li_perfis',
})
const SCRAPERS = Object.freeze(Object.values(SCRAPER))

/** Por que uma coleta foi barrada. Vira mensagem ao operador e motivo no log. */
const MOTIVO = Object.freeze({
  LIBERADO: 'liberado',
  TETO_DIARIO: 'teto_diario',
  RESERVA: 'reserva',
})

const PADRAO_TETO_DIARIO = 400   // 2 coletas cheias de 200 registros
const PADRAO_RESERVA = 1000      // creditos que a Aquisicao nao pode tocar
const PADRAO_TETO_ENRIQUECIMENTO = 150  // ~1 rodada de 200 leads a cada 2 dias

function inteiroNaoNegativo(valor, padrao) {
  const n = Number.parseInt(valor, 10)
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

/**
 * Teto diario de creditos da AQUISICAO (Google Maps). `0` desliga a trava.
 *
 * Separado de `BRIGHTDATA_CAPTACAO_TETO_DIARIO` de proposito: os dois canais gastam em ritmos
 * muito diferentes (a Aquisicao traz ate' 200 registros de uma vez) e um numero unico obrigaria
 * a escolher entre travar a Aquisicao demais ou a captacao de menos.
 */
function tetoDiarioAquisicao() {
  return inteiroNaoNegativo(process.env.BRIGHTDATA_AQUISICAO_TETO_DIARIO, PADRAO_TETO_DIARIO)
}

/**
 * Creditos intocaveis pela coleta automatica. `0` desliga.
 *
 * Existe porque o enriquecimento (perfil de Instagram, posts) precisa de saldo, e quem gasta
 * primeiro nao e' quem precisa mais: a Aquisicao roda sozinha, em rotina, e o enriquecimento
 * depende de uma decisao humana. Sem reserva, a coleta automatica come o saldo do trabalho que
 * o operador ainda nem comecou.
 */
function reservaCreditos() {
  return inteiroNaoNegativo(process.env.BRIGHTDATA_RESERVA_CREDITOS, PADRAO_RESERVA)
}

/**
 * Teto diario de creditos do ENRIQUECIMENTO (perfil de Instagram).
 *
 * Separado do teto da Aquisicao pelo mesmo motivo que a captacao social tem o dela: os canais
 * gastam em ritmos diferentes e um numero unico obrigaria a escolher entre travar um demais ou o
 * outro de menos. 150/dia ≈ uma rodada de 200 leads a cada dois dias.
 *
 * ATENCAO: quem gasta pelo enriquecimento roda com `reserva: 0`. A reserva existe para proteger
 * o enriquecimento DA Aquisicao; aplica-la aqui faria o enriquecimento ser barrado justamente
 * pelos creditos que foram guardados para ele.
 */
function tetoDiarioEnriquecimento() {
  return inteiroNaoNegativo(process.env.BRIGHTDATA_ENRIQUECIMENTO_TETO_DIARIO, PADRAO_TETO_ENRIQUECIMENTO)
}

/**
 * Esta coleta paga pode sair?
 *
 * `saldoEstimado` e' `null` quando ninguem informou o saldo da conta (ver db/brightdata-consumo).
 * Nesse caso a trava de RESERVA e' PULADA, nao assumida: bloquear por um saldo que nao se conhece
 * pararia a operacao inteira por falta de cadastro, e chutar um saldo seria pior — e' a mesma
 * disciplina de "ausencia de prova nao e' prova de ausencia" que o resto do projeto aplica.
 *
 * `custoEstimado` e' o teto de registros que a coleta pode devolver (a quantidade solicitada),
 * nao uma media. Orcamento se faz pelo pior caso: o custo real so' e' conhecido quando o
 * snapshot volta, e ai' ja' foi pago.
 */
function avaliarOrcamento({
  consumidoHoje = 0,
  custoEstimado = 0,
  saldoEstimado = null,
  teto = tetoDiarioAquisicao(),
  reserva = reservaCreditos(),
  // Como chamar o canal na mensagem ao operador. A trava e' a mesma; o texto nao pode ser, ou
  // o enriquecimento barrado mandaria mexer na env da Aquisicao.
  canal = { nome: 'Aquisicao', env: 'BRIGHTDATA_AQUISICAO_TETO_DIARIO' },
} = {}) {
  const gasto = Math.max(0, Number(consumidoHoje) || 0)
  const custo = Math.max(0, Number(custoEstimado) || 0)
  const saldo = saldoEstimado == null ? null : Math.max(0, Number(saldoEstimado) || 0)
  const restanteHoje = teto > 0 ? Math.max(0, teto - gasto) : null

  const base = {
    consumido_hoje: gasto,
    custo_estimado: custo,
    saldo_estimado: saldo,
    teto_diario: teto,
    reserva,
    restante_hoje: restanteHoje,
  }

  if (teto > 0 && gasto + custo > teto) {
    return {
      ...base,
      permitido: false,
      motivo: MOTIVO.TETO_DIARIO,
      mensagem: `Teto diario de creditos da ${canal.nome} atingido (${gasto}/${teto} hoje). `
        + `A coleta recomeca amanha, ou ajuste ${canal.env}.`,
    }
  }

  if (saldo != null && reserva > 0 && saldo - custo < reserva) {
    return {
      ...base,
      permitido: false,
      motivo: MOTIVO.RESERVA,
      mensagem: `Saldo estimado (${saldo} creditos) ficaria abaixo da reserva de ${reserva}. `
        + 'A coleta automatica esta pausada para preservar credito do enriquecimento.',
    }
  }

  return { ...base, permitido: true, motivo: MOTIVO.LIBERADO, mensagem: null }
}

/**
 * Saldo ESTIMADO a partir do que o operador informou.
 *
 * A API da Bright Data nao expoe saldo: o cliente deste projeto fala apenas com `/trigger`,
 * `/progress` e `/snapshot`. Entao isto NAO e' leitura oficial — e' aritmetica local sobre um
 * numero digitado por uma pessoa numa data. Quem exibir este valor e' obrigado a dizer isso;
 * apresenta-lo como saldo real faria o operador confiar num numero que ninguem conferiu.
 *
 * Devolve `null` quando nao ha' saldo informado — terceiro estado, nunca zero.
 */
function saldoEstimado({ saldoInformado = null, consumidoDesde = 0 } = {}) {
  if (saldoInformado == null) return null
  const base = Number(saldoInformado)
  if (!Number.isFinite(base)) return null
  return Math.max(0, base - Math.max(0, Number(consumidoDesde) || 0))
}

/** O scraper e' conhecido? Usado antes de gravar no ledger (o CHECK do banco e' a 2a barreira). */
function scraperConhecido(valor) {
  return SCRAPERS.includes(String(valor || ''))
}

module.exports = {
  SCRAPER,
  SCRAPERS,
  MOTIVO,
  PADRAO_TETO_DIARIO,
  PADRAO_RESERVA,
  PADRAO_TETO_ENRIQUECIMENTO,
  tetoDiarioAquisicao,
  tetoDiarioEnriquecimento,
  reservaCreditos,
  avaliarOrcamento,
  saldoEstimado,
  scraperConhecido,
}
