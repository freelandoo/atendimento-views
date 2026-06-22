const express = require('express')
const path = require('path')
const fs = require('fs')

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const linha of linhas) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}

carregarEnvLocal()

process.env.TZ = process.env.TZ || 'America/Sao_Paulo'
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo'

const { logger } = require('./src/logger')
const dashboardAuth = require('./src/dashboardAuth')
const cors = require('cors')

const app = express()

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:3001']
  : true
app.use(cors({ origin: allowedOrigins, credentials: true }))

app.use(express.json({ limit: '20mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use(express.static(path.join(__dirname, 'public')))

const prompts = require('./src/prompts')
const { pool, initDB } = require('./src/db')
const agent = require('./src/agent')
const { seedAdminUser } = require('./src/auth')
const { resolveEmpresaFromWebhook, requireAuth, requireRole } = require('./src/middleware/tenant')
const apiAuthRouter = require('./src/routes/api-auth')

dashboardAuth.registerDashboardAuthRoutes(app)
app.use('/dashboard', dashboardAuth.requireDashboardAuth)
app.use('/api/operador', dashboardAuth.requireDashboardAuth)

// Rotas JWT SaaS multiempresa (Bearer token — consumidas pelo frontend Next.js)
app.use('/api/auth', apiAuthRouter)
app.use('/api/admin', require('./src/routes/api-admin-usuarios').router)
app.use('/api/empresas', require('./src/routes/api-empresas'))
app.use('/api/empresas/:empresaId/contextos', require('./src/routes/api-contextos'))
app.use('/api/empresas/:empresaId/contextos/:contextoId', require('./src/routes/api-contexto-estagios'))
const fontesRouter = require('./src/routes/api-contextos-fontes')
app.use('/api/empresas/:empresaId/contextos/:contextoId/fontes', fontesRouter)
app.use('/api/empresas/:empresaId/contextos/:contextoId/sugerir-contexto1', fontesRouter.sugerirRouter)
app.use('/api/empresas/:empresaId/whatsapp', require('./src/routes/api-whatsapp'))
app.use('/api/empresas/:empresaId/conversas', require('./src/routes/api-conversas'))
app.use('/api/empresas/:empresaId/leads-quentes', require('./src/routes/api-leads-quentes'))
// Aquisição / banco de leads / relatórios / LLM são admin-only (gating de backend SaaS)
app.use('/api/empresas/:empresaId/prospeccao', requireAuth, requireRole('admin'), require('./src/routes/api-prospeccao'))
app.use('/api/empresas/:empresaId/captacao', requireAuth, requireRole('admin'), require('./src/routes/api-captacao'))
app.use('/api/empresas/:empresaId/banco-leads', requireAuth, requireRole('admin'), require('./src/routes/api-banco-leads'))
app.use('/api/empresas/:empresaId/agenda', require('./src/routes/api-agenda'))
app.use('/api/empresas/:empresaId/relatorios', requireAuth, requireRole('admin'), require('./src/routes/api-relatorios'))
app.use('/api/empresas/:empresaId/agente-pj', require('./src/routes/api-agente-pj'))
app.use('/api/llm', requireAuth, requireRole('admin'), require('./src/routes/api-llm'))
app.use('/api/prompts-catalogo', require('./src/routes/api-prompts-catalogo'))
app.use('/api/empresas/:empresaId/llm/uso', requireAuth, requireRole('admin'), require('./src/routes/api-llm-uso'))

// Resolve empresa a partir da evolution_instance em todos os webhooks (fallback PJ).
app.use('/webhook', resolveEmpresaFromWebhook)

require('./src/routes')(app)

if (process.argv.includes('--smoke-precificacao')) {
  agent.runSmokePrecificacao()
  process.exit(0)
}

function validarSecretsBoot() {
  const faltando = []
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME_IN_PRODUCTION')) {
    faltando.push('JWT_SECRET (obrigatório em produção — assina os tokens de login do SaaS)')
  }
  if (!process.env.REPROCESS_SECRET || String(process.env.REPROCESS_SECRET).trim().length < 8) {
    faltando.push('REPROCESS_SECRET (mínimo 8 caracteres — protege /dashboard/*)')
  }
  if (!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY)) {
    faltando.push('OPENAI_API_KEY/OPENAI_KEY ou ANTHROPIC_API_KEY/ANTHROPIC_KEY (ao menos um provider de IA)')
  }
  if (!process.env.EVOLUTION_API_KEY) {
    faltando.push('EVOLUTION_API_KEY (obrigatoria para integrar com Evolution API)')
  }
  if (!process.env.DASHBOARD_ADMIN_EMAIL) {
    faltando.push('DASHBOARD_ADMIN_EMAIL (obrigatoria para o primeiro admin do dashboard)')
  }
  if (!process.env.DASHBOARD_ADMIN_PASSWORD || String(process.env.DASHBOARD_ADMIN_PASSWORD).length < 12) {
    faltando.push('DASHBOARD_ADMIN_PASSWORD (minimo 12 caracteres para o primeiro admin)')
  }
  if (faltando.length > 0) {
    logger.error('Boot abortado: variáveis de ambiente obrigatórias ausentes:')
    for (const f of faltando) logger.error(`   - ${f}`)
    logger.error('Configure em .env ou docker-compose.yml e reinicie.')
    process.exit(1)
  }
}

function iniciarServidor() {
  validarSecretsBoot()

  prompts.loadSystemPrompt()
  prompts.loadSystemCorePrompt()
  prompts.loadSystemPrimeiroContatoPrompt()
  prompts.loadSystemDiagnosticoPrompt()
  prompts.loadSystemPropostaPrompt()
  prompts.loadSystemObjecaoPrompt()
  prompts.loadSystemFechamentoPrompt()
  prompts.loadFollowupPrompt()
  prompts.loadFollowupTimingPrompt()
  prompts.loadLeadCoachPrompt()
  prompts.loadEmpresaKnowledge()
  prompts.loadCasesCatalog()
  prompts.loadClassificadorIntencao()
  prompts.loadTomReferenciaPrompt()

  async function initDBWithRetry() {
    const maxRetries = 5
    const baseDelayMs = 1000
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await initDB()
        return
      } catch (err) {
        if (attempt === maxRetries) throw err
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1)
        logger.warn(`initDB attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${delayMs}ms...`)
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
  }

  initDBWithRetry()
    .then(async () => {
      await dashboardAuth.ensureDashboardAuthReady()
      await seedAdminUser()
      try {
        await prompts.loadOverlaysFromDb(pool)
      } catch (e) {
        logger.warn('loadOverlaysFromDb:', e.message)
      }
      agent.iniciarJobWorker()
      agent.iniciarSilenceWatcher()
      try {
        require('./src/services/social-capture').iniciarCaptureWorker()
      } catch (e) {
        logger.warn('iniciarCaptureWorker:', e.message)
      }
      try {
        require('./src/services/lead-lock').iniciarLeadLockWorker(pool)
      } catch (e) {
        logger.warn('iniciarLeadLockWorker:', e.message)
      }
      const PORT = process.env.PORT || 3000
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`PJ Codeworks Agent rodando na porta ${PORT}`)
      })
    })
    .catch((err) => {
      logger.error('Falha ao iniciar banco:', err.message)
      process.exit(1)
    })
}

if (require.main === module) {
  iniciarServidor()
}

module.exports = {
  app,
  calcularPreco: agent.calcularPreco,
  diagnosticoCompletoParaPreco: agent.diagnosticoCompletoParaPreco,
  contarPedidosPrecoDoLead: agent.contarPedidosPrecoDoLead,
  parsearRespostaJsonClaude: agent.parsearRespostaJsonClaude,
  normalizarParsedRespostaVendas: agent.normalizarParsedRespostaVendas,
  resultadoParseadoParaObjeto: agent.resultadoParseadoParaObjeto,
  aplicarGuardrailReuniaoProposta: agent.aplicarGuardrailReuniaoProposta,
  sugestaoReuniaoProposta: agent.sugestaoReuniaoProposta,
  parsearHorarioReuniao: agent.parsearHorarioReuniao,
  calcularFimReuniao: agent.calcularFimReuniao,
  dataInicioReuniao: agent.dataInicioReuniao,
  normalizarAgendarFollowupAuto: agent.normalizarAgendarFollowupAuto,
  textoPedePreco: agent.textoPedePreco,
  interpretarIntencaoMensagem: agent.interpretarIntencaoMensagem,
  montarEstadoComercialLead: agent.montarEstadoComercialLead,
  decidirProximaAcao: agent.decidirProximaAcao,
  decidirProximaResposta: agent.decidirProximaResposta,
  aplicarAntiLoopResposta: agent.aplicarAntiLoopResposta,
  podeGerarRespostaAutomatica: agent.podeGerarRespostaAutomatica,
  ehProjetoSobMedida: agent.ehProjetoSobMedida,
  textoEhAutoReplyWhatsApp: agent.textoEhAutoReplyWhatsApp,
  detectarAutoReplyEmContextoProspeccao: agent.detectarAutoReplyEmContextoProspeccao,
  reprocessarAutorizado: agent.reprocessarAutorizado,
  webhookAutorizado: agent.webhookAutorizado,
  isConversaLeadUmAUm: agent.isConversaLeadUmAUm,
  buildWhereConversasFiltros: agent.buildWhereConversasFiltros,
  buildDiarioQuery: agent.buildDiarioQuery,
  normalizarEtapaFunilDiagnostico: agent.normalizarEtapaFunilDiagnostico,
  labelEtapaFunilDiagnostico: agent.labelEtapaFunilDiagnostico,
  variantesEtapaFunilDiagnostico: agent.variantesEtapaFunilDiagnostico,
  promptSeedFunilDiagnostico: agent.promptSeedFunilDiagnostico,
  normalizarResultadoFunilDiagnostico: agent.normalizarResultadoFunilDiagnostico,
  normalizarAvaliacaoPromptFunil: agent.normalizarAvaliacaoPromptFunil,
  pontuarConversaFunilDiagnostico: agent.pontuarConversaFunilDiagnostico,
  selecionarConversasFunilDiagnostico: agent.selecionarConversasFunilDiagnostico,
  montarContextoFunilDiagnostico: agent.montarContextoFunilDiagnostico,
  garantirPromptAtivoFunil: agent.garantirPromptAtivoFunil,
  criarNovaVersaoPromptFunil: agent.criarNovaVersaoPromptFunil,
  montarBlocoContextoInterno: agent.montarBlocoContextoInterno,
  montarBlocoContinuidadeTurno: agent.montarBlocoContinuidadeTurno,
  montarBlocoCorrecoesAprendizados: agent.montarBlocoCorrecoesAprendizados,
  inferirPromptAlvoDeTextoRegras: agent.inferirPromptAlvoDeTextoRegras,
  normalizarPromptAlvo: agent.normalizarPromptAlvo,
  montarSystemPromptDinamico: agent.montarSystemPromptDinamico,
  dadosPreviewSite: agent.dadosPreviewSite,
  montarPromptWireframe: agent.montarPromptWireframe,
  escolherEstiloWireframe: agent.escolherEstiloWireframe,
  gerarWireframeComGPT: agent.gerarWireframeComGPT,
  caseDeReferenciaPorNicho: agent.caseDeReferenciaPorNicho,
  gerarApresentacaoOperador: agent.gerarApresentacaoOperador,
  gerarApresentacaoOperadorFallback: agent.gerarApresentacaoOperadorFallback,
  gerarCaptionPreview: agent.gerarCaptionPreview,
  gerarMensagemPosPreview: agent.gerarMensagemPosPreview,
  gerarMensagemPosPreviewFallback: agent.gerarMensagemPosPreviewFallback,
  montarPreviewSiteCaption: agent.montarPreviewSiteCaption,
  montarPreviewSiteHtml: agent.montarPreviewSiteHtml,
  montarPreviewSiteSvg: agent.montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio: agent.sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio: agent.maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup: agent.isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup: agent.ajustarParaJanelaComercialFollowup,
  registrarChamadaAnthropic: agent.registrarChamadaAnthropic,
  normalizarEntradaOperador: agent.normalizarEntradaOperador,
  operadoresDoEnv: agent.operadoresDoEnv,
  dedupeOperadores: agent.dedupeOperadores,
  listarOperadoresAtivos: agent.listarOperadoresAtivos,
  textoAjudaOperadorProgramada: agent.textoAjudaOperadorProgramada,
  formatarMensagemParaContexto: agent.formatarMensagemParaContexto,
  gerarTextoConversaCompleta: agent.gerarTextoConversaCompleta,
}
