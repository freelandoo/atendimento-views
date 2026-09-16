'use strict'
// Acesso ao ledger de creditos da Bright Data (migration 081).
//
// A REGRA de orcamento vive em `services/brightdata-orcamento.js` (modulo PURO). Aqui so' ha' o
// I/O: quanto foi consumido, qual o saldo informado, e o registro de cada consumo.
//
// A soma e' GLOBAL, nao por empresa: os creditos sao de UMA conta Bright Data compartilhada por
// todos os tenants. `empresa_id` fica na linha para auditoria, mas somar por empresa deixaria N
// empresas gastarem N vezes o mesmo teto.

const { pool } = require('../db')
const { logger } = require('../logger')
const { scraperConhecido, saldoEstimado } = require('../services/brightdata-orcamento')

/**
 * Registra consumo REAL. Idempotente por (scraper_type, snapshot_id) — o worker da Aquisicao
 * reprocessa snapshots, e somar de novo faria o teto diario travar a operacao por consumo que
 * nao aconteceu. Devolve `true` quando a linha foi criada.
 *
 * NUNCA lanca: contabilidade quebrada nao pode derrubar uma coleta que ja' foi paga. A falha vai
 * para o log, e a unica consequencia e' o teto ficar mais frouxo do que deveria — o oposto
 * (derrubar o processamento do lote) perderia os leads ja' pagos.
 */
async function registrarConsumo({
  empresaId = null,
  prospectId = null,
  scraperType,
  datasetId = null,
  snapshotId = null,
  registros,
  contexto = null,
} = {}, client = null) {
  const exec = client || pool
  const n = Number.parseInt(registros, 10)
  if (!scraperConhecido(scraperType) || !Number.isFinite(n) || n < 0) {
    logger.warn({ scraperType, registros }, '[brightdata] consumo ignorado: entrada invalida')
    return false
  }
  try {
    const { rowCount } = await exec.query(
      `INSERT INTO prospectador.brightdata_consumo
         (empresa_id, prospect_id, scraper_type, dataset_id, snapshot_id, registros, contexto)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [empresaId, prospectId, scraperType, datasetId, snapshotId, n,
        contexto ? JSON.stringify(contexto) : null]
    )
    return rowCount > 0
  } catch (err) {
    logger.error({ err: err.message, scraperType, snapshotId }, '[brightdata] falha ao registrar consumo')
    return false
  }
}

/** Creditos consumidos hoje, na CONTA inteira. `scraperTypes` opcional restringe o recorte. */
async function consumidoHoje(scraperTypes = null) {
  const filtro = Array.isArray(scraperTypes) && scraperTypes.length
    ? 'AND scraper_type = ANY($1)' : ''
  const params = filtro ? [scraperTypes] : []
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(registros), 0)::int AS total
       FROM prospectador.brightdata_consumo
      WHERE criado_em >= date_trunc('day', NOW()) ${filtro}`,
    params
  )
  return Number(rows[0]?.total || 0)
}

/** O saldo informado mais recente, ou null quando ninguem informou. */
async function saldoInformado() {
  const { rows } = await pool.query(
    `SELECT saldo_informado, informado_em, observacao
       FROM prospectador.brightdata_saldo
      ORDER BY informado_em DESC
      LIMIT 1`
  )
  return rows[0] || null
}

/**
 * Saldo ESTIMADO da conta: informado - consumo desde o informe.
 *
 * Devolve `null` quando nao ha' saldo informado — terceiro estado, nunca zero. Quem exibir este
 * numero e' obrigado a dizer que e' estimativa a partir de um valor digitado, e nao leitura da
 * Bright Data (que nao expoe saldo nesta API).
 */
async function saldoAtual() {
  const informado = await saldoInformado()
  if (!informado) return { saldo: null, informado_em: null, consumido_desde: 0 }
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(registros), 0)::int AS total
       FROM prospectador.brightdata_consumo
      WHERE criado_em >= $1`,
    [informado.informado_em]
  )
  const consumido = Number(rows[0]?.total || 0)
  return {
    saldo: saldoEstimado({ saldoInformado: informado.saldo_informado, consumidoDesde: consumido }),
    informado_em: informado.informado_em,
    saldo_informado: informado.saldo_informado,
    consumido_desde: consumido,
  }
}

/** Append-only: cada informe e' linha nova. Sobrescrever apagaria o marco zero das contagens. */
async function informarSaldo({ saldo, observacao = null, usuarioId = null } = {}) {
  const n = Number.parseInt(saldo, 10)
  if (!Number.isFinite(n) || n < 0) {
    const e = new Error('Saldo invalido: informe um numero inteiro de creditos.')
    e.statusCode = 400
    throw e
  }
  const { rows } = await pool.query(
    `INSERT INTO prospectador.brightdata_saldo (saldo_informado, observacao, informado_por)
     VALUES ($1, $2, $3::uuid)
     RETURNING id, saldo_informado, observacao, informado_em`,
    [n, observacao, usuarioId]
  )
  return rows[0]
}

/** Consumo agregado por scraper num intervalo de dias — para o relatorio do script. */
async function consumoPorScraper(dias = 30) {
  const d = Math.max(1, Math.min(365, Number.parseInt(dias, 10) || 30))
  const { rows } = await pool.query(
    `SELECT scraper_type,
            COUNT(*)::int                 AS requisicoes,
            COALESCE(SUM(registros),0)::int AS creditos,
            MAX(criado_em)                AS ultimo
       FROM prospectador.brightdata_consumo
      WHERE criado_em >= NOW() - ($1 || ' days')::interval
      GROUP BY scraper_type
      ORDER BY creditos DESC`,
    [String(d)]
  )
  return rows
}

module.exports = {
  registrarConsumo,
  consumidoHoje,
  saldoInformado,
  saldoAtual,
  informarSaldo,
  consumoPorScraper,
}
