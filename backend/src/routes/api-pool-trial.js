'use strict'
// Busca do TRIAL sobre o POOL (base já coletada). Custo zero (sem Bright Data). Só o trial usa —
// plano pago usa a captação de verdade. Gate de auth/vínculo DENTRO do router (padrão api-plano).
//   GET  /mercados  → nichos/cidades disponíveis no pool
//   GET  /leads     → leads elegíveis por mercado (cross-tenant, só sem dono) + restantes do dia
//   POST /puxar     → copia um lead do pool para a empresa do trial (teto diário)
const express = require('express')
const router = express.Router({ mergeParams: true })
const { logger } = require('../logger')
const { requireAuth, requireEmpresaAccess } = require('../middleware/tenant')
const { poolHabilitado, podePuxar, restantesHoje, tetoDiario } = require('../services/pool-trial')
const { mercadosDoPool, listarPool, puxadasHoje, puxarDoPool } = require('../db/pool-trial')

router.use(requireAuth, requireEmpresaAccess)

// Só o trial. Plano pago (ou grandfather) não usa o pool — busca de verdade é outra porta.
function exigirTrial(req, res, next) {
  if (!poolHabilitado(req.plano)) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'POOL_INDISPONIVEL',
        message: 'A busca na base está disponível durante o teste. Assine um plano para buscar leads novos.',
      },
    })
  }
  next()
}

router.get('/mercados', exigirTrial, async (req, res) => {
  try {
    return res.json({ ok: true, data: await mercadosDoPool({}) })
  } catch (err) {
    logger.error({ err: err.message }, '[pool-trial] mercados')
    return res.status(500).json({ ok: false, error: { code: 'ERRO', message: 'Falha ao listar mercados.' } })
  }
})

router.get('/leads', exigirTrial, async (req, res) => {
  try {
    const leads = await listarPool({ nicho: req.query.nicho, cidade: req.query.cidade, uf: req.query.uf })
    const usadas = await puxadasHoje(req.empresa.id)
    return res.json({ ok: true, data: leads, meta: { restantes_hoje: restantesHoje(usadas), teto_diario: tetoDiario() } })
  } catch (err) {
    logger.error({ err: err.message }, '[pool-trial] leads')
    return res.status(500).json({ ok: false, error: { code: 'ERRO', message: 'Falha ao buscar leads.' } })
  }
})

router.post('/puxar', exigirTrial, async (req, res) => {
  const prospectId = req.body && req.body.prospect_id
  if (!prospectId) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'prospect_id ausente.' } })
  }
  try {
    // ponytail: TOCTOU brando no teto (checa, depois puxa). Trial de baixo risco — no pior caso
    // passa 1 além do teto numa corrida. Serializar por lock não vale a complexidade aqui.
    if (!podePuxar(await puxadasHoje(req.empresa.id))) {
      return res.status(429).json({
        ok: false,
        error: { code: 'TETO_DIARIO', message: `Limite de ${tetoDiario()} leads por dia no teste. Volte amanhã ou assine um plano.` },
      })
    }
    const r = await puxarDoPool({ empresaId: req.empresa.id, prospectId, usuarioId: req.usuario.id })
    if (r.resultado === 'nao_elegivel') {
      return res.status(409).json({ ok: false, error: { code: 'LEAD_INDISPONIVEL', message: 'Este lead não está mais disponível.' } })
    }
    return res.json({
      ok: true,
      data: { resultado: r.resultado, prospect_id: r.prospectId || null },
      meta: { restantes_hoje: restantesHoje(await puxadasHoje(req.empresa.id)) },
    })
  } catch (err) {
    logger.error({ err: err.message }, '[pool-trial] puxar')
    return res.status(500).json({ ok: false, error: { code: 'ERRO', message: 'Falha ao puxar o lead.' } })
  }
})

module.exports = router
