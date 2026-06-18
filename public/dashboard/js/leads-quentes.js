/**
 * Carteira quente — worklist de leads para o operador "colher": já qualificados ou
 * com reunião ofertada, sem venda e sem reunião marcada, ranqueados por prioridade.
 * Lê /dashboard/leads-quentes (read-only). Cada linha abre o perfil do lead.
 */
;(function () {
  const ENDPOINT = '/dashboard/leads-quentes'

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function fmtNumero(jid) {
    const Core = window.DashboardCore || {}
    if (typeof Core.formatarNumero === 'function') return Core.formatarNumero(jid)
    return String(jid || '').replace(/@s\.whatsapp\.net$/i, '').replace(/@lid$/i, ' (lid)')
  }

  function haQuanto(iso) {
    if (!iso) return '—'
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 0) return '—'
    const min = Math.floor(ms / 60000)
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `há ${h}h`
    const d = Math.floor(h / 24)
    return `há ${d}d`
  }

  const CANAL_LABEL = { meta: 'Meta', prospeccao: 'Prospecção', inbound: 'Inbound' }

  function prioridade(lead) {
    if (lead.aguardando_resposta) return { txt: '⚡ aguardando você', cls: 'background:#3a1f16;color:#FFB084' }
    if (lead.ofereceu_reuniao) return { txt: '📅 reunião ofertada', cls: 'background:#16351f;color:#7CE39B' }
    return { txt: '🔥 qualificado', cls: '' }
  }

  function render(leads) {
    const el = document.getElementById('carteira-quente-lista')
    const totalEl = document.getElementById('cq-total')
    if (!el) return
    if (totalEl) totalEl.textContent = String(leads.length)
    if (!Array.isArray(leads) || !leads.length) {
      el.innerHTML = '<div class="empty-state"><strong>Nenhum lead quente parado.</strong><span>Tudo convertido ou agendado 👏</span></div>'
      return
    }
    const linhas = leads.map((l, i) => {
      const pri = prioridade(l)
      const nome = l.negocio ? esc(l.negocio) + (l.cidade ? ' · ' + esc(l.cidade) : '') : esc(fmtNumero(l.numero))
      const href = 'perfil-lead.html?numero=' + encodeURIComponent(l.numero)
      const score = l.score == null ? '—' : l.score
      return (
        '<tr>' +
        '<td style="text-align:right;opacity:.6">' + (i + 1) + '</td>' +
        '<td><a class="lead-numero-link" href="' + href + '">' + nome + '</a>' +
          '<div style="opacity:.6;font-size:.8em">' + esc(fmtNumero(l.numero)) + '</div></td>' +
        '<td>' + esc(CANAL_LABEL[l.canal] || l.canal || '—') + '</td>' +
        '<td style="text-align:right">' + score + '</td>' +
        '<td><span class="badge" style="' + pri.cls + '">' + pri.txt + '</span></td>' +
        '<td>' + haQuanto(l.ultima_atividade) + '</td>' +
        '<td style="text-align:right"><a class="btn-followup btn-link" href="' + href + '">Abrir</a></td>' +
        '</tr>'
      )
    })
    el.innerHTML =
      '<table><thead><tr>' +
      '<th style="text-align:right">#</th><th>Lead</th><th>Canal</th><th style="text-align:right">Score</th>' +
      '<th>Prioridade</th><th>Última atividade</th><th></th>' +
      '</tr></thead><tbody>' + linhas.join('') + '</tbody></table>'
  }

  async function carregar() {
    const el = document.getElementById('carteira-quente-lista')
    if (!el) return
    let r
    try {
      r = await fetch(ENDPOINT)
    } catch (_) {
      el.innerHTML = '<div class="empty-state"><strong>Falha de rede ao carregar a carteira.</strong></div>'
      return
    }
    let body = null
    try { body = await r.json() } catch (_) { body = null }
    if (!r.ok || !body || body.ok === false) {
      const msg = (body && (body.erro || body.error)) || ('Erro HTTP ' + r.status)
      el.innerHTML = '<div class="empty-state"><strong>' + esc(msg) + '</strong></div>'
      return
    }
    render(body.leads || [])
  }

  document.addEventListener('DOMContentLoaded', () => {
    carregar()
    setInterval(carregar, 60000)
  })
})()
