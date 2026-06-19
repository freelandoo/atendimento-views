/**
 * Página Visão geral: KPIs, distribuição por estágio, aprendizado do agente.
 */
;(function () {
  const Core = window.DashboardCore || {}
  const esc = Core.escHtml || ((s) => String(s == null ?'' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'))

  async function carregarVisaoGeral() {
    try {
      const r = await fetch('/dashboard/data', {
        headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
      })
      const d = await r.json()
      if (r.status === 401) {
        window.location.href = 'login.html'
        return
      }

      const elTotal = document.getElementById('total-leads')
      const elFech = document.getElementById('vendas-fechadas')
      const elTaxa = document.getElementById('taxa-conversao')
      if (elTotal) elTotal.textContent = d.total || d.total_leads || '—'
      if (elFech) elFech.textContent = d.fechadas || d.vendas_fechadas || '—'
      if (elTaxa) elTaxa.textContent = (d.taxa_conversao != null ?d.taxa_conversao : '—') + (d.taxa_conversao != null ?'%' : '')

      const contagem = {}
      ;(d.conversas || []).forEach((c) => {
        const e = c.venda_fechada ?'fechado' : c.estagio || 'primeiro_contato'
        contagem[e] = (contagem[e] || 0) + 1
      })
      const estagiosEl = document.getElementById('estagios')
      if (estagiosEl) {
        if (Object.keys(contagem).length === 0) {
          estagiosEl.innerHTML = '<div class="vazio">sem dados</div>'
        } else {
          const total = (d.conversas || []).length
          estagiosEl.innerHTML = Object.entries(contagem)
            .map(([e, n]) => {
              const pct = total > 0 ?((n / total) * 100).toFixed(0) : 0
              const cor = e === 'fechado' ?'var(--verde)' : 'var(--cinza3)'
              return (
                '<div style="margin-bottom:0.9rem">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
                '<span style="font-size:0.72rem;font-family:\'DM Mono\',monospace;color:var(--texto2)">' +
                esc(e) +
                '</span>' +
                '<span style="font-size:0.72rem;font-family:\'DM Mono\',monospace;color:var(--texto2)">' +
                n +
                ' (' +
                pct +
                '%)</span></div>' +
                '<div style="height:4px;background:var(--cinza2);border-radius:2px;overflow:hidden">' +
                '<div style="height:100%;width:' +
                pct +
                '%;background:' +
                cor +
                ';border-radius:2px;transition:width 0.6s"></div></div></div>'
              )
            })
            .join('')
        }
      }

      const aprend = d.aprendizado
      if (aprend) {
        const badge = document.getElementById('badge-aprendizado')
        const texto = document.getElementById('aprendizado-texto')
        if (typeof aprend === 'string') {
          if (badge) badge.textContent = '—'
          if (texto) {
            texto.textContent = aprend
            texto.classList.remove('vazio')
          }
        } else if (aprend && typeof aprend === 'object') {
          const data = aprend.criado_em ?new Date(aprend.criado_em).toLocaleString('pt-BR') : '—'
          if (badge) badge.textContent = data
          if (texto) {
            texto.textContent = aprend.resumo || ''
            texto.classList.remove('vazio')
          }
        }
      }

      const lacunasEl = document.getElementById('lacunas-lista')
      const lacunas = d.lacunas_abertas_recentes
      if (lacunasEl) {
        if (!Array.isArray(lacunas) || lacunas.length === 0) {
          lacunasEl.innerHTML = '<div class="vazio">nenhuma lacuna aberta registrada</div>'
        } else {
          lacunasEl.innerHTML = lacunas
            .map((row) => {
              const tema = esc(row.tema_lacuna || '')
              const det = esc(row.detalhe_lacuna || '')
              const neg = row.negocio_lead ?esc(row.negocio_lead) : '—'
              const quando = row.criado_em ?esc(new Date(row.criado_em).toLocaleString('pt-BR')) : '—'
              const num = esc(row.numero || '')
              return (
                '<div style="border-bottom:1px solid var(--cinza2);padding:0.65rem 0;font-size:0.72rem;line-height:1.45">' +
                '<div style="font-family:\'DM Mono\',monospace;color:var(--verde);margin-bottom:4px">' +
                tema +
                '</div>' +
                '<div style="color:var(--texto);margin-bottom:6px">' +
                det +
                '</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;color:var(--texto2);font-size:0.68rem">' +
                '<span>Lead: ' +
                num +
                '</span>' +
                '<span>Nicho: ' +
                neg +
                '</span>' +
                '<span>' +
                quando +
                '</span>' +
                '</div></div>'
              )
            })
            .join('')
        }
      }

      const atualizado = document.getElementById('atualizado-visao')
      if (atualizado) {
        atualizado.textContent = 'última atualização: ' + new Date().toLocaleTimeString('pt-BR')
      }
    } catch (e) {
      console.error(e)
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    carregarVisaoGeral()
    setInterval(carregarVisaoGeral, 10000)
  })
})()
