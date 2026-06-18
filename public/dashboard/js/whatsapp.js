'use strict'

// Alias for convenience (DashboardCore is the global from core.js)
const Core = typeof DashboardCore !== 'undefined' ? DashboardCore : window.DashboardCore

const Whatsapp = {
  state: {
    status: 'disconnected',
    phone_number: null,
    profile_name: null,
    connected_at: null,
    qr_code: null,
    qr_expires_at: null,
  },

  pollIntervalId: null,
  countdownIntervalId: null,

  async init() {
    this.attachEventListeners()
    await this.loadStatus()
  },

  attachEventListeners() {
    const btns = {
      'btn-wa-connect': () => this.handleConnect(),
      'btn-wa-refresh-qr': () => this.handleRefreshQr(),
      'btn-wa-cancel': () => this.handleCancel(),
      'btn-wa-check': () => this.handleCheckStatus(),
      'btn-wa-disconnect': () => this.handleDisconnect(),
      'btn-wa-retry': () => this.loadStatus(),
    }

    Object.entries(btns).forEach(([id, handler]) => {
      const btn = document.getElementById(id)
      if (btn) btn.addEventListener('click', handler.bind(this))
    })
  },

  async loadStatus() {
    try {
      const response = await Core.fetchJson('/dashboard/whatsapp/status', { method: 'GET' })
      if (!response.ok) {
        console.error('API error:', response.erro)
        this.showError(response.erro || 'Falha ao carregar status')
        return
      }
      this.state = Object.assign(this.state, response.data)
      this.render()
      this.startPollingIfNeeded()
    } catch (err) {
      console.error('Failed to load WhatsApp status:', err)
      this.showError('Falha ao carregar status')
    }
  },

  async handleConnect() {
    try {
      this.showPanel('wa-panel-connecting')
      const response = await Core.fetchJson('/dashboard/whatsapp/connect', { method: 'POST' })
      if (!response.ok) {
        console.error('API error:', response.erro)
        this.showError(response.erro || 'Falha ao conectar WhatsApp')
        return
      }
      this.state = Object.assign(this.state, response.data)
      this.render()
      this.startPollingIfNeeded()
      this.startCountdown()
    } catch (err) {
      console.error('Failed to connect WhatsApp:', err)
      this.showError('Falha ao conectar WhatsApp')
    }
  },

  async handleRefreshQr() {
    try {
      this.showPanel('wa-panel-connecting')
      const response = await Core.fetchJson('/dashboard/whatsapp/refresh-qr', { method: 'POST' })
      if (!response.ok) {
        console.error('API error:', response.erro)
        this.showError(response.erro || 'Falha ao gerar novo código QR')
        return
      }
      this.state = Object.assign(this.state, response.data)
      this.render()
      this.startCountdown()
    } catch (err) {
      console.error('Failed to refresh QR code:', err)
      this.showError('Falha ao gerar novo código QR')
    }
  },

  async handleCancel() {
    this.stopPolling()
    this.stopCountdown()
    this.state.status = 'disconnected'
    this.render()
  },

  async handleCheckStatus() {
    try {
      const response = await Core.fetchJson('/dashboard/whatsapp/check-status', { method: 'POST' })
      if (!response.ok) {
        console.error('API error:', response.erro)
        this.showError(response.erro || 'Falha ao verificar status')
        return
      }
      this.state = Object.assign(this.state, response.data)
      this.render()
      this.startPollingIfNeeded()
    } catch (err) {
      console.error('Failed to check status:', err)
      this.showError('Falha ao verificar status')
    }
  },

  async handleDisconnect() {
    try {
      this.showPanel('wa-panel-connecting')
      const response = await Core.fetchJson('/dashboard/whatsapp/disconnect', { method: 'POST' })
      if (!response.ok) {
        console.error('API error:', response.erro)
        this.showError(response.erro || 'Falha ao desconectar WhatsApp')
        return
      }
      this.state = Object.assign(this.state, response.data)
      this.stopPolling()
      this.stopCountdown()
      this.render()
    } catch (err) {
      console.error('Failed to disconnect WhatsApp:', err)
      this.showError('Falha ao desconectar WhatsApp')
    }
  },

  showPanel(panelId) {
    document.querySelectorAll('.wa-panel').forEach(p => {
      p.classList.remove('wa-panel-show')
    })
    const panel = document.getElementById(panelId)
    if (panel) panel.classList.add('wa-panel-show')
  },

  render() {
    const { status, phone_number, profile_name, connected_at, qr_code, qr_expires_at } = this.state

    switch (status) {
      case 'disconnected':
        this.showPanel('wa-panel-disconnected')
        this.updateDot('disconnected')
        break
      case 'qr_pending':
        this.showPanel('wa-panel-qr')
        this.updateDot('connecting')
        this.renderQrCode(qr_code)
        break
      case 'connecting':
        this.showPanel('wa-panel-connecting')
        this.updateDot('connecting')
        break
      case 'connected':
        this.showPanel('wa-panel-connected')
        this.updateDot('connected')
        document.getElementById('wa-phone-number').textContent = phone_number || '—'
        document.getElementById('wa-profile-name').textContent = profile_name || '—'
        document.getElementById('wa-connected-at').textContent = connected_at ? new Date(connected_at).toLocaleString('pt-BR') : '—'
        break
      case 'error':
        this.showPanel('wa-panel-error')
        this.updateDot('error')
        break
    }
  },

  updateDot(status) {
    const dot = document.getElementById('wa-status-dot')
    const label = document.getElementById('wa-status-label')

    const dotClasses = { 'dot-green': false, 'dot-yellow': false, 'dot-red': false }
    const labelTexts = {
      'disconnected': 'desconectado',
      'connecting': 'conectando',
      'qr_pending': 'aguardando escaneamento',
      'connected': 'conectado',
      'error': 'erro',
    }

    const colorMap = {
      'disconnected': 'dot-red',
      'connecting': 'dot-yellow',
      'qr_pending': 'dot-yellow',
      'connected': 'dot-green',
      'error': 'dot-red',
    }

    Object.assign(dotClasses, { [colorMap[status]]: true })
    Object.entries(dotClasses).forEach(([cls, active]) => {
      if (active) dot.classList.add(cls)
      else dot.classList.remove(cls)
    })

    label.textContent = labelTexts[status]
  },

  renderQrCode(base64) {
    const img = document.getElementById('wa-qr-image')
    if (base64) {
      img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
    }
  },

  startPollingIfNeeded() {
    const { status } = this.state
    if (status === 'qr_pending' || status === 'connecting') {
      this.startPolling()
    } else {
      this.stopPolling()
    }
  },

  startPolling() {
    this.stopPolling()
    this.pollIntervalId = setInterval(() => {
      this.handleCheckStatus()
    }, 3000)
  },

  stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId)
      this.pollIntervalId = null
    }
  },

  startCountdown() {
    this.stopCountdown()
    const expiresAt = new Date(this.state.qr_expires_at).getTime()
    const countdownEl = document.getElementById('wa-qr-countdown')

    this.countdownIntervalId = setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
      countdownEl.textContent = remaining

      if (remaining === 0) {
        this.stopCountdown()
        this.stopPolling()
        this.state.status = 'disconnected'
        this.render()
        Core.toast('Código QR expirou. Gere um novo para continuar.', 'warning')
      }
    }, 1000)
  },

  stopCountdown() {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId)
      this.countdownIntervalId = null
    }
  },

  showError(message) {
    document.getElementById('wa-error-message').textContent = message
    this.state.status = 'error'
    this.render()
  },
}

document.addEventListener('DOMContentLoaded', () => Whatsapp.init())
