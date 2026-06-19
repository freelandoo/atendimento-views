;(function () {
  'use strict'

  var ENDPOINT = '/dashboard/prospeccao/whatsapp/status'
  var POLL_MS = 30000
  var SESSION_KEY = 'pj_alerta_minimizado'

  var estadoAtual = null
  var minimizado = false

  function csrfToken() {
    try { return sessionStorage.getItem('pj_dashboard_csrf') || '' } catch (_) { return '' }
  }

  function injetar() {
    var host = document.createElement('div')
    host.id = 'pj-alertas-host'
    host.innerHTML = [
      '<div id="pj-alerta-popup" class="pj-alerta-popup" hidden role="alert" aria-live="assertive" aria-atomic="true">',
        '<div class="pj-alerta-popup-header">',
          '<span class="pj-alerta-popup-dot" aria-hidden="true"></span>',
          '<strong class="pj-alerta-popup-titulo">Sistema não operacional</strong>',
          '<button type="button" class="pj-alerta-popup-min-btn" title="Minimizar" aria-label="Minimizar aviso">&#x2212;</button>',
        '</div>',
        '<div class="pj-alerta-popup-body">',
          '<p id="pj-alerta-popup-msg">O WhatsApp está desconectado. Mensagens não estão sendo enviadas para os seus prospects.</p>',
          '<a href="whatsapp.html" class="pj-alerta-popup-btn-fix">Reconectar agora</a>',
        '</div>',
      '</div>',
      '<button id="pj-alerta-badge" class="pj-alerta-badge" hidden aria-label="Sistema offline — clique para expandir">',
        '<span class="pj-alerta-badge-dot" aria-hidden="true"></span>',
        'Sistema offline',
      '</button>'
    ].join('')
    document.body.appendChild(host)

    host.querySelector('.pj-alerta-popup-min-btn').addEventListener('click', function () {
      minimizado = true
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch (_) {}
      document.getElementById('pj-alerta-popup').hidden = true
      document.getElementById('pj-alerta-badge').hidden = false
    })

    document.getElementById('pj-alerta-badge').addEventListener('click', function () {
      minimizado = false
      try { sessionStorage.removeItem(SESSION_KEY) } catch (_) {}
      document.getElementById('pj-alerta-badge').hidden = true
      if (estadoAtual && estadoAtual.connected === false) mostrarPopup(estadoAtual)
    })
  }

  function mostrarPopup(status) {
    var popup = document.getElementById('pj-alerta-popup')
    if (!popup) return
    var state = status.state || 'desconhecido'
    var msg = document.getElementById('pj-alerta-popup-msg')
    if (msg) msg.textContent = 'WhatsApp desconectado (estado: ' + state + '). Mensagens não estão sendo enviadas para os seus prospects.'
    popup.hidden = false
    var badge = document.getElementById('pj-alerta-badge')
    if (badge) badge.hidden = true
  }

  function mostrarBadge() {
    var popup = document.getElementById('pj-alerta-popup')
    var badge = document.getElementById('pj-alerta-badge')
    if (popup) popup.hidden = true
    if (badge) badge.hidden = false
  }

  function esconder() {
    var popup = document.getElementById('pj-alerta-popup')
    var badge = document.getElementById('pj-alerta-badge')
    if (popup) popup.hidden = true
    if (badge) badge.hidden = true
    minimizado = false
    try { sessionStorage.removeItem(SESSION_KEY) } catch (_) {}
  }

  function verificar() {
    fetch(ENDPOINT, {
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken() }
    })
    .then(function (r) {
      if (r.status === 401 || r.status === 403) return null
      return r.json()
    })
    .then(function (data) {
      if (!data) return
      estadoAtual = data
      if (data.connected === false) {
        if (minimizado) {
          mostrarBadge()
        } else {
          mostrarPopup(data)
        }
      } else {
        esconder()
      }
    })
    .catch(function () {
      // network error — silence; don't show false alerts on transient failures
    })
  }

  function init() {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) minimizado = true
    } catch (_) {}
    injetar()
    verificar()
    setInterval(verificar, POLL_MS)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
