'use strict'

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const SESSION_KEY = 'pj_test_session'
const MAX_HISTORY_API = 20 // limite de msgs enviadas à IA para controlar tokens

// ─── CENÁRIOS RÁPIDOS ────────────────────────────────────────────────────────

const CENARIOS_RAPIDOS = {
  novo: {
    mensagem: 'Olá',
    context: { stage: 'primeiro_contato' },
    historico: ''
  },
  site: {
    mensagem: 'Quero criar um site para minha empresa',
    context: { stage: 'coleta_basica', need: 'site' },
    historico: ''
  },
  preco: {
    mensagem: 'Quanto custa?',
    context: { stage: 'coleta_basica' },
    historico: ''
  },
  sistema: {
    mensagem: 'Quero um sistema com automação e IA',
    context: { stage: 'diagnostico', need: 'sistema', customProject: true },
    historico: ''
  },
  'nao-entendi': {
    mensagem: 'Não entendi?',
    context: { stage: 'coleta_basica' },
    historico: 'Lead: Você prefere um site corporativo ou um e-commerce?\nIA: Tudo depende do seu objetivo...'
  },
  horario: {
    mensagem: '19:45',
    context: { stage: 'fechamento' },
    historico: 'IA: Qual horário você prefere? Temos disponível 19:30 ou 19:45.\nLead: 19:45'
  },
  'dados-parciais': {
    mensagem: 'Sou de São Bernardo e procuro um site',
    context: { stage: 'coleta_basica', city: 'São Bernardo do Campo', need: 'site' },
    historico: ''
  },
  'dados-completos': {
    mensagem: 'Trabalho com tráfego pago, sou de São Bernardo e quero um site',
    context: { stage: 'coleta_basica', businessType: 'Tráfego pago', city: 'São Bernardo do Campo', need: 'site' },
    historico: ''
  },
  reagendamento: {
    mensagem: 'Não consigo hoje, pode ser amanhã?',
    context: { stage: 'fechamento', temperature: 'quente' },
    historico: 'IA: Qual horário você prefere para a reunião?\nLead: Não consigo hoje'
  },
  humano: {
    mensagem: 'Quero falar com uma pessoa',
    context: { stage: 'diagnostico', temperature: 'morno' },
    historico: ''
  }
}

// ─── GUARDRAILS ──────────────────────────────────────────────────────────────

function validarGuardrails(resposta, context) {
  const avisos = []
  const lower = resposta.toLowerCase()

  if (lower.includes('victor')) {
    avisos.push({ tipo: 'error', msg: '❌ Resposta menciona "Victor" — use "equipe da PJ Codeworks"' })
  }

  const termosInternos = ['funil', 'lead quente', 'aprofundar dor', 'objeção']
  for (const termo of termosInternos) {
    if (lower.includes(termo)) {
      avisos.push({ tipo: 'error', msg: `❌ Resposta contém termo interno "${termo}"` })
    }
  }

  if (lower.includes('google') && (lower.includes('primeira página') || lower.includes('ranking'))) {
    avisos.push({ tipo: 'error', msg: '❌ Resposta promete posição no Google — não faça isso' })
  }

  if (context.customProject && (lower.includes('r$') || /\d+,\d{2}/.test(resposta))) {
    avisos.push({ tipo: 'error', msg: '❌ Resposta contém preço em projeto sob medida — não fazer isso' })
  }

  if (lower.match(/\d{1,2}:\d{2}/) && !context.offeredSlots?.length) {
    avisos.push({ tipo: 'warning', msg: '⚠️ Resposta oferece horário sem validar agenda' })
  }

  if (lower.includes('qual é seu') && lower.match(/qual é seu.*\?/g)?.length >= 2) {
    avisos.push({ tipo: 'warning', msg: '⚠️ Resposta repete perguntas — dados podem já ter sido coletados' })
  }

  return avisos
}

// ─── SESSÃO ───────────────────────────────────────────────────────────────────

function gerarSessionId() {
  return 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

function lerContextoForm() {
  return {
    origin: 'whatsapp_direto',
    stage: document.getElementById('teste-ia-estagio')?.value || 'primeiro_contato',
    leadName: document.getElementById('teste-ia-nome')?.value.trim() || '',
    phone: document.getElementById('teste-ia-telefone')?.value.trim() || '',
    businessType: document.getElementById('teste-ia-negocio')?.value.trim() || '',
    city: document.getElementById('teste-ia-cidade')?.value.trim() || '',
    need: document.getElementById('teste-ia-necessidade')?.value.trim() || '',
    temperature: document.getElementById('teste-ia-temperatura')?.value || 'morno',
    customProject: document.getElementById('teste-ia-projeto-medida')?.value === 'true',
    offeredSlots: [],
  }
}

function aplicarContextoNoForm(ctx) {
  if (!ctx) return
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val }
  set('teste-ia-estagio', ctx.stage)
  set('teste-ia-nome', ctx.leadName)
  set('teste-ia-telefone', ctx.phone)
  set('teste-ia-negocio', ctx.businessType)
  set('teste-ia-cidade', ctx.city)
  set('teste-ia-necessidade', ctx.need)
  set('teste-ia-temperatura', ctx.temperature)
  if (ctx.customProject !== undefined) set('teste-ia-projeto-medida', String(ctx.customProject))
}

function criarSessaoNova(ctxOverride) {
  const ctx = { ...lerContextoForm(), ...(ctxOverride || {}) }
  return {
    testSessionId: gerarSessionId(),
    createdAt: new Date().toISOString(),
    messages: [],
    context: ctx,
    sandbox: true,
  }
}

function salvarSessao(sessao) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessao)) } catch (_) {}
}

function carregarSessao() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_) { return null }
}

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────

let sessaoAtiva = null
let enviandoMensagem = false
let ultimoDiagnosticos = null

// ─── ESCAPE HTML ──────────────────────────────────────────────────────────────

function esc(s) {
  const Core = window.DashboardCore || {}
  if (Core.escHtml) return Core.escHtml(String(s))
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escBr(s) {
  return esc(s).replace(/\n/g, '<br>')
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderSessaoHeader() {
  const el = document.getElementById('teste-ia-session-id')
  if (el && sessaoAtiva) el.textContent = sessaoAtiva.testSessionId
}

function renderMensagens() {
  const container = document.getElementById('teste-ia-chat-mensagens')
  if (!container || !sessaoAtiva) return

  if (sessaoAtiva.messages.length === 0) {
    container.innerHTML = '<div class="teste-ia-chat-vazio">Nenhuma mensagem ainda.<br>Digite abaixo para iniciar a conversa.</div>'
    return
  }

  container.innerHTML = sessaoAtiva.messages.map((msg, i) => {
    const isBot = msg.role === 'assistant'
    const isErr = msg.status === 'error'
    const cls = isErr ? 'teste-ia-msg--erro' : (isBot ? 'teste-ia-msg--bot' : 'teste-ia-msg--lead')
    const roleLabel = isBot ? 'Bot' : (isErr ? 'Erro' : 'Lead')
    const time = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : ''
    return (
      `<div class="teste-ia-msg ${cls}" data-msg-index="${i}">` +
        `<div class="teste-ia-msg-meta">` +
          `<span class="teste-ia-msg-role">${esc(roleLabel)}</span>` +
          `<span class="teste-ia-msg-time">${esc(time)}</span>` +
        `</div>` +
        `<div class="teste-ia-msg-conteudo">${escBr(msg.content || '')}</div>` +
      `</div>`
    )
  }).join('')

  container.scrollTop = container.scrollHeight
}

function renderDigitando(show) {
  const el = document.getElementById('teste-ia-digitando')
  if (el) el.style.display = show ? 'flex' : 'none'
}

function renderDiagnostico(result, diagnostics) {
  const diag = document.getElementById('teste-ia-ultimo-diagnostico')
  if (!diag || !result) return

  const sandboxOk = result.sandbox?.enabled === true
  const sandboxLabel = sandboxOk
    ? '<span style="color:var(--sucesso,#1a9e5c);font-weight:600">✓ ativo</span>'
    : '<span style="color:var(--perigo,#d63031);font-weight:600">✗ inativo</span>'

  const stageStr = result.stageBefore !== result.stageAfter
    ? `${esc(result.stageBefore || '—')} → <strong>${esc(result.stageAfter || '—')}</strong>`
    : esc(result.stageAfter || '—')

  // Motor: prefer diagnostics block (more accurate), fall back to result.ai
  const provider = diagnostics?.provider || result.ai?.provider || '—'
  const model = diagnostics?.model || result.ai?.model || '—'
  const latency = diagnostics?.latencyMs ?? result.ai?.latencyMs ?? '?'
  const histCount = diagnostics?.historyCount != null
    ? ` · histórico: ${diagnostics.historyCount}${diagnostics.historyTruncated ? ' (truncado)' : ''}`
    : ''
  const rawType = diagnostics?.rawResponseType ? ` · ${diagnostics.rawResponseType}` : ''

  diag.innerHTML = `
    <div class="teste-ia-diagnostico-row">
      <span class="teste-ia-diagnostico-label">Intenção:</span>
      <span class="teste-ia-diagnostico-valor">${esc(result.intent || '—')}</span>
    </div>
    <div class="teste-ia-diagnostico-row">
      <span class="teste-ia-diagnostico-label">Próxima ação:</span>
      <span class="teste-ia-diagnostico-valor">${esc(result.nextAction || '—')}</span>
    </div>
    <div class="teste-ia-diagnostico-row">
      <span class="teste-ia-diagnostico-label">Estágio:</span>
      <span class="teste-ia-diagnostico-valor">${stageStr}</span>
    </div>
    <div class="teste-ia-diagnostico-row">
      <span class="teste-ia-diagnostico-label">Motor:</span>
      <span class="teste-ia-diagnostico-valor">${esc(provider)} / ${esc(model)} (${latency}ms${rawType}${histCount})</span>
    </div>
    <div class="teste-ia-diagnostico-row">
      <span class="teste-ia-diagnostico-label">Sandbox:</span>
      <span class="teste-ia-diagnostico-valor">${sandboxLabel}</span>
    </div>
  `

  // Guardrails: prefer backend diagnostics, fallback to local validation
  const avisosCont = document.getElementById('teste-ia-ultimo-avisos')
  if (!avisosCont) return

  const gr = diagnostics?.guardrails
  if (gr) {
    renderGuardrailsBadges(avisosCont, gr)
  } else if (result.reply) {
    const avisos = validarGuardrails(result.reply, sessaoAtiva?.context || {})
    if (avisos.length > 0) {
      avisosCont.innerHTML = avisos.map(a => `<div class="teste-ia-aviso ${a.tipo}">${esc(a.msg)}</div>`).join('')
      avisosCont.style.display = 'block'
    } else {
      avisosCont.innerHTML = ''
      avisosCont.style.display = 'none'
    }
  }
}

function renderGuardrailsBadges(container, gr) {
  if (!gr) { container.innerHTML = ''; container.style.display = 'none'; return }

  const checksHtml = Object.entries(gr.checks || {}).map(([, c]) => {
    const cls = c.ok === true ? 'gr-check--ok' : c.ok === false ? 'gr-check--err' : 'gr-check--na'
    const icon = c.ok === true ? '✓' : c.ok === false ? '✗' : '–'
    return `<span class="gr-check ${cls}">${icon} ${esc(c.label || '')}</span>`
  }).join('')

  const scoreClass = gr.valid ? 'ok' : 'fail'
  const scoreHtml = `<div class="gr-score ${scoreClass}">${gr.score}/${gr.total} verificações passaram</div>`

  const issues = [...(gr.errors || []).map(e => ({ cls: 'gr-issue--err', text: e })),
                  ...(gr.warnings || []).map(w => ({ cls: 'gr-issue--warn', text: w }))]
  const issuesHtml = issues.length
    ? `<div class="gr-issues">${issues.map(i => `<div class="${i.cls}">${esc(i.text)}</div>`).join('')}</div>`
    : ''

  container.innerHTML = scoreHtml + `<div class="gr-checks-grid">${checksHtml}</div>` + issuesHtml
  container.style.display = 'block'
}

function renderDiagnosticoVazio() {
  const diag = document.getElementById('teste-ia-ultimo-diagnostico')
  if (diag) diag.innerHTML = ''
  const avisos = document.getElementById('teste-ia-ultimo-avisos')
  if (avisos) { avisos.innerHTML = ''; avisos.style.display = 'none' }
}

// ─── DEBUG DA IA ──────────────────────────────────────────────────────────────

function renderDebugPanel(diagnostics) {
  ultimoDiagnosticos = diagnostics || null
  if (!diagnostics) { limparDebugPanel(); return }

  const p = diagnostics.prompt || {}
  const inp = diagnostics.aiInput || {}
  const out = diagnostics.aiOutput || {}

  // Prompt
  _dbgSet('dbg-prompt-meta', p.systemPromptLength ? `${p.systemPromptLength} chars` : '')
  _dbgText('dbg-prompt-preview', p.systemPromptPreview || '(sem prompt)')
  _dbgText('dbg-prompt-full',    p.systemPromptFull    || '(sem prompt)')

  // Contexto
  _dbgText('dbg-context-json', JSON.stringify(inp.contextUsed || {}, null, 2))

  // Histórico
  const histCount = inp.historyCount ?? 0
  const histTrunc = inp.historyTruncated ? ' (truncado ao limite)' : ''
  _dbgSet('dbg-history-meta', `${histCount} mensagens${histTrunc}`)
  _dbgText('dbg-history-json', JSON.stringify(inp.historyUsed || [], null, 2))

  // Resposta bruta / parseada
  _dbgSet('dbg-output-meta', out.rawResponseType || '')
  _dbgText('dbg-output-preview', out.rawResponsePreview || '(vazio)')
  const fullOut = {
    rawResponseFull: out.rawResponseFull || null,
    parsedResponse: out.parsedResponse || null,
    parseError: out.parseError || null,
  }
  _dbgText('dbg-output-full', JSON.stringify(fullOut, null, 2))

  // Diagnóstico completo (sem os campos grandes que já aparecem acima)
  const slim = Object.assign({}, diagnostics, {
    prompt:   p.systemPromptLength != null ? { systemPromptLength: p.systemPromptLength, promptVisible: p.promptVisible } : undefined,
    aiInput:  { historyCount: inp.historyCount, historyTruncated: inp.historyTruncated, leadMessage: inp.leadMessage, contextUsed: inp.contextUsed },
    aiOutput: { rawResponseType: out.rawResponseType, parseError: out.parseError || null },
  })
  _dbgText('dbg-full-json', JSON.stringify(slim, null, 2))
}

function limparDebugPanel() {
  ultimoDiagnosticos = null
  for (const id of [
    'dbg-prompt-meta', 'dbg-prompt-preview', 'dbg-prompt-full',
    'dbg-context-json', 'dbg-history-meta', 'dbg-history-json',
    'dbg-output-meta', 'dbg-output-preview', 'dbg-output-full', 'dbg-full-json',
  ]) {
    const el = document.getElementById(id)
    if (el) el.textContent = ''
  }
}

function _dbgText(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

function _dbgSet(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

// ─── COPY HELPERS ─────────────────────────────────────────────────────────────

function _btnFeedback(id, msg, delayMs) {
  const btn = document.getElementById(id)
  if (!btn) return
  const prev = btn.textContent
  btn.textContent = msg
  setTimeout(() => { btn.textContent = prev }, delayMs || 2000)
}

function copiarPrompt() {
  const texto = ultimoDiagnosticos?.prompt?.systemPromptFull
  if (!texto) { alert('Prompt não disponível — envie uma mensagem primeiro.'); return }
  navigator.clipboard.writeText(texto)
    .then(() => _btnFeedback('btn-copiar-prompt', 'Copiado!'))
    .catch(() => alert('Falha ao copiar. Veja o prompt no painel Debug da IA.'))
}

function copiarDiagnosticos() {
  if (!ultimoDiagnosticos) { alert('Diagnóstico não disponível — envie uma mensagem primeiro.'); return }
  const texto = JSON.stringify(ultimoDiagnosticos, null, 2)
  navigator.clipboard.writeText(texto)
    .then(() => _btnFeedback('btn-copiar-diagnostics', 'Copiado!'))
    .catch(() => alert('Falha ao copiar.'))
}

// ─── CONTROLE DO BOTÃO DE ENVIO ───────────────────────────────────────────────

function setBtnEnviarBusy(busy) {
  const btn = document.getElementById('btn-enviar-msg')
  const input = document.getElementById('teste-ia-input-msg')
  if (btn) { btn.disabled = busy; btn.textContent = busy ? '...' : 'Enviar' }
  if (input) input.disabled = busy
}

// ─── ENVIO DE MENSAGEM ────────────────────────────────────────────────────────

async function enviarMensagem() {
  if (enviandoMensagem) return

  const inputEl = document.getElementById('teste-ia-input-msg')
  if (!inputEl) return
  const texto = inputEl.value.trim()
  if (!texto) return

  if (!sessaoAtiva) {
    sessaoAtiva = criarSessaoNova()
    renderSessaoHeader()
  }

  // Adicionar mensagem do lead à sessão
  sessaoAtiva.messages.push({
    role: 'user',
    content: texto,
    timestamp: new Date().toISOString(),
    source: 'simulator',
    status: 'sent',
  })

  inputEl.value = ''
  enviandoMensagem = true
  setBtnEnviarBusy(true)
  renderMensagens()
  renderDigitando(true)

  // Atualizar contexto com valores atuais do form antes de enviar
  sessaoAtiva.context = { ...sessaoAtiva.context, ...lerContextoForm() }
  salvarSessao(sessaoAtiva)

  // Montar histórico para API: excluir a msg atual (já vai em leadMessage) + limitar
  const historyParaApi = sessaoAtiva.messages
    .slice(0, -1)
    .slice(-MAX_HISTORY_API)
    .map(m => ({ role: m.role, content: m.content }))

  // Histórico inicial do textarea de debug (se preenchido)
  const taHistorico = document.getElementById('teste-ia-historico')
  const extraHistorico = taHistorico ? parsearHistoricoTexto(taHistorico.value.trim()) : []
  const historyFinal = [...extraHistorico, ...historyParaApi]

  try {
    const ctx = sessaoAtiva.context
    const response = await fetch('/dashboard/teste-ia', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify({
        testSessionId: sessaoAtiva.testSessionId,
        leadMessage: texto,
        history: historyFinal,
        context: {
          origin: ctx.origin || 'whatsapp_direto',
          leadName: ctx.leadName || null,
          phone: ctx.phone || null,
          businessType: ctx.businessType || null,
          city: ctx.city || null,
          need: ctx.need || null,
          stage: ctx.stage || 'primeiro_contato',
          temperature: ctx.temperature || 'morno',
          customProject: ctx.customProject || false,
          offeredSlots: ctx.offeredSlots || [],
        },
        options: {
          dryRun: true,
          doNotSendWhatsapp: true,
          doNotPersistRealConversation: true,
          doNotCreateFollowup: true,
          doNotCreateRealBooking: true,
        },
      }),
    })

    renderDigitando(false)

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: `Erro HTTP ${response.status}` }))
      adicionarMsgErro(errData.error || `Erro HTTP ${response.status}`)
      return
    }

    const data = await response.json()
    if (!data.ok) {
      adicionarMsgErro(data.error || 'Erro ao testar IA')
      return
    }

    const result = data.result

    // Comprimir diagnostics antes de salvar no localStorage (omitir campos grandes)
    const fullDiag = data.diagnostics || null
    const diagParaStorage = fullDiag ? {
      ...fullDiag,
      prompt:   fullDiag.prompt   ? { systemPromptLength: fullDiag.prompt.systemPromptLength, systemPromptPreview: fullDiag.prompt.systemPromptPreview, promptVisible: true } : null,
      aiInput:  fullDiag.aiInput  ? { historyCount: fullDiag.aiInput.historyCount, historyTruncated: fullDiag.aiInput.historyTruncated, leadMessage: fullDiag.aiInput.leadMessage, contextUsed: fullDiag.aiInput.contextUsed } : null,
      aiOutput: fullDiag.aiOutput ? { rawResponseType: fullDiag.aiOutput.rawResponseType, rawResponsePreview: fullDiag.aiOutput.rawResponsePreview, parsedResponse: fullDiag.aiOutput.parsedResponse, parseError: fullDiag.aiOutput.parseError } : null,
    } : null

    // Adicionar somente bolhas publicas. O JSON bruto fica restrito ao painel de debug.
    const publicMessages = Array.isArray(result.publicMessages) && result.publicMessages.length
      ? result.publicMessages
      : [result.reply || '[sem resposta]']
    publicMessages.forEach((content, bubbleIndex) => {
      sessaoAtiva.messages.push({
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        source: 'simulator',
        status: 'received',
        meta: {
          intent: result.intent,
          nextAction: result.nextAction,
          stageAfter: result.stageAfter,
          latencyMs: result.ai?.latencyMs,
          sandbox: result.sandbox,
          diagnostics: diagParaStorage,
          bubbleIndex,
        },
      })
    })

    // Atualizar contexto com dados extraídos pela IA
    if (result.stageAfter) sessaoAtiva.context.stage = result.stageAfter
    if (result.extractedData?.businessType) sessaoAtiva.context.businessType = result.extractedData.businessType
    if (result.extractedData?.city) sessaoAtiva.context.city = result.extractedData.city
    if (result.extractedData?.need) sessaoAtiva.context.need = result.extractedData.need
    if (result.extractedData?.selectedTime) sessaoAtiva.context.selectedTime = result.extractedData.selectedTime

    salvarSessao(sessaoAtiva)
    aplicarContextoNoForm(sessaoAtiva.context)
    renderMensagens()
    renderDiagnostico(result, fullDiag)
    renderDebugPanel(fullDiag)

  } catch (err) {
    renderDigitando(false)
    adicionarMsgErro(err.message || 'Falha de rede')
  } finally {
    enviandoMensagem = false
    setBtnEnviarBusy(false)
  }
}

function adicionarMsgErro(msg) {
  if (!sessaoAtiva) return
  sessaoAtiva.messages.push({
    role: 'system',
    content: `Erro: ${msg}`,
    timestamp: new Date().toISOString(),
    source: 'simulator',
    status: 'error',
  })
  salvarSessao(sessaoAtiva)
  renderMensagens()
}

// ─── CONTROLES DE SESSÃO ──────────────────────────────────────────────────────

function novaSessao() {
  if (sessaoAtiva && sessaoAtiva.messages.length > 0) {
    if (!confirm('Criar nova sessão? A conversa atual será descartada.')) return
  }
  sessaoAtiva = criarSessaoNova()
  salvarSessao(sessaoAtiva)
  renderSessaoHeader()
  renderMensagens()
  renderDiagnosticoVazio()
  limparDebugPanel()
  const el = document.getElementById('teste-ia-estagio')
  if (el) el.value = 'primeiro_contato'
  const temp = document.getElementById('teste-ia-temperatura')
  if (temp) temp.value = 'morno'
}

function resetarConversa() {
  if (!sessaoAtiva) return
  if (!confirm('Limpar toda a conversa? O contexto do lead será mantido.')) return
  sessaoAtiva.messages = []
  salvarSessao(sessaoAtiva)
  renderMensagens()
  renderDiagnosticoVazio()
  limparDebugPanel()
}

function exportarConversa() {
  if (!sessaoAtiva || sessaoAtiva.messages.length === 0) {
    alert('Nenhuma mensagem para exportar.')
    return
  }
  const linhas = sessaoAtiva.messages.map(m => {
    const time = m.timestamp
      ? new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : ''
    const role = m.role === 'assistant' ? 'Bot' : (m.role === 'system' ? 'Sistema' : 'Lead')
    return `[${time}] ${role}: ${m.content}`
  }).join('\n')

  const texto = [
    `Sessão: ${sessaoAtiva.testSessionId}`,
    `Data: ${new Date(sessaoAtiva.createdAt).toLocaleString('pt-BR')}`,
    `Estágio final: ${sessaoAtiva.context.stage || '—'}`,
    '',
    linhas,
  ].join('\n')

  navigator.clipboard.writeText(texto).then(() => {
    const btn = document.getElementById('btn-exportar-conversa')
    if (btn) {
      const prev = btn.textContent
      btn.textContent = '✓ Copiado!'
      setTimeout(() => { btn.textContent = prev }, 2000)
    }
  }).catch(() => { alert('Copie manualmente:\n\n' + texto) })
}

// ─── HISTÓRICO MANUAL (textarea debug) ───────────────────────────────────────

function parsearHistoricoTexto(texto) {
  if (!texto) return []
  const history = []
  const lines = texto.split('\n')
  let role = 'user'
  let content = ''

  for (const line of lines) {
    if (line.startsWith('Lead:')) {
      if (content) history.push({ role, content: content.trim() })
      role = 'user'
      content = line.replace(/^Lead:\s*/, '')
    } else if (line.startsWith('IA:')) {
      if (content) history.push({ role, content: content.trim() })
      role = 'assistant'
      content = line.replace(/^IA:\s*/, '')
    } else if (content) {
      content += '\n' + line
    }
  }
  if (content) history.push({ role, content: content.trim() })
  return history
}

// ─── CENÁRIOS ─────────────────────────────────────────────────────────────────

function carregarCenario(cenarioKey) {
  const cenario = CENARIOS_RAPIDOS[cenarioKey]
  if (!cenario) return

  // Aplicar contexto do cenário no form
  const ctx = cenario.context || {}
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = String(val) }
  set('teste-ia-estagio', ctx.stage)
  set('teste-ia-necessidade', ctx.need)
  set('teste-ia-negocio', ctx.businessType)
  set('teste-ia-cidade', ctx.city)
  set('teste-ia-temperatura', ctx.temperature)
  if (ctx.customProject !== undefined) set('teste-ia-projeto-medida', String(ctx.customProject))

  // Preencher o histórico de contexto (debug)
  const histEl = document.getElementById('teste-ia-historico')
  if (histEl) histEl.value = cenario.historico || ''

  // Preencher o input com a mensagem do cenário e focar
  const inputEl = document.getElementById('teste-ia-input-msg')
  if (inputEl) {
    inputEl.value = cenario.mensagem
    inputEl.focus()
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getCsrfToken() {
  return sessionStorage.getItem('pj_dashboard_csrf') || ''
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

function init() {
  const tabTesteIa = document.querySelector('[data-tab="teste-ia"]')
  if (!tabTesteIa) return

  // Carregar sessão do localStorage ou criar nova
  sessaoAtiva = carregarSessao()
  if (!sessaoAtiva) {
    sessaoAtiva = criarSessaoNova()
    salvarSessao(sessaoAtiva)
  }

  renderSessaoHeader()
  renderMensagens()
  aplicarContextoNoForm(sessaoAtiva.context)

  // Restaurar diagnóstico da última mensagem do bot, se existir
  const ultimoBot = [...sessaoAtiva.messages].reverse().find(m => m.role === 'assistant' && m.meta)
  if (ultimoBot?.meta) {
    renderDiagnostico({
      intent: ultimoBot.meta.intent,
      nextAction: ultimoBot.meta.nextAction,
      stageBefore: sessaoAtiva.context.stage,
      stageAfter: ultimoBot.meta.stageAfter,
      ai: { latencyMs: ultimoBot.meta.latencyMs },
      sandbox: ultimoBot.meta.sandbox || { enabled: true },
      reply: ultimoBot.content,
    }, ultimoBot.meta.diagnostics || null)
    renderDebugPanel(ultimoBot.meta.diagnostics || null)
  }

  // Botão enviar
  document.getElementById('btn-enviar-msg')?.addEventListener('click', enviarMensagem)

  // Enter envia, Shift+Enter quebra linha
  document.getElementById('teste-ia-input-msg')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviarMensagem()
    }
  })

  // Controles de sessão
  document.getElementById('btn-nova-sessao')?.addEventListener('click', novaSessao)
  document.getElementById('btn-resetar-conversa')?.addEventListener('click', resetarConversa)
  document.getElementById('btn-exportar-conversa')?.addEventListener('click', exportarConversa)

  // Copy buttons (debug panel)
  document.getElementById('btn-copiar-prompt')?.addEventListener('click', copiarPrompt)
  document.getElementById('btn-copiar-diagnostics')?.addEventListener('click', copiarDiagnosticos)

  // Cenários
  document.querySelectorAll('.btn-cenario').forEach(btn => {
    btn.addEventListener('click', (e) => carregarCenario(e.currentTarget.dataset.cenario))
  })
}

document.addEventListener('DOMContentLoaded', init)
