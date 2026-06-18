;(function () {
  const Core = window.DashboardCore || {}
  const $ = (id) => document.getElementById(id)
  const APP_TIMEZONE = 'America/Sao_Paulo'

  const state = {
    data: hojeLocal(),
    mesBase: hojeLocal().slice(0, 7),
    eventos: [],
    eventosMes: [],
    resumo: {},
    editando: null,
    detalhando: null,
    busy: false,
  }

  const tipos = {
    reuniao: 'Reunião',
    follow_up: 'Follow-up',
    retorno: 'Retorno',
    tarefa: 'Tarefa',
    prospeccao: 'Prospecção',
    disparo: 'Disparo',
    pessoal: 'Pessoal',
    bloqueio: 'Bloqueio',
    outro: 'Outro',
  }

  const prioridades = {
    baixa: 'Baixa',
    normal: 'Normal',
    media: 'Média',
    alta: 'Alta',
    urgente: 'Urgente',
  }

  const statusLabels = {
    pendente: 'Pendente',
    concluido: 'Concluído',
    atrasado: 'Atrasado',
    cancelado: 'Cancelado',
    bloqueado: 'Bloqueado',
    confirmado: 'Confirmado',
    nao_compareceu: 'Não compareceu',
    reagendamento_pendente: 'Reagendamento pendente',
  }

  function labelLembrete(status) {
    const labels = {
      pendente: 'Lembrete pendente',
      enviado: 'Lembrete enviado',
      falhou: 'Falha no lembrete',
      cancelado: 'Lembrete cancelado',
    }
    return labels[status] || status
  }

  function esc(s) {
    return Core.escHtml ?Core.escHtml(s) : String(s == null ?'' : s)
  }

  function hojeLocal() {
    return dataIsoSaoPaulo(new Date())
  }

  function addDias(dateStr, dias) {
    const [y, m, d] = String(dateStr).split('-').map(Number)
    const base = Date.UTC(y, m - 1, d + dias, 12, 0, 0)
    return new Date(base).toISOString().slice(0, 10)
  }

  function addMes(ym, delta) {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  function formatHora(iso) {
    if (!iso) return '--:--'
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' })
  }

  function formatDataHora(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: APP_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function dataLabel(data) {
    const [y, m, d] = String(data).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
      timeZone: APP_TIMEZONE,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  function dataIsoSaoPaulo(value) {
    const d = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const get = (type) => parts.find((p) => p.type === type)?.value
    return `${get('year')}-${get('month')}-${get('day')}`
  }

  function dataHoraLocalSaoPaulo(data, hora) {
    if (!data || !hora) return ''
    return `${data}T${hora}:00-03:00`
  }

  function setFeedback(texto, tipo) {
    const el = $('agenda-feedback')
    if (el) {
      el.textContent = texto || ''
      el.className = `agenda-feedback${tipo ?' agenda-feedback-' + tipo : ''}`
    }
  }

  async function api(url, opts) {
    if (Core.fetchJson) return Core.fetchJson(url, opts)
    const r = await fetch(url, opts || {})
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, data, erro: data.erro }
  }

  function headersJson() {
    return Core.headersComReprocessSecret ?Core.headersComReprocessSecret(true) : { 'Content-Type': 'application/json' }
  }

  function primeiroDiaMes(ym) {
    return `${ym}-01`
  }

  function ultimoDiaMes(ym) {
    const [y, m] = ym.split('-').map(Number)
    return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  }

  function metadata(ev) {
    return ev && ev.metadata && typeof ev.metadata === 'object' ?ev.metadata : {}
  }

  function valorMeta(meta, keys) {
    for (const key of keys) {
      const value = meta[key]
      if (value != null && String(value).trim()) return String(value).trim()
    }
    return ''
  }

  function resumoCurto(ev) {
    const meta = metadata(ev)
    const partes = []
    const negocio = valorMeta(meta, ['negocio', 'lead_nome', 'empresa'])
    const cidade = valorMeta(meta, ['cidade', 'localidade'])
    const plano = valorMeta(meta, ['plano_sugerido', 'plano', 'produto_sugerido'])
    const valor = valorMeta(meta, ['valor', 'preco', 'preco_calculado', 'ticket_medio'])
    if (ev.tipo === 'bloqueio') {
      const motivo = valorMeta(meta, ['motivo']) || ev.descricao || 'Horário indisponível'
      return `Motivo: ${motivo}`
    }
    if (ev.tipo === 'reuniao') {
      partes.push('Lead agendou reunião para proposta')
      if (negocio) partes.push(`de ${negocio}`)
      if (cidade) partes.push(`em ${cidade}`)
      if (plano) partes.push(`Plano recomendado: ${plano}`)
      if (valor) partes.push(`Valor: ${valor}`)
    }
    const base = partes.length ?`${partes.join('. ')}.` : (ev.descricao || '')
    const texto = base || ev.descricao || 'Compromisso registrado na agenda.'
    return texto.length > 180 ?`${texto.slice(0, 177).trim()}...` : texto
  }

  function previewMetas(ev) {
    const meta = metadata(ev)
    const lead = ev.numero || valorMeta(meta, ['lead_numero', 'telefone', 'numero'])
    const cidade = valorMeta(meta, ['cidade', 'localidade'])
    const plano = valorMeta(meta, ['plano_sugerido', 'plano', 'produto_sugerido'])
    const valor = valorMeta(meta, ['valor', 'preco', 'preco_calculado', 'ticket_medio'])
    const motivo = valorMeta(meta, ['motivo'])
    const observacao = valorMeta(meta, ['observacao'])
    if (ev.tipo === 'bloqueio') {
      return [
        motivo ?`Motivo: ${motivo}` : 'Indisponível',
        observacao ?`Obs.: ${observacao}` : '',
      ].filter(Boolean).slice(0, 3)
    }
    return [
      lead ?`Lead: ${lead}` : '',
      cidade ?`Cidade: ${cidade}` : '',
      plano ?`Plano: ${plano}` : '',
      valor ?`Valor: ${valor}` : '',
    ].filter(Boolean).slice(0, 3)
  }

  function atualizarResumo(resumo) {
    $('agenda-resumo-atrasados').textContent = resumo.atrasados || 0
    $('agenda-resumo-hoje').textContent = resumo.hoje || 0
    $('agenda-resumo-concluidos').textContent = resumo.concluidos || 0
    $('agenda-resumo-proximos').textContent = resumo.proximos || 0
    const dica = $('agenda-dica')
    if (dica) {
      dica.textContent = (resumo.atrasados || 0) > 0
        ?`Você tem ${resumo.atrasados} compromisso(s) atrasado(s). Resolva os mais importantes primeiro.`
        : 'Dia organizado. Use a agenda para travar retornos antes que esfriem.'
    }
  }

  function renderLista() {
    const root = $('agenda-lista')
    if (!root) return
    const eventos = state.eventos
    if (!eventos.length) {
      root.innerHTML = Core.emptyState
        ?Core.emptyState('Nenhum compromisso para este dia.', 'Crie um compromisso ou acompanhe reuniões geradas pelo agente de vendas.')
        : '<div class="empty-state"><strong>Nenhum compromisso para este dia.</strong></div>'
      return
    }
    root.innerHTML = eventos.map((ev) => {
      const status = ev.status_efetivo || ev.status
      const isBloqueio = ev.tipo === 'bloqueio'
      const podeNoShow = ev.tipo === 'reuniao' && !['concluido', 'cancelado', 'nao_compareceu'].includes(status)
      const podeLembrete = ev.tipo === 'reuniao' && ['pendente', 'confirmado', 'atrasado'].includes(status)
      const conversa = ev.numero
        ?`<a class="agenda-action-btn" href="conversas.html?busca=${encodeURIComponent(ev.numero)}">Conversa</a>`
        : '<button type="button" class="agenda-action-btn" disabled>Conversa</button>'
      const acoes = isBloqueio
        ?`
              <button type="button" class="agenda-action-btn" data-action="editar-bloqueio" data-id="${esc(ev.id)}">Editar</button>
              <button type="button" class="agenda-action-btn agenda-action-details" data-action="detalhes" data-id="${esc(ev.id)}">Ver detalhes</button>
              <button type="button" class="agenda-action-btn" data-action="remover-bloqueio" data-id="${esc(ev.id)}">Remover</button>
            `
        :`
              ${conversa}
              <button type="button" class="agenda-action-btn" data-action="editar" data-id="${esc(ev.id)}">Editar</button>
              ${podeLembrete ?`<button type="button" class="agenda-action-btn" data-action="lembrete-agora" data-id="${esc(ev.id)}">Enviar lembrete</button>` : ''}
              <button type="button" class="agenda-action-btn agenda-action-success" data-action="concluir" data-id="${esc(ev.id)}"${status === 'concluido' ?' disabled' : ''}>${ev.tipo === 'reuniao' ?'Reunião concluída' : 'Concluir'}</button>
              ${ev.tipo === 'reuniao' && !ev.venda_fechada ?`<button type="button" class="agenda-action-btn agenda-action-vendido" data-action="vendido" data-id="${esc(ev.id)}">Marcar vendido</button>` : ''}
              ${podeNoShow ?`<button type="button" class="agenda-action-btn" data-action="nao-compareceu" data-id="${esc(ev.id)}">Não compareceu</button>` : ''}
              <button type="button" class="agenda-action-btn agenda-action-details" data-action="detalhes" data-id="${esc(ev.id)}">Ver detalhes</button>
              <button type="button" class="agenda-action-btn" data-action="excluir" data-id="${esc(ev.id)}">Excluir</button>
            `
      return `
        <article class="agenda-event agenda-event-tipo-${esc(ev.tipo)} agenda-event-status-${esc(status)}" data-id="${esc(ev.id)}">
          <time class="agenda-event-time">${esc(formatHora(ev.data_inicio))}</time>
          <div class="agenda-event-main">
            <div class="agenda-event-copy">
              <strong class="agenda-event-title">${esc(ev.titulo)}</strong>
              <span class="agenda-event-desc">${esc(resumoCurto(ev))}</span>
              <div class="agenda-event-detail-preview">
                ${previewMetas(ev).map((item) => `<span>${esc(item)}</span>`).join('')}
              </div>
              <div class="agenda-event-meta">
                <span class="agenda-chip agenda-chip-tipo-${esc(ev.tipo)}">${esc(tipos[ev.tipo] || ev.tipo)}</span>
                <span class="agenda-chip agenda-chip-status-${esc(status)}">${esc(statusLabels[status] || status)}</span>
                ${ev.lembrete_status ?`<span class="agenda-chip agenda-chip-lembrete-${esc(ev.lembrete_status)}">${esc(labelLembrete(ev.lembrete_status))}</span>` : ''}
                <span class="agenda-chip">${esc(prioridades[ev.prioridade] || ev.prioridade)}</span>
                ${ev.recorrencia_id ?'<span class="agenda-chip">Recorrente</span>' : ''}
                ${ev.venda_fechada ?`<span class="agenda-chip agenda-chip-vendido">✓ Vendido${ev.venda_valor ?` · R$ ${esc(formatBRL(ev.venda_valor))}` : ''}</span>` : ''}
              </div>
            </div>
            <div class="agenda-event-actions">
              ${acoes}
            </div>
          </div>
        </article>
      `
    }).join('')
  }

  function renderTipos() {
    const root = $('agenda-tipos')
    if (!root) return
    const porTipo = state.resumo.por_tipo || {}
    const entries = Object.keys(tipos).map((tipo) => [tipo, porTipo[tipo] || 0]).filter((x) => x[1] > 0)
    root.innerHTML = (entries.length ?entries : [['reuniao', 0], ['follow_up', 0], ['tarefa', 0]]).map(([tipo, total]) => `
      <div class="agenda-type-row">
        <span class="agenda-dot agenda-event-tipo-${esc(tipo)}"></span>
        <strong>${esc(tipos[tipo])}</strong>
        <span>${esc(total)}</span>
      </div>
    `).join('')
  }

  function renderProximos() {
    const root = $('agenda-proximos')
    if (!root) return
    const proximos = state.eventos
      .filter((ev) => ['pendente', 'atrasado'].includes(ev.status_efetivo || ev.status))
      .slice(0, 4)
    if (!proximos.length) {
      root.innerHTML = '<div class="empty-state"><strong>Nenhum próximo evento.</strong></div>'
      return
    }
    root.innerHTML = proximos.map((ev) => `
      <div class="agenda-next-row">
        <span class="agenda-dot agenda-event-tipo-${esc(ev.tipo)}"></span>
        <span>
          <small>${esc(formatDataHora(ev.data_inicio))}</small>
          <strong>${esc(ev.titulo)}</strong>
          ${ev.descricao ?`<small>${esc(resumoCurto(ev))}</small>` : ''}
        </span>
        <button type="button" class="agenda-mini-btn" data-action="detalhes" data-id="${esc(ev.id)}">›</button>
      </div>
    `).join('')
  }

  function renderCalendario() {
    const root = $('agenda-calendario')
    const label = $('agenda-mes-label')
    if (!root || !label) return
    const [year, month] = state.mesBase.split('-').map(Number)
    const first = new Date(year, month - 1, 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    label.textContent = first.toLocaleDateString('pt-BR', { timeZone: APP_TIMEZONE, month: 'long', year: 'numeric' })
    const dias = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
    const eventDates = new Set(state.eventosMes.map((ev) => dataIsoSaoPaulo(ev.data_inicio)).filter(Boolean))
    const today = hojeLocal()
    let html = dias.map((d) => `<span>${d}</span>`).join('')
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const cls = [
        d.getMonth() + 1 !== month ?'is-muted' : '',
        iso === state.data ?'is-selected' : '',
        iso === today ?'is-today' : '',
        eventDates.has(iso) ?'has-events' : '',
      ].filter(Boolean).join(' ')
      html += `<button type="button" class="${cls}" data-date="${iso}">${d.getDate()}</button>`
    }
    root.innerHTML = html
  }

  async function carregarEventosMes() {
    const params = new URLSearchParams({
      inicio: primeiroDiaMes(state.mesBase),
      fim: ultimoDiaMes(state.mesBase),
    })
    const r = await api('/dashboard/agenda?' + params.toString(), { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    state.eventosMes = r.ok ?(r.data.eventos || []) : []
  }

  async function carregarAgenda() {
    setFeedback('Carregando agenda...')
    state.eventos = []
    const lista = $('agenda-lista')
    if (lista) lista.innerHTML = Core.loadingState ?Core.loadingState('Carregando agenda...') : '<div class="empty-state"><strong>Carregando agenda...</strong></div>'
    const params = new URLSearchParams({ data: state.data })
    const tipo = $('agenda-filtro-tipo')?.value || ''
    const status = $('agenda-filtro-status')?.value || ''
    if (tipo) params.set('tipo', tipo)
    if (status && status !== 'atrasado') params.set('status', status)
    const r = await api('/dashboard/agenda?' + params.toString(), { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) {
      $('agenda-lista').innerHTML = Core.emptyState ?Core.emptyState('Erro ao carregar agenda.', r.erro || 'Tente novamente.') : ''
      setFeedback(r.erro || 'Erro ao carregar agenda.', 'erro')
      return
    }
    let eventos = r.data.eventos || []
    if (status === 'atrasado') eventos = eventos.filter((ev) => ev.status_efetivo === 'atrasado')
    state.eventos = eventos
    state.resumo = r.data.resumo || {}
    $('agenda-data').value = state.data
    $('agenda-dia-titulo').textContent = `Compromissos de ${dataLabel(state.data)}`
    atualizarResumo(state.resumo)
    renderLista()
    renderTipos()
    renderProximos()
    await carregarEventosMes()
    renderCalendario()
    setFeedback('')
  }

  function abrirModal(ev) {
    state.editando = ev || null
    $('agenda-modal-title').textContent = ev ?'Editar compromisso' : 'Novo compromisso'
    $('agenda-evento-id').value = ev?.id || ''
    $('agenda-titulo').value = ev?.titulo || ''
    $('agenda-descricao').value = ev?.descricao || ''
    $('agenda-tipo').value = ev?.tipo || 'reuniao'
    $('agenda-prioridade').value = ev?.prioridade || 'media'
    $('agenda-status').value = ev?.status === 'atrasado' ?'pendente' : (ev?.status || 'pendente')
    const data = ev?.data_inicio ?dataIsoSaoPaulo(ev.data_inicio) : state.data
    $('agenda-form-data').value = data
    $('agenda-hora-inicio').value = ev?.data_inicio ?formatHora(ev.data_inicio) : '09:00'
    $('agenda-hora-fim').value = ev?.data_fim ?formatHora(ev.data_fim) : '10:00'
    $('agenda-lead-id').value = ev?.lead_id || ''
    $('agenda-conversa-id').value = ev?.conversa_id || ''
    $('agenda-recorrencia').value = ev?.regra_recorrencia?.tipo || 'nenhuma'
    $('agenda-recorrencia-ate').value = ev?.regra_recorrencia?.ate || ''
    $('agenda-excluir').hidden = !ev
    $('agenda-concluir-modal').hidden = !ev || ev.status_efetivo === 'concluido'
    $('agenda-form-status').textContent = ''
    $('agenda-modal').hidden = false
    window.setTimeout(() => $('agenda-titulo')?.focus(), 30)
  }

  function fecharModal() {
    $('agenda-modal').hidden = true
    state.editando = null
    $('agenda-form').reset()
  }

  function abrirModalBloqueio(ev) {
    state.editando = ev || null
    const meta = metadata(ev)
    $('agenda-bloqueio-title').textContent = ev ?'Editar bloqueio' : 'Bloquear horário'
    $('agenda-bloqueio-id').value = ev?.id || ''
    const data = ev?.data_inicio ?dataIsoSaoPaulo(ev.data_inicio) : state.data
    $('agenda-bloqueio-data').value = data
    $('agenda-bloqueio-inicio').value = ev?.data_inicio ?formatHora(ev.data_inicio) : '20:15'
    $('agenda-bloqueio-fim').value = ev?.data_fim ?formatHora(ev.data_fim) : '20:30'
    $('agenda-bloqueio-motivo').value = meta.motivo || ev?.descricao || ''
    $('agenda-bloqueio-observacao').value = meta.observacao || ''
    $('agenda-bloqueio-recorrencia').value = ev?.regra_recorrencia?.tipo || 'nenhuma'
    $('agenda-bloqueio-ate').value = ev?.regra_recorrencia?.ate || ''
    $('agenda-bloqueio-remover').hidden = !ev
    $('agenda-bloqueio-status').textContent = ''
    $('agenda-bloqueio-modal').hidden = false
    window.setTimeout(() => $('agenda-bloqueio-motivo')?.focus(), 30)
  }

  function fecharModalBloqueio() {
    $('agenda-bloqueio-modal').hidden = true
    state.editando = null
    $('agenda-bloqueio-form').reset()
  }

  function abrirModalNoShow(ev) {
    if (!ev) return
    state.editando = ev
    $('agenda-no-show-id').value = ev.id
    $('agenda-no-show-title').textContent = 'Lead não compareceu'
    $('agenda-no-show-desc').textContent = ev.titulo || 'Reunião'
    $('agenda-no-show-observacao').value = ''
    $('agenda-no-show-data').value = state.data
    $('agenda-no-show-hora').value = ''
    $('agenda-no-show-slot-list').innerHTML = ''
    $('agenda-no-show-status').textContent = ''
    $('agenda-no-show-modal').hidden = false
  }

  function fecharModalNoShow() {
    $('agenda-no-show-modal').hidden = true
    state.editando = null
    $('agenda-no-show-form').reset()
    $('agenda-no-show-slot-list').innerHTML = ''
  }

  function detalhesHtml(ev) {
    const meta = metadata(ev)
    const status = ev.status_efetivo || ev.status
    const kv = [
      ['Data e horário', `${formatDataHora(ev.data_inicio)} - ${formatHora(ev.data_fim)}`],
      ['Status', statusLabels[status] || status],
      ['Prioridade', prioridades[ev.prioridade] || ev.prioridade],
      ['Tipo', tipos[ev.tipo] || ev.tipo],
      ['Lead', ev.numero || meta.lead_numero || ev.lead_id || 'Não vinculado'],
      ['Origem', ev.origem || 'manual'],
    ]
    const metaRows = Object.entries(meta)
      .filter(([, value]) => value != null && typeof value !== 'object' && String(value).trim())
      .map(([key, value]) => `<div class="agenda-details-kv"><span>${esc(key.replace(/_/g, ' '))}</span><strong>${esc(value)}</strong></div>`)
      .join('')
    const metaComplex = Object.entries(meta)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => `<section class="agenda-details-section"><span>${esc(key.replace(/_/g, ' '))}</span><pre class="agenda-details-pre">${esc(JSON.stringify(value, null, 2))}</pre></section>`)
      .join('')
    return `
      <div class="agenda-details-grid">
        ${kv.map(([label, value]) => `<div class="agenda-details-kv"><span>${esc(label)}</span><strong>${esc(value || '-')}</strong></div>`).join('')}
        ${metaRows}
      </div>
      <section class="agenda-details-section">
        <span>Resumo curto</span>
        <p>${esc(resumoCurto(ev))}</p>
      </section>
      <section class="agenda-details-section">
        <span>Descrição completa</span>
        <p>${esc(ev.descricao || 'Sem descrição registrada.')}</p>
      </section>
      ${metaComplex}
    `
  }

  function abrirDetalhes(ev) {
    if (!ev) return
    const isBloqueio = ev.tipo === 'bloqueio'
    state.detalhando = ev
    $('agenda-detalhes-title').textContent = ev.titulo || 'Compromisso'
    $('agenda-detalhes-subtitle').textContent = `${formatDataHora(ev.data_inicio)} - ${formatHora(ev.data_fim)}`
    $('agenda-detalhes-body').innerHTML = detalhesHtml(ev)
    const conversa = $('agenda-detalhes-conversa')
    if (conversa) {
      if (!isBloqueio && ev.numero) {
        conversa.href = `conversas.html?busca=${encodeURIComponent(ev.numero)}`
        conversa.hidden = false
      } else {
        conversa.hidden = true
      }
    }
    const concluir = $('agenda-detalhes-concluir')
    if (concluir) {
      concluir.hidden = isBloqueio
      concluir.disabled = isBloqueio || (ev.status_efetivo || ev.status) === 'concluido'
    }
    $('agenda-detalhes-modal').hidden = false
  }

  function fecharDetalhes() {
    $('agenda-detalhes-modal').hidden = true
    state.detalhando = null
  }

  function montarPayload() {
    const data = $('agenda-form-data').value
    const hi = $('agenda-hora-inicio').value
    const hf = $('agenda-hora-fim').value
    const rec = $('agenda-recorrencia').value
    const regra = rec === 'nenhuma' ?null : {
      tipo: rec,
      intervalo: 1,
      ate: $('agenda-recorrencia-ate').value || undefined,
    }
    return {
      titulo: $('agenda-titulo').value,
      descricao: $('agenda-descricao').value,
      tipo: $('agenda-tipo').value,
      prioridade: $('agenda-prioridade').value,
      status: $('agenda-status').value,
      data_inicio: dataHoraLocalSaoPaulo(data, hi),
      data_fim: dataHoraLocalSaoPaulo(data, hf),
      lead_id: $('agenda-lead-id').value || null,
      conversa_id: $('agenda-conversa-id').value || null,
      recorrente: rec !== 'nenhuma',
      regra_recorrencia: regra,
    }
  }

  function montarPayloadBloqueio() {
    const data = $('agenda-bloqueio-data').value
    const hi = $('agenda-bloqueio-inicio').value
    const hf = $('agenda-bloqueio-fim').value
    const rec = $('agenda-bloqueio-recorrencia').value
    const regra = rec === 'nenhuma' ?null : {
      tipo: rec,
      intervalo: 1,
      ate: $('agenda-bloqueio-ate').value || undefined,
    }
    return {
      data_inicio: dataHoraLocalSaoPaulo(data, hi),
      data_fim: dataHoraLocalSaoPaulo(data, hf),
      motivo: $('agenda-bloqueio-motivo').value.trim(),
      observacao: $('agenda-bloqueio-observacao').value.trim(),
      recorrente: rec !== 'nenhuma',
      regra_recorrencia: regra,
    }
  }

  async function salvarEvento(ev) {
    ev.preventDefault()
    if (state.busy) return
    const payload = montarPayload()
    if (!payload.titulo.trim()) {
      $('agenda-form-status').textContent = 'Título obrigatório.'
      return
    }
    if (new Date(payload.data_fim) <= new Date(payload.data_inicio)) {
      $('agenda-form-status').textContent = 'Hora fim precisa ser maior que hora início.'
      return
    }
    state.busy = true
    $('agenda-salvar').disabled = true
    $('agenda-form-status').textContent = 'Salvando compromisso...'
    const id = $('agenda-evento-id').value
    const r = await api(id ?`/dashboard/agenda/${encodeURIComponent(id)}` : '/dashboard/agenda', {
      method: id ?'PATCH' : 'POST',
      headers: headersJson(),
      body: JSON.stringify(payload),
    })
    state.busy = false
    $('agenda-salvar').disabled = false
    if (!r.ok) {
      $('agenda-form-status').textContent = r.erro || 'Erro ao salvar compromisso.'
      return
    }
    fecharModal()
    Core.toast?.(id ?'Compromisso atualizado com sucesso.' : 'Compromisso criado com sucesso.', 'sucesso')
    await carregarAgenda()
  }

  async function salvarBloqueio(ev) {
    ev.preventDefault()
    if (state.busy) return
    const payload = montarPayloadBloqueio()
    if (!payload.motivo) {
      $('agenda-bloqueio-status').textContent = 'Motivo do bloqueio obrigatório.'
      return
    }
    if (new Date(payload.data_fim) <= new Date(payload.data_inicio)) {
      $('agenda-bloqueio-status').textContent = 'Hora fim precisa ser maior que hora início.'
      return
    }
    state.busy = true
    $('agenda-bloqueio-salvar').disabled = true
    $('agenda-bloqueio-status').textContent = 'Salvando bloqueio...'
    const id = $('agenda-bloqueio-id').value
    const r = await api(id ?`/dashboard/agenda/bloqueios/${encodeURIComponent(id)}` : '/dashboard/agenda/bloqueios', {
      method: id ?'PATCH' : 'POST',
      headers: headersJson(),
      body: JSON.stringify(payload),
    })
    state.busy = false
    $('agenda-bloqueio-salvar').disabled = false
    if (!r.ok) {
      $('agenda-bloqueio-status').textContent = r.erro || 'Erro ao salvar bloqueio.'
      return
    }
    fecharModalBloqueio()
    Core.toast?.(id ?'Bloqueio atualizado com sucesso.' : 'Horário bloqueado com sucesso.', 'sucesso')
    await carregarAgenda()
  }

  async function concluirEvento(id) {
    const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}/concluir`, {
      method: 'PATCH',
      headers: headersJson(),
      body: JSON.stringify({}),
    })
    if (!r.ok) {
      Core.toast?.(r.erro || 'Erro ao concluir evento.', 'erro')
      return
    }
    Core.toast?.('Evento marcado como concluído.', 'sucesso')
    await carregarAgenda()
  }

  function formatBRL(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)
  }

  async function marcarVendido(id) {
    const entrada = window.prompt('Valor da venda (R$):', '')
    if (entrada == null) return
    const valor = Number(String(entrada).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
    if (!Number.isFinite(valor) || valor <= 0) {
      Core.toast?.('Valor inválido.', 'erro')
      return
    }
    const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}/vendido`, {
      method: 'PATCH',
      headers: headersJson(),
      body: JSON.stringify({ valor }),
    })
    if (!r.ok) {
      Core.toast?.(r.erro || 'Erro ao registrar venda.', 'erro')
      return
    }
    Core.toast?.(`Venda registrada: R$ ${formatBRL(valor)}.`, 'sucesso')
    await carregarAgenda()
  }

  async function excluirEvento(id) {
    const ok = window.confirm('Excluir este compromisso?')
    if (!ok) return
    const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headersJson(),
    })
    if (!r.ok) {
      Core.toast?.(r.erro || 'Erro ao excluir evento.', 'erro')
      return
    }
    fecharModal()
    Core.toast?.('Compromisso excluído.', 'sucesso')
    await carregarAgenda()
  }

  async function removerBloqueio(id) {
    const ok = window.confirm('Remover este bloqueio de horário?')
    if (!ok) return
    const r = await api(`/dashboard/agenda/bloqueios/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headersJson(),
    })
    if (!r.ok) {
      Core.toast?.(r.erro || 'Erro ao remover bloqueio.', 'erro')
      return
    }
    fecharModalBloqueio()
    Core.toast?.('Bloqueio removido.', 'sucesso')
    await carregarAgenda()
  }

  async function marcarNaoCompareceu(id, fechar = true) {
    const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}/nao-compareceu`, {
      method: 'PATCH',
      headers: headersJson(),
      body: JSON.stringify({ observacao: $('agenda-no-show-observacao')?.value || '' }),
    })
    if (!r.ok) {
      const alvo = $('agenda-no-show-status')
      if (alvo) alvo.textContent = r.erro || 'Erro ao marcar não comparecimento.'
      Core.toast?.(r.erro || 'Erro ao marcar não comparecimento.', 'erro')
      return false
    }
    if (fechar) fecharModalNoShow()
    Core.toast?.('Reunião marcada como não comparecida.', 'sucesso')
    await carregarAgenda()
    return true
  }

  async function buscarSlotsNoShow() {
    const id = $('agenda-no-show-id').value
    const ev = encontrarEvento(id)
    const data = $('agenda-no-show-data').value || state.data
    const inicio = dataHoraLocalSaoPaulo(data, '18:30')
    $('agenda-no-show-status').textContent = 'Buscando horários disponíveis...'
    const r = await api(`/dashboard/agenda/disponibilidade?data_inicial=${encodeURIComponent(inicio)}&quantidade=6&duracao_minutos=15`, {
      headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
    })
    if (!r.ok) {
      $('agenda-no-show-status').textContent = r.erro || 'Erro ao buscar horários.'
      return
    }
    const slots = r.data?.disponibilidade?.horarios_sugeridos || []
    const slotDate = r.data?.disponibilidade?.data_sugerida || data
    const root = $('agenda-no-show-slot-list')
    root.innerHTML = slots.length
      ? slots.map((h) => `<button type="button" class="agenda-slot-btn" data-slot-date="${esc(slotDate)}" data-slot-hour="${esc(h)}">${esc(slotDate)} ${esc(h)}</button>`).join('')
      : '<span class="dash-modal-hint">Nenhum horário livre encontrado.</span>'
    $('agenda-no-show-status').textContent = slots.length ?'Escolha um horário sugerido ou informe manualmente.' : ''
    if (ev && slots[0]) {
      $('agenda-no-show-data').value = slotDate
      $('agenda-no-show-hora').value = slots[0]
    }
  }

  async function reagendarNaoComparecimento(ev) {
    ev.preventDefault()
    const id = $('agenda-no-show-id').value
    const data = $('agenda-no-show-data').value
    const hora = $('agenda-no-show-hora').value
    if (!data || !hora) {
      $('agenda-no-show-status').textContent = 'Escolha nova data e horário.'
      return
    }
    const inicio = new Date(dataHoraLocalSaoPaulo(data, hora))
    const fim = new Date(inicio.getTime() + 15 * 60 * 1000)
    const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}/reagendar-nao-comparecimento`, {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({
        nova_data_inicio: dataHoraLocalSaoPaulo(data, hora),
        nova_data_fim: fim.toISOString(),
        observacao: $('agenda-no-show-observacao').value,
      }),
    })
    if (!r.ok) {
      $('agenda-no-show-status').textContent = r.erro || 'Erro ao reagendar.'
      return
    }
    fecharModalNoShow()
    Core.toast?.('Reunião reagendada com sucesso.', 'sucesso')
    await carregarAgenda()
  }

  async function enviarLembreteAgora(id, confirmar = false) {
    const btn = document.querySelector(`[data-action="lembrete-agora"][data-id="${CSS.escape(String(id))}"]`)
    const originalText = btn?.textContent
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Enviando...'
    }
    try {
      const r = await api(`/dashboard/agenda/${encodeURIComponent(id)}/lembrete-agora`, {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({ confirmar_reenvio: confirmar }),
      })
      if (!r.ok) {
        if (r.status === 409 && !confirmar && window.confirm(`${r.erro || 'Lembrete enviado recentemente.'} Reenviar mesmo assim?`)) {
          return enviarLembreteAgora(id, true)
        }
        Core.toast?.(`Falha ao enviar lembrete: ${r.erro || 'erro desconhecido'}`, 'erro')
        return
      }
      Core.toast?.((r.data && r.data.message) || 'Lembrete enviado com sucesso.', 'sucesso')
      await carregarAgenda()
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = originalText || 'Enviar lembrete'
      }
    }
  }

  function encontrarEvento(id) {
    return state.eventos.find((ev) => String(ev.id) === String(id))
  }

  function bind() {
    $('agenda-data')?.addEventListener('change', (ev) => {
      state.data = ev.target.value || hojeLocal()
      state.mesBase = state.data.slice(0, 7)
      carregarAgenda()
    })
    $('agenda-dia-anterior')?.addEventListener('click', () => { state.data = addDias(state.data, -1); state.mesBase = state.data.slice(0, 7); carregarAgenda() })
    $('agenda-dia-proximo')?.addEventListener('click', () => { state.data = addDias(state.data, 1); state.mesBase = state.data.slice(0, 7); carregarAgenda() })
    $('agenda-ver-dia-seguinte')?.addEventListener('click', () => { state.data = addDias(state.data, 1); state.mesBase = state.data.slice(0, 7); carregarAgenda() })
    $('agenda-hoje')?.addEventListener('click', () => { state.data = hojeLocal(); state.mesBase = state.data.slice(0, 7); carregarAgenda() })
    $('agenda-novo')?.addEventListener('click', () => abrirModal(null))
    $('agenda-bloquear')?.addEventListener('click', () => abrirModalBloqueio(null))
    $('agenda-filtro-tipo')?.addEventListener('change', carregarAgenda)
    $('agenda-filtro-status')?.addEventListener('change', carregarAgenda)
    $('agenda-limpar-filtros')?.addEventListener('click', () => {
      $('agenda-filtro-tipo').value = ''
      $('agenda-filtro-status').value = ''
      carregarAgenda()
    })
    $('agenda-mes-anterior')?.addEventListener('click', async () => { state.mesBase = addMes(state.mesBase, -1); await carregarEventosMes(); renderCalendario() })
    $('agenda-mes-proximo')?.addEventListener('click', async () => { state.mesBase = addMes(state.mesBase, 1); await carregarEventosMes(); renderCalendario() })
    $('agenda-calendario')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-date]')
      if (!btn) return
      state.data = btn.dataset.date
      state.mesBase = state.data.slice(0, 7)
      carregarAgenda()
    })
    document.body.addEventListener('click', (ev) => {
      if (ev.target.matches('[data-agenda-fechar]')) fecharModal()
      if (ev.target.matches('[data-agenda-bloqueio-fechar]')) fecharModalBloqueio()
      if (ev.target.matches('[data-agenda-no-show-fechar]')) fecharModalNoShow()
      if (ev.target.matches('[data-agenda-detalhes-fechar]')) fecharDetalhes()
      const slotBtn = ev.target.closest('[data-slot-date][data-slot-hour]')
      if (slotBtn) {
        $('agenda-no-show-data').value = slotBtn.dataset.slotDate
        $('agenda-no-show-hora').value = slotBtn.dataset.slotHour
        return
      }
      const btn = ev.target.closest('[data-action][data-id]')
      if (!btn) return
      const id = btn.dataset.id
      const action = btn.dataset.action
      if (action === 'editar') abrirModal(encontrarEvento(id))
      if (action === 'editar-bloqueio') abrirModalBloqueio(encontrarEvento(id))
      if (action === 'concluir') concluirEvento(id)
      if (action === 'vendido') marcarVendido(id)
      if (action === 'lembrete-agora') enviarLembreteAgora(id)
      if (action === 'nao-compareceu') abrirModalNoShow(encontrarEvento(id))
      if (action === 'excluir') excluirEvento(id)
      if (action === 'remover-bloqueio') removerBloqueio(id)
      if (action === 'detalhes') abrirDetalhes(encontrarEvento(id))
    })
    $('agenda-form')?.addEventListener('submit', salvarEvento)
    $('agenda-bloqueio-form')?.addEventListener('submit', salvarBloqueio)
    $('agenda-no-show-form')?.addEventListener('submit', reagendarNaoComparecimento)
    $('agenda-excluir')?.addEventListener('click', () => {
      const id = $('agenda-evento-id').value
      if (id) excluirEvento(id)
    })
    $('agenda-concluir-modal')?.addEventListener('click', () => {
      const id = $('agenda-evento-id').value
      if (id) concluirEvento(id).then(fecharModal)
    })
    $('agenda-bloqueio-remover')?.addEventListener('click', () => {
      const id = $('agenda-bloqueio-id').value
      if (id) removerBloqueio(id)
    })
    $('agenda-no-show-marcar')?.addEventListener('click', () => {
      const id = $('agenda-no-show-id').value
      if (id) marcarNaoCompareceu(id)
    })
    $('agenda-no-show-slots')?.addEventListener('click', buscarSlotsNoShow)
    $('agenda-detalhes-editar')?.addEventListener('click', () => {
      const ev = state.detalhando
      fecharDetalhes()
      if (ev?.tipo === 'bloqueio') abrirModalBloqueio(ev)
      else if (ev) abrirModal(ev)
    })
    $('agenda-detalhes-concluir')?.addEventListener('click', () => {
      const id = state.detalhando?.id
      if (id) concluirEvento(id).then(fecharDetalhes)
    })
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bind()
    $('agenda-data').value = state.data
    try {
      if (Core.carregarSessaoDashboard) await Core.carregarSessaoDashboard()
    } catch (_) {}
    carregarAgenda()
  })
})()
