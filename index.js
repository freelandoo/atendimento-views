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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use(express.static(path.join(__dirname, 'public')))

const prompts = require('./src/prompts')
const { pool, initDB } = require('./src/db')
const agent = require('./src/agent')
const { seedAdminUser } = require('./src/auth')
const { resolveEmpresaFromWebhook } = require('./src/middleware/tenant')
const apiAuthRouter = require('./src/routes/api-auth')

dashboardAuth.registerDashboardAuthRoutes(app)
app.use('/dashboard', dashboardAuth.requireDashboardAuth)
app.use('/api/operador', dashboardAuth.requireDashboardAuth)

// Rotas JWT SaaS (sem autenticação de sessão — usam Bearer token)
app.use('/api/auth', apiAuthRouter)
app.use('/api/empresas', require('./src/routes/api-empresas'))
app.use('/api/empresas/:empresaId/contextos', require('./src/routes/api-contextos'))
app.use('/api/empresas/:empresaId/whatsapp', require('./src/routes/api-whatsapp'))
app.use('/api/empresas/:empresaId/conversas', require('./src/routes/api-conversas'))
app.use('/api/empresas/:empresaId/relatorios', require('./src/routes/api-relatorios'))
app.use('/api/llm', require('./src/routes/api-llm'))
app.use('/api/empresas/:empresaId/llm/uso', require('./src/routes/api-llm-uso'))

// Resolve empresa a partir da evolution_instance em todos os webhooks
app.use('/webhook', resolveEmpresaFromWebhook)

require('./src/routes')(app)

if (process.argv.includes('--smoke-precificacao')) {
  agent.runSmokePrecificacao()
  process.exit(0)
}

function validarSecretsBoot() {
  const faltando = []
  if (!process.env.REPROCESS_SECRET || String(process.env.REPROCESS_SECRET).trim().length < 8) {
    faltando.push('REPROCESS_SECRET (mínimo 8 caracteres — protege /dashboard/*)')
  }
  const temAnthropicKey = !!process.env.ANTHROPIC_KEY
  const temOpenaiKey = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY)
  if (!temAnthropicKey && !temOpenaiKey) {
    faltando.push('ANTHROPIC_KEY ou OPENAI_API_KEY (pelo menos uma chave de IA é obrigatória)')
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

  initDB()
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
