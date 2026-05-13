'use strict'

module.exports = function registerRoutes(app) {
  const { registerHttpRoutes } = require('./agent')
  const { registerProspectingRoutes } = require('./prospecting')
  const { registerAgendaRoutes } = require('./agenda')
  const { registerAIRoutes } = require('./ai-routes')
  registerHttpRoutes(app)
  registerProspectingRoutes(app)
  registerAgendaRoutes(app)
  registerAIRoutes(app)
}
