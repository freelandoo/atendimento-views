/**
 * Dashboard Custos: agregados de vendas.llm_chamadas via GET /dashboard/stats/llm-uso
 */
;(function () {
  const Core = window.DashboardCore || {}
  let chartCustos = null

  function escHtml(s) {
    return String(s == null ?'' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  async function fetchPainelJson(url, headers, timeoutMs) {
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ?timeoutMs : 45000
    const ac = new AbortController()
    const timer = setTimeout(function () {
      ac.abort()
    }, ms)
    const init = { signal: ac.signal }
    if (headers && typeof headers === 'object' && Object.keys(headers).length) {
      init.headers = headers
    }
    let r
    try {
      r = await fetch(url, init)
    } catch (err) {
      clearTimeout(timer)
      if (err && err.name === 'AbortError') {
        return {
          ok: false,
          erro: 'Tempo esgotado ao buscar dados (servidor ou rede demoraram demais).',
          status: 0,
        }
      }
      return { ok: false, erro: 'Falha de rede', status: 0 }
    }
    clearTimeout(timer)
    const raw = await r.text()
    let body = null
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch (_) {
        return {
          ok: false,
          erro: 'Resposta inválida (não é JSON).',
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
    if (body == null) {
      return {
        ok: false,
        status: r.status,
        erro: 'Resposta vazia do servidor (esperado JSON com totais).',
      }
    }
    return { ok: true, data: body, status: r.status }
  }

  function fmtInt(n) {
    const x = Number(n) || 0
    try {
      return x.toLocaleString('pt-BR')
    } catch (_) {
      return String(x)
    }
  }

  function fmtMoedaUsd(v) {
    const x = Number(v)
    if (!Number.isFinite(x)) return '—'
    try {
      return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
    } catch (_) {
      return 'US$ ' + x.toFixed(4)
    }
  }

  function fmtMoedaBrl(v) {
    const x = Number(v)
    if (!Number.isFinite(x)) return '—'
    try {
      return x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
    } catch (_) {
      return 'R$ ' + x.toFixed(2)
    }
  }

  function kpiBox(label, valueHtml, titleAttr) {
    const t = titleAttr ?' title="' + escAttr(titleAttr) + '"' : ''
    return (
      '<div class="followup-stat-box"' +
      t +
      '><span class="k">' +
      escHtml(label) +
      '</span><span class="v">' +
      valueHtml +
      '</span></div>'
    )
  }

  function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;')
  }

  function renderKpis(data) {
    const el = document.getElementById('custos-kpis')
    if (!el) return
    const t = data.totais || {}
    const est = data.estimativa
    const periodo = data.periodo || {}
    let subPeriodo = ''
    if (periodo.d0 && periodo.d1) {
      subPeriodo = periodo.d0 + ' — ' + periodo.d1 + ' · ' + (periodo.dias || '') + ' dias'
    }
    let html = ''
    html += kpiBox('Chamadas', fmtInt(t.chamadas), subPeriodo)
    html += kpiBox('Chamadas com erro HTTP', fmtInt(t.chamadas_erro), 'http_ok = false')
    html += kpiBox('Tokens entrada', fmtInt(t.input_tokens), 'input_tokens')
    html += kpiBox('Tokens saída', fmtInt(t.output_tokens), 'output_tokens')
    html += kpiBox('Cache write (tokens)', fmtInt(t.cache_creation_input_tokens), 'cache_creation_input_tokens')
    html += kpiBox('Cache read (tokens)', fmtInt(t.cache_read_input_tokens), 'cache_read_input_tokens')
    const avgMs = Math.round(Number(t.avg_duration_ms) || 0)
    html += kpiBox('Latência média', fmtInt(avgMs) + ' ms', 'duration_ms médio')
    if (est && data.precificacao_env_configurada) {
      html += kpiBox('Estimativa USD', fmtMoedaUsd(est.usd), 'LLM_ESTIMATE_*_PER_MTOK_USD')
      if (est.brl != null) {
        html += kpiBox('Estimativa BRL', fmtMoedaBrl(est.brl), 'via LLM_USD_BRL')
      }
    } else {
      html += kpiBox('Estimativa USD/BRL', '—', 'defina LLM_ESTIMATE_INPUT_PER_MTOK_USD e OUTPUT')
    }
    el.innerHTML = html
  }

  function renderTabela(containerId, rows, colTitulo) {
    const el = document.getElementById(containerId)
    if (!el) return
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="vazio" style="padding:1rem">Nenhum registro no período.</div>'
      return
    }
    const head =
      '<thead><tr><th>' +
      escHtml(colTitulo) +
      '</th><th>Chamadas</th><th>Tokens in</th><th>Tokens out</th></tr></thead>'
    const body =
      '<tbody>' +
      rows
        .map((r) => {
          const key = r.tipo != null ?r.tipo : r.model
          return (
            '<tr><td>' +
            escHtml(key || '(vazio)') +
            '</td><td>' +
            fmtInt(r.chamadas) +
            '</td><td>' +
            fmtInt(r.input_tokens) +
            '</td><td>' +
            fmtInt(r.output_tokens) +
            '</td></tr>'
          )
        })
        .join('') +
      '</tbody>'
    el.innerHTML = '<table>' + head + body + '</table>'
  }

  function atualizarGrafico(serie) {
    const ctx = document.getElementById('chart-custos-diario')
    if (!ctx || typeof Chart === 'undefined') return
    if (chartCustos) {
      chartCustos.destroy()
      chartCustos = null
    }
    if (!serie || !serie.length) return
    const labels = serie.map((x) => x.dia)
    const inputTok = serie.map((x) => x.input_tokens)
    const outputTok = serie.map((x) => x.output_tokens)
    chartCustos = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Tokens entrada (dia)',
            data: inputTok,
            borderColor: '#0f66f5',
            backgroundColor: 'rgba(15, 102, 245, 0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: 2,
          },
          {
            label: 'Tokens saída (dia)',
            data: outputTok,
            borderColor: '#7c3aed',
            backgroundColor: 'rgba(124, 58, 237, 0.1)',
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

  function mostrarErroCarregamento(mensagem) {
    const msg = (mensagem && String(mensagem).trim()) || 'Não foi possível carregar os dados.'
    const notaEl = document.getElementById('custos-nota')
    const atualizado = document.getElementById('atualizado-custos')
    const kpis = document.getElementById('custos-kpis')
    const tabTipo = document.getElementById('custos-tabela-tipo')
    const tabModel = document.getElementById('custos-tabela-model')
    const vazio = '<div class="vazio" style="padding:1rem">' + escHtml(msg) + '</div>'
    if (notaEl) notaEl.textContent = msg
    if (atualizado) atualizado.textContent = ''
    if (kpis) kpis.innerHTML = vazio
    if (tabTipo) tabTipo.innerHTML = vazio
    if (tabModel) tabModel.innerHTML = vazio
    if (chartCustos) {
      try {
        chartCustos.destroy()
      } catch (_) {}
      chartCustos = null
    }
  }

  async function carregar() {
    const diasEl = document.getElementById('custos-dias')
    const dias = Math.min(366, Math.max(1, parseInt(diasEl?.value, 10) || 30))
    try {
      sessionStorage.setItem('dashboard_custos_dias', String(dias))
    } catch (_) {}
    const hdrGet = Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {}

    try {
      const res = await fetchPainelJson('/dashboard/stats/llm-uso?dias=' + dias, hdrGet)

      if (res.status === 401) {
        window.location.href = 'login.html'
        return
      }

      if (!res.ok || !res.data) {
        mostrarErroCarregamento(res.erro || 'Erro ao carregar.')
        return
      }

      const d = res.data
      const notaEl = document.getElementById('custos-nota')
      const atualizado = document.getElementById('atualizado-custos')

      if (notaEl) {
        notaEl.textContent =
          (d.nota || '') +
          (d.precificacao_env_configurada ?'' : ' Estimativa monetária desativada até configurar preços por 1M tokens (USD).')
      }

      renderKpis(d)
      atualizarGrafico(d.serie_diaria)
      renderTabela('custos-tabela-tipo', d.por_tipo, 'Tipo')
      renderTabela('custos-tabela-model', d.por_model, 'Modelo')

      if (atualizado) {
        try {
          atualizado.textContent = 'Atualizado: ' + new Date().toLocaleString('pt-BR')
        } catch (_) {
          atualizado.textContent = 'Atualizado.'
        }
      }
    } catch (err) {
      mostrarErroCarregamento(err && err.message ?err.message : 'Erro inesperado ao carregar.')
    }
  }

  function init() {
    try {
      const diasEl = document.getElementById('custos-dias')
      try {
        const saved = sessionStorage.getItem('dashboard_custos_dias')
        if (saved && diasEl && ['7', '14', '30', '90'].includes(saved)) {
          diasEl.value = saved
        }
      } catch (_) {}
      diasEl?.addEventListener('change', carregar)
      carregar()
    } catch (err) {
      mostrarErroCarregamento(err && err.message ?err.message : 'Falha ao iniciar a página de custos.')
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
