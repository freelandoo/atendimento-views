;(function () {
  const Core = window.DashboardCore || {}
  let modoAtual = 'manual'

  function $(id) { return document.getElementById(id) }
  function esc(s) { return Core.escHtml ?Core.escHtml(s) : String(s == null ?'' : s) }
  function headersJson() { return Core.headersComReprocessSecret ?Core.headersComReprocessSecret(true) : { 'Content-Type': 'application/json' } }
  function toast(msg, tipo) { if (Core.toast) Core.toast(msg, tipo || 'info') }
  async function apiJson(url, opts) { return Core.fetchJson ?Core.fetchJson(url, opts) : fetch(url, opts).then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) })) }

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

  function diasOperacaoLabel(cfg = {}) {
    const dias = Array.isArray(cfg.dias_semana_ativos) ? cfg.dias_semana_ativos.map(Number) : []
    if (cfg.rodada_diaria || dias.join(',') === '1,2,3,4,5') return 'Segunda a sexta'
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
    const base = dias.length ? dias : [Number(cfg.weekday ?? 1)]
    return base.map((d) => nomes[d] || 'segunda').join(', ')
  }

  function janelaOperacaoLabel(cfg = {}) {
    const inicio = cfg.horario_inicio || `${String(cfg.hour || 8).padStart(2, '0')}:${String(cfg.minute || 0).padStart(2, '0')}`
    return `${inicio} às ${cfg.horario_fim || '17:00'}`
  }

  function atualizarStatusOperacional(cfg = {}, agenda = null, opts = {}) {
    const ativo = !!cfg.enabled && cfg.modo === 'automatico'
    const chip = $('prospect-auto-status-chip')
    if (chip) {
      chip.textContent = ativo ? 'Automático ativo' : 'Rotina pausada'
      chip.classList.toggle('is-active', ativo)
      chip.classList.toggle('is-paused', !ativo)
    }
    const limite = Number(cfg.limite_diario || cfg.limit || 80)
    const slots = Number(agenda?.total_slots || 0)
    if (!opts.preservarCapacidade) {
      setDailyText('daily-capacidade', slots ? `${Math.min(slots, limite)} / ${limite}` : `0 / ${limite}`)
    }
    const rotina = `${diasOperacaoLabel(cfg)}, das ${janelaOperacaoLabel(cfg)}, com intervalo de ${cfg.intervalo_envio_minutos || 30} minutos entre envios.`
    setDailyText('daily-routine-line', `A rotina está ${ativo ? 'ativa' : 'pausada'} de ${rotina.charAt(0).toLowerCase()}${rotina.slice(1)}`)
    setDailyText('prospect-routine-copy', rotina)
  }

  function aplicarModo(modo) {
    modoAtual = ['manual', 'semi_automatico', 'automatico'].includes(modo) ?modo : 'manual'
    // O modo é controlado pelo select da aba Configuração
    if ($('prospect-modo') && $('prospect-modo').value !== modoAtual) $('prospect-modo').value = modoAtual
    // A prévia de busca da rotina só faz sentido no modo automático
    if (modoAtual !== 'automatico' && $('prospect-auto-planejamento')) $('prospect-auto-planejamento').hidden = true
  }

  function lerAutoConfigForm() {
    const wd = Number($('prospect-auto-weekday')?.value || 7)
    const inicio = String($('prospect-auto-start')?.value || '').match(/^(\d{1,2}):(\d{2})$/)
    const hour = inicio ? Number(inicio[1]) : Number($('prospect-auto-hour')?.value || 8)
    const minute = inicio ? Number(inicio[2]) : Number($('prospect-auto-minute')?.value || 0)
    const diasAtivos = wd === 7 ?[1, 2, 3, 4, 5] : [wd]
    return {
      ativo: $('prospect-auto-enabled')?.value === 'true',
      enabled: $('prospect-auto-enabled')?.value === 'true',
      modo: modoAtual,
      rodada_diaria: wd === 7,
      weekday: wd === 7 ?1 : wd,
      hour,
      minute,
      horario_inicio: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      horario_fim: $('prospect-auto-end')?.value || '17:00',
      limit: Number($('prospect-auto-limit')?.value || 80),
      limite_diario: Number($('prospect-auto-limit')?.value || 80),
      intervalo_envio_minutos: Number($('prospect-auto-intervalo')?.value || 30),
      categoria: $('prospect-auto-categoria')?.value.trim() || null,
      categoria_padrao: $('prospect-auto-categoria')?.value.trim() || null,
      cidade_padrao: $('prospect-auto-cidade')?.value.trim() || null,
      estado_padrao: $('prospect-auto-estado')?.value.trim().toUpperCase() || null,
      regiao_padrao: $('prospect-auto-regiao')?.value.trim() || null,
      gerar_mensagem_ia: $('prospect-auto-gerar-ia')?.value === 'true',
      envio_real_habilitado: $('prospect-auto-envio-real')?.value === 'true',
      dias_semana_ativos: diasAtivos,
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
    if (nota) nota.textContent = 'A IA sugere variações de busca para encontrar empresas parecidas sem repetir leads.'
    if (!itens.length) {
      lista.innerHTML =
        '<li class="prospect-auto-planejamento-empty">Nenhum nicho ranqueado ainda. A rotina sincroniza a partir das conversas de vendas; você pode usar &quot;Rodar agora&quot; após ter dados.</li>'
      return
    }
    const termosRuins = /(qualidade|constru|atendimento|clientes|servi|trabalhos?|solu|produto|apr\b)/i
    const itensValidos = itens.filter((i) => {
      const cidade = String(i.cidade || i.local || '').trim()
      return cidade && cidade.length <= 48 && !termosRuins.test(cidade)
    })
    const top = (itensValidos.length ?itensValidos : itens).slice(0, 5)
    lista.innerHTML = top
      .map((i) => {
        const nicho = i.nicho || i.categoria || 'Categoria'
        const cidade = i.cidade || i.local || '-'
        const status = i.score != null || i.pontuacao != null ? 'Pronto' : 'Sugerido'
        return `<li>
          <strong>${esc(nicho)}</strong>
          <span>${esc(cidade)}</span>
          <small>${esc(status)}</small>
          <div class="prospect-search-actions">
            <button type="button" class="btn-followup" data-plan-use data-plan-nicho="${esc(nicho)}" data-plan-cidade="${esc(cidade)}">Usar</button>
            <button type="button" class="btn-followup" data-plan-ignore>Ignorar</button>
            <button type="button" class="btn-reproc" data-plan-queue data-plan-nicho="${esc(nicho)}" data-plan-cidade="${esc(cidade)}">Adicionar</button>
          </div>
        </li>`
      })
      .join('')
  }

  function aplicarResumoAutoConfig(cfg, agenda) {
    const resumo = $('prospect-auto-resumo')
    if (!resumo) return
    atualizarStatusOperacional(cfg || {}, agenda)
    if (!cfg || !cfg.enabled || cfg.modo !== 'automatico') {
      resumo.hidden = true
      const alertaEl = $('prospect-auto-capacity-alert')
      if (alertaEl) alertaEl.hidden = true
      return
    }
    const hora = String(cfg.hour || 8).padStart(2, '0')
    const min = String(cfg.minute || 0).padStart(2, '0')
    const agendaEl = $('prospect-auto-resumo-agenda')
    const janelaEl = $('prospect-auto-resumo-janela')
    const ultimoEl = $('prospect-auto-resumo-ultimo')
    const statusEl = $('prospect-auto-resumo-status')
    const capacidadeEl = $('prospect-auto-resumo-capacidade')
    const envioEl = $('prospect-auto-resumo-envio')
    const alertaEl = $('prospect-auto-capacity-alert')
    const alertaTextEl = $('prospect-auto-capacity-alert-text')
    const limite = Number(cfg.limite_diario || cfg.limit || 80)
    const slots = Number(agenda?.total_slots || 0)
    if (cfg.rodada_diaria) {
      if (agendaEl) agendaEl.textContent = `Segunda a sexta, ${hora}:${min} a ${cfg.horario_fim || '17:00'} — limite: ${cfg.limite_diario || cfg.limit || 80}/dia`
      if (janelaEl) {
        janelaEl.textContent = agenda?.total_slots
          ? `Prévia: ${agenda.total_slots} slots no próximo dia útil`
          : 'Sem slots para hoje conforme os dias ativos'
      }
    } else {
      const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
      const dia = dias[cfg.weekday || 1] || 'Seg'
      if (agendaEl) agendaEl.textContent = `${dia}, ${hora}:${min} a ${cfg.horario_fim || '17:00'} — limite: ${cfg.limite_diario || cfg.limit || 80}/dia`
      if (janelaEl && agenda) janelaEl.textContent = agenda.dentro_da_janela_enfileiramento ?'Dentro da janela de execução' : 'Aguardando janela'
    }
    if (ultimoEl && cfg.last_enqueued_at) ultimoEl.textContent = `Último enfileiramento: ${formatarHorario(cfg.last_enqueued_at)}`
    if (statusEl) statusEl.textContent = cfg.enabled ?'Ativa' : 'Desativada'
    if (capacidadeEl) capacidadeEl.textContent = `${Math.min(slots, limite)}/${limite}`
    if (janelaEl) janelaEl.textContent = slots ?`${slots} slots disponiveis na janela atual` : 'Sem slots conforme dias e horarios ativos'
    if (envioEl) envioEl.textContent = cfg.envio_real_habilitado ?'Ativado' : 'Desativado'
    if (ultimoEl) ultimoEl.textContent = cfg.last_enqueued_at ?`Ultimo enfileiramento: ${formatarHorario(cfg.last_enqueued_at)}` : (cfg.gerar_mensagem_ia ?'IA gera mensagens antes do envio' : 'Modo seguro: sem IA e sem WhatsApp')
    if (alertaEl) {
      const faltaSlot = slots > 0 && slots < limite
      alertaEl.hidden = !faltaSlot
      if (alertaTextEl) {
        alertaTextEl.textContent = faltaSlot
          ? `Sugestão: com a janela atual cabem ${slots} envios. Para chegar a ${limite}, reduza o intervalo ou aumente o horário.`
          : ''
      }
    }
    resumo.hidden = false
  }

  function aplicarAutoConfigForm(cfg, agenda, planejamento) {
    const safe = cfg || {}
    if ($('prospect-auto-enabled')) $('prospect-auto-enabled').value = String(!!safe.enabled)
    if ($('prospect-auto-weekday')) {
      const dias = Array.isArray(safe.dias_semana_ativos) ?safe.dias_semana_ativos.map(Number) : []
      $('prospect-auto-weekday').value = dias.length === 1 ?String(dias[0]) : String(safe.rodada_diaria !== false ? 7 : (safe.weekday || 1))
    }
    const horaInicial = `${String(safe.hour || 8).padStart(2, '0')}:${String(safe.minute || 0).padStart(2, '0')}`
    if ($('prospect-auto-start')) $('prospect-auto-start').value = horaInicial
    if ($('prospect-auto-hour')) $('prospect-auto-hour').value = String(safe.hour || 8)
    if ($('prospect-auto-minute')) $('prospect-auto-minute').value = String(safe.minute || 0)
    if ($('prospect-auto-end')) $('prospect-auto-end').value = safe.horario_fim || '17:00'
    if ($('prospect-auto-limit')) $('prospect-auto-limit').value = String(safe.limite_diario || safe.limit || 80)
    if ($('prospect-auto-intervalo')) $('prospect-auto-intervalo').value = String(safe.intervalo_envio_minutos || 30)
    if ($('prospect-auto-categoria')) $('prospect-auto-categoria').value = safe.categoria_padrao || safe.categoria || ''
    if ($('prospect-auto-cidade')) $('prospect-auto-cidade').value = safe.cidade_padrao || ''
    if ($('prospect-auto-estado')) $('prospect-auto-estado').value = safe.estado_padrao || ''
    if ($('prospect-auto-regiao')) $('prospect-auto-regiao').value = safe.regiao_padrao || ''
    if ($('prospect-auto-gerar-ia')) $('prospect-auto-gerar-ia').value = String(!!safe.gerar_mensagem_ia)
    if ($('prospect-auto-envio-real')) $('prospect-auto-envio-real').value = String(!!safe.envio_real_habilitado)
    aplicarModo(safe.modo || 'manual')
    aplicarResumoAutoConfig(safe, agenda)
    aplicarPlanejamentoBusca(planejamento)
  }

  async function carregarDailyConfig() {
    const r = await apiJson('/dashboard/prospeccao/configuracao', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) {
      aplicarModo('manual')
      toast(r.erro || 'Falha ao carregar configuração.', 'erro')
      return false
    }
    aplicarAutoConfigForm(r.data?.config || {}, r.data?.agenda || null, r.data?.planejamento_busca || null)
    return true
  }

  async function salvarDailyConfig() {
    const r = await apiJson('/dashboard/prospeccao/configuracao', { method: 'PUT', headers: headersJson(), body: JSON.stringify(lerAutoConfigForm()) })
    if (!r.ok) return toast(r.erro || 'Falha ao salvar configuração.', 'erro')
    aplicarAutoConfigForm(r.data?.config || {}, r.data?.agenda || null, r.data?.planejamento_busca || null)
    toast('Configuração salva.', 'sucesso')
  }

  let dailyFila = null
  let dailyHistorico = []
  let dailyBloqueios = []
  let dailyConfig = null
  let dailyReport = null
  let strategyAnalytics = null

  function fmtDataHora(iso) {
    if (!iso) return '-'
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return '-'
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function fmtDia(iso) {
    const s = String(iso || '').slice(0, 10)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return m ? `${m[3]}/${m[2]}` : (s || '-')
  }

  function modoLabel(v) {
    return ({ manual: 'Manual', semi_automatico: 'Semiautomático', automatico: 'Automático' })[v] || String(v || '-')
  }

  // Mercado escolhido na execução (nicho/cidade), gravado em config_snapshot.mercado.
  function mercadoLabel(e) {
    const cs = e && e.config_snapshot
    const mkt = cs && typeof cs === 'object' ? cs.mercado : null
    if (!mkt || !mkt.nicho) return ''
    return `${mkt.nicho}${mkt.cidade ? ` / ${mkt.cidade}` : ''}${mkt.origem === 'ia' ? ' (IA)' : ''}`
  }

  function statusLabel(v) {
    return ({
      aguardando_agendamento: 'Aguardando slot',
      simulado: 'Simulado',
      agendado: 'Agendado',
      enviando: 'Enviando',
      enviado: 'Enviado',
      respondido: 'Respondido',
      cancelado: 'Cancelado',
      falhou: 'Falhou',
      planejada: 'Planejada',
      montando_fila: 'Montando fila',
      em_execucao: 'Em execução',
      concluida: 'Concluída',
      cancelada: 'Pausada',
    })[v] || String(v || '-')
  }

  function renderDetailGrid(id, pares) {
    const el = $(id)
    if (!el) return
    el.innerHTML = (pares || [])
      .map((p) => `<div><span>${esc(p.label)}</span><strong>${esc(p.value == null || p.value === '' ? '-' : p.value)}</strong></div>`)
      .join('')
  }

  function setDailyText(id, value) {
    const el = $(id)
    if (el) el.textContent = value == null || value === '' ? '-' : String(value)
  }

  function renderReportVisual() {
    const host = $('daily-report-visual')
    if (!host) return
    const rep = dailyReport?.relatorio_json
      || (dailyReport && dailyReport.resumo ? dailyReport : null)
    if (!rep || !rep.resumo) {
      host.hidden = true
      host.innerHTML = ''
      return
    }
    const r = rep.resumo || {}
    const f = rep.funil || {}
    const enviados = Number(r.total_enviados || 0)
    const taxa = enviados > 0 ? Math.round(Number(r.taxa_resposta || 0) * 100) : 0
    const etapas = [
      { label: 'Enviados', value: enviados },
      { label: 'Respostas', value: Number(r.total_respostas || 0) },
      { label: 'Diagnóstico', value: Number(f.diagnostico || 0) },
      { label: 'Proposta', value: Number(f.proposta || 0) },
      { label: 'Reuniões', value: Number(f.reunioes || 0) },
      { label: 'Fechados', value: Number(f.fechados || 0) },
    ]
    const aprendizados = Array.isArray(rep.aprendizados) ? rep.aprendizados : []
    const local = [rep.cidade, rep.estado].filter(Boolean).join('/') || '-'
    const funilHtml = etapas
      .map((s, i) => `<div class="prospecting-report-stage"><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>${i < etapas.length - 1 ? '<i class="prospecting-report-arrow" aria-hidden="true">›</i>' : ''}`)
      .join('')
    host.innerHTML = `
      <div class="prospecting-report-meta">
        <span class="prospecting-report-badge">${esc(rep.data_referencia || '-')}</span>
        <span class="prospecting-report-badge">${esc(rep.categoria || '-')}</span>
        <span class="prospecting-report-badge">${esc(local)}</span>
        <span class="prospecting-report-badge prospecting-report-badge-accent">Taxa de resposta ${taxa}%</span>
      </div>
      <div class="prospecting-report-funnel">${funilHtml}</div>
      ${aprendizados.length ? `<ul class="prospecting-report-learnings">${aprendizados.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${rep.sugestao_proximo_dia ? `<p class="prospecting-report-suggestion"><strong>Próximo dia:</strong> ${esc(rep.sugestao_proximo_dia)}</p>` : ''}
    `
    host.hidden = false
  }

  function renderDailySummary() {
    const cfg = dailyConfig || {}
    const painel = dailyFila || {}
    const exec = painel.execucao || {}
    const resumo = painel.resumo || {}
    const snapshot = exec.config_snapshot || {}
    const categoria = snapshot.categoria_padrao || cfg.categoria_padrao || cfg.categoria || '-'
    const local = [snapshot.cidade_padrao || cfg.cidade_padrao, snapshot.estado_padrao || cfg.estado_padrao, snapshot.regiao_padrao || cfg.regiao_padrao].filter(Boolean).join(' / ')

    setDailyText('daily-modo', modoLabel(exec.modo || cfg.modo))
    setDailyText('daily-categoria', categoria)
    setDailyText('daily-local', local || '-')
    setDailyText('daily-encontrados', exec.total_encontrados || resumo.total || 0)
    setDailyText('daily-agendadas', resumo.mensagens_agendadas || exec.total_agendados || 0)
    setDailyText('daily-proximo', fmtDataHora(resumo.proximo_envio))
    if (!String($('daily-capacidade')?.textContent || '').includes('/')) {
      const limite = cfg.limite_diario || cfg.limit || 80
      setDailyText('daily-capacidade', `0 / ${limite}`)
    }
    atualizarStatusOperacional(cfg, null, { preservarCapacidade: true })
    const reportText = $('daily-report-text')
    if (reportText) {
      reportText.textContent =
        dailyReport?.texto_relatorio ||
        dailyReport?.relatorio_json?.texto_relatorio ||
        dailyReport?.relatorio_json?.texto ||
        'Nenhum relatório gerado para o dia.'
    }
    renderReportVisual()

    renderDetailGrid('daily-config-details', [
      { label: 'Modo', value: modoLabel(cfg.modo) },
      { label: 'Rotina ativa', value: cfg.ativo || cfg.enabled ? 'Sim' : 'Não' },
      { label: 'Janela', value: `${cfg.horario_inicio || '-'} até ${cfg.horario_fim || '-'}` },
      { label: 'Intervalo', value: `${cfg.intervalo_envio_minutos || '-'} min` },
      { label: 'Limite diário', value: cfg.limite_diario || cfg.limit || '-' },
      { label: 'Dias ativos', value: Array.isArray(cfg.dias_semana_ativos) ? cfg.dias_semana_ativos.join(', ') : '-' },
    ])

  }

  function dailyItemHtml(item) {
    const mensagem = item.mensagem_editada || item.mensagem_gerada || ''
    const podeGerar = ['simulado', 'agendado'].includes(item.status)
    const podeAgendar = ['simulado', 'agendado'].includes(item.status) && mensagem
    const podeCancelar = ['aguardando_agendamento', 'simulado', 'agendado'].includes(item.status)
    return `<article class="prospecting-daily-item">
      <div>
        <strong>${esc(item.nome_lead || item.prospect_nome || 'Lead')}</strong>
        <span>${esc(item.categoria || item.prospect_nicho || '-')} · ${esc(item.cidade || item.prospect_cidade || '-')}</span>
        <small>${esc(item.telefone_normalizado || '-')} · ${esc(statusLabel(item.status))} · slot ${esc(fmtDataHora(item.slot_envio))}</small>
      </div>
      <p>${esc(mensagem || item.ultimo_erro || 'Mensagem ainda não gerada.')}</p>
      <div class="prospecting-daily-actions">
        <button type="button" class="btn-followup" data-daily-action="gerar" data-daily-id="${esc(item.id)}"${podeGerar ? '' : ' disabled'}>Gerar mensagem</button>
        <button type="button" class="btn-followup" data-daily-action="editar" data-daily-id="${esc(item.id)}"${mensagem ? '' : ' disabled'}>Editar</button>
        <button type="button" class="btn-reproc" data-daily-action="agendar" data-daily-id="${esc(item.id)}"${podeAgendar ? '' : ' disabled'}>Agendar envio</button>
        <button type="button" class="btn-danger" data-daily-action="cancelar" data-daily-id="${esc(item.id)}"${podeCancelar ? '' : ' disabled'}>Excluir da fila</button>
      </div>
    </article>`
  }

  function bindDailyActions(root) {
    root.querySelectorAll('[data-daily-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.dailyId
        const action = btn.dataset.dailyAction
        if (!id || !action) return
        btn.disabled = true
        try {
          let r = null
          if (action === 'gerar') r = await apiJson(`/dashboard/prospeccao/fila-diaria/${encodeURIComponent(id)}/gerar-mensagem`, { method: 'POST', headers: headersJson(), body: JSON.stringify({}) })
          if (action === 'agendar') r = await apiJson(`/dashboard/prospeccao/fila-diaria/${encodeURIComponent(id)}/agendar-envio`, { method: 'POST', headers: headersJson(), body: JSON.stringify({}) })
          if (action === 'cancelar') r = await apiJson(`/dashboard/prospeccao/fila-diaria/${encodeURIComponent(id)}/cancelar`, { method: 'POST', headers: headersJson(), body: JSON.stringify({ motivo: 'operador_dashboard' }) })
          if (action === 'editar') {
            const atual = (dailyFila?.items || []).find((i) => String(i.id) === String(id))
            const texto = window.prompt('Editar mensagem antes do envio:', atual?.mensagem_editada || atual?.mensagem_gerada || '')
            if (!texto) return
            r = await apiJson(`/dashboard/prospeccao/fila-diaria/${encodeURIComponent(id)}/mensagem`, { method: 'PATCH', headers: headersJson(), body: JSON.stringify({ mensagem_editada: texto }) })
          }
          if (!r?.ok) return toast(r?.data?.erro || r?.erro || 'Falha na ação da fila.', 'erro')
          toast('Fila atualizada.', 'sucesso')
          await carregarPainelDiario()
        } finally {
          btn.disabled = false
        }
      })
    })
  }

  function renderDailyLists() {
    const items = dailyFila?.items || []
    const filaRoot = $('daily-fila-list')
    const msgRoot = $('daily-messages-list')
    const status = $('daily-fila-status')
    if (status) status.textContent = items.length ? `${items.length} item(ns) na fila diária.` : 'Nenhum item na fila diária.'
    if (filaRoot) {
      filaRoot.innerHTML = items.length ? items.map(dailyItemHtml).join('') : '<div class="empty-state"><strong>Nenhum item na fila diária</strong></div>'
      bindDailyActions(filaRoot)
    }
    if (msgRoot) {
      const comMsg = items.filter((i) => i.mensagem_editada || i.mensagem_gerada || ['simulado', 'agendado'].includes(i.status))
      msgRoot.innerHTML = comMsg.length ? comMsg.map(dailyItemHtml).join('') : '<div class="empty-state"><strong>Nenhuma mensagem gerada ainda</strong></div>'
      bindDailyActions(msgRoot)
    }

    const hist = $('daily-history-list')
    if (hist) {
      hist.innerHTML = dailyHistorico.length
        ? dailyHistorico.map((e) => `<article class="prospecting-daily-item"><div><strong>${esc(fmtDia(e.data_execucao))} · ${esc(statusLabel(e.status))}</strong>${mercadoLabel(e) ? `<span>${esc(mercadoLabel(e))}</span>` : ''}<small>${esc(e.total_encontrados || 0)} encontrados · ${esc(e.total_enviados || 0)} enviados · ${esc(e.total_respondidos || 0)} respostas</small></div></article>`).join('')
        : '<div class="empty-state"><strong>Nenhuma execução registrada</strong></div>'
    }

    const blocks = $('daily-blocks-list')
    if (blocks) {
      blocks.innerHTML = dailyBloqueios.length
        ? dailyBloqueios.map((b) => `<article class="prospecting-daily-item"><div><strong>${esc(b.telefone_normalizado || b.prospect_id || '-')}</strong><span>${esc(b.motivo || '-')} · ${esc(b.origem || '-')}</span><small>${b.ativo ? 'Ativo' : 'Inativo'} · expira ${esc(fmtDataHora(b.expira_em))}</small></div></article>`).join('')
        : '<div class="empty-state"><strong>Nenhum bloqueio registrado</strong></div>'
    }
  }

  async function carregarPainelDiario() {
    const [cfg, fila, historico, bloqueios, relatorio] = await Promise.all([
      apiJson('/dashboard/prospeccao/configuracao', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} }),
      apiJson('/dashboard/prospeccao/fila-diaria?limit=120', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} }),
      apiJson('/dashboard/prospeccao/execucoes?limit=20', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} }),
      apiJson('/dashboard/prospeccao/bloqueios?ativo=true&limit=50', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} }),
      apiJson('/dashboard/prospeccao/relatorio-diario', { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} }),
    ])
    if (cfg.ok) dailyConfig = cfg.data?.config || cfg.data || {}
    if (fila.ok) dailyFila = fila.data || {}
    if (historico.ok) dailyHistorico = Array.isArray(historico.data?.items) ? historico.data.items : []
    if (bloqueios.ok) dailyBloqueios = Array.isArray(bloqueios.data?.items) ? bloqueios.data.items : []
    if (relatorio.ok) dailyReport = relatorio.data?.relatorio || null
    renderDailySummary()
    renderDailyLists()
  }

  function selecionarAbaDiaria(tab) {
    document.querySelectorAll('[data-prospect-doc-tab]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.prospectDocTab === tab))
    document.querySelectorAll('[data-prospect-doc-panel]').forEach((panel) => {
      const active = panel.dataset.prospectDocPanel === tab
      panel.classList.toggle('is-active', active)
      panel.hidden = !active
    })
  }
  window.ProspeccaoDaily = { selecionarAba: selecionarAbaDiaria }

  function aplicarBuscaSugerida(btn) {
    const nicho = btn?.dataset?.planNicho || ''
    const cidade = btn?.dataset?.planCidade || ''
    if ($('prospect-auto-categoria') && nicho) $('prospect-auto-categoria').value = nicho
    if ($('daily-busca-nicho') && nicho) $('daily-busca-nicho').value = nicho
    if ($('prospect-auto-cidade') && cidade) $('prospect-auto-cidade').value = cidade
    if ($('daily-busca-cidade') && cidade) $('daily-busca-cidade').value = cidade
  }

  async function buscarEAlimentarFila(evt) {
    evt?.preventDefault?.()
    const categoria = $('daily-busca-nicho')?.value.trim() || $('prospect-auto-categoria')?.value.trim() || dailyConfig?.categoria_padrao || dailyConfig?.categoria
    const cidade = $('daily-busca-cidade')?.value.trim() || $('prospect-auto-cidade')?.value.trim() || dailyConfig?.cidade_padrao
    const estado = $('prospect-auto-estado')?.value.trim().toUpperCase() || dailyConfig?.estado_padrao || null
    const limit = Number($('daily-busca-qtd')?.value || dailyConfig?.limite_diario || 20)
    if (!categoria || !cidade) return toast('Informe nicho e cidade para buscar empresas.', 'erro')
    const btn = $('daily-busca-btn')
    if (btn) btn.disabled = true
    try {
      const r = await apiJson('/dashboard/prospeccao/fila-diaria/simular-places', {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({ categoria, cidade, estado, limit }),
      })
      if (!r.ok) return toast(r.data?.erro || r.erro || 'Falha ao buscar empresas no Places.', 'erro')
      toast('Empresas adicionadas à fila do dia.', 'sucesso')
      selecionarAbaDiaria('fila')
      await carregarPainelDiario()
    } finally {
      if (btn) btn.disabled = false
    }
  }

  async function pausarExecucaoDiariaAtual() {
    const id = dailyFila?.execucao?.id
    if (!id) return toast('Nenhuma execução diária carregada para pausar.', 'erro')
    const r = await apiJson(`/dashboard/prospeccao/execucoes/${encodeURIComponent(id)}/pausar`, {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({ motivo: 'operador_dashboard' }),
    })
    if (!r.ok) return toast(r.data?.erro || r.erro || 'Falha ao pausar execução.', 'erro')
    toast('Prospecção do dia pausada.', 'sucesso')
    await carregarPainelDiario()
  }

  async function gerarRelatorioDiario() {
    const r = await apiJson('/dashboard/prospeccao/relatorio-diario/gerar', {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({}),
    })
    if (!r.ok) return toast(r.data?.erro || r.erro || 'Falha ao gerar relatório diário.', 'erro')
    dailyReport = r.data?.relatorio || { texto_relatorio: r.data?.texto_relatorio, relatorio_json: r.data?.relatorio_json }
    renderDailySummary()
    toast('Relatório diário gerado.', 'sucesso')
  }

  async function enviarRelatorioDiario() {
    const r = await apiJson('/dashboard/prospeccao/relatorio-diario/enviar', {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({}),
    })
    if (!r.ok) return toast(r.data?.erro || r.erro || 'Falha ao enviar relatório.', 'erro')
    if (r.data?.enviado) toast(`Relatório enviado para ${r.data.enviados || 0} operador(es).`, 'sucesso')
    else toast(r.data?.motivo || 'Nenhum operador configurado para receber o relatório.', 'aviso')
    await carregarPainelDiario()
  }

  function dataIsoDiasAtras(dias) {
    const d = new Date()
    d.setDate(d.getDate() - Number(dias || 0))
    return d.toISOString().slice(0, 10)
  }

  function inicializarFiltrosEstrategicos() {
    if ($('strategy-end') && !$('strategy-end').value) $('strategy-end').value = dataIsoDiasAtras(0)
    if ($('strategy-start') && !$('strategy-start').value) $('strategy-start').value = dataIsoDiasAtras(29)
  }

  function lerFiltrosEstrategicos() {
    const params = new URLSearchParams()
    const campos = [
      ['inicio', $('strategy-start')?.value],
      ['fim', $('strategy-end')?.value],
      ['categoria', $('strategy-category')?.value],
      ['cidade', $('strategy-city')?.value],
      ['estado', $('strategy-state')?.value],
      ['modo', $('strategy-mode')?.value],
      ['status', $('strategy-status')?.value],
      ['custo_total', $('strategy-cost')?.value],
    ]
    campos.forEach(([k, v]) => {
      const valor = String(v == null ? '' : v).trim()
      if (valor) params.set(k, valor)
    })
    return params
  }

  function formatarPercentual(v) {
    return `${Math.round(Number(v || 0) * 100)}%`
  }

  function formatarDinheiro(v) {
    if (v == null || v === '') return '-'
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  function renderRankingEstrategico(id, rows) {
    const el = $(id)
    if (!el) return
    const lista = Array.isArray(rows) ? rows.slice(0, 3) : []
    if (!lista.length) {
      el.innerHTML = '<div class="empty-state"><strong>Sem dados no período</strong></div>'
      return
    }
    el.innerHTML = lista.map((r, i) => `<article class="prospecting-daily-item">
      <div>
        <strong>${i + 1}. ${esc(r.chave || 'sem dado')}</strong>
        <small>${esc(r.mensagens_enviadas || 0)} env · ${esc(r.respostas || 0)} resp · ${esc(formatarPercentual(r.taxa_resposta))} · ${esc(r.reunioes || 0)} reun · ${esc(r.fechados || 0)} fech</small>
      </div>
    </article>`).join('')
  }

  // Gráfico SVG simples (sem lib): por dia, barra clara = enviados, barra escura = respostas.
  function renderChartCrescimento(serie) {
    const el = $('strategy-chart')
    if (!el) return
    const dados = Array.isArray(serie) ? serie : []
    if (!dados.length) {
      el.innerHTML = '<div class="empty-state"><strong>Sem envios no período</strong></div>'
      return
    }
    const W = 720, H = 180, padL = 26, padB = 20, padT = 10
    const n = dados.length
    const max = Math.max(1, ...dados.map((d) => Number(d.enviados) || 0))
    const step = (W - padL - 4) / n
    const bw = Math.max(2, step - 2)
    const yTop = (v) => padT + (H - padT - padB) * (1 - (Number(v) || 0) / max)
    const hBar = (v) => (H - padT - padB) * ((Number(v) || 0) / max)
    const ddmm = (iso) => `${String(iso || '').slice(8, 10)}/${String(iso || '').slice(5, 7)}`
    const bars = dados.map((d, i) => {
      const xi = padL + i * step
      const env = Number(d.enviados) || 0
      const resp = Number(d.respostas) || 0
      const tip = `${ddmm(d.dia)}: ${env} enviados, ${resp} respostas`
      return `<rect x="${xi.toFixed(1)}" y="${yTop(env).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, hBar(env)).toFixed(1)}" rx="1.5" fill="#cdd7ff"><title>${esc(tip)}</title></rect>`
        + `<rect x="${xi.toFixed(1)}" y="${yTop(resp).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, hBar(resp)).toFixed(1)}" rx="1.5" fill="#3b5bdb"><title>${esc(tip)}</title></rect>`
    }).join('')
    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Envios e respostas por dia" style="display:block;max-width:100%">`
      + `<line x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${W - 2}" y2="${(H - padB).toFixed(1)}" stroke="#e2e6ef"/>`
      + `<text x="2" y="${padT + 7}" font-size="9" fill="#8a93a6">${max}</text>`
      + `<text x="2" y="${H - padB}" font-size="9" fill="#8a93a6">0</text>`
      + bars
      + `<text x="${padL}" y="${H - 5}" font-size="9" fill="#8a93a6">${esc(ddmm(dados[0].dia))}</text>`
      + `<text x="${W - 2}" y="${H - 5}" font-size="9" fill="#8a93a6" text-anchor="end">${esc(ddmm(dados[n - 1].dia))}</text>`
      + `</svg>`
      + `<div style="display:flex;gap:14px;margin-top:6px;font-size:12px;color:#6b7280">`
      + `<span><span style="display:inline-block;width:10px;height:10px;background:#cdd7ff;border-radius:2px;margin-right:4px"></span>Enviados</span>`
      + `<span><span style="display:inline-block;width:10px;height:10px;background:#3b5bdb;border-radius:2px;margin-right:4px"></span>Respostas</span>`
      + `</div>`
  }

  // Funil: Enviados → Respostas → Reuniões → Fechados, com conversão entre etapas.
  function renderFunil(m) {
    const el = $('strategy-funnel')
    if (!el) return
    const env = Number(m.mensagens_enviadas) || 0
    const resp = Number(m.respostas) || 0
    const reun = Number(m.reunioes) || 0
    const fech = Number(m.fechados) || 0
    const max = Math.max(1, env)
    const conv = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
    const etapas = [
      { label: 'Enviados', v: env, sub: '' },
      { label: 'Respostas', v: resp, sub: `${conv(resp, env)} das enviadas` },
      { label: 'Reuniões', v: reun, sub: `${conv(reun, resp)} das respostas` },
      { label: 'Fechados', v: fech, sub: `${conv(fech, reun)} das reuniões` },
    ]
    el.innerHTML = etapas.map((e) => {
      const w = Math.max(6, Math.round((e.v / max) * 100))
      return `<div style="display:flex;align-items:center;gap:10px;margin:6px 0">`
        + `<div style="flex:0 0 56px;text-align:right;font-weight:700">${e.v}</div>`
        + `<div style="flex:1;background:#eef1f7;border-radius:8px;overflow:hidden"><div style="width:${w}%;height:16px;background:#3b5bdb;border-radius:8px"></div></div>`
        + `<div style="flex:0 0 190px;font-size:12px;color:#374151"><strong>${esc(e.label)}</strong>${e.sub ? ` <span style="color:#8a93a6">· ${esc(e.sub)}</span>` : ''}</div>`
        + `</div>`
    }).join('')
  }

  function renderDashboardEstrategico() {
    const m = strategyAnalytics?.metricas || {}
    setDailyText('strategy-k-enviadas', m.mensagens_enviadas || 0)
    setDailyText('strategy-k-taxa', formatarPercentual(m.taxa_resposta))
    setDailyText('strategy-k-reunioes', m.reunioes || 0)
    setDailyText('strategy-k-fechados', m.fechados || 0)
    renderChartCrescimento(strategyAnalytics?.serie_diaria || [])
    renderFunil(m)
    const rankings = strategyAnalytics?.rankings || {}
    renderRankingEstrategico('strategy-rank-category', rankings.categorias)
    renderRankingEstrategico('strategy-rank-city', rankings.cidades)
  }

  async function carregarDashboardEstrategico() {
    inicializarFiltrosEstrategicos()
    const params = lerFiltrosEstrategicos()
    const qs = params.toString()
    const r = await apiJson(`/dashboard/prospeccao/analytics${qs ? `?${qs}` : ''}`, { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    if (!r.ok) return toast(r.data?.erro || r.erro || 'Falha ao carregar dashboard estrategico.', 'erro')
    strategyAnalytics = r.data || {}
    renderDashboardEstrategico()
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('daily-busca-form')?.addEventListener('submit', buscarEAlimentarFila)
    $('prospect-auto-salvar')?.addEventListener('click', salvarDailyConfig)
    $('prospect-auto-atualizar')?.addEventListener('click', carregarDailyConfig)
    $('prospect-daily-refresh')?.addEventListener('click', carregarPainelDiario)
    $('prospect-daily-refresh-fila')?.addEventListener('click', carregarPainelDiario)
    $('daily-pausar')?.addEventListener('click', pausarExecucaoDiariaAtual)
    $('daily-pausar-top')?.addEventListener('click', pausarExecucaoDiariaAtual)
    $('daily-report-generate')?.addEventListener('click', gerarRelatorioDiario)
    $('daily-report-send')?.addEventListener('click', enviarRelatorioDiario)
    $('strategy-apply')?.addEventListener('click', carregarDashboardEstrategico)
    document.querySelectorAll('[data-prospect-doc-tab]').forEach((btn) => btn.addEventListener('click', () => selecionarAbaDiaria(btn.dataset.prospectDocTab || 'configuracao')))
    document.querySelectorAll('[data-prospect-shortcut]').forEach((btn) => btn.addEventListener('click', () => selecionarAbaDiaria(btn.dataset.prospectShortcut || 'operacao')))
    $('prospect-suggest-interval-10')?.addEventListener('click', () => { if ($('prospect-auto-intervalo')) $('prospect-auto-intervalo').value = '10'; toast('Intervalo ajustado para 10 minutos. Salve para aplicar.', 'info') })
    $('prospect-suggest-end-21')?.addEventListener('click', () => { if ($('prospect-auto-end')) $('prospect-auto-end').value = '21:00'; toast('Janela ajustada até 21:00. Salve para aplicar.', 'info') })
    $('prospect-suggest-keep')?.addEventListener('click', () => { const el = $('prospect-auto-capacity-alert'); if (el) el.hidden = true })
    $('prospect-auto-planejamento-lista')?.addEventListener('click', async (evt) => {
      const btn = evt.target?.closest?.('button')
      if (!btn) return
      if (btn.hasAttribute('data-plan-ignore')) return btn.closest('li')?.remove()
      aplicarBuscaSugerida(btn)
      if (btn.hasAttribute('data-plan-queue')) {
        selecionarAbaDiaria('fila')
        await buscarEAlimentarFila()
      }
      else toast('Busca aplicada aos campos da rotina.', 'info')
    })
    $('prospect-modo')?.addEventListener('change', (e) => aplicarModo(e.target.value))
    carregarDailyConfig()
    carregarPainelDiario()
    carregarDashboardEstrategico()
    verificarStatusWhatsApp()
    window.setInterval(verificarStatusWhatsApp, 30000)

    $('whatsapp-status-banner-close')?.addEventListener('click', () => {
      const banner = $('whatsapp-status-banner')
      if (banner) banner.hidden = true
    })
  })

  async function verificarStatusWhatsApp() {
    try {
      const r = await apiJson('/dashboard/prospeccao/whatsapp/status', { method: 'GET', headers: headersJson() })
      const banner = $('whatsapp-status-banner')
      if (!banner) return
      const dados = r?.data || {}
      const conectado = dados.connected === true
      const instancia = dados.instance || 'pj-dashboard-1'
      const estado = dados.state || 'unknown'

      if (conectado) {
        banner.hidden = true
        return
      }

      // Só exibir banner quando sabemos com certeza que está desconectado
      if (dados.connected === false) {
        const instEl = $('whatsapp-status-banner-instance')
        if (instEl) instEl.textContent = instancia
        const msgEl = $('whatsapp-status-banner-msg')
        if (msgEl) {
          msgEl.innerHTML = `A instância <code id="whatsapp-status-banner-instance">${esc(instancia)}</code> está com status <strong>${esc(estado)}</strong>. Os disparos estão pausados até a reconexão.`
        }
        banner.hidden = false
      }
    } catch (_) {
      // falha silenciosa — não bloquear o painel se o endpoint de status falhar
    }
  }
})()
