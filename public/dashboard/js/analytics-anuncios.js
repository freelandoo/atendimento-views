/**
 * Aquisição / Anúncios: resultados Meta Ads / Click-to-WhatsApp.
 * Os números comerciais vêm do backend; o gasto informado continua local ao navegador.
 */
;(function () {
  const ENDPOINT = '/dashboard/meta/anuncios'
  const LS_PREFIX = 'meta_ad_spend:'
  const Core = window.DashboardCore || {}

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function brl(n) {
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  function numero(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  function pct(parte, total) {
    return total > 0 ? `${((parte / total) * 100).toFixed(1).replace('.', ',')}%` : '—'
  }

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function gastoSalvo(adId) {
    const raw = window.localStorage.getItem(LS_PREFIX + adId)
    const n = parseFloat(String(raw == null ? '' : raw).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  function recalcularLinha(tr) {
    const adId = tr.getAttribute('data-ad-id')
    const leads = parseInt(tr.getAttribute('data-leads'), 10) || 0
    const reunioes = parseInt(tr.getAttribute('data-reunioes'), 10) || 0
    const gasto = gastoSalvo(adId)
    const cplCell = tr.querySelector('[data-cell="cpl"]')
    const cprCell = tr.querySelector('[data-cell="cpr"]')
    if (gasto == null) {
      cplCell.textContent = '—'
      cprCell.textContent = '—'
      return
    }
    cplCell.textContent = leads > 0 ? brl(gasto / leads) : '—'
    cprCell.textContent = reunioes > 0 ? brl(gasto / reunioes) : 'sem reunião'
  }

  function renderResumo(anuncios) {
    const totais = anuncios.reduce((acc, anuncio) => {
      acc.leads += numero(anuncio.leads)
      acc.qualificados += numero(anuncio.qualificados)
      acc.reunioes += numero(anuncio.reunioes)
      acc.concluidas += numero(anuncio.reunioes_concluidas)
      const gasto = gastoSalvo(String(anuncio.ad_id || ''))
      if (gasto != null) acc.gasto += gasto
      return acc
    }, { leads: 0, qualificados: 0, reunioes: 0, concluidas: 0, gasto: 0 })

    setText('ads-total-leads', totais.leads)
    setText('ads-total-qualificados', totais.qualificados)
    setText('ads-total-reunioes', totais.reunioes)
    setText('ads-total-concluidas', totais.concluidas)
    setText('ads-taxa-qualificados', `${pct(totais.qualificados, totais.leads)} dos leads`)
    setText('ads-taxa-reunioes', `${pct(totais.reunioes, totais.leads)} dos leads`)
    setText('ads-taxa-concluidas', `${pct(totais.concluidas, totais.reunioes)} das reuniões`)
    setText('ads-custo-reuniao', totais.gasto > 0 && totais.reunioes > 0 ? brl(totais.gasto / totais.reunioes) : '—')

    const funil = document.getElementById('ads-funil')
    if (funil) {
      const etapas = [
        ['Leads Meta', totais.leads],
        ['Qualificados', totais.qualificados],
        ['Reuniões', totais.reunioes],
        ['Concluídas', totais.concluidas],
      ]
      funil.innerHTML = etapas.map(([label, value]) => {
        const largura = totais.leads > 0 ? Math.max(3, Math.round((value / totais.leads) * 100)) : 0
        return (
          '<div class="acquisition-funnel-row">' +
          `<span>${escHtml(label)}</span>` +
          `<div><i style="width:${largura}%"></i></div>` +
          `<strong>${value}</strong>` +
          '</div>'
        )
      }).join('')
    }

    const sinais = document.getElementById('ads-sinais')
    if (sinais) {
      const semReuniao = anuncios.filter((a) => numero(a.leads) > 0 && numero(a.reunioes) === 0).length
      const altoVolumeSemQualificar = anuncios.filter((a) => numero(a.leads) >= 10 && numero(a.qualificados) === 0).length
      const ativos = anuncios.filter((a) => a.ativo).length
      const melhor = anuncios
        .filter((a) => numero(a.leads) > 0)
        .slice()
        .sort((a, b) => (numero(b.reunioes) / numero(b.leads)) - (numero(a.reunioes) / numero(a.leads)))[0]
      const melhorConversao = melhor ? pct(numero(melhor.reunioes), numero(melhor.leads)) : '—'
      const itens = [
        ['Campanhas com leads e nenhuma reunião', semReuniao],
        ['Alto volume sem qualificados', altoVolumeSemQualificar],
        ['Anúncios ativos nos últimos 7 dias', ativos],
        ['Melhor conversão lead → reunião', melhorConversao],
      ]
      sinais.innerHTML = itens.map(([label, value]) => (
        '<div class="acquisition-signal-row">' +
        `<span>${escHtml(label)}</span><strong>${escHtml(value)}</strong>` +
        '</div>'
      )).join('')
    }
  }

  function render(anuncios) {
    const el = document.getElementById('anuncios-meta-tabela')
    if (!el) return
    if (!Array.isArray(anuncios) || !anuncios.length) {
      el.innerHTML = '<div class="vazio" style="padding: 1rem">Nenhum lead de anúncio (CTWA) registrado ainda.</div>'
      renderResumo([])
      return
    }
    const linhas = anuncios.map((a) => {
      const adId = String(a.ad_id || '')
      const adCurto = adId ? '…' + adId.slice(-6) : '—'
      const periodo = a.primeiro_contato
        ? escHtml(a.primeiro_contato) + (a.ultimo_contato && a.ultimo_contato !== a.primeiro_contato ? ' → ' + escHtml(a.ultimo_contato) : '')
        : '—'
      const status = a.ativo
        ? '<span class="badge acquisition-status-active">ativo</span>'
        : '<span class="badge">pausado</span>'
      const reunioesTxt = String(a.reunioes || 0) + (a.reunioes_concluidas ? ' (' + a.reunioes_concluidas + ' concl.)' : '')
      const gasto = gastoSalvo(adId)
      const gastoVal = gasto == null ? '' : String(gasto)
      return (
        '<tr data-ad-id="' + escHtml(adId) + '" data-leads="' + (a.leads || 0) + '" data-reunioes="' + (a.reunioes || 0) + '">' +
        '<td><div>' + escHtml(a.titulo || 'sem título') + '</div><div class="acquisition-ad-id">' + escHtml(adCurto) + '</div></td>' +
        '<td>' + status + '</td>' +
        '<td>' + periodo + '</td>' +
        '<td style="text-align:right">' + (a.leads || 0) + '</td>' +
        '<td style="text-align:right">' + (a.qualificados || 0) + '</td>' +
        '<td style="text-align:right">' + reunioesTxt + '</td>' +
        '<td style="text-align:right"><input type="number" min="0" step="1" inputmode="decimal" class="anuncio-gasto-input" ' +
        'value="' + escHtml(gastoVal) + '" placeholder="R$" aria-label="Gasto do anúncio em reais" style="width:90px;text-align:right" /></td>' +
        '<td style="text-align:right" data-cell="cpl">—</td>' +
        '<td style="text-align:right" data-cell="cpr">—</td>' +
        '</tr>'
      )
    })
    el.innerHTML =
      '<table><thead><tr>' +
      '<th>Anúncio</th><th>Status</th><th>Período</th>' +
      '<th style="text-align:right">Leads</th><th style="text-align:right">Qualif.</th><th style="text-align:right">Reuniões</th>' +
      '<th style="text-align:right">Gasto (R$)</th><th style="text-align:right">Custo/lead</th><th style="text-align:right">Custo/reunião</th>' +
      '</tr></thead><tbody>' + linhas.join('') + '</tbody></table>'

    el.querySelectorAll('tr[data-ad-id]').forEach((tr) => {
      recalcularLinha(tr)
      const input = tr.querySelector('.anuncio-gasto-input')
      if (!input) return
      input.addEventListener('input', () => {
        const adId = tr.getAttribute('data-ad-id')
        const value = String(input.value || '').trim()
        if (value === '') window.localStorage.removeItem(LS_PREFIX + adId)
        else window.localStorage.setItem(LS_PREFIX + adId, value)
        recalcularLinha(tr)
        renderResumo(anuncios)
      })
    })
    renderResumo(anuncios)
  }

  async function carregar() {
    const el = document.getElementById('anuncios-meta-tabela')
    if (!el) return
    const response = Core.fetchJson
      ? await Core.fetchJson(ENDPOINT, { headers: Core.headersComReprocessSecret ? Core.headersComReprocessSecret(false) : {} })
      : { ok: false, erro: 'DashboardCore indisponível' }
    if (!response.ok || !response.data || response.data.ok === false) {
      const message = response.erro || (response.data && (response.data.erro || response.data.error)) || 'Falha ao carregar anúncios'
      el.innerHTML = '<div class="vazio" style="padding: 1rem">' + escHtml(message) + '</div>'
      return
    }
    render(response.data.anuncios || [])
    const atualizado = document.getElementById('atualizado-anuncios')
    if (atualizado) atualizado.textContent = 'última atualização: ' + new Date().toLocaleTimeString('pt-BR')
  }

  document.addEventListener('DOMContentLoaded', carregar)
})()
