/**
 * Página Conversas: lista, pausar agente, follow-up (modal por linha), reprocessar.
 */
;(function () {
  const Core = window.DashboardCore || {}

  function escAttr(s) {
    if (s == null) return ''
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  const escHtml = Core.escHtml || escAttr

  /** Ícones SVG 24×24 (stroke) para ações da linha; conteúdo estático, sem user input. */
  const IC = {
    user:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    pause:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    play:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    preview:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 19"/></svg>',
    check:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    archive:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
    archiveOut:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M12 12v9"/><path d="m9 16 3 3 3-3"/></svg>',
    trash:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    mail:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    refresh:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    edit:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  }

  function icoSpan(key) {
    const svg = IC[key] || ''
    return '<span class="conversa-acao-ico-svg" aria-hidden="true">' + svg + '</span>'
  }

  function followupAutoLabel(minutos) {
    const min = Math.max(0, parseInt(minutos, 10) || 0)
    if (min < 60) return `Auto em ${min || 1}min`
    const h = Math.floor(min / 60)
    const m = min % 60
    if (m === 0) return `Auto em ${h}h`
    return `Auto em ${h}h ${m}min`
  }

  function followupAutoTitle(raw) {
    if (!raw) return 'Follow-up automatico agendado'
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) return 'Follow-up automatico agendado'
    return 'Follow-up automatico em ' + dt.toLocaleString('pt-BR')
  }

  /** @param {HTMLElement | null} el */
  function setConversaAcaoLoading(el, busy) {
    if (!el) return
    el.disabled = !!busy
    if (busy) el.setAttribute('aria-busy', 'true')
    else el.removeAttribute('aria-busy')
    el.classList.toggle('is-loading', !!busy)
    el.classList.remove('is-done')
  }

  /** @param {HTMLElement | null} el */
  function setConversaAcaoDone(el) {
    if (!el) return
    el.removeAttribute('aria-busy')
    el.classList.remove('is-loading')
    el.classList.add('is-done')
  }

  function headersComReprocessSecret() {
    return Core.headersComReprocessSecret
      ?Core.headersComReprocessSecret(true)
      : { 'Content-Type': 'application/json' }
  }

  function closePreviewSitePopover() {
    document.querySelectorAll('.preview-site-popover').forEach((el) => el.remove())
  }

  function openPreviewSitePopover(numero, btn) {
    closePreviewSitePopover()
    const toolbar = btn.closest('.conversa-acao-toolbar')
    if (!toolbar) return
    const pop = document.createElement('div')
    pop.className = 'preview-site-popover'
    pop.innerHTML =
      '<label class="preview-site-popover-label">Modelo</label>' +
      '<select class="preview-site-popover-select" data-preview-modelo>' +
      '<option value="">Auto</option>' +
      '<option value="iniciante">Iniciante</option>' +
      '<option value="padrao">Padrao</option>' +
      '<option value="premium">Premium</option>' +
      '</select>' +
      '<label class="preview-site-popover-label preview-site-popover-label-style">Estilo</label>' +
      '<div class="preview-site-style-options" data-preview-estilo>' +
      '<button type="button" class="preview-site-style-btn is-selected" data-estilo="">Lapis (auto)</button>' +
      '<button type="button" class="preview-site-style-btn" data-estilo="clean">Wireframe Clean</button>' +
      '</div>' +
      '<div class="preview-site-popover-actions">' +
      '<button type="button" class="btn-followup preview-site-popover-cancel" data-action="preview-cancel">Cancelar</button>' +
      '<button type="button" class="btn-reproc preview-site-popover-send" data-action="preview-send" data-numero="' +
      escAttr(numero) +
      '">Enviar</button>' +
      '</div>'
    toolbar.appendChild(pop)
    pop.querySelector('[data-preview-modelo]')?.focus()
  }

  async function enviarPreviewSiteOperador(numero, modelo, estilo, btn) {
    const htmlOriginal = btn.innerHTML
    closePreviewSitePopover()
    setConversaAcaoLoading(btn, true)
    try {
      const r = await fetch('/api/operador/preview-site', {
        method: 'POST',
        headers: headersComReprocessSecret(),
        body: JSON.stringify({ numero, modelo: modelo || null, estilo: estilo || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || r.statusText)
      setConversaAcaoDone(btn)
      btn.disabled = false
      btn.innerHTML = icoSpan('check')
      window.setTimeout(() => {
        btn.classList.remove('is-done')
        btn.innerHTML = htmlOriginal
      }, 3000)
    } catch (err) {
      alert(err.message || 'Falha ao enviar previa')
      setConversaAcaoLoading(btn, false)
    }
  }

  /**
   * @param {object} extra
   * @param {{ omitInstrucao?: boolean, instrucaoUnica?: string }} [opts]
   */
  function followupPayloadExtra(extra, opts) {
    const o = typeof extra === 'object' && extra !== null ?{ ...extra } : {}
    if (opts && opts.omitInstrucao) return o
    if (opts && typeof opts.instrucaoUnica === 'string' && opts.instrucaoUnica.trim()) {
      o.instrucao = opts.instrucaoUnica.trim()
      return o
    }
    const ins = Core.getFollowupInstrucaoPadrao ?Core.getFollowupInstrucaoPadrao() : ''
    if (ins) o.instrucao = ins
    return o
  }

  const STORAGE_CONVERSAS_ESTAGIO = 'dashboard_conversas_estagio'
  const STORAGE_CONVERSAS_LIMIT = 'dashboard_conversas_limit'
  const STORAGE_CONVERSAS_FILA_PRECO = 'dashboard_conversas_fila_preco'
  const STORAGE_CONVERSAS_PRECO_DIV = 'dashboard_conversas_preco_divergente'
  const STORAGE_CONVERSAS_BUSCA = 'dashboard_conversas_busca'
  const STORAGE_CONVERSAS_MOTIVO = 'dashboard_conversas_motivo'
  const STORAGE_CONVERSAS_TEMPERATURA = 'dashboard_conversas_temperatura'
  const STORAGE_CONVERSAS_DESDE = 'dashboard_conversas_desde'
  const STORAGE_CONVERSAS_ATE = 'dashboard_conversas_ate'
  const STORAGE_CONVERSAS_ORDENAR = 'dashboard_conversas_ordenar'
  const STORAGE_CONVERSAS_DIRECAO = 'dashboard_conversas_direcao'
  const STORAGE_CONVERSAS_ARQUIVADOS = 'dashboard_conversas_arquivados'

  /** Offset da página atual na lista (sincronizado com a API após cada resposta). */
  let conversasListOffset = 0
  let conversasEstagioSelectInicializado = false
  let conversasBusy = false
  let pendingApelidoNumero = ''
  let pendingArchiveNumero = ''
  let pendingArchiveButton = null

  function persistConversasFilters() {
    try {
      const est = (document.getElementById('conversas-estagio')?.value || '').trim()
      sessionStorage.setItem(STORAGE_CONVERSAS_ESTAGIO, est)
      const lim = (document.getElementById('conversas-limit')?.value || '').trim()
      if (lim) sessionStorage.setItem(STORAGE_CONVERSAS_LIMIT, lim)
      const fp = document.getElementById('conversas-fila-preco')
      const pd = document.getElementById('conversas-preco-divergente')
      const arq = document.getElementById('conversas-arquivados')
      sessionStorage.setItem(STORAGE_CONVERSAS_FILA_PRECO, fp && fp.checked ?'1' : '')
      sessionStorage.setItem(STORAGE_CONVERSAS_PRECO_DIV, pd && pd.checked ?'1' : '')
      sessionStorage.setItem(STORAGE_CONVERSAS_ARQUIVADOS, arq && arq.checked ?'1' : '')
      sessionStorage.setItem(STORAGE_CONVERSAS_BUSCA, (document.getElementById('conversas-busca')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_MOTIVO, (document.getElementById('conversas-motivo')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_TEMPERATURA, (document.getElementById('conversas-temperatura')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_DESDE, (document.getElementById('conversas-desde')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_ATE, (document.getElementById('conversas-ate')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_ORDENAR, (document.getElementById('conversas-ordenar')?.value || '').trim())
      sessionStorage.setItem(STORAGE_CONVERSAS_DIRECAO, (document.getElementById('conversas-direcao')?.value || '').trim())
    } catch (_) {}
    atualizarContadorFiltros()
  }

  function restoreConversasLimitFromStorage() {
    try {
      const limSaved = sessionStorage.getItem(STORAGE_CONVERSAS_LIMIT)
      const limEl = document.getElementById('conversas-limit')
      if (limEl && limSaved && [...limEl.options].some((o) => o.value === limSaved)) limEl.value = limSaved
    } catch (_) {}
  }

  function restoreAllFiltersFromStorage() {
    restoreConversasLimitFromStorage()
    try {
      const fields = [
        ['conversas-busca', STORAGE_CONVERSAS_BUSCA],
        ['conversas-motivo', STORAGE_CONVERSAS_MOTIVO],
        ['conversas-temperatura', STORAGE_CONVERSAS_TEMPERATURA],
        ['conversas-desde', STORAGE_CONVERSAS_DESDE],
        ['conversas-ate', STORAGE_CONVERSAS_ATE],
        ['conversas-ordenar', STORAGE_CONVERSAS_ORDENAR],
        ['conversas-direcao', STORAGE_CONVERSAS_DIRECAO],
      ]
      for (const [id, key] of fields) {
        const saved = sessionStorage.getItem(key) || ''
        const el = document.getElementById(id)
        if (!el || !saved) continue
        if (el.tagName === 'SELECT') {
          if ([...el.options].some((o) => o.value === saved)) el.value = saved
        } else {
          el.value = saved
        }
      }
      const fp = document.getElementById('conversas-fila-preco')
      const pd = document.getElementById('conversas-preco-divergente')
      const arq = document.getElementById('conversas-arquivados')
      if (fp) fp.checked = sessionStorage.getItem(STORAGE_CONVERSAS_FILA_PRECO) === '1'
      if (pd) pd.checked = sessionStorage.getItem(STORAGE_CONVERSAS_PRECO_DIV) === '1'
      if (arq) arq.checked = sessionStorage.getItem(STORAGE_CONVERSAS_ARQUIVADOS) === '1'
    } catch (_) {}
    atualizarContadorFiltros()
  }

  function applyFiltersFromUrl() {
    let q
    try {
      q = new URLSearchParams(window.location.search || '')
    } catch (_) {
      return
    }
    if (!q || ![...q.keys()].length) return
    const map = [
      ['busca', 'conversas-busca', STORAGE_CONVERSAS_BUSCA],
      ['motivo', 'conversas-motivo', STORAGE_CONVERSAS_MOTIVO],
      ['temperatura', 'conversas-temperatura', STORAGE_CONVERSAS_TEMPERATURA],
      ['desde', 'conversas-desde', STORAGE_CONVERSAS_DESDE],
      ['ate', 'conversas-ate', STORAGE_CONVERSAS_ATE],
      ['ordenar', 'conversas-ordenar', STORAGE_CONVERSAS_ORDENAR],
      ['direcao', 'conversas-direcao', STORAGE_CONVERSAS_DIRECAO],
      ['limit', 'conversas-limit', STORAGE_CONVERSAS_LIMIT],
    ]
    try {
      for (const [param, id, storageKey] of map) {
        if (!q.has(param)) continue
        const value = (q.get(param) || '').trim()
        sessionStorage.setItem(storageKey, value)
        const el = document.getElementById(id)
        if (!el) continue
        if (el.tagName === 'SELECT') {
          if ([...el.options].some((o) => o.value === value)) el.value = value
        } else {
          el.value = value
        }
      }
      if (q.has('estagio')) sessionStorage.setItem(STORAGE_CONVERSAS_ESTAGIO, (q.get('estagio') || '').trim())
      const checks = [
        ['fila_preco', 'conversas-fila-preco', STORAGE_CONVERSAS_FILA_PRECO],
        ['preco_divergente', 'conversas-preco-divergente', STORAGE_CONVERSAS_PRECO_DIV],
        ['arquivado', 'conversas-arquivados', STORAGE_CONVERSAS_ARQUIVADOS],
      ]
      for (const [param, id, storageKey] of checks) {
        if (!q.has(param)) continue
        const on = ['1', 'true', 'sim'].includes(String(q.get(param) || '').toLowerCase())
        sessionStorage.setItem(storageKey, on ?'1' : '')
        const el = document.getElementById(id)
        if (el) el.checked = on
      }
    } catch (_) {}
    atualizarContadorFiltros()
  }

  function contarFiltrosAtivos() {
    let n = 0
    if ((document.getElementById('conversas-busca')?.value || '').trim()) n++
    if ((document.getElementById('conversas-estagio')?.value || '').trim()) n++
    if ((document.getElementById('conversas-motivo')?.value || '').trim()) n++
    if ((document.getElementById('conversas-temperatura')?.value || '').trim()) n++
    if ((document.getElementById('conversas-desde')?.value || '').trim()) n++
    if ((document.getElementById('conversas-ate')?.value || '').trim()) n++
    if (document.getElementById('conversas-fila-preco')?.checked) n++
    if (document.getElementById('conversas-preco-divergente')?.checked) n++
    const ord = document.getElementById('conversas-ordenar')?.value || 'atualizado'
    const dir = document.getElementById('conversas-direcao')?.value || 'desc'
    if (ord !== 'atualizado' || dir !== 'desc') n++
    return n
  }

  function atualizarContadorFiltros() {
    const el = document.getElementById('filtros-ativos-count')
    const btn = document.getElementById('btn-limpar-filtros')
    const n = contarFiltrosAtivos()
    if (el) el.textContent = n > 0 ?n + ' filtro' + (n > 1 ?'s' : '') + ' ativo' + (n > 1 ?'s' : '') : ''
    if (btn) btn.style.display = n > 0 ?'' : 'none'
  }

  function limparTodosFiltros() {
    const ids = ['conversas-busca', 'conversas-estagio', 'conversas-motivo', 'conversas-temperatura', 'conversas-desde', 'conversas-ate']
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) el.value = ''
    }
    const ord = document.getElementById('conversas-ordenar')
    const dir = document.getElementById('conversas-direcao')
    if (ord) ord.value = 'atualizado'
    if (dir) dir.value = 'desc'
    const fp = document.getElementById('conversas-fila-preco')
    const pd = document.getElementById('conversas-preco-divergente')
    const arq = document.getElementById('conversas-arquivados')
    if (fp) fp.checked = false
    if (pd) pd.checked = false
    if (arq) arq.checked = false
    conversasListOffset = 0
    persistConversasFilters()
    carregarConversas()
  }

  function paramsConversas() {
    const q = new URLSearchParams()
    const limRaw = parseInt(document.getElementById('conversas-limit')?.value, 10) || 100
    const limit = Math.min(500, Math.max(1, limRaw))
    q.set('limit', String(limit))
    q.set('offset', String(Math.max(0, conversasListOffset)))
    const ordenar = (document.getElementById('conversas-ordenar')?.value || 'atualizado').trim()
    const direcao = (document.getElementById('conversas-direcao')?.value || 'desc').trim()
    q.set('ordenar', ordenar)
    q.set('direcao', direcao)
    let est = (document.getElementById('conversas-estagio')?.value || '').trim()
    if (!conversasEstagioSelectInicializado && !est) {
      try {
        est = (sessionStorage.getItem(STORAGE_CONVERSAS_ESTAGIO) || '').trim()
      } catch (_) {}
    }
    if (est) q.set('estagio', est)
    const desde = (document.getElementById('conversas-desde')?.value || '').trim()
    const ate = (document.getElementById('conversas-ate')?.value || '').trim()
    if (desde) q.set('desde', desde)
    if (ate) q.set('ate', ate)
    const fp = document.getElementById('conversas-fila-preco')
    const pd = document.getElementById('conversas-preco-divergente')
    const arq = document.getElementById('conversas-arquivados')
    if (fp && fp.checked) q.set('fila_preco', '1')
    if (pd && pd.checked) q.set('preco_divergente', '1')
    if (arq && arq.checked) q.set('arquivado', '1')

    const busca = (document.getElementById('conversas-busca')?.value || '').trim()
    if (busca) q.set('busca', busca)
    const motivo = (document.getElementById('conversas-motivo')?.value || '').trim()
    if (motivo) q.set('motivo', motivo)
    const temperatura = (document.getElementById('conversas-temperatura')?.value || '').trim()
    if (temperatura) q.set('temperatura', temperatura)

    return q
  }

  function atualizarControlesPaginacao(d) {
    const filtro = d && d.filtro ?d.filtro : {}
    const total = parseInt(filtro.total_filtrado, 10) || 0
    const offset = parseInt(filtro.offset, 10) || 0
    const rows = Array.isArray(d.conversas) ?d.conversas.length : 0
    const rangeEl = document.getElementById('conversas-range-text')
    const prev = document.getElementById('conversas-pagina-prev')
    const next = document.getElementById('conversas-pagina-next')
    if (rangeEl) {
      if (total === 0) {
        rangeEl.textContent = 'Nenhuma conversa neste filtro'
      } else if (rows === 0) {
        rangeEl.textContent = `Nenhum resultado nesta página (total no filtro: ${total})`
      } else {
        const a = offset + 1
        const b = offset + rows
        rangeEl.textContent = `Mostrando ${a}–${b} de ${total}`
      }
    }
    if (prev) prev.disabled = offset <= 0
    if (next) next.disabled = total === 0 || offset + rows >= total
  }

  function setModalOpen(open) {
    document.body.classList.toggle('dash-modal-open', !!open)
  }

  function openApelidoModal(numero, atual, fallbackNome) {
    pendingApelidoNumero = numero || ''
    const modal = document.getElementById('apelido-modal')
    const input = document.getElementById('apelido-modal-input')
    const hint = document.getElementById('apelido-modal-hint')
    const status = document.getElementById('apelido-modal-status')
    if (!modal || !input) return
    input.value = atual || ''
    input.dataset.fallbackNome = fallbackNome || ''
    if (hint) hint.textContent = fallbackNome ?`Nome atual: ${fallbackNome}` : 'Use um nome curto para reconhecer o lead na fila.'
    if (status) status.textContent = ''
    modal.hidden = false
    setModalOpen(true)
    setTimeout(() => input.focus(), 20)
  }

  function closeApelidoModal() {
    const modal = document.getElementById('apelido-modal')
    if (modal) modal.hidden = true
    pendingApelidoNumero = ''
    setModalOpen(!document.getElementById('arquivar-modal')?.hidden || !document.getElementById('followup-modal')?.hidden)
  }

  async function salvarApelidoModal() {
    const input = document.getElementById('apelido-modal-input')
    const status = document.getElementById('apelido-modal-status')
    const btn = document.getElementById('apelido-modal-confirm')
    const numero = pendingApelidoNumero
    const apelido = (input && input.value ?input.value : '').trim()
    if (!numero) return closeApelidoModal()
    if (apelido.length > 80) {
      if (status) status.textContent = 'Use no maximo 80 caracteres.'
      return
    }
    const prev = btn ?btn.textContent : ''
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Salvando...'
    }
    if (status) status.textContent = 'Salvando apelido...'
    try {
      const r = await fetch('/dashboard/apelido', {
        method: 'POST',
        headers: headersComReprocessSecret(),
        body: JSON.stringify({ numero, apelido }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || 'Falha ao salvar apelido')
      closeApelidoModal()
      carregarConversas()
    } catch (err) {
      if (status) status.textContent = err.message || 'Falha ao salvar apelido'
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = prev
      }
    }
  }

  function openArquivarModal(numero, btn) {
    pendingArchiveNumero = numero || ''
    pendingArchiveButton = btn || null
    const modal = document.getElementById('arquivar-modal')
    const motivo = document.getElementById('arquivar-modal-motivo')
    const status = document.getElementById('arquivar-modal-status')
    if (!modal || !motivo) return
    motivo.value = 'fechou_com_outro'
    if (status) status.textContent = ''
    modal.hidden = false
    setModalOpen(true)
    setTimeout(() => motivo.focus(), 20)
  }

  function closeArquivarModal() {
    const modal = document.getElementById('arquivar-modal')
    if (modal) modal.hidden = true
    pendingArchiveNumero = ''
    pendingArchiveButton = null
    setModalOpen(!document.getElementById('apelido-modal')?.hidden || !document.getElementById('followup-modal')?.hidden)
  }

  async function confirmarArquivamentoModal() {
    const numero = pendingArchiveNumero
    const btn = pendingArchiveButton
    const motivoEl = document.getElementById('arquivar-modal-motivo')
    const status = document.getElementById('arquivar-modal-status')
    const confirmBtn = document.getElementById('arquivar-modal-confirm')
    const motivo = (motivoEl && motivoEl.value ?motivoEl.value : 'arquivado_manual').trim()
    if (!numero) return closeArquivarModal()
    const prev = confirmBtn ?confirmBtn.textContent : ''
    if (confirmBtn) {
      confirmBtn.disabled = true
      confirmBtn.textContent = 'Arquivando...'
    }
    if (btn) setConversaAcaoLoading(btn, true)
    if (status) status.textContent = 'Arquivando lead...'
    try {
      const r = await fetch('/dashboard/arquivar', {
        method: 'POST',
        headers: headersComReprocessSecret(),
        body: JSON.stringify({ numero, arquivado: true, motivo }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || 'Falha ao arquivar')
      closeArquivarModal()
      carregarConversas()
    } catch (err) {
      if (status) status.textContent = err.message || 'Falha ao arquivar'
      if (btn) setConversaAcaoLoading(btn, false)
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false
        confirmBtn.textContent = prev
      }
    }
  }

  function setFollowupDashboardBusy(busy, statusText) {
    const st = document.getElementById('followup-lote-status')
    if (st) st.textContent = busy ?statusText || '' : ''
    const elVis = document.getElementById('followup-selecionar-visiveis')
    if (elVis) elVis.disabled = !!busy
    document.querySelectorAll('#lista-conversas .followup-cb').forEach((cb) => {
      cb.disabled = !!busy
    })
    document.querySelectorAll('#lista-conversas .conversa-acao-toolbar button.conversa-acao-btn').forEach((b) => {
      b.disabled = !!busy
    })
    const btnAt = document.getElementById('btn-atualizar-conversas')
    if (btnAt) btnAt.disabled = !!busy
    const btnLote = document.getElementById('btn-followup-lote')
    if (btnLote) btnLote.disabled = !!busy
    ;[
      'conversas-busca',
      'conversas-estagio',
      'conversas-motivo',
      'conversas-temperatura',
      'conversas-desde',
      'conversas-ate',
      'conversas-ordenar',
      'conversas-direcao',
      'conversas-limit',
      'conversas-pagina-prev',
      'conversas-pagina-next',
      'conversas-fila-preco',
      'conversas-preco-divergente',
      'btn-limpar-filtros',
    ].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.disabled = !!busy
    })
  }

  let pollTimer = null
  /** @type {BroadcastChannel | null} */
  let bcChannel = null

  function labelRefreshPref() {
    const p = Core.getConversasRefreshPref ?Core.getConversasRefreshPref() : 10000
    if (p === 'manual') return 'Atualização: somente manual (use “Atualizar agora”)'
    const s = typeof p === 'number' ?p / 1000 : 10
    return `Atualização automática: a cada ${s}s`
  }

  function applyRefreshInterval() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    const el = document.getElementById('conversas-refresh-status')
    if (el) el.textContent = labelRefreshPref()
    const p = Core.getConversasRefreshPref ?Core.getConversasRefreshPref() : 10000
    if (p === 'manual') return
    const ms = typeof p === 'number' && p > 0 ?p : 10000
    pollTimer = setInterval(carregarConversas, ms)
  }

  let pendingFollowupNumero = null
  let pendingFollowupButton = null

  function openFollowupModal(numero, sourceBtn) {
    pendingFollowupNumero = numero
    pendingFollowupButton = sourceBtn
    const root = document.getElementById('followup-modal')
    const ta = document.getElementById('followup-modal-instrucao')
    if (ta) ta.value = ''
    if (root) root.hidden = false
    document.body.classList.add('dash-modal-open')
    ta?.focus()
  }

  function closeFollowupModal() {
    const root = document.getElementById('followup-modal')
    if (root) root.hidden = true
    document.body.classList.remove('dash-modal-open')
    pendingFollowupNumero = null
    pendingFollowupButton = null
  }

  async function carregarConversas() {
    if (conversasBusy) return
    conversasBusy = true
    try {
      const params = paramsConversas()
      params.set('_t', String(Date.now()))
      const r = await fetch('/dashboard/data?' + params.toString(), {
        headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
      })
      const d = await r.json()
      if (r.status === 401) {
        window.location.href = 'login.html'
        return
      }
      if (!r.ok) throw new Error(d.erro || r.statusText)

      const filtro = d.filtro || {}
      if (filtro.offset != null) conversasListOffset = Math.max(0, parseInt(filtro.offset, 10) || 0)

      const selEst = document.getElementById('conversas-estagio')
      if (selEst && Array.isArray(d.estagios_disponiveis) && !conversasEstagioSelectInicializado) {
        selEst.innerHTML =
          '<option value="">Todas</option>' +
          d.estagios_disponiveis
            .map(
              (e) =>
                '<option value="' + escAttr(e) + '">' + escHtml(e) + '</option>'
            )
            .join('')
        conversasEstagioSelectInicializado = true
        const savedEst = (() => {
          try {
            return sessionStorage.getItem(STORAGE_CONVERSAS_ESTAGIO) || ''
          } catch (_) {
            return ''
          }
        })()
        if (savedEst && [...selEst.options].some((o) => o.value === savedEst)) {
          selEst.value = savedEst
        }
        const filtroEst = filtro.estagio != null && filtro.estagio !== '' ?String(filtro.estagio) : ''
        if (savedEst && filtroEst !== savedEst) {
          conversasListOffset = 0
          await carregarConversas()
          return
        }
      }

      const totalFiltrado = parseInt(filtro.total_filtrado, 10) || 0
      const badge = document.getElementById('badge-total')
      if (badge) badge.textContent = String(totalFiltrado)

      atualizarControlesPaginacao(d)

      const lista = document.getElementById('lista-conversas')
      if (!lista) return

      if (!d.conversas || d.conversas.length === 0) {
        lista.innerHTML =
          totalFiltrado > 0
            ?'<div class="vazio">Nenhum resultado nesta página. Tente « Anterior ou outro filtro.</div>'
            : '<div class="vazio">nenhuma conversa ainda</div>'
      } else {
        const rowsHtml = d.conversas
          .map((c) => {
            const num = c.numero.replace('@s.whatsapp.net', '').replace('55', '+55 ')
            const fechado = c.venda_fechada
            const pendente = c.resposta_pendente === true
            const erroResposta = c.erro_resposta_pendente === true
            const agentePausado = c.agente_pausado === true
            const data = new Date(c.atualizado_em).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
            const jidRaw = String(c.numero || '')
            const jid = escAttr(jidRaw)
            const pausadoBit = agentePausado ?'1' : '0'
            const titleAgente = agentePausado
              ?'Reativar agente — religa as respostas automáticas do bot neste contato'
              : 'Pausar agente — desliga as respostas automáticas do bot neste contato'
            const erroResumo = (c.ultima_falha_resposta_msg || '').trim()
            const erroCode = (c.ultima_falha_resposta_codigo || '').trim()
            const erroTitle = erroResumo || erroCode || 'Houve falha no fluxo de resposta automática.'
            const tempRaw = (c.temperatura_lead && String(c.temperatura_lead).toLowerCase()) || ''
            const tempBadge =
              tempRaw === 'quente'
                ?'<span class="estagio-badge temp-quente" title="Temperatura do lead">quente</span>'
                : tempRaw === 'morno'
                  ?'<span class="estagio-badge temp-morno" title="Temperatura do lead">morno</span>'
                  : tempRaw === 'frio'
                    ?'<span class="estagio-badge temp-frio" title="Temperatura do lead">frio</span>'
                    : ''
            const origemAnuncio =
              c.origem_anuncio && typeof c.origem_anuncio === 'object'
                ?(c.origem_anuncio.canal || c.origem_anuncio.campanha || c.origem_anuncio.criativo || '')
                : ''
            const origemBadge = origemAnuncio
              ?'<span class="estagio-badge" title="' + escAttr(origemAnuncio) + '">anuncio</span>'
              : c.origem && c.origem !== 'inbound'
                ?'<span class="estagio-badge" title="Origem do lead">' + escHtml(c.origem) + '</span>'
                : ''
            const produtoBadge = c.produto_sugerido
              ?'<span class="estagio-badge" title="Produto sugerido">' + escHtml(c.produto_sugerido) + '</span>'
              : ''
            const filaPrecoBadge =
              c.lead_fila_preco_sem_calculo === true
                ?'<span class="estagio-badge fila-preco" title="Lead pediu preço na última mensagem e o motor ainda não tem precificação">fila preço</span>'
                : ''
            const divPrecoBadge =
              c.preco_ia_divergente_motor === true
                ?'<span class="estagio-badge preco-div" title="Total de projeto na última resposta da IA ≠ preco_calculado">preço IA ≠ motor</span>'
                : ''
            const followupAutoBadge =
              c.followup_auto_em
                ?'<span class="estagio-badge followup-auto" title="' +
                  escAttr(followupAutoTitle(c.followup_auto_em)) +
                  '">⏰ ' +
                  escHtml(followupAutoLabel(c.followup_auto_minutos)) +
                  '</span>'
                : ''
            const motivos = Array.isArray(c.motivos_prioridade) ?c.motivos_prioridade : []
            const motivosBadges = motivos
              .filter(Boolean)
              .slice(0, 4)
              .map((m) => '<span class="estagio-badge">' + escHtml(m) + '</span>')
              .join('')
            const preview = (c.ultima_preview || '').trim()
            const apelido = (c.apelido || '').trim()
            const negocio = (c.negocio || '').trim()
            const displayName = apelido ?apelido : (negocio || 'Sem perfil comercial')
            const arquivado = c.arquivado === true
            const motivoArquivamento = (c.motivo_arquivamento || '').trim()
            const motivoArquivamentoLabel =
              motivoArquivamento === 'fechou_com_outro'
                ?'já encontrou/fechou com outro'
                : motivoArquivamento === 'sem_prioridade'
                  ?'sem prioridade agora'
                  : motivoArquivamento === 'nao_responde'
                    ?'não responde'
                    : motivoArquivamento
            const titleArquivar = arquivado
              ?'Desarquivar — volta a exibir esta conversa na lista principal'
              : 'Arquivar — oculta da lista principal sem apagar dados'
            const titleExcluir =
              'Excluir permanentemente — apaga lead, histórico da conversa e dados do funil (irreversível)'
            const titleFollowup = 'Follow-up — abre opções e envia mensagem de reengajamento ao contato'
            const titleReprocessar =
              'Reenviar resposta — repete o envio da última resposta automática ao WhatsApp'
            const titlePreview = 'Prévia visual — envia um modelo demonstrativo do site ao contato'
            const titlePerfil = 'Abrir perfil comercial, histórico da conversa e funil deste lead'
            const idade = Core.idadeLabel ?Core.idadeLabel(c.idade_minutos) : data
            return (
              '<tr>' +
              '<td>' +
              '<label class="lead-cb-wrap" title="Incluir no follow-up em lote">' +
              '<input type="checkbox" class="followup-cb" value="' +
              jid +
              '" />' +
              '</label>' +
              '</td>' +
              '<td class="conversa-lead-cell">' +
              '<a class="lead-numero-link" href="perfil-lead.html?numero=' +
              encodeURIComponent(jidRaw) +
              '">' +
              escHtml(num) +
              '</a>' +
              '<strong class="lead-nome-wrap"><span>' +
              escHtml(displayName) +
              '</span><button type="button" class="btn-apelido-edit" data-numero="' +
              jid +
              '" data-atual="' +
              escAttr(apelido) +
              '" data-fallback="' +
              escAttr(negocio) +
              '" title="Editar apelido do lead" aria-label="Editar apelido do lead">' +
              icoSpan('edit') +
              '</button></strong>' +
              '<span class="conversa-muted">' +
              escHtml(c.mensagens) +
              ' msgs · ' +
              escHtml(data) +
              '</span>' +
              '</td>' +
              '<td><div class="conversa-badges">' +
              tempBadge +
              origemBadge +
              produtoBadge +
              filaPrecoBadge +
              divPrecoBadge +
              followupAutoBadge +
              motivosBadges +
              (erroResposta
                ?'<span class="estagio-badge erro-resposta" title="' +
                  escAttr(erroTitle) +
                  '">falha na resposta</span>'
                : '') +
              (pendente ?'<span class="estagio-badge pendente">sem resposta ao cliente</span>' : '') +
              (agentePausado
                ?'<span class="estagio-badge agente-pausado" title="Respostas automáticas desligadas para este número">agente pausado</span>'
                : '') +
              '</div></td>' +
              '<td>' +
              '<span class="estagio-badge ' +
              (fechado ?'fechado' : '') +
              '">' +
              (fechado ?'✓ fechado' : escHtml(c.estagio || 'ativo')) +
              '</span>' +
              (arquivado ?'<span class="estagio-badge fechado conversa-arquivado-badge">arquivado</span>' : '') +
              (arquivado && motivoArquivamentoLabel
                ?'<div class="conversa-muted">Motivo: ' + escHtml(motivoArquivamentoLabel) + '</div>'
                : '') +
              '<div class="conversa-muted">' +
              escHtml(idade) +
              '</div>' +
              '</td>' +
              '<td><div class="conversa-preview">' +
              escHtml(preview || 'Sem prévia disponível.') +
              '</div></td>' +
              '<td><div class="conversa-actions conversa-acao-toolbar">' +
              '<a class="conversa-acao-btn conversa-acao-btn--link conversa-acao-perfil" href="perfil-lead.html?numero=' +
              encodeURIComponent(jidRaw) +
              '" title="' +
              escAttr(titlePerfil) +
              '" aria-label="' +
              escAttr(titlePerfil) +
              '">' +
              icoSpan('user') +
              '</a>' +
              '<button type="button" class="conversa-acao-btn conversa-acao-btn--agente" data-numero="' +
              jid +
              '" data-atual-pausado="' +
              pausadoBit +
              '" title="' +
              escAttr(titleAgente) +
              '" aria-label="' +
              escAttr(titleAgente) +
              '">' +
              icoSpan(agentePausado ?'play' : 'pause') +
              '</button>' +
              '<button type="button" class="conversa-acao-btn conversa-acao-btn--preview" data-numero="' +
              jid +
              '" data-action="preview" title="' +
              escAttr(titlePreview) +
              '" aria-label="' +
              escAttr(titlePreview) +
              '">' +
              icoSpan('preview') +
              '</button>' +
              '<button type="button" class="conversa-acao-btn conversa-acao-btn--arquivar" data-action="arquivar" data-numero="' +
              jid +
              '" data-atual="' +
              (arquivado ?'1' : '0') +
              '" title="' +
              escAttr(titleArquivar) +
              '" aria-label="' +
              escAttr(titleArquivar) +
              '">' +
              icoSpan(arquivado ?'archiveOut' : 'archive') +
              '</button>' +
              '<button type="button" class="conversa-acao-btn conversa-acao-btn--danger" data-action="excluir" data-numero="' +
              jid +
              '" title="' +
              escAttr(titleExcluir) +
              '" aria-label="' +
              escAttr(titleExcluir) +
              '">' +
              icoSpan('trash') +
              '</button>' +
              '<button type="button" class="conversa-acao-btn conversa-acao-btn--followup" data-numero="' +
              jid +
              '" data-action="followup" title="' +
              escAttr(titleFollowup) +
              '" aria-label="' +
              escAttr(titleFollowup) +
              '">' +
              icoSpan('mail') +
              '</button>' +
              (pendente
                ?'<button type="button" class="conversa-acao-btn conversa-acao-btn--reproc" data-numero="' +
                  jid +
                  '" data-action="reprocess" title="' +
                  escAttr(titleReprocessar) +
                  '" aria-label="' +
                  escAttr(titleReprocessar) +
                  '">' +
                  icoSpan('refresh') +
                  '</button>'
                : '') +
              '</div></td>' +
              '</tr>'
            )
          })
          .join('')
        lista.innerHTML =
          '<div class="conversas-table-wrap"><table class="conversas-table">' +
          '<thead><tr><th></th><th>Lead</th><th>Motivo</th><th>Etapa</th><th>Última mensagem</th><th>Ações</th></tr></thead>' +
          '<tbody>' +
          rowsHtml +
          '</tbody></table></div>'
        const selVis = document.getElementById('followup-selecionar-visiveis')
        if (selVis) selVis.checked = false
      }

      const atualizado = document.getElementById('atualizado-conversas')
      if (atualizado) {
        atualizado.textContent = 'última atualização: ' + new Date().toLocaleTimeString('pt-BR')
      }
    } catch (e) {
      console.error(e)
      const rangeEl = document.getElementById('conversas-range-text')
      if (rangeEl) rangeEl.textContent = 'Erro ao carregar (veja o console)'
    } finally {
      conversasBusy = false
    }
  }

  let searchDebounceTimer = null
  function onSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      conversasListOffset = 0
      persistConversasFilters()
      carregarConversas()
    }, 400)
  }

  document.addEventListener('DOMContentLoaded', () => {
    restoreAllFiltersFromStorage()
    applyFiltersFromUrl()
    applyRefreshInterval()

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bcChannel = new BroadcastChannel('pj-dashboard')
        bcChannel.onmessage = (ev) => {
          if (ev && ev.data && ev.data.type === 'conversas-refresh') applyRefreshInterval()
        }
      }
    } catch (_) {}

    window.addEventListener('storage', (e) => {
      if (e.key === (Core.PJ_CONVERSAS_REFRESH_KEY || 'pj_conversas_refresh_ms')) applyRefreshInterval()
    })

    const triggerRefresh = () => {
      conversasListOffset = 0
      persistConversasFilters()
      carregarConversas()
    }

    document.getElementById('conversas-busca')?.addEventListener('input', onSearchInput)
    document.getElementById('conversas-estagio')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-motivo')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-temperatura')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-desde')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-ate')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-ordenar')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-direcao')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-limit')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-fila-preco')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-preco-divergente')?.addEventListener('change', triggerRefresh)
    document.getElementById('conversas-arquivados')?.addEventListener('change', triggerRefresh)
    document.getElementById('btn-limpar-filtros')?.addEventListener('click', limparTodosFiltros)

    document.getElementById('conversas-pagina-prev')?.addEventListener('click', () => {
      const limRaw = parseInt(document.getElementById('conversas-limit')?.value, 10) || 100
      const lim = Math.min(500, Math.max(1, limRaw))
      conversasListOffset = Math.max(0, conversasListOffset - lim)
      carregarConversas()
    })
    document.getElementById('conversas-pagina-next')?.addEventListener('click', () => {
      const limRaw = parseInt(document.getElementById('conversas-limit')?.value, 10) || 100
      const lim = Math.min(500, Math.max(1, limRaw))
      conversasListOffset += lim
      carregarConversas()
    })

    document.getElementById('btn-atualizar-conversas')?.addEventListener('click', () => {
      carregarConversas()
    })

    document.getElementById('followup-selecionar-visiveis')?.addEventListener('change', (e) => {
      const on = e.target.checked
      document.querySelectorAll('#lista-conversas input.followup-cb').forEach((cb) => {
        cb.checked = on
      })
    })

    document.getElementById('btn-followup-lote')?.addEventListener('click', async () => {
      const numeros = [...document.querySelectorAll('#lista-conversas input.followup-cb:checked')]
        .map((cb) => (cb.value || '').trim())
        .filter(Boolean)
      if (numeros.length === 0) {
        alert('Selecione ao menos um contato (checkbox) ou use “Selecionar visíveis”.')
        return
      }
      const btn = document.getElementById('btn-followup-lote')
      const prev = btn.textContent
      setFollowupDashboardBusy(true, `Enviando lote (${numeros.length} contatos)…`)
      try {
        const r = await fetch('/dashboard/followup', {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify(followupPayloadExtra({ numeros })),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        const head =
          j.resumo != null ?`Enviados: ${j.resumo.enviados} · Falhas: ${j.resumo.falhas}` : ''
        const lines = (j.resultados || []).map((row) =>
          row.ok ?`✓ ${row.numero}` : `✗ ${row.numero}: ${row.erro}`
        )
        alert([head, ...lines].filter(Boolean).join('\n'))
        carregarConversas()
      } catch (err) {
        alert(err.message || 'Falha no follow-up em lote')
      } finally {
        setFollowupDashboardBusy(false)
        btn.textContent = prev
      }
    })

    document.getElementById('followup-modal-cancel')?.addEventListener('click', () => {
      closeFollowupModal()
    })
    document.querySelector('[data-modal-close]')?.addEventListener('click', () => {
      closeFollowupModal()
    })
    document.querySelectorAll('[data-apelido-modal-close]').forEach((el) => el.addEventListener('click', closeApelidoModal))
    document.getElementById('apelido-modal-confirm')?.addEventListener('click', salvarApelidoModal)
    document.getElementById('apelido-modal-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        salvarApelidoModal()
      }
    })
    document.querySelectorAll('[data-arquivar-modal-close]').forEach((el) => el.addEventListener('click', closeArquivarModal))
    document.getElementById('arquivar-modal-confirm')?.addEventListener('click', confirmarArquivamentoModal)
    document.getElementById('followup-modal-confirm')?.addEventListener('click', async () => {
      const numero = pendingFollowupNumero
      const btn = pendingFollowupButton
      const ta = document.getElementById('followup-modal-instrucao')
      const texto = (ta && ta.value ?ta.value : '').trim()
      if (!numero) {
        closeFollowupModal()
        return
      }
      const opts = texto ?{ instrucaoUnica: texto } : { omitInstrucao: true }
      const confirmBtn = document.getElementById('followup-modal-confirm')
      const prevConfirm = confirmBtn ?confirmBtn.textContent : ''
      if (confirmBtn) {
        confirmBtn.disabled = true
        confirmBtn.textContent = 'Enviando…'
      }
      setFollowupDashboardBusy(true, 'Enviando follow-up…')
      if (btn) setConversaAcaoLoading(btn, true)
      try {
        const r = await fetch('/dashboard/followup', {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify(followupPayloadExtra({ numero }, opts)),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        if (btn) setConversaAcaoDone(btn)
        closeFollowupModal()
        carregarConversas()
      } catch (err) {
        alert(err.message || 'Falha no follow-up')
        if (btn) setConversaAcaoLoading(btn, false)
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false
          confirmBtn.textContent = prevConfirm
        }
        setFollowupDashboardBusy(false)
      }
    })

    document.addEventListener('keydown', (e) => {
      const root = document.getElementById('followup-modal')
      if (e.key === 'Escape') {
        const apelidoModal = document.getElementById('apelido-modal')
        const arquivarModal = document.getElementById('arquivar-modal')
        if (apelidoModal && !apelidoModal.hidden) {
          e.preventDefault()
          closeApelidoModal()
          return
        }
        if (arquivarModal && !arquivarModal.hidden) {
          e.preventDefault()
          closeArquivarModal()
          return
        }
        if (root && !root.hidden) {
          e.preventDefault()
          closeFollowupModal()
        }
      }
    })

    document.getElementById('lista-conversas').addEventListener('click', async (e) => {
      const btnPausar = e.target.closest('.conversa-acao-btn--agente')
      if (btnPausar && btnPausar.dataset.numero) {
        const numero = btnPausar.dataset.numero
        const atualPausado = btnPausar.dataset.atualPausado === '1'
        const novoPausado = !atualPausado
        setConversaAcaoLoading(btnPausar, true)
        try {
          const r = await fetch('/dashboard/agente-pausar', {
            method: 'POST',
            headers: headersComReprocessSecret(),
            body: JSON.stringify({ numero, pausado: novoPausado }),
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(j.erro || r.statusText)
          carregarConversas()
        } catch (err) {
          alert(err.message || 'Falha ao alterar pausa do agente')
          setConversaAcaoLoading(btnPausar, false)
        }
        return
      }

      const btnFu = e.target.closest('.conversa-acao-btn[data-action="followup"]')
      if (btnFu && btnFu.dataset.numero) {
        e.preventDefault()
        openFollowupModal(btnFu.dataset.numero, btnFu)
        return
      }

      const btnPreview = e.target.closest('.conversa-acao-btn[data-action="preview"]')
      if (btnPreview && btnPreview.dataset.numero) {
        e.preventDefault()
        openPreviewSitePopover(btnPreview.dataset.numero, btnPreview)
        return
      }

      const btnPreviewCancel = e.target.closest('[data-action="preview-cancel"]')
      if (btnPreviewCancel) {
        e.preventDefault()
        closePreviewSitePopover()
        return
      }

      const btnPreviewEstilo = e.target.closest('.preview-site-style-btn')
      if (btnPreviewEstilo) {
        e.preventDefault()
        const pop = btnPreviewEstilo.closest('.preview-site-popover')
        pop?.querySelectorAll('.preview-site-style-btn').forEach((b) => b.classList.remove('is-selected'))
        btnPreviewEstilo.classList.add('is-selected')
        return
      }

      const btnPreviewSend = e.target.closest('[data-action="preview-send"]')
      if (btnPreviewSend && btnPreviewSend.dataset.numero) {
        e.preventDefault()
        const pop = btnPreviewSend.closest('.preview-site-popover')
        const modelo = pop?.querySelector('[data-preview-modelo]')?.value || ''
        const estilo = pop?.querySelector('.preview-site-style-btn.is-selected')?.dataset.estilo || ''
        const btnOrigem = [...(pop?.parentElement?.querySelectorAll('.conversa-acao-btn[data-action="preview"]') || [])]
          .find((b) => b.dataset.numero === btnPreviewSend.dataset.numero)
        await enviarPreviewSiteOperador(btnPreviewSend.dataset.numero, modelo, estilo, btnOrigem || btnPreviewSend)
        return
      }

      const btnApelido = e.target.closest('.btn-apelido-edit')
      if (btnApelido && btnApelido.dataset.numero) {
        e.preventDefault()
        const numero = btnApelido.dataset.numero
        const atual = btnApelido.dataset.atual || ''
        const fallback = btnApelido.dataset.fallback || ''
        openApelidoModal(numero, atual, fallback)
        return
      }

      const btnAcao = e.target.closest('[data-action]')
      if (btnAcao && btnAcao.dataset.numero) {
        const action = btnAcao.dataset.action
        const numero = btnAcao.dataset.numero

        if (action === 'arquivar') {
          e.preventDefault()
          const isArquivado = btnAcao.dataset.atual === '1'
          const novoEstado = !isArquivado
          if (novoEstado) {
            openArquivarModal(numero, btnAcao)
            return
          }
          try {
            setConversaAcaoLoading(btnAcao, true)
            const r = await fetch('/dashboard/arquivar', {
              method: 'POST',
              headers: headersComReprocessSecret(),
              body: JSON.stringify({ numero, arquivado: novoEstado }),
            })
            if (!r.ok) throw new Error('Falha ao arquivar')
            carregarConversas()
          } catch (err) {
            alert(err.message)
            setConversaAcaoLoading(btnAcao, false)
          }
          return
        }

        if (action === 'excluir') {
          e.preventDefault()
          if (!confirm('TEM CERTEZA? Isso excluirá permanentemente o lead, o histórico da conversa e os dados do funil. Esta ação não pode ser desfeita.')) {
            return
          }
          try {
            setConversaAcaoLoading(btnAcao, true)
            const r = await fetch('/dashboard/conversas', {
              method: 'DELETE',
              headers: headersComReprocessSecret(),
              body: JSON.stringify({ numero }),
            })
            if (!r.ok) throw new Error('Falha ao excluir conversa')
            carregarConversas()
          } catch (err) {
            alert(err.message)
            setConversaAcaoLoading(btnAcao, false)
          }
          return
        }
      }

      const btn = e.target.closest('.conversa-acao-btn[data-action="reprocess"]')
      if (!btn || !btn.dataset.numero) return
      const numero = btn.dataset.numero
      const url = '/dashboard/reprocessar'
      const errMsg = 'Falha ao reprocessar'
      setConversaAcaoLoading(btn, true)
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: headersComReprocessSecret(),
          body: JSON.stringify({ numero }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        setConversaAcaoDone(btn)
        carregarConversas()
      } catch (err) {
        alert(err.message || errMsg)
        setConversaAcaoLoading(btn, false)
      }
    })

    carregarConversas()
  })
})()
