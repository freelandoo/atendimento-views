/**
 * Utilitários compartilhados do dashboard (sem dependência de página específica).
 */
;(function (global) {
  /** Direcionamento padrão de follow-up (sincronizado na página Configuração). */
  const PJ_FOLLOWUP_INSTRUCAO_KEY = 'pj_followup_instrucao'
  /** Intervalo de atualização da lista em Conversas (`manual` ou número em ms como string). */
  const PJ_CONVERSAS_REFRESH_KEY = 'pj_conversas_refresh_ms'
  const PJ_DASHBOARD_CSRF_KEY = 'pj_dashboard_csrf'
  const APP_TIMEZONE = 'America/Sao_Paulo'

  function getFollowupInstrucaoPadrao() {
    try {
      return (sessionStorage.getItem(PJ_FOLLOWUP_INSTRUCAO_KEY) || '').trim()
    } catch (_) {
      return ''
    }
  }

  function setFollowupInstrucaoPadrao(texto) {
    try {
      sessionStorage.setItem(PJ_FOLLOWUP_INSTRUCAO_KEY, texto == null ?'' : String(texto))
    } catch (_) {}
  }

  function getConversasRefreshPref() {
    try {
      const v = localStorage.getItem(PJ_CONVERSAS_REFRESH_KEY)
      if (v === 'manual') return 'manual'
      const n = parseInt(v, 10)
      if (n === 5000 || n === 10000 || n === 30000 || n === 60000) return n
      return 10000
    } catch (_) {
      return 10000
    }
  }

  function setConversasRefreshPref(val) {
    try {
      localStorage.setItem(PJ_CONVERSAS_REFRESH_KEY, val === 'manual' ?'manual' : String(val))
    } catch (_) {}
  }

  /**
   * @param {boolean} [includeJsonContentType=true] — use `false` em GET para evitar preflight desnecessário.
   */
  function headersComReprocessSecret(includeJsonContentType) {
    const headers = {}
    if (includeJsonContentType !== false) {
      headers['Content-Type'] = 'application/json'
    }
    const csrf = sessionStorage.getItem(PJ_DASHBOARD_CSRF_KEY)
    if (csrf) headers['x-csrf-token'] = csrf
    return headers
  }

  function armazenarSessaoDashboard(data) {
    const csrf = data && (data.csrfToken || data.csrf_token)
    if (csrf) sessionStorage.setItem(PJ_DASHBOARD_CSRF_KEY, csrf)
    return data
  }

  async function carregarSessaoDashboard() {
    const r = await fetch('/dashboard/auth/session', { credentials: 'same-origin' })
    if (!r.ok) {
      sessionStorage.removeItem(PJ_DASHBOARD_CSRF_KEY)
      return null
    }
    const data = await r.json().catch(() => null)
    return armazenarSessaoDashboard(data)
  }

  async function loginDashboard(email, password) {
    const r = await fetch('/dashboard/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, erro: data.erro || 'Login invalido' }
    armazenarSessaoDashboard(data)
    return { ok: true, status: r.status, data }
  }

  async function logoutDashboard() {
    await fetch('/dashboard/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headersComReprocessSecret(true),
      body: JSON.stringify({}),
    }).catch(() => null)
    sessionStorage.removeItem(PJ_DASHBOARD_CSRF_KEY)
    window.location.href = 'login.html'
  }

  function initDashboardAuthUI() {
    const form = document.getElementById('dashboard-login-form')
    if (form) {
      const status = document.getElementById('dashboard-login-status')
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault()
        if (status) status.textContent = 'Entrando...'
        const email = document.getElementById('dashboard-login-email')?.value || ''
        const password = document.getElementById('dashboard-login-password')?.value || ''
        const r = await loginDashboard(email, password)
        if (!r.ok) {
          if (status) status.textContent = r.erro || 'Credenciais invalidas'
          return
        }
        window.location.href = 'dashboard.html'
      })
    }
    document.querySelectorAll('[data-dashboard-logout]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault()
        logoutDashboard()
      })
    })
  }

  function escHtml(s) {
    return String(s == null ?'' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function escAttr(s) {
    return escHtml(s)
  }

  function formatarNumero(numero) {
    return String(numero || '')
      .replace('@s.whatsapp.net', '')
      .replace(/^55/, '+55 ')
  }

  function digitsWaMe(numero) {
    return String(numero || '')
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/\D/g, '')
  }

  function idadeLabel(minutos) {
    const m = Math.max(0, parseInt(minutos, 10) || 0)
    if (m < 1) return 'agora'
    if (m < 60) return `${m}min`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    const d = Math.floor(h / 24)
    return `${d}d`
  }

  function dataCurta(dt) {
    if (!dt) return '—'
    try {
      return new Date(dt).toLocaleString('pt-BR', {
        timeZone: APP_TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch (_) {
      return String(dt)
    }
  }

  function badge(label, cls) {
    return `<span class="estagio-badge${cls ?' ' + escAttr(cls) : ''}">${escHtml(label)}</span>`
  }

  function emptyState(title, detail) {
    return (
      '<div class="empty-state">' +
      `<strong>${escHtml(title || 'Nada por aqui')}</strong>` +
      (detail ?`<span>${escHtml(detail)}</span>` : '') +
      '</div>'
    )
  }

  function loadingState(label) {
    return `<div class="empty-state empty-state-loading"><strong>${escHtml(label || 'Carregando')}</strong></div>`
  }

  function toast(message, type) {
    let root = document.getElementById('dash-toast-root')
    if (!root) {
      root = document.createElement('div')
      root.id = 'dash-toast-root'
      root.className = 'dash-toast-root'
      root.setAttribute('aria-live', 'polite')
      root.setAttribute('aria-atomic', 'false')
      document.body.appendChild(root)
    }
    const el = document.createElement('div')
    el.className = `dash-toast dash-toast-${type || 'info'}`
    el.textContent = message || ''
    root.appendChild(el)
    window.setTimeout(() => {
      el.classList.add('dash-toast-out')
      window.setTimeout(() => el.remove(), 220)
    }, 3600)
  }

  async function fetchJson(url, opts) {
    const init = { ...(opts || {}) }
    init.credentials = init.credentials || 'same-origin'
    const method = String(init.method || 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      init.headers = { ...(init.headers || {}) }
      const csrf = sessionStorage.getItem(PJ_DASHBOARD_CSRF_KEY)
      if (csrf && !init.headers['x-csrf-token']) init.headers['x-csrf-token'] = csrf
    }
    let r
    try {
      r = await fetch(url, init)
    } catch (err) {
      return { ok: false, status: 0, erro: 'Falha de rede', data: null }
    }
    const raw = await r.text()
    let data = null
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch (_) {
        return { ok: false, status: r.status, erro: 'Resposta inválida do servidor', data: null }
      }
    }
    if (r.status === 401) {
      sessionStorage.removeItem(PJ_DASHBOARD_CSRF_KEY)
      window.location.href = 'login.html'
      return { ok: false, status: 401, erro: 'Não autorizado', data }
    }
    if (!r.ok) {
      return { ok: false, status: r.status, erro: (data && (data.erro || data.error)) || r.statusText, data }
    }
    return { ok: true, status: r.status, data, erro: null }
  }

  function initReprocessSecretInput(id) {
    const el = document.getElementById(id || 'reprocess-secret-input')
    if (!el) return
    el.disabled = true
    el.value = ''
    el.placeholder = 'Autenticacao por sessao ativa'
  }

  global.DashboardCore = {
    headersComReprocessSecret,
    initReprocessSecretInput,
    carregarSessaoDashboard,
    initDashboardAuthUI,
    loginDashboard,
    logoutDashboard,
    getFollowupInstrucaoPadrao,
    setFollowupInstrucaoPadrao,
    getConversasRefreshPref,
    setConversasRefreshPref,
    escHtml,
    escAttr,
    formatarNumero,
    digitsWaMe,
    idadeLabel,
    dataCurta,
    badge,
    emptyState,
    loadingState,
    toast,
    fetchJson,
    PJ_FOLLOWUP_INSTRUCAO_KEY,
    PJ_CONVERSAS_REFRESH_KEY,
  }
  if (typeof window !== 'undefined') {
    const page = (window.location.pathname || '').split('/').pop() || 'index.html'
    window.addEventListener('DOMContentLoaded', () => {
      initDashboardAuthUI()
      if (page !== 'login.html') {
        carregarSessaoDashboard().then((sessao) => {
          if (!sessao) window.location.href = 'login.html'
        }).catch(() => {
          sessionStorage.removeItem(PJ_DASHBOARD_CSRF_KEY)
          window.location.href = 'login.html'
        })
      }
    })
  }
})(typeof window !== 'undefined' ?window : globalThis)
