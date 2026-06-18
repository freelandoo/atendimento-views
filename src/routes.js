'use strict'

module.exports = function registerRoutes(app) {
  const { registerHttpRoutes } = require('./agent')
  const { registerProspectingRoutes } = require('./prospecting')
  const { registerAgendaRoutes } = require('./agenda')
  const { registerAIRoutes } = require('./ai-routes')
  const { registerWhatsappRoutes } = require('./whatsapp-routes')
  const { registerMetaRoutes } = require('./meta-routes')
  const { registerLeadsQuentesRoutes } = require('./leads-quentes')
  const registerAITestRoutes = require('./ai-test-routes')

  registerHttpRoutes(app)
  registerProspectingRoutes(app)
  registerAgendaRoutes(app)
  registerAIRoutes(app)
  registerWhatsappRoutes(app)
  registerMetaRoutes(app)
  registerLeadsQuentesRoutes(app)

  // AI Test Routes (teste de IA sem efeitos colaterais)
  const deps = {
    pool: require('./db').pool,
    logger: require('./logger').logger,
    aiProvider: require('./ai-provider'),
    prompts: require('./prompts'),
    montarSystemPromptDinamico: require('./agent').montarSystemPromptDinamico,
  }
  registerAITestRoutes(app, deps)
}
