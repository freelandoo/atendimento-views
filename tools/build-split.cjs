/**
 * Gera src/*.js + index.js a partir de index.monolith.js (criado na 1ª execução a partir do index atual).
 * node tools/build-split.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const monolithPath = path.join(ROOT, 'index.monolith.js')
const indexPath = path.join(ROOT, 'index.js')

if (!fs.existsSync(monolithPath)) {
  fs.copyFileSync(indexPath, monolithPath)
  console.log('Criado index.monolith.js (cópia do index antes do split).')
}

const lines = fs.readFileSync(monolithPath, 'utf8').split(/\r?\n/)

function slice(a, b) {
  return lines.slice(a - 1, b).join('\n')
}

function joinSlices(ranges) {
  return ranges.map(([a, b]) => slice(a, b)).join('\n\n')
}

// --- prompts.js ---
const promptsFile = `'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

${slice(106, 116)}

${slice(229, 334).replace(/path\.join\(__dirname, '/g, "path.join(ROOT, '")}

module.exports = {
  loadSystemPrompt,
  loadFollowupPrompt,
  loadFollowupTimingPrompt,
  loadLeadCoachPrompt,
  loadEmpresaKnowledge,
  loadCasesCatalog,
  urlAutorizadaConhecimento,
  filtrarLinksSugeridosParaEnvio,
  get SYSTEM_PROMPT_BASE() {
    return SYSTEM_PROMPT_BASE
  },
  get FOLLOWUP_PROMPT_BASE() {
    return FOLLOWUP_PROMPT_BASE
  },
  get FOLLOWUP_TIMING_PROMPT_BASE() {
    return FOLLOWUP_TIMING_PROMPT_BASE
  },
  get LEAD_COACH_PROMPT_BASE() {
    return LEAD_COACH_PROMPT_BASE
  },
  get EMPRESA_KNOWLEDGE_BASE() {
    return EMPRESA_KNOWLEDGE_BASE
  },
  get CASES_CATALOG() {
    return CASES_CATALOG
  },
}
`

const dbFile = `'use strict'
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const ROOT = path.join(__dirname, '..')

${slice(100, 103)}

${slice(1151, 1498).replace(/path\.join\(__dirname, 'sql'/g, "path.join(ROOT, 'sql'")}

module.exports = { pool, initDB }
`

const whatsappFile = `'use strict'
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

${slice(45, 47)}

const BOLHAS_ENVIO_DELAY_MS = 450

${slice(336, 338)}

${slice(3982, 3988)}

${slice(4000, 4013)}

${slice(3926, 3942)}

${slice(4236, 4337).replace(/require\('path'\)\.resolve\(__dirname,/g, "require('path').resolve(ROOT,")}

${slice(4399, 4426)}

${slice(1142, 1147)}

module.exports = {
  EVOLUTION_URL,
  EVOLUTION_KEY,
  INSTANCE_NAME,
  BOLHAS_ENVIO_DELAY_MS,
  sleep,
  extrairBase64DaRespostaEvolution,
  evolutionObterBase64Midia,
  enviarImagemBase64,
  evolutionDetalheNumeroInexistente,
  evolutionCorpoIndicaFalha,
  evolutionMensagemErroDoCorpo,
  assertEvolutionEnvioOk,
  enviarMensagem,
  enviarPrintLocal,
  enviarComBotoes,
  enviarSequenciaMensagens,
}
`

// Exclui enviarImagemBase64 + extrairBase64 + evolutionObter (em whatsapp.js)
const agentPreRoutes = joinSlices([
  [48, 99],
  [118, 227],
  [339, 1141],
  [1148, 1150],
  [1499, 3925],
  [3944, 3980],
  [3990, 3998],
  [4014, 4234],
])

// reprocessarAutorizado / webhookAutorizado ficam no módulo (tests + rotas precisam)
const authzBlock = slice(4428, 4439)

// JIDs + operador + helpers de dashboard (precisam estar no módulo para exports e para rotas)
const dashboardAndJidHelpers = joinSlices([
  [4589, 5843],
  [5956, 6197],
])

// Apenas registros Express (handlers usam funções do módulo acima)
const registerInner = joinSlices([
  [4442, 4588],
  [5845, 5952],
  [6198, 7054],
])

const notifyBlock = slice(4343, 4397)

const agentHeader = `'use strict'
const axios = require('axios')
const FormData = require('form-data')
const path = require('path')
const fs = require('fs')

const { pool, initDB } = require('./db')
const prompts = require('./prompts')
const whatsapp = require('./whatsapp')

const {
  sleep,
  enviarSequenciaMensagens,
  enviarImagemBase64,
  evolutionObterBase64Midia,
  evolutionDetalheNumeroInexistente,
  evolutionCorpoIndicaFalha,
  evolutionMensagemErroDoCorpo,
  assertEvolutionEnvioOk,
  enviarMensagem,
  enviarPrintLocal,
  enviarComBotoes,
} = whatsapp

const {
  loadSystemPrompt,
  loadFollowupPrompt,
  loadFollowupTimingPrompt,
  loadLeadCoachPrompt,
  loadEmpresaKnowledge,
  loadCasesCatalog,
  filtrarLinksSugeridosParaEnvio,
} = prompts

`

function patchPrompts(s) {
  return s
    .replace(/\bSYSTEM_PROMPT_BASE\b/g, 'prompts.SYSTEM_PROMPT_BASE')
    .replace(/\bFOLLOWUP_PROMPT_BASE\b/g, 'prompts.FOLLOWUP_PROMPT_BASE')
    .replace(/\bFOLLOWUP_TIMING_PROMPT_BASE\b/g, 'prompts.FOLLOWUP_TIMING_PROMPT_BASE')
    .replace(/\bLEAD_COACH_PROMPT_BASE\b/g, 'prompts.LEAD_COACH_PROMPT_BASE')
    .replace(/\bEMPRESA_KNOWLEDGE_BASE\b/g, 'prompts.EMPRESA_KNOWLEDGE_BASE')
    .replace(/\bCASES_CATALOG\b/g, 'prompts.CASES_CATALOG')
}

let agentPatched = patchPrompts(agentPreRoutes)

let authzPatched = patchPrompts(authzBlock)

let registerBody = patchPrompts(registerInner)

let dashboardHelpersPatched = patchPrompts(dashboardAndJidHelpers)

let notifyPatched = patchPrompts(notifyBlock)

const agentCore =
  agentPatched +
  '\n\n' +
  authzPatched +
  '\n\n' +
  dashboardHelpersPatched +
  '\n\n' +
  notifyPatched +
  '\n\nfunction registerHttpRoutes(app) {\n' +
  registerBody +
  '\n}\n'

const testExportsBlock = `
module.exports = {
  registerHttpRoutes,
  calcularPreco,
  diagnosticoCompletoParaPreco,
  contarPedidosPrecoDoLead,
  parsearRespostaJsonClaude,
  normalizarParsedRespostaVendas,
  resultadoParseadoParaObjeto,
  textoPedePreco,
  reprocessarAutorizado,
  webhookAutorizado,
  buildWhereConversasFiltros,
  montarBlocoContextoInterno,
  dadosPreviewSite,
  montarPromptWireframe,
  escolherEstiloWireframe,
  gerarWireframeComGPT,
  caseDeReferenciaPorNicho,
  montarPreviewSiteCaption,
  montarPreviewSiteHtml,
  montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup,
  iniciarJobWorker,
  iniciarSilenceWatcher,
  runSmokePrecificacao,
}
`

const agentFile = agentHeader + agentCore + testExportsBlock

const routesFile = `'use strict'

module.exports = function registerRoutes(app) {
  const { registerHttpRoutes } = require('./agent')
  registerHttpRoutes(app)
}
`

const indexBootstrap = `const express = require('express')
const path = require('path')
const fs = require('fs')

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/)
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

const app = express()
app.use(express.json({ limit: '20mb' }))

app.use(express.static(path.join(__dirname, 'public')))

const prompts = require('./src/prompts')
const { initDB } = require('./src/db')
const agent = require('./src/agent')
const dashboardAuth = require('./src/dashboardAuth')
dashboardAuth.registerDashboardAuthRoutes(app)
app.use('/dashboard', dashboardAuth.requireDashboardAuth)
app.use('/api/operador', dashboardAuth.requireDashboardAuth)
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
  if (!process.env.ANTHROPIC_KEY) {
    faltando.push('ANTHROPIC_KEY (obrigatória para o agente responder)')
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
    console.error('❌ Boot abortado: variáveis de ambiente obrigatórias ausentes:')
    for (const f of faltando) console.error(\`   - \${f}\`)
    console.error('Configure em .env ou docker-compose.yml e reinicie.')
    process.exit(1)
  }
}

function iniciarServidor() {
  validarSecretsBoot()

  prompts.loadSystemPrompt()
  prompts.loadFollowupPrompt()
  prompts.loadFollowupTimingPrompt()
  prompts.loadLeadCoachPrompt()
  prompts.loadEmpresaKnowledge()
  prompts.loadCasesCatalog()

  initDB()
    .then(async () => {
      await dashboardAuth.ensureDashboardAuthReady()
      agent.iniciarJobWorker()
      agent.iniciarSilenceWatcher()
      const PORT = process.env.PORT || 3000
      app.listen(PORT, '0.0.0.0', () => {
        console.log(\`🚀 PJ Codeworks Agent rodando na porta \${PORT}\`)
      })
    })
    .catch((err) => {
      console.error('❌ Falha ao iniciar banco:', err.message)
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
  textoPedePreco: agent.textoPedePreco,
  reprocessarAutorizado: agent.reprocessarAutorizado,
  webhookAutorizado: agent.webhookAutorizado,
  buildWhereConversasFiltros: agent.buildWhereConversasFiltros,
  montarBlocoContextoInterno: agent.montarBlocoContextoInterno,
  dadosPreviewSite: agent.dadosPreviewSite,
  montarPromptWireframe: agent.montarPromptWireframe,
  escolherEstiloWireframe: agent.escolherEstiloWireframe,
  gerarWireframeComGPT: agent.gerarWireframeComGPT,
  caseDeReferenciaPorNicho: agent.caseDeReferenciaPorNicho,
  montarPreviewSiteCaption: agent.montarPreviewSiteCaption,
  montarPreviewSiteHtml: agent.montarPreviewSiteHtml,
  montarPreviewSiteSvg: agent.montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio: agent.sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio: agent.maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup: agent.isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup: agent.ajustarParaJanelaComercialFollowup,
}
`

fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'src', 'prompts.js'), promptsFile)
fs.writeFileSync(path.join(ROOT, 'src', 'db.js'), dbFile)
fs.writeFileSync(path.join(ROOT, 'src', 'whatsapp.js'), whatsappFile)
fs.writeFileSync(path.join(ROOT, 'src', 'agent.js'), agentFile)
fs.writeFileSync(path.join(ROOT, 'src', 'routes.js'), routesFile)
fs.writeFileSync(indexPath, indexBootstrap)

console.log('OK: src/prompts.js, db.js, whatsapp.js, agent.js, routes.js; index.js bootstrap')
