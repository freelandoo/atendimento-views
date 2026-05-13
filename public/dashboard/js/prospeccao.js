;(function () {
  const Core = window.DashboardCore || {}
  let prospectsBase = []
  let prospectsAtuais = []
  let selecionados = new Set()
  let modoAtual = 'manual'
  let editProspectId = null
  let paginaProspects = 1
  let itensPorPaginaProspects = 15

  function $(id) { return document.getElementById(id) }
  function esc(s) { return Core.escHtml ?Core.escHtml(s) : String(s == null ?'' : s) }
  function headersJson() { return Core.headersComReprocessSecret ?Core.headersComReprocessSecret(true) : { 'Content-Type': 'application/json' } }
  function toast(msg, tipo) { if (Core.toast) Core.toast(msg, tipo || 'info') }
  async function apiJson(url, opts) { return Core.fetchJson ?Core.fetchJson(url, opts) : fetch(url, opts).then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) })) }

  const modoCopy = {
    manual: {
      titulo: 'Modo manual',
      descricao: 'Busque empresas agora e decida manualmente quais prospects avançam para diagnóstico, aprovação e envio.',
      status: 'Informe nicho e cidade para buscar empresas locais no Google Places.',
    },
    semi_automatico: {
      titulo: 'Modo semi-automático',
      descricao: 'Informe nicho e cidade uma vez; o painel busca empresas e enfileira diagnóstico, aprovação e envio.',
      status: 'Informe nicho e cidade para iniciar o fluxo completo de prospecção.',
    },
    automatico: {
      titulo: 'Modo automático',
      descricao: 'Configure horário e intervalo de envios. A IA escolhe o nicho (ranking), agenda mensagens na grade comercial (ex.: a cada 15 min) e você acompanha na lista quem receberá e quando.',
      status: 'Veja a prévia de nicho/cidade abaixo; agendamentos nos cards são para monitoramento.',
    },
  }

  function formatarHorario(iso) {
    const d = new Date(iso)
    if (!iso || !Number.isFinite(d.getTime())) return ''
    const hoje = new Date()
    const amanha = new Date(hoje)
    amanha.setDate(hoje.getDate() + 1)
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    if (d.toDateString() === hoje.toDateString()) return `hoje as ${hora}`
    if (d.toDateString() === amanha.toDateString()) return `amanha as ${hora}`
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} as ${hora}`
  }

  function envioAgendadoAtrasado(prospect) {
    const agendadoPara = prospect?.diagnostico?.agendado_para
    if (!agendadoPara || prospect?.status !== 'aprovado') return false
    const dt = new Date(agendadoPara)
    if (!Number.isFinite(dt.getTime())) return false
    return dt.getTime() < Date.now()
  }

  function setStatus(texto, erro) {
    const el = $('prospect-status')
    if (!el) return
    el.textContent = texto || ''
    el.classList.toggle('config-status-erro', !!erro)
  }

  function setBusy(busy) {
    ;['prospect-btn-buscar', 'prospect-auto-salvar', 'prospect-auto-rodar', 'prospect-auto-atualizar', 'prospect-semi-btn'].forEach((id) => {
      const el = $(id)
      if (el) el.disabled = !!busy
    })
    document.body.classList.toggle('prospect-is-busy', !!busy)
  }

  function normalizarTexto(valor) {
    return String(valor == null ?'' : valor)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  }

  function textoProspect(p) {
    const diag = p?.diagnostico || {}
    return [
      p?.nome,
      p?.telefone,
      p?.endereco,
      p?.nicho,
      p?.cidade,
      p?.local,
      p?.status,
      diag.mensagem_editada,
      diag.mensagem_gerada,
    ].join(' ')
  }

  function filtrosProspects() {
    return {
      status: normalizarTexto($('prospect-filtro-status')?.value || ''),
      nicho: normalizarTexto($('prospect-filtro-nicho')?.value || ''),
      cidade: normalizarTexto($('prospect-filtro-cidade')?.value || ''),
      busca: normalizarTexto($('prospect-filtro-busca')?.value || ''),
    }
  }

  function aplicarFiltrosProspects(opts) {
    const filtros = filtrosProspects()
    const lista = prospectsBase.filter((p) => {
      const status = normalizarTexto(p?.status || 'aguardando')
      const nicho = normalizarTexto(p?.nicho || p?.categoria || '')
      const cidade = normalizarTexto(p?.cidade || p?.local || p?.endereco || '')
      const texto = normalizarTexto(textoProspect(p))
      if (filtros.status && status !== filtros.status) return false
      if (filtros.nicho && !nicho.includes(filtros.nicho) && !texto.includes(filtros.nicho)) return false
      if (filtros.cidade && !cidade.includes(filtros.cidade) && !texto.includes(filtros.cidade)) return false
      if (filtros.busca && !texto.includes(filtros.busca)) return false
      return true
    })
    renderProspects(lista, Object.assign({ origemFiltro: true }, opts || {}))
  }

  function aplicarModo(modo) {
    modoAtual = ['manual', 'semi_automatico', 'automatico'].includes(modo) ?modo : 'manual'
    const copy = modoCopy[modoAtual] || modoCopy.manual
    $('prospect-modo-manual')?.classList.toggle('is-active', modoAtual === 'manual')
    $('prospect-modo-semi')?.classList.toggle('is-active', modoAtual === 'semi_automatico')
    $('prospect-modo-auto')?.classList.toggle('is-active', modoAtual === 'automatico')
    if ($('prospect-mode-title')) $('prospect-mode-title').textContent = copy.titulo
    if ($('prospect-mode-desc')) $('prospect-mode-desc').textContent = copy.descricao
    setStatus(copy.status)
    if ($('prospect-manual-form')) $('prospect-manual-form').hidden = modoAtual !== 'manual'
    if ($('prospect-semi-card')) $('prospect-semi-card').hidden = modoAtual !== 'semi_automatico'
    if ($('prospect-auto-card')) $('prospect-auto-card').hidden = modoAtual !== 'automatico'
    if (modoAtual !== 'automatico' && $('prospect-auto-planejamento')) $('prospect-auto-planejamento').hidden = true
  }

  function lerAutoConfigForm() {
    const wd = Number($('prospect-auto-weekday')?.value || 7)
    return {
      enabled: $('prospect-auto-enabled')?.value === 'true',
      modo: modoAtual,
      rodada_diaria: wd === 7,
      weekday: wd === 7 ?1 : wd,
      hour: Number($('prospect-auto-hour')?.value || 9),
      minute: Number($('prospect-auto-minute')?.value || 0),
      limit: Number($('prospect-auto-limit')?.value || 40),
      intervalo_envio_minutos: Number($('prospect-auto-intervalo')?.value || 30),
      categoria: $('prospect-auto-categoria')?.value.trim() || null,
    }
  }

  function aplicarPlanejamentoBusca(planejamento) {
    const root = $('prospect-auto-planejamento')
    const nota = $('prospect-auto-planejamento-nota')
    const lista = $('prospect-auto-planejamento-lista')
    if (!root || !lista) return
    if (modoAtual !== 'automatico') {
      root.hidden = true
      return
    }
    root.hidden = false
    const p = planejamento || {}
    const itens = Array.isArray(p.itens) ?p.itens : []
    if (nota) {
      nota.textContent =
        'Prévia com base no ranking atual de nichos (muda após sincronização). Envios aparecem nos cards para acompanhamento.'
    }
    if (!itens.length) {
      lista.innerHTML =
        '<li class="prospect-auto-planejamento-empty">Nenhum nicho ranqueado ainda. A rotina sincroniza a partir das conversas de vendas; você pode usar &quot;Rodar agora&quot; após ter dados.</li>'
      return
    }
    lista.innerHTML = itens
      .map((i) => `<li>${esc(i.nicho || '')} <span class="prospect-auto-planejamento-sep">—</span> ${esc(i.cidade || '')}</li>`)
      .join('')
  }

  function aplicarResumoAutoConfig(cfg, agenda) {
    const resumo = $('prospect-auto-resumo')
    if (!resumo) return
    if (!cfg || !cfg.enabled || cfg.modo !== 'automatico') { resumo.hidden = true; return }
    const hora = String(cfg.hour || 9).padStart(2, '0')
    const min = String(cfg.minute || 0).padStart(2, '0')
    const agendaEl = $('prospect-auto-resumo-agenda')
    const janelaEl = $('prospect-auto-resumo-janela')
    const ultimoEl = $('prospect-auto-resumo-ultimo')
    if (cfg.rodada_diaria) {
      if (agendaEl) agendaEl.textContent = `Todo dia às ${hora}:${min} — meta: ${cfg.limit || 40} prospects/semana`
      if (janelaEl) {
        const enviados = cfg.weekly_sent || 0
        const limite = cfg.limit || 40
        janelaEl.textContent = `Enviados esta semana: ${enviados} de ${limite}`
      }
    } else {
      const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
      const dia = dias[cfg.weekday || 1] || 'Seg'
      if (agendaEl) agendaEl.textContent = `${dia} às ${hora}:${min} — limite: ${cfg.limit || 40}`
      if (janelaEl && agenda) janelaEl.textContent = agenda.dentro_da_janela_enfileiramento ?'Dentro da janela de execução' : 'Aguardando janela'
    }
    if (ultimoEl && cfg.last_enqueued_at) ultimoEl.textContent = `Último enfileiramento: ${formatarHorario(cfg.last_enqueued_at)}`
    resumo.hidden = false
  }

  function aplicarAutoConfigForm(cfg, agenda, planejamento) {
    const safe = cfg || {}
    if ($('prospect-auto-enabled')) $('prospect-auto-enabled').value = String(!!safe.enabled)
    if ($('prospect-auto-weekday')) $('prospect-auto-weekday').value = String(safe.rodada_diaria !== false ? 7 : (safe.weekday || 1))
    if ($('prospect-auto-hour')) $('prospect-auto-hour').value = String(safe.hour || 9)
    if ($('prospect-auto-minute')) $('prospect-auto-minute').value = String(safe.minute || 0)
    if ($('prospect-auto-limit')) $('prospect-auto-limit').value = String(safe.limit || 40)
    if ($('prospect-auto-intervalo')) $('prospect-auto-intervalo').value = String(safe.intervalo_envio_minutos || 30)
    if ($('prospect-auto-categoria')) $('prospect-auto-categoria').value = safe.categoria || ''
    aplicarModo(safe.modo || 'manual')
    aplicarResumoAutoConfig(safe, agenda)
    aplicarPlanejamentoBusca(planejamento)
  }

  async function carregarAutoConfig() {
    const r = await apiJson('/dashboard/prospeccao/auto-config', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) {
      aplicarModo('manual')
      toast(r.erro || 'Falha ao carregar configuração.', 'erro')
      return false
    }
    aplicarAutoConfigForm(r.data?.config || {}, r.data?.agenda || null, r.data?.planejamento_busca || null)
    return true
  }

  async function salvarAutoConfig() {
    const r = await apiJson('/dashboard/prospeccao/auto-config', { method: 'PUT', headers: headersJson(), body: JSON.stringify(lerAutoConfigForm()) })
    if (!r.ok) return toast(r.erro || 'Falha ao salvar configuração.', 'erro')
    aplicarAutoConfigForm(r.data?.config || {}, r.data?.agenda || null, r.data?.planejamento_busca || null)
    toast('Configuração salva.', 'sucesso')
  }

  async function carregarJobsStatus() {
    const bar = $('prospect-jobs-bar')
    const text = $('prospect-jobs-bar-text')
    if (!bar || !text) return
    const r = await apiJson('/dashboard/prospeccao/jobs/status', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) return
    const d = r.data || {}
    const pend = Number(d.pendentes || 0)
    const proc = Number(d.processando || 0)
    const falhas = Number(d.falhas_recentes || 0)
    text.textContent = `Jobs: ${pend} em fila • ${proc} processando • falhas: ${falhas}`
  }

  function prospectArticleHtml(p) {
    const diag = p.diagnostico || null
    const msgDiag = diag ?(diag.mensagem_editada || diag.mensagem_gerada || '') : ''
    const agendadoPara = diag?.agendado_para
    const atrasado = envioAgendadoAtrasado(p)
    const id = String(p.id || '')
    const nome = p.nome || 'Empresa'
    const inicial = normalizarTexto(nome).charAt(0).toUpperCase() || 'P'
    const origem = p.origem === 'automatico' ?'automatico' : (p.origem === 'semi_automatico' ?'semi' : 'manual')
    const origemLabel = origem === 'automatico' ?'Automático' : (origem === 'semi' ?'Semi-auto' : 'Manual')
    const statusLabelMap = {
      aguardando: 'Pendente',
      aprovado: 'Aprovado',
      rejeitado: 'Rejeitado',
      enviado: 'Enviado',
      respondeu: 'Respondeu',
    }
    const status = p.status || 'aguardando'
    const statusLabel = statusLabelMap[status] || status
    const agendadoLabel = agendadoPara && p.status === 'aprovado'
      ?`<span class="prospecting-agendado">Envio agendado: ${esc(formatarHorario(agendadoPara))}</span>`
      : ''
    const botaoForcarEnvio = atrasado
      ?`<button type="button" class="btn-reproc" data-prospect-action="forcar-envio" data-prospect-id="${esc(id)}">Forçar envio</button>`
      : ''
    const checked = selecionados.has(id) ?' checked' : ''
    const badgeOrigem = `<span class="prospecting-origem-${esc(origem)}" title="Modo de origem do prospect">${esc(origemLabel)}</span>`
    return (
      '<article class="prospecting-result-item">' +
      `<label class="prospecting-select"><input type="checkbox" data-prospect-select="${esc(id)}"${checked} />Selecionar</label>` +
      '<div class="prospecting-result-main">' +
      `<span class="prospect-avatar" aria-hidden="true">${esc(inicial)}</span>` +
      '<div class="prospect-main-copy">' +
      `<div class="prospecting-result-title-row"><strong>${esc(nome)}</strong>${badgeOrigem}</div>` +
      `<span>${esc(p.endereco || '-')}</span>` +
      '</div></div>' +
      `<div class="prospecting-result-meta"><span><b>${esc(p.score || '-')}</b> score</span><span class="prospecting-status prospecting-status-${esc(status)}">${esc(statusLabel)}</span>${agendadoLabel}</div>` +
      '<div class="prospecting-result-actions">' +
      `<button type="button" class="btn-followup" data-prospect-action="diagnosticar" data-prospect-id="${esc(id)}">Gerar diagnóstico</button>` +
      `<button type="button" class="btn-followup" data-prospect-action="editar-msg" data-prospect-id="${esc(id)}"${diag ?'' : ' disabled'}>Editar mensagem</button>` +
      `<button type="button" class="btn-followup" data-prospect-action="aprovar" data-prospect-id="${esc(id)}">Aprovar</button>` +
      botaoForcarEnvio +
      `<button type="button" class="btn-danger" data-prospect-action="rejeitar" data-prospect-id="${esc(id)}">Rejeitar</button>` +
      `<button type="button" class="btn-followup" data-prospect-action="detalhes" data-prospect-id="${esc(id)}">Expandir detalhes</button>` +
      '</div>' +
      `<p class="prospecting-result-reason"><b>Mensagem:</b> ${esc(msgDiag || '-')}</p>` +
      '</article>'
    )
  }

  function renderProspectsPagina() {
    const root = $('prospect-results')
    const nav = $('prospect-pagination')
    if (!root) return
    const total = prospectsAtuais.length
    if ($('prospect-total')) $('prospect-total').textContent = String(total)
    if (!total) {
      root.innerHTML = '<div class="empty-state"><strong>Nenhum prospect encontrado</strong></div>'
      if (nav) {
        nav.innerHTML = ''
        nav.hidden = true
      }
      return
    }
    const totalPages = Math.max(1, Math.ceil(total / itensPorPaginaProspects))
    if (paginaProspects > totalPages) paginaProspects = totalPages
    if (paginaProspects < 1) paginaProspects = 1
    const start = (paginaProspects - 1) * itensPorPaginaProspects
    const slice = prospectsAtuais.slice(start, start + itensPorPaginaProspects)
    root.innerHTML = slice.map(prospectArticleHtml).join('')
    bindAcoesProspects(root)
    if (!nav) return
    const end = start + slice.length
    nav.hidden = false
    const sizeOpts = [10, 15, 20, 30, 50]
      .map((n) => `<option value="${n}"${n === itensPorPaginaProspects ?' selected' : ''}>${n}</option>`)
      .join('')
    nav.innerHTML =
      '<div class="prospect-pagination-inner">' +
      `<span class="prospect-pagination-meta">Mostrando <strong>${start + 1}</strong>–<strong>${end}</strong> de <strong>${total}</strong> · página <strong>${paginaProspects}</strong> de <strong>${totalPages}</strong></span>` +
      '<div class="prospect-pagination-controls">' +
      '<label for="prospect-page-size">Por página <select id="prospect-page-size">' +
      sizeOpts +
      '</select></label>' +
      `<button type="button" class="btn-followup" id="prospect-page-prev"${paginaProspects <= 1 ?' disabled' : ''}>Anterior</button>` +
      `<button type="button" class="btn-followup" id="prospect-page-next"${paginaProspects >= totalPages ?' disabled' : ''}>Próxima</button>` +
      '</div></div>'
    $('prospect-page-prev')?.addEventListener('click', () => {
      if (paginaProspects > 1) {
        paginaProspects -= 1
        renderProspectsPagina()
      }
    })
    $('prospect-page-next')?.addEventListener('click', () => {
      if (paginaProspects < totalPages) {
        paginaProspects += 1
        renderProspectsPagina()
      }
    })
    $('prospect-page-size')?.addEventListener('change', (e) => {
      const v = Number(e.target && e.target.value)
      if (Number.isFinite(v) && v >= 5 && v <= 100) {
        itensPorPaginaProspects = v
        paginaProspects = 1
        renderProspectsPagina()
      }
    })
  }

  function renderProspects(lista, opts) {
    opts = opts || {}
    const root = $('prospect-results')
    if (!root) return
    prospectsAtuais = Array.isArray(lista) ?lista : []
    if (!opts.origemFiltro) prospectsBase = prospectsAtuais.slice()
    if (!opts.manterPagina) paginaProspects = 1
    renderProspectsPagina()
  }

  function atualizarTotaisSelecao() {
    if ($('prospect-lote-status')) $('prospect-lote-status').textContent = `${selecionados.size} selecionado(s)`
  }

  function selecionarTodosVisiveis() {
    if (!prospectsAtuais.length) return toast('Nenhum prospect na lista para selecionar.', 'info')
    for (const p of prospectsAtuais) {
      if (p.id) selecionados.add(String(p.id))
    }
    renderProspectsPagina()
    atualizarTotaisSelecao()
  }

  async function carregarProspects() {
    const r = await apiJson('/dashboard/prospeccao/prospects?limit=120', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) return setStatus(r.erro || 'Falha ao carregar prospects.', true)
    prospectsBase = Array.isArray(r.data?.prospects) ?r.data.prospects : []
    aplicarFiltrosProspects()
  }

  async function carregarMetricas() {
    const r = await apiJson('/dashboard/prospeccao/metricas', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) return
    const m = r.data?.metricas || {}
    $('prospect-metrica-aprovados') && ($('prospect-metrica-aprovados').textContent = String(m.totals?.aprovado || 0))
    $('prospect-metrica-enviados') && ($('prospect-metrica-enviados').textContent = String(m.totals?.enviado || 0))
    $('prospect-metrica-respondeu') && ($('prospect-metrica-respondeu').textContent = String(m.totals?.respondeu || 0))
    $('prospect-metrica-taxa') && ($('prospect-metrica-taxa').textContent = `${Number(m.taxa_resposta || 0) * 100}%`)
  }

  async function pesquisar(evt) {
    evt.preventDefault()
    const nicho = $('prospect-nicho')?.value.trim() || ''
    const local = $('prospect-local')?.value.trim() || ''
    const quantidade = $('prospect-quantidade')?.value || '10'
    if (!nicho || !local) return toast('Informe nicho e cidade/região.', 'erro')
    setBusy(true)
    const r = await apiJson('/dashboard/prospeccao/places-search', { method: 'POST', headers: headersJson(), body: JSON.stringify({ nicho, local, quantidade }) })
    setBusy(false)
    if (!r.ok) return toast(r.erro || 'Falha ao pesquisar.', 'erro')
    prospectsBase = Array.isArray(r.data?.prospects) ?r.data.prospects : []
    aplicarFiltrosProspects()
    toast('Busca concluída.', 'sucesso')
  }

  async function iniciarSemiAutomatico(evt) {
    evt.preventDefault()
    const nicho = $('prospect-semi-nicho')?.value.trim() || ''
    const local = $('prospect-semi-local')?.value.trim() || ''
    const quantidade = $('prospect-semi-quantidade')?.value || '10'
    const progresso = $('prospect-semi-progresso')
    if (!nicho || !local) return toast('Preencha nicho e cidade.', 'erro')
    if (progresso) progresso.textContent = 'Buscando e enfileirando...'
    const r = await apiJson('/dashboard/prospeccao/places-search-completo', { method: 'POST', headers: headersJson(), body: JSON.stringify({ nicho, local, quantidade }) })
    if (!r.ok) return toast(r.erro || 'Falha no fluxo semi-automático.', 'erro')
    if (progresso) progresso.textContent = `Encontrados: ${Number(r.data?.prospects_encontrados || 0)}. Processando jobs...`
    for (let i = 0; i < 12; i += 1) {
      await apiJson('/dashboard/prospeccao/jobs/consumir', { method: 'POST', headers: headersJson(), body: JSON.stringify({ limit: 8 }) })
      await carregarJobsStatus()
      const s = await apiJson('/dashboard/prospeccao/jobs/status', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
      if (s.ok && Number(s.data?.pendentes || 0) === 0 && Number(s.data?.processando || 0) === 0) break
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    if (progresso) progresso.textContent = 'Fluxo concluído.'
    await carregarProspects()
    await carregarMetricas()
    toast('Semi-automático concluído.', 'sucesso')
  }

  function setModalOpen(open) { document.body.classList.toggle('dash-modal-open', !!open) }
  function atualizarContadorModal() { $('prospect-edit-count') && ($('prospect-edit-count').textContent = String(($('prospect-edit-text')?.value || '').length)) }
  function abrirModalEdicao(id) {
    const p = prospectsAtuais.find((x) => String(x.id) === String(id))
    $('prospect-edit-text') && ($('prospect-edit-text').value = p?.diagnostico?.mensagem_editada || p?.diagnostico?.mensagem_gerada || '')
    editProspectId = id
    atualizarContadorModal()
    if ($('prospect-edit-modal')) $('prospect-edit-modal').hidden = false
    setModalOpen(true)
  }
  function fecharModalEdicao() { if ($('prospect-edit-modal')) $('prospect-edit-modal').hidden = true; setModalOpen(false); editProspectId = null }
  async function salvarEdicao() {
    const texto = String($('prospect-edit-text')?.value || '').trim().slice(0, 480)
    if (!editProspectId || !texto) return toast('Mensagem inválida.', 'erro')
    const r = await apiJson(`/dashboard/prospeccao/diagnosticos/${encodeURIComponent(editProspectId)}`, { method: 'PATCH', headers: headersJson(), body: JSON.stringify({ mensagem_editada: texto }) })
    if (!r.ok) return toast(r.erro || 'Falha ao salvar mensagem.', 'erro')
    fecharModalEdicao()
    await carregarProspects()
    toast('Mensagem salva.', 'sucesso')
  }

  function bindAcoesProspects(root) {
    root.querySelectorAll('[data-prospect-select]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = String(cb.dataset.prospectSelect || '')
        if (!id) return
        if (cb.checked) selecionados.add(id); else selecionados.delete(id)
        atualizarTotaisSelecao()
      })
    })
    root.querySelectorAll('[data-prospect-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.prospectId || ''
        const action = btn.dataset.prospectAction || ''
        if (!id || !action) return
        if (action === 'editar-msg') return abrirModalEdicao(id)
        if (action === 'detalhes') {
          const item = btn.closest('.prospecting-result-item')
          item?.classList.toggle('is-expanded')
          btn.textContent = item?.classList.contains('is-expanded') ?'Recolher detalhes' : 'Expandir detalhes'
          return
        }
        let r = null
        if (action === 'diagnosticar') r = await apiJson('/dashboard/prospeccao/diagnosticos/gerar', { method: 'POST', headers: headersJson(), body: JSON.stringify({ prospect_id: id }) })
        if (action === 'aprovar' || action === 'rejeitar') r = await apiJson(`/dashboard/prospeccao/prospects/${encodeURIComponent(id)}/${action}`, { method: 'POST', headers: headersJson(), body: JSON.stringify({}) })
        if (action === 'forcar-envio') r = await apiJson('/dashboard/prospeccao/disparos/forcar', { method: 'POST', headers: headersJson(), body: JSON.stringify({ prospect_id: id }) })
        if (!r?.ok) return toast(r?.erro || 'Falha na ação.', 'erro')
        await carregarProspects()
        await carregarMetricas()
        if (action === 'forcar-envio') {
          const result = Array.isArray(r.data?.resultados) ?r.data.resultados[0] : null
          if (result?.ok) return toast('Envio forçado concluído.', 'sucesso')
          return toast(result?.erro || 'Não foi possível forçar o envio.', 'erro')
        }
        toast('Ação concluída.', 'sucesso')
      })
    })
  }

  async function acaoLote(action) {
    if (!selecionados.size) return toast('Selecione ao menos um prospect.', 'erro')
    const endpointMap = { aprovar: '/dashboard/prospeccao/prospects/lote/aprovar', rejeitar: '/dashboard/prospeccao/prospects/lote/rejeitar', diagnosticar: '/dashboard/prospeccao/diagnosticos/gerar', enviar: '/dashboard/prospeccao/disparos/enviar' }
    const r = await apiJson(endpointMap[action], { method: 'POST', headers: headersJson(), body: JSON.stringify({ prospect_ids: Array.from(selecionados) }) })
    if (!r.ok) return toast(r.erro || 'Falha na ação em lote.', 'erro')
    await carregarProspects()
    await carregarMetricas()
    if (action === 'enviar') {
      const agendados = Number(r.data?.agendados || 0)
      return toast(`${agendados} envios agendados ao longo do dia`, 'sucesso')
    }
    toast(`Lote "${action}" concluído.`, 'sucesso')
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('prospect-manual-form')?.addEventListener('submit', pesquisar)
    $('prospect-semi-form')?.addEventListener('submit', iniciarSemiAutomatico)
    $('prospect-btn-filtrar')?.addEventListener('click', () => aplicarFiltrosProspects())
    $('prospect-lote-selecionar-todos')?.addEventListener('click', selecionarTodosVisiveis)
    $('prospect-lote-aprovar')?.addEventListener('click', () => acaoLote('aprovar'))
    $('prospect-lote-rejeitar')?.addEventListener('click', () => acaoLote('rejeitar'))
    $('prospect-lote-diagnosticar')?.addEventListener('click', () => acaoLote('diagnosticar'))
    $('prospect-lote-enviar')?.addEventListener('click', () => acaoLote('enviar'))
    $('prospect-auto-salvar')?.addEventListener('click', salvarAutoConfig)
    $('prospect-auto-atualizar')?.addEventListener('click', carregarAutoConfig)
    $('prospect-auto-rodar')?.addEventListener('click', async () => { await apiJson('/dashboard/prospeccao/auto-config/run-now', { method: 'POST', headers: headersJson(), body: JSON.stringify({}) }); await carregarJobsStatus(); toast('Rotina enfileirada.', 'sucesso') })
    $('prospect-jobs-bar-run')?.addEventListener('click', async () => { await apiJson('/dashboard/prospeccao/jobs/consumir', { method: 'POST', headers: headersJson(), body: JSON.stringify({ limit: 8 }) }); await carregarJobsStatus() })
    $('prospect-modo-manual')?.addEventListener('click', async () => { aplicarModo('manual'); await salvarAutoConfig() })
    $('prospect-modo-semi')?.addEventListener('click', async () => { aplicarModo('semi_automatico'); await salvarAutoConfig() })
    $('prospect-modo-auto')?.addEventListener('click', async () => { aplicarModo('automatico'); await salvarAutoConfig() })
    $('prospect-edit-text')?.addEventListener('input', atualizarContadorModal)
    $('prospect-edit-save')?.addEventListener('click', salvarEdicao)
    document.querySelectorAll('[data-prospect-modal-close]').forEach((el) => el.addEventListener('click', fecharModalEdicao))
    document.querySelector('.prospect-menu-toggle')?.addEventListener('click', (evt) => {
      const target = $('prospect-mobile-menu')
      const open = !target?.classList.contains('is-open')
      target?.classList.toggle('is-open', open)
      evt.currentTarget?.setAttribute('aria-expanded', String(open))
    })
    carregarAutoConfig()
    carregarProspects()
    carregarMetricas()
    carregarJobsStatus()
    window.setInterval(carregarJobsStatus, 10000)
    atualizarTotaisSelecao()
  })
})()
