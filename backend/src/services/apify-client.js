'use strict'
// Cliente do Apify — hoje so' serve o ator `facebook-ads-scraper` (Biblioteca de Anuncios do
// Meta), que a sonda de 2026-09-22 confirmou como o unico caminho encontrado para BUSCAR
// anunciantes por nicho/cidade sem ja conhecer a pagina deles (nem a API oficial da Meta nem os
// datasets prontos da Bright Data oferecem isso — ver docs/ai-task-start-log.md).
//
// Segredos so' por env (nunca no codigo):
//   APIFY_API_TOKEN               (obrigatorio p/ este canal funcionar)
//   APIFY_FACEBOOK_ADS_ACTOR_ID   id do ator (default: o confirmado na sonda, JJghSZmShuco4j9gJ)
//
// Execucao SINCRONA (run-sync-get-dataset-items): o ator processa e devolve os registros na
// mesma resposta HTTP, sem poll — mais simples que o trigger/progress/snapshot da Bright Data,
// e adequado aqui porque o volume por chamada e' pequeno (dezenas de anuncios, nao centenas).

const { logger } = require('../logger')

const BASE = 'https://api.apify.com/v2'
const ACTOR_PADRAO_FACEBOOK_ADS = 'JJghSZmShuco4j9gJ'

function token() {
  return String(process.env.APIFY_API_TOKEN || '').trim()
}

function apifyConfigurado() {
  return Boolean(token())
}

function atorFacebookAds() {
  return String(process.env.APIFY_FACEBOOK_ADS_ACTOR_ID || ACTOR_PADRAO_FACEBOOK_ADS).trim()
}

/**
 * Roda um ator SINCRONAMENTE e devolve os itens do dataset.
 *
 * `timeoutSeg` e' o prazo que o Apify espera antes de devolver a resposta (a API tambem tem um
 * teto proprio); passado esse prazo o ator continua rodando do lado do Apify, mas esta chamada
 * ja teria retornado erro — por isso o timeout do lado de ca' (`APIFY_TIMEOUT_MS`) precisa ser
 * maior que `timeoutSeg`.
 *
 * NUNCA usa o token em log nem no erro devolvido — so' HTTP status e mensagem da API.
 */
async function rodarAtorSincrono(actorId, input, { timeoutSeg = 120 } = {}) {
  const tk = token()
  if (!tk) {
    const err = new Error('APIFY_API_TOKEN ausente — canal de anuncios do Meta desativado.')
    err.code = 'APIFY_OFF'
    throw err
  }
  const url = `${BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(tk)}&timeout=${encodeURIComponent(timeoutSeg)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(),
    Number(process.env.APIFY_TIMEOUT_MS || (timeoutSeg + 30) * 1000))
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input || {}),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const texto = await res.text()
  let json = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || texto || `HTTP ${res.status}`
    const err = new Error(`Apify ${res.status}: ${String(msg).slice(0, 300)}`)
    err.statusCode = res.status
    throw err
  }
  const registros = Array.isArray(json) ? json : []
  logger.info({ actorId, registros: registros.length }, '[apify] run-sync ok')
  return registros
}

module.exports = {
  apifyConfigurado,
  atorFacebookAds,
  rodarAtorSincrono,
  ACTOR_PADRAO_FACEBOOK_ADS,
}
