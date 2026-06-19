/**
 * Página Análises: gráfico diário, filtros, tabela amostral, export CSV.
 */
;(function () {
  let chartDiario = null
  let chartFollowup = null
  let painelEstagioInicializado = false

  function escHtml(s) {
    return String(s == null ?'' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Label legível para o eixo Y do gráfico de acordo com o estágio selecionado. */
  function labelParaEstagio(estagio) {
    const map = {
      fechado: 'Vendidos/Fechados por dia',
      primeiro_contato: 'Primeiro Contato por dia',
      primeiro_contato_prospeccao: 'Prospecção — Primeiro Contato por dia',
      diagnosticado: 'Diagnóstico Feito por dia',
      qualificado: 'Qualificados por dia',
      reuniao_agendada: 'Reunião Agendada por dia',
      proposta_enviada: 'Proposta Enviada por dia',
      contrato_enviado: 'Contrato Enviado por dia',
      perdido: 'Perdidos por dia',
      sem_resposta: 'Sem Resposta por dia',
    }
    return map[estagio] || (estagio ? 'Estágio "' + estagio + '" por dia' : 'Total por dia')
  }

  /** Taxa com_resposta / enviados_ok por modo de follow-up; null se não há envios. */
  function followupTaxaModoPct(enviadosOk, comResposta) {
    const ok = Number(enviadosOk) || 0
    const r = Number(comResposta) || 0
    if (ok <= 0) return null
    return Math.round((10000 * r) / ok) / 100
  }

  /**
   * GET com corpo JSON esperado; evita que HTML 404 quebre o painel inteiro.
   * @returns {Promise<{ ok: boolean, data?: any, erro?: string, status: number }>}
   */
  async function fetchPainelJson(url, headers) {
    const init =
      headers && typeof headers === 'object' && Object.keys(headers).length ?{ headers } : {}
    let r
    try {
      r = await fetch(url, init)
    } catch (err) {
      return { ok: false, erro: 'Falha de rede', status: 0 }
    }
    const raw = await r.text()
    let body = null
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch (_) {
        return {
          ok: false,
          erro: 'Resposta inválida (não é JSON). Verifique se a API está atualizada.',
          status: r.status,
        }
      }
    }
    if (r.status === 401) {
      return {
        ok: false,
        status: 401,
        erro: (body && (body.erro || body.error)) || 'Não autorizado — configure a chave em Configuração.',
      }
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        erro: (body && (body.erro || body.error)) || 'Erro HTTP ' + r.status,
      }
    }
    return { ok: true, data: body, status: r.status }
  }

  function paramsPainelLista() {
    const estagio = (document.getElementById('painel-estagio')?.value || '').trim()
    const desde = document.getElementById('painel-desde')?.value || ''
    const ate = document.getElementById('painel-ate')?.value || ''
    const q = new URLSearchParams()
    q.set('limit', '80')
    q.set('ordenar', 'atualizado')
    q.set('direcao', 'desc')
    if (estagio) q.set('estagio', estagio)
    if (desde) q.set('desde', desde)
    if (ate) q.set('ate', ate)
    return q
  }

  function persistPainelFilters() {
    sessionStorage.setItem('dashboard_painel_estagio', document.getElementById('painel-estagio')?.value || '')
    sessionStorage.setItem('dashboard_painel_desde', document.getElementById('painel-desde')?.value || '')
    sessionStorage.setItem('dashboard_painel_ate', document.getElementById('painel-ate')?.value || '')
    sessionStorage.setItem('dashboard_painel_dias', document.getElementById('painel-dias')?.value || '30')
  }

  /** Restaura período e datas antes do primeiro fetch (estágio depende das opções vindas da API). */
  function restorePainelFiltersDatas() {
    const desde = sessionStorage.getItem('dashboard_painel_desde')
    const ate = sessionStorage.getItem('dashboard_painel_ate')
    const dias = sessionStorage.getItem('dashboard_painel_dias')
    const elD = document.getElementById('painel-desde')
    const elA = document.getElementById('painel-ate')
    const elDi = document.getElementById('painel-dias')
    if (elD && desde) elD.value = desde
    if (elA && ate) elA.value = ate
    if (elDi && dias && [...elDi.options].some((o) => o.value === dias)) elDi.value = dias
  }

  function aplicarAbaAnalytics() {
    const abasValidas = new Set(['painel-avancado', 'follow-up'])
    const ativa = abasValidas.has(window.location.hash.slice(1))
      ?window.location.hash.slice(1)
      : 'painel-avancado'

    ;['painel-avancado', 'follow-up'].forEach((id) => {
      const card = document.getElementById(id)
      if (card) card.hidden = id !== ativa
    })

    document.querySelectorAll('[data-analytics-tab]').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('data-analytics-tab') === ativa)
    })

    window.setTimeout(() => {
      if (ativa === 'painel-avancado' && chartDiario) chartDiario.resize()
      if (ativa === 'follow-up' && chartFollowup) chartFollowup.resize()
    }, 0)
  }

  async function carregarPainelAvancado() {
    const diasEl = document.getElementById('painel-dias')
    const dias = Math.min(366, Math.max(1, parseInt(diasEl?.value, 10) || 30))
    const notaEl = document.getElementById('painel-nota-fechadas')
    const tabEl = document.getElementById('painel-tabela')
    const totalEl = document.getElementById('painel-total-filtrado')
    const gridFu = document.getElementById('followup-stats-grid')
    const notaFu = document.getElementById('followup-stats-nota')
    const tabFu = document.getElementById('followup-recentes-tabela')
    const Core = window.DashboardCore || {}
    const hdrGet = Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {}

    const estagioFiltro = (document.getElementById('painel-estagio')?.value || '').trim()
    const desdeFiltro = document.getElementById('painel-desde')?.value || ''
    const ateFiltro = document.getElementById('painel-ate')?.value || ''

    const diarioParams = new URLSearchParams()
    diarioParams.set('dias', String(dias))
    if (estagioFiltro) diarioParams.set('estagio', estagioFiltro)
    if (desdeFiltro) diarioParams.set('desde', desdeFiltro)
    if (ateFiltro) diarioParams.set('ate', ateFiltro)

    const [diarioRes, dataRes, followRes, recentRes] = await Promise.all([
      fetchPainelJson('/dashboard/stats/diario?' + diarioParams.toString(), hdrGet),
      fetchPainelJson('/dashboard/data?' + paramsPainelLista().toString(), hdrGet),
      fetchPainelJson('/dashboard/stats/followup?dias=' + dias, hdrGet),
      fetchPainelJson('/dashboard/followup-recentes?limit=40', hdrGet),
    ])

    if (diarioRes.status === 401 || dataRes.status === 401 || followRes.status === 401 || recentRes.status === 401) {
      window.location.href = 'login.html'
      return
    }

    const stats = diarioRes.ok ?diarioRes.data : null
    const dataLista = dataRes.ok ?dataRes.data : null

    const selEst = document.getElementById('painel-estagio')
    if (dataRes.ok && dataLista && selEst && Array.isArray(dataLista.estagios_disponiveis) && !painelEstagioInicializado) {
      selEst.innerHTML =
        '<option value="">Todos</option>' +
        dataLista.estagios_disponiveis
          .map(
            (e) =>
              '<option value="' + escHtml(e) + '">' + escHtml(e) + '</option>'
          )
          .join('')
      painelEstagioInicializado = true
      const savedEst = sessionStorage.getItem('dashboard_painel_estagio') || ''
      if (savedEst && [...selEst.options].some((o) => o.value === savedEst)) {
        selEst.value = savedEst
      }
      if (savedEst && dataLista.filtro && dataLista.filtro.estagio !== savedEst) {
        await carregarPainelAvancado()
        return
      }
    }

    if (notaEl) {
      if (!diarioRes.ok) {
        notaEl.textContent = diarioRes.erro || 'Não foi possível carregar o gráfico diário.'
      } else if (stats && stats.mode === 'dual') {
        notaEl.textContent = stats.nota_fechadas_diario || ''
      } else if (stats && stats.mode === 'single') {
        const tot = stats.totais
        if (tot && tot.total > 0) {
          const melhor = tot.melhorDia ? ' · Melhor dia: ' + tot.melhorDia : ''
          notaEl.textContent =
            'Total no período: ' + tot.total + ' · Média/dia: ' + tot.mediaDia + melhor
        } else {
          notaEl.textContent = 'Nenhum registro encontrado para este estágio no período selecionado.'
        }
      } else {
        notaEl.textContent = ''
      }
    }

    if (totalEl) {
      totalEl.textContent =
        dataLista && dataLista.filtro != null ?dataLista.filtro.total_filtrado : '—'
    }

    const chartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#667085', font: { family: "'DM Mono', monospace", size: 11 } },
        },
      },
      scales: {
        x: {
          ticks: { color: '#667085', maxRotation: 45, minRotation: 0, font: { size: 10 } },
          grid: { color: '#d9e1ee' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#667085', font: { size: 10 } },
          grid: { color: '#d9e1ee' },
        },
      },
    }

    const ctx = document.getElementById('chart-diario')
    if (ctx && typeof Chart !== 'undefined') {
      if (chartDiario) {
        chartDiario.destroy()
        chartDiario = null
      }
      if (stats && Array.isArray(stats.serie) && stats.serie.length > 0) {
        const labels = stats.serie.map((x) => x.dia)

        if (stats.mode === 'single') {
          const dados = stats.serie.map((x) => x.total)
          const semDados = dados.every((v) => v === 0)
          chartDiario = new Chart(ctx, {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: labelParaEstagio(stats.estagio),
                  data: dados,
                  borderColor: semDados ? '#d1d5db' : '#0f66f5',
                  backgroundColor: semDados
                    ? 'rgba(209, 213, 219, 0.08)'
                    : 'rgba(15, 102, 245, 0.12)',
                  fill: true,
                  tension: 0.25,
                  pointRadius: 2,
                },
              ],
            },
            options: chartOpts,
          })
        } else {
          const novas = stats.serie.map((x) => x.novas)
          const fechadas = stats.serie.map((x) => x.fechadas)
          chartDiario = new Chart(ctx, {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: 'Novas conversas (dia de criação)',
                  data: novas,
                  borderColor: '#0f66f5',
                  backgroundColor: 'rgba(15, 102, 245, 0.12)',
                  fill: true,
                  tension: 0.25,
                  pointRadius: 2,
                },
                {
                  label: 'Fechadas (aprox. por atualização)',
                  data: fechadas,
                  borderColor: '#667085',
                  backgroundColor: 'rgba(102, 112, 133, 0.08)',
                  fill: true,
                  tension: 0.25,
                  pointRadius: 2,
                },
              ],
            },
            options: chartOpts,
          })
        }
      }
    }

    if (tabEl) {
      if (!dataRes.ok) {
        tabEl.innerHTML =
          '<div class="vazio" style="padding:1rem">' +
          escHtml(dataRes.erro || 'Erro ao carregar lista filtrada') +
          '</div>'
      } else {
        const rows = dataLista.conversas || []
        if (rows.length === 0) {
          tabEl.innerHTML = '<div class="vazio" style="padding:1rem">nenhuma conversa com estes filtros</div>'
        } else {
          tabEl.innerHTML =
            '<table><thead><tr><th>Número</th><th>Estágio</th><th>Agente</th><th>Temp.</th><th>Msgs</th><th>Atualizado</th><th>Negócio</th></tr></thead><tbody>' +
            rows
              .map((c) => {
                const num = String(c.numero || '')
                  .replace('@s.whatsapp.net', '')
                  .replace(/^55/, '+55 ')
                const jid = String(c.numero || '')
                const dt = c.atualizado_em
                  ?new Date(c.atualizado_em).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'
                const st = c.venda_fechada ?'fechado' : c.estagio || '—'
                const ag = c.agente_pausado === true ?'pausado' : 'ativo'
                const neg = (c.negocio && String(c.negocio).slice(0, 32)) || '—'
                const temp = c.temperatura_lead ?escHtml(String(c.temperatura_lead)) : '—'
                return (
                  '<tr><td>' +
                  '<a class="lead-numero-link" href="perfil-lead.html?numero=' +
                  encodeURIComponent(jid) +
                  '">' +
                  escHtml(num) +
                  '</a>' +
                  '</td><td>' +
                  escHtml(st) +
                  '</td><td>' +
                  escHtml(ag) +
                  '</td><td>' +
                  temp +
                  '</td><td>' +
                  (c.mensagens != null ?c.mensagens : '—') +
                  '</td><td>' +
                  escHtml(dt) +
                  '</td><td>' +
                  escHtml(neg) +
                  '</td></tr>'
                )
              })
              .join('') +
            '</tbody></table>'
        }
      }
    }

    const statsFu = followRes.ok ?followRes.data : null
    if (followRes.ok && statsFu && statsFu.resumo && gridFu) {
      const r = statsFu.resumo
      const taxa = r.taxa_resposta_pct != null ?r.taxa_resposta_pct + '%' : '—'
      const pm = r.por_modo || {}
      const rej = pm.reengajamento || {}
      const fun = pm.fluxo_funil || {}
      const rejOk = rej.enviados_ok != null ?rej.enviados_ok : 0
      const rejResp = rej.com_resposta != null ?rej.com_resposta : 0
      const funOk = fun.enviados_ok != null ?fun.enviados_ok : 0
      const funResp = fun.com_resposta != null ?fun.com_resposta : 0
      const pctRej = followupTaxaModoPct(rejOk, rejResp)
      const pctFun = followupTaxaModoPct(funOk, funResp)
      const fmtPct = (p) => (p == null ?'—' : p + '%')
      const diasTxt = escHtml(String(dias))
      gridFu.innerHTML =
        '<div class="followup-secao-agregado">' +
        '<div class="followup-modo-card followup-modo-card--agregado">' +
        '<h4 class="followup-modo-titulo">Visão geral do período</h4>' +
        '<p class="followup-modo-hint">Totais de follow-up manual: envios concluídos com sucesso, respostas do lead depois do envio, taxa global e tentativas que não completaram o envio.</p>' +
        '<div class="followup-kpis-inner">' +
        '<div class="followup-stat-box"><span class="k">Enviados OK</span><span class="v">' +
        (r.enviados_ok != null ?r.enviados_ok : '0') +
        '</span><span class="followup-stat-hint">WhatsApp aceitou o envio</span></div>' +
        '<div class="followup-stat-box"><span class="k">Lead respondeu</span><span class="v">' +
        (r.com_resposta != null ?r.com_resposta : '0') +
        '</span><span class="followup-stat-hint">Alguma msg do lead depois</span></div>' +
        '<div class="followup-stat-box"><span class="k">Taxa resposta</span><span class="v">' +
        taxa +
        '</span><span class="followup-stat-hint">Respostas ÷ enviados OK</span></div>' +
        '<div class="followup-stat-box"><span class="k">Falhas envio</span><span class="v">' +
        (r.falhas_envio != null ?r.falhas_envio : '0') +
        '</span><span class="followup-stat-hint">Tentativas em que o envio não foi concluído com sucesso</span></div>' +
        '</div>' +
        '<p class="followup-modo-rodape">Estes números somam <strong>todos</strong> os follow-ups manuais nos <strong>últimos ' +
        diasTxt +
        ' dias</strong> (reengajamento e continuar no funil). A taxa de resposta usa no denominador apenas envios com sucesso.</p>' +
        '</div></div>' +
        '<div class="followup-modos-wrap">' +
        '<div class="followup-modo-card">' +
        '<h4 class="followup-modo-titulo">Reengajamento</h4>' +
        '<p class="followup-modo-hint">Última mensagem era <strong>assistente ou operador</strong>. Mensagem curta para retomar o contato (não muda o estágio do funil).</p>' +
        '<div class="followup-modo-metricas">' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Enviados com sucesso</span><span class="followup-modo-val">' +
        rejOk +
        '</span></div>' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Lead respondeu depois</span><span class="followup-modo-val">' +
        rejResp +
        '</span></div>' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Taxa neste modo</span><span class="followup-modo-val">' +
        fmtPct(pctRej) +
        '</span></div>' +
        '</div></div>' +
        '<div class="followup-modo-card">' +
        '<h4 class="followup-modo-titulo">Continuar no funil</h4>' +
        '<p class="followup-modo-hint">Última mensagem era do <strong>lead</strong>. O follow-up segue o fluxo comercial (próximo passo do funil).</p>' +
        '<div class="followup-modo-metricas">' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Enviados com sucesso</span><span class="followup-modo-val">' +
        funOk +
        '</span></div>' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Lead respondeu depois</span><span class="followup-modo-val">' +
        funResp +
        '</span></div>' +
        '<div class="followup-modo-metrica"><span class="followup-modo-lbl">Taxa neste modo</span><span class="followup-modo-val">' +
        fmtPct(pctFun) +
        '</span></div>' +
        '</div></div>' +
        '</div>'
      if (notaFu) notaFu.textContent = statsFu.nota || ''
      const ctxF = document.getElementById('chart-followup-diario')
      const sSerie = Array.isArray(statsFu.serie_diaria) ?statsFu.serie_diaria : []
      const labF = sSerie.map((x) => x.dia)
      const envF = sSerie.map((x) => x.enviados_ok)
      const respF = sSerie.map((x) => x.com_resposta)
      if (ctxF && typeof Chart !== 'undefined') {
        if (chartFollowup) chartFollowup.destroy()
        chartFollowup = new Chart(ctxF, {
          type: 'line',
          data: {
            labels: labF,
            datasets: [
              {
                label: 'Follow-ups enviados (OK)',
                data: envF,
                borderColor: '#0f66f5',
                backgroundColor: 'rgba(15, 102, 245, 0.1)',
                fill: true,
                tension: 0.25,
                pointRadius: 2,
              },
              {
                label: 'Resposta do lead (dia)',
                data: respF,
                borderColor: '#a78bfa',
                backgroundColor: 'rgba(167, 139, 250, 0.08)',
                fill: true,
                tension: 0.25,
                pointRadius: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                labels: { color: '#667085', font: { family: "'DM Mono', monospace", size: 11 } },
              },
            },
            scales: {
              x: {
                ticks: { color: '#667085', maxRotation: 45, minRotation: 0, font: { size: 10 } },
                grid: { color: '#d9e1ee' },
              },
              y: {
                beginAtZero: true,
                ticks: { color: '#667085', font: { size: 10 } },
                grid: { color: '#d9e1ee' },
              },
            },
          },
        })
      }
    } else if (gridFu) {
      gridFu.innerHTML =
        '<div class="vazio" style="padding:1rem">' +
        escHtml(!followRes.ok ?followRes.erro || 'Métricas de follow-up indisponíveis' : '—') +
        '</div>'
      if (notaFu) notaFu.textContent = ''
      if (chartFollowup) {
        chartFollowup.destroy()
        chartFollowup = null
      }
    }

    const recentFu = recentRes.ok ?recentRes.data : null
    if (recentRes.ok && tabFu && recentFu && Array.isArray(recentFu.itens)) {
      if (recentFu.itens.length === 0) {
        tabFu.innerHTML = '<div class="vazio" style="padding:0.5rem">nenhum follow-up registrado ainda</div>'
      } else {
        tabFu.innerHTML =
          '<table><thead><tr><th>Quando</th><th>Número</th><th>Modo</th><th>OK</th><th>Respondeu</th><th>Preview</th></tr></thead><tbody>' +
          recentFu.itens
            .map((it) => {
              const when = it.criado_em ?new Date(it.criado_em).toLocaleString('pt-BR') : '—'
              const num = String(it.numero || '')
                .replace('@s.whatsapp.net', '')
                .replace(/^55/, '+55 ')
              const prev = (it.mensagem_preview || '').slice(0, 80)
              const resp = it.resposta_lead_em ?'sim' : '—'
              return (
                '<tr><td>' +
                escHtml(when) +
                '</td><td>' +
                escHtml(num) +
                '</td><td>' +
                escHtml(it.modo || '') +
                '</td><td>' +
                (it.envio_ok ?'sim' : 'não') +
                '</td><td>' +
                escHtml(resp) +
                '</td><td title="' +
                escHtml(it.mensagem_preview || '') +
                '">' +
                escHtml(prev) +
                (prev.length >= 80 ?'…' : '') +
                '</td></tr>'
              )
            })
            .join('') +
          '</tbody></table>'
      }
    } else if (tabFu) {
      tabFu.innerHTML =
        '<div class="vazio" style="padding:0.5rem">' +
        escHtml(!recentRes.ok ?recentRes.erro || 'Lista de follow-ups indisponível' : '—') +
        '</div>'
    }

    const atualizado = document.getElementById('atualizado-analytics')
    if (atualizado) {
      atualizado.textContent = 'última atualização: ' + new Date().toLocaleTimeString('pt-BR')
    }
  }

  async function abrirExportCsv() {
    const Core = window.DashboardCore || {}
    const hdr = Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {}
    const q = paramsPainelLista()
    q.set('limit', '20000')
    const url = '/dashboard/export.csv?' + q.toString()
    let r
    try {
      r = await fetch(url, { headers: hdr })
    } catch (e) {
      console.error(e)
      window.alert('Falha de rede ao exportar.')
      return
    }
    if (r.status === 401) {
      window.location.href = 'login.html'
      return
    }
    if (!r.ok) {
      let msg = 'Erro ao exportar'
      const errText = await r.text()
      try {
        const j = JSON.parse(errText)
        if (j.erro) msg = j.erro
      } catch (_) {
        if (errText) msg = errText.slice(0, 240)
      }
      window.alert(msg)
      return
    }
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'conversas-dashboard.csv'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  }

  document.addEventListener('DOMContentLoaded', () => {
    restorePainelFiltersDatas()
    aplicarAbaAnalytics()
    carregarPainelAvancado()
    setInterval(carregarPainelAvancado, 30000)

    window.addEventListener('hashchange', aplicarAbaAnalytics)
    document.querySelectorAll('[data-analytics-tab]').forEach((link) => {
      link.addEventListener('click', () => {
        window.setTimeout(aplicarAbaAnalytics, 0)
      })
    })

    document.getElementById('btn-export-csv')?.addEventListener('click', abrirExportCsv)
    ;['painel-dias', 'painel-estagio', 'painel-desde', 'painel-ate'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        persistPainelFilters()
        carregarPainelAvancado()
      })
    })
  })
})()
