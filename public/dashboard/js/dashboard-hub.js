/**
 * Dashboard inicial: resume as áreas e direciona para as telas responsáveis.
 */
;(function () {
  const Core = window.DashboardCore || {}
  let carregando = false

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function numero(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  function pct(value) {
    return value == null ? '—' : `${String(value).replace('.', ',')}%`
  }

  function hojeLocal() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type) => parts.find((part) => part.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}`
  }

  function formatHora(value) {
    if (!value) return '--:--'
    return new Date(value).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function setSignal(id, label, critical) {
    const el = document.getElementById(id)
    if (!el) return
    el.textContent = label
    el.classList.toggle('is-critical', !!critical)
  }

  function renderOperacao(data) {
    const resumo = data?.resumo_operacional || {}
    setText('hub-acoes-agora', numero(resumo.acao_agora))
    setText('hub-score-70', numero(resumo.score_70))
    setText('hub-leads-quentes', numero(resumo.leads_quentes))
    setText('hub-sem-resposta', numero(resumo.sem_resposta))
    setText('hub-handoffs', numero(data?.handoffs))
    setText('hub-prospectados', numero(resumo.prospectados))
    setText('hub-meta-ads', numero(resumo.meta_ads))
    setText('hub-organicos', numero(resumo.organicos))

    const semResposta = numero(resumo.sem_resposta)
    const acoes = numero(resumo.acao_agora)
    setSignal(
      'hub-vendas-sinal',
      acoes > 0
        ? `${acoes} ação(ões) agora · ${semResposta} aguardando resposta`
        : 'Sem ações comerciais críticas neste momento',
      acoes > 0
    )
  }

  function renderAgenda(data) {
    const resumo = data?.resumo || {}
    const atrasados = numero(resumo.atrasados)
    setText('hub-agenda-atrasados', atrasados)
    setText('hub-agenda-area-atrasados', atrasados)
    setText('hub-agenda-hoje', numero(resumo.hoje))
    setText('hub-agenda-concluidos', numero(resumo.concluidos))

    const eventos = Array.isArray(data?.eventos) ? data.eventos : []
    const proximos = eventos
      .filter((evento) => ['pendente', 'atrasado'].includes(evento.status_efetivo || evento.status))
      .sort((a, b) => new Date(a.data_inicio) - new Date(b.data_inicio))
      .slice(0, 3)
    const root = document.getElementById('hub-proximos-eventos')
    if (root) {
      if (!proximos.length) {
        root.innerHTML = Core.emptyState
          ? Core.emptyState('Nenhum compromisso pendente hoje', 'Abra a agenda para consultar outros dias.')
          : '<div class="empty-state"><strong>Nenhum compromisso pendente hoje</strong></div>'
      } else {
        root.innerHTML = proximos.map((evento) => {
          const status = evento.status_efetivo || evento.status
          return (
            `<a class="dashboard-hub-event${status === 'atrasado' ? ' is-critical' : ''}" href="agenda.html">` +
            `<time>${Core.escHtml(formatHora(evento.data_inicio))}</time>` +
            `<strong>${Core.escHtml(evento.titulo || 'Compromisso')}</strong>` +
            `<span>${Core.escHtml(status === 'atrasado' ? 'Atrasado · abrir agenda' : evento.tipo || 'agenda')}</span>` +
            '</a>'
          )
        }).join('')
      }
    }

    const primeiro = proximos[0]
    setSignal(
      'hub-agenda-sinal',
      atrasados > 0
        ? `${atrasados} compromisso(s) atrasado(s) · resolver na Agenda`
        : primeiro
          ? `Próximo compromisso às ${formatHora(primeiro.data_inicio)}`
          : 'Agenda do dia sem pendências',
      atrasados > 0
    )
  }

  function renderMetricas(followupData, metaData) {
    const resumo = followupData?.resumo || {}
    const taxa = pct(resumo.taxa_resposta_pct)
    const falhas = numero(resumo.falhas_envio)
    const anuncios = Array.isArray(metaData?.anuncios) ? metaData.anuncios : []
    const reunioesMeta = anuncios.reduce((total, anuncio) => total + numero(anuncio.reunioes), 0)
    setText('hub-taxa-followup', taxa)
    setText('hub-metricas-taxa', taxa)
    setText('hub-followup-falhas', falhas)
    setText('hub-meta-reunioes', reunioesMeta)
    setSignal(
      'hub-metricas-sinal',
      falhas > 0
        ? `${falhas} falha(s) de follow-up no período · investigar`
        : `${numero(resumo.com_resposta)} resposta(s) em ${numero(resumo.enviados_ok)} envios`,
      falhas > 0
    )
  }

  function marcarErro(ids) {
    ids.forEach((id) => setText(id, '—'))
  }

  async function carregarDashboard() {
    if (carregando) return
    carregando = true
    const botao = document.getElementById('dashboard-hub-atualizar')
    if (botao) {
      botao.disabled = true
      botao.textContent = 'Atualizando...'
    }
    const headers = Core.headersComReprocessSecret ? Core.headersComReprocessSecret(false) : {}
    try {
      const [operacao, agenda, followup, meta] = await Promise.all([
        Core.fetchJson('/dashboard/data?limit=1&ordenar=atualizado&direcao=desc', { headers }),
        Core.fetchJson(`/dashboard/agenda?data=${encodeURIComponent(hojeLocal())}`, { headers }),
        Core.fetchJson('/dashboard/stats/followup?dias=30', { headers }),
        Core.fetchJson('/dashboard/meta/anuncios', { headers }),
      ])

      if (operacao.ok) renderOperacao(operacao.data)
      else marcarErro(['hub-acoes-agora', 'hub-score-70', 'hub-leads-quentes', 'hub-sem-resposta', 'hub-handoffs'])

      if (agenda.ok) renderAgenda(agenda.data)
      else marcarErro(['hub-agenda-atrasados', 'hub-agenda-area-atrasados', 'hub-agenda-hoje', 'hub-agenda-concluidos'])

      if (followup.ok || meta.ok) renderMetricas(followup.ok ? followup.data : {}, meta.ok ? meta.data : {})
      else marcarErro(['hub-taxa-followup', 'hub-metricas-taxa', 'hub-followup-falhas', 'hub-meta-reunioes'])

      const falhas = [operacao, agenda, followup, meta].filter((res) => !res.ok).length
      const atualizado = document.getElementById('atualizado-dashboard-hub')
      if (atualizado) {
        atualizado.textContent = falhas
          ? `atualização parcial: ${falhas} área(s) indisponível(is) · ${new Date().toLocaleTimeString('pt-BR')}`
          : `última atualização: ${new Date().toLocaleTimeString('pt-BR')}`
      }
    } finally {
      carregando = false
      if (botao) {
        botao.disabled = false
        botao.textContent = 'Atualizar agora'
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('dashboard-hub-atualizar')?.addEventListener('click', carregarDashboard)
    carregarDashboard()
    setInterval(carregarDashboard, 30000)
  })
})()
