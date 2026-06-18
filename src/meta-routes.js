'use strict'

// Rotas do dashboard para resultados de anúncios da Meta (Click-to-WhatsApp).
// Read-only; protegidas pela mesma sessão admin do restante de /dashboard.

const { dashboardAutorizado } = require('./dashboardAuth')
const { pool } = require('./db')
const { logger } = require('./logger')
const { obterResultadosAnunciosMeta } = require('./services/meta-attribution')

function registerMetaRoutes(app) {
  // Resultados por anúncio (leads/qualificados/reuniões) para o painel de Métricas.
  app.get('/dashboard/meta/anuncios', async (req, res) => {
    if (!dashboardAutorizado(req)) return res.status(401).json({ ok: false, erro: 'Nao autorizado' })
    try {
      const anuncios = await obterResultadosAnunciosMeta(pool)
      res.json({ ok: true, anuncios })
    } catch (err) {
      logger.error('GET /dashboard/meta/anuncios:', err.message)
      res.status(500).json({ ok: false, erro: 'Falha ao carregar resultados de anuncios' })
    }
  })
}

module.exports = { registerMetaRoutes }
