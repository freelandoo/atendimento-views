/**
 * Central Operacional: fila de prioridades para o operador de vendas.
 */
;(function () {
  const Core = window.DashboardCore || {}
  const esc = Core.escHtml || ((s) => String(s == null ?'' : s))
  let filtroAtual = 'urgente'
  let dadosAtuais = null

  const PRIORIDADES_URGENTES = new Set([
    'falha_resposta',
    'handoff',
    'fila_preco',
    'preco_divergente',
    'precisa_responder',
  ])

  function motivos(c) {
    const arr = Array.isArray(c.motivos_prioridade) ?c.motivos_prioridade : []
    if (arr.length) return arr
    const out = []
    if (c.erro_resposta_pendente) out.push('Falha na resposta')
    if (c.status === 'aguardando_handoff') out.push('Handoff/aprovação')
    if (c.resposta_pendente) out.push('Precisa responder')
    if (c.lead_fila_preco_sem_calculo) out.push('Fila de preço')
    if (c.preco_ia_divergente_motor) out.push('Preço divergente')
    if (c.agente_pausado) out.push('Agente pausado')
    return out
  }

  function prioridadeClasse(p) {
    if (p === 'falha_resposta') return 'prio-falha'
    if (p === 'handoff') return 'prio-handoff'
    if (p === 'fila_preco') return 'prio-preco'
    if (p === 'preco_divergente') return 'prio-divergente'
    if (p === 'precisa_responder') return 'prio-responder'
    return 'prio-normal'
  }

  async function acaoLeadDashboard(url, numero, payload, method) {
    return Core.fetchJson(url, {
      method: method || 'POST',
      headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(true) : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero, ...(payload || {}) }),
    })
  }

  function linkConversas(extra) {
    const q = new URLSearchParams(extra || {})
    const s = q.toString()
    return 'conversas.html' + (s ?'?' + s : '')
  }

  function contar(conversas, fn) {
    return conversas.filter(fn).length
  }

  function isQuente(c) {
    return String(c.temperatura_lead || '').toLowerCase() === 'quente'
  }

  function isParado(c) {
    return !c.venda_fechada && !c.arquivado && (parseInt(c.idade_minutos, 10) || 0) >= 1440
  }

  function valorLead(c) {
    const n = Number(c.preco_calculado)
    return Number.isFinite(n) && n > 0 ?n : 0
  }

  function nomeLead(c) {
    return c.apelido || c.negocio || Core.formatarNumero?.(c.numero) || c.numero || 'Lead sem nome'
  }

  function formatarMoeda(valor) {
    try {
      return Number(valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0,
      })
    } catch (_) {
      return `R$ ${Math.round(valor || 0)}`
    }
  }

  function pesoForecast(c) {
    const est = String(c.estagio || '').toLowerCase()
    let peso = 0.18
    if (/proposta|negociacao|handoff|fechamento/.test(est) || c.status === 'aguardando_handoff') peso = 0.68
    else if (/diagnostico|recomendacao|preco|or[cç]amento/.test(est)) peso = 0.38
    else if (/primeiro|contato/.test(est)) peso = 0.16
    if (isQuente(c)) peso += 0.12
    if (c.resposta_pendente) peso += 0.05
    if (isParado(c)) peso -= 0.08
    return Math.min(0.85, Math.max(0.08, peso))
  }

  function setText(id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function atualizarResumo(d) {
    const conversas = Array.isArray(d.conversas) ?d.conversas : []
    const urgentes = conversas.filter((c) => PRIORIDADES_URGENTES.has(c.prioridade_operacional))
    const totalResponder = contar(conversas, (c) => c.resposta_pendente)
    const totalPreco = contar(conversas, (c) => c.lead_fila_preco_sem_calculo)
    const totalHandoff = contar(conversas, (c) => c.status === 'aguardando_handoff')
    const totalQuentes = contar(conversas, isQuente)
    const totalParados = contar(conversas, isParado)
    const totalPausados = contar(conversas, (c) => c.agente_pausado && !c.arquivado)
    const fechadas = parseInt(d.fechadas, 10) || 0
    const taxa = d.taxa_conversao != null ?`${d.taxa_conversao}%` : '0.0%'
    setText('ops-total-urgente', String(urgentes.length))
    setText('ops-total-urgente-sub', urgentes.length === 1 ?'1 conversa na fila' : `${urgentes.length} conversas na fila`)
    setText('ops-total-responder', String(totalResponder))
    setText('ops-total-preco', String(totalPreco))
    setText('ops-total-handoff', String(totalHandoff))
    setText('ops-total-quentes', String(totalQuentes))
    setText('ops-total-parados', String(totalParados))
    setText('ops-total-pausados', String(totalPausados))
    setText('ops-taxa-conversao', taxa)
    setText('ops-total-fechadas', fechadas === 1 ?'1 venda fechada' : `${fechadas} vendas fechadas`)
  }

  function filtrarFila(conversas) {
    if (filtroAtual === 'todos') return conversas
    if (filtroAtual === 'urgente') return conversas.filter((c) => PRIORIDADES_URGENTES.has(c.prioridade_operacional))
    if (filtroAtual === 'precisa_responder') return conversas.filter((c) => c.resposta_pendente)
    if (filtroAtual === 'fila_preco') return conversas.filter((c) => c.lead_fila_preco_sem_calculo)
    if (filtroAtual === 'handoff') return conversas.filter((c) => c.status === 'aguardando_handoff')
    if (filtroAtual === 'quentes') return conversas.filter(isQuente)
    if (filtroAtual === 'parados') return conversas.filter(isParado)
    if (filtroAtual === 'pausados') return conversas.filter((c) => c.agente_pausado && !c.arquivado)
    return conversas
  }

  function renderEstrategia(d) {
    const conversas = Array.isArray(d.conversas) ?d.conversas : []
    const abertas = conversas.filter((c) => !c.venda_fechada && !c.arquivado)
    const comValor = abertas.filter((c) => valorLead(c) > 0)
    const pipeline = comValor.reduce((acc, c) => acc + valorLead(c), 0)
    const forecast = comValor.reduce((acc, c) => acc + valorLead(c) * pesoForecast(c), 0)
    const followups = contar(abertas, (c) => !!c.followup_auto_em)
    const contEstagios = {}
    abertas.forEach((c) => {
      const k = c.estagio || 'sem etapa'
      contEstagios[k] = (contEstagios[k] || 0) + 1
    })
    const gargalo = Object.entries(contEstagios).sort((a, b) => b[1] - a[1])[0]

    setText('ops-pipeline-aberto', formatarMoeda(pipeline))
    setText('ops-forecast-ponderado', formatarMoeda(forecast))
    setText('ops-gargalo-principal', gargalo ?`${gargalo[0]} (${gargalo[1]})` : 'Sem dados')
    setText('ops-followups-futuros', String(followups))

    const topEl = document.getElementById('ops-top-oportunidades')
    if (topEl) {
      const top = comValor
        .slice()
        .sort((a, b) => {
          const sa = (isQuente(a) ?100000 : 0) + valorLead(a)
          const sb = (isQuente(b) ?100000 : 0) + valorLead(b)
          return sb - sa
        })
        .slice(0, 5)
      if (!top.length) {
        topEl.innerHTML = Core.emptyState ?Core.emptyState('Sem oportunidades precificadas', 'Leads com preço calculado aparecem aqui.') : '<div class="vazio">Sem oportunidades</div>'
      } else {
        topEl.innerHTML = top.map((c) => {
          const jid = String(c.numero || '')
          const tags = [
            c.temperatura_lead ?esc(c.temperatura_lead) : null,
            c.estagio ?esc(c.estagio) : null,
            isParado(c) ?'parado 24h+' : null,
          ].filter(Boolean)
          return (
            '<a class="ops-strategy-item" href="perfil-lead.html?numero=' + encodeURIComponent(jid) + '">' +
            '<span>' +
            `<strong>${esc(nomeLead(c))}</strong>` +
            `<small>${tags.join(' · ') || 'sem marcações'}</small>` +
            '</span>' +
            `<b>${formatarMoeda(valorLead(c))}</b>` +
            '</a>'
          )
        }).join('')
      }
    }

    const alertasEl = document.getElementById('ops-alertas-gestao')
    if (alertasEl) {
      const alertas = [
        {
          n: contar(abertas, (c) => isQuente(c) && isParado(c)),
          titulo: 'Quentes parados há 24h+',
          detalhe: 'retomar antes de esfriar',
          href: linkConversas({ temperatura: 'quente', ordenar: 'atualizado', direcao: 'asc' }),
        },
        {
          n: contar(abertas, (c) => c.resposta_pendente && (parseInt(c.idade_minutos, 10) || 0) >= 360),
          titulo: 'Respostas pendentes 6h+',
          detalhe: 'lead falou e aguarda retorno',
          href: linkConversas({ motivo: 'precisa_responder', ordenar: 'atualizado', direcao: 'asc' }),
        },
        {
          n: contar(abertas, (c) => c.agente_pausado),
          titulo: 'Agente pausado',
          detalhe: 'decidir se reativa ou assume manual',
          href: linkConversas({ motivo: 'agente_pausado' }),
        },
        {
          n: contar(abertas, (c) => c.preco_ia_divergente_motor),
          titulo: 'Preço divergente',
          detalhe: 'validar proposta antes de insistir',
          href: linkConversas({ motivo: 'preco_divergente' }),
        },
      ].filter((a) => a.n > 0)

      if (!alertas.length) {
        alertasEl.innerHTML = Core.emptyState ?Core.emptyState('Sem alertas críticos', 'A operação está sem bloqueios estratégicos neste recorte.') : '<div class="vazio">Sem alertas</div>'
      } else {
        alertasEl.innerHTML = alertas.map((a) => (
          `<a class="ops-strategy-alert" href="${a.href}">` +
          '<span>' +
          `<strong>${esc(a.titulo)}</strong>` +
          `<small>${esc(a.detalhe)}</small>` +
          '</span>' +
          `<b>${a.n}</b>` +
          '</a>'
        )).join('')
      }
    }
  }

  function renderFila(d) {
    const el = document.getElementById('ops-fila')
    if (!el) return
    const conversas = filtrarFila(Array.isArray(d.conversas) ?d.conversas : [])
      .slice()
      .sort((a, b) => {
        const pa = PRIORIDADES_URGENTES.has(a.prioridade_operacional) ?0 : 1
        const pb = PRIORIDADES_URGENTES.has(b.prioridade_operacional) ?0 : 1
        if (pa !== pb) return pa - pb
        return (b.idade_minutos || 0) - (a.idade_minutos || 0)
      })
      .slice(0, 12)

    if (!conversas.length) {
      el.innerHTML = Core.emptyState
        ?Core.emptyState('Fila limpa', 'Nenhuma conversa neste recorte operacional.')
        : '<div class="vazio">Fila limpa</div>'
      return
    }

    el.innerHTML = conversas
      .map((c) => {
        const jid = String(c.numero || '')
        const p = c.prioridade_operacional || 'acompanhamento'
        const negocio = c.apelido ?esc(c.apelido) : c.negocio ?esc(c.negocio) : 'Negócio não identificado'
        const preview = c.ultima_preview ?esc(c.ultima_preview) : 'Sem prévia de mensagem.'
        const badges = motivos(c).slice(0, 4).map((m) => Core.badge ?Core.badge(m, prioridadeClasse(p)) : `<span>${esc(m)}</span>`).join('')
        const temp = c.temperatura_lead ?`<span class="ops-temp">${esc(c.temperatura_lead)}</span>` : ''
        const reenviar = c.resposta_pendente
          ?`<button type="button" class="btn-reproc" data-central-reprocess="${esc(jid)}">Reenviar</button>`
          : ''
        const followup = `<button type="button" class="btn-followup" data-central-followup="${esc(jid)}">Follow-up</button>`
        const arquivar = `<button type="button" class="btn-followup" data-central-arquivar="${esc(jid)}">Arquivar</button>`
        const excluir = `<button type="button" class="btn-danger" data-central-excluir="${esc(jid)}">Excluir</button>`
        return (
          `<article class="ops-queue-item ${prioridadeClasse(p)}">` +
          '<div class="ops-queue-main">' +
          '<div class="ops-queue-top">' +
          `<a class="ops-lead-number" href="perfil-lead.html?numero=${encodeURIComponent(jid)}">${esc(Core.formatarNumero ?Core.formatarNumero(jid) : jid)}</a>` +
          `<span class="ops-age">${esc(Core.idadeLabel ?Core.idadeLabel(c.idade_minutos) : '')}</span>` +
          '</div>' +
          `<h3>${negocio}</h3>` +
          `<p>${preview}</p>` +
          `<div class="ops-queue-meta">${badges}${temp}<span>${esc(c.estagio || 'sem etapa')}</span></div>` +
          '</div>' +
          '<div class="ops-queue-actions">' +
          `<a class="btn-followup btn-link" href="perfil-lead.html?numero=${encodeURIComponent(jid)}">Abrir perfil</a>` +
          followup +
          arquivar +
          excluir +
          reenviar +
          '</div>' +
          '</article>'
        )
      })
      .join('')
  }

  function renderFunil(d) {
    const el = document.getElementById('ops-funil')
    if (!el) return
    const conversas = Array.isArray(d.conversas) ?d.conversas : []
    const total = conversas.length || 1
    const cont = {}
    conversas.forEach((c) => {
      const k = c.venda_fechada ?'fechado' : c.estagio || 'sem_etapa'
      cont[k] = (cont[k] || 0) + 1
    })
    const rows = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (!rows.length) {
      el.innerHTML = Core.emptyState ?Core.emptyState('Sem dados de funil') : '<div class="vazio">Sem dados</div>'
      return
    }
    el.innerHTML = rows.map(([k, n]) => {
      const pct = Math.round((n / total) * 100)
      return (
        '<div class="ops-stage-row">' +
        `<div><strong>${esc(k)}</strong><span>${n} conversa${n === 1 ?'' : 's'}</span></div>` +
        `<div class="ops-stage-bar"><span style="width:${pct}%"></span></div>` +
        '</div>'
      )
    }).join('')
  }

  function renderLacunas(d) {
    const el = document.getElementById('ops-lacunas')
    if (!el) return
    const lacunas = Array.isArray(d.lacunas_abertas_recentes) ?d.lacunas_abertas_recentes.slice(0, 5) : []
    if (!lacunas.length) {
      el.innerHTML = Core.emptyState ?Core.emptyState('Nenhuma lacuna aberta') : '<div class="vazio">Sem lacunas</div>'
      return
    }
    el.innerHTML = lacunas.map((l) => (
      '<div class="ops-mini-item">' +
      `<strong>${esc(l.tema_lacuna || 'Tema sem título')}</strong>` +
      `<span>${esc(l.negocio_lead || l.numero || 'Lead sem perfil')}</span>` +
      '</div>'
    )).join('')
  }

  async function carregarCentral() {
    const fila = document.getElementById('ops-fila')
    if (fila && !dadosAtuais) fila.innerHTML = Core.loadingState ?Core.loadingState('Carregando fila') : '<div class="vazio">carregando...</div>'
    const res = await Core.fetchJson('/dashboard/data?limit=500&ordenar=atualizado&direcao=desc', {
      headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {},
    })
    if (!res.ok) {
      if (fila) fila.innerHTML = Core.emptyState ?Core.emptyState('Erro ao carregar', res.erro) : '<div class="vazio">Erro</div>'
      Core.toast && Core.toast(res.erro || 'Erro ao carregar central', 'erro')
      return
    }
    dadosAtuais = res.data || {}
    atualizarResumo(dadosAtuais)
    renderEstrategia(dadosAtuais)
    renderFila(dadosAtuais)
    renderFunil(dadosAtuais)
    renderLacunas(dadosAtuais)
    const at = document.getElementById('atualizado-central')
    if (at) at.textContent = 'última atualização: ' + new Date().toLocaleTimeString('pt-BR')
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-priority-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filtroAtual = btn.dataset.priorityFilter || 'urgente'
        document.querySelectorAll('[data-priority-filter]').forEach((b) => b.classList.toggle('active', b === btn))
        if (dadosAtuais) renderFila(dadosAtuais)
      })
    })
    document.getElementById('ops-fila')?.addEventListener('click', async (e) => {
      const fu = e.target.closest('[data-central-followup]')
      const rp = e.target.closest('[data-central-reprocess]')
      const ar = e.target.closest('[data-central-arquivar]')
      const ex = e.target.closest('[data-central-excluir]')
      const numero =
        fu?.dataset.centralFollowup ||
        rp?.dataset.centralReprocess ||
        ar?.dataset.centralArquivar ||
        ex?.dataset.centralExcluir ||
        ''
      if (!numero) return
      const btn = fu || rp || ar || ex
      if (ar && !confirm('Arquivar este lead como "Ja encontrou e fechou com outro"?')) return
      if (ex && !confirm('Excluir permanentemente este lead, histórico e dados do funil? Esta ação não pode ser desfeita.')) return
      const prev = btn.textContent
      btn.disabled = true
      btn.textContent = ex ?'Excluindo...' : ar ?'Arquivando...' : 'Enviando...'
      try {
        const url = fu ?'/dashboard/followup' : rp ?'/dashboard/reprocessar' : ar ?'/dashboard/arquivar' : '/dashboard/conversas'
        const payload = ar ?{ arquivado: true, motivo: 'fechou_com_outro' } : {}
        const res = await acaoLeadDashboard(url, numero, payload, ex ?'DELETE' : 'POST')
        if (!res.ok) throw new Error(res.erro || 'Falha na ação')
        Core.toast &&
          Core.toast(
            fu ?'Follow-up enviado.' : rp ?'Resposta reenviada.' : ar ?'Lead arquivado.' : 'Lead excluido.',
            'sucesso'
          )
        await carregarCentral()
      } catch (err) {
        Core.toast && Core.toast(err.message || 'Falha na ação', 'erro')
      } finally {
        btn.disabled = false
        btn.textContent = prev
      }
    })
    carregarCentral()
    setInterval(carregarCentral, 10000)
  })
})()
