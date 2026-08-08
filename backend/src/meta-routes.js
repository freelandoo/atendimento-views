'use strict'

// Rotas do dashboard para resultados de anúncios da Meta (Click-to-WhatsApp).
// Read-only; protegidas pela mesma sessão admin do restante de /dashboard.

const { dashboardAutorizado } = require('./dashboardAuth')
const { pool } = require('./db')
const { logger } = require('./logger')
const { obterResultadosAnunciosMeta } = require('./services/meta-attribution')

// O dashboard legado (/dashboard/*) é single-tenant: a sessão dele não carrega
// empresa. Ele É o painel da PJ Codeworks — então o escopo é fixado explicitamente
// aqui. Antes, sem escopo nenhum, esta rota devolvia o resultado de anúncios de
// TODOS os tenants para qualquer admin legado.
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

function registerMetaRoutes(app) {
  // Resultados por anúncio (leads/qualificados/reuniões) para o painel de Métricas.
  app.get('/dashboard/meta/anuncios', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ ok: false, erro: 'Nao autorizado' })
    try {
      const anuncios = await obterResultadosAnunciosMeta(pool, { empresaId: PJ_EMPRESA_ID })
      res.json({ ok: true, anuncios })
    } catch (err) {
      logger.error('GET /dashboard/meta/anuncios:', err.message)
      res.status(500).json({ ok: false, erro: 'Falha ao carregar resultados de anuncios' })
    }
  })
}

module.exports = { registerMetaRoutes }
