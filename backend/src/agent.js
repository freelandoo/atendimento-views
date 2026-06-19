'use strict'
const axios = require('axios')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const { pool, initDB } = require('./db')
const {
  ANTHROPIC_KEY,
  OPENAI_KEY,
  ANTHROPIC_MESSAGES_URL,
  WEBHOOK_REPLY_DEBOUNCE_MS,
  sanitizarCpfRespostaHabilitado,
  CLAUDE_TIMEOUT_CAP_MS,
  CLAUDE_AUXILIAR_TIMEOUT_CAP_MS,
  CLAUDE_TIMEOUT_MS,
  claudeWebSearchHabilitado,
  CLAUDE_WEB_SEARCH_MAX_USES,
  CLAUDE_WEB_SEARCH_PAUSE_MAX,
  CLAUDE_TIMEOUT_COM_BUSCA_MS,
  FOLLOWUP_INSTRUCAO_MAX_CHARS,
  FOLLOWUP_EXPLICITO_MIN_MINUTOS,
  FOLLOWUP_EXPLICITO_MAX_DIAS,
  FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO,
  FOLLOWUP_LOTE_MAX_ITENS,
  FOLLOWUP_SNIPPET_MAX_CHARS,
  FOLLOWUP_ERRO_LOG_MAX_CHARS,
  LEAD_CONTEXTO_MAX_CHARS,
  LEAD_CONTEXTO_PROMPT_LIMIT,
  HISTORICO_CLAUDE_MAX_MSGS,
  AUDIO_UPLOAD_MAX_BYTES,
  FOLLOWUP_ATRIBUICAO_RESPOSTA_DIAS,
  JOB_WORKER_POLL_MS,
  JOB_WORKER_LOCK_MS,
  JOB_MAX_ATTEMPTS,
  SILENCE_WATCHER_INTERVAL_MS,
  SILENCE_TRIGGER_MINUTES,
  FOLLOWUP_AUTO_SEQUENCIAS_COMERCIAIS_PADRAO,
  FOLLOWUP_AUTO_SEQUENCIAS_POR_ESTAGIO,
  FOLLOWUP_AUTO_ENCERRAMENTO_EXTRA,
  FOLLOWUP_AUTO_BUSINESS_TZ,
  FOLLOWUP_AUTO_BUSINESS_START_HOUR,
  FOLLOWUP_AUTO_BUSINESS_END_HOUR,
  FOLLOWUP_AUTO_DELAY_HORAS,
} = require('./config')
const prompts = require('./prompts')
const whatsapp = require('./whatsapp')
const { logger, loggerForWebhook, loggerForJob, redactPhone, serializeError } = require('./logger')
const { dashboardAutorizado } = require('./dashboardAuth')
const { createDbCrud } = require('./db-crud')
const { limitarBolhasPorEtapa } = require('./message-limits')
const { createMediaProcessing } = require('./media-processing')
const { createPreviewSite } = require('./preview-site')
const { createHandoffAlerts } = require('./handoff-alerts')
const { createFollowupExecution } = require('./followup-execution')
const { createLearning } = require('./learning')
const { createFollowupAuto } = require('./followup-auto')
const { createOperatorCommands } = require('./operator-commands')
const { registerWebhookRoute } = require('./webhook-handler')
const aiProvider = require('./ai-provider')
const { parseAiResponse } = require('./ai-response')
const {
  criarEventoAgenda,
  buscarSlotsDisponiveis,
  buscarDisponibilidadeSemana,
  validarSlotReuniao,
  slotEstaOcupado,
  processarLembreteReuniaoJob,
  registrarRespostaLembreteReuniao,
  verificarResumoDiarioAgenda,
  montarTextoResumoDiarioAgenda,
  verificarReunioesAtrasadas,
  verificarReunioesNaoConfirmadas,
  verificarLembretesManhaReuniao,
} = require('./agenda')
const { sincronizarAtribuicaoMetaAds } = require('./services/meta-attribution')
const { processarMensagemComPlaybook, gerarFollowupComPlaybook } = require('./services/contexto2-runtime')
const { getContextoAtivoEmpresa } = require('./services/contexto-empresa')
const { getContextoAtivoComEstagios } = require('./services/contexto-estagios')
const { empresaAgentePausada } = require('./db/empresas')
const { createCoreFunnel } = require('./core-funnel')
const {
  calcularPreco,
  diagnosticoCompletoParaPreco,
} = require('./pricing')
const {
  partesDataEmTimezone,
  utcParaDataLocalEmTimezone,
  adicionarDiasLocalEmTimezone,
  partesDataBrasil,
  isoDateBrasil,
  proximoDiaUtilReuniao,
  sugestaoReuniaoProposta,
  parsearHorarioReuniao,
  calcularFimReuniao,
  dataInicioReuniao,
} = require('./date-utils')
const {
  limparSaidaTextoClaude,
  extrairPrimeiroObjetoJsonBalanceado,
  parsearRespostaJsonClaude,
  stripCitacaoWhatsappTexto,
  stripCitacaoEmContentMensagem,
  sanitizarCpfNaSaidaTexto: sanitizarCpfNaSaidaTextoBase,
  sanitizarPlaceholderEmpresaNaSaidaTexto,
  textoDeContent,
  stripEcoAssistenteNoHistorico,
  normalizarHistoricoMensagens,
} = require('./string-utils')
const {
  normalizarEstagio,
  validarRespostaVendasIA,
} = require('./domainSchemas')
const {
  marcarProspectComoRespondeuPorNumero,
  buscarContextoProspeccao,
  executarJobProspeccao,
  verificarAgendaDiariaProspeccao,
} = require('./prospecting')

const {
  sleep,
  enviarSequenciaMensagens,
  enviarImagemBase64,
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

const dbCrud = createDbCrud({ pool, logger, serializeError })
const {
  buscarConversa,
  salvarConversa,
  registrarFalhaResposta,
  registrarChamadaAnthropic,
  limparFalhaResposta,
  marcarFechada,
  buscarPerfil,
  normalizarTipoLeadContexto,
  limparConteudoLeadContexto,
  salvarLeadContexto,
  buscarLeadContextos,
  montarBlocoContextoInterno,
  atualizarPerfil,
  registrarFollowupEnvio,
  registrarEventoComercial,
  marcarRespostaFollowupSeAplicavel,
  buscarUltimoAprendizado,
  contarVendasFechadas,
  buscarVendasFechadas,
  registrarLacunaConhecimento,
  registrarAudioProcessamento,
  webhookMensagemDeveSerProcessada,
} = dbCrud

function sanitizarCpfNaSaidaTexto(texto) {
  return sanitizarCpfNaSaidaTextoBase(texto, sanitizarCpfRespostaHabilitado())
}

const LEAD_CAMPOS_DIAGNOSTICO = new Set([
  'negocio',
  'cidade',
  'ticket_cliente_final',
  'ja_aparece_google',
  'concorrentes',
  'termometro_dor',
  'complexidade',
  'score_dor',
  'temperatura_lead',
  'precisa_sistema',
  'maturidade_digital',
  'origem_anuncio',
  'intencao_principal',
  'produto_sugerido',
  'dor_principal',
])

/** Envio em várias bolhas (mensagens_bolhas ou heurística \n\n). */
const BOLHAS_ENVIO_DELAY_MS = 450
const MAX_MENSAGENS_BOLHAS = 4
const MAX_CARACTERES_POR_BOLHA = 500

/** Campos opcionais JSON: lacunas de conhecimento (servidor também trunca). */
const MAX_TEMA_LACUNA_CHARS = 120
const MAX_DETALHE_LACUNA_CHARS = 500

/** Estado por JID: debounce de resposta ao webhook (não compartilhado entre réplicas). */
const debounceRespostaPorJid = new Map()

/**
 * Dedupe de conteúdo por número + texto normalizado + janela de 5 min.
 * Protege contra loops de auto-reply (mensagens idênticas com IDs distintos)
 * e contra mensagens repetidas em sequência rápida.
 * Não é compartilhado entre réplicas; adequado para instância única.
 */
const dedupeConteudoPorNumero = new Map()
const DEDUPE_CONTEUDO_JANELA_MS = 5 * 60 * 1000

function normalizarTextoParaDedupe(texto) {
  return String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

function textoJaProcessadoRecentemente(numero, texto) {
  const chave = `${numero}|${normalizarTextoParaDedupe(texto)}`
  const agora = Date.now()
  const ultimo = dedupeConteudoPorNumero.get(chave) || 0
  if (agora - ultimo < DEDUPE_CONTEUDO_JANELA_MS) return true
  dedupeConteudoPorNumero.set(chave, agora)
  // Limpeza lazy: evita crescimento ilimitado em sessões longas
  if (dedupeConteudoPorNumero.size > 2000) {
    for (const [k, t] of dedupeConteudoPorNumero) {
      if (agora - t > DEDUPE_CONTEUDO_JANELA_MS) dedupeConteudoPorNumero.delete(k)
    }
  }
  return false
}

let gerarEEnviarRespostaWhatsapp

function obterEstadoDebounceResposta(numero) {
  if (!debounceRespostaPorJid.has(numero)) {
    debounceRespostaPorJid.set(numero, {
      timer: null,
      visaoLote: null,
      geracaoEmAndamento: false,
      pendenteAposGeracao: false,
    })
  }
  return debounceRespostaPorJid.get(numero)
}

/** Novas mensagens só de usuário foram anexadas ao histórico após o snapshot usado no Claude. */
function historicoCresceuSoComUsers(lenAntes, hDepois) {
  if (!hDepois || hDepois.length <= lenAntes) return false
  for (let i = lenAntes; i < hDepois.length; i++) {
    if (hDepois[i].role !== 'user') return false
  }
  return true
}

function mensagemEhLeadReal(msg) {
  if (!msg || typeof msg !== 'object') return false
  if (msg.role !== 'user') return false
  if (msg.fromMe === true) return false
  if (msg.direction && !/^(incoming|inbound|received)$/i.test(String(msg.direction))) return false
  if (msg.internal_trigger === true || msg.interno === true || msg.system === true) return false
  if (/^(sistema_|lembrete_|handoff|agenda_|operator|operador)/i.test(String(msg.tipo || ''))) return false
  return Boolean(textoDeContent(msg.content).trim())
}

function podeGerarRespostaAutomatica(conversa) {
  const historico = Array.isArray(conversa)
    ? normalizarHistoricoMensagens(conversa)
    : normalizarHistoricoMensagens(conversa?.historico)
  if (!historico.length) return false
  return mensagemEhLeadReal(historico[historico.length - 1])
}

function agendarRespostaWebhookDebounced(numero) {
  const st = obterEstadoDebounceResposta(numero)
  if (st.timer) clearTimeout(st.timer)
  st.timer = setTimeout(() => {
    st.timer = null
    enfileirarJobRespostaWebhook(numero).catch((e) =>
      logger.error('Erro ao enfileirar resposta webhook:', e.response?.data || e.message)
    )
  }, WEBHOOK_REPLY_DEBOUNCE_MS)
}

/** Cancela timer pendente e snapshot de mídia do debounce para este JID (ex.: intervenção humana). */
function limparDebounceResposta(numero) {
  const st = obterEstadoDebounceResposta(numero)
  if (st.timer) clearTimeout(st.timer)
  st.timer = null
  st.visaoLote = null
  st.pendenteAposGeracao = false
}

async function processarRespostaWebhookDebounced(numero) {
  const st = obterEstadoDebounceResposta(numero)
  const conversa = await buscarConversa(numero)
  if (!conversa || conversa.agente_pausado) {
    st.visaoLote = null
    return
  }

  st.geracaoEmAndamento = true
  try {
    const historico = normalizarHistoricoMensagens(conversa.historico)
    const estagio = conversa.estagio || 'primeiro_contato'
    const visao = st.visaoLote
    st.visaoLote = null

    const ret = await gerarEEnviarRespostaWhatsapp(numero, historico, estagio, conversa, visao)
    if (ret && ret.stale) {
      st.pendenteAposGeracao = false
      agendarRespostaWebhookDebounced(numero)
      return
    }
  } catch (err) {
    if (err && err.leadMessageSent) {
      logger.error('❌ Pós-envio webhook:', err.message)
      return
    }
    const falha = classificarErroRespostaWebhook(err)
    logger.error(`❌ Debounce webhook [${falha.codigo}]:`, falha.detalhe || falha.resumo)
    try {
      await registrarFalhaResposta(numero, falha)
    } catch (dbErr) {
      logger.error('❌ Registrar falha de resposta:', dbErr.message)
    }
    try {
      await alertarFalhaResposta(numero, falha)
    } catch (alertErr) {
      logger.error('❌ Alerta de falha de resposta:', alertErr.message)
    }
  } finally {
    st.geracaoEmAndamento = false
    if (st.pendenteAposGeracao) {
      st.pendenteAposGeracao = false
      agendarRespostaWebhookDebounced(numero)
    }
  }
}

async function enfileirarJobRespostaWebhook(numero, requestId = null) {
  const jid = typeof numero === 'string' ? numero.trim() : ''
  if (!jid) return null
  const dedupe = `webhook_resposta:${jid}`
  const payload = JSON.stringify({ numero: jid, request_id: requestId || null })
  const delayMs = Math.max(WEBHOOK_REPLY_DEBOUNCE_MS, 0)
  const { rows } = await pool.query(
    `
    INSERT INTO vendas.job_queue (tipo, dedupe_key, payload, status, attempts, max_attempts, available_at)
    VALUES ('webhook_resposta', $1, $2::jsonb, 'pending', 0, $3, NOW() + ($4::int * INTERVAL '1 millisecond'))
    ON CONFLICT (dedupe_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      status = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.status ELSE 'pending' END,
      attempts = CASE WHEN vendas.job_queue.status = 'processing' THEN vendas.job_queue.attempts ELSE 0 END,
      available_at = GREATEST(vendas.job_queue.available_at, EXCLUDED.available_at),
      atualizado_em = NOW()
    RETURNING id
    `,
    [dedupe, payload, JOB_MAX_ATTEMPTS, delayMs]
  )
  return rows[0]?.id || null
}

async function reivindicarProximoJob() {
  const { rows } = await pool.query(
    `
    WITH next_job AS (
      SELECT id
      FROM vendas.job_queue
      WHERE (status = 'pending' AND available_at <= NOW())
         OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until < NOW())
      ORDER BY
        CASE
          WHEN tipo = 'webhook_resposta' THEN 0
          WHEN tipo = 'agenda_lembrete_reuniao' THEN 1
          WHEN tipo = 'followup_auto' THEN 2
          WHEN tipo LIKE 'prospeccao_%' THEN 3
          ELSE 3
        END ASC,
        available_at ASC,
        id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vendas.job_queue q
    SET status = 'processing',
        locked_at = NOW(),
        locked_until = NOW() + ($1::int * INTERVAL '1 millisecond'),
        atualizado_em = NOW()
    FROM next_job
    WHERE q.id = next_job.id
    RETURNING q.*
    `,
    [JOB_WORKER_LOCK_MS]
  )
  return rows[0] || null
}

async function concluirJob(id) {
  await pool.query(
    `UPDATE vendas.job_queue SET status = 'completed', locked_at = NULL, locked_until = NULL, atualizado_em = NOW() WHERE id = $1`,
    [id]
  )
}

async function falharOuReagendarJob(job, err) {
  const attempts = (parseInt(job.attempts, 10) || 0) + 1
  const maxAttempts = parseInt(job.max_attempts, 10) || JOB_MAX_ATTEMPTS
  const msg = String(err?.message || err || 'erro desconhecido').slice(0, 1000)
  const final = attempts >= maxAttempts
  const delaySec = Math.min(300, Math.max(5, attempts * attempts * 5))
  await pool.query(
    `
    UPDATE vendas.job_queue
    SET status = $2,
        attempts = $3,
        last_error = $4,
        locked_at = NULL,
        locked_until = NULL,
        available_at = CASE WHEN $2 = 'pending' THEN NOW() + ($5::int * INTERVAL '1 second') ELSE available_at END,
        atualizado_em = NOW()
    WHERE id = $1
    `,
    [job.id, final ? 'failed' : 'pending', attempts, msg, delaySec]
  )
}

async function processarJob(job) {
  if (!job) return
  if (typeof job.tipo === 'string' && job.tipo.startsWith('prospeccao_')) {
    await executarJobProspeccao(job)
    return
  }
  if (job.tipo === 'followup_auto') {
    await processarFollowupAutoJob(job)
    return
  }
  if (job.tipo === 'agenda_lembrete_reuniao') {
    await processarLembreteReuniaoJob(job)
    return
  }
  if (job.tipo === 'resumo_agenda_operador') {
    const dataIso = (job.payload && job.payload.data) || isoDateBrasil(new Date())
    const txt = await montarTextoResumoDiarioAgenda(dataIso)
    if (txt) await notificarVictorWhatsapp(txt)
    return
  }
  if (job.tipo !== 'webhook_resposta') return
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {}
  const numero = payload.numero
  if (!numero) throw new Error('Job webhook_resposta sem numero')
  await processarRespostaWebhookDebounced(numero)
}

let jobWorkerRodando = false
let jobWorkerTimer = null

let _ultimaAtribuicaoMetaMs = 0
const ATRIBUICAO_META_INTERVALO_MS = 10 * 60 * 1000

async function jobWorkerTick() {
  if (jobWorkerRodando) return
  jobWorkerRodando = true
  try {
    await verificarAgendaDiariaProspeccao().catch((e) =>
      logger.warn({ operation: 'prospeccao_diaria', etapa: 'tick_erro', erro: e.message })
    )
    // Atribuição Meta (CTWA) + score determinístico — a cada ~10 min (não a cada poll).
    if (Date.now() - _ultimaAtribuicaoMetaMs > ATRIBUICAO_META_INTERVALO_MS) {
      _ultimaAtribuicaoMetaMs = Date.now()
      await sincronizarAtribuicaoMetaAds(pool, { logger }).catch((e) =>
        logger.warn({ operation: 'meta_attribution', etapa: 'tick_erro', erro: e.message })
      )
    }
    await verificarResumoDiarioAgenda().catch((e) =>
      logger.warn('resumo_agenda_diaria tick:', e.message)
    )
    await verificarLembretesManhaReuniao().catch((e) =>
      logger.warn('lembrete_manha tick:', e.message)
    )
    await verificarReunioesAtrasadas().catch((e) =>
      logger.warn('reunioes_atrasadas tick:', e.message)
    )
    await verificarReunioesNaoConfirmadas(new Date(), { notificarOperador: notificarVictorWhatsapp }).catch((e) =>
      logger.warn('reunioes_nao_confirmadas tick:', e.message)
    )
    const job = await reivindicarProximoJob()
    if (!job) return
    const jobLog = loggerForJob(job, { request_id: job.payload?.request_id || null })
    try {
      jobLog.info('Job iniciado')
      await processarJob(job)
      await concluirJob(job.id)
      jobLog.info('Job concluido')
    } catch (err) {
      jobLog.error({ err: serializeError(err) }, 'Erro no job worker')
      await falharOuReagendarJob(job, err)
    }
  } catch (err) {
    logger.error({ err: serializeError(err), flow: 'job' }, 'Erro ao buscar job')
  } finally {
    jobWorkerRodando = false
  }
}

function iniciarJobWorker() {
  if (jobWorkerTimer) return
  jobWorkerTimer = setInterval(() => {
    jobWorkerTick().catch((e) => logger.error('Erro no tick do worker:', e.message))
  }, JOB_WORKER_POLL_MS)
  jobWorkerTick().catch((e) => logger.error('Erro no primeiro tick do worker:', e.message))
}

/** Valida mensagens_bolhas do JSON; retorna null se inválido. */
function normalizarMensagensBolhasArray(raw, etapa = null) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (!t) continue
    out.push(t.length > MAX_CARACTERES_POR_BOLHA ? t.slice(0, MAX_CARACTERES_POR_BOLHA) : t)
    if (out.length >= MAX_MENSAGENS_BOLHAS) break
  }
  const limitadas = limitarBolhasPorEtapa({ etapa, mensagens: out })
  return limitadas.length ? limitadas : null
}

/** Sem mensagens_bolhas: divide por parágrafos (\n\n) para vários sendText, no máximo 4 partes. */
function dividirTextoPorQuebrasHeuristico(texto, etapa = null) {
  const t = (texto || '').trim()
  if (!t) return []
  const raw = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  const mensagens = raw.length <= 1 ? [t] : raw
  return limitarBolhasPorEtapa({ etapa, mensagens })
}



// Camadas futuras (plano "turbinar agente"): RAG com pgvector e tool use / busca controlada — não implementados no backend atual.



// ─── MOTOR DE PREÇO (código puro, não no prompt) ───────────────────────────────

/** Faixas de preço por plano (min–max em R$). */
/** Smoke: `node index.js --smoke-precificacao` (sem servidor nem DB). */
function runSmokePrecificacao() {
  const errs = []

  // Caso 1: plano_sugerido=padrao, ticket=alto, score_dor=8 → roi=0.73, padrao_valor=892
  const p1 = { plano_sugerido: 'padrao', ticket_cliente_final: 'alto', score_dor: 8, complexidade: 'servicos', negocio: 'teste', cidade: 'teste' }
  const r1 = calcularPreco(p1)
  const pj1 = r1.precificacao_json
  if (pj1.plano_recomendado !== 'padrao') errs.push('caso1: plano_recomendado')
  if (pj1.roi_score !== 0.73) errs.push(`caso1: roi_score esperado 0.73, got ${pj1.roi_score}`)
  const esperado1 = Math.round(600 + 0.73 * 400)
  if (pj1.valor_personalizado !== esperado1) errs.push(`caso1: valor_personalizado esperado ${esperado1}, got ${pj1.valor_personalizado}`)
  if (r1.total !== pj1.valor_personalizado) errs.push('caso1: total !== valor_personalizado')

  // Caso 2: fallback por complexidade (sem plano_sugerido) landing → iniciante
  const p2 = { complexidade: 'landing', ticket_cliente_final: 'baixo', score_dor: 3, negocio: 'teste', cidade: 'teste' }
  const r2 = calcularPreco(p2)
  if (r2.precificacao_json.plano_recomendado !== 'iniciante') errs.push('caso2: fallback complexidade')
  if (r2.total < 200 || r2.total > 600) errs.push(`caso2: total fora da faixa Iniciante (${r2.total})`)

  // Caso 3: premium
  const p3 = { plano_sugerido: 'premium', ticket_cliente_final: 'premium', score_dor: 10, complexidade: 'sistema', negocio: 'teste', cidade: 'teste' }
  const r3 = calcularPreco(p3)
  if (r3.total < 1000 || r3.total > 2000) errs.push(`caso3: total fora da faixa Premium (${r3.total})`)

  // Verifica presença dos três planos em precificacao_json
  for (const c of [pj1]) {
    if (!Number.isFinite(c.iniciante_valor)) errs.push('iniciante_valor ausente')
    if (!Number.isFinite(c.padrao_valor))    errs.push('padrao_valor ausente')
    if (!Number.isFinite(c.premium_valor))   errs.push('premium_valor ausente')
    if (!Number.isFinite(c.parcelamento_recomendado?.entrada)) errs.push('parcelamento ausente')
  }

  if (errs.length) {
    logger.error('❌ smoke precificacao:', errs.join('; '))
    process.exit(1)
  }
  logger.info('✅ smoke precificacao ok — plano=%s roi=%s valor=R$%d', pj1.plano_recomendado, pj1.roi_score, r1.total)
}

function resumirTextoOperacional(raw, maxLen = 240) {
  const texto = String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
  if (!texto) return ''
  return texto.length > maxLen ? `${texto.slice(0, maxLen - 1)}…` : texto
}

function classificarErroRespostaWebhook(err) {
  const detalheResposta =
    err?.response?.data == null
      ? ''
      : typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data)
  const detalhe = resumirTextoOperacional(detalheResposta || err?.message || err, 500)
  const msg = resumirTextoOperacional(err?.message || '', 240)
  const url = String(err?.config?.url || '')
  const status = Number.isFinite(Number(err?.response?.status)) ? Number(err.response.status) : null

  if (err?.code === 'ECONNABORTED' && /anthropic\.com\/v1\/messages/i.test(url)) {
    return {
      codigo: 'modelo_timeout',
      resumo: 'timeout ao consultar o modelo',
      detalhe: detalhe || msg || 'A chamada ao modelo excedeu o tempo limite.',
    }
  }
  if (/ANTHROPIC_KEY/i.test(msg)) {
    return {
      codigo: 'configuracao_modelo',
      resumo: 'configuração do modelo ausente',
      detalhe: detalhe || msg || 'ANTHROPIC_KEY não configurada.',
    }
  }
  if (/Histórico vazio|última mensagem precisa ser do usuário|Última mensagem do histórico deve ser do usuário/i.test(msg)) {
    return {
      codigo: 'historico_invalido',
      resumo: 'histórico inválido para responder',
      detalhe: detalhe || msg || 'O histórico não estava em um estado válido para gerar resposta.',
    }
  }
  if (/mensagem utilizável|mensagem vazia|JSON válido com mensagem/i.test(msg)) {
    return {
      codigo: 'modelo_parse',
      resumo: 'modelo retornou conteúdo sem mensagem utilizável',
      detalhe: detalhe || msg || 'A resposta do modelo não pôde ser convertida em mensagem segura para o lead.',
    }
  }
  if (/anthropic\.com\/v1\/messages/i.test(url)) {
    return {
      codigo: status === 429 ? 'modelo_limite' : 'modelo_api',
      resumo: status === 429 ? 'limite temporário do modelo' : 'falha HTTP ao consultar o modelo',
      detalhe: detalhe || msg || (status ? `HTTP ${status} ao consultar o modelo.` : 'Falha ao consultar o modelo.'),
    }
  }
  if (/\/message\/send(Text|Buttons)\//i.test(url) || /Texto vazio para envio ao WhatsApp|Número\/JID inválido para envio/i.test(msg)) {
    return {
      codigo: 'envio_whatsapp',
      resumo: 'falha ao enviar pelo WhatsApp',
      detalhe: detalhe || msg || 'Não foi possível entregar a resposta ao WhatsApp.',
    }
  }
  return {
    codigo: 'resposta_falhou',
    resumo: 'falha ao gerar ou enviar resposta',
    detalhe: detalhe || msg || 'Erro inesperado no fluxo de resposta.',
  }
}

function gerarRequestIdAnthropic() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}`
}

function statusHttpDeErroAnthropic(err) {
  const status = err?.response?.status
  return Number.isInteger(status) ? status : null
}

function codigoErroAnthropic(err) {
  return String(err?.code || err?.response?.data?.error?.type || err?.response?.status || '').slice(0, 80) || null
}

function mensagemErroAnthropic(err) {
  const msg =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    ''
  return String(msg).slice(0, 500) || null
}
const learning = createLearning({
  pool,
  logger,
  axios,
  prompts,
  aiProvider,
  normalizarHistoricoMensagens,
  textoDeContent,
  parsearRespostaJsonClaude,
  chamarClaudeAuxiliar,
  contarVendasFechadas,
  buscarVendasFechadas,
  buscarUltimoAprendizado,
  gerarRequestIdAnthropic,
  registrarChamadaAnthropic,
  statusHttpDeErroAnthropic,
  codigoErroAnthropic,
  mensagemErroAnthropic,
})
const {
  normalizarListaCoachAnalise,
  normalizarSinaisCoach,
  normalizarLeadCoachPayload,
  hidratarAnalisePosConversa,
  salvarAnalisePosConversa,
  tentarConsolidacaoAutomatica,
  buscarUltimaAnalisePosConversa,
  buscarHistoricoAnalisesPosConversa,
  salvarAprendizado,
  normalizarPromptAlvo,
  inferirPromptAlvoDeTextoRegras,
  montarBlocoCorrecoesAprendizados,
  buscarAprendizadosAtivos,
  buscarAprendizadosPendentes,
  listarPromptAprendizados,
  aprovarAprendizado,
  desativarAprendizado,
  contarAnalisesDesdaUltimaConsolidacao,
  consolidarAprendizadoAnalises,
  gerarAprendizadoDeFunilDiagnostico,
  gerarAprendizado,
  sanitizarContentMensagemDashboard,
  sanitizarHistoricoParaRespostaDashboard,
  historicoParaTextoCoach,
  perfilJsonParaPromptSemDuplicarMemoria,
  montarResumoMemoriaVendas,
  montarBlocoContinuidadeTurno,
  extrairValoresReaisDoTextoBrasil,
  avaliarDivergenciaPrecoIaNoTexto,
  atualizarCamadaMemoriaVendasPosResposta,
  chamarClaudeLeadCoach,
} = learning


async function chamarClaudeAuxiliar(opts = {}) {
  const tipo = String(opts.tipo || 'auxiliar').slice(0, 60)
  const numero = opts.numero || null
  const estagio = opts.estagio || null
  const max_tokens = Number.isFinite(opts.max_tokens) ? opts.max_tokens : 600
  const temperature = Number.isFinite(opts.temperature) ? opts.temperature : 0.4
  // Com timeout_ms explicito, respeita o pedido ate o teto.
  const capAux = Number.isFinite(opts.timeout_cap_ms)
    ? Math.min(Math.max(opts.timeout_cap_ms, 5000), 900000)
    : CLAUDE_TIMEOUT_CAP_MS
  const timeoutMs = Number.isFinite(opts.timeout_ms)
    ? Math.min(Math.max(opts.timeout_ms, 5000), capAux)
    : Math.min(CLAUDE_TIMEOUT_MS, 30000)
  const system = String(opts.system || '').trim()
  const userMessage = String(opts.userMessage || '').trim()
  const expectJson = !!opts.expectJson

  if (!system || !userMessage) {
    return { ok: false, texto: '', errorCode: 'sem_anthropic_key_ou_prompt' }
  }

  const requestId = gerarRequestIdAnthropic()
  const inicio = Date.now()
  try {
    const aiResult = await aiProvider.generateAIResponse(
      {
        systemPrompt: system,
        userPrompt: userMessage,
        task: tipo,
        model: opts.model,
        temperature,
        maxTokens: max_tokens,
        timeoutMs,
        responseFormatJson: true,
      },
      pool,
      logger
    )
    const duration_ms = Date.now() - inicio
    // Log detalhado para chamadas Anthropic (rastreio de custo e cache)
    if (aiResult.provider === 'anthropic') {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo,
        numero,
        model: aiResult.model,
        estagio,
        duration_ms,
        http_ok: true,
        http_status: aiResult.httpStatus || 200,
        stop_reason: aiResult.stopReason || null,
        usage: aiResult.usage,
        metadata: opts.metadata || {},
      })
    }
    const texto = aiResult.text.trim()
    const stop_reason = aiResult.stopReason || null
    const usage = aiResult.usage && typeof aiResult.usage === 'object' ? aiResult.usage : null
    let parsed = null
    if (expectJson && texto) {
      try { parsed = parsearRespostaJsonClaude(texto) } catch (_) { parsed = null }
    }
    return { ok: true, texto, parsed, stop_reason, usage }
  } catch (e) {
    await registrarChamadaAnthropic({
      request_id: requestId,
      tipo,
      numero,
      model: opts.model || 'unknown',
      estagio,
      duration_ms: Date.now() - inicio,
      http_ok: false,
      http_status: statusHttpDeErroAnthropic(e),
      erro_codigo: codigoErroAnthropic(e),
      erro_msg: mensagemErroAnthropic(e),
      metadata: opts.metadata || {},
    })
    logger.error(`Erro chamada auxiliar (${tipo}):`, e.response?.data || e.message)
    return {
      ok: false,
      texto: '',
      errorCode: codigoErroAnthropic(e),
      errorMsg: mensagemErroAnthropic(e),
    }
  }
}

/**
 * Conjunto de mensagens da apresentacao manual (comando APRESENTACAO do operador):
 * intro de texto, caption do print "modelos-site", caption do print "planos-mensais"
 * e fechamento de texto. Quatro itens, todos enviados ao lead em sequencia.
 *
 * Fallback contextualizado por nicho/cidade quando ANTHROPIC_KEY ausente ou IA falha.
 */
function gerarApresentacaoOperadorFallback(perfil = {}) {
  const negocio = String(perfil?.negocio || '').trim()
  const cidade = String(perfil?.cidade || '').trim()
  const ancora = negocio
    ? (cidade ? `pra ${negocio} em ${cidade}` : `pra ${negocio}`)
    : 'pro seu negocio'
  return {
    intro: `Deixa eu te mostrar como funciona na pratica — aqui vai uma visao completa do que a gente entrega ${ancora}.`,
    captionModelos:
      'Esses sao os modelos que a gente trabalha — cada um pensado pra um perfil de negocio. ' +
      'Tem desde o mais enxuto pra quem ta comecando ate o mais completo pra quem quer posicionar forte. ' +
      'A ideia e mostrar a direcao; o ajuste fino acontece com a equipe da PJ Codeworks depois.',
    captionPlanos:
      'E pra manter tudo funcionando depois que o site tiver no ar, a gente tem planos a partir de R$ 150/mes — ' +
      'desde a infra basica pra deixar seguro e atualizado ate o crescimento, com acompanhamento mais ativo no Google. ' +
      'A maioria comeca pelo Crescimento.',
    fechamento:
      'Algum modelo chamou mais atencao? Posso ja te puxar mais detalhes do projeto que faz mais sentido pro seu caso.',
  }
}

const APRESENTACAO_LIMITES = {
  intro: 320,
  captionModelos: 600,
  captionPlanos: 600,
  fechamento: 320,
}

function normalizarApresentacaoIa(parsed, perfil) {
  const fb = gerarApresentacaoOperadorFallback(perfil)
  const out = {}
  for (const campo of ['intro', 'captionModelos', 'captionPlanos', 'fechamento']) {
    const cand = parsed && typeof parsed[campo] === 'string' ? parsed[campo].trim() : ''
    const limite = APRESENTACAO_LIMITES[campo] || 600
    if (cand && cand.length <= limite && !/\[[^\]]{1,80}\]/.test(cand)) {
      out[campo] = cand
    } else {
      out[campo] = fb[campo]
    }
  }
  return out
}

/**
 * Gera os 4 textos da apresentacao manual via IA. Centraliza tom da PJ Codeworks
 * e usa nicho/cidade/dor coletados do perfil para contextualizar.
 *
 * Retorna sempre o objeto completo (apos fallback campo a campo se necessario).
 */
async function gerarApresentacaoOperador(perfil = {}, historico = [], numero = null) {
  const fb = gerarApresentacaoOperadorFallback(perfil)
  const negocio = String(perfil?.negocio || '').trim()
  const cidade = String(perfil?.cidade || '').trim()
  const dor = String(perfil?.termometro_dor || perfil?.score_dor || '').trim()
  const ticket = String(perfil?.ticket_cliente_final || '').trim()
  const tem_site_atual = perfil?.ja_aparece_google === false ? 'nao aparece no Google' : ''
  const ultimaFalaLead = (() => {
    const msgs = Array.isArray(historico) ? historico : []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'user' && typeof m.content === 'string') {
        return m.content.trim().slice(0, 300)
      }
    }
    return ''
  })()

  const system =
    `Voce e o assistente de vendas da PJ Codeworks. Um operador disparou o comando APRESENTACAO para enviar 4 mensagens ao WhatsApp do lead em sequencia:\n` +
    `1) intro (texto curto antes das imagens)\n` +
    `2) captionModelos (legenda do print "modelos-site" — 3 tiers de site)\n` +
    `3) captionPlanos (legenda do print "planos-mensais" — manutencao mensal)\n` +
    `4) fechamento (texto curto puxando proxima interacao)\n\n` +
    `Retorne APENAS JSON valido com chaves: intro, captionModelos, captionPlanos, fechamento. Sem markdown, sem texto fora do JSON.\n\n` +
    `REGRAS DE TOM E CONTEUDO:\n` +
    `- Voz alinhada ao prompts/system.md: WhatsApp humano, anti-textao, fala em cliente/dinheiro/status — nao em tecnologia.\n` +
    `- Personalize com o nicho e cidade do lead quando disponiveis. Se nao tiver, escreva de forma natural sem placeholder.\n` +
    `- intro: ate 280 chars, 1-2 frases. Nao prometa primeira posicao no Google nem percentual de crescimento.\n` +
    `- captionModelos: ate 540 chars. Explique que sao 3 modelos (do enxuto ao completo) sem listar valores. Mostre que a equipe da PJ Codeworks ajusta o ideal pelo perfil dele.\n` +
    `- captionPlanos: ate 540 chars. Explique que mensalidade e separada do projeto, ancore no menor valor (R$ 150/mes) e cite a opcao de crescimento mais ativo. Nao prometa resultado garantido.\n` +
    `- fechamento: ate 280 chars, 1-2 frases. Pergunta natural pra abrir proximo turno (qual modelo chamou atencao, ou se faz sentido detalhar algum). Nao agende reuniao automaticamente.\n` +
    `- PROIBIDO: placeholders entre colchetes ([Empresa], [Cidade], etc.), promessa de %, pedido de PIX/cartao/CPF, reapresentacao "Sou da PJ Codeworks" (a apresentacao em si ja e a mensagem).\n` +
    `- Use emojis com moderacao (no maximo 1 por campo).`
  const user =
    `Contexto do lead:\n` +
    `- nicho: ${negocio || '(nao coletado)'}\n` +
    `- cidade: ${cidade || '(nao coletada)'}\n` +
    `- termometro_dor: ${dor || '(nao coletado)'}\n` +
    `- ticket_cliente_final: ${ticket || '(nao coletado)'}\n` +
    `- situacao google: ${tem_site_atual || '(nao coletada)'}\n` +
    `- ultima fala do lead (se houver): ${ultimaFalaLead || '(sem historico recente)'}\n\n` +
    `Gere o JSON com os 4 campos.`

  const r = await chamarClaudeAuxiliar({
    tipo: 'apresentacao_operador',
    numero,
    estagio: perfil?.estagio || 'recomendacao',
    system,
    userMessage: user,
    max_tokens: 900,
    temperature: 0.5,
    expectJson: true,
    metadata: { tem_perfil: !!negocio },
  })
  if (!r.ok || !r.parsed) return fb
  return normalizarApresentacaoIa(r.parsed, perfil)
}

function sanitizarLoneSurrogates(val) {
  if (Array.isArray(val)) return val.map(sanitizarLoneSurrogates)
  if (val && typeof val === 'object') {
    const out = {}
    for (const k of Object.keys(val)) out[k] = sanitizarLoneSurrogates(val[k])
    return out
  }
  if (typeof val !== 'string') return val
  let out = ''
  for (let i = 0; i < val.length; i++) {
    const c = val.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = val.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) { out += val[i] + val[i + 1]; i++ }
      else out += '�'
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '�'
    } else {
      out += val[i]
    }
  }
  return out
}

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'

/**
 * Busca top 3 resultados orgânicos para "[segmento] [cidade]" no Google CSE.
 * Retorna array de { titulo, url, snippet } ou [] se indisponível/erro.
 * Nunca lança: falha silenciosa pra não quebrar o webhook.
 */
async function buscarConcorrentesReais(segmento, cidade) {
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_ID
  if (!key || !cx) return []
  const seg = String(segmento || '').trim()
  const cid = String(cidade || '').trim()
  if (!seg || !cid) return []
  const query = `${seg} ${cid}`
  try {
    const r = await axios.get(GOOGLE_CSE_ENDPOINT, {
      params: { key, cx, q: query, num: 5, gl: 'br', hl: 'pt-BR', safe: 'active' },
      timeout: 7000,
    })
    const items = Array.isArray(r.data?.items) ? r.data.items : []
    const out = []
    for (const it of items) {
      if (out.length >= 3) break
      const titulo = (it?.title || '').trim()
      const url = (it?.link || '').trim()
      // Descarta diretórios genéricos que não são concorrentes diretos (apollo, instagram, facebook, linkedin, google maps, yellow pages)
      const urlLc = url.toLowerCase()
      if (/instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|wikipedia\.org|maps\.google|apollo\.io|guiamais\.com|solucoesindustriais|telelistas/i.test(urlLc)) continue
      if (!titulo || !url) continue
      out.push({ titulo, url, snippet: (it?.snippet || '').trim().slice(0, 160) })
    }
    logger.info(`🔎 CSE "${query}": ${out.length} concorrentes (${items.length} crus)`)
    return out
  } catch (e) {
    const status = e?.response?.status
    const reason = e?.response?.data?.error?.errors?.[0]?.reason
      || e?.response?.data?.error?.status || null
    logger.warn(`⚠️ Google CSE falhou para "${query}" (status=${status}${reason ? `, reason=${reason}` : ''}): ${e.message}`)
    return []
  }
}

/**
 * Garante que o perfil tem concorrentes reais buscados. Se não tiver e houver
 * segmento+cidade, busca uma vez e persiste em lead_profiles.concorrentes.
 * Retorna o array final de concorrentes (podendo ser vazio).
 */
async function garantirConcorrentesReaisNoPerfil(numero, perfil) {
  try {
    if (!perfil) return []
    // Se já há concorrentes persistidos, respeita (1 chamada por lead).
    if (Array.isArray(perfil.concorrentes) && perfil.concorrentes.length > 0) {
      return perfil.concorrentes
    }
    // Freio: tenta o CSE só 1x por lead. Se ja tentou (mesmo sem resultado, ex.:
    // CSE em 403), nao re-bate a cada turno — evita martelar a API e tira o
    // timeout de 7s do caminho do webhook. A flag vive em eventos_conversa (merge
    // JSONB no atualizarPerfil preserva as demais chaves).
    const ev = (perfil.eventos_conversa && typeof perfil.eventos_conversa === 'object' && !Array.isArray(perfil.eventos_conversa))
      ? perfil.eventos_conversa
      : {}
    if (ev.cse_concorrentes_tentado_em) return []
    const seg = perfil.negocio
    const cid = perfil.cidade
    if (!seg || !cid) return []   // sem dados ainda: nao marca, tenta quando tiver
    const resultados = await buscarConcorrentesReais(seg, cid)
    const patchTentativa = { eventos_conversa: { cse_concorrentes_tentado_em: new Date().toISOString() } }
    if (!resultados.length) {
      await atualizarPerfil(numero, patchTentativa)   // marca tentativa mesmo sem resultado
      return []
    }
    // Persiste como array de strings no formato "Titulo — URL" pra caber em TEXT[]
    const comoTexto = resultados.map((r) => `${r.titulo} — ${r.url}`)
    await atualizarPerfil(numero, { concorrentes: comoTexto, ...patchTentativa })
    return comoTexto
  } catch (e) {
    logger.warn(`⚠️ garantirConcorrentesReaisNoPerfil(${numero}): ${e.message}`)
    return []
  }
}

/**
 * @param {string} numero JID
 * @param {{ modo: string, instrucao_snippet: string|null, mensagem_preview: string|null, envio_ok: boolean, erro?: string|null }} opts
 */
function textoPedePreco(texto) {
  if (!texto || typeof texto !== 'string') return false
  if (/\b(quanto|pre[cç]o|valor|investimento|or[cç]amento|orcamento|custa|custo|pagar|cobr[ao])\b/i.test(texto)) return true
  if (/qual\s+(o\s+)?(pre[cç]o|valor|custo|investimento|cobr[ao])/i.test(texto)) return true
  if (/quanto\s+(fica|sai|vai\s+sair|vou\s+pagar|[eé]|custa)/i.test(texto)) return true
  if (/o\s+que\s+ficaria\s+pra/i.test(texto)) return true
  if (/me\s+(fala|diz|manda|passa)\s+(o\s+)?(pre[cç]o|valor|custo)/i.test(texto)) return true
  return false
}

function normalizarTextoIntencao(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

const CIDADES_BR_COMUNS = new Set([
  'fortaleza',
  'sao paulo',
  'rio de janeiro',
  'belo horizonte',
  'brasilia',
  'salvador',
  'recife',
  'manaus',
  'curitiba',
  'porto alegre',
  'goiania',
  'belem',
  'sao bernardo',
  'santo andre',
  'campinas',
  'guarulhos',
  'osasco',
])

function textoPerguntaComoFunciona(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(como\s+funciona|como\s+faco|como\s+e\s+que|como\s+seria|como\s+comeca|me\s+explica|explica\s+melhor)\b/i.test(s)
}

/**
 * Detecta quando o lead expressa duvida/incompreensao sobre a mensagem anterior.
 * Variantes cobertas:
 *  - "nao entendi" / "nao entendi?" / "nao entendi essa pergunta"
 *  - "como assim?"
 *  - "o que voce quer dizer?" / "o que quer dizer"
 *  - "pode explicar?" / "me explica"
 *  - "nao sei responder" / "nao sei responder isso"
 *  - "qual a pergunta?" / "que pergunta?"
 *
 * REGRA: esta intencao tem prioridade ALTA — antes de pergunta_preco e
 * pergunta_como_funciona — porque o bot deve REEXPLICAR a pergunta anterior,
 * nao avancar o fluxo nem assumir que o lead esta perguntando preco/processo.
 */
function textoExpressaDuvida(texto) {
  const s = normalizarTextoIntencao(texto)
  if (!s) return false
  if (/\bnao\s+entend[io]\b/.test(s)) return true
  if (/\bcomo\s+assim\b/.test(s)) return true
  if (/\bo\s+que\s+(voce\s+)?(quer|esta\s+querendo)\s+dizer\b/.test(s)) return true
  if (/\bpode\s+(me\s+)?explicar\b/.test(s)) return true
  if (/\bnao\s+sei\s+(o\s+que\s+)?responder\b/.test(s)) return true
  if (/\bqual\s+(a|essa)\s+pergunta\b|\bque\s+pergunta\b/.test(s)) return true
  if (/\bnao\s+ficou\s+claro\b/.test(s)) return true
  return false
}

function textoPedidoHumano(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(humano|atendente|vendedor|falar\s+com\s+(alguem|pessoa|victor)|chama\s+o\s+victor|me\s+liga|ligacao|telefone)\b/i.test(s)
}

function textoPedidoReagendamento(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(remarcar|reagendar|nao\s+consigo|nao\s+posso|outro\s+horario|outro\s+dia|pode\s+ser\s+amanha|mais\s+tarde|trocar\s+horario)\b/i.test(s)
}

function textoQuerComprarSite(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(quero|preciso|procuro|queria|gostaria|to\s+querendo|estou\s+querendo)\s+(comprar|fazer|criar|ter|contratar)?\s*(um\s+)?(site|website|pagina|landing)\b/.test(s) ||
    /\b(comprar|fazer|criar|contratar)\s+(um\s+)?(site|website|pagina|landing)\b/.test(s)
}

function textoQuerVenderSites(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\bquero\s+(vender|revender|trabalhar\s+vendendo)\s+(site|sites|website|websites|landing|paginas)\b/.test(s)
}

function textoConfundePrecoAnuncio(texto) {
  const s = normalizarTextoIntencao(texto)
  return textoPedePreco(texto) && /\b(anuncio|anuncios|ads|impulsionamento|trafego\s+pago|campanha)\b/.test(s)
}

function textoDemonstraIntencao(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(pretendo|quero|tenho\s+interesse|me\s+interessa|vamos\s+fazer|preciso\s+de|to\s+querendo|estou\s+querendo|gostei)\b/i.test(s)
}

function textoPedePropostaOuContratacao(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(proposta|orcamento|orcar|contratar|fechar|comecar|começar|vamos\s+fazer|quero\s+fazer|pretendo\s+fazer|quero\s+contratar|quero\s+comecar|quero\s+começar|quero\s+seguir|pode\s+seguir|vamos\s+seguir)\b/.test(s)
}

function deveOferecerReuniaoDireta({ texto = '', perfil = {}, estagio = '', interpretacao = {}, slot = {} } = {}) {
  const necessidade = normalizarNecessidadeLead(slot.necessidade || perfil.servico_principal || perfil.servico_foco || perfil.necessidade)
  if (interpretacao.intencao_principal === 'pergunta_preco') return true
  if (textoPedePropostaOuContratacao(texto)) return true
  const s = normalizarTextoIntencao(texto)
  if (ehProjetoSobMedida(perfil, texto, estagio) && (necessidade !== 'site' || /\b(personaliz|sob\s+medida|escopo|projeto\s+custom|integracao|integra[cç]ao)\b/.test(s))) return true
  if (String(estagio || '').toLowerCase() === 'conexao_valor' && textoDemonstraIntencao(texto)) return true
  return ['sistema', 'automacao', 'agente_ia', 'solucao_sob_medida'].includes(necessidade)
}

function textoConexaoValor(perfil = {}) {
  const p = adaptarPerfilLegadoParaFunil(perfil)
  const negocio = p.negocio || p.tipo_negocio || 'seu negócio'
  const cidade = p.cidade || p.cidade_base || p.regiao_atendimento || ''
  const necessidade = normalizarNecessidadeLead(p.servico_principal || p.servico_foco || p.necessidade)
  const contexto = cidade ? `${negocio} em ${cidade}` : negocio
  if (necessidade === 'site') {
    return `Perfeito. Para ${contexto}, um site pode ajudar a passar mais confiança e levar o cliente direto para o WhatsApp. Hoje você já tem algum site ou seria o primeiro?`
  }
  if (necessidade === 'automacao') {
    return `Perfeito. Para ${contexto}, uma automação pode reduzir tarefas manuais e organizar melhor o atendimento. Qual parte do processo mais toma tempo hoje?`
  }
  if (necessidade === 'sistema') {
    return `Perfeito. Para ${contexto}, um sistema pode organizar dados, atendimento e operação em um fluxo mais claro. O que você precisa controlar melhor hoje?`
  }
  if (necessidade === 'agente_ia') {
    return `Perfeito. Para ${contexto}, um agente de IA pode ajudar a responder e organizar demandas com mais consistência. Ele seria para atendimento ou operação interna?`
  }
  return `Perfeito. Para ${contexto}, a PJ Codeworks pode desenhar uma solução em código alinhada ao seu objetivo. Qual resultado você quer melhorar primeiro?`
}

function textoEnviaDadosNegocio(texto) {
  const s = normalizarTextoIntencao(texto)
  return /\b(sou|trabalho\s+com|tenho\s+(uma|um)|minha\s+empresa|meu\s+negocio|em\s+[a-z]{3,}|cidade|atendo|procuro|preciso\s+de|quero)\b/i.test(s)
}

const INTENCOES_VALIDAS = new Set([
  'pedido_humano', 'duvida_nao_entendi', 'escolha_horario',
  'ambiguous_site_sales', 'pergunta_preco_anuncio', 'pergunta_preco',
  'compra_site', 'pergunta_como_funciona', 'pedido_reagendamento',
  'aceite_convite_reuniao', 'interesse_inicial', 'envio_dados_negocio', 'sem_clareza',
])

function normalizarBooleanResposta(valor) {
  if (typeof valor === 'boolean') return valor
  const s = normalizarTextoIntencao(valor)
  if (!s) return null
  if (/\b(nao|nunca|ainda\s+nao|primeiro|seria\s+o\s+primeiro|sem\s+site)\b/.test(s)) return false
  if (/\b(sim|tenho|ja\s+tenho|temos|possuo|site\s+atual)\b/.test(s)) return true
  return null
}

function normalizarDadosExtraidosIA(dados = {}) {
  if (!dados || typeof dados !== 'object') return {}
  const out = {}
  const negocio = normalizarNegocioLead(dados.negocio || dados.nicho || dados.tipo_negocio)
  if (negocio) out.negocio = negocio
  const cidade = normalizarCidadeLead(dados.cidade || dados.cidade_base)
  if (cidade) out.cidade_base = cidade
  const regiao = normalizarCidadeLead(dados.regiao_atendimento || dados.regiao)
  if (regiao && regiao !== cidade) out.regiao_atendimento = regiao
  const necessidade = normalizarNecessidadeLead(dados.necessidade || dados.servico_principal || dados.servico)
  if (necessidade) out.necessidade = necessidade
  const temSite = normalizarBooleanResposta(dados.tem_site)
  if (temSite !== null) out.tem_site = temSite
  const objetivoSite = String(dados.objetivo_site || '').trim()
  if (objetivoSite && objetivoSite.length <= 180) out.objetivo_site = objetivoSite
  const origemClientes = String(dados.origem_clientes || '').trim()
  if (origemClientes && origemClientes.length <= 120) out.origem_clientes = origemClientes
  return out
}

function normalizarRespostaContextualIA(valor = {}) {
  if (!valor || typeof valor !== 'object') return null
  const tipo = String(valor.tipo || '').trim()
  if (tipo === 'aceite_reuniao') {
    return { tipo, aceitou: valor.aceitou !== false }
  }
  if (tipo === 'tem_site') {
    const temSite = normalizarBooleanResposta(valor.valor ?? valor.tem_site)
    if (temSite !== null) return { tipo, tem_site: temSite }
  }
  return null
}

/**
 * Classifica a intenção principal da mensagem do lead via IA (Haiku, rápido).
 * Retorna o mesmo shape de interpretarIntencaoMensagem para compatibilidade.
 * Em caso de falha (timeout, parse inválido), retorna null — o caller cai no fallback regex.
 */
async function interpretarIntencaoMensagemIA({ texto = '', perfil = {}, estagio = 'novo', historico = [] } = {}) {
  const promptBase = prompts.CLASSIFICADOR_INTENCAO_BASE
  if (!promptBase || promptBase.trim().length < 20) return null

  const ultimasTrocas = historico.slice(-4).map((m) => {
    const role = m.role === 'assistant' ? 'bot' : 'lead'
    const content = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((c) => c.text || '').join(' ') : '')
    return `${role}: ${String(content).slice(0, 200)}`
  }).join('\n')

  const userMsg = JSON.stringify({
    mensagem: String(texto || '').slice(0, 500),
    estagio: estagio || 'novo',
    historico_recente: ultimasTrocas || '(sem histórico)',
    perfil: {
      negocio: perfil.negocio || null,
      cidade: perfil.cidade || null,
      necessidade: perfil.servico_principal || perfil.necessidade || null,
      agendamento_status: perfil.reuniao_proposta?.necessaria ? 'agendamento_pendente' : null,
    },
  })

  const t0 = Date.now()
  const promptChars = promptBase.length + userMsg.length
  const historicoSize = Array.isArray(historico) ? historico.length : 0
  const model = 'claude-haiku-4-5-20251001'
  const timeoutMs = 8000

  function diagnosticar(motivo, extra = {}) {
    const detalhe = {
      tipo: 'classificar_intencao',
      motivo,
      duration_ms: Date.now() - t0,
      model,
      timeout_ms: timeoutMs,
      prompt_chars: promptChars,
      historico_size: historicoSize,
      ...extra,
    }
    try {
      logger.warn('[classificar_intencao] caiu em fallback heuristico', detalhe)
    } catch (_) {}
  }

  try {
    const r = await chamarClaudeAuxiliar({
      tipo: 'classificar_intencao',
      system: promptBase,
      userMessage: userMsg,
      model,
      max_tokens: 220,
      temperature: 0,
      timeout_ms: timeoutMs,
      expectJson: true,
    })

    if (!r.ok) {
      diagnosticar('chamada_nao_ok', {
        http_status: r.http_status || null,
        erro_codigo: r.erro_codigo || null,
        erro_msg: typeof r.erro_msg === 'string' ? r.erro_msg.slice(0, 200) : null,
        stop_reason: r.stop_reason || null,
        provider_fallback_usado: r.fallback_used === true,
      })
      return null
    }
    if (!r.parsed) {
      diagnosticar('parse_invalido', {
        text_preview: typeof r.text === 'string' ? r.text.slice(0, 120) : null,
        stop_reason: r.stop_reason || null,
      })
      return null
    }
    const intencao = String(r.parsed?.intencao || '').trim()
    if (!INTENCOES_VALIDAS.has(intencao)) {
      diagnosticar('intencao_fora_do_enum', { intencao_recebida: intencao || null })
      return null
    }
    return {
      intencao,
      dados_extraidos: normalizarDadosExtraidosIA(r.parsed?.dados_extraidos || {}),
      resposta_contextual: normalizarRespostaContextualIA(r.parsed?.resposta_contextual || null),
    }
  } catch (err) {
    const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(err && err.message ? err.message : '')
    diagnosticar(isTimeout ? 'timeout' : 'excecao_provider', {
      erro_msg: err && err.message ? String(err.message).slice(0, 200) : null,
      erro_code: err && err.code ? String(err.code) : null,
    })
    return null
  }
}

const NECESSIDADE_CANONICA = Object.freeze({
  site: 'site',
  sistema: 'sistema',
  automacao: 'automacao',
  agente_ia: 'agente_ia',
  solucao_sob_medida: 'solucao_sob_medida',
})

function normalizarNecessidadeLead(valor) {
  const s = normalizarTextoIntencao(valor)
  if (!s) return null
  if (/\bagente\s+de\s+ia\b|\bia\b/.test(s)) return NECESSIDADE_CANONICA.agente_ia
  if (/\bautomacao\b|automatiza|\bbot\b|\bchatbot\b|automatizar\s+(meu\s+)?atendimento/.test(s)) return NECESSIDADE_CANONICA.automacao
  if (/\bsistema\b|\berp\b|\bcrm\b|\bdashboard\b|\bpainel\b/.test(s)) return NECESSIDADE_CANONICA.sistema
  if (/\b(site|sites|saite|sait|saiti|landing|website|pagina|paginha|page|pages)\b/.test(s)) return NECESSIDADE_CANONICA.site
  if (/\bsolucao\s+(personalizada|sob\s+medida|customizada|na\s+medida)\b|\bsob\s+medida\b/.test(s)) {
    return NECESSIDADE_CANONICA.solucao_sob_medida
  }
  return null
}

function normalizarCidadeLead(valor) {
  const raw = String(valor || '').trim().replace(/\s+/g, ' ')
  if (!raw) return null
  const s = normalizarTextoIntencao(raw)
  if (/\bsbc\b|\bsao\s+bernardo(?:\s+do\s+campo)?\b/.test(s)) return 'São Bernardo do Campo'
  if (/\bsanto\s+andre\b/.test(s)) return 'Santo André'
  if (/\bscs\b|\bsao\s+caetano(?:\s+do\s+sul)?\b/.test(s)) return 'São Caetano do Sul'
  if (/\bsao\s+paulo\b/.test(s)) return 'São Paulo'
  if (/\bdiadema\b/.test(s)) return 'Diadema'
  if (/\bmaua\b/.test(s)) return 'Mauá'
  if (CIDADES_BR_COMUNS.has(s)) return raw.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
  return raw
}

function normalizarNegocioLead(valor) {
  let raw = String(valor || '').trim().replace(/\s+/g, ' ')
  if (!raw) return null
  raw = raw
    .replace(/\s+e\s+atendo.*$/i, '')
    .replace(/\s+atendo.*$/i, '')
    .replace(/\s+(?:sou|moro|estou)\s+(?:de|em|na|no)\s+.*$/i, '')
    .replace(/\s+procuro?.*$/i, '')
    .replace(/\s+quero?.*$/i, '')
    // Corta a clausula de localizacao que nao faz parte do ramo:
    // "restaurante em sp e ...", "barbearia na zona sul ..." -> so o ramo.
    // (nomes de ramo nao contem " em/na/no <algo>"; isso e sempre cidade/local)
    .replace(/\s+(?:em|na|no|nas|nos)\s+.+$/i, '')
    // Corta continuacao de frase corrida (conjuncao + sinal de oracao):
    // "... e e meu primeiro site", "... como faco para criar", "... que preciso".
    // O " e " so e cortado quando seguido de verbo/pronome (preserva "bar e restaurante").
    .replace(/\s+e\s+(?:e|é|sou|to|tou|estou|tenho|preciso|quero|gostaria|meu|minha)\b.*$/i, '')
    .replace(/\s+(?:que|como|pra|para|porque|porem|pois)\s+.+$/i, '')
    .replace(/\s+(?:meu|minha|meus|minhas)\s+.+$/i, '')
    .trim()

  const s = normalizarTextoIntencao(raw)
  if (/\b(corte\s+de\s+cabelo|barbeiro|barbearia|barber)\b/.test(s)) return 'corte de cabelo / barbearia'
  if (/\b(nail\s+designer|manicure|unha|unhas)\b/.test(s)) return 'nail designer'
  if (/\b(dentista|odontolog|odonto)\b/.test(s)) return 'dentista'
  if (/\b(clinica\s+estetica|estetica)\b/.test(s)) return 'clínica estética'
  // Rejeita o que sobrou se ainda parecer frase (verbo de acao/intencao) ou for
  // termo do nosso catalogo — site/sistema/etc e a necessidade, nao o ramo do lead.
  // Devolver null deixa a IA reanalisar em vez de gravar lixo como "negocio".
  if (/\b(faco|fazer|fazendo|criar|criando|montar|desenvolver|gostaria|preciso|comecar)\b/.test(s)) return null
  if (/\b(site|sites|sistema|automacao|landing|pagina|aplicativo|app|agente)\b/.test(s)) return null
  if (raw.length >= 2 && raw.length <= 45 && !/^(de|em|na|no|um|uma)$/i.test(raw)) return raw
  return null
}

function adaptarPerfilLegadoParaFunil(perfil = {}) {
  const normalizado = { ...(perfil || {}) }
  if (!normalizado.negocio && perfil.businessType) normalizado.negocio = perfil.businessType
  if (!normalizado.cidade && perfil.city) normalizado.cidade = normalizarCidadeLead(perfil.city)
  if (normalizado.tem_site == null && perfil.hasWebsite != null) normalizado.tem_site = perfil.hasWebsite
  if (!normalizado.necessidade && perfil.mainService) {
    normalizado.necessidade = normalizarNecessidadeLead(perfil.mainService) || perfil.mainService
  }
  if (!normalizado.servico_principal && normalizado.necessidade) normalizado.servico_principal = normalizado.necessidade
  return normalizado
}

function extrairDadosBasicosDoHistorico(historico = []) {
  const dados = {}
  if (!Array.isArray(historico)) return dados
  for (const item of historico) {
    if (!item || item.role !== 'user') continue
    const texto = typeof item.content === 'string' ? item.content : String(item.content || '')
    const slot = extrairDadosLeadDoTexto(texto)
    if (slot.negocio) dados.negocio = slot.negocio
    if (slot.cidade_base) dados.cidade = slot.cidade_base
    if (slot.regiao_atendimento) dados.regiao_atendimento = slot.regiao_atendimento
    if (slot.necessidade) dados.necessidade = slot.necessidade
  }
  return dados
}

function patchPerfilComDadosHistorico(perfil = {}, historico = []) {
  const dados = extrairDadosBasicosDoHistorico(historico)
  const patch = {}
  if (!perfil.negocio && dados.negocio) patch.negocio = dados.negocio
  if (!perfil.cidade && dados.cidade) patch.cidade = dados.cidade
  if (!perfil.regiao_atendimento && dados.regiao_atendimento) patch.regiao_atendimento = dados.regiao_atendimento
  if (!perfil.servico_principal && !perfil.servico_foco && !perfil.necessidade && dados.necessidade) {
    patch.servico_principal = dados.necessidade
    patch.necessidade = dados.necessidade
  }
  return patch
}

function normalizarContextoDecisao(contexto = {}) {
  return {
    ...contexto,
    texto: contexto.texto || contexto.mensagem || contexto.mensagemAtual || '',
    estagio: contexto.estagio || contexto.estagio_funil || contexto.ultimoEstado || 'novo',
  }
}

/**
 * Slot-filling: extrai negocio, cidade, regiao_atendimento e necessidade do texto livre do lead.
 * Os campos retornados podem ser usados para enriquecer o perfil antes de decidir a proxima pergunta,
 * evitando que o bot repita perguntas ja respondidas pelo lead.
 *
 * @param {string} texto - mensagem bruta do lead (com acentos preservados)
 * @returns {{ negocio?: string, cidade_base?: string, regiao_atendimento?: string, necessidade?: string }}
 */
function extrairDadosLeadDoTexto(texto) {
  if (!texto || typeof texto !== 'string') return {}
  const out = {}
  const original = String(texto).trim()
  if (!original) return out
  const s = normalizarTextoIntencao(original)

  // Necessidade (servico procurado)
  const necessidade = normalizarNecessidadeLead(original)
  if (necessidade) out.necessidade = necessidade

  const mAtendoComNegocio = original.match(/\batendo\s+(?:em|de|na|no)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ\w' ]{2,40}?)\s+com\s+([^.\n,;]{2,60})/i)
  if (mAtendoComNegocio) {
    const cidade = normalizarCidadeLead(mAtendoComNegocio[1].trim())
    const negocio = normalizarNegocioLead(mAtendoComNegocio[2])
    if (cidade) out.cidade_base = cidade
    if (negocio) out.negocio = negocio
  }

  // Cidade-base — "sou de X", "moro em X", "estou em X", "cidade X"
  const reCidadeBase = [
    /\b(?:trabalho|atendo|fa[cç]o)\s+(?:em|de|na|no)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ\w' ]{2,40}?)(?=\s+com\b|[,.;]|\s+e\s+atend|\s+atend|\s+procur|\s*$|\n)/i,
    /\b(?:sou|moro|estou|estamos|vivo)\s+(?:em|de|na|no)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,.;]|\s+e\s+atend|\s+atend|\s+procur|\s*$|\n)/i,
    /\bcidade\s+(?:de\s+|é\s+|eh\s+|:\s*)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=[,.;]|\s*$|\n)/i,
  ]
  for (const re of reCidadeBase) {
    const m = original.match(re)
    if (m && m[1]) {
      const v = normalizarCidadeLead(m[1].trim())
      if (v.length >= 2 && v.length <= 50) {
        out.cidade_base = v
        break
      }
    }
  }
  if (!out.cidade_base) {
    const cidadeDetectada = normalizarCidadeLead(original)
    if (cidadeDetectada && cidadeDetectada !== original) out.cidade_base = cidadeDetectada
  }
  if (!out.cidade_base) {
    for (const cidade of CIDADES_BR_COMUNS) {
      const reCidadeComum = new RegExp(`\\bem\\s+${cidade.replace(/\s+/g, '\\s+')}\\b`, 'i')
      if (reCidadeComum.test(s)) {
        out.cidade_base = normalizarCidadeLead(cidade)
        break
      }
    }
  }

  // Regiao de atendimento — "atendo X" / "atendo em X"
  const mReg = original.match(/\batendo\s+(?:em\s+|na\s+|no\s+|a\s+regi[aã]o\s+(?:de\s+|do\s+|da\s+)?)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ' ]{1,40}?)(?=\s+com\b|[,.;]|\s*$|\n|\s+e\s+|\s+procur)/i)
  if (mReg && mReg[1]) {
    const v = normalizarCidadeLead(mReg[1].trim())
    if (v.length >= 2 && v.length <= 50 && v !== out.cidade_base) out.regiao_atendimento = v
  }

  // Negocio / ramo
  const reNegocio = [
    /\batendo\s+(?:em|de|na|no)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ\w' ]{2,40}?\s+com\s+([^.\n,;]{2,60})/i,
    /\btrabalho\s+(?:em|de|na|no)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ\w' ]{2,40}?\s+com\s+([^.\n,;]{2,60})/i,
    /\btrabalho\s+com\s+([^.\n,;]{2,60})/i,
    /\b(?:fa[cç]o|faco)\s+([^.\n,;]{2,60})/i,
    /\b(?:minha\s+empresa|meu\s+neg[oó]cio|meu\s+ramo|nosso\s+(?:neg[oó]cio|ramo|trabalho))\s+(?:[eé]\s+|de\s+|com\s+|:\s*)?([^.\n,;]{2,60})/i,
    /\btenho\s+(?:uma|um)\s+([^.\n,;]{2,60})/i,
    /\bramo\s+(?:de\s+|é\s+|eh\s+|:\s*)?([^.\n,;]{2,60})/i,
    /\bsou\s+(?!de\b|em\b|na\b|no\b)([^.\n,;]{2,60}?)(?=\s+(?:em|de|na|no)\b|[,.;]|\s*$|\n)/i,
    /\bsou\s+(?:dono\s+de\s+(?:uma|um)\s+|um\s+|uma\s+)([^.\n,;]{2,60})/i,
  ]
  for (const re of reNegocio) {
    const m = original.match(re)
    if (m && m[1]) {
      const v = normalizarNegocioLead(m[1])
      if (v) {
        out.negocio = v
        break
      }
    }
  }

  return out
}

function extrairDadoCurtoPorSlot(texto, perfil = {}) {
  const original = String(texto || '').trim()
  if (!original) return {}
  if (/[?]/.test(original) || original.length > 40) return {}
  const palavras = original.split(/\s+/).filter(Boolean)
  if (palavras.length > 3) return {}

  const s = normalizarTextoIntencao(original)
  if (
    !s ||
    /^(oi|ola|bom dia|boa tarde|boa noite|sim|nao|ok|blz|beleza)$/.test(s) ||
    /\b(tenho\s+interesse|quero\s+saber|me\s+interessa|preciso\s+de|procuro)\b/.test(s)
  ) return {}

  const temCidade = Boolean(perfil.cidade || perfil.cidade_base || perfil.regiao_atendimento)
  const temNegocio = Boolean(perfil.negocio || perfil.tipo_negocio)
  const temNecessidade = Boolean(perfil.servico_principal || perfil.servico_foco || perfil.necessidade)

  if (!temCidade && CIDADES_BR_COMUNS.has(s)) {
    return { cidade_base: original }
  }
  if (!temNecessidade && /\b(site|sistema|automacao|automatizacao|ia|agente de ia|integracao|landing|pagina)\b/.test(s)) {
    if (s.includes('site') || s.includes('landing') || s.includes('pagina')) return { necessidade: 'site' }
    if (s.includes('sistema')) return { necessidade: 'sistema' }
    if (s.includes('ia')) return { necessidade: NECESSIDADE_CANONICA.agente_ia }
    return { necessidade: NECESSIDADE_CANONICA.automacao }
  }
  if (!temNegocio && /^[\p{L}0-9\s&.'-]{2,40}$/u.test(original)) {
    return { negocio: original }
  }
  return {}
}

/**
 * Slot-filling decisao: dado o perfil (ja podendo conter dados extraidos), retorna a UNICA
 * pergunta basica que ainda falta. Se ja tiver os tres dados (negocio, cidade/regiao, necessidade),
 * retorna null — sinal para o bot avancar para reuniao.
 */
function obterProximaPergunta(perfil = {}) {
  perfil = adaptarPerfilLegadoParaFunil(perfil)
  const tc = perfil.tentativas_coleta || {}
  const negocio = perfil.negocio || perfil.tipo_negocio
  const cidade = perfil.cidade || perfil.cidade_base || perfil.regiao_atendimento
  const necessidade = perfil.servico_principal || perfil.servico_foco || perfil.necessidade
  if (!negocio && (tc.negocio || 0) < 2) return 'Só falta entender o tipo do seu negócio.'
  if (!cidade && (tc.cidade || 0) < 2) return 'Em qual cidade ou região você atende?'
  if (!necessidade && (tc.necessidade || 0) < 2) return 'Você procura site, sistema, automação, agente de IA ou uma solução sob medida?'
  return null
}

function proximoCampoParaColetar(perfil = {}) {
  perfil = adaptarPerfilLegadoParaFunil(perfil)
  const tc = perfil.tentativas_coleta || {}
  if (!(perfil.negocio || perfil.tipo_negocio) && (tc.negocio || 0) < 2) return 'negocio'
  if (!(perfil.cidade || perfil.cidade_base || perfil.regiao_atendimento) && (tc.cidade || 0) < 2) return 'cidade'
  if (!(perfil.servico_principal || perfil.servico_foco || perfil.necessidade) && (tc.necessidade || 0) < 2) return 'necessidade'
  return null
}

/**
 * Monta uma frase natural que reconhece o que ja foi informado e pergunta apenas o que falta.
 * Se nao falta nada, retorna mensagem de avanco para reuniao.
 */
function montarPerguntaFaltante(perfil = {}) {
  perfil = adaptarPerfilLegadoParaFunil(perfil)
  const pergunta = obterProximaPergunta(perfil)
  const negocio = perfil.negocio || perfil.tipo_negocio || null
  const cidade = perfil.cidade || perfil.cidade_base || null
  const regiaoBruta = perfil.regiao_atendimento || null
  const regiao = regiaoBruta &&
    normalizarTextoIntencao(regiaoBruta) !== normalizarTextoIntencao(cidade) &&
    !(cidade && normalizarTextoIntencao(regiaoBruta).startsWith(`${normalizarTextoIntencao(cidade)} com`))
    ? regiaoBruta
    : null
  const necessidade = perfil.servico_principal || perfil.servico_foco || perfil.necessidade || null

  const reconhecidosCurtos = []
  if (negocio) reconhecidosCurtos.push(`voce trabalha com ${negocio}`)
  if (cidade && regiao) reconhecidosCurtos.push(`atende em ${cidade} e ${regiao}`)
  else if (cidade) reconhecidosCurtos.push(`você está em ${cidade}`)
  else if (regiao) reconhecidosCurtos.push(`atende ${regiao}`)
  if (necessidade) reconhecidosCurtos.push(`procura ${necessidade}`)

  if (!pergunta) {
    const resumo = reconhecidosCurtos.length ? `Entendi: ${reconhecidosCurtos.join(', ')}. ` : ''
    return `${resumo}Com isso ja consigo te direcionar melhor.\n\nPosso verificar um horario para uma conversa rapida com a equipe?`
  }

  if (reconhecidosCurtos.length === 0) return pergunta
  return `Perfeito, entendi: ${reconhecidosCurtos.join(', ')}.\n\n${pergunta}`

  if (!pergunta) {
    const ramo = negocio ? `você trabalha com ${negocio}` : null
    const localizacao = cidade && regiao
      ? `está em ${cidade} e atende ${regiao}`
      : cidade ? `atende em ${cidade}` : (regiao ? `atende ${regiao}` : null)
    const servico = necessidade ? `procurando ${necessidade}` : null
    const partes = [ramo, localizacao, servico].filter(Boolean)
    const resumo = partes.length ? `Perfeito. Entendi que ${partes.join(', ')}. ` : 'Perfeito. '
    return `${resumo}A PJ Codeworks pode te ajudar a estruturar uma presença digital alinhada a isso. Posso verificar os próximos horários disponíveis para uma conversa rápida de até 15 minutos com a equipe?`
  }

  const reconhecidos = []
  if (negocio) reconhecidos.push(`você trabalha com ${negocio}`)
  if (cidade && regiao) reconhecidos.push(`está em ${cidade} e atende ${regiao}`)
  else if (cidade) reconhecidos.push(`está em ${cidade}`)
  else if (regiao) reconhecidos.push(`atende ${regiao}`)
  if (necessidade) reconhecidos.push(`procura ${necessidade}`)

  if (reconhecidos.length === 0) {
    return `Pra te direcionar melhor: ${pergunta.charAt(0).toLowerCase() + pergunta.slice(1)}`
  }
  return `Perfeito, entendi: ${reconhecidos.join(', ')}. Só falta um detalhe para eu te direcionar melhor. ${pergunta}`
}

function ehProjetoSobMedida(perfil = {}, texto = '', estagio = '') {
  const s = normalizarTextoIntencao([
    texto,
    estagio,
    perfil?.plano,
    perfil?.plano_sugerido,
    perfil?.produto_sugerido,
    perfil?.tipo_projeto,
    perfil?.servico_principal,
    perfil?.servico_foco,
    perfil?.necessidade,
    perfil?.objetivo,
  ].filter(Boolean).join(' '))
  const rp = perfil && typeof perfil.reuniao_proposta === 'object' ? perfil.reuniao_proposta : {}
  return Boolean(
    perfil?.projeto_sob_medida === true ||
    perfil?.sob_medida === true ||
    perfil?.precisa_sistema === true ||
    rp?.necessaria === true ||
    /\b(personalizado|personalizada|sob\s*medida|projeto_sob_medida|site|site\s+personalizado|sistema|automacao|automatizacao|agente\s+de\s+ia|ia|painel|dashboard|integracao|escopo|proposta\s+personalizada)\b/.test(s)
  )
}

function ultimoTextoAssistente(historico) {
  const msgs = Array.isArray(historico) ? historico : []
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]
    if (m?.role !== 'assistant') continue
    const texto = typeof m.content === 'string' ? m.content : textoDeContent(m.content)
    if (texto && texto.trim()) return texto.trim()
  }
  return ''
}

/**
 * Extrai a ultima pergunta (frase terminada em "?") da ultima mensagem do bot.
 * Se nao houver "?", retorna a ultima frase nao-vazia. Util para
 * reexplicar quando o lead diz "Nao entendi?".
 */
function ultimaPerguntaDoAssistente(historico) {
  const last = ultimoTextoAssistente(historico)
  if (!last) return ''
  // Captura todas as perguntas (texto ate um "?") e pega a ultima
  const matches = last.match(/[^?.!]*\?/g)
  if (matches && matches.length > 0) {
    return matches[matches.length - 1].trim()
  }
  // Sem "?", pega a ultima frase
  const sentencas = last.split(/(?<=[.!])\s+/).map((s) => s.trim()).filter(Boolean)
  return sentencas[sentencas.length - 1] || ''
}

/**
 * Detecta se a ultima mensagem do bot ofereceu horarios concretos (HH:MM ou HHh MM).
 * Devolve array de horarios oferecidos ou null. Usado para reconhecer escolha_horario
 * mesmo quando o perfil.reuniao_proposta.horarios_sugeridos nao foi persistido a tempo
 * (race entre turnos).
 */
function historicoOfereceuHorarios(historico) {
  const last = ultimoTextoAssistente(historico)
  if (!last) return null
  const matches = last.match(/\b(\d{1,2})\s*[h:]\s*(\d{2})\b/g) || []
  if (matches.length === 0) return null
  return matches.map((m) => {
    const mm = m.match(/(\d{1,2})\s*[h:]\s*(\d{2})/)
    if (!mm) return null
    const h = String(parseInt(mm[1], 10)).padStart(2, '0')
    return `${h}:${mm[2]}`
  }).filter(Boolean)
}

function ultimaMensagemPerguntouTemSite(historico = []) {
  const last = normalizarTextoIntencao(ultimoTextoAssistente(historico))
  return /\b(ja\s+tem\s+algum\s+site|tem\s+site|seria\s+o\s+primeiro|primeiro\s+site)\b/.test(last)
}

function ultimaMensagemConvidouVerificarHorario(historico = []) {
  const last = normalizarTextoIntencao(ultimoTextoAssistente(historico))
  if (!last) return false
  return /\b(posso|podemos)\s+(verificar|marcar|agendar|olhar|consultar)\b/.test(last) &&
    /\b(horario|agenda|conversa\s+rapida|reuniao|equipe)\b/.test(last)
}

function textoAceitaConviteReuniao(texto = '') {
  const s = normalizarTextoIntencao(texto)
  if (!s || /\b(nao|nunca|talvez|depois|agora\s+nao|sem\s+interesse)\b/.test(s)) return false
  return /^(sim|claro|pode|pode\s+sim|pode\s+ser|beleza|blz|ok|okay|ta\s+bom|tudo\s+bem|perfeito|show|manda|verifica|verifica\s+sim|vamos|bora|aceito)$/.test(s)
}

function interpretarRespostaContextualUltimaPergunta({ texto = '', historico = [] } = {}) {
  if (ultimaMensagemConvidouVerificarHorario(historico) && textoAceitaConviteReuniao(texto)) {
    return {
      tipo: 'aceite_reuniao',
      aceitou: true,
      dados_extraidos: { aceitou_verificar_horario: true },
    }
  }
  if (ultimaMensagemPerguntouTemSite(historico)) {
    const temSite = normalizarBooleanResposta(texto)
    if (temSite !== null) {
      return {
        tipo: 'tem_site',
        tem_site: temSite,
        dados_extraidos: { tem_site: temSite },
      }
    }
  }
  return null
}

function extrairHorariosOferecidos(perfil = {}) {
  const rp = perfil && typeof perfil.reuniao_proposta === 'object' ? perfil.reuniao_proposta : null
  const hs = Array.isArray(rp?.horarios_sugeridos) ? rp.horarios_sugeridos : []
  return hs.map((h) => String(h || '').trim()).filter(Boolean)
}

function montarEstadoComercialLead({ perfil = {}, estagio = 'novo' } = {}) {
  const rp = perfil && typeof perfil.reuniao_proposta === 'object' ? perfil.reuniao_proposta : {}
  const statusAgenda = rp?.horario_confirmado
    ? 'reuniao_agendada'
    : (rp?.necessaria || extrairHorariosOferecidos(perfil).length ? 'agendamento_pendente' : 'nao_agendado')
  return {
    estagio_funil: estagio || 'novo',
    temperatura: perfil.temperatura_lead || perfil.temperatura || 'morno',
    dados_obrigatorios: {
      nicho: Boolean(perfil.negocio),
      cidade: Boolean(perfil.cidade),
      servico_principal: Boolean(perfil.servico_principal || perfil.servico_foco || perfil.dor_principal),
      ticket: Boolean(perfil.ticket_cliente_final || perfil.ticket_medio),
      email: Boolean(perfil.email),
    },
    agendamento: {
      status: statusAgenda,
      horarios_oferecidos: extrairHorariosOferecidos(perfil),
      horario_escolhido: rp?.horario_confirmado || null,
    },
  }
}

/**
 * Combina a classificação IA com a extração estrutural (regex).
 * A IA decide a intenção principal; dados_extraidos, horário e slot_filling vêm do código.
 * Se a IA falhar, usa o fallback regex.
 */
async function interpretarIntencaoMensagemComIA(ctx = {}) {
  const base = interpretarIntencaoMensagem(ctx)
  // Reusa a analise do classificador quando o caller ja a computou neste turno
  // (core-funnel chama o classificador 1x e alimenta o orquestrador novo + este
  // caminho legado), evitando uma segunda chamada Haiku identica por turno.
  const analiseIA = Object.prototype.hasOwnProperty.call(ctx, 'analiseIAPrecomputada')
    ? ctx.analiseIAPrecomputada
    : await interpretarIntencaoMensagemIA(ctx)
  if (!analiseIA) return base
  const intencaoRecebida = typeof analiseIA === 'string' ? analiseIA : analiseIA.intencao
  const conviteHorarioNoHistorico = ultimaMensagemConvidouVerificarHorario(ctx.historico || [])
  const intencaoRecebidaSegura =
    intencaoRecebida === 'aceite_convite_reuniao' && !conviteHorarioNoHistorico
      ? base.intencao_principal
      : intencaoRecebida
  const intencaoIA = intencaoRecebidaSegura === 'sem_clareza' && base.intencao_principal !== 'sem_clareza'
    ? base.intencao_principal
    : intencaoRecebidaSegura
  if (!INTENCOES_VALIDAS.has(intencaoIA)) return base
  const dadosIA = typeof analiseIA === 'object' ? normalizarDadosExtraidosIA(analiseIA.dados_extraidos || {}) : {}
  const respostaContextualRecebida = typeof analiseIA === 'object'
    ? normalizarRespostaContextualIA(analiseIA.resposta_contextual || null)
    : null
  const respostaContextualIA =
    (respostaContextualRecebida?.tipo === 'aceite_reuniao' && !conviteHorarioNoHistorico) ||
    (respostaContextualRecebida?.tipo === 'tem_site' && !ultimaMensagemPerguntouTemSite(ctx.historico || []))
      ? null
      : respostaContextualRecebida
  const slotBase = base.dados_extraidos?._slot_filling || {}
  const slotFilling = { ...slotBase, ...dadosIA }
  const perguntaDireta = ['pedido_humano', 'duvida_nao_entendi', 'ambiguous_site_sales',
    'pergunta_preco_anuncio', 'pergunta_preco', 'pergunta_como_funciona', 'pedido_reagendamento'].includes(intencaoIA)
  return {
    ...base,
    intencao_principal: intencaoIA,
    resposta_contextual: respostaContextualIA || base.resposta_contextual || null,
    dados_extraidos: {
      ...base.dados_extraidos,
      nicho: dadosIA.negocio || normalizarNegocioLead(base.dados_extraidos?.nicho) || null,
      cidade: dadosIA.cidade_base || base.dados_extraidos?.cidade || null,
      regiao_atendimento: dadosIA.regiao_atendimento || base.dados_extraidos?.regiao_atendimento || null,
      servico_principal:
        dadosIA.necessidade || base.dados_extraidos?.servico_principal || null,
      tem_site: Object.prototype.hasOwnProperty.call(dadosIA, 'tem_site')
        ? dadosIA.tem_site
        : base.dados_extraidos?.tem_site,
      objetivo_site: dadosIA.objetivo_site || base.dados_extraidos?.objetivo_site || null,
      origem_clientes: dadosIA.origem_clientes || base.dados_extraidos?.origem_clientes || null,
      aceitou_verificar_horario:
        (respostaContextualIA?.tipo === 'aceite_reuniao' && respostaContextualIA.aceitou === true) ||
        base.dados_extraidos?.aceitou_verificar_horario === true,
      _slot_filling: slotFilling,
    },
    pergunta_direta: perguntaDireta,
    deve_responder_antes_de_avancar: perguntaDireta || ['escolha_horario', 'pedido_reagendamento', 'duvida_nao_entendi', 'aceite_convite_reuniao'].includes(intencaoIA),
    confianca: 0.92,
    _via_ia: true,
  }
}

function interpretarIntencaoMensagem({ texto = '', perfil = {}, estagio = 'novo', historico = [] } = {}) {
  const raw = String(texto || '').trim()
  const horario = parsearHorarioReuniao(raw)
  const estado = montarEstadoComercialLead({ perfil, estagio })
  const dadosExtraidos = extrairDadosLeadDoTexto(raw)
  const respostaContextual = interpretarRespostaContextualUltimaPergunta({ texto: raw, perfil, historico })
  const dadosContextuais = respostaContextual?.dados_extraidos || {}
  const temAlgumDado = Boolean(
    dadosExtraidos.negocio || dadosExtraidos.cidade_base || dadosExtraidos.regiao_atendimento ||
    dadosExtraidos.necessidade || Object.keys(dadosContextuais).length > 0
  )
  // Detecta horarios oferecidos no historico (fallback quando o perfil ainda nao foi
  // atualizado com reuniao_proposta.horarios_sugeridos). Mais robusto: olha o que o bot
  // realmente DISSE no ultimo turno.
  const horariosNoHistorico = historicoOfereceuHorarios(historico)
  const horarioNormalizado = horario
    ? `${String(horario.hora).padStart(2, '0')}:${String(horario.min).padStart(2, '0')}`
    : null
  const horarioBateComHistorico = Boolean(
    horarioNormalizado && Array.isArray(horariosNoHistorico) && horariosNoHistorico.some((h) => h === horarioNormalizado)
  )
  const intencoes = []
  let principal = 'sem_clareza'
  let perguntaDireta = false
  // PRIORIDADE 1: pedido humano (seguranca)
  if (textoPedidoHumano(raw)) {
    principal = 'pedido_humano'
    perguntaDireta = true
  }
  // PRIORIDADE 2: duvida do lead ("Nao entendi?") — NUNCA tratar como pergunta_preco
  // ou avanco para reuniao. O bot deve REEXPLICAR a ultima pergunta.
  else if (textoExpressaDuvida(raw)) {
    principal = 'duvida_nao_entendi'
    perguntaDireta = true
  }
  // PRIORIDADE 3: escolha de horario — se o bot acabou de oferecer horarios E o lead
  // escolheu um deles, isso supera qualquer outra intencao (inclusive pergunta_preco).
  else if (horario && (estado.agendamento.status === 'agendamento_pendente' || horarioBateComHistorico)) {
    principal = 'escolha_horario'
  }
  else if (respostaContextual?.tipo === 'aceite_reuniao') {
    principal = 'aceite_convite_reuniao'
  }
  else if (textoQuerVenderSites(raw)) {
    principal = 'ambiguous_site_sales'
    perguntaDireta = true
  }
  else if (textoConfundePrecoAnuncio(raw)) {
    principal = 'pergunta_preco_anuncio'
    perguntaDireta = true
  }
  else if (textoPedePreco(raw)) {
    principal = 'pergunta_preco'
    perguntaDireta = true
  } else if (textoQuerComprarSite(raw) && !dadosExtraidos.negocio && !dadosExtraidos.cidade_base && !perfil.negocio && !perfil.cidade) {
    principal = 'compra_site'
  } else if (textoPerguntaComoFunciona(raw)) {
    principal = 'pergunta_como_funciona'
    perguntaDireta = true
  } else if (textoPedidoReagendamento(raw)) {
    principal = 'pedido_reagendamento'
    perguntaDireta = true
  } else if (textoDemonstraIntencao(raw)) {
    principal = 'interesse_inicial'
  } else if (textoEnviaDadosNegocio(raw) || temAlgumDado) {
    principal = 'envio_dados_negocio'
  }
  if (textoPedePreco(raw) && principal !== 'pergunta_preco') intencoes.push('pergunta_preco')
  if (textoDemonstraIntencao(raw) && principal !== 'interesse_inicial') intencoes.push('interesse_inicial')
  if ((textoEnviaDadosNegocio(raw) || temAlgumDado) && principal !== 'envio_dados_negocio') intencoes.push('envio_dados_negocio')
  return {
    intencao_principal: principal,
    intencoes_secundarias: intencoes,
    pergunta_direta: perguntaDireta,
    dados_extraidos: {
      nicho: dadosExtraidos.negocio || perfil.negocio || null,
      cidade: dadosExtraidos.cidade_base || perfil.cidade || null,
      regiao_atendimento: dadosExtraidos.regiao_atendimento || perfil.regiao_atendimento || null,
      servico_principal:
        dadosExtraidos.necessidade || perfil.servico_principal || perfil.servico_foco || perfil.necessidade || null,
      horario: horarioNormalizado,
      horarios_no_historico: horariosNoHistorico || null,
      tem_site: Object.prototype.hasOwnProperty.call(dadosContextuais, 'tem_site')
        ? dadosContextuais.tem_site
        : null,
      aceitou_verificar_horario: dadosContextuais.aceitou_verificar_horario === true,
      _slot_filling: { ...dadosExtraidos, ...dadosContextuais },
    },
    resposta_contextual: respostaContextual,
    deve_responder_antes_de_avancar:
      perguntaDireta || ['escolha_horario', 'pedido_reagendamento', 'duvida_nao_entendi', 'aceite_convite_reuniao'].includes(principal),
    confianca: principal === 'sem_clareza' ? 0.45 : 0.9,
  }
}

function textoFaixaPrecoInicial() {
  return [
    'Como depende da estrutura, a equipe confirma o valor certo na reuniao.',
    'E uma conversa rapida, de ate 15 minutos, para te mostrar estrutura, prazo e investimento.',
    'Posso verificar um horario disponivel?',
  ].join('\n\n')

  return [
    'Os valores dependem do tipo de estrutura.',
    'Sites mais simples costumam ter um investimento inicial menor, enquanto projetos com sistema, automação ou estrutura personalizada variam conforme o escopo.',
    'Na reunião, a equipe da PJ Codeworks te passa o valor certo, já com prazo e formato de pagamento.',
    'Pra eu te orientar sem chute: qual é o seu negócio e em qual cidade você atende?',
  ].join('\n\n')
}

function textoPrecoProjetoSobMedidaBase() {
  return [
    'Como depende da estrutura do site, a equipe confirma o valor certo na reuniao.',
    'E uma conversa rapida, de ate 15 minutos, para te mostrar estrutura, prazo e investimento.',
    'Posso verificar um horario disponivel?',
  ].join('\n\n')

  return [
    'Boa pergunta. Como é um projeto sob medida, eu não consigo te passar um valor certo sem entender a estrutura necessária.',
    'A equipe da PJ Codeworks avalia o escopo e te mostra o melhor formato, prazo e investimento na reunião.',
    'Posso marcar uma conversa rápida de até 15 minutos com a equipe?',
  ].join('\n\n')
}

function textoPrecoCalculado(perfil = {}) {
  const total = Number(perfil.preco_calculado || perfil.total || 0)
  const entrada = Number(perfil.entrada || 0)
  const parcela = Number(perfil.parcela || 0)
  if (total > 0) {
    const parcelamento = entrada > 0 && parcela > 0 ? `, com entrada de R$ ${entrada} + 3x de R$ ${parcela}` : ''
    return `Com base no que você me passou, a estimativa inicial fica em torno de R$ ${total}${parcelamento}.\n\nIsso inclui a estrutura do site, organização dos serviços, chamada para WhatsApp e base para presença no Google. Na reunião, a equipe da PJ Codeworks confirma o valor final conforme o escopo.`
  }
  return textoFaixaPrecoInicial()
}

function textoComoFunciona(perfil = {}) {
  const p = adaptarPerfilLegadoParaFunil(perfil)
  const negocio = p.negocio || p.tipo_negocio || ''
  const cidade = p.cidade || p.cidade_base || p.regiao_atendimento || ''
  const necessidade = normalizarNecessidadeLead(p.servico_principal || p.servico_foco || p.necessidade)
  const pergunta = obterProximaPergunta(p)
  const contexto = negocio && cidade
    ? `Para ${negocio} em ${cidade}, `
    : negocio ? `Para ${negocio}, ` : ''
  const foco = necessidade === 'site'
    ? `${contexto}a PJ Codeworks entende o objetivo, monta a estrutura do site e alinha com a equipe prazo e investimento.`
    : `${contexto}a PJ Codeworks entende o que sua empresa precisa e indica se faz mais sentido site, sistema, automacao, IA ou uma solucao sob medida.`

  if (pergunta) return `${foco}\n\n${pergunta}`
  return `${foco}\n\nPosso verificar um horario rapido com a equipe para alinhar o melhor caminho?`
}

function textoInteresseClaro(perfil = {}) {
  const problema = perfil.dor_principal || perfil.negocio || 'sua operação'
  return `Perfeito, vou te explicar de forma simples o próximo passo.\n\nO ponto é transformar ${problema} em uma estrutura clara: apresentação profissional, chamada para WhatsApp e um caminho simples para o cliente entender e pedir orçamento. O próximo passo é confirmar negócio, cidade e serviço principal pra te orientar no melhor formato.`
}


function textoInteresseClaroSimples(perfil = {}) {
  const abertura = 'Oi! Tudo bem? Aqui é o assistente da PJ Codeworks 👋'
  return `${abertura}\n\n${montarPerguntaFaltante(perfil)}`

  const contexto = perfil.negocio ? ` para ${perfil.negocio}` : ''
  return `Perfeito, vou te explicar de forma simples o próximo passo.\n\nA PJ Codeworks cria soluções em código${contexto}: sites, sistemas, automações, agentes de IA e integrações para organizar presença digital, atendimento, vendas e operação.\n\nPra eu direcionar certo: qual é sua cidade ou região e você procura site, sistema, automação, agente de IA ou uma solução sob medida?`
}

function temAssistenteNoHistorico(historico = []) {
  return historico.some((m) => m && m.role === 'assistant')
}

/**
 * Gera resposta para o caso "Nao entendi?". Reexplica a ultima pergunta do bot
 * com linguagem simples, sem avancar o fluxo. Se ja tiver dados suficientes,
 * sugere conversa com a equipe; caso contrario, pergunta apenas o dado faltante.
 *
 * NUNCA gera frases proibidas (proposta personalizada, ticket alto, etc.).
 */
function textoExplicacaoUltimaPergunta(perfil = {}, historico = []) {
  const pergunta = ultimaPerguntaDoAssistente(historico)
  const proxima = obterProximaPergunta(perfil)
  const introExplicacao = pergunta
    ? `Sem problema, deixa eu explicar de forma mais simples. Eu estava perguntando sobre: ${pergunta.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\?+$/g, '')}.`
    : 'Sem problema, deixa eu explicar de forma mais simples.'

  if (!proxima) {
    return `${introExplicacao}\n\nMas não precisa responder isso agora. A PJ Codeworks pode te ajudar com uma estrutura digital para apresentar seus serviços e organizar o contato com os clientes. Posso verificar os próximos horários disponíveis para uma conversa rápida de até 15 minutos com a equipe?`
  }
  return `${introExplicacao}\n\nMas podemos seguir de forma simples — ${proxima.charAt(0).toLowerCase() + proxima.slice(1)}`
}

const {
  sanitizarFrasesProibidasDaResposta,
} = require('./institutional-language')

function textoNecessidadeAmpla(perfil = {}) {
  // Pergunta APENAS o que falta, reconhecendo o que ja foi informado.
  return montarPerguntaFaltante(perfil)
}

function similaridadeTexto(a, b) {
  const tokens = (txt) => new Set(normalizarTextoIntencao(txt).split(/\W+/).filter((x) => x.length > 2))
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  return inter / Math.max(A.size, B.size)
}

function aplicarAntiLoopResposta(texto, historico = [], perfil = null) {
  const last = ultimoTextoAssistente(historico)
  if (!last || similaridadeTexto(texto, last) < 0.78) return texto
  // Detectou loop: nao expor "vou reformular" ao lead. Em vez disso,
  // reescreve com base no perfil enriquecido — pergunta apenas o que falta
  // ou avanca para reuniao se ja tiver dados suficientes.
  if (perfil && typeof perfil === 'object') {
    return montarPerguntaFaltante(perfil)
  }
  // Fallback: sem perfil disponivel, evita texto identico mas mantem semantica.
  return texto
}

async function decidirProximaResposta(contexto = {}) {
  contexto = normalizarContextoDecisao(contexto)
  const texto = contexto.texto || ''
  const perfilBase = adaptarPerfilLegadoParaFunil(contexto.perfil || {})
  const estagio = contexto.estagio || 'novo'
  const historico = Array.isArray(contexto.historico) ? contexto.historico : []
  const patchHistorico = patchPerfilComDadosHistorico(perfilBase, historico)
  const perfil = { ...perfilBase, ...patchHistorico }
  const interpretacao = await interpretarIntencaoMensagemComIA({
    texto,
    perfil,
    estagio,
    historico,
    ...(Object.prototype.hasOwnProperty.call(contexto, 'analiseIAPrecomputada')
      ? { analiseIAPrecomputada: contexto.analiseIAPrecomputada }
      : {}),
  })
  const slotDetectado = interpretacao.dados_extraidos?._slot_filling || {}
  const slotCurto = extrairDadoCurtoPorSlot(texto, perfil)
  const slot = { ...slotDetectado, ...slotCurto }

  // Enriquece o perfil com dados recem-extraidos da mensagem atual (sem mutar).
  // Isso evita que o bot repita pergunta sobre dado que o lead acabou de informar.
  const patchSlotFilling = { ...patchHistorico }
  if (slot.negocio && !perfil.negocio) patchSlotFilling.negocio = slot.negocio
  if (slot.cidade_base && !perfil.cidade) patchSlotFilling.cidade = slot.cidade_base
  if (slot.regiao_atendimento && !perfil.regiao_atendimento) patchSlotFilling.regiao_atendimento = slot.regiao_atendimento
  if (slot.necessidade && !perfil.servico_principal && !perfil.servico_foco && !perfil.necessidade) {
    patchSlotFilling.servico_principal = slot.necessidade
    patchSlotFilling.necessidade = slot.necessidade
  }
  if (Object.prototype.hasOwnProperty.call(slot, 'tem_site') && perfil.tem_site == null) {
    patchSlotFilling.tem_site = slot.tem_site
  }
  if (slot.objetivo_site && !perfil.objetivo_site) patchSlotFilling.objetivo_site = slot.objetivo_site
  if (slot.origem_clientes && !perfil.origem_clientes) patchSlotFilling.origem_clientes = slot.origem_clientes
  const perfilEnriquecido = { ...perfil, ...patchSlotFilling }
  const estado = montarEstadoComercialLead({ perfil: perfilEnriquecido, estagio })
  const podeAgendarDireto = deveOferecerReuniaoDireta({ texto, perfil: perfilEnriquecido, estagio, interpretacao, slot })
  const aceitouConviteReuniao =
    interpretacao.intencao_principal === 'aceite_convite_reuniao' ||
    interpretacao.resposta_contextual?.tipo === 'aceite_reuniao' ||
    interpretacao.dados_extraidos?.aceitou_verificar_horario === true
  const conexaoValorJaRealizada =
    perfilEnriquecido.eventos_conversa?.conexao_valor_realizada === true ||
    ultimaMensagemPerguntouTemSite(historico)
  const base = {
    interpretacao,
    estado_comercial: estado,
    prioridade_aplicada: null,
    proxima_acao: 'avanco_comercial',
    deve_sobrescrever_modelo: false,
    resultado: null,
  }
  const mk = (proxima_acao, mensagem, extras = {}) => ({
    ...base,
    prioridade_aplicada: extras.prioridade || 'pergunta_direta',
    proxima_acao,
    deve_sobrescrever_modelo: true,
    resultado: {
      mensagem_pro_lead: sanitizarFrasesProibidasDaResposta(aplicarAntiLoopResposta(mensagem, historico, perfilEnriquecido)),
      mensagens_bolhas: Array.isArray(extras.mensagens_bolhas) ? extras.mensagens_bolhas : null,
      atualizar_perfil: {
        ...patchSlotFilling,
        ...(extras.atualizar_perfil || {}),
        intencao_principal: interpretacao.intencao_principal,
        estado_comercial: estado,
      },
      etapa_proxima: extras.etapa_proxima || estagio,
      solicitar_calculo_preco: extras.solicitar_calculo_preco === true,
      handoff: extras.handoff === true,
      motivo_handoff: extras.motivo_handoff || null,
      links_sugeridos: [],
    },
  })
  const saudacaoInicial = /^(oi|ola|olá|bom\s+dia|boa\s+tarde|boa\s+noite|opa)[!?.\s]*$/i.test(String(texto || '').trim())
  if (saudacaoInicial && !temAssistenteNoHistorico(historico)) {
    const bolhasAbertura = [
      'Oi! Sou o assistente virtual da PJ Codeworks. Pra te direcionar certo, qual é o seu negócio e em qual cidade você atende?',
    ]
    return mk(
      'coletar_tipo_negocio',
      bolhasAbertura.join('\n\n'),
      {
        prioridade: 'abertura_curta',
        etapa_proxima: 'diagnostico',
        mensagens_bolhas: bolhasAbertura,
      }
    )
  }
  // PRIORIDADE: pedido humano (seguranca)
  if (interpretacao.intencao_principal === 'pedido_humano') {
    return mk('encaminhar_humano', 'Claro. Vou chamar a equipe da PJ Codeworks pra te ajudar diretamente por aqui.', {
      prioridade: 'seguranca_pedido_humano',
      handoff: true,
      motivo_handoff: 'lead_pediu_humano',
    })
  }
  if (aceitouConviteReuniao) {
    return {
      ...base,
      prioridade_aplicada: 'aceite_convite_reuniao',
      proxima_acao: 'consultar_agenda_e_oferecer_horarios',
      deve_sobrescrever_modelo: true,
    }
  }
  // PRIORIDADE: "Nao entendi?" — IA reexplica a ultima pergunta com tom natural.
  if (interpretacao.intencao_principal === 'duvida_nao_entendi') {
    return {
      ...base,
      prioridade_aplicada: 'esclarecer_pergunta_anterior',
      proxima_acao: 'reexplicar',
      deve_sobrescrever_modelo: false,
      resultado: null,
      _flags_extras: {
        proxima_acao_hint: 'reexplicar',
        ultima_pergunta: ultimaPerguntaDoAssistente(historico) || '',
        etapa_proxima: estagio || 'diagnostico',
      },
    }
  }
  // PRIORIDADE: escolha de horario — sobrepoe qualquer outra intencao quando o bot
  // acabou de oferecer horarios. Evita que o LLM volte para "proposta personalizada".
  if (interpretacao.intencao_principal === 'escolha_horario') {
    const parsedHorario = typeof parsearHorarioReuniao === 'function' ? parsearHorarioReuniao(texto || '') : null
    return {
      ...base,
      prioridade_aplicada: 'agenda_confirmacao',
      proxima_acao: 'confirmar_reuniao',
      deve_sobrescrever_modelo: false,
      _flags_extras: {
        proxima_acao_hint: 'confirmar_reuniao',
        horario_extraido: parsedHorario?.normalizado || '',
      },
    }
  }
  if (interpretacao.intencao_principal === 'ambiguous_site_sales') {
    return mk(
      'clarificar_intencao_vender_site',
      'Perfeito. Só pra eu entender certo: você quer um site para vender mais no seu negócio ou quer trabalhar vendendo sites?',
      {
        prioridade: 'ambiguous_site_sales',
        etapa_proxima: 'diagnostico',
        atualizar_perfil: { intencao_principal: 'ambiguous_site_sales' },
      }
    )
  }
  if (interpretacao.intencao_principal === 'pergunta_preco_anuncio') {
    return mk(
      'explicar_diferenca_site_anuncio_google',
      'Anúncio é mídia paga; site ou página é a estrutura para receber o cliente, e Google envolve presença/SEO local.\n\nVocê quer atrair clientes para qual tipo de negócio?',
      {
        prioridade: 'confusao_preco_anuncio',
        etapa_proxima: 'diagnostico',
        atualizar_perfil: { confusao_site_anuncio_google: true },
      }
    )
  }
  if (interpretacao.intencao_principal === 'pergunta_preco') {
    if (ehProjetoSobMedida(perfil, texto, estagio)) {
      return {
        ...base,
        prioridade_aplicada: 'pergunta_preco_projeto_sob_medida',
        proxima_acao: 'consultar_agenda_e_oferecer_horarios',
        deve_sobrescrever_modelo: true,
      }
    }
    return {
      ...base,
      prioridade_aplicada: 'pergunta_preco',
      proxima_acao: perfil.preco_calculado ? 'responder_preco' : 'responder_preco_e_coletar_contexto',
      deve_sobrescrever_modelo: false,
      resultado: null,
      _flags_extras: {
        proxima_acao_hint: 'responder_preco',
        etapa_proxima: perfil.preco_calculado ? 'proposta' : 'diagnostico',
        atualizar_perfil: { eventos_conversa: { perguntou_preco: true } },
      },
    }
  }
  if (interpretacao.intencao_principal === 'compra_site') {
    return mk('qualificar_compra_site', 'Perfeito, a PJ Codeworks pode te ajudar com um site profissional.\n\nQual é o tipo do seu negócio e em qual cidade você atende?', {
      prioridade: 'compra_site',
      etapa_proxima: 'diagnostico',
      atualizar_perfil: {
        temperatura_lead: perfil.temperatura_lead || 'morno',
        intencao_principal: 'compra_site',
        servico_principal: 'site',
        necessidade: 'site',
      },
    })
  }
  if (interpretacao.intencao_principal === 'pergunta_como_funciona') {
    return mk('explicar_solucao', textoComoFunciona(perfilEnriquecido), { etapa_proxima: estagio || 'diagnostico' })
  }
  if (interpretacao.intencao_principal === 'pedido_reagendamento') {
    return { ...base, prioridade_aplicada: 'agenda_reagendamento', proxima_acao: 'reagendar', deve_sobrescrever_modelo: true }
  }
  if (
    interpretacao.intencao_principal === 'envio_dados_negocio' &&
    slot.negocio &&
    (slot.cidade_base || slot.regiao_atendimento) &&
    !slot.necessidade &&
    !perfil.servico_principal &&
    !perfil.servico_foco &&
    !perfil.necessidade
  ) {
    const local = slot.cidade_base || slot.regiao_atendimento
    const negocioLabel = slot.negocio.charAt(0).toUpperCase() + slot.negocio.slice(1)
    return mk(
      'aprofundar_canal_aquisicao',
      `Boa. ${negocioLabel} em ${local} faz sentido para uma estrutura bem direta: serviços, confiança e botão para WhatsApp.\n\nHoje seus clientes chegam mais por indicação, Instagram ou Google?`,
      {
        prioridade: 'qualificacao_nicho_cidade_sem_repetir',
        etapa_proxima: 'diagnostico',
      }
    )
  }
  const recebeuDadosBasicos =
    interpretacao.intencao_principal === 'envio_dados_negocio' ||
    (Array.isArray(interpretacao.intencoes_secundarias) && interpretacao.intencoes_secundarias.includes('envio_dados_negocio')) ||
    Boolean(slot.negocio || slot.cidade_base || slot.regiao_atendimento || slot.necessidade)
  if (
    recebeuDadosBasicos &&
    !(estado.dados_obrigatorios.nicho && estado.dados_obrigatorios.cidade && estado.dados_obrigatorios.servico_principal)
  ) {
    const campoAtual = proximoCampoParaColetar(perfilEnriquecido)
    if (campoAtual) {
      const tc = perfilEnriquecido.tentativas_coleta || {}
      return mk('coletar_dado_faltante', montarPerguntaFaltante(perfilEnriquecido), {
        prioridade: 'slot_filling_pergunta_unica',
        etapa_proxima: 'diagnostico',
        atualizar_perfil: {
          tentativas_coleta: { ...tc, [campoAtual]: (tc[campoAtual] || 0) + 1 },
        },
      })
    }
    // Todos os campos coletados ou com tentativas esgotadas — avança para IA/reunião
  }
  if (slot.necessidade && estado.dados_obrigatorios.nicho && estado.dados_obrigatorios.cidade && estado.dados_obrigatorios.servico_principal) {
    if (podeAgendarDireto) {
      return { ...base, prioridade_aplicada: 'gatilho_reuniao_direto', proxima_acao: 'consultar_agenda_e_oferecer_horarios', deve_sobrescrever_modelo: true }
    }
    if (conexaoValorJaRealizada) {
      return mk('convite_reuniao', montarPerguntaFaltante(perfilEnriquecido), {
        prioridade: 'conexao_valor_ja_realizada',
        etapa_proxima: 'conexao_valor',
      })
    }
    return mk('conexao_valor', textoConexaoValor(perfilEnriquecido), {
      prioridade: 'conexao_valor_antes_reuniao',
      etapa_proxima: 'conexao_valor',
      atualizar_perfil: { eventos_conversa: { conexao_valor_realizada: true } },
    })
  }
  if (
    interpretacao.intencao_principal === 'envio_dados_negocio' &&
    slot.negocio &&
    (slot.cidade_base || slot.regiao_atendimento) &&
    (perfil.servico_principal || perfil.servico_foco || perfil.necessidade)
  ) {
    if (conexaoValorJaRealizada) {
      return mk(
        'convite_reuniao',
        montarPerguntaFaltante(perfilEnriquecido),
        {
          prioridade: 'conexao_valor_ja_realizada',
          etapa_proxima: 'conexao_valor',
        }
      )
    }
    return mk(
      'conexao_valor',
      textoConexaoValor(perfilEnriquecido),
      {
        prioridade: 'conexao_valor_antes_reuniao',
        etapa_proxima: 'conexao_valor',
        atualizar_perfil: { eventos_conversa: { conexao_valor_realizada: true } },
      }
    )
  }
  if (estado.dados_obrigatorios.nicho && estado.dados_obrigatorios.cidade && estado.dados_obrigatorios.servico_principal) {
    if (podeAgendarDireto) {
      return { ...base, prioridade_aplicada: 'gatilho_reuniao_direto', proxima_acao: 'consultar_agenda_e_oferecer_horarios', deve_sobrescrever_modelo: true }
    }
    if (conexaoValorJaRealizada) {
      return mk('convite_reuniao', montarPerguntaFaltante(perfilEnriquecido), {
        prioridade: 'conexao_valor_ja_realizada',
        etapa_proxima: 'conexao_valor',
      })
    }
    return mk('conexao_valor', textoConexaoValor(perfilEnriquecido), {
      prioridade: 'conexao_valor_antes_reuniao',
      etapa_proxima: 'conexao_valor',
      atualizar_perfil: { eventos_conversa: { conexao_valor_realizada: true } },
    })
  }
  if (interpretacao.intencao_principal === 'interesse_inicial') {
    return mk('explicar_solucao', textoInteresseClaroSimples(perfilEnriquecido), {
      etapa_proxima: 'proposta',
      atualizar_perfil: { temperatura_lead: perfil.temperatura_lead || 'morno' },
    })
  }
  if (interpretacao.intencao_principal === 'compra_site') {
    return mk('qualificar_compra_site', 'Perfeito, a PJ Codeworks pode te ajudar com um site profissional.\n\nQual é o tipo do seu negócio e em qual cidade você atende?', {
      prioridade: 'compra_site',
      etapa_proxima: 'diagnostico',
      atualizar_perfil: {
        temperatura_lead: perfil.temperatura_lead || 'morno',
        intencao_principal: 'compra_site',
        servico_principal: 'site',
        necessidade: 'site',
      },
    })
  }
  if (interpretacao.intencao_principal === 'envio_dados_negocio' || Object.keys(patchSlotFilling).length > 0) {
    const campoAtual2 = proximoCampoParaColetar(perfilEnriquecido)
    if (campoAtual2) {
      const tc2 = perfilEnriquecido.tentativas_coleta || {}
      return mk('coletar_necessidade_ampla', montarPerguntaFaltante(perfilEnriquecido), {
        etapa_proxima: 'diagnostico',
        atualizar_perfil: {
          tentativas_coleta: { ...tc2, [campoAtual2]: (tc2[campoAtual2] || 0) + 1 },
        },
      })
    }
    // Campos esgotados — deixa IA avançar consultivamente
  }
  if (
    (!estado.dados_obrigatorios.nicho && (perfilEnriquecido.tentativas_coleta?.negocio || 0) < 2) ||
    (!estado.dados_obrigatorios.cidade && (perfilEnriquecido.tentativas_coleta?.cidade || 0) < 2)
  ) {
    return { ...base, proxima_acao: 'coletar_nicho_cidade' }
  }
  return base
}

const AUTO_REPLY_WHATSAPP_REGEX = /(agradece(mos)?\s+(o\s+)?(seu\s+)?contato|como\s+podemos\s+ajudar|responder?emos?\s+(em\s+breve|assim\s+que\s+poss[ií]vel)|atendimento\s+(autom[aá]tico|iniciado)|este\s+[eé]\s+um\s+atendimento\s+autom[aá]tico|mensagem\s+autom[aá]tica|aguarde\s+que\s+responder?emos?|retornaremos\s+(o\s+)?contato|seu\s+contato\s+foi\s+recebido)/i

/** Heuristica para reconhecer auto-reply de WhatsApp Business antes de tratar como fala real do lead. */
function textoEhAutoReplyWhatsApp(texto) {
  if (!texto || typeof texto !== 'string') return false
  const limpo = texto.trim()
  if (!limpo || limpo.length > 600) return false
  return AUTO_REPLY_WHATSAPP_REGEX.test(limpo)
}

/**
 * True quando o lead vem de prospeccao ativa E a primeira fala do user no historico
 * parece ser um auto-reply do WhatsApp Business — caso em que o agente nao deve
 * reiniciar diagnostico nem se reapresentar.
 *
 * Prefere o flag persistente em contexto_prospeccao.auto_reply_detectado (gravado
 * no webhook handler); cai para analise do historico como fallback.
 */
function detectarAutoReplyEmContextoProspeccao(perfil, historico) {
  if (!perfil || perfil.origem !== 'prospeccao' || !perfil.contexto_prospeccao) return false
  const ctx = perfil.contexto_prospeccao
  if (ctx && typeof ctx === 'object' && ctx.auto_reply_detectado === true) return true
  const msgs = Array.isArray(historico) ? historico : []
  let primeiraFalaUser = ''
  for (const m of msgs) {
    if (!m || m.role !== 'user') continue
    primeiraFalaUser = typeof m.content === 'string' ? m.content : ''
    break
  }
  if (!primeiraFalaUser) return false
  return textoEhAutoReplyWhatsApp(primeiraFalaUser)
}

function historicoParaClaude(historico, visaoUltimaMensagem = null) {
  // Janela controlada para manter continuidade sem estourar custo de token.
  const msgs = normalizarHistoricoMensagens(historico).slice(-HISTORICO_CLAUDE_MAX_MSGS)
  /** @type {{ kind: 'client'|'operator'|'assistant', text: string }[]} */
  const expanded = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
    let text = m.content
    if (typeof text !== 'string') {
      if (text == null) text = ''
      else if (Array.isArray(text)) {
        text = text
          .map((b) => (b && typeof b === 'object' && 'text' in b ? b.text : JSON.stringify(b)))
          .join('')
      } else text = String(text)
    }
    text = sanitizarLoneSurrogates(text)
    if (m.role === 'operator') expanded.push({ kind: 'operator', text })
    else if (m.role === 'user') expanded.push({ kind: 'client', text })
    else expanded.push({ kind: 'assistant', text })
  }

  const out = []
  for (const e of expanded) {
    if (e.kind === 'client') {
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._mergeKind === 'client') {
        last.content = `${last.content}\n\n${e.text}`.trim()
      } else {
        out.push({ role: 'user', content: e.text, _mergeKind: 'client' })
      }
    } else if (e.kind === 'operator') {
      const block = `[Operador humano]: ${e.text}`
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last._mergeKind === 'operator') {
        last.content = `${last.content}\n\n${block}`.trim()
      } else {
        out.push({ role: 'user', content: block, _mergeKind: 'operator' })
      }
    } else {
      const last = out[out.length - 1]
      if (last && last.role === 'assistant') {
        last.content = `${last.content}\n\n${e.text}`.trim()
      } else {
        out.push({ role: 'assistant', content: e.text })
      }
    }
  }
  for (const row of out) {
    delete row._mergeKind
  }

  while (out.length > 0 && out[0].role === 'assistant') out.shift()
  const v = visaoUltimaMensagem
  if (
    v &&
    v.data &&
    v.media_type &&
    out.length > 0 &&
    out[out.length - 1].role === 'user'
  ) {
    const lastUser = out[out.length - 1]
    const t = typeof lastUser.content === 'string' ? lastUser.content.trim() : String(lastUser.content || '')
    const blocoOperador =
      typeof t === 'string' && t.startsWith('[Operador humano]:')
    const placeholderImagem = blocoOperador ? '(Operador enviou uma imagem.)' : '(Cliente enviou uma imagem.)'
    lastUser.content = [
      { type: 'text', text: t || placeholderImagem },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: v.media_type,
          data: v.data,
        },
      },
    ]
  }
  return out
}

/**
 * Conta quantas vezes o lead pediu preco/valor/investimento de forma explicita
 * nas mensagens dele (nao do agente). Usado para acionar a regra "preco sob pressao"
 * do prompt (system.md regra 14): a partir da 2a solicitacao, dar o numero em vez de desviar.
 */
function contarPedidosPrecoDoLead(historico) {
  if (!Array.isArray(historico)) return 0
  const padraoPreco = /(quanto\s+(custa|fica|sai|e|\u00e9|vai\s+sair)|qual\s+(o\s+)?(pre\u00e7o|valor|investimento|custo)|me\s+(fala|diz|manda|passa)\s+(o\s+)?(pre\u00e7o|valor)|me\s+passa\s+(um\s+)?or\u00e7amento|vc\s+cobra\s+quanto|voc\u00ea\s+cobra\s+quanto|cobra\s+quanto|valor\s+(ai|a\u00ed|disso)|pre\u00e7o\s+(ai|a\u00ed|disso)|quanto\s+t\u00e1|quanto\s+ta)/i
  let count = 0
  for (const msg of historico) {
    // Considera apenas mensagens do lead: role "user" ou sem campo role, e que nao sejam do Operador.
    const role = msg?.role || 'user'
    if (role !== 'user') continue
    const texto = typeof msg?.content === 'string'
      ? msg.content
      : (typeof msg?.text === 'string' ? msg.text : '')
    if (!texto) continue
    if (texto.startsWith('[Operador humano]:')) continue
    if (padraoPreco.test(texto)) count++
  }
  return count
}

/**
 * Gera um bloco de texto conciso que lista quais campos diagnósticos já foram
 * coletados do lead (via campos_coletados) e quais ainda estão pendentes.
 *
 * Isso permite ao modelo não repetir perguntas já respondidas — um dos padrões
 * de falha mais frequentes identificados na análise de conversas reais (padrão 13).
 *
 * Exemplo de saída:
 *   --- COLETA DE DADOS DO LEAD ---
 *   Ja coletado (NAO repita): negocio, cidade
 *   Pendente (pode perguntar): ticket_cliente_final, ja_aparece_google, termometro_dor, complexidade, score_dor
 */
function montarBlocoColetados(perfil) {
  if (!perfil || typeof perfil !== 'object') return ''

  // campos_coletados pode vir do banco como objeto ou string JSON
  let coletadosObj = {}
  const raw = perfil.campos_coletados
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    coletadosObj = raw
  } else if (typeof raw === 'string') {
    try { coletadosObj = JSON.parse(raw) } catch (_) { /* ignora */ }
  }

  const coletados = []
  const pendentes = []
  for (const campo of LEAD_CAMPOS_DIAGNOSTICO) {
    if (coletadosObj[campo]) coletados.push(campo)
    else pendentes.push(campo)
  }

  // Só injeta o bloco se houver pelo menos um campo já coletado
  if (coletados.length === 0) return ''

  const linhas = [`\n--- COLETA DE DADOS DO LEAD ---`]
  linhas.push(`Ja coletado (NAO repita perguntas sobre): ${coletados.join(', ')}`)
  if (pendentes.length > 0) {
    linhas.push(`Pendente (pode perguntar quando relevante): ${pendentes.join(', ')}`)
  }
  return linhas.join('\n') + '\n'
}

function _blocoEtapaAtual(estagio) {
  const mapa = {
    primeiro_contato: () => prompts.SYSTEM_PRIMEIRO_CONTATO_BASE,
    diagnostico: () => prompts.SYSTEM_DIAGNOSTICO_BASE,
    proposta: () => prompts.SYSTEM_PROPOSTA_BASE,
    objecao: () => prompts.SYSTEM_OBJECAO_BASE,
    fechamento: () => prompts.SYSTEM_FECHAMENTO_BASE,
  }
  const fn = mapa[estagio]
  // withTomReferencia anexa o bloco de tom-referencia compartilhado ao final
  // do prompt de etapa. Isso ancora o modelo no padrao validado pela equipe
  // sem inflar individualmente cada arquivo system-*.md.
  const conteudo = fn ? prompts.withTomReferencia(fn()).trim() : ''
  return conteudo
    ? `\n\n--- REGRAS DA ETAPA "${estagio.toUpperCase()}" (aplique agora) ---\n${conteudo}\n--- FIM REGRAS DA ETAPA ---`
    : ''
}

// Igual ao _blocoEtapaAtual, mas com um texto já pronto (estágio de um CONTEXTO
// ativo). Não anexa o tom-referencia da PJ — o estágio do contexto já é próprio.
function _blocoEtapaComTexto(estagio, texto) {
  const conteudo = String(texto || '').trim()
  return conteudo
    ? `\n\n--- REGRAS DA ETAPA "${String(estagio).toUpperCase()}" (aplique agora) ---\n${conteudo}\n--- FIM REGRAS DA ETAPA ---`
    : ''
}

function montarSystemPromptDinamico(estagio, perfil, aprendizado, flags = {}, historico = []) {
  // Modelo unificado: se a empresa tem um CONTEXTO ATIVO com estágios próprios,
  // usa Núcleo + estágio + conhecimento DAQUELE contexto. Sem isso, cai nos
  // prompts globais da PJ (system-*.md + empresa.md) — comportamento atual.
  const ce = flags.contextoEstagios && typeof flags.contextoEstagios === 'object' ? flags.contextoEstagios : null
  const nucleoCtx = ce && ce.estagios && typeof ce.estagios.nucleo === 'string' ? ce.estagios.nucleo.trim() : ''
  const conhecimentoCtx = ce && typeof ce.conhecimento === 'string' ? ce.conhecimento.trim() : ''
  const base =
    nucleoCtx ||
    prompts.SYSTEM_CORE_BASE.trim() ||
    `Voce e o assistente de vendas da PJ Codeworks. Responda APENAS com um objeto JSON valido com mensagem_pro_lead, atualizar_perfil, etapa_proxima, solicitar_calculo_preco, solicitar_classificacao_nicho, handoff, motivo_handoff.`
  const empresa = conhecimentoCtx || prompts.EMPRESA_KNOWLEDGE_BASE.trim()
  const blocoEmpresa = empresa ? `\n\n---\n\n${empresa}\n` : ''
  const ctxHorario = textoContextoHorarioVictorParaPrompt()
  const blocoEstatico = `${base}${blocoEmpresa}`

  // Flags de pressao/instrucao-dinamica: sinalizam ao modelo quando acionar regras de prompt.
  const linhasFlags = []
  const pedidosPreco = Number(flags.pedidosPreco) || 0
  const temPrecoCalculado = !!flags.temPrecoCalculado
  if (pedidosPreco >= 2 && !temPrecoCalculado) {
    linhasFlags.push(
      `- LEAD_PEDIU_PRECO_${pedidosPreco}X: o lead pediu preco/valor ${pedidosPreco} vezes explicitamente e ainda nao recebeu. Seja transparente com a faixa de R$200 a R$3.000 dependendo da complexidade, e conduza para reuniao de escopo onde a equipe define estrutura, prazo e investimento.`
    )
  }
  if (flags.concorrentesReais && Array.isArray(flags.concorrentesReais) && flags.concorrentesReais.length > 0) {
    linhasFlags.push(
      `- CONCORRENTES_REAIS (busca autorizada): use APENAS estes nomes se for citar concorrentes; nao invente outros — ${flags.concorrentesReais.map((c) => (typeof c === 'string' ? c : c?.titulo || '')).filter(Boolean).slice(0, 3).join(' | ')}`
    )
  }
  if (flags.jaRecebeuPreview) {
    linhasFlags.push(
      `- JA_RECEBEU_PREVIEW: a previa visual ja foi enviada para este lead. NUNCA marque solicitar_preview_site: true. NUNCA diga que a previa "esta sendo gerada" ou "esta sendo montada". Continue a conversa com base no modelo ja enviado.`
    )
  }
  if (flags.respostaProvavelmenteAutoReply) {
    linhasFlags.push(
      `- RESPOSTA_PROVAVELMENTE_AUTO_REPLY: a primeira "resposta" do lead bate com padrao de auto-reply do WhatsApp Business (ex.: "agradece seu contato", "como podemos ajudar"). Aplique a regra P-PROSP-3: NAO trate como resposta humana, NAO se reapresente, NAO reinicie diagnostico. Mande UMA bolha curta (ate 320 chars) reapresentando objetivamente o motivo do contato — referenciando o nicho/cidade do contexto_prospeccao — e termine com pergunta de canal de aquisicao/agendamento.`
    )
  }
  if (flags.proxima_acao_hint === 'confirmar_reuniao') {
    const horInfo = flags.horario_extraido ? ` às ${flags.horario_extraido}` : ''
    linhasFlags.push(
      `- ACAO_TURNO: CONFIRMAR_REUNIAO — o lead escolheu o horario${horInfo}. Escreva uma confirmacao amigavel e natural da reuniao com a equipe (NUNCA mencione Victor ou qualquer nome de pessoa). Inclua: horario confirmado, que sera com a equipe, duracao de ate 15 min e peca o melhor e-mail para contato. Defina handoff: true, motivo_handoff: "agendou_reuniao_proposta", etapa_proxima: "reuniao_agendada". Maxima 2 bolhas.`
    )
  }
  if (flags.proxima_acao_hint === 'reexplicar') {
    const ultimaPerg = flags.ultima_pergunta ? ` A ultima pergunta do assistente foi: "${flags.ultima_pergunta}"` : ''
    linhasFlags.push(
      `- ACAO_TURNO: REEXPLICAR — o lead nao entendeu a ultima mensagem.${ultimaPerg} Reexplique em linguagem simples e direta, sem jargoes. NAO avance o fluxo nem faca novas perguntas. Use no maximo 1 bolha curta.`
    )
  }
  if (flags.proxima_acao_hint === 'responder_preco') {
    linhasFlags.push(
      `- ACAO_TURNO: RESPONDER_PRECO — o lead perguntou sobre preco/valor. Siga as regras do Passo B do system-proposta.md. Apresente as opcoes de forma consultiva e conduza naturalmente para uma reuniao de diagnostico quando adequado. NAO mencione valores inventados; use apenas as faixas documentadas no prompt.`
    )
  }
  const blocoFlags = linhasFlags.length > 0
    ? `\n\n--- FLAGS DINAMICAS DO TURNO ATUAL (obedeca) ---\n${linhasFlags.join('\n')}`
    : ''

  const memRaw = perfil && typeof perfil.resumo_memoria_vendas === 'string' ? perfil.resumo_memoria_vendas.trim() : ''
  const blocoMemoria = memRaw
    ? `\n\n--- RESUMO MEMORIA VENDAS (sintese operacional; nao substitui o historico de mensagens) ---\n${memRaw}\n`
    : ''

  // Bloco de coleta: informa ao modelo quais campos diagnósticos JÁ foram coletados
  // para que ele não repita perguntas que o lead já respondeu.
  const blocoColetados = montarBlocoColetados(perfil)
  const blocoContextoInterno = montarBlocoContextoInterno(flags.contextosInternos)
  const blocoContinuidade = montarBlocoContinuidadeTurno(historico, perfil)
  const contextoProspeccao = perfil?.contexto_prospeccao
  const veioDeProspeccao = perfil?.origem === 'prospeccao' && contextoProspeccao && typeof contextoProspeccao === 'object'
  const blocoProspeccao = veioDeProspeccao
    ? `\n\n--- CONTEXTO DE PROSPECCAO (lead FRIO — abordagem ativa) ---\n` +
      `Este contato foi PROSPECTADO ativamente (Google Maps). Ele NAO viu anuncio e NAO pediu contato: recebeu UMA mensagem nossa citando empresa, cidade, nicho e reputacao. Portanto provavelmente NAO conhece a PJ Codeworks nem sabe o que oferecemos.\n` +
      `Mensagem inicial enviada: ${contextoProspeccao.mensagem_enviada || '(nao registrada)'}\n` +
      `Estudo do lead (use como se ja tivesse pesquisado o negocio dele): nicho ${contextoProspeccao.nicho || perfil?.negocio || '?'} | cidade ${contextoProspeccao.cidade || perfil?.cidade || '?'} | empresa ${contextoProspeccao.nome || '?'} | tem site: ${contextoProspeccao.tem_site ? 'sim' : 'nao'} | dor provavel: ${contextoProspeccao.dor_principal || '(nao mapeada)'}\n` +
      `POSTURA (lead prospectado != lead de anuncio):\n` +
      `- Seja CONSULTIVO e sem pressao. Primeiro gere contexto e mostre que entende o negocio dele (use nicho/cidade/dor acima) ANTES de qualquer oferta, plano ou preco.\n` +
      `- NAO assuma interesse de compra: ele nao pediu isso. Conduza com no maximo 1 pergunta leve de diagnostico por vez.\n` +
      `- PROIBIDO se reapresentar ("Sou da PJ Codeworks") e PROIBIDO perguntar nicho, cidade ou nome do negocio — ele acabou de ler isso na mensagem inicial.\n` +
      `- Ancore no que ja sabemos ("Vi que voces atuam com [nicho] em [cidade]...").\n` +
      `- Proxima pergunta: como captam clientes hoje / como esta a presenca digital — nunca dados que ja temos.\n`
    : ''

  const aprendizadosAtivos = Array.isArray(flags.aprendizadosAtivos) ? flags.aprendizadosAtivos : []
  const blocoCorrecoes = montarBlocoCorrecoesAprendizados(aprendizadosAtivos)

  const perfilJson = JSON.stringify(perfilJsonParaPromptSemDuplicarMemoria(perfil), null, 2)
  const etapaCtx = ce && ce.estagios && typeof ce.estagios[estagio] === 'string' ? ce.estagios[estagio].trim() : ''
  const blocoEtapa = etapaCtx ? _blocoEtapaComTexto(estagio, etapaCtx) : _blocoEtapaAtual(estagio)
  const blocoTurnContext = flags.turnContextBlock
    ? `\n\n${flags.turnContextBlock}`
    : ''
  const blocodinamico = `\n\n---\n\nCONTEXTO DINAMICO (obedeca as regras acima):\n\n--- HORARIO E REDIRECIONAMENTO AO VICTOR ---\n${ctxHorario}\n\nETAPA ATUAL: ${estagio}${blocoEtapa}\n${blocoMemoria}${blocoColetados}${blocoContextoInterno}${blocoContinuidade}${blocoProspeccao}\nPERFIL DO LEAD:\n${perfilJson}\n${aprendizado ? `\nAPRENDIZADO DAS ULTIMAS VENDAS FECHADAS:\n${aprendizado}\n` : ''}${blocoCorrecoes}${blocoFlags}${blocoTurnContext}`
  return [
    { type: 'text', text: blocoEstatico, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: blocodinamico },
  ]
}

let AGENT_BASE_PROMPT_CACHE = null
function loadAgentBasePromptEnxuto() {
  if (AGENT_BASE_PROMPT_CACHE !== null) return AGENT_BASE_PROMPT_CACHE
  const p = path.join(__dirname, '..', 'prompts', 'agent-base.md')
  try {
    const raw = fs.existsSync(p)
      ? fs.readFileSync(p, 'utf8')
      : prompts.SYSTEM_CORE_BASE.trim()
    if (!prompts.TOM_REFERENCIA_BASE && typeof prompts.loadTomReferenciaPrompt === 'function') {
      prompts.loadTomReferenciaPrompt()
    }
    AGENT_BASE_PROMPT_CACHE = prompts.withTomReferencia(raw).trim()
  } catch (_) {
    AGENT_BASE_PROMPT_CACHE = prompts.withTomReferencia(prompts.SYSTEM_CORE_BASE.trim()).trim()
  }
  return AGENT_BASE_PROMPT_CACHE
}

/**
 * Prévia de valor para USO INTERNO do operador (nunca vai ao lead). Chamada LLM
 * dedicada, disparada no handoff de reunião agendada: a IA analisa o contexto do
 * lead e sugere um valor/faixa + justificativa curta, ancorado nas faixas REAIS do
 * motor (pricing.js: iniciante R$200–600, padrão R$600–1000, premium R$1000–2000).
 * Quando falta diagnóstico para um número firme, estima uma FAIXA pelo contexto.
 * Retorna `{ faixa_min, faixa_max, valor_alvo, plano, justificativa } | null`.
 */
async function gerarPreviaValorIA(perfil = {}) {
  try {
    const negocio = String(perfil.negocio || '').trim()
    if (!negocio) return null
    const ctx = {
      negocio,
      cidade: perfil.cidade || perfil.regiao_atendimento || null,
      necessidade: perfil.necessidade || perfil.produto_sugerido || 'site',
      dor_principal: perfil.dor_principal || null,
      score_dor: perfil.score_dor ?? perfil.termometro_dor ?? null,
      ticket_cliente: perfil.ticket_cliente_final || null,
      complexidade: perfil.complexidade || null,
      tem_site: perfil.tem_site ?? null,
      origem_clientes: perfil.origem_clientes || null,
      motor: (perfil.precificacao_json && typeof perfil.precificacao_json === 'object')
        ? {
          plano: perfil.precificacao_json.plano_recomendado,
          valor: perfil.precificacao_json.valor_personalizado,
          faixa: [perfil.precificacao_json.range_min, perfil.precificacao_json.range_max],
        }
        : null,
    }
    const systemPrompt =
      'Voce e analista de precificacao da PJ Codeworks (criacao de sites). Sugira, SO PARA USO INTERNO do operador (NUNCA vai ao cliente), um valor ou faixa para o projeto deste lead, com base no contexto.\n' +
      'Faixas reais — ancore-se nelas e NUNCA extrapole: iniciante R$200-600, padrao R$600-1000, premium R$1000-2000.\n' +
      'Para sistema, automacao, agente de IA ou projeto sob medida, NAO crave numero: use plano "sob_medida" e faixas nulas.\n' +
      'Se faltar diagnostico para um numero firme, estime uma FAIXA realista pelo contexto (nicho, cidade, dor, origem dos clientes).\n' +
      'Responda APENAS um objeto JSON: {"faixa_min": number|null, "faixa_max": number|null, "valor_alvo": number|null, "plano": "iniciante"|"padrao"|"premium"|"sob_medida", "justificativa": "1-2 frases curtas e diretas"}'
    const userPrompt = `Contexto do lead (JSON):\n${JSON.stringify(ctx)}`
    const r = await aiProvider.generateAIResponse(
      {
        systemPrompt,
        userPrompt,
        task: 'previa_valor_handoff',
        maxTokens: 300,
        timeoutMs: 15000,
        responseFormatJson: true,
      },
      pool,
      logger
    )
    const parsed = parsearRespostaJsonClaude(r?.text || '')
    if (!parsed || typeof parsed !== 'object') return null
    const clamp = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return null
      return Math.min(2000, Math.max(200, Math.round(n)))
    }
    const plano = ['iniciante', 'padrao', 'premium', 'sob_medida'].includes(parsed.plano) ? parsed.plano : null
    const previa = {
      faixa_min: clamp(parsed.faixa_min),
      faixa_max: clamp(parsed.faixa_max),
      valor_alvo: clamp(parsed.valor_alvo),
      plano,
      justificativa: String(parsed.justificativa || '').trim().slice(0, 240) || null,
    }
    if (previa.faixa_min && previa.faixa_max && previa.faixa_min > previa.faixa_max) {
      const t = previa.faixa_min; previa.faixa_min = previa.faixa_max; previa.faixa_max = t
    }
    // Precisa ter ao menos um valor/faixa OU ser explicitamente sob medida.
    if (!previa.faixa_min && !previa.valor_alvo && plano !== 'sob_medida') return null
    return previa
  } catch (e) {
    if (logger && typeof logger.warn === 'function') logger.warn('previa de valor IA falhou:', e.message)
    return null
  }
}

/**
 * Detecção de reunião fechada via LLM — ÚNICA fonte (sem regex). A IA SEMPRE
 * analisa a conversa e o código apenas captura o JSON resultante. Cobre operador
 * humano fechando ("agendamos", datas variadas, linguagem natural) e a IA com
 * aceite claro do lead. Roda mesmo com o agente PAUSADO: pausa = não responder ao
 * lead, mas o código segue ANALISANDO e cria o evento na agenda.
 * Retorna `{ fechada:true, data:'AAAA-MM-DD'|null, horario:'HH:MM', dataRelativa:null, confianca, fonte:'ia' } | null`.
 */
async function detectarReuniaoFechadaIA(historico = []) {
  try {
    const msgs = normalizarHistoricoMensagens(historico).slice(-12)
    if (!msgs.length) return null
    const transcript = msgs
      .map((m) => {
        const role = m.role === 'assistant' ? 'IA' : m.role === 'operator' ? 'OPERADOR' : 'LEAD'
        let c = m.content
        if (Array.isArray(c)) c = c.map((b) => (b && b.text) || '').join(' ')
        const t = String(c || '').replace(/\s+/g, ' ').trim()
        return t ? `${role}: ${t}` : ''
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000)
    if (!transcript) return null
    const hojeIso = dataStrSaoPaulo(0)
    const amanhaIso = dataStrSaoPaulo(1)
    const systemPrompt =
      'Voce analisa uma conversa de WhatsApp de vendas. Decida se uma REUNIAO foi efetivamente FECHADA/CONFIRMADA — pelo OPERADOR humano OU pela IA com aceite claro do LEAD. So marque fechada=true quando ha acordo real de um encontro com horario definido.\n' +
      `Hoje e ${hojeIso} (amanha = ${amanhaIso}). Resolva expressoes relativas ("hoje", "amanha", "segunda") para data absoluta ISO (AAAA-MM-DD).\n` +
      'Extraia o horario em HH:MM 24h. Se foi dito "7"/"8" claramente como reuniao da noite, use 19:xx/20:xx; senao mantenha o dito.\n' +
      'Responda APENAS JSON: {"fechada": boolean, "data": "AAAA-MM-DD"|null, "horario": "HH:MM"|null, "confianca": "alta"|"media"|"baixa"}'
    const userPrompt = `Conversa (mais recente embaixo):\n${transcript}`
    const r = await aiProvider.generateAIResponse(
      {
        systemPrompt,
        userPrompt,
        task: 'detector_reuniao_operador',
        maxTokens: 160,
        timeoutMs: 12000,
        responseFormatJson: true,
      },
      pool,
      logger
    )
    const parsed = parsearRespostaJsonClaude(r?.text || '')
    if (!parsed || parsed.fechada !== true) return null
    const data = (typeof parsed.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data)) ? parsed.data : null
    let horario = null
    if (typeof parsed.horario === 'string' && parsed.horario.trim()) {
      const ph = parsearHorarioReuniao(parsed.horario)
      horario = ph?.normalizado || (/^\d{1,2}:\d{2}$/.test(parsed.horario.trim()) ? parsed.horario.trim() : null)
    }
    if (!horario) return null // sem horario concreto não cria evento
    const confianca = ['alta', 'media', 'baixa'].includes(parsed.confianca) ? parsed.confianca : 'media'
    return { fechada: true, data, horario, dataRelativa: null, confianca, fonte: 'ia' }
  } catch (e) {
    if (logger && typeof logger.warn === 'function') logger.warn('detectorReuniaoIA falhou:', e.message)
    return null
  }
}

function montarSystemPromptAcaoDeterministica(nextActionContext) {
  const base = loadAgentBasePromptEnxuto()
  const ctx = nextActionContext && typeof nextActionContext === 'object' ? nextActionContext : {}
  const dinamico = [
    '--- CONTEXTO DINAMICO DA ARQUITETURA DETERMINISTICA ---',
    'O codigo ja decidiu a proxima acao. Nao mude a acao, nao mude a etapa e nao acrescente decisoes.',
    JSON.stringify({
      acao_decidida: ctx.acao_decidida,
      instrucao_da_acao: ctx.instrucao_da_acao,
      etapa_atual: ctx.etapa_atual,
      etapa_sugerida: ctx.etapa_sugerida,
      rota_comercial: ctx.rota_comercial,
      perfil: ctx.perfil,
      dados_faltantes: ctx.dados_faltantes,
      dados_extraidos: ctx.dados_extraidos,
      horarios_disponiveis: ctx.horarios_disponiveis,
      data_label_agenda: ctx.data_label_agenda,
      data_sugerida_agenda: ctx.data_sugerida_agenda,
      // Disponibilidade real de ate 7 dias uteis (por dia: data/data_br/label/horarios).
      // A IA usa para oferecer o dia/horario certo com flexibilidade — antes este
      // campo era montado no contexto mas nao chegava ao prompt.
      disponibilidade_semana: ctx.disponibilidade_semana || null,
      // Instrucao corretiva de agenda (ex.: horario pedido ficou indisponivel —
      // reofereca os reais sem confirmar). A IA escreve a mensagem; nada de template.
      observacao_agenda: ctx.observacao_agenda || null,
      links_autorizados: ctx.links_autorizados,
      acoes_proibidas: ctx.acoes_proibidas,
      ultima_pergunta: ctx.ultima_pergunta,
      turn_context: ctx.turn_context || null,
      resumo_historico: ctx.resumo_historico,
    }, null, 2),
    ctx.turn_context_prompt ? `\n${ctx.turn_context_prompt}` : '',
    '--- FIM CONTEXTO DINAMICO ---',
  ].join('\n')
  return [
    { type: 'text', text: base, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dinamico },
  ]
}

function reforcarContinuidadeEmFallback(mensagem, historico, estagio) {
  const texto = typeof mensagem === 'string' ? mensagem.trim() : ''
  if (!texto) return texto
  if (estagio === 'primeiro_contato') return texto
  const generica = /^(opa|ol[áa]|tudo bem|sou da pj codeworks|qual o ramo|qual o seu negocio)/i.test(texto)
  if (!generica) return texto
  const msgs = normalizarHistoricoMensagens(historico)
  const ultimaLead = [...msgs].reverse().find((m) => m && m.role === 'user')
  const resumoLead = ultimaLead ? textoDeContent(ultimaLead.content).replace(/\s+/g, ' ').trim().slice(0, 140) : ''
  if (!resumoLead) return texto
  return `Entendi seu ponto sobre "${resumoLead}". ${texto}`
}

/**
 * Normaliza o objeto opcional `agendar_followup_auto` do JSON do modelo.
 * @param {unknown} raw
 * @param {Date} [agora]
 * @returns {{ agendar_para: string, instrucao_followup: string } | null} `agendar_para` em ISO após ajuste de janela comercial
 */
function normalizarAgendarFollowupAuto(raw, agora = new Date()) {
  if (raw == null || raw === false) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const agendarParaStr = typeof raw.agendar_para === 'string' ? raw.agendar_para.trim() : ''
  if (!agendarParaStr) return null
  const dt = new Date(agendarParaStr)
  if (Number.isNaN(dt.getTime())) return null
  const nowMs = agora.getTime()
  const minMs = nowMs + FOLLOWUP_EXPLICITO_MIN_MINUTOS * 60 * 1000
  const maxMs = nowMs + FOLLOWUP_EXPLICITO_MAX_DIAS * 24 * 60 * 60 * 1000
  let t = dt.getTime()
  if (t > maxMs) return null
  if (t < minMs) t = minMs
  let out = new Date(t)
  out = ajustarParaJanelaComercialFollowup(out)
  if (out.getTime() < nowMs + 8 * 60 * 1000) {
    out = ajustarParaJanelaComercialFollowup(new Date(minMs))
  }
  if (out.getTime() < nowMs || out.getTime() > maxMs) return null
  const instrucaoRaw = typeof raw.instrucao_followup === 'string' ? raw.instrucao_followup.trim() : ''
  const instrucao_followup = instrucaoRaw
    ? instrucaoRaw.slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
    : FOLLOWUP_EXPLICITO_INSTRUCAO_PADRAO
  return { agendar_para: out.toISOString(), instrucao_followup }
}

/**
 * Normaliza a escolha de horario de reuniao que a IA captura no JSON
 * (`reuniao_escolha: { data, horario }`). O codigo valida o horario contra os
 * slots REAIS ofertados antes de agendar — aqui so normalizamos o shape.
 * @returns {{ data: string|null, horario: string }|null}
 */
function normalizarReuniaoEscolha(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const horarioRaw = String(raw.horario ?? raw.hora ?? '').trim()
  if (!horarioRaw) return null
  const parsed = typeof parsearHorarioReuniao === 'function' ? parsearHorarioReuniao(horarioRaw) : null
  const horario = parsed?.normalizado || (/^\d{1,2}:\d{2}$/.test(horarioRaw) ? horarioRaw : null)
  if (!horario) return null
  const dataRaw = String(raw.data ?? raw.dia ?? '').trim()
  const data = /^\d{4}-\d{2}-\d{2}$/.test(dataRaw) ? dataRaw : null
  return { data, horario }
}

function resultadoParseadoParaObjeto(parsed, estagio) {
  const linksRaw = Array.isArray(parsed.links_sugeridos) ? parsed.links_sugeridos : []
  const links_sugeridos = linksRaw
    .filter((u) => typeof u === 'string')
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 3)
  const etapaParaBolhas = normalizarEstagio(parsed.etapa_proxima ?? estagio, estagio)
  const bolhasNorm = normalizarMensagensBolhasArray(parsed.mensagens_bolhas, etapaParaBolhas)
  let mensagem_pro_lead = typeof parsed.mensagem_pro_lead === 'string' ? parsed.mensagem_pro_lead.trim() : ''
  if (bolhasNorm && bolhasNorm.length) {
    mensagem_pro_lead = bolhasNorm.join('\n\n')
  }
  const tema_lacuna =
    typeof parsed.tema_lacuna === 'string'
      ? parsed.tema_lacuna.trim().slice(0, MAX_TEMA_LACUNA_CHARS)
      : ''
  const detalhe_lacuna =
    typeof parsed.detalhe_lacuna === 'string'
      ? parsed.detalhe_lacuna.trim().slice(0, MAX_DETALHE_LACUNA_CHARS)
      : ''

  const resumo_handoff =
    typeof parsed.resumo_handoff === 'string' && parsed.resumo_handoff.trim()
      ? parsed.resumo_handoff.trim()
      : null
  const enviar_print =
    typeof parsed.enviar_print === 'string' && parsed.enviar_print.trim()
      ? parsed.enviar_print.trim()
      : null
  const captionPrintRaw =
    typeof parsed.caption_print === 'string' && parsed.caption_print.trim()
      ? parsed.caption_print.trim().slice(0, 320)
      : ''
  const caption_print = enviar_print && captionPrintRaw ? captionPrintRaw : null
  const preview_site_modelo =
    typeof parsed.preview_site_modelo === 'string' && parsed.preview_site_modelo.trim()
      ? parsed.preview_site_modelo.trim().toLowerCase()
      : null
  const agendar_followup_auto = normalizarAgendarFollowupAuto(parsed.agendar_followup_auto)
  const atualizarPerfil = parsed.atualizar_perfil && typeof parsed.atualizar_perfil === 'object'
    ? { ...parsed.atualizar_perfil }
    : {}
  const copiarTopLevelPerfil = (key, pred) => {
    if (Object.prototype.hasOwnProperty.call(atualizarPerfil, key)) return
    const val = parsed[key]
    if (pred(val)) atualizarPerfil[key] = val
  }
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
  const isNonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0
  const isBool = (v) => typeof v === 'boolean'
  copiarTopLevelPerfil('maturidade_digital', isObj)
  copiarTopLevelPerfil('origem_anuncio', isNonEmptyObj)
  copiarTopLevelPerfil('eventos_conversa', isObj)
  copiarTopLevelPerfil('reuniao_proposta', isObj)
  copiarTopLevelPerfil('intencao_principal', isStr)
  copiarTopLevelPerfil('produto_sugerido', isStr)
  copiarTopLevelPerfil('dor_principal', isStr)
  copiarTopLevelPerfil('confusao_site_anuncio_google', isBool)
  copiarTopLevelPerfil('explicacao_teste_gratis_enviada', isBool)
  copiarTopLevelPerfil('expectativa_google_alinhada', isBool)
  copiarTopLevelPerfil('personalizacao_nicho_cidade_enviada', isBool)

  return {
    mensagem_pro_lead,
    mensagens_bolhas: bolhasNorm,
    atualizar_perfil: atualizarPerfil,
    etapa_proxima: etapaParaBolhas,
    solicitar_calculo_preco: !!parsed.solicitar_calculo_preco,
    solicitar_classificacao_nicho: !!parsed.solicitar_classificacao_nicho,
    handoff: !!parsed.handoff,
    motivo_handoff: parsed.motivo_handoff ?? null,
    reuniao_escolha: normalizarReuniaoEscolha(parsed.reuniao_escolha),
    links_sugeridos,
    registrar_lacuna: parsed.registrar_lacuna === true,
    tema_lacuna,
    detalhe_lacuna,
    resumo_handoff,
    enviar_print,
    caption_print,
    solicitar_preview_site: parsed.solicitar_preview_site === true,
    preview_site_modelo: PREVIEW_SITE_MODELOS.has(preview_site_modelo) ? preview_site_modelo : null,
    agendar_followup_auto,
    // Estado sinalizado pelo lead (adiamento/desinteresse) — capturado do JSON da IA.
    // O código (core-funnel) executa: adiamento → agenda follow-up; desinteresse → encerra.
    sinal_conversa: ['adiamento', 'desinteresse'].includes(parsed.sinal_conversa) ? parsed.sinal_conversa : null,
    // Sinais do lead capturados no turno (score, origem_clientes, urgência, objeções…).
    // O schema obriga a IA a emitir; o core-funnel faz o merge/persistência. Sem este
    // pass-through, o campo era descartado aqui e nenhum lead recebia insights.
    insights_lead:
      parsed.insights_lead != null &&
      typeof parsed.insights_lead === 'object' &&
      !Array.isArray(parsed.insights_lead)
        ? parsed.insights_lead
        : null,
    project_handoff:
      parsed.project_handoff != null &&
      typeof parsed.project_handoff === 'object' &&
      !Array.isArray(parsed.project_handoff)
        ? parsed.project_handoff
        : null,
  }
}

/**
 * Modelo às vezes usa chave errada; copia para mensagem_pro_lead se estiver vazio.
 */
const REUNIAO_PROPOSTA_HORARIOS_PADRAO = [
  '19:30',
  '19:45',
  '20:00',
  '20:15',
  '20:30',
  '20:45',
  '21:00',
  '21:15',
]

// Schema estrito (OpenAI Structured Outputs) da resposta do agente. strict:true +
// additionalProperties:false OBRIGAM o modelo a devolver todos os campos do contrato
// (fim do "campo obrigatorio ausente"; handoff/etapa_proxima/reuniao_escolha sempre vem).
// Cobre TODOS os campos que o código consome, EXCETO project_handoff (objeto livre —
// não modelável em strict; com o schema ON o modelo não o emite e o handoff usa os
// defaults computados, o que é ok pois o ping ao operador agora é compacto).
// Kill-switch: AI_STRUCTURED_OUTPUTS=off. Se a API recusar, degrada p/ json_object.
const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mensagem_pro_lead', 'mensagens_bolhas', 'atualizar_perfil', 'etapa_proxima',
    'solicitar_calculo_preco', 'solicitar_classificacao_nicho', 'handoff', 'motivo_handoff',
    'reuniao_escolha', 'resumo_handoff', 'links_sugeridos', 'enviar_print', 'caption_print',
    'solicitar_preview_site', 'preview_site_modelo', 'agendar_followup_auto',
    'registrar_lacuna', 'tema_lacuna', 'detalhe_lacuna', 'insights_lead', 'sinal_conversa',
  ],
  properties: {
    mensagem_pro_lead: { type: 'string' },
    mensagens_bolhas: { type: 'array', items: { type: 'string' } },
    atualizar_perfil: {
      type: 'object',
      additionalProperties: false,
      required: [
        'negocio', 'cidade', 'ticket_cliente_final', 'complexidade', 'plano_sugerido',
        'temperatura_lead', 'intencao_principal', 'produto_sugerido', 'dor_principal',
        'ja_aparece_google', 'precisa_sistema', 'score_dor', 'termometro_dor',
        'confusao_site_anuncio_google', 'explicacao_teste_gratis_enviada',
        'expectativa_google_alinhada', 'personalizacao_nicho_cidade_enviada',
      ],
      properties: {
        negocio: { type: ['string', 'null'] },
        cidade: { type: ['string', 'null'] },
        ticket_cliente_final: { type: ['string', 'null'] },
        complexidade: { type: ['string', 'null'] },
        plano_sugerido: { type: ['string', 'null'] },
        temperatura_lead: { type: ['string', 'null'] },
        intencao_principal: { type: ['string', 'null'] },
        produto_sugerido: { type: ['string', 'null'] },
        dor_principal: { type: ['string', 'null'] },
        ja_aparece_google: { type: ['boolean', 'null'] },
        precisa_sistema: { type: ['boolean', 'null'] },
        score_dor: { type: ['number', 'null'] },
        termometro_dor: { type: ['number', 'null'] },
        confusao_site_anuncio_google: { type: ['boolean', 'null'] },
        explicacao_teste_gratis_enviada: { type: ['boolean', 'null'] },
        expectativa_google_alinhada: { type: ['boolean', 'null'] },
        personalizacao_nicho_cidade_enviada: { type: ['boolean', 'null'] },
      },
    },
    etapa_proxima: { type: 'string' },
    solicitar_calculo_preco: { type: 'boolean' },
    solicitar_classificacao_nicho: { type: ['boolean', 'null'] },
    handoff: { type: 'boolean' },
    motivo_handoff: { type: ['string', 'null'] },
    reuniao_escolha: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['data', 'horario'],
      properties: {
        data: { type: ['string', 'null'] },
        horario: { type: ['string', 'null'] },
      },
    },
    resumo_handoff: { type: ['string', 'null'] },
    links_sugeridos: { type: ['array', 'null'], items: { type: 'string' } },
    enviar_print: { type: ['boolean', 'null'] },
    caption_print: { type: ['string', 'null'] },
    solicitar_preview_site: { type: ['boolean', 'null'] },
    preview_site_modelo: { type: ['string', 'null'] },
    agendar_followup_auto: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['agendar_para', 'instrucao_followup'],
      properties: {
        agendar_para: { type: ['string', 'null'] },
        instrucao_followup: { type: ['string', 'null'] },
      },
    },
    registrar_lacuna: { type: ['boolean', 'null'] },
    tema_lacuna: { type: ['string', 'null'] },
    detalhe_lacuna: { type: ['string', 'null'] },
    // Estado da conversa que o LEAD sinalizou neste turno (o código captura e executa):
    //  - 'adiamento': lead quer continuar DEPOIS ("falo amanhã", "te ligo", "agora não",
    //    ou só um 👍/ok/obrigado encerrando) → código agenda follow-up p/ retomar.
    //  - 'desinteresse': lead NÃO quer ("não quero", "não tenho interesse") → código encerra.
    //  - null: conversa segue normal. NUNCA invente; só marque com sinal claro do lead.
    sinal_conversa: { type: ['string', 'null'] },
    // Sinais do lead capturados NESTE turno (só o que o lead disse; null/vazio quando
    // não houver — nunca inventar). O código acumula (merge + union de arrays) e mostra na tela.
    insights_lead: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: [
        'score', 'origem_clientes', 'urgencia', 'prazo', 'orcamento_mencionado',
        'eh_decisor', 'concorrentes_mencionados', 'sinais_compra', 'objecoes', 'observacao_curta',
      ],
      properties: {
        score: { type: ['integer', 'null'] },
        origem_clientes: { type: ['string', 'null'] },
        urgencia: { type: ['string', 'null'] },
        prazo: { type: ['string', 'null'] },
        orcamento_mencionado: { type: ['string', 'null'] },
        eh_decisor: { type: ['string', 'null'] },
        concorrentes_mencionados: { type: ['array', 'null'], items: { type: 'string' } },
        sinais_compra: { type: ['array', 'null'], items: { type: 'string' } },
        objecoes: { type: ['array', 'null'], items: { type: 'string' } },
        observacao_curta: { type: ['string', 'null'] },
      },
    },
  },
}

function textoIndicaVendaDiretaProjetoPersonalizado(texto) {
  const s = String(texto || '').toLowerCase()
  if (!s) return false
  const falaPreco = /r\$\s*\d|entrada\s+de\s+r\$|3x\s+de\s+r\$|cria[cç][aã]o\s+do\s+site|mensalidade/.test(s)
  const falaFechamento = /quer\s+fechar|melhor\s+e-?mail|docusign|contrato/.test(s)
  return falaPreco || falaFechamento
}

function resultadoIndicaPorta2ProjetoPersonalizado(resultado, texto) {
  const perfilPatch = resultado?.atualizar_perfil || {}
  const produto = String(perfilPatch.produto_sugerido || '').toLowerCase()
  const reuniao = perfilPatch.reuniao_proposta
  const s = String(texto || '').toLowerCase()
  return (
    /reuniao|reuni[aã]o|proposta|personaliz|sob_medida|site_personalizado/.test(produto) ||
    (reuniao && typeof reuniao === 'object' && reuniao.necessaria === true) ||
    /projeto personalizado|proposta personalizada|site personalizado|site sob medida|estrutura personalizada/.test(s)
  )
}

const LABEL_DIAS_GUARDRAIL = {
  hoje: 'Hoje', amanha: 'Amanha',
  segunda: 'Na segunda', terca: 'Na terca', quarta: 'Na quarta', quinta: 'Na quinta', sexta: 'Na sexta',
}

async function aplicarGuardrailReuniaoProposta(resultado, perfil = {}, dataRef = new Date(), buscarSlots = null) {
  if (!resultado || typeof resultado !== 'object') return resultado
  // Se a reuniao JA esta confirmada (horario_confirmado preenchido), o guardrail nao
  // deve reabrir argumentacao de venda nem reoferecer horarios. Caso: lead respondeu
  // "19:45", o branch escolha_horario marcou a reuniao — qualquer texto da LLM
  // mencionando "proposta personalizada" seria ruido aqui.
  const rpAtual = (resultado.atualizar_perfil && resultado.atualizar_perfil.reuniao_proposta) || perfil?.reuniao_proposta || {}
  if (rpAtual && rpAtual.horario_confirmado) return resultado
  // Se a intencao da mensagem atual ja foi classificada como escolha_horario, o guardrail
  // tambem deve ficar fora — a confirmacao acontece no path determinístico.
  if (resultado.atualizar_perfil && resultado.atualizar_perfil.intencao_principal === 'escolha_horario') return resultado
  const texto = resultado.mensagem_pro_lead || ''
  const plano = String(resultado.atualizar_perfil?.plano_sugerido || perfil?.plano_sugerido || '').toLowerCase()
  if (plano === 'iniciante_assinatura') {
    // plano legado — tratar como iniciante normal, seguir guardrail
  }
  if (!textoIndicaVendaDiretaProjetoPersonalizado(texto)) return resultado
  if (!resultadoIndicaPorta2ProjetoPersonalizado(resultado, texto) && resultado.motivo_handoff !== 'aceitou_proposta') {
    return resultado
  }

  // Consulta agenda REAL. Se falhar ou nao houver slots, NAO inventa horarios:
  // devolve um pedido neutro ("Posso verificar os proximos horarios disponiveis?")
  // e o operador resolve manualmente — melhor que oferecer horario fictício.
  let sugestao = null
  if (typeof buscarSlots === 'function') {
    try {
      sugestao = await buscarSlots({ dataInicial: dataRef, quantidade: 2 })
    } catch {
      sugestao = null
    }
  }

  let bolhaMensagem
  if (sugestao && Array.isArray(sugestao.horarios_sugeridos) && sugestao.horarios_sugeridos.length > 0) {
    const [h1, h2] = sugestao.horarios_sugeridos
    const labelDia = LABEL_DIAS_GUARDRAIL[sugestao.data_label] || 'Amanha'
    bolhaMensagem = h2
      ? `Posso marcar uma conversa rápida com a equipe da PJ Codeworks para alinhar estrutura, prazo e investimento. ${labelDia} tenho ${h1} ou ${h2} disponíveis. Qual fica melhor?`
      : `Posso marcar uma conversa rápida com a equipe da PJ Codeworks para alinhar estrutura, prazo e investimento. ${labelDia} ainda tenho ${h1} disponível. Fica bom pra você?`
  } else {
    bolhaMensagem = `Posso marcar uma conversa rápida de até 15 minutos com a equipe da PJ Codeworks para alinhar estrutura, prazo e investimento. Posso verificar os próximos horários disponíveis?`
  }
  // Removida a bolha "No seu caso, isso entra como proposta personalizada para X" —
  // ela vazava como frase para o lead e abria espaco para argumentacao de venda
  // depois que o caminho ja estava decidido. A mensagem unica e mais direta.
  const bolhas = [bolhaMensagem]
  const atualizar_perfil = {
    ...(resultado.atualizar_perfil || {}),
    produto_sugerido: 'reuniao_proposta_personalizada',
    reuniao_proposta: {
      ...((resultado.atualizar_perfil && resultado.atualizar_perfil.reuniao_proposta) || {}),
      necessaria: true,
      data_sugerida: sugestao?.data_sugerida || null,
      horarios_sugeridos: Array.isArray(sugestao?.horarios_sugeridos) ? sugestao.horarios_sugeridos : [],
      horario_confirmado: null,
      duracao_maxima_minutos: 15,
      janela_permitida: 'segunda a sexta, 19:30 a 21:30',
      ultimo_inicio_permitido: '21:15',
    },
    eventos_conversa: {
      ...((resultado.atualizar_perfil && resultado.atualizar_perfil.eventos_conversa) || {}),
      reuniao_oferecida: true,
    },
  }
  return {
    ...resultado,
    mensagem_pro_lead: bolhas.join('\n\n'),
    mensagens_bolhas: bolhas,
    atualizar_perfil,
    etapa_proxima: 'proposta',
    solicitar_calculo_preco: false,
    handoff: false,
    motivo_handoff: null,
    resumo_handoff: null,
    links_sugeridos: [],
  }
}

function normalizarParsedRespostaVendas(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed
  const m = parsed.mensagem_pro_lead
  if (typeof m === 'string' && m.trim()) return parsed
  const alts = ['mensagem', 'texto', 'resposta', 'mensagem_para_lead', 'msg']
  for (const k of alts) {
    const v = parsed[k]
    if (typeof v === 'string' && v.trim()) {
      return { ...parsed, mensagem_pro_lead: v.trim() }
    }
  }
  return parsed
}

function extrairCampoStringJsonManual(texto, chaves) {
  if (!texto || typeof texto !== 'string') return ''
  const lista = Array.isArray(chaves) ? chaves : [chaves]
  for (const chave of lista) {
    const key = `"${String(chave || '').trim()}"`
    if (!key || key === '""') continue
    let i = texto.indexOf(key)
    if (i === -1) continue
    i = texto.indexOf(':', i + key.length)
    if (i === -1) continue
    i++
    while (i < texto.length && /\s/.test(texto[i])) i++
    if (texto[i] !== '"') continue
    i++
    let out = ''
    while (i < texto.length) {
      const c = texto[i]
      if (c === '\\') {
        const n = texto[i + 1]
        if (n === 'n') {
          out += '\n'
          i += 2
          continue
        }
        if (n === 'r') {
          out += '\r'
          i += 2
          continue
        }
        if (n === 't') {
          out += '\t'
          i += 2
          continue
        }
        if (n === '"') {
          out += '"'
          i += 2
          continue
        }
        if (n === '\\') {
          out += '\\'
          i += 2
          continue
        }
        if (n === 'u' && /^[0-9a-fA-F]{4}/.test(texto.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(texto.slice(i + 2, i + 6), 16))
          i += 6
          continue
        }
        if (n) {
          out += n
          i += 2
          continue
        }
      }
      if (c === '"') return out
      out += c
      i++
    }
  }
  return ''
}

/**
 * Extrai o valor string de campos esperados no texto bruto (escapes JSON).
 * Usado quando o parse falha em parte ou o fallback anterior enviava o JSON inteiro ao WhatsApp.
 */
function extrairMensagemProLeadStringManual(texto) {
  return extrairCampoStringJsonManual(texto, [
    'mensagem_pro_lead',
    'mensagem',
    'texto',
    'resposta',
    'mensagem_para_lead',
    'msg',
  ])
}

function extrairTextoLivreSeguroDoModelo(texto) {
  const s = limparSaidaTextoClaude(texto)
  if (!s) return ''
  if (/[{}[\]]/.test(s)) return ''
  if (/^(mensagem_pro_lead|mensagem|texto|resposta)\s*:/i.test(s)) return ''
  return resumirTextoOperacional(s, 2000)
}

function temTextoEnviavelResultadoVendas(r) {
  if (!r || typeof r !== 'object') return false
  if (Array.isArray(r.mensagens_bolhas) && r.mensagens_bolhas.length > 0) return true
  const t = r.mensagem_pro_lead
  return typeof t === 'string' && t.trim().length > 0
}

async function montarFallbackSeguroRespostaIA(historico = [], estagio = 'diagnostico', perfil = {}) {
  // Rede de emergencia MINIMA: quando a IA falha/retorna algo inutilizavel, NAO
  // recorremos mais a arvore de templates legada (decidirProximaResposta +
  // textoConexaoValor + montarPerguntaFaltante) — que reintroduzia perguntas
  // repetidas e textos roboticos. Enviamos UMA mensagem curta e segura e
  // acionamos handoff para a equipe da PJ Codeworks assumir.
  return resultadoParseadoParaObjeto(
    {
      mensagem_pro_lead: 'Deixa eu confirmar isso direitinho com a equipe da PJ Codeworks e já te respondo por aqui. 🙂',
      mensagens_bolhas: null,
      atualizar_perfil: {},
      etapa_proxima: normalizarEstagio(estagio, 'diagnostico'),
      solicitar_calculo_preco: false,
      handoff: true,
      motivo_handoff: 'falha_resposta_automatica',
    },
    estagio
  )
}

function montarFerramentasWebSearchAnthropic() {
  return [{ type: 'web_search_20250305', name: 'web_search', max_uses: CLAUDE_WEB_SEARCH_MAX_USES }]
}

/** Junta blocos `type: text` da resposta da Messages API (web_search, citações, etc.). */
function textoBrutoDosBlocosAssistantAnthropic(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const partes = []
  for (const bloco of content) {
    if (bloco && typeof bloco === 'object' && bloco.type === 'text' && typeof bloco.text === 'string') {
      partes.push(bloco.text)
    }
  }
  return partes.join('')
}

/**
 * POST /v1/messages com server tool web_search; se `stop_reason` for `pause_turn`, continua o turno (doc server-tools).
 */
async function anthropicMessagesComWebSearch({
  system,
  messages,
  max_tokens,
  model,
  numero = null,
  estagio = null,
  request_id = null,
  stale_retry = false,
}) {
  const headers = {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31,web-search-2025-03-05',
    'content-type': 'application/json',
  }
  const tools = montarFerramentasWebSearchAnthropic()
  const bodyBase = { model, max_tokens, system, tools }
  let conversation = messages.map((m) => ({ role: m.role, content: m.content }))
  let data = null
  const requestId = request_id || gerarRequestIdAnthropic()
  for (let i = 0; i < CLAUDE_WEB_SEARCH_PAUSE_MAX; i++) {
    const inicio = Date.now()
    let resp
    try {
      resp = await axios.post(
        ANTHROPIC_MESSAGES_URL,
        { ...bodyBase, messages: conversation },
        { headers, timeout: CLAUDE_TIMEOUT_COM_BUSCA_MS }
      )
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'funnel_web_search_round',
        numero,
        model,
        estagio,
        duration_ms: Date.now() - inicio,
        http_ok: true,
        http_status: resp.status,
        stop_reason: resp.data?.stop_reason || null,
        round_index: i + 1,
        stale_retry,
        usage: resp.data?.usage,
        metadata: { web_search: true },
      })
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'funnel_web_search_round',
        numero,
        model,
        estagio,
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        round_index: i + 1,
        stale_retry,
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
        metadata: { web_search: true },
      })
      throw e
    }
    data = resp.data
    if (data.stop_reason !== 'pause_turn') break
    conversation = [...conversation, { role: 'assistant', content: data.content }]
  }
  if (data && data.stop_reason === 'pause_turn') {
    logger.warn(
      '⚠️ Claude web_search: stop_reason pause_turn após',
      CLAUDE_WEB_SEARCH_PAUSE_MAX,
      'continuações — resposta pode estar incompleta'
    )
  }
  return data
}

async function chamarClaude(historico, estagio, perfil, visaoUltimaMensagem = null, opcoes = {}) {
  const mensagensApi = historicoParaClaude(historico, visaoUltimaMensagem)
  if (mensagensApi.length === 0) {
    throw new Error('Histórico vazio após normalização')
  }
  const ult = mensagensApi[mensagensApi.length - 1]
  if (ult.role !== 'user') {
    throw new Error('A última mensagem precisa ser do usuário (verifique duplicatas no histórico)')
  }

  const [aprendizado, aprendizadosAtivos, contextosInternos, jaRecebeuPreviewRes] = await Promise.all([
    buscarUltimoAprendizado(),
    buscarAprendizadosAtivos(),
    perfil?.numero ? buscarLeadContextos(perfil.numero, LEAD_CONTEXTO_PROMPT_LIMIT) : [],
    perfil?.numero
      ? pool.query(
        'SELECT 1 FROM vendas.eventos_comerciais WHERE numero = $1 AND tipo = $2 LIMIT 1',
        [perfil.numero, 'recebeu_preview']
      )
      : { rows: [] },
  ])
  const flags = {
    pedidosPreco: contarPedidosPrecoDoLead(historico),
    temPrecoCalculado: !!(perfil && perfil.precificacao_json),
    concorrentesReais: Array.isArray(perfil?.concorrentes) ? perfil.concorrentes : [],
    contextosInternos,
    jaRecebeuPreview: jaRecebeuPreviewRes.rows.length > 0,
    respostaProvavelmenteAutoReply: detectarAutoReplyEmContextoProspeccao(perfil, historico),
    aprendizadosAtivos,
    ...(opcoes?._flags_extras && typeof opcoes._flags_extras === 'object' ? opcoes._flags_extras : {}),
  }

  // Injeta contexto do pipeline determinístico no system prompt.
  // Não-destrutivo: se falhar, segue sem o bloco de contexto.
  // [REMOVIDO] Classificador de estagio em INGLES (conversation-pipeline /
  // buildConversationContext): injetava um bloco com vocabulario new_lead/
  // qualification/diagnosis no prompt a cada turno, divergente do vocabulario PT
  // do funil — risco de empurrar a IA para um estagio errado (drift PT<->EN).
  // O turn-context-reader (PT, abaixo) ja cobre o contexto de turno.

  try {
    const { buildTurnContext } = require('./turn-context-reader')
    const msgs = normalizarHistoricoMensagens(historico)
    const ultimaUser = [...msgs].reverse().find((m) => m?.role === 'user')
    const textoUltima = ultimaUser ? textoDeContent(ultimaUser.content).trim() : ''
    const turnContext = buildTurnContext({
      historico: msgs,
      perfil,
      estagio,
      mensagemAtual: textoUltima,
    })
    flags.turnContextBlock = turnContext.prompt_block
  } catch (_) { /* turn context e guia de prompt; nao bloqueia o fluxo */ }

  const systemPrompt = opcoes?.nextActionContext
    ? montarSystemPromptAcaoDeterministica(opcoes.nextActionContext)
    : montarSystemPromptDinamico(estagio, perfil, aprendizado, flags, historico)
  const requestId = opcoes?.request_id || gerarRequestIdAnthropic()
  const staleRetry = opcoes?.stale_retry === true

  // Le configuracao centralizada do motor de IA — provedor/modelo selecionado pelo dashboard.
  const settings = await aiProvider.getAISettings(pool).catch(() => null)
  const provider = settings?.provider || 'anthropic'

  // Sanitize surrogates uma unica vez para qualquer caminho
  const sanitizedSystem = sanitizarLoneSurrogates(systemPrompt)
  const sanitizedMessages = mensagensApi.map((m) => {
    if (typeof m.content === 'string') return { ...m, content: sanitizarLoneSurrogates(m.content) }
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((b) =>
          b && typeof b === 'object' && typeof b.text === 'string'
            ? { ...b, text: sanitizarLoneSurrogates(b.text) }
            : b
        ),
      }
    }
    return m
  })

  let bruto = ''
  // web_search e exclusivo do Anthropic. So usar quando o provedor ATIVO for anthropic.
  if (claudeWebSearchHabilitado() && estagio === 'diagnostico' && provider === 'anthropic') {
    const data = await anthropicMessagesComWebSearch({
      system: sanitizedSystem,
      messages: sanitizedMessages,
      max_tokens: opcoes?.max_tokens_override || 2000,
      model: settings?.model || 'claude-sonnet-4-6',
      numero: perfil?.numero || null,
      estagio,
      request_id: requestId,
      stale_retry: staleRetry,
    })
    bruto =
      textoBrutoDosBlocosAssistantAnthropic(data?.content) ||
      (data?.content && data.content[0] && data.content[0].text) ||
      ''
  } else {
    // Caminho normal: roteia para o motor central, que respeita a configuracao
    // (provider, model, temperature, max_tokens, fallback) salva no banco.
    const inicio = Date.now()
    try {
      const result = await aiProvider.generateAIResponse(
        {
          systemPrompt: sanitizedSystem,
          messages: sanitizedMessages,
          task: `agent_funnel:${estagio || 'desconhecido'}`,
          maxTokens: opcoes?.max_tokens_override || 2000,
          timeoutMs: CLAUDE_TIMEOUT_MS,
          extraHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
          responseFormatJson: true,
          // Structured Outputs (só atua no caminho OpenAI; Anthropic ignora e segue json_object).
          responseSchema: AGENT_RESPONSE_SCHEMA,
        },
        pool,
        logger
      )
      bruto = String(result?.text || '')
      // Registra metrica historica (Anthropic-specific table) somente quando o provedor real foi Anthropic
      if (result?.provider === 'anthropic') {
        await registrarChamadaAnthropic({
          request_id: requestId,
          tipo: 'funnel',
          numero: perfil?.numero || null,
          model: result.model,
          estagio,
          duration_ms: Date.now() - inicio,
          http_ok: true,
          http_status: result.httpStatus,
          stop_reason: result.stopReason || null,
          stale_retry: staleRetry,
          usage: result.usage,
          metadata: { web_search: false, fallback_used: result.fallback_used === true },
        })
      }
    } catch (e) {
      await registrarChamadaAnthropic({
        request_id: requestId,
        tipo: 'funnel',
        numero: perfil?.numero || null,
        model: settings?.model || 'desconhecido',
        estagio,
        duration_ms: Date.now() - inicio,
        http_ok: false,
        http_status: statusHttpDeErroAnthropic(e),
        stale_retry: staleRetry,
        erro_codigo: codigoErroAnthropic(e),
        erro_msg: mensagemErroAnthropic(e),
        metadata: { web_search: false },
      })
      throw e
    }
  }

  if (!String(bruto || '').trim()) {
    throw new Error('Resposta vazia do motor de IA após normalização dos blocos de texto')
  }
  const respostaIA = parseAiResponse(bruto, { channel: 'whatsapp' })
  logger.info(`[AI_ENGINE] response parse status: ${respostaIA.parseSuccess ? 'success' : 'failure'}`)
  logger.info(`[AI_RESPONSE] raw received: ${Boolean(bruto)}`)
  logger.info(`[AI_RESPONSE] code fence detected: ${respostaIA.codeFenceDetected === true}`)
  logger.info(`[AI_RESPONSE] json parse success: ${respostaIA.parseSuccess === true}`)
  logger.info(`[AI_RESPONSE] schema valid: ${respostaIA.schemaValid === true}`)
  logger.info(`[AI_RESPONSE] bubbles count: ${respostaIA.bubblesCount || 0}`)
  logger.info(`[AI_RESPONSE] public messages generated: ${respostaIA.ok === true}`)
  logger.info(`[AI_SEND_GUARD] blocked raw json leak: ${respostaIA.guardBlocked === true}`)
  logger.info('[AI_SEND_GUARD] channel: whatsapp')
  if (respostaIA.issues && respostaIA.issues.length) {
    for (const violacao of respostaIA.issues) {
      logger.warn(`[schema-violation] ${violacao.path}: ${violacao.message}`, {
        numero: perfil?.numero || null,
        estagio,
      })
    }
  }
  const parsed = respostaIA.ok && respostaIA.value ? normalizarParsedRespostaVendas(respostaIA.value) : null

  if (parsed) {
    const resultado = resultadoParseadoParaObjeto(parsed, estagio)
    if (temTextoEnviavelResultadoVendas(resultado)) return resultado
    const manual = extrairMensagemProLeadStringManual(bruto)
    if (manual && manual.trim()) {
      resultado.mensagem_pro_lead = manual.trim()
      return resultado
    }
    throw new Error('Modelo retornou JSON sem mensagem utilizável para o lead (mensagem_pro_lead vazio)')
  }

  const manualSozinho = extrairMensagemProLeadStringManual(bruto)
  if (manualSozinho && manualSozinho.trim()) {
    return resultadoParseadoParaObjeto(
      {
        mensagem_pro_lead: manualSozinho.trim(),
        handoff: false,
        motivo_handoff: null,
        atualizar_perfil: {},
      },
      estagio
    )
  }

  const textoLivre = ''
  if (textoLivre) {
    const textoFallback = reforcarContinuidadeEmFallback(textoLivre, historico, estagio)
    return resultadoParseadoParaObjeto(
      {
        mensagem_pro_lead: textoFallback,
        handoff: false,
        motivo_handoff: null,
        atualizar_perfil: {},
      },
      estagio
    )
  }

  logger.warn('[AI_ENGINE] resposta fora de JSON; usando fallback seguro sem enviar texto cru', {
    numero: perfil?.numero || null,
    estagio,
  })
  return montarFallbackSeguroRespostaIA(historico, estagio, perfil)
}

/**
 * Coach interno (dashboard): decisão operacional + prompt para Gamma; não envia mensagem ao lead.
 */
function reprocessarAutorizado(req) {
  if (dashboardAutorizado(req)) return true
  // REPROCESS_SECRET é garantido pelo validarSecretsBoot — se ausente, processo aborta no boot.
  // Antes permitia fallback "return true" se secret faltasse; removido em 2026-04-23 porque
  // abria o dashboard inteiro quando admin esquecesse de configurar.
  const secret = process.env.REPROCESS_SECRET
  if (!secret) return false
  return req.headers['x-reprocess-secret'] === secret
}

function webhookBearerSecretConfere(authHeader, webhookSecret) {
  if (authHeader == null || typeof authHeader !== 'string') return false
  const t = authHeader.trim()
  const m = /^Bearer\s+(\S+)$/i.exec(t)
  return Boolean(m && m[1] === webhookSecret)
}

/** POST /webhook: REPROCESS_SECRET (x-reprocess-secret) e/ou WEBHOOK_SECRET (x-webhook-secret ou Authorization Bearer). */
function webhookAutorizado(req) {
  if (reprocessarAutorizado(req)) return true
  const wh = process.env.WEBHOOK_SECRET
  if (wh == null || wh === '') return false
  if (req.headers['x-webhook-secret'] === wh) return true
  if (webhookBearerSecretConfere(req.headers['authorization'], wh)) return true
  return false
}

function parteTelefoneDoUserJid(local) {
  if (!local || typeof local !== 'string') return ''
  const i = local.indexOf(':')
  return i === -1 ? local : local.slice(0, i)
}

/**
 * Aceita JID completo ou apenas dígitos; alinha ao formato armazenado (ex.: 5511...@s.whatsapp.net).
 * Números BR sem DDI (10–11 dígitos) recebem prefixo 55.
 */
function normalizarNumeroParaJid(raw) {
  if (raw == null || typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  let digits
  if (/@s\.whatsapp\.net/i.test(s)) {
    const local = s.split('@')[0] || ''
    digits = parteTelefoneDoUserJid(local).replace(/\D/g, '')
  } else {
    digits = s.replace(/\D/g, '')
  }
  if (!digits) return null
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = `55${digits}`
  }
  return `${digits}@s.whatsapp.net`
}

/** Operadores: banco como fonte principal, OPERATOR_WHATSAPP/VICTOR_WHATSAPP como seed legado. */
/**
 * Parseia as entradas de OPERATOR_WHATSAPP no formato "número" ou "número:Nome".
 * Retorna array de { jid, nome }.
 * Exemplo: "5511987309724:Victor,5511888888888:Joãozinho"
 */
function _parsearEntradasOperadores() {
  const raw = process.env.OPERATOR_WHATSAPP || process.env.VICTOR_WHATSAPP || ''
  return raw
    .split(',')
    .map(s => {
      const [numPart, ...nomeParts] = s.trim().split(':')
      const jid = normalizarNumeroParaJid(numPart.trim())
      const nome = nomeParts.join(':').trim() || null
      return jid ? { jid, nome } : null
    })
    .filter(Boolean)
}

function numeroDisplayDoJid(jid) {
  return String(jid || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
}

function normalizarEntradaOperador(raw, idx = 0) {
  const obj = typeof raw === 'object' && raw !== null ? raw : {}
  const jid = normalizarNumeroParaJid(String(obj.jid || obj.numero || '').trim())
  if (!jid) return null
  const nomeRaw = String(obj.nome || '').trim()
  return {
    id: obj.id != null ? Number(obj.id) || null : null,
    nome: nomeRaw ? nomeRaw.slice(0, 80) : null,
    numero: numeroDisplayDoJid(jid),
    jid,
    ativo: Object.prototype.hasOwnProperty.call(obj, 'ativo') ? !!obj.ativo : true,
    recebe_alertas: Object.prototype.hasOwnProperty.call(obj, 'recebe_alertas') ? !!obj.recebe_alertas : true,
    ordem: idx,
  }
}

function operadoresDoEnv() {
  return _parsearEntradasOperadores().map((op, idx) => ({
    id: null,
    nome: op.nome,
    numero: numeroDisplayDoJid(op.jid),
    jid: op.jid,
    ativo: true,
    recebe_alertas: true,
    origem: 'env',
    ordem: idx,
  }))
}

function dedupeOperadores(operadores) {
  const vistos = new Set()
  const out = []
  for (const op of operadores || []) {
    const norm = normalizarEntradaOperador(op, out.length)
    if (!norm || vistos.has(norm.jid)) continue
    vistos.add(norm.jid)
    out.push({ ...op, ...norm })
  }
  return out
}

/**
 * Lista de JIDs de todos os operadores autorizados.
 * Suporta múltiplos números separados por vírgula em OPERATOR_WHATSAPP:
 *   OPERATOR_WHATSAPP="5511999999999,5511888888888"
 *   OPERATOR_WHATSAPP="5511999999999:Victor,5511888888888:Joãozinho"
 */
function jidOperadoresDoEnv() {
  return operadoresDoEnv().map(e => e.jid)
}

/**
 * Retorna o nome configurado para o JID do operador.
 * Se não configurado com "número:Nome", retorna null (cai pro pushName do WhatsApp).
 */
async function semearOperadoresDoEnvSeNecessario() {
  const envOps = operadoresDoEnv()
  if (envOps.length === 0) return []
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM vendas.operadores')
  if ((rows[0]?.n || 0) > 0) return []
  for (const op of envOps) {
    await pool.query(
      `INSERT INTO vendas.operadores (nome, numero, jid, ativo, recebe_alertas)
       VALUES ($1, $2, $3, true, true)
       ON CONFLICT (jid) DO NOTHING`,
      [op.nome, op.numero, op.jid]
    )
  }
  return envOps
}

async function listarOperadoresConfigurados() {
  await semearOperadoresDoEnvSeNecessario()
  const { rows } = await pool.query(
    `SELECT id, nome, numero, jid, ativo, recebe_alertas, criado_em, atualizado_em
     FROM vendas.operadores
     ORDER BY id ASC`
  )
  if (rows.length > 0) return dedupeOperadores(rows)
  return dedupeOperadores(operadoresDoEnv())
}

async function listarOperadoresAtivos(opts = {}) {
  const alertas = opts.alertas === true
  const ops = await listarOperadoresConfigurados()
  return ops.filter(op => op.ativo && (!alertas || op.recebe_alertas))
}

async function jidOperadorPrincipal() {
  const ops = await listarOperadoresAtivos()
  return ops[0]?.jid || null
}

async function nomeOperadorPorJid(jid) {
  const ops = await listarOperadoresConfigurados()
  const entrada = ops.find(e => jidIgual(e.jid, jid))
  return entrada?.nome ?? null
}

function jidIgual(a, b) {
  const ja = normalizarNumeroParaJid(String(a || '').trim())
  const jb = normalizarNumeroParaJid(String(b || '').trim())
  return ja != null && jb != null && ja === jb
}

/**
 * WhatsApp pode enviar `remoteJid` como `...@lid`; o JID de telefone vem em `remoteJidAlt` (Baileys 6.8+).
 * Sem isso, o backend não bate com `vendas.conversas.numero` nem com OPERATOR_WHATSAPP.
 */
/** Garante `5511...@s.whatsapp.net` sem sufixo `:device` (Evolution/Baileys às vezes envia). */
function jidTelefoneSemSufixoDispositivo(jid) {
  if (!jid || typeof jid !== 'string') return null
  if (!/@s\.whatsapp\.net$/i.test(jid)) return jid
  const local = jid.split('@')[0] || ''
  const digits = parteTelefoneDoUserJid(local).replace(/\D/g, '')
  if (!digits) return jid
  let d = digits
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('55')) d = `55${d}`
  return `${d}@s.whatsapp.net`
}

function canonicoRemoteJidParaConversa(key) {
  if (!key || typeof key !== 'object') return null
  const jid = key.remoteJid
  const alt = key.remoteJidAlt
  if (typeof jid === 'string' && /@s\.whatsapp\.net$/i.test(jid)) return jidTelefoneSemSufixoDispositivo(jid)
  if (typeof alt === 'string' && /@s\.whatsapp\.net$/i.test(alt)) return jidTelefoneSemSufixoDispositivo(alt)
  if (typeof jid === 'string') return jid
  return null
}

/** Conversa 1:1 com lead (exclui grupos e broadcast). Inclui `@lid` quando ainda não há PN no evento. */
function isConversaLeadUmAUm(remoteJid) {
  if (!remoteJid || typeof remoteJid !== 'string') return false
  if (/@g\.us$/i.test(remoteJid) || /@broadcast$/i.test(remoteJid)) return false
  return /@s\.whatsapp\.net$/i.test(remoteJid) || /@lid$/i.test(remoteJid)
}

/**
 * @returns {null | { tipo: 'pausar'|'retomar'|'instrucao', jidLead: string, instrucao?: string }}
 */
const followupExecution = createFollowupExecution({
  axios,
  pool,
  aiProvider,
  logger,
  prompts,
  normalizarHistoricoMensagens,
  buscarLeadContextos,
  montarBlocoContextoInterno,
  buscarAprendizadosAtivos,
  montarBlocoCorrecoesAprendizados,
  gerarRequestIdAnthropic,
  registrarChamadaAnthropic,
  statusHttpDeErroAnthropic,
  codigoErroAnthropic,
  mensagemErroAnthropic,
  parsearRespostaJsonClaude,
  buscarConversa,
  gerarEEnviarRespostaWhatsapp: (...args) => gerarEEnviarRespostaWhatsapp(...args),
  buscarPerfil,
  enviarMensagem,
  salvarConversa,
  registrarFollowupEnvio,
  getContextoAtivoEmpresa,
  gerarFollowupComPlaybook,
})
const {
  perfilResumidoParaFollowup,
  formatarIntervaloAproximadoPt,
  contextoTempoFollowup,
  textoBlocoContextoTempoFollowup,
  textoBlocoPrecificacaoFollowup,
  chamarClaudeFollowup,
  executarFollowupUmNumero,
} = followupExecution

const followupAuto = createFollowupAuto({
  pool,
  logger,
  axios,
  aiProvider,
  prompts,
  partesDataEmTimezone,
  utcParaDataLocalEmTimezone,
  adicionarDiasLocalEmTimezone,
  buscarAprendizadosAtivos,
  montarBlocoCorrecoesAprendizados,
  perfilResumidoParaFollowup,
  gerarRequestIdAnthropic,
  registrarChamadaAnthropic,
  statusHttpDeErroAnthropic,
  codigoErroAnthropic,
  mensagemErroAnthropic,
  parsearRespostaJsonClaude,
  normalizarHistoricoMensagens,
  executarFollowupUmNumero,
})
const {
  sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup,
  cancelarFollowupsAutoPendentes,
  persistirAgendamentoFollowupExplicito,
  iniciarSilenceWatcher,
  processarFollowupAutoJob,
} = followupAuto

/**
 * Cópia do histórico com nota interna na última mensagem do cliente (só para o Claude; não persistir).
 */
function construirChaveIdempotenciaWebhookMensagem(msg) {
  const id = msg?.key?.id
  if (id == null || id === '') return null
  const rj = String(msg.key.remoteJid || msg.key.participant || '')
  return `${rj}|${id}`
}

const mediaProcessing = createMediaProcessing({
  whatsapp,
  logger,
  registrarAudioProcessamento,
  canonicoRemoteJidParaConversa,
  construirChaveIdempotenciaWebhookMensagem,
})
const {
  limparBase64String,
  mimeImagemParaClaude,
  transcreverAudioLocal,
  localizarAudioPartMensagem,
  baixarETranscreverAudioMensagem,
  processarImagemWebhook,
  processarAudioWebhook,
  extrairTextoInterativo,
  extrairTextoEMidiaDoWebhook,
} = mediaProcessing

const operatorCommands = createOperatorCommands({
  pool,
  logger,
  axios,
  aiProvider,
  normalizarNumeroParaJid,
  normalizarHistoricoMensagens,
  extrairTextoEMidiaDoWebhook,
  buscarConversa,
  salvarConversa,
  cancelarFollowupsAutoPendentes,
  limparDebounceResposta,
  nomeOperadorPorJid,
  enviarMensagem,
  extrairTextoInterativo,
  gerarRequestIdAnthropic,
  registrarChamadaAnthropic,
  statusHttpDeErroAnthropic,
  codigoErroAnthropic,
  mensagemErroAnthropic,
  buscarPerfil,
  gerarApresentacaoOperador,
  enviarPrintLocal,
  executarFollowupUmNumero,
})
const {
  parseComandoOperadorWhatsApp,
  normalizarParaComparacaoEco,
  ehEcoDoAgente,
  processarIntervencaoOperadorNoLead,
  montarMenuOperador,
  enviarMenuListaOperador,
  textoAgendamentosOperador,
  textoRelatorioOperador,
  executarOpcaoOperador,
  textoAjudaOperadorProgramada,
  processarMensagemLivreOperador,
  executarSimulacaoLead,
  chamarClaudeAssistenteOperador,
  processarComandosOperadorChat,
} = operatorCommands

const previewSite = createPreviewSite({
  axios,
  logger,
  OPENAI_KEY,
  chamarClaudeAuxiliar,
  enviarImagemBase64,
  enviarMensagem,
  registrarEventoComercial,
  normalizarHistoricoMensagens,
  textoDeContent,
  limparBase64String,
  mimeImagemParaClaude,
})
const {
  PREVIEW_SITE_MODELOS,
  caseDeReferenciaPorNicho,
  montarPreviewSiteCaption,
  gerarCaptionPreview,
  dadosPreviewSite,
  montarPromptWireframe,
  escolherEstiloWireframe,
  gerarWireframeComGPT,
  montarPreviewSiteHtml,
  montarPreviewSiteSvg,
  gerarPreviewSite,
  gerarEEnviarPreviewSite,
  gerarMensagemPosPreviewFallback,
  gerarMensagemPosPreview,
  gerarImagemOpenAiPorPrompt,
} = previewSite

const handoffAlerts = createHandoffAlerts({
  axios,
  logger,
  enviarMensagem,
  listarOperadoresAtivos,
  numeroDisplayDoJid,
  resumirTextoOperacional,
  gerarImagemOpenAiPorPrompt,
  criarEventoAgenda,
  slotEstaOcupado,
})
const {
  obterHoraLocalBrasil,
  estaNoHorarioRedirecionamentoImediatoVictor,
  textoContextoHorarioVictorParaPrompt,
  alertarHandoff,
  alertarLacunaConhecimento,
  notificarVictorWhatsapp,
  alertarVendaFechadaOperadores,
  deveAlertarFalhaResposta,
  alertarFalhaResposta,
  alertarReagendamentoReuniao,
} = handoffAlerts

/**
 * Geração de TEXTO LIVRE pela IA (Motor de IA / generateAIResponse). Usado para
 * dar tom humano a mensagens cujos FATOS sao deterministicos (ex.: convite e
 * confirmacao de reuniao) — o chamador valida que os fatos foram preservados.
 * Retorna a string gerada ou null em qualquer falha (chamador usa o fallback).
 */
async function gerarTextoIA({ system, user, maxTokens = 200, temperature = 0.5, task = 'reformulacao_texto' }) {
  try {
    const r = await aiProvider.generateAIResponse(
      { systemPrompt: system, userPrompt: user, maxTokens, temperature, task, timeoutMs: 12000 },
      pool,
      logger
    )
    const t = String(r?.text || '').trim()
    return t || null
  } catch (e) {
    logger.warn('⚠️ gerarTextoIA falhou:', e.message)
    return null
  }
}

const coreFunnel = createCoreFunnel({
  logger,
  pool,
  gerarTextoIA,
  normalizarHistoricoMensagens,
  buscarConversa,
  buscarPerfil,
  garantirConcorrentesReaisNoPerfil,
  diagnosticoCompletoParaPreco,
  calcularPreco,
  atualizarPerfil,
  chamarClaude,
  historicoCresceuSoComUsers,
  aplicarGuardrailReuniaoProposta,
  buscarSlotsDisponiveis,
  buscarDisponibilidadeSemana,
  validarSlotReuniao,
  gerarPreviaValorIA,
  sanitizarPlaceholderEmpresaNaSaidaTexto,
  sanitizarCpfNaSaidaTexto,
  enviarPrintLocal,
  filtrarLinksSugeridosParaEnvio,
  enviarComBotoes,
  enviarMensagem,
  enviarSequenciaMensagens,
  extrairValoresReaisDoTextoBrasil,
  registrarEventoComercial,
  gerarEEnviarPreviewSite,
  salvarConversa,
  limparFalhaResposta,
  persistirAgendamentoFollowupExplicito,
  atualizarCamadaMemoriaVendasPosResposta,
  registrarLacunaConhecimento,
  alertarLacunaConhecimento,
  marcarFechada,
  alertarVendaFechadaOperadores,
  gerarAprendizado,
  notificarVictorWhatsapp,
  alertarHandoff,
  decidirProximaResposta,
  interpretarIntencaoMensagemIA,
  podeGerarRespostaAutomatica,
  parsearHorarioReuniao,
  calcularFimReuniao,
  dataInicioReuniao,
  getContextoAtivoEmpresa,
  processarMensagemComPlaybook,
  getContextoAtivoComEstagios,
  empresaAgentePausada,
})
;({ gerarEEnviarRespostaWhatsapp } = coreFunnel)

const DASHBOARD_CONVERSA_SELECT = `
      SELECT c.numero, c.estagio, c.status, c.venda_fechada, c.agente_pausado, c.arquivado,
             c.motivo_arquivamento, c.arquivado_em,
             jsonb_array_length(c.historico) AS mensagens, c.criado_em, c.atualizado_em,
             c.ultima_falha_resposta_codigo, c.ultima_falha_resposta_msg, c.ultima_falha_resposta_em,
             p.negocio, p.apelido, p.cidade, p.preco_calculado, p.termometro_dor, p.temperatura_lead,
             p.origem, p.origem_anuncio, p.produto_sugerido, p.score_lead,
             NULLIF(p.insights_lead->>'urgencia', '') AS urgencia_lead,
             COALESCE(p.preco_ia_divergente_motor, false) AS preco_ia_divergente_motor,
             p.ia_total_projeto_detectado_ultima_resposta,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN c.historico->-1->>'role'
                  ELSE NULL
             END AS ultima_role,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN LEFT(REGEXP_REPLACE(COALESCE(c.historico->-1->>'content', ''), '\\s+', ' ', 'g'), 180)
                  ELSE ''
             END AS ultima_preview,
             (
               SELECT MIN(fa.agendado_para)
               FROM vendas.followup_auto_agendamentos fa
               WHERE fa.numero = c.numero
                 AND fa.status = 'agendado'
             ) AS followup_auto_em,
             (
               SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (MIN(fa.agendado_para) - NOW())) / 60))::int
               FROM vendas.followup_auto_agendamentos fa
               WHERE fa.numero = c.numero
                 AND fa.status = 'agendado'
             ) AS followup_auto_minutos,
             GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.atualizado_em)) / 60))::int AS idade_minutos,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                  THEN (c.historico->-1->>'role') = 'user'
                  ELSE false
             END AS resposta_pendente,
             (c.ultima_falha_resposta_em IS NOT NULL) AS erro_resposta_pendente,
             CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                       AND (c.historico->-1->>'role') = 'user'
                       AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                       AND (c.historico->-1->>'content')
                         ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                       AND (p.precificacao_json IS NULL)
                       AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                  THEN true ELSE false
             END AS lead_fila_preco_sem_calculo,
             CASE
               WHEN c.ultima_falha_resposta_em IS NOT NULL THEN 'falha_resposta'
               WHEN c.status = 'aguardando_handoff' THEN 'handoff'
               WHEN COALESCE(p.preco_ia_divergente_motor, false) = true THEN 'preco_divergente'
               WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                    AND (c.historico->-1->>'role') = 'user'
                    AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                    AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                    AND (p.precificacao_json IS NULL)
                    AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                 THEN 'fila_preco'
               WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                    AND (c.historico->-1->>'role') = 'user'
                 THEN 'precisa_responder'
               WHEN c.agente_pausado = true THEN 'agente_pausado'
               ELSE 'acompanhamento'
             END AS prioridade_operacional,
             ARRAY_REMOVE(ARRAY[
               CASE WHEN c.ultima_falha_resposta_em IS NOT NULL THEN 'Falha na resposta' END,
               CASE WHEN c.status = 'aguardando_handoff' THEN 'Handoff/aprovação' END,
               CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                         AND (c.historico->-1->>'role') = 'user'
                    THEN 'Precisa responder' END,
               CASE WHEN COALESCE(jsonb_array_length(c.historico), 0) > 0
                         AND (c.historico->-1->>'role') = 'user'
                         AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
                         AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
                         AND (p.precificacao_json IS NULL)
                         AND (p.preco_calculado IS NULL OR p.preco_calculado = 0)
                    THEN 'Fila de preço' END,
               CASE WHEN COALESCE(p.preco_ia_divergente_motor, false) = true THEN 'Preço divergente' END,
               CASE WHEN c.agente_pausado = true THEN 'Agente pausado' END
             ], NULL) AS motivos_prioridade
      FROM vendas.conversas c
      LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
`

function parseDashboardListQuery(req, opts) {
  const q = req.query || {}
  const maxLimit = opts && typeof opts.maxLimit === 'number' ? opts.maxLimit : 500
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), maxLimit)
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0)
  const estagioRaw = q.estagio != null && String(q.estagio).trim() !== '' ? String(q.estagio).trim() : null
  const estagio = estagioRaw === 'todos' || estagioRaw === '' ? null : estagioRaw
  const desde = q.desde != null && String(q.desde).trim() !== '' ? String(q.desde).trim().slice(0, 10) : null
  const ate = q.ate != null && String(q.ate).trim() !== '' ? String(q.ate).trim().slice(0, 10) : null
  const ordenar = q.ordenar === 'criado' ? 'criado' : 'atualizado'
  const direcao = q.direcao === 'asc' ? 'asc' : 'desc'
  const filaPreco =
    q.fila_preco === '1' ||
    q.fila_preco === 'true' ||
    String(q.fila_preco || '')
      .trim()
      .toLowerCase() === 'sim'
  const precoDivergente =
    q.preco_divergente === '1' ||
    q.preco_divergente === 'true' ||
    String(q.preco_divergente || '')
      .trim()
      .toLowerCase() === 'sim'
  const busca = q.busca != null ? String(q.busca).trim() : null
  const motivo = q.motivo != null ? String(q.motivo).trim() : null
  const temperatura = q.temperatura != null ? String(q.temperatura).trim() : null
  const origem = ['prospeccao', 'meta_ads', 'organico'].includes(String(q.origem || '').trim())
    ? String(q.origem).trim()
    : null
  const urgencia = ['alta', 'media', 'baixa'].includes(String(q.urgencia || '').trim())
    ? String(q.urgencia).trim()
    : null
  const scoreMin = Math.min(100, Math.max(0, parseInt(q.score_min, 10) || 0))
  const followup = ['hoje', 'vencido'].includes(String(q.followup || '').trim()) ? String(q.followup).trim() : null
  const acaoAgora = q.acao_agora === '1' || q.acao_agora === 'true'
  const arquivado = q.arquivado === '1' || q.arquivado === 'true'
  return {
    limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente,
    busca, motivo, temperatura, origem, urgencia, scoreMin, followup, acaoAgora, arquivado,
  }
}

/** WHERE para listagem/export; estagio === 'fechado' filtra vendas fechadas. */
function buildWhereConversasFiltros(estagio, desde, ate, extras = {}) {
  const parts = []
  const params = []
  let i = 1
  if (estagio === 'fechado') {
    parts.push('c.venda_fechada = true')
  } else if (estagio) {
    parts.push(`(c.venda_fechada = false AND c.estagio = $${i})`)
    params.push(estagio)
    i++
  }
  if (desde) {
    parts.push(`c.atualizado_em >= $${i}::date`)
    params.push(desde)
    i++
  }
  if (ate) {
    parts.push(`c.atualizado_em < ($${i}::date + interval '1 day')`)
    params.push(ate)
    i++
  }
  if (extras && extras.busca) {
    parts.push(`(
      c.numero ILIKE $${i}
      OR p.negocio ILIKE $${i}
      OR p.apelido ILIKE $${i}
      OR COALESCE(c.historico->-1->>'content', '') ILIKE $${i}
    )`)
    params.push(`%${extras.busca}%`)
    i++
  }
  if (extras && extras.temperatura) {
    parts.push(`p.temperatura_lead = $${i}`)
    params.push(extras.temperatura)
    i++
  }
  if (extras && extras.origem) {
    if (extras.origem === 'organico') {
      parts.push(`COALESCE(p.origem, 'inbound') IN ('inbound', 'organico')`)
    } else {
      parts.push(`p.origem = $${i}`)
      params.push(extras.origem)
      i++
    }
  }
  if (extras && extras.urgencia) {
    parts.push(`p.insights_lead->>'urgencia' = $${i}`)
    params.push(extras.urgencia)
    i++
  }
  if (extras && extras.scoreMin) {
    parts.push(`COALESCE(p.score_lead, 0) >= $${i}`)
    params.push(extras.scoreMin)
    i++
  }
  if (extras && extras.followup) {
    const duePredicate =
      extras.followup === 'vencido'
        ? 'fa.agendado_para <= NOW()'
        : `fa.agendado_para >= date_trunc('day', NOW())
           AND fa.agendado_para < date_trunc('day', NOW()) + interval '1 day'`
    parts.push(`EXISTS (
      SELECT 1 FROM vendas.followup_auto_agendamentos fa
      WHERE fa.numero = c.numero AND fa.status = 'agendado' AND ${duePredicate}
    )`)
  }
  if (extras && extras.acaoAgora) {
    parts.push(`(
      c.ultima_falha_resposta_em IS NOT NULL
      OR c.status = 'aguardando_handoff'
      OR (COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')
    )`)
  }
  if (extras && extras.motivo) {
    // A coluna prioridade_operacional é calculada no SELECT, mas no WHERE usamos a lógica original
    const mot = extras.motivo
    if (mot === 'falha_resposta') parts.push('c.ultima_falha_resposta_em IS NOT NULL')
    else if (mot === 'handoff') parts.push("c.status = 'aguardando_handoff'")
    else if (mot === 'preco_divergente') parts.push('COALESCE(p.preco_ia_divergente_motor, false) = true')
    else if (mot === 'agente_pausado') parts.push('c.agente_pausado = true')
    else if (mot === 'acompanhamento') {
        parts.push(`(
            c.ultima_falha_resposta_em IS NULL AND 
            c.status != 'aguardando_handoff' AND 
            COALESCE(p.preco_ia_divergente_motor, false) = false AND 
            c.agente_pausado = false AND
            NOT (COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')
        )`)
    }
    else if (mot === 'precisa_responder') {
        parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')`)
    }
    else if (mot === 'fila_preco') {
        parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0
          AND (c.historico->-1->>'role') = 'user'
          AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
          AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
          AND (p.precificacao_json IS NULL)
          AND (p.preco_calculado IS NULL OR p.preco_calculado = 0))`)
    }
  }
  if (extras && extras.filaPreco) {
    parts.push(`(COALESCE(jsonb_array_length(c.historico), 0) > 0
      AND (c.historico->-1->>'role') = 'user'
      AND COALESCE(c.historico->-1->>'content', '') NOT LIKE '[Operador humano]:%'
      AND (c.historico->-1->>'content') ~* '(quanto|pre[cç]o|valor|investimento|or[cç]amento|custa|orcamento)'
      AND (p.precificacao_json IS NULL)
      AND (p.preco_calculado IS NULL OR p.preco_calculado = 0))`)
  }
  if (extras && extras.precoDivergente) {
    parts.push('COALESCE(p.preco_ia_divergente_motor, false) = true')
  }
  if (extras && extras.arquivado) {
    parts.push('c.arquivado = true')
  } else {
    parts.push('c.arquivado = false')
  }
  const where = parts.length ? parts.join(' AND ') : 'TRUE'
  return { where, params, nextParamIndex: i }
}

function csvEscapeCell(val) {
  if (val == null) return ''
  const s = String(val)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Constrói a query SQL para /dashboard/stats/diario com suporte a filtros de estágio e data.
 * Retorna { query, params, mode } onde mode é 'dual' (Todos) ou 'single' (estágio específico).
 * Bounds de data: se desde/ate fornecidos, usam esses; caso contrário usa os últimos `dias` dias.
 */
function buildDiarioQuery(estagio, dias, desde, ate) {
  const params = []
  let boundsExpr

  if (desde && ate) {
    params.push(desde, ate)
    boundsExpr = `SELECT $1::date AS d0, $2::date AS d1`
  } else if (desde) {
    params.push(desde)
    boundsExpr = `SELECT $1::date AS d0, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS d1`
  } else if (ate) {
    params.push(ate, dias)
    boundsExpr = `SELECT ($1::date - ($2::int - 1))::date AS d0, $1::date AS d1`
  } else {
    params.push(dias)
    boundsExpr = `SELECT (((NOW() AT TIME ZONE 'America/Sao_Paulo')::date) - ($1::int - 1))::date AS d0, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS d1`
  }

  const nextIdx = params.length + 1

  if (!estagio) {
    const query = `
      WITH bounds AS (${boundsExpr}),
      days AS (
        SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
        FROM bounds b
      ),
      novas AS (
        SELECT (c.criado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, COUNT(*)::int AS n
        FROM vendas.conversas c, bounds b
        WHERE (c.criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= b.d0
          AND (c.criado_em AT TIME ZONE 'America/Sao_Paulo')::date <= b.d1
        GROUP BY 1
      ),
      fechadas AS (
        SELECT (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, COUNT(*)::int AS n
        FROM vendas.conversas c, bounds b
        WHERE c.venda_fechada = true
          AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= b.d0
          AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date <= b.d1
        GROUP BY 1
      )
      SELECT d.dia::text AS dia, COALESCE(n.n, 0) AS novas, COALESCE(f.n, 0) AS fechadas
      FROM days d
      LEFT JOIN novas n ON n.dia = d.dia
      LEFT JOIN fechadas f ON f.dia = d.dia
      ORDER BY d.dia
    `
    return { query, params, mode: 'dual' }
  }

  if (estagio === 'fechado') {
    const query = `
      WITH bounds AS (${boundsExpr}),
      days AS (
        SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
        FROM bounds b
      ),
      agg AS (
        SELECT (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, COUNT(*)::int AS n
        FROM vendas.conversas c, bounds b
        WHERE c.venda_fechada = true
          AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= b.d0
          AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date <= b.d1
        GROUP BY 1
      )
      SELECT d.dia::text AS dia, COALESCE(a.n, 0) AS total
      FROM days d
      LEFT JOIN agg a ON a.dia = d.dia
      ORDER BY d.dia
    `
    return { query, params, mode: 'single' }
  }

  params.push(estagio)
  const query = `
    WITH bounds AS (${boundsExpr}),
    days AS (
      SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
      FROM bounds b
    ),
    agg AS (
      SELECT (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, COUNT(*)::int AS n
      FROM vendas.conversas c, bounds b
      WHERE c.venda_fechada = false
        AND c.estagio = $${nextIdx}
        AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= b.d0
        AND (c.atualizado_em AT TIME ZONE 'America/Sao_Paulo')::date <= b.d1
      GROUP BY 1
    )
    SELECT d.dia::text AS dia, COALESCE(a.n, 0) AS total
    FROM days d
    LEFT JOIN agg a ON a.dia = d.dia
    ORDER BY d.dia
  `
  return { query, params, mode: 'single' }
}

function parseDashboardAnalisesQuery(req) {
  const q = req.query || {}
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200)
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0)
  const numero = q.numero != null && String(q.numero).trim() !== '' ? normalizarNumeroParaJid(String(q.numero).trim()) : null
  const etapa = q.etapa != null && String(q.etapa).trim() !== '' ? String(q.etapa).trim().slice(0, 120) : null
  const sinalIa =
    q.sinal_ia != null && String(q.sinal_ia).trim() !== '' ? String(q.sinal_ia).trim().slice(0, 120) : null
  const desde = q.desde != null && String(q.desde).trim() !== '' ? String(q.desde).trim().slice(0, 10) : null
  const ate = q.ate != null && String(q.ate).trim() !== '' ? String(q.ate).trim().slice(0, 10) : null
  return { limit, offset, numero, etapa, sinalIa, desde, ate }
}

function buildWhereAnalisesFiltros(numero, etapa, sinalIa, desde, ate) {
  const parts = []
  const params = []
  let i = 1
  if (numero) {
    parts.push(`a.numero = $${i}`)
    params.push(numero)
    i++
  }
  if (etapa) {
    parts.push(`a.etapa = $${i}`)
    params.push(etapa)
    i++
  }
  if (sinalIa) {
    parts.push(`$${i} = ANY(COALESCE(a.sinais_melhoria_ia, '{}'::text[]))`)
    params.push(sinalIa)
    i++
  }
  if (desde) {
    parts.push(`a.criado_em >= $${i}::date`)
    params.push(desde)
    i++
  }
  if (ate) {
    parts.push(`a.criado_em < ($${i}::date + interval '1 day')`)
    params.push(ate)
    i++
  }
  return { where: parts.length ? parts.join(' AND ') : 'TRUE', params }
}

const FUNIL_DIAGNOSTICO_BASE_ETAPAS = [
  { id: 'primeiro_contato', label: 'Primeiro Contato' },
  { id: 'primeiro_contato_prospeccao', label: 'Primeiro Contato (Prospeccao)' },
  { id: 'qualificacao', label: 'Qualificacao' },
  { id: 'diagnostico', label: 'Diagnostico' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'objecao', label: 'Objecao' },
  { id: 'fechamento', label: 'Fechamento' },
]

const FUNIL_PROMPT_AVALIACAO = `Voce e engenheiro de prompts especializado em vendas consultivas de servicos digitais para PMEs locais no Brasil.

Voce recebe o prompt ativo de uma etapa do funil e a analise JSON gerada para conversas reais.

Avalie se o prompt produziu uma analise util e acionavel para o operador comercial da PJ Codeworks.

Classifique como:
- boa: diagnostico especifico, causa raiz clara, proximos passos concretos e mensagens naturais.
- media: util, mas ainda generica ou com lacunas de criterio.
- fraca: superficial, pouco acionavel ou desalinhada ao contexto.

Responda APENAS em JSON valido:
{"avaliacao_do_prompt":"boa","pontos_fracos_do_prompt":[],"principais_mudancas":[],"prompt_melhorado":""}`

const FUNIL_PROMPTS_SEED = {
  primeiro_contato: `Voce e especialista em vendas consultivas de sites, SEO e presenca Google para pequenas empresas locais no Brasil.

Analise conversas de PRIMEIRO CONTATO da PJ Codeworks no WhatsApp.

Contexto: clientes sao motivados por status, confianca, aparecer profissional e nao perder espaco para concorrentes no Google. Nao reduza tudo a ROI financeiro.

Avalie:
1. O vendedor estabeleceu dor antes de produto/preco?
2. Houve pergunta termometro sobre site, Google, concorrencia ou captacao?
3. O lead demonstrou interesse real, curiosidade, frieza ou evasiva?
4. Houve prova visual, exemplo, ranking, print ou comparativo?
5. Qual ponto travou o avanco?
6. O tom foi consultivo ou empurrador?

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  primeiro_contato_prospeccao: `Voce e especialista em prospeccao ativa via WhatsApp para PMEs locais no Brasil.

Analise APENAS mensagens de PRIMEIRO CONTATO da prospeccao da PJ Codeworks.

Regra central desta etapa:
- cada item analisado e a primeira mensagem realmente enviada ao prospect (sem follow-up, sem reenvio, sem segunda abordagem).

Avalie:
1. A mensagem se apresenta de forma clara e humana (sem tom agressivo)?
2. Existe personalizacao concreta (nome da empresa, cidade, nicho ou contexto real)?
3. O texto gera curiosidade sem parecer pitch pronto?
4. A abertura evita promessas exageradas, numeros sem base e gatilhos apelativos?
5. A pergunta final facilita resposta curta do prospect?
6. O risco de soar spam esta alto, medio ou baixo?

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  qualificacao: `Voce e especialista em vendas consultivas de servicos digitais para PMEs locais.

Analise conversas de QUALIFICACAO da PJ Codeworks.

Avalie se a conversa identificou negocio, cidade, presenca atual no Google, site atual, decisor, urgencia, orcamento e sinais de fit.

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  diagnostico: `Voce e especialista em diagnostico comercial para sites, SEO local e presenca digital.

Analise conversas de DIAGNOSTICO da PJ Codeworks.

Avalie se a dor foi conectada a perda de clientes, status profissional, concorrencia, confianca e proxima acao concreta.

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  proposta: `Voce e especialista em apresentacao de proposta para servicos digitais no Brasil.

Analise conversas em que uma PROPOSTA foi apresentada pela PJ Codeworks.

Avalie se a proposta veio depois da dor, se o preco foi ancorado em valor/status, se houve seguranca, prova social e proximo passo claro.

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  objecao: `Voce e especialista em objecoes de venda consultiva para PMEs.

Analise conversas com OBJECOES como caro, vou pensar, nao preciso, ja tenho alguem, sem dinheiro agora ou silencio apos proposta.

Identifique a objecao principal, causa raiz, resposta do vendedor, resultado e proxima mensagem.

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
  fechamento: `Voce e especialista em fechamento de vendas consultivas via WhatsApp.

Analise conversas de FECHAMENTO da PJ Codeworks.

Avalie se o vendedor conduziu pro fechamento, usou escolha dupla/proximo passo, manteve autoridade e reduziu atrito para contrato ou pagamento.

Responda APENAS em JSON valido com:
{"pontuacao_geral":0,"resumo_geral":"","problemas_por_gravidade":{"alta":[],"media":[],"baixa":[]},"diagnostico_dos_leads":[],"padroes_identificados":[],"proximo_passo_recomendado":"","mensagens_prontas":[]}`,
}

/** Sufixo fixo na analise por etapa: respostas mais curtas e JSON sempre completo (independe da versao do prompt no banco). */
const FUNIL_DIAGNOSTICO_SYSTEM_SUFFIX = `Formato obrigatorio: um unico JSON valido e completo.
Listas curtas: no maximo 5 itens em cada array (alta, media, baixa, diagnostico_dos_leads, padroes_identificados, mensagens_prontas).
resumo_geral, proximo_passo_recomendado e cada item: frases objetivas, sem paragrafos longos. Feche todas as chaves e colchetes.`

function normalizarEtapaFunilDiagnostico(etapa) {
  const raw = String(etapa || '').trim().toLowerCase()
  const semAcento = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const id = semAcento.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const aliases = {
    primeiro_contato: 'primeiro_contato',
    primeiro_contato_prospeccao: 'primeiro_contato_prospeccao',
    primeiro_contato_prospeccao_whatsapp: 'primeiro_contato_prospeccao',
    primeiro_contato_prospeccao_wpp: 'primeiro_contato_prospeccao',
    primeiro_contato_prospeccao_primeiro_envio: 'primeiro_contato_prospeccao',
    primeiro_contato_prospeccao_primeiro_disparo: 'primeiro_contato_prospeccao',
    primeiro_contato_de_prospeccao: 'primeiro_contato_prospeccao',
    prospeccao_primeiro_contato: 'primeiro_contato_prospeccao',
    primeiro_contato_prospeccao_etapa: 'primeiro_contato_prospeccao',
    primeiro: 'primeiro_contato',
    qualificacao: 'qualificacao',
    qualifica_o: 'qualificacao',
    diagnostico: 'diagnostico',
    proposta: 'proposta',
    proposta_enviada: 'proposta',
    objecao: 'objecao',
    obje_o: 'objecao',
    negociacao: 'objecao',
    fechamento: 'fechamento',
    fechado: 'fechamento',
  }
  return aliases[id] || id || 'primeiro_contato'
}

function labelEtapaFunilDiagnostico(etapa) {
  const id = normalizarEtapaFunilDiagnostico(etapa)
  const base = FUNIL_DIAGNOSTICO_BASE_ETAPAS.find((e) => e.id === id)
  if (base) return base.label
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function variantesEtapaFunilDiagnostico(etapa) {
  const id = normalizarEtapaFunilDiagnostico(etapa)
  const map = {
    primeiro_contato: ['primeiro_contato'],
    primeiro_contato_prospeccao: ['primeiro_contato_prospeccao'],
    qualificacao: ['qualificacao'],
    diagnostico: ['diagnostico'],
    proposta: ['proposta', 'proposta_enviada'],
    objecao: ['objecao', 'negociacao'],
    fechamento: ['fechamento', 'fechado'],
  }
  return map[id] || [id]
}

function promptSeedFunilDiagnostico(etapa) {
  const id = normalizarEtapaFunilDiagnostico(etapa)
  return FUNIL_PROMPTS_SEED[id] || FUNIL_PROMPTS_SEED.diagnostico
}

function normalizarListaTextoFunil(valor, max = 8) {
  if (Array.isArray(valor)) {
    return valor.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max)
  }
  if (typeof valor === 'string' && valor.trim()) return [valor.trim()].slice(0, max)
  return []
}

function normalizarProblemasFunil(valor) {
  const out = { alta: [], media: [], baixa: [] }
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const grav of ['alta', 'media', 'baixa']) out[grav] = normalizarListaTextoFunil(valor[grav], 8)
    return out
  }
  if (Array.isArray(valor)) {
    for (const p of valor) {
      if (!p) continue
      const grav = ['alta', 'media', 'baixa'].includes(String(p.gravidade || '').toLowerCase())
        ? String(p.gravidade).toLowerCase()
        : 'media'
      const titulo = p.titulo || p.descricao || p
      const desc = p.descricao && p.titulo ? `${p.titulo}: ${p.descricao}` : titulo
      const txt = String(desc || '').trim()
      if (txt) out[grav].push(txt.slice(0, 500))
    }
  }
  return out
}

function normalizarResultadoFunilDiagnostico(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  const scoreRaw = Number(p.pontuacao_geral)
  return {
    pontuacao_geral: Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, Math.round(scoreRaw))) : 0,
    resumo_geral: String(p.resumo_geral || p.resumo || '').trim().slice(0, 1200),
    problemas_por_gravidade: normalizarProblemasFunil(p.problemas_por_gravidade || p.problemas),
    diagnostico_dos_leads: normalizarListaTextoFunil(p.diagnostico_dos_leads || p.diagnostico_lead || p.fit_do_lead, 12),
    padroes_identificados: normalizarListaTextoFunil(p.padroes_identificados || p.pontos_positivos, 12),
    proximo_passo_recomendado: String(p.proximo_passo_recomendado || '').trim().slice(0, 1200),
    mensagens_prontas: normalizarListaTextoFunil(p.mensagens_prontas || p.mensagem_sugerida || p.resposta_sugerida, 6),
  }
}

function normalizarAvaliacaoPromptFunil(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  const raw = String(p.avaliacao_do_prompt || '').trim().toLowerCase()
  const avaliacao = ['boa', 'media', 'fraca'].includes(raw) ? raw : 'media'
  return {
    avaliacao_do_prompt: avaliacao,
    pontos_fracos_do_prompt: normalizarListaTextoFunil(p.pontos_fracos_do_prompt, 8),
    principais_mudancas: normalizarListaTextoFunil(p.principais_mudancas, 8),
    prompt_melhorado: String(p.prompt_melhorado || '').trim(),
  }
}

function pontuarConversaFunilDiagnostico(row, now = new Date()) {
  const hist = Array.isArray(row?.historico) ? row.historico : []
  const totalMsgs = Number(row?.mensagens || hist.length || 0)
  const userMsgs = Number(row?.user_msgs || hist.filter((m) => m && m.role === 'user').length || 0)
  const updated = row?.atualizado_em ? new Date(row.atualizado_em).getTime() : 0
  const ageDays = updated ? Math.max(0, (now.getTime() - updated) / 86400000) : 365
  const recency = Math.max(0, 30 - Math.min(30, ageDays))
  const hasLead = userMsgs > 0 ? 25 : 0
  return hasLead + Math.min(totalMsgs, 40) * 1.5 + Math.min(userMsgs, 20) * 2 + recency
}

function selecionarConversasFunilDiagnostico(rows, limit = 20, now = new Date()) {
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => Array.isArray(r?.historico) && r.historico.some((m) => m && m.role === 'user'))
    .map((r) => ({ ...r, score_funil_diagnostico: pontuarConversaFunilDiagnostico(r, now) }))
    .sort((a, b) => b.score_funil_diagnostico - a.score_funil_diagnostico)
    .slice(0, lim)
}

function historicoParaTextoFunil(historico, maxChars = 1400) {
  const linhas = normalizarHistoricoMensagens(historico)
    .map((m) => `${m.role === 'user' ? 'Lead' : m.role === 'assistant' ? 'Agente' : 'Operador'}: ${textoDeContent(m.content)}`)
    .filter((x) => x.trim().length > 0)
  const txt = linhas.join('\n').slice(-maxChars)
  return txt.trim()
}

function montarContextoFunilDiagnostico(conversas, conversaColada = '', maxTotalChars = 26000) {
  const blocos = []
  ;(Array.isArray(conversas) ? conversas : []).forEach((c, idx) => {
    const meta = [
      `CONVERSA ${idx + 1}`,
      c.numero ? `numero=${c.numero}` : null,
      c.negocio ? `negocio=${c.negocio}` : null,
      c.cidade ? `cidade=${c.cidade}` : null,
      c.estagio ? `etapa=${c.estagio}` : null,
    ].filter(Boolean).join(' | ')
    const texto = historicoParaTextoFunil(c.historico)
    if (texto) blocos.push(`${meta}\n${texto}`)
  })
  const colada = String(conversaColada || '').trim()
  if (colada) blocos.push(`CONVERSA COLADA PELO OPERADOR\n${colada.slice(0, 6000)}`)
  let total = ''
  for (const bloco of blocos) {
    const proximo = total ? `${total}\n\n---\n\n${bloco}` : bloco
    if (proximo.length > maxTotalChars) break
    total = proximo
  }
  return total
}

function normalizarChaveResumoEtapa(texto) {
  return String(texto || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 220)
}

function contarItensResumoEtapa(itens) {
  const map = new Map()
  for (const item of itens || []) {
    const texto = normalizarChaveResumoEtapa(item)
    if (!texto) continue
    const key = texto.toLowerCase()
    const atual = map.get(key) || { texto, qtd: 0 }
    atual.qtd += 1
    map.set(key, atual)
  }
  return [...map.values()].sort((a, b) => b.qtd - a.qtd || a.texto.localeCompare(b.texto)).slice(0, 5)
}

function montarResumoGeralEtapaAnalises(analises, etapa) {
  const etapaNorm = normalizarChaveResumoEtapa(etapa)
  if (!etapaNorm) return null
  const rows = Array.isArray(analises) ? analises.filter((row) => row && row.etapa === etapaNorm) : []
  const principaisProblemas = contarItensResumoEtapa(rows.map((row) => row.resumo_problema))
  const oQueFaltou = contarItensResumoEtapa(rows.flatMap((row) => row.o_que_faltou_para_vender || []))
  const melhoriasIa = contarItensResumoEtapa(rows.flatMap((row) => row.melhorias_para_ia || []))
  const sinais = contarItensResumoEtapa(rows.flatMap((row) => row.sinais_melhoria_ia || []))
  const problemaTop = principaisProblemas[0]?.texto || sinais[0]?.texto || 'sem padrao dominante ainda'
  return {
    etapa: etapaNorm,
    total_analises: rows.length,
    leitura:
      rows.length > 0
        ? `Leitura geral baseada em ${rows.length} analise(s) IA salvas: o principal sinal nesta etapa e "${problemaTop}".`
        : 'Ainda nao ha analises suficientes para consolidar esta etapa.',
    principais_problemas: principaisProblemas,
    o_que_faltou: oQueFaltou,
    melhorias_ia: melhoriasIa,
    sinais_ia: sinais,
  }
}

async function garantirPromptAtivoFunil(etapa) {
  const etapaId = normalizarEtapaFunilDiagnostico(etapa)
  const found = await pool.query(
    `SELECT id, etapa, version, prompt, ativo, origem, criado_em
     FROM vendas.funil_prompt_versions
     WHERE etapa = $1 AND ativo = true
     ORDER BY version DESC
     LIMIT 1`,
    [etapaId]
  )
  if (found.rows[0]) return found.rows[0]
  const prompt = promptSeedFunilDiagnostico(etapaId)
  const inserted = await pool.query(
    `INSERT INTO vendas.funil_prompt_versions (etapa, version, prompt, ativo, origem)
     VALUES ($1, 1, $2, true, 'seed')
     ON CONFLICT (etapa, version) DO UPDATE SET prompt = EXCLUDED.prompt
     RETURNING id, etapa, version, prompt, ativo, origem, criado_em`,
    [etapaId, prompt]
  )
  return inserted.rows[0]
}

async function criarNovaVersaoPromptFunil(etapa, prompt, origem = 'melhoria_aceita') {
  const etapaId = normalizarEtapaFunilDiagnostico(etapa)
  const texto = String(prompt || '').trim()
  if (!texto || texto.length < 200) throw new Error('Prompt melhorado muito curto')
  try {
    await pool.query('BEGIN')
    const maxRes = await pool.query(
      `SELECT COALESCE(MAX(version), 0)::int AS max_version
       FROM vendas.funil_prompt_versions
       WHERE etapa = $1`,
      [etapaId]
    )
    const next = (parseInt(maxRes.rows[0]?.max_version, 10) || 0) + 1
    await pool.query(`UPDATE vendas.funil_prompt_versions SET ativo = false WHERE etapa = $1`, [etapaId])
    const inserted = await pool.query(
      `INSERT INTO vendas.funil_prompt_versions (etapa, version, prompt, ativo, origem)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, etapa, version, prompt, ativo, origem, criado_em`,
      [etapaId, next, texto, String(origem || 'melhoria_aceita').slice(0, 80)]
    )
    await pool.query('COMMIT')
    return inserted.rows[0]
  } catch (err) {
    try { await pool.query('ROLLBACK') } catch (_) {}
    throw err
  }
}

async function buscarConversasParaDiagnosticoFunil(etapa, limit = 20) {
  const etapaId = normalizarEtapaFunilDiagnostico(etapa)
  const variantes = variantesEtapaFunilDiagnostico(etapaId)
  const { rows } = await pool.query(
    `
    SELECT
      c.numero, c.estagio, c.historico, c.criado_em, c.atualizado_em,
      COALESCE(jsonb_array_length(c.historico), 0) AS mensagens,
      (
        SELECT COUNT(*)::int
        FROM jsonb_array_elements(COALESCE(c.historico, '[]'::jsonb)) AS h(item)
        WHERE h.item->>'role' = 'user'
      ) AS user_msgs,
      p.negocio, p.cidade
    FROM vendas.conversas c
    LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
    WHERE c.venda_fechada = false
      AND c.arquivado = false
      AND c.estagio = ANY($1::text[])
      AND COALESCE(jsonb_array_length(c.historico), 0) > 1
    ORDER BY user_msgs DESC, mensagens DESC, c.atualizado_em DESC
    LIMIT 80
    `,
    [variantes]
  )
  return selecionarConversasFunilDiagnostico(rows, limit)
}

function pontuarMensagemPrimeiroContatoProspeccao(row, now = new Date()) {
  const mensagem = String(row?.mensagem || '').trim()
  const updated = row?.enviado_em ? new Date(row.enviado_em).getTime() : 0
  const ageDays = updated ? Math.max(0, (now.getTime() - updated) / 86400000) : 365
  const recency = Math.max(0, 30 - Math.min(30, ageDays))
  const tamanho = Math.min(30, Math.max(0, mensagem.length / 16))
  return recency + tamanho
}

function selecionarMensagensPrimeiroContatoProspeccao(rows, limit = 20, now = new Date()) {
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ ...row, score_funil_diagnostico: pontuarMensagemPrimeiroContatoProspeccao(row, now) }))
    .sort((a, b) => b.score_funil_diagnostico - a.score_funil_diagnostico)
    .slice(0, lim)
}

async function buscarPrimeirosContatosProspeccaoParaDiagnostico(limit = 20) {
  const { rows } = await pool.query(
    `
    SELECT
      p.id AS prospect_id,
      p.nome,
      p.telefone AS numero,
      p.nicho AS negocio,
      p.cidade,
      d.id AS diagnostico_id,
      d.enviado_em,
      COALESCE(NULLIF(BTRIM(d.mensagem_editada), ''), NULLIF(BTRIM(d.mensagem_gerada), '')) AS mensagem
    FROM prospectador.prospects p
    JOIN prospectador.diagnosticos d ON d.prospect_id = p.id
    WHERE d.enviado_em IS NOT NULL
      AND COALESCE(NULLIF(BTRIM(d.mensagem_editada), ''), NULLIF(BTRIM(d.mensagem_gerada), '')) IS NOT NULL
      AND d.id = (
        SELECT d2.id
        FROM prospectador.diagnosticos d2
        WHERE d2.prospect_id = d.prospect_id
          AND d2.enviado_em IS NOT NULL
        ORDER BY d2.enviado_em ASC, d2.created_at ASC, d2.id ASC
        LIMIT 1
      )
    ORDER BY d.enviado_em DESC
    LIMIT 200
    `
  )
  const selecionadas = selecionarMensagensPrimeiroContatoProspeccao(rows, limit)
  return selecionadas.map((row) => ({
    numero: row.numero || `prospect:${row.prospect_id}`,
    estagio: 'primeiro_contato_prospeccao',
    historico: [{ role: 'assistant', content: row.mensagem }],
    criado_em: row.enviado_em,
    atualizado_em: row.enviado_em,
    mensagens: 1,
    user_msgs: 0,
    negocio: row.negocio || '',
    cidade: row.cidade || '',
    prospect_id: row.prospect_id,
    prospect_nome: row.nome || '',
    diagnostico_id: row.diagnostico_id,
  }))
}

async function analisarFunilDiagnosticoEtapa({ etapa, fonte, limit, conversa_colada: conversaColada }) {
  const etapaId = normalizarEtapaFunilDiagnostico(etapa)
  const fonteNorm = ['banco', 'colar', 'banco_colar'].includes(String(fonte || '').trim())
    ? String(fonte || '').trim()
    : 'banco_colar'
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
  const promptAtivo = await garantirPromptAtivoFunil(etapaId)
  const conversas = fonteNorm === 'colar'
    ? []
    : etapaId === 'primeiro_contato_prospeccao'
      ? await buscarPrimeirosContatosProspeccaoParaDiagnostico(lim)
      : await buscarConversasParaDiagnosticoFunil(etapaId, lim)
  const contexto = montarContextoFunilDiagnostico(conversas, fonteNorm === 'banco' ? '' : conversaColada)
  if (!contexto) throw new Error('Nenhuma conversa disponivel para esta etapa')
  const userMessage =
    `ETAPA ANALISADA: ${labelEtapaFunilDiagnostico(etapaId)} (${etapaId})\n` +
    `TOTAL DE CONVERSAS NO CONTEXTO: ${conversas.length}${fonteNorm !== 'banco' && conversaColada ? ' + conversa colada' : ''}\n\n` +
    `CONVERSAS:\n\n${contexto}`
  const systemFunil =
    String(promptAtivo.prompt || '').trim() + '\n\n' + FUNIL_DIAGNOSTICO_SYSTEM_SUFFIX
  const analise = await chamarClaudeAuxiliar({
    tipo: 'funil_diagnostico',
    estagio: etapaId,
    system: systemFunil,
    userMessage,
    expectJson: true,
    max_tokens: 16384,
    temperature: 0.25,
    timeout_ms: 120000,
    metadata: { etapa: etapaId, fonte: fonteNorm, total_conversas: conversas.length },
  })
  if (!analise.ok || !analise.parsed) {
    let msg = analise.errorMsg
    if (analise.ok && !analise.parsed) {
      if (analise.stop_reason === 'max_tokens') {
        msg =
          'Resposta da IA foi cortada (limite de tokens). Tente menos conversas no filtro ou reduza o historico colado.'
      } else if (!analise.texto) {
        msg = 'IA retornou resposta vazia para o diagnostico'
      } else {
        msg = 'IA nao retornou JSON valido para o diagnostico'
      }
    }
    throw new Error(msg || 'IA nao retornou JSON valido para o diagnostico')
  }
  const resultado = normalizarResultadoFunilDiagnostico(analise.parsed)
  const avaliacao = await chamarClaudeAuxiliar({
    tipo: 'funil_prompt_review',
    estagio: etapaId,
    system: FUNIL_PROMPT_AVALIACAO,
    userMessage:
      `PROMPT ATIVO:\n${promptAtivo.prompt}\n\nANALISE GERADA:\n${JSON.stringify(resultado, null, 2)}`,
    expectJson: true,
    max_tokens: 1400,
    temperature: 0.2,
    timeout_ms: 12000,
    metadata: { etapa: etapaId, prompt_version: promptAtivo.version },
  })
  const avaliacaoPrompt = avaliacao.parsed
    ? normalizarAvaliacaoPromptFunil(avaliacao.parsed)
    : { avaliacao_do_prompt: 'boa', pontos_fracos_do_prompt: [], principais_mudancas: [], prompt_melhorado: '' }
  const saved = await pool.query(
    `INSERT INTO vendas.funil_diagnosticos
      (etapa, prompt_version_id, fonte, total_conversas, resultado_json, avaliacao_prompt_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id, criado_em`,
    [etapaId, promptAtivo.id, fonteNorm, conversas.length + (fonteNorm !== 'banco' && conversaColada ? 1 : 0), JSON.stringify(resultado), JSON.stringify(avaliacaoPrompt)]
  )
  return {
    id: saved.rows[0]?.id,
    criado_em: saved.rows[0]?.criado_em,
    etapa: etapaId,
    etapa_label: labelEtapaFunilDiagnostico(etapaId),
    fonte: fonteNorm,
    total_conversas: conversas.length,
    prompt_ativo: promptAtivo,
    resultado,
    avaliacao_prompt: avaliacaoPrompt,
    melhoria_disponivel: ['media', 'fraca'].includes(avaliacaoPrompt.avaliacao_do_prompt) && !!avaliacaoPrompt.prompt_melhorado,
  }
}


/** USD por 1M tokens (entrada/saída). Opcional: LLM_USD_BRL para estimativa em reais. */
function parseLlmPricingEnv() {
  const inPerM = parseFloat(String(process.env.LLM_ESTIMATE_INPUT_PER_MTOK_USD || '').trim())
  const outPerM = parseFloat(String(process.env.LLM_ESTIMATE_OUTPUT_PER_MTOK_USD || '').trim())
  const usdBrl = parseFloat(String(process.env.LLM_USD_BRL || '').trim())
  const ok =
    Number.isFinite(inPerM) && inPerM >= 0 && Number.isFinite(outPerM) && outPerM >= 0
  return {
    ok,
    inPerM: ok ? inPerM : 0,
    outPerM: ok ? outPerM : 0,
    usdBrl: Number.isFinite(usdBrl) && usdBrl > 0 ? usdBrl : null,
  }
}

function estimativaCustoLlm(inputTokens, outputTokens, pricing) {
  const inT = Number(inputTokens) || 0
  const outT = Number(outputTokens) || 0
  if (!pricing || !pricing.ok) return null
  const usd = (inT / 1e6) * pricing.inPerM + (outT / 1e6) * pricing.outPerM
  const out = { usd }
  if (pricing.usdBrl != null) out.brl = usd * pricing.usdBrl
  return out
}

function detectarTipoMensagemExporto(content) {
  const s = typeof content === 'string' ? content : ''
  if (s.includes('[Audio transcrito]')) return 'audio_transcrito'
  if (s.includes('[Audio recebido')) return 'audio_sem_transcricao'
  if (
    s.startsWith('O cliente enviou uma imagem') ||
    s.startsWith('O operador enviou uma imagem') ||
    s.startsWith('O cliente enviou uma figurinha') ||
    s.startsWith('O operador enviou uma figurinha') ||
    s.includes('[Imagem em formato nao suportado') ||
    s.includes('[Nao foi possivel baixar a imagem') ||
    s.includes('[Imagem muito grande') ||
    s === '(imagem)' ||
    s === '(imagem base64 omitida)' ||
    s === '(possível mídia base64 omitida)'
  ) return 'imagem'
  if (s === '(Cliente enviou conteúdo de mídia.)' || s === '(conteúdo não textual)') return 'midia_generica'
  return 'texto'
}

function formatarMensagemParaContexto(m, idx) {
  const role = m.role === 'user' ? 'Lead' : m.role === 'assistant' ? 'PJ Codeworks' : 'Operador'
  let content = m.content
  if (Array.isArray(content)) {
    content = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim() || '(conteúdo não textual)'
  }
  const s = typeof content === 'string' ? content : String(content || '')
  const tipo = detectarTipoMensagemExporto(s)
  const prefixo = `[#${idx + 1}] `

  switch (tipo) {
    case 'audio_transcrito': {
      const transcricao = s.replace(/\[Audio transcrito\]\s*/g, '').trim()
      return `${prefixo}${role} enviou áudio:\nTranscrição: "${transcricao}"`
    }
    case 'audio_sem_transcricao':
      return `${prefixo}${role} enviou áudio:\nÁudio recebido, mas ainda sem transcrição.`
    case 'imagem':
      return `${prefixo}${role} enviou imagem:\nDescrição: "${s || 'Imagem recebida, mas ainda sem descrição.'}"`
    case 'midia_generica':
      return `${prefixo}${role} enviou mídia:\n(Mídia recebida sem conteúdo interpretado)`
    default:
      return `${prefixo}${role}:\n${s}`
  }
}

function gerarTextoConversaCompleta(conversa, perfil, agendaEventos) {
  const linhas = []
  const sep = '═'.repeat(50)
  const dash = '─'.repeat(50)

  linhas.push('CONVERSA COMPLETA — PJ CODEWORKS')
  linhas.push(sep)

  const telefone = String(conversa.numero || '').replace('@s.whatsapp.net', '').replace(/^55/, '+55 ')
  linhas.push('')
  linhas.push(`Lead: ${telefone}`)
  if (perfil) {
    if (perfil.apelido) linhas.push(`Apelido: ${perfil.apelido}`)
    if (perfil.negocio) linhas.push(`Negócio/Empresa: ${perfil.negocio}`)
    if (perfil.cidade) linhas.push(`Cidade: ${perfil.cidade}`)
    const statusTexto = conversa.venda_fechada
      ? 'Venda fechada'
      : conversa.status === 'aguardando_handoff'
        ? 'Aguardando handoff'
        : 'Ativo'
    linhas.push(`Status: ${statusTexto}`)
    if (perfil.temperatura_lead) linhas.push(`Temperatura: ${perfil.temperatura_lead}`)
    if (perfil.plano_sugerido) linhas.push(`Plano sugerido: ${perfil.plano_sugerido}`)
    if (perfil.preco_calculado != null) linhas.push(`Preço calculado: R$ ${perfil.preco_calculado}`)
  }
  if (conversa.estagio) linhas.push(`Estágio: ${conversa.estagio}`)

  if (perfil && perfil.resumo_memoria_vendas) {
    linhas.push('')
    linhas.push('RESUMO DO CONTEXTO:')
    linhas.push(dash)
    linhas.push(perfil.resumo_memoria_vendas)
  }

  const historico = normalizarHistoricoMensagens(conversa.historico)
  linhas.push('')
  linhas.push('HISTÓRICO DA CONVERSA:')
  linhas.push(dash)
  let msgIdx = 0
  for (const m of historico) {
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'operator') continue
    linhas.push('')
    linhas.push(formatarMensagemParaContexto(m, msgIdx))
    msgIdx++
  }

  const eventosLinhas = []
  if (perfil) {
    const ev = (typeof perfil.eventos_conversa === 'object' && perfil.eventos_conversa) || {}
    const rp = (typeof perfil.reuniao_proposta === 'object' && perfil.reuniao_proposta) || {}
    if (ev.reuniao_agendada) eventosLinhas.push('[EVENTO] Reunião agendada.')
    if (ev.reuniao_confirmada) eventosLinhas.push('[EVENTO] Reunião confirmada.')
    if (ev.proposta_enviada) eventosLinhas.push('[EVENTO] Proposta enviada.')
    if (ev.contrato_enviado) eventosLinhas.push('[EVENTO] Contrato enviado e aguardando assinatura.')
    if (ev.handoff_gerado) eventosLinhas.push('[EVENTO] Handoff gerado.')
    if (conversa.venda_fechada) eventosLinhas.push('[EVENTO] Lead marcado como vendido.')
    if (rp.data_confirmada || rp.data_sugerida) {
      const data = rp.data_confirmada || rp.data_sugerida
      const hora = rp.horario_confirmado || rp.horario_sugerido || ''
      eventosLinhas.push(`[EVENTO] Reunião: ${data}${hora ? ` às ${hora}` : ''}.`)
    }
  }
  if (Array.isArray(agendaEventos)) {
    for (const ae of agendaEventos) {
      if (ae.excluido_em) continue
      const titulo = ae.titulo || ae.tipo || 'Evento'
      const dataAe = ae.data_inicio ? String(ae.data_inicio).slice(0, 16).replace('T', ' ') : ''
      eventosLinhas.push(`[EVENTO] ${titulo}${dataAe ? `: ${dataAe}` : ''}.`)
    }
  }
  if (eventosLinhas.length) {
    linhas.push('')
    linhas.push('EVENTOS:')
    linhas.push(dash)
    linhas.push(...eventosLinhas)
  }

  if (conversa.estagio) {
    linhas.push('')
    linhas.push('PRÓXIMOS PASSOS:')
    linhas.push(dash)
    linhas.push(`- ${conversa.estagio}`)
  }

  return linhas.join('\n')
}

function registerHttpRoutes(app) {
app.get('/dashboard/operadores', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const operadores = await listarOperadoresConfigurados()
    res.json({ ok: true, operadores })
  } catch (err) {
    logger.error('❌ GET operadores:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.put('/dashboard/operadores', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const entrada = Array.isArray(req.body?.operadores) ? req.body.operadores : []
  const operadores = dedupeOperadores(entrada)
  if (operadores.length === 0) {
    return res.status(400).json({ ok: false, erro: 'Informe ao menos um operador válido.' })
  }
  if (entrada.length !== operadores.length) {
    return res.status(400).json({ ok: false, erro: 'Há operadores com número inválido ou duplicado.' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM vendas.operadores')
    for (const op of operadores) {
      await client.query(
        `INSERT INTO vendas.operadores (nome, numero, jid, ativo, recebe_alertas)
         VALUES ($1, $2, $3, $4, $5)`,
        [op.nome, op.numero, op.jid, op.ativo, op.recebe_alertas]
      )
    }
    await client.query('COMMIT')
    const atualizados = await listarOperadoresConfigurados()
    res.json({ ok: true, operadores: atualizados })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error('❌ PUT operadores:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  } finally {
    client.release()
  }
})

app.get('/dashboard/prompts', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const lista = []
    for (const chave of prompts.CHAVES_PERMITIDAS) {
      lista.push(await prompts.getPromptAtual(pool, chave))
    }
    res.json({ ok: true, prompts: lista })
  } catch (err) {
    logger.error('❌ GET /dashboard/prompts:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.get('/dashboard/prompts/:chave', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const atual = await prompts.getPromptAtual(pool, req.params.chave)
    const historico = await prompts.listarHistoricoOverlay(pool, req.params.chave)
    res.json({ ok: true, atual, historico })
  } catch (err) {
    if (err.code === 'CHAVE_INVALIDA') {
      return res.status(400).json({ ok: false, erro: err.message })
    }
    logger.error('❌ GET /dashboard/prompts/:chave:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.put('/dashboard/prompts/:chave', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const conteudo = req.body?.conteudo
    const autor = typeof req.body?.autor === 'string' ? req.body.autor : ''
    const atual = await prompts.setOverlay(pool, req.params.chave, conteudo, autor)
    res.json({ ok: true, atual })
  } catch (err) {
    if (err.code === 'CHAVE_INVALIDA' || err.code === 'CONTEUDO_VAZIO' || err.code === 'CONTEUDO_GRANDE') {
      return res.status(400).json({ ok: false, erro: err.message })
    }
    logger.error('❌ PUT /dashboard/prompts/:chave:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/prompts/:chave/reverter', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const versionId = req.body?.versionId ?? req.body?.id
    const atual = await prompts.reverterOverlay(pool, req.params.chave, versionId)
    res.json({ ok: true, atual })
  } catch (err) {
    if (err.code === 'CHAVE_INVALIDA' || err.code === 'VERSION_ID') {
      return res.status(400).json({ ok: false, erro: err.message })
    }
    if (err.code === 'NAO_ENCONTRADO') {
      return res.status(404).json({ ok: false, erro: err.message })
    }
    logger.error('❌ POST /dashboard/prompts/:chave/reverter:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/apelido', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  const apelidoRaw = typeof req.body?.apelido === 'string' ? req.body.apelido.trim() : ''
  if (apelidoRaw.length > 80) {
    return res.status(400).json({ ok: false, erro: 'Apelido deve ter no maximo 80 caracteres' })
  }
  const apelido = apelidoRaw || null
  
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const { rows } = await pool.query(
      `INSERT INTO vendas.lead_profiles (numero, apelido, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (numero) DO UPDATE
       SET apelido = EXCLUDED.apelido,
           atualizado_em = NOW()
       RETURNING numero, apelido`,
      [jid, apelido]
    )
    res.json({ ok: true, numero: rows[0].numero, apelido: rows[0].apelido })
  } catch (err) {
    logger.error('[Dashboard] Erro ao atualizar apelido:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados' })
  }
})

/** Arquivar ou desarquivar conversa (dashboard). */
app.post('/dashboard/arquivar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  const arquivado = !!req.body?.arquivado
  const motivoRaw = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : ''
  const motivo = arquivado ? (motivoRaw || 'arquivado_manual') : null
  if (motivo && motivo.length > 120) {
    return res.status(400).json({ ok: false, erro: 'Motivo de arquivamento muito longo' })
  }
  
  try {
    const { rows } = await pool.query(
      `UPDATE vendas.conversas
       SET arquivado = $1,
           motivo_arquivamento = $2,
           arquivado_em = CASE WHEN $1 THEN NOW() ELSE NULL END,
           atualizado_em = NOW()
       WHERE numero = $3
       RETURNING numero, arquivado, motivo_arquivamento, arquivado_em`,
      [arquivado, motivo, jid]
    )
    if (!rows.length) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    res.json({ ok: true, conversa: rows[0] })
  } catch (err) {
    logger.error('[Dashboard] Erro ao arquivar conversa:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados' })
  }
})

/** Excluir conversa e perfil de lead permanentemente (dashboard). */
app.delete('/dashboard/conversas', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Número inválido' })
  
  try {
    // Apaga do lead_profiles primeiro (para evitar erro de FK caso ON DELETE CASCADE não esteja configurado corretamente)
    await pool.query('DELETE FROM vendas.lead_profiles WHERE numero = $1', [jid])
    // Apaga de outras tabelas dependentes
    await pool.query('DELETE FROM vendas.analises_pos_conversa WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.conhecimento_lacunas WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.followup_envios WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.eventos_comerciais WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.webhook_messages_processed WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.lead_contextos WHERE numero = $1', [jid])
    await pool.query('DELETE FROM vendas.audio_processamentos WHERE numero = $1', [jid])
    // Apaga a conversa
    await pool.query('DELETE FROM vendas.conversas WHERE numero = $1', [jid])
    
    res.json({ ok: true })
  } catch (err) {
    logger.error('[Dashboard] Erro ao excluir conversa:', err)
    res.status(500).json({ ok: false, erro: 'Erro no banco de dados ao excluir' })
  }
})

/** Pausar ou reativar respostas automáticas do webhook para um número (dashboard). */
app.post('/dashboard/agente-pausar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.body?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  const pausado = !!req.body?.pausado
  try {
    const { rows } = await pool.query(
      `UPDATE vendas.conversas SET agente_pausado = $2, atualizado_em = NOW() WHERE numero = $1 RETURNING numero, agente_pausado`,
      [jid, pausado]
    )
    if (!rows.length) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada (ainda não há histórico com esse número)' })
    }
    if (pausado) await cancelarFollowupsAutoPendentes(jid, 'agente_pausado')
    res.json({ ok: true, numero: rows[0].numero, agente_pausado: rows[0].agente_pausado })
  } catch (err) {
    logger.error('❌ agente-pausar:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * User part pode vir como `5511999999999` ou `5511999999999:8` (índice de dispositivo).
 * Só o trecho antes do primeiro `:` é o telefone.
 */
/** Disparo manual de previa visual pelo operador. Auth: x-reprocess-secret. */
app.post('/api/operador/preview-site', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = normalizarNumeroParaJid(req.body?.numero || '')
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const modeloRaw = req.body?.modelo == null || req.body.modelo === '' ? null : String(req.body.modelo).trim().toLowerCase()
  const modelo = PREVIEW_SITE_MODELOS.has(modeloRaw) ? modeloRaw : null
  const estiloRaw = req.body?.estilo == null || req.body.estilo === '' ? null : String(req.body.estilo).trim().toLowerCase()
  const estilo = estiloRaw === 'clean' || estiloRaw === 'lapis' ? estiloRaw : null
  try {
    const [conversa, perfil] = await Promise.all([buscarConversa(jid), buscarPerfil(jid)])
    if (!conversa) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const historico = normalizarHistoricoMensagens(conversa.historico)
    const preview = await gerarEEnviarPreviewSite(jid, perfil, historico, { modelo, estilo })
    res.json({ ok: true, modelo_usado: preview.dados.modelo, renderer: preview.renderer })
  } catch (err) {
    logger.error('[Operador] preview-site:', err.response?.data || err.message)
    res.status(500).json({ ok: false, erro: err.message || 'Falha ao enviar previa' })
  }
})


/** Data YYYY-MM-DD no fuso de Sao Paulo, com offset opcional de dias. */
function dataStrSaoPaulo(offsetDias = 0) {
  const d = new Date(Date.now() + offsetDias * 86400000)
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * #4 — Reunião fechada pelo operador. Roda após uma intervenção do operador OU
 * após o lead responder com o agente pausado. Se o operador fechou uma reunião
 * com o lead, marca `fechada_por_operador` no perfil, move para fechamento,
 * avisa o time e cria o evento na Agenda (quando há horário/data confiáveis).
 * Idempotente: não re-alerta o mesmo fechamento.
 */
async function tratarPossivelReuniaoOperador(numero) {
  try {
    const conversa = await buscarConversa(numero)
    if (!conversa) return
    const historico = normalizarHistoricoMensagens(conversa.historico)
    // A IA SEMPRE analisa a conversa; o código apenas captura o JSON resultante.
    // Sem regex. Pausa = não responder ao lead, mas a análise (e a criação do
    // evento) segue rodando.
    const det = await detectarReuniaoFechadaIA(historico)
    if (!det || !det.fechada) return

    let perfil = await buscarPerfil(numero)
    if (!perfil || !perfil.numero) perfil = { ...(perfil || {}), numero }
    const eventos =
      perfil.eventos_conversa && typeof perfil.eventos_conversa === 'object' && !Array.isArray(perfil.eventos_conversa)
        ? perfil.eventos_conversa
        : {}

    // Resolve a data concreta: ISO direto (vinda do LLM) ou relativa (regex).
    let dataStr = null
    if (det.data && /^\d{4}-\d{2}-\d{2}$/.test(det.data)) dataStr = det.data
    else if (det.dataRelativa === 'hoje') dataStr = dataStrSaoPaulo(0)
    else if (det.dataRelativa === 'amanha') dataStr = dataStrSaoPaulo(1)
    const parsed = det.horario ? parsearHorarioReuniao(det.horario) : null

    // Idempotência: já registramos este fechamento (mesmo horário + data resolvida)?
    const ja = eventos.reuniao_fechada_operador
    if (ja && ja.horario === det.horario && (ja.data || null) === (dataStr || null)) return

    const reuniaoAtual =
      perfil.reuniao_proposta && typeof perfil.reuniao_proposta === 'object' ? perfil.reuniao_proposta : {}
    await atualizarPerfil(numero, {
      reuniao_proposta: {
        ...reuniaoAtual,
        necessaria: true,
        fechada_por_operador: true,
        horario_confirmado: det.horario || null,
        data_sugerida: dataStr || reuniaoAtual.data_sugerida || null,
        duracao_maxima_minutos: 15,
      },
      eventos_conversa: {
        ...eventos,
        reuniao_fechada_operador: {
          horario: det.horario || null,
          data: dataStr || null,
          dataRelativa: det.dataRelativa || null,
          confianca: det.confianca,
          fonte: det.fonte || 'regex',
          em: new Date().toISOString(),
        },
      },
    })

    // Move para fechamento/handoff, preservando a pausa do agente.
    await salvarConversa(
      numero,
      historico,
      'fechamento',
      'aguardando_handoff',
      conversa.agente_pausado === true ? true : undefined
    )

    // Cria evento na Agenda quando temos horário E data concretos.
    let eventoCriado = false
    if (parsed && dataStr && typeof criarEventoAgenda === 'function') {
      try {
        const dataInicio = dataInicioReuniao(dataStr, parsed.hora, parsed.min)
        const dataFim = calcularFimReuniao(dataInicio, 15)
        const titulo = `Reunião (fechada por operador) — ${perfil.negocio || numeroDisplayDoJid(numero)}`
        const ev = await criarEventoAgenda({
          titulo: titulo.slice(0, 160),
          descricao: 'Reunião fechada pelo operador no WhatsApp. Confirmar com o lead.',
          tipo: 'reuniao',
          prioridade: 'urgente',
          dataInicio,
          dataFim,
          metadata: {
            lead_numero: numeroDisplayDoJid(numero),
            negocio: perfil.negocio || null,
            cidade: perfil.cidade || null,
            fechada_por_operador: true,
            horario_confirmado_texto: det.horario || null,
          },
          origem: 'operador',
        })
        eventoCriado = Boolean(ev)
      } catch (e) {
        logger.warn('⚠️ #4 falha ao criar evento de reunião (operador):', e.message)
      }
    }

    // Notifica o time de reunião.
    const phone = numeroDisplayDoJid(numero)
    const dataAmigavel = dataStr ? `${dataStr.slice(8, 10)}/${dataStr.slice(5, 7)}` : (det.dataRelativa || null)
    const quando = [dataAmigavel, det.horario ? `às ${det.horario}` : null].filter(Boolean).join(' ')
    const texto =
      `✅ Reunião fechada por operador — PJ Codeworks\n` +
      `Lead: ${phone}\n` +
      `Negócio: ${perfil.negocio || '?'} | ${perfil.cidade || '?'}\n` +
      (quando ? `Quando: ${quando}\n` : 'Quando: confirmar horário com o lead\n') +
      (eventoCriado ? '📅 Evento criado na Agenda.\n' : '⚠️ Sem data/hora exata — adicionar na Agenda manualmente.\n') +
      'Ação: confirmar a reunião e o horário com o lead.'
    await notificarVictorWhatsapp(texto)
    await registrarEventoComercial(numero, 'reuniao_fechada_por_operador', {
      horario: det.horario || null,
      data_relativa: det.dataRelativa || null,
      confianca: det.confianca,
      evento_criado: eventoCriado,
    }).catch(() => {})
    logger.info(
      `📅 #4 reunião fechada por operador (${phone}) — horario=${det.horario || '?'} data=${det.dataRelativa || '?'} evento=${eventoCriado}`
    )
  } catch (e) {
    logger.warn('⚠️ #4 tratarPossivelReuniaoOperador falhou:', e.message)
  }
}

// Envolve o registro de resposta ao lembrete: quando o LEAD pede reagendamento,
// avisa o operador reusando o ping de handoff (só indicando a alteração pelo lead).
async function registrarRespostaLembreteReuniaoComAlerta(numero, texto, opts) {
  const res = await registrarRespostaLembreteReuniao(numero, texto, opts)
  if (res && res.resposta === 'reagendamento_pendente') {
    try {
      const perfil = await buscarPerfil(numero)
      await alertarReagendamentoReuniao(numero, perfil || { numero }, {
        nota: `O lead pediu para remarcar a reunião (resposta ao lembrete). Reoferta ${res.mensagem_enviada ? 'enviada' : 'não enviada'} ao lead.`,
      })
    } catch (e) {
      logger.warn('alerta de reagendamento falhou:', e.message)
    }
  }
  return res
}

registerWebhookRoute(app, {
  webhookAutorizado,
  gerarRequestIdAnthropic,
  loggerForWebhook,
  logger,
  tratarPossivelReuniaoOperador,
  canonicoRemoteJidParaConversa,
  listarOperadoresAtivos,
  jidIgual,
  processarComandosOperadorChat,
  isConversaLeadUmAUm,
  processarIntervencaoOperadorNoLead,
  construirChaveIdempotenciaWebhookMensagem,
  webhookMensagemDeveSerProcessada,
  extrairTextoEMidiaDoWebhook,
  buscarConversa,
  normalizarHistoricoMensagens,
  marcarProspectComoRespondeuPorNumero,
  buscarContextoProspeccao,
  textoEhAutoReplyWhatsApp,
  atualizarPerfil,
  salvarConversa,
  cancelarFollowupsAutoPendentes,
  textoPedePreco,
  registrarEventoComercial,
  marcarRespostaFollowupSeAplicavel,
  serializeError,
  obterEstadoDebounceResposta,
  textoJaProcessadoRecentemente,
  enfileirarJobRespostaWebhook,
  registrarRespostaLembreteReuniao: registrarRespostaLembreteReuniaoComAlerta,
  podeGerarRespostaAutomatica,
})

/** Detalhe de uma conversa para o dashboard (perfil do lead). Auth: x-reprocess-secret se REPROCESS_SECRET definido. */
app.get('/dashboard/conversa-detalhe', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.query?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({
      ok: false,
      erro: 'Parâmetro query "numero" (telefone ou JID) é obrigatório',
    })
  }
  try {
    const conversa = await buscarConversa(jid)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }
    const [
      { rows: perfilRows },
      { rows: lacunas },
      { rows: sugEstRows },
      analise_conversa,
      historico_analises,
      contextos,
      { rows: audioPendentes },
    ] = await Promise.all([
      pool.query('SELECT * FROM vendas.lead_profiles WHERE numero = $1', [jid]),
      pool.query(
        `SELECT id, tema_lacuna, detalhe_lacuna, criado_em, resolucao_nota, resolvido_em
         FROM vendas.conhecimento_lacunas WHERE numero = $1 ORDER BY criado_em DESC LIMIT 20`,
        [jid]
      ),
      pool.query(`SELECT DISTINCT estagio FROM vendas.conversas ORDER BY estagio ASC LIMIT 60`),
      buscarUltimaAnalisePosConversa(jid, conversa.estagio),
      buscarHistoricoAnalisesPosConversa(jid, 8),
      buscarLeadContextos(jid, 20),
      pool.query(
        `SELECT id, numero, message_key, mimetype, status, attempts, erro, transcricao, criado_em, atualizado_em, processado_em
         FROM vendas.audio_processamentos
         WHERE numero = $1 AND status <> 'processed'
         ORDER BY criado_em DESC
         LIMIT 20`,
        [jid]
      ),
    ])
    const perfil = perfilRows[0] || null
    const estagios_sugeridos = sugEstRows.map((r) => r.estagio).filter((e) => e != null && String(e).trim() !== '')

    // Reunião agendada (próxima/pendente) — objetivo do funil, exibida na página.
    const phoneDigits = String(jid).replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')
    let reuniao_agendada = null
    try {
      const { rows: rAg } = await pool.query(
        `SELECT id, titulo, data_inicio, data_fim, status, origem
         FROM vendas.agenda_eventos
         WHERE tipo = 'reuniao' AND excluido_em IS NULL
           AND status IN ('pendente', 'confirmado')
           AND (metadata->>'lead_numero' = $1
                OR conversa_id = (SELECT id FROM vendas.conversas WHERE numero = $2 LIMIT 1))
           AND data_inicio >= NOW() - INTERVAL '2 hours'
         ORDER BY data_inicio ASC
         LIMIT 1`,
        [phoneDigits, jid]
      )
      if (rAg[0]) {
        reuniao_agendada = {
          id: rAg[0].id,
          titulo: rAg[0].titulo,
          data_inicio: rAg[0].data_inicio instanceof Date ? rAg[0].data_inicio.toISOString() : rAg[0].data_inicio,
          data_fim: rAg[0].data_fim instanceof Date ? rAg[0].data_fim.toISOString() : rAg[0].data_fim,
          status: rAg[0].status,
          origem: rAg[0].origem,
        }
      }
    } catch (e) {
      logger.warn('conversa-detalhe agenda:', e.message)
    }
    const {
      numero,
      estagio,
      status,
      venda_fechada,
      agente_pausado,
      arquivado,
      motivo_arquivamento,
      arquivado_em,
      ultima_falha_resposta_codigo,
      ultima_falha_resposta_msg,
      ultima_falha_resposta_em,
      criado_em,
      atualizado_em,
    } = conversa
    res.json({
      ok: true,
      numero,
      estagio,
      status,
      venda_fechada,
      agente_pausado,
      arquivado,
      motivo_arquivamento,
      arquivado_em,
      erro_resposta_codigo: ultima_falha_resposta_codigo,
      erro_resposta_msg: ultima_falha_resposta_msg,
      erro_resposta_em: ultima_falha_resposta_em,
      criado_em,
      atualizado_em,
      perfil,
      reuniao_agendada,
      lacunas,
      contextos,
      audio_pendentes: audioPendentes,
      analise_conversa,
      historico_analises,
      historico: sanitizarHistoricoParaRespostaDashboard(conversa.historico),
      estagios_sugeridos,
    })
  } catch (err) {
    logger.error('❌ conversa-detalhe:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Exporta conversa completa formatada em texto. Auth: x-reprocess-secret. */
app.get('/dashboard/conversa-completa', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.query?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Parâmetro query "numero" é obrigatório' })
  }
  try {
    const conversa = await buscarConversa(jid)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }
    const [{ rows: perfilRows }, { rows: agendaRows }] = await Promise.all([
      pool.query('SELECT * FROM vendas.lead_profiles WHERE numero = $1', [jid]),
      pool.query(
        `SELECT titulo, tipo, status, data_inicio, excluido_em
         FROM vendas.agenda_eventos
         WHERE conversa_id = (SELECT id FROM vendas.conversas WHERE numero = $1)
           AND excluido_em IS NULL
         ORDER BY data_inicio ASC`,
        [jid]
      ),
    ])
    const perfil = perfilRows[0] || null
    const texto = gerarTextoConversaCompleta(conversa, perfil, agendaRows)
    res.json({
      ok: true,
      texto,
      lead: {
        numero: jid,
        negocio: perfil?.negocio || null,
        cidade: perfil?.cidade || null,
        temperatura_lead: perfil?.temperatura_lead || null,
      },
    })
  } catch (err) {
    logger.error('❌ conversa-completa:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

const CONVERSA_META_STATUS = ['ativo', 'aguardando_handoff']

/**
 * Corrige metadados do funil (venda fechada, estágio, status) sem alterar histórico.
 * Auth: x-reprocess-secret se REPROCESS_SECRET definido.
 */
app.patch('/dashboard/conversa-meta', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  try {
    const conv = await buscarConversa(jid)
    if (!conv) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }

    const parts = []
    const vals = []

    if (Object.prototype.hasOwnProperty.call(req.body, 'venda_fechada')) {
      parts.push(`venda_fechada = $${vals.length + 1}`)
      vals.push(!!req.body.venda_fechada)
    }
    if (typeof req.body.estagio === 'string') {
      const raw = req.body.estagio.trim()
      if (raw.length > 0) {
        if (raw.length > 120 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw)) {
          return res.status(400).json({ ok: false, erro: 'Valor de estagio inválido' })
        }
        parts.push(`estagio = $${vals.length + 1}`)
        vals.push(normalizarEstagio(raw, raw.slice(0, 120)))
      }
    }
    if (typeof req.body.status === 'string') {
      const st = req.body.status.trim()
      if (!CONVERSA_META_STATUS.includes(st)) {
        return res.status(400).json({
          ok: false,
          erro: `status deve ser um de: ${CONVERSA_META_STATUS.join(', ')}`,
        })
      }
      parts.push(`status = $${vals.length + 1}`)
      vals.push(st)
    }

    if (parts.length === 0) {
      return res.status(400).json({
        ok: false,
        erro: 'Envie ao menos um de: venda_fechada, estagio (texto não vazio), status',
      })
    }

    parts.push('atualizado_em = NOW()')
    vals.push(jid)
    const sql = `UPDATE vendas.conversas SET ${parts.join(', ')} WHERE numero = $${vals.length}`
    await pool.query(sql, vals)
    const c2 = await buscarConversa(jid)
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'venda_fechada') &&
      !!req.body.venda_fechada &&
      !conv.venda_fechada
    ) {
      const perfil = await buscarPerfil(jid)
      await alertarVendaFechadaOperadores(jid, perfil, {
        total: perfil.preco_calculado || 0,
        entrada: perfil.entrada || 0,
        parcela: perfil.parcela || 0,
      }, 'Marcada manualmente no dashboard.')
    }
    res.json({
      ok: true,
      numero: c2.numero,
      estagio: c2.estagio,
      status: c2.status,
      venda_fechada: c2.venda_fechada,
    })
  } catch (err) {
    logger.error('❌ conversa-meta:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * Gera análise interna (coach + prompt Gamma). Auth: x-reprocess-secret se REPROCESS_SECRET definido.
 */
app.post('/dashboard/lead-coach', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const raw = req.body?.numero
  const jid = typeof raw === 'string' ? normalizarNumeroParaJid(raw.trim()) : null
  if (!jid) {
    return res.status(400).json({ ok: false, erro: 'Campo "numero" (telefone ou JID) é obrigatório' })
  }
  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ ok: false, erro: 'ANTHROPIC_KEY não configurada no servidor' })
  }
  try {
    const conversa = await buscarConversa(jid)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada para este número.' })
    }
    const perfil = await buscarPerfil(jid)
    const coach = await chamarClaudeLeadCoach({ numero: jid, conversa, perfil })
    const analise = await salvarAnalisePosConversa(jid, coach, conversa)
    // Score da análise (mais profundo) atualiza/registra o score_lead do perfil.
    const scoreCoach = analise?.coach?.score ?? coach?.score
    if (Number.isFinite(Number(scoreCoach)) && Number(scoreCoach) > 0) {
      await atualizarPerfil(jid, { score_lead: Math.max(0, Math.min(100, Math.round(Number(scoreCoach)))) }).catch((e) =>
        logger.warn('score_lead (coach) nao atualizado:', e.message)
      )
    }
    res.json({ ok: true, coach: analise?.coach || normalizarLeadCoachPayload(coach), analise })
  } catch (err) {
    logger.error('❌ lead-coach:', err.response?.data || err.message)
    const msg =
      (err.response && err.response.data && err.response.data.error && err.response.data.error.message) ||
      err.message ||
      String(err)
    let code = 500
    if (String(msg).includes('ANTHROPIC_KEY')) code = 503
    else if (err.response && err.response.status === 429) code = 429
    else if (err.response && err.response.status >= 400 && err.response.status < 500) code = 502
    res.status(code).json({ ok: false, erro: msg })
  }
})

app.post('/dashboard/lead-contexto', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const conteudo = limparConteudoLeadContexto(req.body?.conteudo)
  if (!conteudo) return res.status(400).json({ ok: false, erro: 'Contexto vazio' })
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const contexto = await salvarLeadContexto(jid, {
      tipo: req.body?.tipo || 'contexto_manual',
      conteudo,
      origem: 'operador',
    })
    res.json({ ok: true, contexto })
  } catch (err) {
    logger.error('POST lead-contexto:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.get('/dashboard/audio-pendentes', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.query?.numero === 'string' ? normalizarNumeroParaJid(req.query.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Parametro "numero" e obrigatorio' })
  try {
    const { rows } = await pool.query(
      `SELECT id, numero, message_key, mimetype, status, attempts, erro, criado_em, atualizado_em
       FROM vendas.audio_processamentos
       WHERE numero = $1 AND status <> 'processed'
       ORDER BY criado_em DESC
       LIMIT 50`,
      [jid]
    )
    res.json({ ok: true, audio_pendentes: rows })
  } catch (err) {
    logger.error('GET audio-pendentes:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/audio-reprocessar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const id = parseInt(req.body?.id, 10)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, erro: 'Campo "id" invalido' })
  try {
    const { rows } = await pool.query('SELECT * FROM vendas.audio_processamentos WHERE id = $1', [id])
    const row = rows[0]
    if (!row) return res.status(404).json({ ok: false, erro: 'Audio pendente nao encontrado' })
    if (!row.web_message_info) {
      return res.status(422).json({ ok: false, erro: 'Audio antigo sem payload salvo; use upload manual no perfil do lead.' })
    }
    const msg = row.web_message_info
    const audioPart = localizarAudioPartMensagem(msg)
    const rAudio = await baixarETranscreverAudioMensagem(msg, audioPart)
    const contexto = await salvarLeadContexto(row.numero, {
      tipo: 'audio_reprocessado',
      origem: 'audio_reprocessado',
      conteudo: `[Audio antigo reprocessado]\n[Audio transcrito] ${rAudio.transcricao}`,
      metadata: { audio_processamento_id: row.id, message_key: row.message_key },
    })
    await pool.query(
      `UPDATE vendas.audio_processamentos
       SET status = 'processed', attempts = attempts + 1, erro = NULL, transcricao = $2,
           processado_em = NOW(), atualizado_em = NOW()
       WHERE id = $1`,
      [row.id, rAudio.transcricao]
    )
    res.json({ ok: true, contexto, transcricao: rAudio.transcricao })
  } catch (err) {
    logger.error('POST audio-reprocessar:', err.response?.data || err.message)
    await pool.query(
      `UPDATE vendas.audio_processamentos
       SET status = 'pending', attempts = attempts + 1, erro = $2, atualizado_em = NOW()
       WHERE id = $1`,
      [id, resumirTextoOperacional(err.message || String(err), 800)]
    ).catch(() => {})
    res.status(500).json({ ok: false, erro: err.message || String(err) })
  }
})

app.post('/dashboard/audio-upload-contexto', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  const jid = typeof req.body?.numero === 'string' ? normalizarNumeroParaJid(req.body.numero.trim()) : null
  if (!jid) return res.status(400).json({ ok: false, erro: 'Campo "numero" e obrigatorio' })
  const rawB64 = limparBase64String(String(req.body?.base64 || ''))
  if (!rawB64) return res.status(400).json({ ok: false, erro: 'Arquivo de audio ausente' })
  let buffer
  try {
    buffer = Buffer.from(rawB64, 'base64')
  } catch (_) {
    return res.status(400).json({ ok: false, erro: 'Audio em base64 invalido' })
  }
  if (!buffer.length) return res.status(400).json({ ok: false, erro: 'Arquivo de audio vazio' })
  if (buffer.length > AUDIO_UPLOAD_MAX_BYTES) {
    return res.status(413).json({ ok: false, erro: 'Audio muito grande para upload manual' })
  }
  try {
    const conv = await buscarConversa(jid)
    if (!conv) return res.status(404).json({ ok: false, erro: 'Conversa nao encontrada' })
    const mimetype = String(req.body?.mimetype || 'audio/ogg').split(';')[0].trim() || 'audio/ogg'
    const filename = String(req.body?.filename || 'audio-upload').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'audio-upload'
    const transcricao = await transcreverAudioLocal(buffer, filename, mimetype)
    if (!transcricao || !transcricao.trim()) throw new Error('Whisper retornou transcricao vazia')
    const contexto = await salvarLeadContexto(jid, {
      tipo: 'audio_upload',
      origem: 'operador_upload',
      conteudo: `[Audio anexado manualmente pelo operador: ${filename}]\n[Audio transcrito] ${transcricao.trim()}`,
      metadata: { filename, mimetype, bytes: buffer.length },
    })
    res.json({ ok: true, contexto, transcricao: transcricao.trim() })
  } catch (err) {
    logger.error('POST audio-upload-contexto:', err.response?.data || err.message)
    res.status(500).json({ ok: false, erro: err.message || String(err) })
  }
})

app.get('/dashboard/data', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const {
      limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente,
      busca, motivo, temperatura, origem, urgencia, scoreMin, followup, acaoAgora, arquivado,
    } =
      parseDashboardListQuery(req)
    const { where, params: wparams } = buildWhereConversasFiltros(estagio, desde, ate, {
      filaPreco,
      precoDivergente,
      busca,
      motivo,
      temperatura,
      origem,
      urgencia,
      scoreMin,
      followup,
      acaoAgora,
      arquivado,
    })
    const orderCol = ordenar === 'criado' ? 'c.criado_em' : 'c.atualizado_em'
    const orderDir = direcao === 'asc' ? 'ASC' : 'DESC'

    const listParams = [...wparams, limit, offset]
    const listSql = `
      ${DASHBOARD_CONVERSA_SELECT}
      WHERE ${where}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${wparams.length + 1} OFFSET $${wparams.length + 2}
    `
    const countSql = `
      SELECT COUNT(*)::bigint AS n
      FROM vendas.conversas c
      LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
      WHERE ${where}
    `

    const [
      { rows: conversas },
      { rows: countRows },
      { rows: totais },
      { rows: estagioRows },
      { rows: resumoRows },
      aprendizado,
      { rows: lacunasAbertas },
    ] = await Promise.all([
      pool.query(listSql, listParams),
      pool.query(countSql, wparams),
      pool.query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN venda_fechada THEN 1 ELSE 0 END) as fechadas,
             SUM(CASE WHEN status = 'aguardando_handoff' THEN 1 ELSE 0 END) as handoffs
      FROM vendas.conversas
    `),
      pool.query(`
      SELECT DISTINCT estagio FROM vendas.conversas WHERE venda_fechada = false ORDER BY estagio
    `),
      pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE c.arquivado = false AND (
            c.ultima_falha_resposta_em IS NOT NULL
            OR c.status = 'aguardando_handoff'
            OR (COALESCE(jsonb_array_length(c.historico), 0) > 0 AND (c.historico->-1->>'role') = 'user')
          )
        )::int AS acao_agora,
        COUNT(*) FILTER (
          WHERE c.arquivado = false
            AND COALESCE(jsonb_array_length(c.historico), 0) > 0
            AND (c.historico->-1->>'role') = 'user'
        )::int AS sem_resposta,
        COUNT(*) FILTER (WHERE c.arquivado = false AND p.temperatura_lead = 'quente')::int AS leads_quentes,
        COUNT(*) FILTER (WHERE c.arquivado = false AND p.origem = 'prospeccao')::int AS prospectados,
        COUNT(*) FILTER (WHERE c.arquivado = false AND p.origem = 'meta_ads')::int AS meta_ads,
        COUNT(*) FILTER (WHERE c.arquivado = false AND COALESCE(p.origem, 'inbound') IN ('inbound', 'organico'))::int AS organicos,
        COUNT(*) FILTER (WHERE c.arquivado = false AND COALESCE(p.score_lead, 0) >= 70)::int AS score_70,
        ROUND(AVG(p.score_lead) FILTER (WHERE c.arquivado = false AND p.score_lead IS NOT NULL))::int AS score_medio,
        COUNT(*) FILTER (
          WHERE c.arquivado = false AND EXISTS (
            SELECT 1 FROM vendas.followup_auto_agendamentos fa
            WHERE fa.numero = c.numero AND fa.status = 'agendado'
              AND fa.agendado_para >= date_trunc('day', NOW())
              AND fa.agendado_para < date_trunc('day', NOW()) + interval '1 day'
          )
        )::int AS followups_hoje,
        COUNT(*) FILTER (
          WHERE c.arquivado = false AND EXISTS (
            SELECT 1 FROM vendas.followup_auto_agendamentos fa
            WHERE fa.numero = c.numero AND fa.status = 'agendado' AND fa.agendado_para <= NOW()
          )
        )::int AS followups_vencidos
      FROM vendas.conversas c
      LEFT JOIN vendas.lead_profiles p ON p.numero = c.numero
    `),
      buscarUltimoAprendizado(),
      pool.query(`
      SELECT l.id, l.numero, l.tema_lacuna, l.detalhe_lacuna, l.criado_em, p.negocio AS negocio_lead
      FROM vendas.conhecimento_lacunas l
      LEFT JOIN vendas.lead_profiles p ON p.numero = l.numero
      WHERE l.resolvido_em IS NULL
      ORDER BY l.criado_em DESC
      LIMIT 15
    `),
    ])

    const totalFiltrado = parseInt(countRows[0].n, 10)
    const estagios_disponiveis = ['fechado', ...estagioRows.map((r) => r.estagio)]

    res.json({
      total: parseInt(totais[0].total, 10),
      fechadas: parseInt(totais[0].fechadas, 10),
      handoffs: parseInt(totais[0].handoffs, 10),
      taxa_conversao:
        totais[0].total > 0 ? ((totais[0].fechadas / totais[0].total) * 100).toFixed(1) : '0.0',
      conversas,
      resumo_operacional: resumoRows[0] || {},
      aprendizado,
      filtro: {
        estagio: estagio || null,
        desde: desde || null,
        ate: ate || null,
        busca: busca || null,
        motivo: motivo || null,
        temperatura: temperatura || null,
        origem: origem || null,
        urgencia: urgencia || null,
        score_min: scoreMin || null,
        followup: followup || null,
        acao_agora: !!acaoAgora,
        limit,
        offset,
        ordenar,
        direcao,
        total_filtrado: totalFiltrado,
        fila_preco: !!filaPreco,
        preco_divergente: !!precoDivergente,
        arquivado: !!arquivado,
      },
      estagios_disponiveis,
      lacunas_abertas_recentes: lacunasAbertas,
    })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

function parseDashboardDiasQuery(req) {
  const raw = req.query && req.query.dias != null ? parseInt(String(req.query.dias), 10) : NaN
  return Math.min(366, Math.max(1, Number.isFinite(raw) ? raw : 30))
}

/** Série diária filtrada por estágio e datas. Aceita: dias, estagio, desde, ate. Auth: x-reprocess-secret. */
app.get('/dashboard/stats/diario', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  const estagio = req.query.estagio ? String(req.query.estagio).trim() : ''
  const desde = req.query.desde ? String(req.query.desde).trim() : ''
  const ate = req.query.ate ? String(req.query.ate).trim() : ''
  try {
    const { query, params, mode } = buildDiarioQuery(estagio, dias, desde, ate)
    const { rows } = await pool.query(query, params)
    if (mode === 'dual') {
      res.json({
        serie: rows.map((r) => ({ dia: r.dia, novas: r.novas, fechadas: r.fechadas })),
        mode: 'dual',
        estagio: '',
        nota_fechadas_diario:
          'Fechadas: contagem por dia de atualizado_em com venda_fechada = true (aproxima o dia em que a venda foi marcada).',
      })
    } else {
      const total = rows.reduce((s, r) => s + (r.total || 0), 0)
      const best = rows.length > 0 ? rows.reduce((b, r) => (r.total > b.total ? r : b)) : null
      res.json({
        serie: rows.map((r) => ({ dia: r.dia, total: r.total })),
        mode: 'single',
        estagio,
        totais: {
          total,
          mediaDia: rows.length > 0 ? Math.round((total / rows.length) * 100) / 100 : 0,
          melhorDia: best && best.total > 0 ? best.dia : null,
        },
      })
    }
  } catch (err) {
    logger.error('❌ GET stats/diario:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Métricas agregadas e série diária de follow-ups manuais. Auth: x-reprocess-secret. */
app.get('/dashboard/stats/followup', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  try {
    const [{ rows: sumRows }, { rows: serieRows }] = await Promise.all([
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT
          COUNT(*) FILTER (WHERE f.envio_ok) AS enviados_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.resposta_lead_em IS NOT NULL) AS com_resposta,
          COUNT(*) FILTER (WHERE NOT f.envio_ok) AS falhas_envio,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'reengajamento') AS rej_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'reengajamento' AND f.resposta_lead_em IS NOT NULL) AS rej_resp,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'fluxo_funil') AS fun_ok,
          COUNT(*) FILTER (WHERE f.envio_ok AND f.modo = 'fluxo_funil' AND f.resposta_lead_em IS NOT NULL) AS fun_resp
        FROM vendas.followup_envios f, bounds b
        WHERE f.criado_em::date >= b.d0 AND f.criado_em::date <= b.d1
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1),
        days AS (
          SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
          FROM bounds b
        ),
        agg AS (
          SELECT date_trunc('day', f.criado_em)::date AS dia,
                 COUNT(*) FILTER (WHERE f.envio_ok)::int AS enviados_ok,
                 COUNT(*) FILTER (WHERE f.envio_ok AND f.resposta_lead_em IS NOT NULL)::int AS com_resposta
          FROM vendas.followup_envios f, bounds b
          WHERE f.criado_em::date >= b.d0 AND f.criado_em::date <= b.d1
          GROUP BY 1
        )
        SELECT d.dia::text AS dia, COALESCE(a.enviados_ok, 0) AS enviados_ok, COALESCE(a.com_resposta, 0) AS com_resposta
        FROM days d
        LEFT JOIN agg a ON a.dia = d.dia
        ORDER BY d.dia
        `,
        [dias]
      ),
    ])
    const s = sumRows[0] || {}
    const envOk = parseInt(s.enviados_ok, 10) || 0
    const comResp = parseInt(s.com_resposta, 10) || 0
    const taxa =
      envOk > 0 ? Math.round((10000 * comResp) / envOk) / 100 : 0
    res.json({
      ok: true,
      resumo: {
        enviados_ok: envOk,
        com_resposta: comResp,
        taxa_resposta_pct: taxa,
        falhas_envio: parseInt(s.falhas_envio, 10) || 0,
        por_modo: {
          reengajamento: {
            enviados_ok: parseInt(s.rej_ok, 10) || 0,
            com_resposta: parseInt(s.rej_resp, 10) || 0,
          },
          fluxo_funil: {
            enviados_ok: parseInt(s.fun_ok, 10) || 0,
            com_resposta: parseInt(s.fun_resp, 10) || 0,
          },
        },
      },
      serie_diaria: serieRows.map((r) => ({
        dia: r.dia,
        enviados_ok: r.enviados_ok,
        com_resposta: r.com_resposta,
      })),
      nota:
        'Taxa de resposta = com_resposta / enviados_ok no período (só envios com envio_ok). ' +
        'Reengajamento: última mensagem era assistente/operador. Continuar no funil: última mensagem era do lead.',
    })
  } catch (err) {
    logger.error('❌ GET stats/followup:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/**
 * Uso agregado de chamadas LLM (vendas.llm_chamadas): tokens, séries e breakdown.
 * Estimativa em USD/BRL opcional via LLM_ESTIMATE_INPUT_PER_MTOK_USD, LLM_ESTIMATE_OUTPUT_PER_MTOK_USD, LLM_USD_BRL.
 * Auth: x-reprocess-secret.
 */
app.get('/dashboard/stats/llm-uso', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const dias = parseDashboardDiasQuery(req)
  const pricing = parseLlmPricingEnv()
  try {
    const [
      { rows: periodoRows },
      { rows: totaisRows },
      { rows: serieRows },
      { rows: tipoRows },
      { rows: modelRows },
    ] = await Promise.all([
      pool.query(
        `SELECT (CURRENT_DATE - ($1::int - 1))::date::text AS d0, CURRENT_DATE::date::text AS d1`,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT
          COUNT(*)::bigint AS chamadas,
          COUNT(*) FILTER (WHERE NOT l.http_ok)::bigint AS chamadas_erro,
          COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'cache_creation_input_tokens')::bigint, 0)), 0)::text AS cache_creation_input_tokens,
          COALESCE(SUM(COALESCE((l.usage->>'cache_read_input_tokens')::bigint, 0)), 0)::text AS cache_read_input_tokens,
          COALESCE(AVG(l.duration_ms) FILTER (WHERE l.duration_ms IS NOT NULL), 0)::numeric AS avg_duration_ms
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1),
        days AS (
          SELECT generate_series(b.d0, b.d1, interval '1 day')::date AS dia
          FROM bounds b
        ),
        agg AS (
          SELECT date_trunc('day', l.criado_em)::date AS dia,
                 COUNT(*)::int AS chamadas,
                 COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
                 COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
          FROM vendas.llm_chamadas l, bounds b
          WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
          GROUP BY 1
        )
        SELECT d.dia::text AS dia,
               COALESCE(a.chamadas, 0) AS chamadas,
               COALESCE(a.input_tokens, '0') AS input_tokens,
               COALESCE(a.output_tokens, '0') AS output_tokens
        FROM days d
        LEFT JOIN agg a ON a.dia = d.dia
        ORDER BY d.dia
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT COALESCE(l.tipo, '') AS tipo,
               COUNT(*)::bigint AS chamadas,
               COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
               COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        GROUP BY l.tipo
        ORDER BY chamadas DESC
        LIMIT 80
        `,
        [dias]
      ),
      pool.query(
        `
        WITH bounds AS (SELECT (CURRENT_DATE - ($1::int - 1))::date AS d0, CURRENT_DATE::date AS d1)
        SELECT COALESCE(l.model, '') AS model,
               COUNT(*)::bigint AS chamadas,
               COALESCE(SUM(COALESCE((l.usage->>'input_tokens')::bigint, 0)), 0)::text AS input_tokens,
               COALESCE(SUM(COALESCE((l.usage->>'output_tokens')::bigint, 0)), 0)::text AS output_tokens
        FROM vendas.llm_chamadas l, bounds b
        WHERE l.criado_em::date >= b.d0 AND l.criado_em::date <= b.d1
        GROUP BY l.model
        ORDER BY chamadas DESC
        LIMIT 80
        `,
        [dias]
      ),
    ])

    const p0 = periodoRows[0] || {}
    const t0 = totaisRows[0] || {}
    const inputTokens = parseInt(String(t0.input_tokens || '0'), 10) || 0
    const outputTokens = parseInt(String(t0.output_tokens || '0'), 10) || 0
    const estimativa = estimativaCustoLlm(inputTokens, outputTokens, pricing)

    res.json({
      ok: true,
      periodo: { dias, d0: p0.d0 || null, d1: p0.d1 || null },
      totais: {
        chamadas: parseInt(String(t0.chamadas || '0'), 10) || 0,
        chamadas_erro: parseInt(String(t0.chamadas_erro || '0'), 10) || 0,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: parseInt(String(t0.cache_creation_input_tokens || '0'), 10) || 0,
        cache_read_input_tokens: parseInt(String(t0.cache_read_input_tokens || '0'), 10) || 0,
        avg_duration_ms: t0.avg_duration_ms != null ? Number(t0.avg_duration_ms) : 0,
      },
      estimativa,
      precificacao_env_configurada: pricing.ok,
      serie_diaria: serieRows.map((r) => ({
        dia: r.dia,
        chamadas: r.chamadas,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      por_tipo: tipoRows.map((r) => ({
        tipo: r.tipo,
        chamadas: parseInt(String(r.chamadas || '0'), 10) || 0,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      por_model: modelRows.map((r) => ({
        model: r.model,
        chamadas: parseInt(String(r.chamadas || '0'), 10) || 0,
        input_tokens: parseInt(String(r.input_tokens || '0'), 10) || 0,
        output_tokens: parseInt(String(r.output_tokens || '0'), 10) || 0,
      })),
      nota:
        'Tokens somados a partir do JSON usage gravado em cada chamada. Estimativa em USD/BRL só aparece se LLM_ESTIMATE_INPUT_PER_MTOK_USD e LLM_ESTIMATE_OUTPUT_PER_MTOK_USD estiverem definidos; LLM_USD_BRL é opcional.',
    })
  } catch (err) {
    logger.error('❌ GET stats/llm-uso:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Últimos registros de follow-up manual. Auth: x-reprocess-secret. */
app.get('/dashboard/followup-recentes', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const lim = Math.min(500, Math.max(1, parseInt(String(req.query?.limit || '40'), 10) || 40))
  try {
    const { rows } = await pool.query(
      `
      SELECT criado_em, numero, modo, envio_ok, resposta_lead_em, mensagem_preview
      FROM vendas.followup_envios
      ORDER BY criado_em DESC
      LIMIT $1
      `,
      [lim]
    )
    res.json({
      ok: true,
      itens: rows.map((r) => ({
        criado_em: r.criado_em,
        numero: r.numero,
        modo: r.modo,
        envio_ok: r.envio_ok,
        resposta_lead_em: r.resposta_lead_em,
        mensagem_preview: r.mensagem_preview,
      })),
    })
  } catch (err) {
    logger.error('❌ GET followup-recentes:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

/** Exporta conversas filtradas como CSV (mesmos filtros que /dashboard/data). Auth: x-reprocess-secret. */
app.get('/dashboard/export.csv', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const { limit, offset, estagio, desde, ate, ordenar, direcao, filaPreco, precoDivergente } =
      parseDashboardListQuery(req, {
        maxLimit: 20000,
      })
    const { where, params: wparams } = buildWhereConversasFiltros(estagio, desde, ate, {
      filaPreco,
      precoDivergente,
    })
    const orderCol = ordenar === 'criado' ? 'c.criado_em' : 'c.atualizado_em'
    const orderDir = direcao === 'asc' ? 'ASC' : 'DESC'
    const listParams = [...wparams, limit, offset]
    const listSql = `
      ${DASHBOARD_CONVERSA_SELECT}
      WHERE ${where}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${wparams.length + 1} OFFSET $${wparams.length + 2}
    `
    const { rows } = await pool.query(listSql, listParams)
    const cols = [
      'numero',
      'estagio',
      'status',
      'venda_fechada',
      'agente_pausado',
      'mensagens',
      'criado_em',
      'atualizado_em',
      'negocio',
      'cidade',
      'preco_calculado',
      'termometro_dor',
      'temperatura_lead',
      'preco_ia_divergente_motor',
      'ia_total_projeto_detectado_ultima_resposta',
      'lead_fila_preco_sem_calculo',
      'resposta_pendente',
      'erro_resposta_pendente',
      'ultima_falha_resposta_codigo',
      'ultima_falha_resposta_msg',
      'ultima_falha_resposta_em',
    ]
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="conversas-dashboard.csv"')
    res.write(cols.join(',') + '\n')
    for (const row of rows) {
      const line =
        cols
          .map((k) => csvEscapeCell(row[k]))
          .join(',') + '\n'
      res.write(line)
    }
    res.end()
  } catch (err) {
    logger.error('❌ GET export.csv:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ ok: false, erro: err.message })
    } else {
      res.end()
    }
  }
})

/** Lista análises por etapa com filtros úteis para revisão operacional. */
app.get('/dashboard/analises-etapas', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const { limit, offset, numero, etapa, sinalIa, desde, ate } = parseDashboardAnalisesQuery(req)
    const { where, params } = buildWhereAnalisesFiltros(numero, etapa, sinalIa, desde, ate)
    const listParams = [...params, limit, offset]
    const [
      { rows },
      { rows: countRows },
      { rows: etapasRows },
      { rows: sinaisRows },
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          a.id, a.numero, a.etapa, a.status_conversa, a.resumo_problema,
          a.o_que_faltou_para_vender, a.melhorias_para_ia, a.sinais_melhoria_ia,
          a.acoes_de_preparo, a.confianca_analise, a.criado_em, a.atualizado_em,
          p.negocio, p.cidade
        FROM vendas.analises_pos_conversa a
        LEFT JOIN vendas.lead_profiles p ON p.numero = a.numero
        WHERE ${where}
        ORDER BY a.criado_em DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        listParams
      ),
      pool.query(`SELECT COUNT(*)::bigint AS n FROM vendas.analises_pos_conversa a WHERE ${where}`, params),
      pool.query(`SELECT DISTINCT etapa FROM vendas.analises_pos_conversa ORDER BY etapa ASC LIMIT 100`),
      pool.query(
        `
        SELECT DISTINCT unnest(COALESCE(sinais_melhoria_ia, '{}'::text[])) AS sinal
        FROM vendas.analises_pos_conversa
        WHERE COALESCE(array_length(sinais_melhoria_ia, 1), 0) > 0
        ORDER BY sinal ASC
        LIMIT 100
        `
      ),
    ])

    const analises = rows.map((row) => hidratarAnalisePosConversa(row))

    res.json({
      ok: true,
      analises,
      resumo_geral_etapa: montarResumoGeralEtapaAnalises(analises, etapa),
      filtro: {
        numero,
        etapa,
        sinal_ia: sinalIa,
        desde,
        ate,
        limit,
        offset,
        total_filtrado: parseInt(countRows[0]?.n || '0', 10),
      },
      etapas_disponiveis: etapasRows.map((r) => r.etapa).filter(Boolean),
      sinais_ia_disponiveis: sinaisRows.map((r) => r.sinal).filter(Boolean),
    })
  } catch (err) {
    logger.error('❌ GET analises-etapas:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── AUTO-MELHORIA: ROTAS DE APRENDIZADOS ────────────────────────────────────

app.get('/dashboard/prompt-aprendizados', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const apenas_ativos = req.query.apenas_ativos === 'true'
    const aprendizados = await listarPromptAprendizados({ apenas_ativos })
    const pendentes = await contarAnalisesDesdaUltimaConsolidacao()
    res.json({ ok: true, aprendizados, analises_pendentes: pendentes })
  } catch (err) {
    logger.error('❌ GET prompt-aprendizados:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/consolidar-aprendizados', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const etapa = req.body?.etapa || null
    const resultado = await consolidarAprendizadoAnalises({ etapa })
    res.json(resultado)
  } catch (err) {
    logger.error('❌ consolidar-aprendizados:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/prompt-aprendizados/:id/aprovar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' })
    const r = await aprovarAprendizado(id)
    if (!r) return res.status(404).json({ ok: false, erro: 'Aprendizado não encontrado ou já desativado' })
    res.json({ ok: true, id: r.id })
  } catch (err) {
    logger.error('❌ aprovar aprendizado:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/prompt-aprendizados/:id/desativar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' })
    const r = await desativarAprendizado(id)
    if (!r) return res.status(404).json({ ok: false, erro: 'Aprendizado não encontrado' })
    res.json({ ok: true, id: r.id })
  } catch (err) {
    logger.error('❌ desativar aprendizado:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/prompt-aprendizados/:id/aplicar-overlay', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, erro: 'ID inválido' })

    const { rows } = await pool.query(
      `SELECT id, etapa, regras, ativo, aprovado, COALESCE(prompt_alvo, 'system') AS prompt_alvo
       FROM vendas.prompt_aprendizados WHERE id = $1`,
      [id]
    )
    if (!rows.length) return res.status(404).json({ ok: false, erro: 'Aprendizado não encontrado' })
    const aprendizado = rows[0]
    if (!aprendizado.ativo) return res.status(400).json({ ok: false, erro: 'Aprendizado já desativado' })

    const alvo = normalizarPromptAlvo(aprendizado.prompt_alvo)
    const promptAtual =
      alvo === 'followup'
        ? prompts.FOLLOWUP_PROMPT_BASE
        : alvo === 'followup_timing'
          ? prompts.FOLLOWUP_TIMING_PROMPT_BASE
          : prompts.SYSTEM_CORE_BASE
    const chaveOverlay =
      alvo === 'followup' ? 'followup' : alvo === 'followup_timing' ? 'followup_timing' : 'system-core'
    const labelTipo =
      alvo === 'followup' ? 'prompt de follow-up (mensagens pos-silencio)'
        : alvo === 'followup_timing' ? 'prompt de timing de follow-up automatico'
          : 'system prompt principal de vendas'

    if (!promptAtual || String(promptAtual).trim().length < 40) {
      return res.status(500).json({ ok: false, erro: `Prompt base (${chaveOverlay}) não carregado` })
    }

    const systemIncorporar =
      `Voce e engenheiro de prompts. Recebera o ${labelTipo} atual e um bloco de regras corretivas.\n\n` +
      `Sua tarefa: incorporar o bloco de regras no LOCAL CORRETO do prompt (pela etapa "${aprendizado.etapa || 'geral'}"), sem duplicar informacao ja existente.\n\n` +
      `REGRAS:\n` +
      `- Retorne o prompt COMPLETO com a incorporacao feita\n` +
      `- Nao remova nenhuma secao existente\n` +
      `- Se a regra ja existe de forma equivalente, nao duplique — apenas refine\n` +
      `- Mantenha a formatacao e estrutura do prompt original\n` +
      `- Responda APENAS com o texto do prompt resultante, sem explicacoes`

    const userMsg =
      `PROMPT ATUAL (${String(promptAtual).length} chars) [${chaveOverlay}]:\n\n${promptAtual}\n\n` +
      `---\n\nBLOCO DE REGRAS A INCORPORAR (etapa: ${aprendizado.etapa || 'geral'}):\n\n${aprendizado.regras}`

    const overlayTimeoutBase = Math.min(
      Math.max(parseInt(process.env.CLAUDE_OVERLAY_TIMEOUT_MS, 10) || 480000, 60000),
      CLAUDE_AUXILIAR_TIMEOUT_CAP_MS
    )
    const overlayCapTiming = Math.min(
      Math.max(parseInt(process.env.CLAUDE_OVERLAY_TIMING_TIMEOUT_MS, 10) || 180000, 45000),
      CLAUDE_AUXILIAR_TIMEOUT_CAP_MS
    )
    const overlayTimeoutMs =
      chaveOverlay === 'followup_timing' ? Math.min(overlayTimeoutBase, overlayCapTiming) : overlayTimeoutBase
    const r = await chamarClaudeAuxiliar({
      tipo: 'aplicar_overlay_aprendizado',
      system: systemIncorporar,
      userMessage: userMsg,
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.2,
      timeout_ms: overlayTimeoutMs,
      timeout_cap_ms: CLAUDE_AUXILIAR_TIMEOUT_CAP_MS,
      metadata: {
        prompt_chars: String(promptAtual).length,
        regras_chars: String(aprendizado.regras || '').length,
        chave_overlay: chaveOverlay,
      },
    })

    const minCharsOverlay = chaveOverlay === 'followup_timing' ? 20 : 200
    if (!r.ok || !r.texto || r.texto.length < minCharsOverlay) {
      const det = [r.errorCode, r.errorMsg].filter(Boolean).join(' — ')
      return res.status(500).json({
        ok: false,
        erro:
          'Claude não conseguiu gerar o overlay: ' +
          (det || 'resposta vazia') +
          '. Dica: aumente CLAUDE_OVERLAY_TIMEOUT_MS ou CLAUDE_AUXILIAR_TIMEOUT_CAP_MS no .env (ate 900000 ms).',
      })
    }

    const novoPrompt = r.texto.trim()
    const overlay = await prompts.setOverlay(pool, chaveOverlay, novoPrompt, 'auto:aprendizado-' + id)

    await pool.query(
      `UPDATE vendas.prompt_aprendizados SET aprovado = true, aplicado_como = 'overlay' WHERE id = $1`,
      [id]
    )

    res.json({
      ok: true,
      id,
      overlay_version: overlay.version,
      prompt_chars: novoPrompt.length,
      chave_overlay: chaveOverlay,
    })
  } catch (err) {
    logger.error('❌ aplicar-overlay aprendizado:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── FOLLOW-UP MANUAL (dashboard) ─────────────────────────────────────────────

/**
 * POST /dashboard/followup
 * Body: { numero: string } ou { numeros: string[] } para lote, + instrucao opcional.
 */
app.get('/dashboard/funil-diagnostico/config', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  try {
    await Promise.all(FUNIL_DIAGNOSTICO_BASE_ETAPAS.map((e) => garantirPromptAtivoFunil(e.id)))
    const [{ rows: estRows }, { rows: promptRows }] = await Promise.all([
      pool.query(`SELECT DISTINCT estagio FROM vendas.conversas WHERE COALESCE(estagio, '') <> '' ORDER BY estagio ASC LIMIT 100`),
      pool.query(`
        SELECT id, etapa, version, ativo, origem, criado_em, LEFT(prompt, 4000) AS prompt
        FROM vendas.funil_prompt_versions
        WHERE ativo = true
        ORDER BY etapa ASC
      `),
    ])
    const etapas = new Map(FUNIL_DIAGNOSTICO_BASE_ETAPAS.map((e) => [e.id, { ...e }]))
    for (const row of estRows) {
      const id = normalizarEtapaFunilDiagnostico(row.estagio)
      if (!etapas.has(id)) etapas.set(id, { id, label: labelEtapaFunilDiagnostico(id) })
    }
    const promptsAtivos = {}
    promptRows.forEach((row) => { promptsAtivos[row.etapa] = row })
    res.json({ ok: true, etapas: [...etapas.values()], prompts_ativos: promptsAtivos })
  } catch (err) {
    logger.error('GET funil-diagnostico/config:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/funil-diagnostico/analisar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  try {
    const diagnostico = await analisarFunilDiagnosticoEtapa({
      etapa: req.body?.etapa,
      fonte: req.body?.fonte,
      limit: req.body?.limit,
      conversa_colada: req.body?.conversa_colada,
    })

    let aprendizado_gerado = null
    let aprendizado_erro = null
    try {
      aprendizado_gerado = await gerarAprendizadoDeFunilDiagnostico(diagnostico)
      if (!aprendizado_gerado) {
        aprendizado_erro =
          'Analise sem texto suficiente para montar regras (resumo, problemas e padroes vazios). Tente outra etapa ou mais conversas no filtro.'
      }
    } catch (e) {
      aprendizado_erro = e.message || String(e)
      logger.warn('⚠️ falha ao gerar aprendizado do funil diagnostico:', aprendizado_erro)
    }

    res.json({ ok: true, diagnostico, aprendizado_gerado, aprendizado_erro })
  } catch (err) {
    logger.error('POST funil-diagnostico/analisar:', err.response?.data || err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/funil-diagnostico/prompts/aceitar-melhoria', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  try {
    const promptAtivo = await criarNovaVersaoPromptFunil(
      req.body?.etapa,
      req.body?.prompt_melhorado,
      'melhoria_aceita'
    )
    res.json({ ok: true, prompt_ativo: promptAtivo })
  } catch (err) {
    logger.error('POST funil-diagnostico/prompts/aceitar-melhoria:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.get('/dashboard/funil-diagnostico/historico', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Nao autorizado (x-reprocess-secret)' })
  }
  try {
    const etapa = normalizarEtapaFunilDiagnostico(req.query?.etapa)
    const [{ rows: diagnosticos }, { rows: versoes }] = await Promise.all([
      pool.query(
        `SELECT id, etapa, prompt_version_id, fonte, total_conversas,
                resultado_json, avaliacao_prompt_json, criado_em
         FROM vendas.funil_diagnosticos
         WHERE etapa = $1
         ORDER BY criado_em DESC
         LIMIT 20`,
        [etapa]
      ),
      pool.query(
        `SELECT id, etapa, version, ativo, origem, criado_em, LEFT(prompt, 4000) AS prompt
         FROM vendas.funil_prompt_versions
         WHERE etapa = $1
         ORDER BY version DESC
         LIMIT 20`,
        [etapa]
      ),
    ])
    res.json({ ok: true, etapa, diagnosticos, versoes })
  } catch (err) {
    logger.error('GET funil-diagnostico/historico:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})

app.post('/dashboard/followup', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const instrucao =
    typeof req.body.instrucao === 'string' && req.body.instrucao.trim()
      ? req.body.instrucao.trim().slice(0, FOLLOWUP_INSTRUCAO_MAX_CHARS)
      : null

  // Lote
  if (Array.isArray(req.body.numeros) && req.body.numeros.length > 0) {
    const numeros = req.body.numeros
      .map((n) => normalizarNumeroParaJid(n))
      .filter(Boolean)
      .slice(0, FOLLOWUP_LOTE_MAX_ITENS)
    if (numeros.length === 0) {
      return res.status(400).json({ ok: false, erro: 'Nenhum número válido no lote.' })
    }
    const resultados = []
    let enviados = 0
    let falhas = 0
    for (const num of numeros) {
      try {
        const info = await executarFollowupUmNumero(num, instrucao)
        resultados.push({ numero: num, ok: true, trecho: (info && info.trecho_resposta) || '' })
        enviados++
      } catch (e) {
        resultados.push({ numero: num, ok: false, erro: (e && e.message) || String(e) })
        falhas++
      }
    }
    return res.json({ ok: true, resultados, resumo: { enviados, falhas, total: numeros.length } })
  }

  // Único
  const numero = normalizarNumeroParaJid(req.body.numero)
  if (!numero) {
    return res.status(400).json({ ok: false, erro: 'Parâmetro "numero" inválido ou ausente.' })
  }
  try {
    const info = await executarFollowupUmNumero(numero, instrucao)
    res.json({ ok: true, trecho: (info && info.trecho_resposta) || '' })
  } catch (err) {
    logger.error({
      operation: 'executarFollowupUmNumero',
      numero,
      err: serializeError(err)
    }, '❌ POST followup: Error executing followup')
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// ─── REPROCESSAR (dashboard) ──────────────────────────────────────────────────

/**
 * POST /dashboard/reprocessar — reenvia a última resposta do agente para um JID.
 * Útil quando o envio ao WhatsApp falhou mas o histórico já tem a resposta.
 */
app.post('/dashboard/reprocessar', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const numero = normalizarNumeroParaJid(req.body.numero)
  if (!numero) {
    return res.status(400).json({ ok: false, erro: 'Parâmetro "numero" inválido ou ausente.' })
  }
  try {
    const conversa = await buscarConversa(numero)
    if (!conversa) {
      return res.status(404).json({ ok: false, erro: 'Conversa não encontrada.' })
    }
    const historicoBruto = normalizarHistoricoMensagens(conversa.historico)
    const estagio = conversa.estagio || 'primeiro_contato'
    const info = await gerarEEnviarRespostaWhatsapp(
      numero,
      historicoBruto,
      estagio,
      conversa,
      null
    )
    await limparFalhaResposta(numero)
    res.json({ ok: true, trecho: (info && info.trecho_resposta) || '' })
  } catch (err) {
    const errData = err.response?.data
    logger.error('❌ POST reprocessar:', err.message, errData ? JSON.stringify(errData) : '')
    res.status(500).json({ ok: false, erro: err.message })
  }
})

// NOTE: rota PATCH /dashboard/conversa-meta canônica está definida acima (~linha 3369)
// com validação de whitelist de status, limite de tamanho em estagio e retorno da conversa atualizada.
// Esta versão duplicada foi removida em 2026-04-23 (era dead code — Express registra na ordem,
// então só a primeira rota respondia).

/**
 * Lista lacunas de conhecimento (opcional: só abertas). Auth: x-reprocess-secret se REPROCESS_SECRET estiver definido.
 */
app.get('/dashboard/lacunas-conhecimento', async (req, res) => {
  if (!reprocessarAutorizado(req)) {
    return res.status(401).json({ ok: false, erro: 'Não autorizado (x-reprocess-secret)' })
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const soAbertas =
    req.query.abertas === '1' ||
    req.query.abertas === 'true' ||
    req.query.abertas === 1
  try {
    const where = soAbertas ? 'WHERE l.resolvido_em IS NULL' : ''
    const { rows } = await pool.query(
      `
      SELECT l.id, l.numero, l.tema_lacuna, l.detalhe_lacuna,
             l.criado_em, l.resolucao_nota, l.resolvido_em,
             p.negocio AS negocio_lead
      FROM vendas.conhecimento_lacunas l
      LEFT JOIN vendas.lead_profiles p ON p.numero = l.numero
      ${where}
      ORDER BY l.criado_em DESC
      LIMIT $1
      `,
      [limit]
    )
    res.json({ ok: true, lacunas: rows })
  } catch (err) {
    logger.error('❌ GET lacunas-conhecimento:', err.message)
    res.status(500).json({ ok: false, erro: err.message })
  }
})
}

async function decidirProximaAcao(contexto = {}) {
  return decidirProximaResposta(contexto)
}

module.exports = {
  registerHttpRoutes,
  calcularPreco,
  diagnosticoCompletoParaPreco,
  contarPedidosPrecoDoLead,
  parsearRespostaJsonClaude,
  normalizarParsedRespostaVendas,
  resultadoParseadoParaObjeto,
  aplicarGuardrailReuniaoProposta,
  interpretarIntencaoMensagem,
  montarEstadoComercialLead,
  decidirProximaAcao,
  decidirProximaResposta,
  aplicarAntiLoopResposta,
  extrairDadosLeadDoTexto,
  adaptarPerfilLegadoParaFunil,
  obterProximaPergunta,
  montarPerguntaFaltante,
  textoExplicacaoUltimaPergunta,
  textoComoFunciona,
  textoFaixaPrecoInicial,
  textoPrecoCalculado,
  textoNecessidadeAmpla,
  podeGerarRespostaAutomatica,
  ehProjetoSobMedida,
  sugestaoReuniaoProposta,
  parsearHorarioReuniao,
  calcularFimReuniao,
  dataInicioReuniao,
  normalizarAgendarFollowupAuto,
  normalizarReuniaoEscolha,
  textoPedePreco,
  textoEhAutoReplyWhatsApp,
  detectarAutoReplyEmContextoProspeccao,
  reprocessarAutorizado,
  webhookAutorizado,
  isConversaLeadUmAUm,
  buildWhereConversasFiltros,
  buildDiarioQuery,
  normalizarEtapaFunilDiagnostico,
  labelEtapaFunilDiagnostico,
  variantesEtapaFunilDiagnostico,
  promptSeedFunilDiagnostico,
  normalizarResultadoFunilDiagnostico,
  normalizarAvaliacaoPromptFunil,
  pontuarConversaFunilDiagnostico,
  selecionarConversasFunilDiagnostico,
  montarContextoFunilDiagnostico,
  garantirPromptAtivoFunil,
  criarNovaVersaoPromptFunil,
  montarBlocoContextoInterno,
  montarBlocoContinuidadeTurno,
  montarBlocoCorrecoesAprendizados,
  inferirPromptAlvoDeTextoRegras,
  normalizarPromptAlvo,
  montarSystemPromptDinamico,
  montarSystemPromptAcaoDeterministica,
  dadosPreviewSite,
  montarPromptWireframe,
  escolherEstiloWireframe,
  gerarWireframeComGPT,
  caseDeReferenciaPorNicho,
  gerarApresentacaoOperador,
  gerarApresentacaoOperadorFallback,
  gerarCaptionPreview,
  gerarMensagemPosPreview,
  gerarMensagemPosPreviewFallback,
  montarPreviewSiteCaption,
  montarPreviewSiteHtml,
  montarPreviewSiteSvg,
  sequenciasComerciaisFollowupPorEstagio,
  maxSequenciaFollowupAutoPorEstagio,
  isSequenciaEncerramentoFollowup,
  ajustarParaJanelaComercialFollowup,
  registrarChamadaAnthropic,
  parseLlmPricingEnv,
  estimativaCustoLlm,
  normalizarEntradaOperador,
  operadoresDoEnv,
  dedupeOperadores,
  listarOperadoresAtivos,
  textoAjudaOperadorProgramada,
  iniciarJobWorker,
  iniciarSilenceWatcher,
  runSmokePrecificacao,
  formatarMensagemParaContexto,
  gerarTextoConversaCompleta,
}
