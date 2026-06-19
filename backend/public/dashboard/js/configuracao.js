/**
 * Página Configuração: chave, direcionamento padrão, intervalo da lista, follow-up por número.
 */
;(function () {
  const Core = window.DashboardCore || {}
  /** @type {BroadcastChannel | null} */
  let bcCfg = null

  function notifyConversasRefresh() {
    try {
      if (typeof BroadcastChannel === 'undefined') return
      if (!bcCfg) bcCfg = new BroadcastChannel('pj-dashboard')
      bcCfg.postMessage({ type: 'conversas-refresh' })
    } catch (_) {}
  }

  function headersComReprocessSecret() {
    return Core.headersComReprocessSecret
      ?Core.headersComReprocessSecret(true)
      : { 'Content-Type': 'application/json' }
  }

  /** Instrução padrão da sessão + extra (ex.: { numero } ou { numeros }). */
  function followupPayloadExtra(extra) {
    const o = typeof extra === 'object' && extra !== null ?{ ...extra } : {}
    const ins = Core.getFollowupInstrucaoPadrao ?Core.getFollowupInstrucaoPadrao() : ''
    if (ins) o.instrucao = ins
    return o
  }

  function setBusy(busy) {
    const btn = document.getElementById('btn-followup-numero')
    const input = document.getElementById('followup-numero-input')
    if (btn) btn.disabled = !!busy
    if (input) input.disabled = !!busy
  }

  function operadorVazio() {
    return { nome: '', numero: '', ativo: true, recebe_alertas: true }
  }

  function normalizarOperadoresDom() {
    const rows = Array.from(document.querySelectorAll('.config-operador-row'))
    return rows.map((row) => ({
      nome: row.querySelector('[data-op-campo="nome"]')?.value.trim() || '',
      numero: row.querySelector('[data-op-campo="numero"]')?.value.trim() || '',
      ativo: !!row.querySelector('[data-op-campo="ativo"]')?.checked,
      recebe_alertas: !!row.querySelector('[data-op-campo="recebe_alertas"]')?.checked,
    }))
  }

  function numeroOperadorValido(numero) {
    const digits = String(numero || '').replace(/\D/g, '')
    return digits.length >= 10 && digits.length <= 14
  }

  function renderOperadores(operadores) {
    const root = document.getElementById('config-operadores-lista')
    if (!root) return
    const lista = Array.isArray(operadores) && operadores.length ?operadores : [operadorVazio()]
    root.innerHTML = lista.map((op, idx) => {
      const nome = Core.escAttr ?Core.escAttr(op.nome || '') : op.nome || ''
      const numero = Core.escAttr ?Core.escAttr(op.numero || '') : op.numero || ''
      return (
        '<div class="config-operador-row">' +
        '<div class="config-operador-fields">' +
        `<label>Nome<input type="text" data-op-campo="nome" value="${nome}" placeholder="Victor" /></label>` +
        `<label>WhatsApp<input type="text" data-op-campo="numero" value="${numero}" placeholder="5511999999999" autocomplete="tel" /></label>` +
        '</div>' +
        '<div class="config-operador-checks">' +
        `<label><input type="checkbox" data-op-campo="ativo"${op.ativo === false ?'' : ' checked'} /> Ativo</label>` +
        `<label><input type="checkbox" data-op-campo="recebe_alertas"${op.recebe_alertas === false ?'' : ' checked'} /> Recebe alertas</label>` +
        `<button type="button" class="btn-danger config-operador-remover" data-op-index="${idx}">Remover</button>` +
        '</div>' +
        '</div>'
      )
    }).join('')
    root.querySelectorAll('.config-operador-remover').forEach((btn) => {
      btn.addEventListener('click', () => {
        const atual = normalizarOperadoresDom()
        atual.splice(parseInt(btn.dataset.opIndex, 10), 1)
        renderOperadores(atual.length ?atual : [operadorVazio()])
      })
    })
  }

  function setOperadoresStatus(texto, erro) {
    const el = document.getElementById('config-operadores-status')
    if (!el) return
    el.textContent = texto || ''
    el.classList.toggle('config-status-erro', !!erro)
  }

  async function carregarOperadores() {
    const r = await fetch('/dashboard/operadores', {
      headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || r.statusText)
    renderOperadores(j.operadores || [])
    setOperadoresStatus('Operadores carregados.')
  }

  async function salvarOperadores() {
    const operadores = normalizarOperadoresDom()
    if (operadores.length === 0 || operadores.some((op) => !numeroOperadorValido(op.numero))) {
      throw new Error('Revise os WhatsApps. Use DDI + DDD + número, ex.: 5511999999999.')
    }
    const r = await fetch('/dashboard/operadores', {
      method: 'PUT',
      headers: headersComReprocessSecret(),
      body: JSON.stringify({ operadores }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || r.statusText)
    renderOperadores(j.operadores || operadores)
    setOperadoresStatus('Operadores salvos.')
  }

  function syncInstrucaoFromStorage() {
    const ta = document.getElementById('config-followup-instrucao-textarea')
    if (!ta || !Core.getFollowupInstrucaoPadrao) return
    ta.value = Core.getFollowupInstrucaoPadrao()
  }

  function syncRefreshRadios() {
    const pref = Core.getConversasRefreshPref ?Core.getConversasRefreshPref() : 10000
    const val = pref === 'manual' ?'manual' : String(pref)
    document.querySelectorAll('input[name="conversas-refresh"]').forEach((el) => {
      el.checked = el.value === val
    })
  }

  const TAB_STORAGE_KEY = 'pj-config-tab'
  const VALID_TABS = ['geral', 'whatsapp', 'prompts', 'ia', 'teste-ia']

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll('.config-tab-btn[data-tab]'))
    const sections = Array.from(document.querySelectorAll('.config-section[data-tab]'))
    if (!tabs.length || !sections.length) return
    function apply(tabId) {
      const valid = tabs.some((t) => t.dataset.tab === tabId) ?tabId : 'geral'
      tabs.forEach((btn) => {
        const on = btn.dataset.tab === valid
        btn.classList.toggle('is-active', on)
        btn.setAttribute('aria-selected', on ?'true' : 'false')
      })
      sections.forEach((sec) => {
        sec.classList.toggle('is-hidden', sec.dataset.tab !== valid)
      })
      try {
        localStorage.setItem(TAB_STORAGE_KEY, valid)
      } catch (_) {}
    }
    let initial = 'geral'
    try {
      const s = localStorage.getItem(TAB_STORAGE_KEY)
      if (s && VALID_TABS.includes(s)) initial = s
    } catch (_) {}
    apply(initial)
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => apply(btn.dataset.tab))
    })
  }

  function formatarDataPrompt(d) {
    if (!d) return '—'
    try {
      const x = new Date(d)
      if (Number.isNaN(x.getTime())) return String(d)
      return x.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    } catch (_) {
      return String(d)
    }
  }

  function setupPrompts() {
    const sel = document.getElementById('config-prompt-select')
    const ta = document.getElementById('config-prompt-textarea')
    const meta = document.getElementById('config-prompt-meta')
    const histRoot = document.getElementById('config-prompt-historico-lista')
    const statusEl = document.getElementById('config-prompt-status')
    const autorInp = document.getElementById('config-prompt-autor')
    const btnSalvar = document.getElementById('btn-prompt-salvar')
    if (!sel || !ta || !meta || !histRoot) return

    const h = (s) => (Core.escHtml ?Core.escHtml(String(s)) : String(s))

    function setPromptStatus(msg, erro) {
      if (!statusEl) return
      statusEl.textContent = msg || ''
      statusEl.classList.toggle('config-status-erro', !!erro)
    }

    async function carregarDetalhe() {
      const chave = sel.value
      setPromptStatus('Carregando…', false)
      ta.disabled = true
      try {
        const r = await fetch(`/dashboard/prompts/${encodeURIComponent(chave)}`, {
          headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        const atual = j.atual || {}
        ta.value = atual.conteudo || ''
        const orig = atual.origem === 'banco' ?'Banco de dados' : 'Arquivo no servidor'
        const ver = atual.version != null ?`v${atual.version}` : '—'
        const aut = atual.autor ?h(atual.autor) : '—'
        const quando = h(formatarDataPrompt(atual.criado_em))
        meta.innerHTML =
          `<strong>Em uso:</strong> ${h(orig)} · <strong>Versão:</strong> ${h(ver)} · ` +
          `<strong>Autor (ativo):</strong> ${aut} · <strong>Salvo em:</strong> ${quando}`
        renderHistorico(j.historico || [])
        setPromptStatus('', false)
      } catch (e) {
        setPromptStatus(e.message || 'Falha ao carregar prompt.', true)
        histRoot.innerHTML = ''
      } finally {
        ta.disabled = false
      }
    }

    function renderHistorico(rows) {
      if (!Array.isArray(rows) || rows.length === 0) {
        histRoot.innerHTML =
          '<p class="painel-nota-agente">Nenhuma versão no banco ainda para este prompt.</p>'
        return
      }
      histRoot.innerHTML = rows
        .map((row) => {
          const data = h(formatarDataPrompt(row.criado_em))
          const aut = row.autor ?h(row.autor) : '—'
          const sn = h((row.snippet || '').trim())
          const ativoCls = row.ativo ?' is-ativo' : ''
          const btn = row.ativo
            ?'<span class="config-prompt-ativo-badge">Ativa</span>'
            : `<button type="button" class="btn-followup btn-prompt-reverter" data-prompt-version-id="${row.id}">Restaurar</button>`
          return (
            `<div class="config-prompt-hist-row${ativoCls}">` +
            `<div class="config-prompt-hist-meta">v${row.version} · ${data} · ${aut}</div>` +
            `<div class="config-prompt-hist-snippet">${sn}</div>` +
            `${btn}</div>`
          )
        })
        .join('')
    }

    histRoot.addEventListener('click', async (ev) => {
      const t = ev.target
      if (!t || !t.classList || !t.classList.contains('btn-prompt-reverter')) return
      const id = t.getAttribute('data-prompt-version-id')
      if (!id) return
      const chave = sel.value
      t.disabled = true
      try {
        const r = await fetch(`/dashboard/prompts/${encodeURIComponent(chave)}/reverter`, {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify({ versionId: parseInt(id, 10) }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        Core.toast ?Core.toast('Versão restaurada.', 'sucesso') : alert('Versão restaurada.')
        await carregarDetalhe()
      } catch (e) {
        Core.toast ?Core.toast(e.message || 'Falha ao restaurar.', 'erro') : alert(e.message)
      } finally {
        t.disabled = false
      }
    })

    sel.addEventListener('change', carregarDetalhe)

    btnSalvar?.addEventListener('click', async () => {
      const chave = sel.value
      const prev = btnSalvar.textContent
      btnSalvar.disabled = true
      btnSalvar.textContent = 'Salvando…'
      try {
        const r = await fetch(`/dashboard/prompts/${encodeURIComponent(chave)}`, {
          method: 'PUT',
          headers: headersComReprocessSecret(),
          body: JSON.stringify({
            conteudo: ta.value,
            autor: (autorInp && autorInp.value) || '',
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        Core.toast
          ?Core.toast('Nova versão salva; memória do servidor atualizada.', 'sucesso')
          : alert('Salvo.')
        await carregarDetalhe()
      } catch (e) {
        setPromptStatus(e.message || 'Falha ao salvar.', true)
        Core.toast ?Core.toast(e.message || 'Falha ao salvar.', 'erro') : alert(e.message)
      } finally {
        btnSalvar.disabled = false
        btnSalvar.textContent = prev
      }
    })

    carregarDetalhe()
  }

  // ─── Motor de IA ────────────────────────────────────────────────────────────

  const AI_MODELS = {
    anthropic: [
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (mais capaz)' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recomendado)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (mais rápido)' },
      { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    ],
    openai: [
      { value: 'gpt-4o', label: 'GPT-4o (mais capaz)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (recomendado)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (econômico)' },
    ],
  }

  function populateModelSelect(selectEl, provider, currentModel) {
    if (!selectEl) return
    const models = AI_MODELS[provider] || AI_MODELS.anthropic
    selectEl.innerHTML = models
      .map((m) => `<option value="${m.value}"${m.value === currentModel ? ' selected' : ''}>${m.label}</option>`)
      .join('')
    if (currentModel && !models.find((m) => m.value === currentModel)) {
      selectEl.innerHTML += `<option value="${currentModel}" selected>${currentModel}</option>`
    }
  }

  function setAIStatus(msg, erro) {
    const el = document.getElementById('ai-settings-status')
    if (!el) return
    el.textContent = msg || ''
    el.style.color = erro ? 'var(--perigo)' : 'var(--sucesso)'
  }

  function formatAILogDate(d) {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    } catch (_) { return String(d) }
  }

  function renderAILogs(logs) {
    const container = document.getElementById('ai-logs-container')
    if (!container) return
    if (!Array.isArray(logs) || logs.length === 0) {
      container.innerHTML = '<p class="painel-nota-agente">Nenhuma chamada registrada ainda.</p>'
      return
    }
    container.innerHTML =
      '<table class="ai-logs-table">' +
      '<thead><tr><th>Data</th><th>Provedor</th><th>Modelo</th><th>Tarefa</th><th>Status</th><th>Latência</th></tr></thead>' +
      '<tbody>' +
      logs.map((row) => {
        const ok = row.success !== false
        return (
          `<tr class="${ok ? '' : 'ai-log-row--erro'}">` +
          `<td class="ai-log-date">${formatAILogDate(row.created_at)}</td>` +
          `<td><span class="ai-log-badge ai-log-badge--${row.provider || 'unknown'}">${row.provider || '—'}</span></td>` +
          `<td class="ai-log-model">${Core.escHtml ? Core.escHtml(row.model || '—') : (row.model || '—')}</td>` +
          `<td class="ai-log-task">${Core.escHtml ? Core.escHtml(row.task || '—') : (row.task || '—')}</td>` +
          `<td>${ok ? '<span class="ai-log-ok">OK</span>' : '<span class="ai-log-err">Erro</span>'}</td>` +
          `<td>${row.latency_ms != null ? row.latency_ms + 'ms' : '—'}</td>` +
          '</tr>'
        )
      }).join('') +
      '</tbody></table>'
  }

  async function carregarAILogs() {
    const container = document.getElementById('ai-logs-container')
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), 12000) : null
    try {
      const r = await fetch('/dashboard/ai/logs?limit=50', {
        signal: ctl?.signal,
        headers: Core.headersComReprocessSecret ? Core.headersComReprocessSecret(false) : {},
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || r.statusText)
      renderAILogs(j.logs || [])
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'Tempo esgotado ao buscar histórico.' : `Falha ao carregar logs: ${e.message}`
      if (container) container.innerHTML = `<p class="painel-nota-agente" style="color:var(--perigo)">${msg}</p>`
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function carregarAISettings() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), 10000) : null
    try {
      const r = await fetch('/dashboard/ai/settings', {
        signal: ctl?.signal,
        headers: Core.headersComReprocessSecret ? Core.headersComReprocessSecret(false) : {},
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || r.statusText)
      aplicarAISettingsNaUI(j.settings || {})
      setAIStatus('', false)
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'Tempo esgotado ao buscar configurações.' : e.message
      setAIStatus('Falha ao carregar configurações: ' + msg, true)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function aplicarAISettingsNaUI(s) {
    const providerEl = document.getElementById('ai-provider')
    const modelEl = document.getElementById('ai-model')
    const tempEl = document.getElementById('ai-temperature')
    const tokensEl = document.getElementById('ai-max-tokens')
    const fbEnabledEl = document.getElementById('ai-fallback-enabled')
    const fbProviderEl = document.getElementById('ai-fallback-provider')
    const fbModelEl = document.getElementById('ai-fallback-model')
    const fbFieldsEl = document.getElementById('ai-fallback-fields')
    const fbModelFieldEl = document.getElementById('ai-fallback-model-field')

    const provider = s.provider || 'anthropic'
    const fbProvider = s.fallback_provider || 'openai'
    const fbOn = s.fallback_enabled !== false

    if (providerEl) providerEl.value = provider
    populateModelSelect(modelEl, provider, s.model)
    if (tempEl) tempEl.value = s.temperature != null ? s.temperature : 0.4
    if (tokensEl) tokensEl.value = s.max_tokens != null ? s.max_tokens : 1200
    if (fbEnabledEl) fbEnabledEl.checked = fbOn
    if (fbProviderEl) fbProviderEl.value = fbProvider
    populateModelSelect(fbModelEl, fbProvider, s.fallback_model)
    if (fbFieldsEl) fbFieldsEl.style.opacity = fbOn ? '1' : '0.4'
    if (fbModelFieldEl) fbModelFieldEl.style.opacity = fbOn ? '1' : '0.4'

    atualizarBannerLLMAtivo({
      provider,
      model: s.model,
      fallback_enabled: fbOn,
      fallback_provider: fbProvider,
      fallback_model: s.fallback_model,
    })
  }

  function setupAISettings() {
    const providerEl = document.getElementById('ai-provider')
    const modelEl = document.getElementById('ai-model')
    const fbProviderEl = document.getElementById('ai-fallback-provider')
    const fbModelEl = document.getElementById('ai-fallback-model')
    const fbEnabledEl = document.getElementById('ai-fallback-enabled')
    const fbFieldsEl = document.getElementById('ai-fallback-fields')
    const fbModelFieldEl = document.getElementById('ai-fallback-model-field')
    const btnSalvar = document.getElementById('btn-ai-salvar')

    if (!providerEl) return

    providerEl.addEventListener('change', () => {
      populateModelSelect(modelEl, providerEl.value, null)
    })

    fbProviderEl && fbProviderEl.addEventListener('change', () => {
      populateModelSelect(fbModelEl, fbProviderEl.value, null)
    })

    fbEnabledEl && fbEnabledEl.addEventListener('change', () => {
      const on = fbEnabledEl.checked
      if (fbFieldsEl) fbFieldsEl.style.opacity = on ? '1' : '0.4'
      if (fbModelFieldEl) fbModelFieldEl.style.opacity = on ? '1' : '0.4'
    })

    btnSalvar && btnSalvar.addEventListener('click', async () => {
      const prev = btnSalvar.textContent
      btnSalvar.disabled = true
      btnSalvar.textContent = 'Salvando…'
      setAIStatus('', false)
      try {
        const payload = {
          provider: providerEl.value,
          model: modelEl ? modelEl.value : '',
          temperature: parseFloat(document.getElementById('ai-temperature')?.value) || 0.4,
          max_tokens: parseInt(document.getElementById('ai-max-tokens')?.value, 10) || 1200,
          fallback_enabled: fbEnabledEl ? fbEnabledEl.checked : true,
          fallback_provider: fbProviderEl ? fbProviderEl.value : 'openai',
          fallback_model: fbModelEl ? fbModelEl.value : 'gpt-4o-mini',
        }
        const r = await fetch('/dashboard/ai/settings', {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify(payload),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        if (j.settings) aplicarAISettingsNaUI(j.settings)
        Core.toast ? Core.toast(j.mensagem || 'Configurações de IA salvas.', 'sucesso') : null
        setAIStatus(j.mensagem || 'Salvo com sucesso.', false)
        await carregarAILogs()
      } catch (e) {
        setAIStatus(e.message || 'Falha ao salvar.', true)
        Core.toast ? Core.toast(e.message || 'Falha ao salvar.', 'erro') : null
      } finally {
        btnSalvar.disabled = false
        btnSalvar.textContent = prev
      }
    })

    async function testarProvedor(useProvider, useModel, btnEl, opts = {}) {
      const scope = opts.scope || 'principal'
      const testDiv = document.getElementById('ai-test-result')
      const prev = btnEl.textContent
      btnEl.disabled = true
      btnEl.textContent = 'Testando…'
      if (testDiv) { testDiv.style.display = 'none'; testDiv.innerHTML = '' }
      try {
        const r = await fetch('/dashboard/ai/test', {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify({ provider: useProvider, model: useModel, scope }),
        })
        const j = await r.json().catch(() => ({}))
        if (testDiv) {
          testDiv.style.display = 'block'
          const ok = j.ok !== false && r.ok
          const providerLabel = j.provider_label || j.provider || '?'
          const fallbackInfo = j.fallback_used
            ? ` <span class="ai-log-err">· fallback usado</span>`
            : ''
          testDiv.className = 'ai-test-result ' + (ok ? 'ai-test-result--ok' : 'ai-test-result--erro')
          testDiv.innerHTML =
            `<strong>${ok ? `✔ Teste concluído com ${providerLabel}` : '✖ Falha'}</strong> ` +
            `<span class="ai-log-badge ai-log-badge--${j.provider || 'unknown'}">${j.provider || '?'}</span> ` +
            `<span class="ai-log-model">${Core.escHtml ? Core.escHtml(j.model || '') : (j.model || '')}</span>` +
            fallbackInfo +
            (j.text ? ` — <em>${Core.escHtml ? Core.escHtml(j.text) : j.text}</em>` : '') +
            (j.latency_ms ? ` <span style="color:var(--texto3)">(${j.latency_ms}ms)</span>` : '') +
            (j.erro ? ` <span style="color:var(--perigo)">${Core.escHtml ? Core.escHtml(j.erro) : j.erro}</span>` : '')
        }
        // Atualiza historico depois do teste
        carregarAILogs()
      } catch (e) {
        if (testDiv) {
          testDiv.style.display = 'block'
          testDiv.className = 'ai-test-result ai-test-result--erro'
          testDiv.textContent = 'Erro de rede: ' + e.message
        }
      } finally {
        btnEl.disabled = false
        btnEl.textContent = prev
      }
    }

    document.getElementById('btn-ai-testar-principal')?.addEventListener('click', function () {
      testarProvedor(
        providerEl ? providerEl.value : undefined,
        modelEl ? modelEl.value : undefined,
        this,
        { scope: 'principal' }
      )
    })

    document.getElementById('btn-ai-testar-fallback')?.addEventListener('click', function () {
      testarProvedor(
        fbProviderEl ? fbProviderEl.value : undefined,
        fbModelEl ? fbModelEl.value : undefined,
        this,
        { scope: 'fallback' }
      )
    })

    carregarAISettings()
    carregarAILogs()
  }

  function atualizarBannerLLMAtivo(s) {
    const PROVIDERS = { anthropic: 'Anthropic Claude', openai: 'OpenAI GPT' }
    const elP = document.getElementById('ai-active-provider')
    const elM = document.getElementById('ai-active-model')
    const elF = document.getElementById('ai-active-fallback')
    if (elP) elP.textContent = PROVIDERS[s.provider] || s.provider || '—'
    if (elM) elM.textContent = s.model || '—'
    if (elF) {
      if (s.fallback_enabled) {
        const fbProv = PROVIDERS[s.fallback_provider] || s.fallback_provider || '—'
        elF.textContent = `ativo (${fbProv} · ${s.fallback_model || '—'})`
      } else {
        elF.textContent = 'desativado'
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    setupTabs()
    Core.initReprocessSecretInput && Core.initReprocessSecretInput('config-reprocess-secret-input')

    syncInstrucaoFromStorage()
    syncRefreshRadios()
    setupPrompts()

    const taInstr = document.getElementById('config-followup-instrucao-textarea')
    if (taInstr && Core.setFollowupInstrucaoPadrao) {
      const persist = () => Core.setFollowupInstrucaoPadrao(taInstr.value)
      taInstr.addEventListener('input', persist)
      taInstr.addEventListener('change', persist)
    }

    document.querySelectorAll('input[name="conversas-refresh"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return
        const v = radio.value
        if (Core.setConversasRefreshPref) {
          Core.setConversasRefreshPref(v === 'manual' ?'manual' : parseInt(v, 10))
        }
        notifyConversasRefresh()
      })
    })

    document.getElementById('btn-followup-numero')?.addEventListener('click', async () => {
      const input = document.getElementById('followup-numero-input')
      const numero = (input?.value || '').trim()
      if (!numero) {
        Core.toast ?Core.toast('Informe o número ou o JID do WhatsApp.', 'erro') : alert('Informe o número ou o JID do WhatsApp.')
        return
      }
      const btn = document.getElementById('btn-followup-numero')
      const prev = btn.textContent
      setBusy(true)
      btn.textContent = 'Enviando…'
      try {
        const r = await fetch('/dashboard/followup', {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify(followupPayloadExtra({ numero })),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        input.value = ''
        Core.toast ?Core.toast('Follow-up enviado.', 'sucesso') : alert('Follow-up enviado.')
      } catch (err) {
        Core.toast ?Core.toast(err.message || 'Falha no follow-up', 'erro') : alert(err.message || 'Falha no follow-up')
      } finally {
        setBusy(false)
        btn.textContent = prev
      }
    })

    setupAISettings()

    carregarOperadores().catch((err) => {
      setOperadoresStatus(err.message || 'Falha ao carregar operadores.', true)
    })

    document.getElementById('btn-operador-add')?.addEventListener('click', () => {
      renderOperadores([...normalizarOperadoresDom(), operadorVazio()])
    })

    document.getElementById('btn-operadores-salvar')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-operadores-salvar')
      const prev = btn.textContent
      btn.disabled = true
      btn.textContent = 'Salvando...'
      try {
        await salvarOperadores()
        Core.toast ?Core.toast('Operadores salvos.', 'sucesso') : alert('Operadores salvos.')
      } catch (err) {
        setOperadoresStatus(err.message || 'Falha ao salvar operadores.', true)
        Core.toast ?Core.toast(err.message || 'Falha ao salvar operadores.', 'erro') : alert(err.message || 'Falha ao salvar operadores.')
      } finally {
        btn.disabled = false
        btn.textContent = prev
      }
    })
  })
})()
