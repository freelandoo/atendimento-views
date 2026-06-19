/**
 * Página Perfil do lead: detalhe da conversa, perfil, lacunas, coach IA e prompt Gamma.
 */
;(function () {
  const Core = window.DashboardCore || {}

  function formatarNumeroDisplay(numero) {
    if (!numero) return '—'
    return String(numero).replace('@s.whatsapp.net', '').replace(/^55/, '+55 ')
  }

  function digitsWaMe(numero) {
    return String(numero || '')
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/\D/g, '')
  }

  function esc(s) {
    if (s == null) return ''
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  const HERO_IC = {
    phone:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    copy:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    mail:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    refresh:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    more:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    briefcase:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    map:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.99-5.54 10.19-7.4 11.79a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
    money:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg>',
    users:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chart:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    clock:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    check:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    alert:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    spark:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.2L5 10l5.1 1.8L12 17l1.9-5.2L19 10l-5.1-1.8Z"/><path d="M19 3v4"/><path d="M21 5h-4"/><path d="M5 17v3"/><path d="M6.5 18.5h-3"/></svg>',
  }

  function heroIcoSpan(key) {
    const svg = HERO_IC[key] || ''
    return '<span class="conversa-acao-ico-svg" aria-hidden="true">' + svg + '</span>'
  }

  /** @param {HTMLElement | null} el */
  function setHeroAcaoLoading(el, busy) {
    if (!el) return
    el.disabled = !!busy
    if (busy) el.setAttribute('aria-busy', 'true')
    else el.removeAttribute('aria-busy')
    el.classList.toggle('is-loading', !!busy)
    el.classList.remove('is-done')
  }

  /** @param {HTMLElement | null} el */
  function setHeroAcaoDone(el) {
    if (!el) return
    el.removeAttribute('aria-busy')
    el.classList.remove('is-loading')
    el.classList.add('is-done')
  }

  function headersGet() {
    return Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {}
  }

  function headersPostJson() {
    return Core.headersComReprocessSecret
      ?Core.headersComReprocessSecret(true)
      : { 'Content-Type': 'application/json' }
  }

  function mostrarErro(msg) {
    const el = document.getElementById('perfil-erro')
    if (!el) return
    el.hidden = !msg
    el.textContent = msg || ''
  }

  async function copiarTexto(text) {
    const t = String(text || '')
    try {
      await navigator.clipboard.writeText(t)
      alert('Copiado para a área de transferência.')
    } catch (_) {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        alert('Copiado para a área de transferência.')
      } catch (e2) {
        alert('Não foi possível copiar automaticamente; selecione o texto manualmente.')
      }
      document.body.removeChild(ta)
    }
  }

  function leadVal(p, keys, fallback) {
    const arr = Array.isArray(keys) ?keys : [keys]
    for (const key of arr) {
      if (!p || p[key] == null || p[key] === '') continue
      const v = p[key]
      if (Array.isArray(v)) return v.length ?v.join(', ') : fallback
      if (typeof v === 'boolean') return v ?'Sim' : 'Não'
      return String(v)
    }
    return fallback || '—'
  }

  function renderInfoItem(icon, label, value) {
    return (
      `<div class="lead-info-item">` +
      `<span class="lead-info-icon">${heroIcoSpan(icon)}</span>` +
      `<span><small>${esc(label)}</small><strong>${esc(value)}</strong></span>` +
      `</div>`
    )
  }

  function jsonResumo(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return ''
    const parts = Object.entries(v)
      .filter(([, val]) => val != null && val !== '' && !(Array.isArray(val) && val.length === 0))
      .map(([key, val]) => {
        if (typeof val === 'boolean') return `${key}: ${val ?'sim' : 'nao'}`
        if (typeof val === 'object') return `${key}: ${jsonResumo(val) || JSON.stringify(val)}`
        return `${key}: ${val}`
      })
      .filter(Boolean)
      .slice(0, 8)
    return parts.join(' | ')
  }

  function renderFluxoComercial(p) {
    if (!p || typeof p !== 'object') return ''
    const flags = [
      p.confusao_site_anuncio_google && 'confusao site/anuncio/Google',
      p.explicacao_teste_gratis_enviada && 'teste gratis explicado',
      p.expectativa_google_alinhada && 'expectativa Google alinhada',
      p.personalizacao_nicho_cidade_enviada && 'personalizacao enviada',
    ].filter(Boolean)
    const itens =
      renderInfoItem('search', 'Origem do anuncio', jsonResumo(p.origem_anuncio) || '—') +
      renderInfoItem('chart', 'Maturidade digital', jsonResumo(p.maturidade_digital) || '—') +
      renderInfoItem('briefcase', 'Intencao principal', leadVal(p, 'intencao_principal', '—')) +
      renderInfoItem('briefcase', 'Produto sugerido', leadVal(p, 'produto_sugerido', '—')) +
      renderInfoItem('users', 'Reuniao proposta', jsonResumo(p.reuniao_proposta) || '—') +
      renderInfoItem('chart', 'Eventos da conversa', jsonResumo(p.eventos_conversa) || '—') +
      renderInfoItem('briefcase', 'Dor principal', leadVal(p, 'dor_principal', '—')) +
      renderInfoItem('clock', 'Flags Meta Ads', flags.length ?flags.join(', ') : '—')
    return '<div class="lead-profile-grid lead-profile-flow-grid">' + itens + '</div>'
  }

  function interesseLabel(score) {
    if (score >= 75) return 'Interesse alto'
    if (score >= 45) return 'Interesse médio'
    return 'Interesse inicial'
  }

  // Campos REALMENTE coletados na conversa (campos_coletados JSONB). Sem inventar.
  const CAMPOS_COLETADOS_LABEL = {
    nome: 'Nome', nome_completo: 'Nome', email: 'E-mail', telefone: 'Telefone',
    instagram: 'Instagram', site: 'Site', website: 'Site',
    google_meu_negocio: 'Google Meu Negócio', gmb: 'Google Meu Negócio',
  }
  // Não duplicar o que já aparece no grid principal nem no card de Contato.
  const CAMPOS_COLETADOS_OCULTAR = new Set([
    'negocio', 'cidade', 'necessidade', 'produto_sugerido',
    'nome', 'nome_completo', 'email', 'telefone', 'instagram',
    'site', 'website', 'google_meu_negocio', 'gmb',
  ])

  function labelCampoColetado(k) {
    const key = String(k || '').trim()
    if (CAMPOS_COLETADOS_LABEL[key]) return CAMPOS_COLETADOS_LABEL[key]
    return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  }

  // Bloco de Contato: dados reais (campos_coletados + telefone do JID). Sem inventar;
  // só renderiza o que existe, com rótulos amigáveis e links úteis (WhatsApp/e-mail).
  function renderContatoItemLink(icon, label, value, href) {
    return (
      `<div class="lead-info-item">` +
      `<span class="lead-info-icon">${heroIcoSpan(icon)}</span>` +
      `<span><small>${esc(label)}</small>` +
      (href ? `<strong><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a></strong>` : `<strong>${esc(value)}</strong>`) +
      `</span></div>`
    )
  }

  function renderContato(d) {
    const p = d.perfil || {}
    const cc = p.campos_coletados && typeof p.campos_coletados === 'object' && !Array.isArray(p.campos_coletados) ? p.campos_coletados : {}
    const phone = digitsWaMe(d.numero)
    const nome = String(cc.nome || cc.nome_completo || p.apelido || '').trim()
    const email = String(cc.email || '').trim()
    const instagram = String(cc.instagram || '').trim()
    const site = String(cc.site || cc.website || '').trim()
    const itens = [
      nome ? renderInfoItem('users', 'Nome', nome) : '',
      phone ? renderContatoItemLink('phone', 'Telefone', formatarNumeroDisplay(d.numero), `https://wa.me/${phone}`) : '',
      email ? renderContatoItemLink('mail', 'E-mail', email, `mailto:${email}`) : '',
      instagram ? renderInfoItem('search', 'Instagram', instagram) : '',
      site ? renderContatoItemLink('search', 'Site', site, /^https?:/i.test(site) ? site : `https://${site}`) : '',
    ].filter(Boolean).join('')
    return (
      `<div class="card lead-col-4 lead-contato-card">` +
      `<div class="card-titulo"><span>Contato</span></div>` +
      (itens ? `<div class="lead-profile-grid">${itens}</div>` : '<p class="perfil-sem-dados">Só o telefone por enquanto — nome/e-mail ainda não coletados.</p>') +
      `</div>`
    )
  }

  function renderCamposColetados(p) {
    const cc = p && p.campos_coletados
    const obj = cc && typeof cc === 'object' && !Array.isArray(cc) ? cc : null
    if (!obj) return ''
    return Object.entries(obj)
      .filter(([k, v]) => !CAMPOS_COLETADOS_OCULTAR.has(String(k)) && v != null && v !== '' && !(Array.isArray(v) && !v.length))
      .slice(0, 10)
      .map(([k, v]) => {
        const val = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? jsonResumo(v) : String(v)
        return val ? renderInfoItem('check', labelCampoColetado(k), val) : ''
      })
      .join('')
  }

  // Sinais do lead capturados pela IA a cada turno (insights_lead). Só o que existe.
  function renderSinaisLead(insights) {
    const o = insights && typeof insights === 'object' && !Array.isArray(insights) ? insights : null
    const arr = (v) => (Array.isArray(v) && v.length ? v.join(', ') : '')
    const linha = (icon, label, val) => (val ? renderInfoItem(icon, label, val) : '')
    const urg = o && o.urgencia ? (o.prazo ? `${o.urgencia} (${o.prazo})` : o.urgencia) : ''
    const itens = o
      ? [
          linha('users', 'Como capta clientes hoje', o.origem_clientes),
          linha('clock', 'Urgência', urg),
          linha('money', 'Orçamento citado', o.orcamento_mencionado),
          linha('check', 'É o decisor?', o.eh_decisor),
          linha('search', 'Concorrentes citados', arr(o.concorrentes_mencionados)),
          linha('spark', 'Sinais de compra', arr(o.sinais_compra)),
          linha('alert', 'Objeções', arr(o.objecoes)),
        ].filter(Boolean).join('')
      : ''
    const obs = o && o.observacao_curta ? `<p class="lead-sinais-obs">“${esc(o.observacao_curta)}”</p>` : ''
    return (
      `<div class="card lead-col-8 lead-sinais-card">` +
      `<div class="card-titulo"><span>Sinais do lead (IA)</span></div>` +
      (itens
        ? `<div class="lead-profile-grid">${itens}</div>${obs}`
        : '<p class="perfil-sem-dados">A IA ainda não captou sinais específicos deste lead.</p>') +
      `</div>`
    )
  }

  // score vem da análise da IA (coach.score). Nunca inventamos um valor.
  function renderPerfil(p, iaScore) {
    const temScore = iaScore != null && Number.isFinite(Number(iaScore))
    const score = temScore ? Math.max(0, Math.min(100, Math.round(Number(iaScore)))) : null
    const itens =
      renderInfoItem('briefcase', 'Negócio', leadVal(p, 'negocio', '—')) +
      renderInfoItem('map', 'Cidade', leadVal(p, ['cidade', 'regiao_atendimento'], '—')) +
      renderInfoItem('money', 'Ticket cliente/mês', leadVal(p, 'ticket_cliente_final', '—')) +
      renderInfoItem('briefcase', 'Complexidade', leadVal(p, 'complexidade', '—')) +
      renderInfoItem('search', 'Aparece no Google', leadVal(p, 'ja_aparece_google', '—')) +
      renderInfoItem('briefcase', 'Produto sugerido', leadVal(p, 'produto_sugerido', '—')) +
      renderCamposColetados(p)
    const resumo = leadVal(p, ['resumo_necessidade', 'resumo_memoria_vendas'], '')
    const resumoHtml =
      resumo && resumo !== '—'
        ? `<p>${esc(resumo).replace(/\n/g, '<br />')}</p>`
        : `<p class="perfil-sem-dados">Sem resumo ainda — gere a análise interna (IA).</p>`
    const scoreHtml = temScore
      ? `<div class="lead-score"><span>Score (IA)</span><strong>${score}</strong><small>/ 100</small></div>` +
        `<span class="lead-interest-badge">${esc(interesseLabel(score))}</span>`
      : `<div class="lead-score lead-score--vazio"><span>Score (IA)</span><strong>—</strong></div>` +
        `<span class="lead-interest-badge">Sem análise</span>`
    return (
      `<div class="lead-profile-layout">` +
      `<div class="lead-profile-grid">${itens}</div>` +
      `<aside class="lead-need-summary">` +
      `<strong>Resumo da necessidade</strong>` +
      resumoHtml +
      scoreHtml +
      `</aside>` +
      `</div>` +
      `<div class="lead-section-mini"><h3>Fluxo comercial</h3>${renderFluxoComercial(p || {})}</div>`
    )
  }

  function renderLacunas(rows) {
    const renderChecklist = (items) =>
      '<div class="lead-gap-checklist">' +
      items
        .map(
          (x) =>
            `<label><input type="checkbox" disabled />` +
            `<span><strong>${esc(x)}</strong><small>Ainda não coletado</small></span></label>`
        )
        .join('') +
      '</div>'
    const aberto = Array.isArray(rows)
      ? rows.filter((l) => l.resolvido_em == null).map((l) => l.tema_lacuna || l.detalhe_lacuna || 'Lacuna aberta')
      : []
    if (!aberto.length) {
      return '<p class="perfil-sem-dados">Nenhuma lacuna registrada para este lead.</p>'
    }
    return (
      '<p class="perfil-sem-dados">Informações que ainda não temos sobre este lead.</p>' +
      renderChecklist(aberto)
    )
  }

  function renderHistorico(msgs) {
    if (!msgs || !msgs.length) return '<p class="perfil-sem-dados">Sem mensagens.</p>'
    return msgs
      .slice(-8)
      .map((m, idx) => {
        const role =
          m.role === 'user' ?'Cliente' : m.role === 'assistant' ?'Agente' : m.role === 'operator' ?'Operador' : m.role
        const body = esc(m.content || '').replace(/\n/g, '<br />')
        const hora =
          m.hora || m.time || (m.created_at ?String(m.created_at).slice(11, 16) : '') || ''
        return (
          `<div class="perfil-msg perfil-msg-${esc(m.role)}">` +
          `<span class="perfil-msg-dot" aria-hidden="true"></span>` +
          `<div class="perfil-msg-content"><span class="perfil-msg-role">${esc(role)}</span>` +
          `<div class="perfil-msg-body">${body}</div></div>` +
          `<time>${esc(hora)}</time>` +
          `</div>`
        )
      })
      .join('')
  }

  function ultimaMsgInfo(msgs) {
    if (!msgs || !msgs.length) return '—'
    const last = msgs[msgs.length - 1]
    const role =
      last.role === 'user'
        ?'Cliente'
        : last.role === 'assistant'
          ?'Agente'
          : last.role === 'operator'
            ?'Operador'
            : last.role
    return `${role} (última mensagem)`
  }

  function falhaRespostaInfo(d) {
    if (!d || !d.erro_resposta_em) return 'nenhuma'
    const code = d.erro_resposta_codigo ?String(d.erro_resposta_codigo).trim() : ''
    const msg = d.erro_resposta_msg ?String(d.erro_resposta_msg).trim() : ''
    const when = String(d.erro_resposta_em)
    return [code || 'falha', msg || 'sem detalhe', when].filter(Boolean).join(' · ')
  }

  function renderDatalistEstagios(estagios) {
    const arr = Array.isArray(estagios) ?estagios : []
    const opts = arr.map((e) => `<option value="${esc(String(e))}"></option>`).join('')
    return `<datalist id="perfil-estagios-dl">${opts}</datalist>`
  }

  function renderFunilCard(d) {
    const vf = d.venda_fechada ?' checked' : ''
    const selAtivo = d.status === 'aguardando_handoff' ?'' : ' selected'
    const selHand = d.status === 'aguardando_handoff' ?' selected' : ''
    return (
      `<div class="card lead-decision-card">` +
      `<div class="card-titulo"><span>Próxima decisão</span></div>` +
      `<p class="perfil-meta-intro">Defina a ação e o status atual do lead.</p>` +
      `<div class="perfil-meta-form">` +
      `<label class="perfil-meta-check lead-hidden-field"><input type="checkbox" id="perfil-venda-fechada"${vf} /> <span>Venda fechada</span></label>` +
      `<label class="perfil-meta-field"><span class="perfil-meta-field-k">Status do lead</span>` +
      `<select id="perfil-status" class="perfil-meta-select">` +
      `<option value="ativo"${selAtivo}>Ativo</option>` +
      `<option value="aguardando_handoff"${selHand}>Aguardando handoff</option>` +
      `</select></label>` +
      `<label class="perfil-meta-field"><span class="perfil-meta-field-k">Objetivo da próxima ação</span>` +
      `<input type="text" class="perfil-meta-input" id="perfil-estagio-input" list="perfil-estagios-dl" value="${esc(d.estagio || 'Propor orçamento')}" maxlength="120" autocomplete="off" />` +
      renderDatalistEstagios(d.estagios_sugeridos) +
      `</label>` +
      `<button type="button" class="btn-reproc" id="perfil-salvar-meta">Salvar decisão</button>` +
      `<p class="perfil-meta-save-status" id="perfil-meta-save-status" aria-live="polite"></p>` +
      `</div>` +
      `<div class="lead-decision-actions" aria-label="Ações rápidas">` +
      `<button type="button" class="btn-followup" data-lead-fill-action="Enviar proposta">Enviar proposta</button>` +
      `<button type="button" class="btn-followup" data-lead-fill-action="Agendar follow-up">Agendar follow-up</button>` +
      `<button type="button" class="btn-followup" data-lead-fill-action="Marcar handoff">Handoff</button>` +
      (d.venda_fechada
        ? `<button type="button" class="btn-followup" id="btn-marcar-vendido" title="Remover status de venda fechada">Desfazer venda</button>`
        : `<button type="button" class="btn-reproc" id="btn-marcar-vendido" title="Marcar este lead como venda fechada">Marcar vendido</button>`) +
      `</div>` +
      `<div class="perfil-meta-readonly lead-decision-meta">` +
      `<div class="perfil-kv"><span class="perfil-k">Última falha de resposta</span><span class="perfil-v">${esc(falhaRespostaInfo(d))}</span></div>` +
      `<div class="perfil-kv"><span class="perfil-k">Agente pausado</span><span class="perfil-v">${d.agente_pausado ?'sim' : 'não'}</span></div>` +
      `</div>` +
      `</div>`
    )
  }

  function renderCoachSection() {
    return (
      `<div class="card perfil-coach-card lead-col-6">` +
      `<div class="card-titulo"><span>Análise interna (IA)</span></div>` +
      `<p class="perfil-coach-intro">Diagnóstico automático sobre potencial, próximos passos e recomendação comercial. Clique para gerar (ou veja a última análise salva abaixo).</p>` +
      `<button type="button" class="btn-reproc" id="btn-gerar-coach">Gerar nova análise</button>` +
      `<p class="perfil-coach-status" id="perfil-coach-status" aria-live="polite"></p>` +
      `<div id="perfil-coach-bloco" class="perfil-coach-bloco" hidden></div>` +
      `</div>` +
      `<div class="card perfil-gamma-card lead-col-6">` +
      `<div class="card-titulo"><span>Prompt para Gamma (AI)</span></div>` +
      `<p class="painel-nota-agente">Gere um briefing automático para proposta no Gamma.</p>` +
      `<textarea id="gamma-prompt-textarea" class="gamma-prompt-textarea" readonly rows="14" placeholder="Aperte aqui para gerar o briefing da proposta..."></textarea>` +
      `<div class="gamma-actions">` +
      `<button type="button" class="btn-followup" id="btn-copiar-gamma">Copiar prompt</button>` +
      `</div>` +
      `</div>`
    )
  }

  function renderTopoLead(d, jid, waHref, wame) {
    const perfil = d.perfil || {}
    const negocio = perfil.negocio || 'Negócio ainda não identificado'
    const temp = perfil.temperatura_lead || 'sem temperatura'
    const pendente = ultimaMsgInfo(d.historico)
    const dataConversa = d.atualizado_em ?String(d.atualizado_em).slice(0, 16).replace('T', ' ') : '—'
    const badges = [
      d.historico && d.historico.length && d.historico[d.historico.length - 1].role === 'user' ?'Precisa responder' : '',
      d.status === 'aguardando_handoff' ?'Handoff' : 'Ativo',
      d.erro_resposta_em ?'Falha de resposta' : '',
      perfil.preco_calculado ?'Preço calculado' : '',
      d.agente_pausado ?'Agente pausado' : '',
      d.venda_fechada ?'Vendido' : '',
    ].filter(Boolean)
    const badgesHtml = badges
      .map((x) => `<span${x === 'Vendido' ? ' class="badge-vendido"' : ''}>${esc(x)}</span>`)
      .join('')
    return (
      `<section class="perfil-hero">` +
      `<div class="lead-hero-main">` +
      `<span class="section-kicker">Lead</span>` +
      `<h1>${esc(formatarNumeroDisplay(jid))}</h1>` +
      `<p>${esc(negocio)} · ${esc(temp)} · ${esc(pendente)}</p>` +
      `<div class="lead-status-badges">${badgesHtml}</div>` +
      `</div>` +
      `<div class="lead-hero-meta">` +
      `<span><small>Origem</small><strong>WhatsApp</strong></span>` +
      `<span><small>Data da conversa</small><strong>${esc(dataConversa)}</strong></span>` +
      `<span><small>Responsável</small><strong>Agente</strong></span>` +
      `</div>` +
      `<div class="perfil-hero-actions conversa-acao-toolbar">` +
      (wame
        ?`<a href="${esc(waHref)}" class="conversa-acao-btn conversa-acao-btn--link conversa-acao-btn--wa" target="_blank" rel="noopener noreferrer" title="Abrir conversa no WhatsApp (Web ou app)" aria-label="Abrir conversa no WhatsApp (Web ou app)">${heroIcoSpan('phone')}</a>`
        : '') +
      `<button type="button" class="conversa-acao-btn conversa-acao-btn--followup" id="btn-copiar-jid" title="Copiar JID do lead para a área de transferência" aria-label="Copiar JID do lead para a área de transferência">${heroIcoSpan('copy')}</button>` +
      `<button type="button" class="conversa-acao-btn conversa-acao-btn--followup" id="btn-perfil-followup" title="Enviar follow-up de reengajamento ao contato" aria-label="Enviar follow-up de reengajamento ao contato">${heroIcoSpan('mail')}</button>` +
      (d.historico && d.historico.length && d.historico[d.historico.length - 1].role === 'user'
        ?`<button type="button" class="conversa-acao-btn conversa-acao-btn--reproc" id="btn-perfil-reprocessar" title="Reenviar a última resposta automática ao WhatsApp" aria-label="Reenviar a última resposta automática ao WhatsApp">${heroIcoSpan('refresh')}</button>`
        : '') +
      `<button type="button" class="conversa-acao-btn conversa-acao-btn--followup" title="Mais ações" aria-label="Mais ações">${heroIcoSpan('more')}</button>` +
      `</div>` +
      `</section>`
    )
  }

  function renderListaCoach(titulo, itens, ordered) {
    if (!Array.isArray(itens) || !itens.length) return ''
    const tag = ordered ?'ol' : 'ul'
    return `<div class="perfil-lista-block"><strong>${esc(titulo)}</strong><${tag}>${itens.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}></div>`
  }

  function renderAnalysisList(title, icon, tone, items) {
    return (
      `<div class="lead-analysis-list lead-analysis-${esc(tone)}">` +
      `<h3>${heroIcoSpan(icon)}${esc(title)}</h3>` +
      `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` +
      `</div>`
    )
  }

  function formatarDataHoraBr(iso) {
    if (!iso) return ''
    const dt = new Date(iso)
    if (isNaN(dt.getTime())) return String(iso)
    return dt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  // Reunião agendada — objetivo do funil. Dado REAL da agenda (sem inventar).
  function renderReuniaoAgendada(r) {
    if (!r || !r.data_inicio) {
      return (
        `<div class="card lead-col-12 lead-reuniao-card lead-reuniao-vazia">` +
        `<div class="card-titulo"><span>Reunião</span></div>` +
        `<p class="perfil-sem-dados">Nenhuma reunião agendada para este lead.</p>` +
        `</div>`
      )
    }
    const quando = formatarDataHoraBr(r.data_inicio)
    const statusLabel = r.status === 'confirmado' ? 'Confirmada' : 'Pendente'
    return (
      `<div class="card lead-col-12 lead-reuniao-card lead-reuniao-ok">` +
      `<div class="card-titulo"><span>Reunião agendada</span></div>` +
      `<div class="lead-reuniao-info">` +
      `<span class="lead-reuniao-ico">${heroIcoSpan('clock')}</span>` +
      `<div class="lead-reuniao-text"><strong>${esc(quando)}</strong>` +
      `<small>${esc(statusLabel)} · origem: ${esc(r.origem || 'agenda')} · 15 min</small></div>` +
      `<a href="agenda.html" class="btn-followup btn-link lead-reuniao-link">Ver na agenda</a>` +
      `</div>` +
      `</div>`
    )
  }

  function renderHistoricoAnalises(rows) {
    if (!Array.isArray(rows) || !rows.length) return ''
    return (
      `<div class="perfil-analises-historico"><strong>Histórico por etapa</strong>` +
      rows
        .map((row) => {
          const etapa = row && row.etapa ?row.etapa : '—'
          const quando = row && row.criado_em ?String(row.criado_em) : '—'
          const resumo = row && row.resumo_problema ?row.resumo_problema : 'Sem resumo registrado.'
          const confianca = row && row.confianca_analise ?row.confianca_analise : '—'
          return (
            `<div class="perfil-analise-item">` +
            `<div class="perfil-analise-item-meta">` +
            `<span class="estagio-badge">${esc(etapa)}</span>` +
            `<span>${esc(quando)}</span>` +
            `<span>confiança: ${esc(confianca)}</span>` +
            `</div>` +
            `<div class="perfil-analise-item-resumo">${esc(resumo)}</div>` +
            `</div>`
          )
        })
        .join('') +
      `</div>`
    )
  }

  function labelTipoContexto(tipo) {
    const t = String(tipo || '')
    if (t === 'audio_reprocessado') return 'Audio reprocessado'
    if (t === 'audio_upload') return 'Audio manual'
    if (t === 'ligacao') return 'Ligacao'
    return 'Contexto manual'
  }

  function renderContextos(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return '<p class="perfil-sem-dados">Nenhum contexto interno salvo para este lead.</p>'
    }
    return rows
      .map((c) => {
        const quando = c.criado_em ?String(c.criado_em) : ''
        return (
          '<div class="perfil-contexto-item">' +
          '<div class="perfil-contexto-meta">' +
          '<span class="estagio-badge">' + esc(labelTipoContexto(c.tipo)) + '</span>' +
          '<span>' + esc(c.origem || 'operador') + '</span>' +
          '<span>' + esc(quando) + '</span>' +
          '</div>' +
          '<div class="perfil-contexto-texto">' + esc(c.conteudo || '').replace(/\n/g, '<br />') + '</div>' +
          '</div>'
        )
      })
      .join('')
  }

  function renderAudiosPendentes(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return '<p class="perfil-sem-dados">Nenhum audio pendente salvo. Para audio antigo sem payload, anexe o arquivo manualmente abaixo.</p>'
    }
    return rows
      .map((a) => {
        const erro = a.erro ?'<div class="perfil-contexto-erro">' + esc(a.erro) + '</div>' : ''
        return (
          '<div class="perfil-audio-pendente">' +
          '<div><strong>Audio pendente #' + esc(a.id) + '</strong>' +
          '<div class="perfil-contexto-meta"><span>' + esc(a.mimetype || 'audio') + '</span><span>tentativas: ' + esc(a.attempts || 0) + '</span><span>' + esc(a.criado_em || '') + '</span></div>' +
          erro +
          '</div>' +
          '<button type="button" class="btn-reproc btn-audio-reprocessar" data-audio-id="' + esc(a.id) + '">Reescutar/transcrever</button>' +
          '</div>'
        )
      })
      .join('')
  }

  function renderContextoSection(d) {
    return (
      '<div class="card perfil-contexto-card lead-col-4">' +
      '<div class="card-titulo"><span>Contexto interno</span></div>' +
      '<p class="perfil-meta-intro">Notas internas para considerar nos próximos passos. Só visível para o time.</p>' +
      '<label class="perfil-meta-field"><span class="perfil-meta-field-k">Notas internas</span>' +
      '<textarea id="lead-contexto-texto" class="perfil-contexto-textarea" rows="5" maxlength="4000" placeholder="Ex.: Ligacao feita hoje: lead disse que vai ler a proposta e responder amanha."></textarea>' +
      '</label>' +
      '<div class="perfil-contexto-actions">' +
      '<button type="button" class="btn-reproc" id="btn-salvar-contexto">Salvar contexto</button>' +
      '<span id="lead-contexto-status" class="perfil-meta-save-status" aria-live="polite"></span>' +
      '</div>' +
      '<div class="perfil-contexto-upload lead-audio-upload">' +
      '<label class="perfil-meta-field"><span class="perfil-meta-field-k">Audio antigo sem payload</span>' +
      '<input type="file" id="lead-audio-upload" class="perfil-contexto-file" accept="audio/*" />' +
      '</label>' +
      '<button type="button" class="btn-reproc" id="btn-audio-upload">Transcrever e salvar contexto</button>' +
      '<span id="lead-audio-upload-status" class="perfil-meta-save-status" aria-live="polite"></span>' +
      '</div>' +
      '<div class="perfil-contexto-subbloco"><strong>Áudios pendentes</strong>' + renderAudiosPendentes(d.audio_pendentes) + '</div>' +
      '<div class="perfil-contexto-subbloco"><strong>Contatos recentes</strong>' + renderContextos(d.contextos) + '</div>' +
      '</div>'
    )
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const s = String(reader.result || '')
        const idx = s.indexOf(',')
        resolve(idx >= 0 ?s.slice(idx + 1) : s)
      }
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'))
      reader.readAsDataURL(file)
    })
  }

  function preencherCoachNaTela(coach, analise) {
    const block = document.getElementById('perfil-coach-bloco')
    const gammaTa = document.getElementById('gamma-prompt-textarea')
    if (!block || !gammaTa) return
    if (!coach || typeof coach !== 'object') {
      block.hidden = true
      block.innerHTML = ''
      gammaTa.value = ''
      gammaTa.placeholder = 'Aparece aqui após gerar a análise…'
      return
    }
    block.hidden = false
    block.innerHTML = renderCoachResult(coach, analise)
    const gamma = typeof coach.prompt_gamma_apresentacao === 'string' ?coach.prompt_gamma_apresentacao.trim() : ''
    gammaTa.value = gamma
    gammaTa.placeholder = gamma
      ?'Aparece aqui após gerar a análise…'
      : 'O modelo não preencheu prompt_gamma_apresentacao; tente gerar de novo ou revise prompts/lead-coach.md no servidor.'
  }

  function formatarPreviaValorTexto(previa) {
    if (!previa || typeof previa !== 'object') return ''
    if (previa.plano === 'sob_medida') {
      return 'Prévia de valor (IA): sob medida — alinhar escopo na reunião' + (previa.justificativa ? ` — ${previa.justificativa}` : '')
    }
    let v = ''
    if (previa.faixa_min && previa.faixa_max) {
      v = previa.faixa_min === previa.faixa_max ? `R$ ${previa.faixa_min}` : `R$ ${previa.faixa_min}–${previa.faixa_max}`
      if (previa.valor_alvo) v += ` (alvo ~R$ ${previa.valor_alvo})`
    } else if (previa.valor_alvo) {
      v = `~R$ ${previa.valor_alvo}`
    }
    if (!v) return ''
    return `Prévia de valor (IA): ${v}${previa.plano ? ` · plano ${previa.plano}` : ''}${previa.justificativa ? ` — ${previa.justificativa}` : ''}`
  }

  function renderCoachResult(coach, analise) {
    if (!coach || typeof coach !== 'object') return ''
    const steps = Array.isArray(coach.proximos_passos) ?coach.proximos_passos : []
    const risks = Array.isArray(coach.riscos) ?coach.riscos : []
    const openq = Array.isArray(coach.perguntas_em_aberto) ?coach.perguntas_em_aberto : []
    const faltou = Array.isArray(coach.o_que_faltou_para_vender) ?coach.o_que_faltou_para_vender : []
    const melhoriasIa = Array.isArray(coach.melhorias_para_ia) ?coach.melhorias_para_ia : []
    const sinaisMelhoriaIa = Array.isArray(coach.sinais_melhoria_ia)
      ?coach.sinais_melhoria_ia
      : analise && Array.isArray(analise.sinais_melhoria_ia)
        ?analise.sinais_melhoria_ia
        : []
    const preparo = Array.isArray(coach.acoes_de_preparo) ?coach.acoes_de_preparo : []
    const confiancaAnalise = coach.confianca_analise || (analise && analise.confianca_analise) || ''
    let sinaisHtml = ''
    if (coach.sinais && typeof coach.sinais === 'object') {
      const tags = Object.entries(coach.sinais)
        .filter(([, v]) => v === true)
        .map(([k]) => `<span class="estagio-badge pendente">${esc(k)}</span>`)
      if (tags.length) sinaisHtml = `<div class="perfil-coach-sinais">${tags.join(' ')}</div>`
    }
    const score = coach.score != null && Number.isFinite(Number(coach.score))
      ? Math.max(0, Math.min(100, Math.round(Number(coach.score))))
      : null
    const previa = coach.previa_valor && typeof coach.previa_valor === 'object' ? coach.previa_valor : null
    const det = coach.analise_detalhada && typeof coach.analise_detalhada === 'object' ? coach.analise_detalhada : null
    const previaTxt = formatarPreviaValorTexto(previa)
    const headerHtml =
      score != null || previaTxt
        ? `<div class="perfil-coach-head">` +
          (score != null
            ? `<div class="lead-score"><span>Score (IA)</span><strong>${score}</strong><small>/ 100</small></div>`
            : '') +
          (previaTxt ? `<div class="perfil-coach-previa">💡 ${esc(previaTxt)}</div>` : '') +
          `</div>`
        : ''
    const detHtml = det
      ? `<div class="lead-analysis-grid perfil-coach-analise">` +
        (det.valor_percebido && det.valor_percebido.length ? renderAnalysisList('Valor percebido', 'check', 'positive', det.valor_percebido) : '') +
        (det.dores && det.dores.length ? renderAnalysisList('Dores identificadas', 'x', 'negative', det.dores) : '') +
        (det.razoes_compra && det.razoes_compra.length ? renderAnalysisList('Razões de compra', 'check', 'neutral', det.razoes_compra) : '') +
        (det.objecoes && det.objecoes.length ? renderAnalysisList('Possíveis objeções', 'alert', 'warning', det.objecoes) : '') +
        `</div>`
      : ''
    return (
      headerHtml +
      (analise && analise.criado_em
        ?`<div class="perfil-kv"><span class="perfil-k">Última análise salva</span><span class="perfil-v">${esc(String(analise.criado_em))}</span></div>`
        : '') +
      (analise && analise.etapa
        ?`<div class="perfil-kv"><span class="perfil-k">Etapa analisada</span><span class="perfil-v">${esc(analise.etapa)}</span></div>`
        : coach.etapa
          ?`<div class="perfil-kv"><span class="perfil-k">Etapa analisada</span><span class="perfil-v">${esc(coach.etapa)}</span></div>`
          : '') +
      (analise && analise.status_conversa
        ?`<div class="perfil-kv"><span class="perfil-k">Status da conversa</span><span class="perfil-v">${esc(analise.status_conversa)}</span></div>`
        : coach.status_conversa
          ?`<div class="perfil-kv"><span class="perfil-k">Status da conversa</span><span class="perfil-v">${esc(coach.status_conversa)}</span></div>`
          : '') +
      `<div class="perfil-decisao"><strong>Decisão recomendada</strong><p>${esc(coach.decisao_recomendada || '—')}</p></div>` +
      `<div class="perfil-kv"><span class="perfil-k">Confiança</span><span class="perfil-v">${esc(coach.confianca || '—')}</span></div>` +
      (confiancaAnalise
        ?`<div class="perfil-kv"><span class="perfil-k">Confiança do diagnóstico</span><span class="perfil-v">${esc(confiancaAnalise)}</span></div>`
        : '') +
      sinaisHtml +
      (coach.resumo_problema
        ?`<div class="perfil-racioc"><strong>Resumo do problema</strong><p>${esc(coach.resumo_problema).replace(/\n/g, '<br />')}</p></div>`
        : '') +
      `<div class="perfil-racioc"><strong>Raciocínio</strong><p>${esc(coach.raciocinio || '—').replace(/\n/g, '<br />')}</p></div>` +
      detHtml +
      renderListaCoach('Próximos passos', steps, true) +
      renderListaCoach('O que faltou para vender', faltou, false) +
      renderListaCoach('Melhorias para a IA', melhoriasIa, false) +
      renderListaCoach('Sinais de melhoria da IA', sinaisMelhoriaIa, false) +
      renderListaCoach('Ações de preparo', preparo, false) +
      renderListaCoach('Riscos', risks, false) +
      renderListaCoach('Perguntas em aberto', openq, false)
    )
  }

  function mountPage(d) {
    const jid = d.numero
    const wame = digitsWaMe(jid)
    const waHref = wame ?`https://wa.me/${wame}` : '#'
    const conteudo = document.getElementById('perfil-conteudo')
    // Score sempre registrado: prioriza score_lead (atualizado a cada turno pela IA),
    // cai para o score da última análise (coach) se ainda não houver.
    const iaScore =
      d.perfil && d.perfil.score_lead != null
        ? d.perfil.score_lead
        : d.analise_conversa && d.analise_conversa.coach && d.analise_conversa.coach.score != null
          ? d.analise_conversa.coach.score
          : null
    conteudo.innerHTML =
      `<div class="perfil-stack">` +
      renderTopoLead(d, jid, waHref, wame) +
      `<div class="lead-grid">` +
      renderReuniaoAgendada(d.reuniao_agendada) +
      renderContato(d) +
      renderFunilCard(d) +
      `<div class="card lead-profile-card lead-col-8">` +
      `<div class="card-titulo"><span>Perfil comercial</span></div>` +
      `${renderPerfil(d.perfil, iaScore)}` +
      `</div>` +
      renderSinaisLead(d.perfil && d.perfil.insights_lead) +
      `<div class="card perfil-historico-card lead-col-8">` +
      `<div class="card-titulo"><span>Histórico da conversa</span></div>` +
      `<div class="perfil-historico-scroll">${renderHistorico(d.historico)}</div>` +
      `<div class="perfil-historico-acoes">` +
      `<a href="conversas.html" class="btn-followup lead-full-chat">Ver conversa completa</a>` +
      `<button type="button" class="btn-reproc" id="btn-copiar-conversa-completa" title="Copia todo o histórico como texto legível para colar no ChatGPT ou Claude">Copiar conversa completa</button>` +
      `</div>` +
      `</div>` +
      renderContextoSection(d) +
      renderCoachSection() +
      `<div class="card lead-col-12 lead-gap-card">` +
      `<div class="card-titulo"><span>Lacunas de conhecimento</span></div>` +
      `${renderLacunas(d.lacunas)}` +
      `</div>` +
      `</div>` +
      `</div>`

    document.getElementById('btn-copiar-jid').addEventListener('click', () => copiarTexto(jid))

    document.getElementById('btn-copiar-conversa-completa')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-copiar-conversa-completa')
      const prev = btn.textContent
      btn.disabled = true
      btn.textContent = 'Copiando...'
      try {
        const r = await fetch('/dashboard/conversa-completa?numero=' + encodeURIComponent(jid), {
          headers: headersGet(),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        const texto = j.texto || ''
        try {
          await navigator.clipboard.writeText(texto)
          Core.toast ? Core.toast('Conversa completa copiada.', 'sucesso') : alert('Conversa copiada para a área de transferência.')
        } catch (_) {
          const ta = document.createElement('textarea')
          ta.value = texto
          ta.style.position = 'fixed'
          ta.style.left = '-9999px'
          document.body.appendChild(ta)
          ta.select()
          let copiouFallback = false
          try {
            copiouFallback = document.execCommand('copy')
          } catch (_2) {}
          document.body.removeChild(ta)
          if (copiouFallback) {
            Core.toast ? Core.toast('Conversa completa copiada.', 'sucesso') : alert('Conversa copiada para a área de transferência.')
          } else {
            const modal = document.createElement('dialog')
            modal.style.cssText = 'max-width:90vw;max-height:80vh;overflow:auto;padding:1rem;'
            modal.innerHTML = '<p><strong>Copie o texto abaixo manualmente:</strong></p><textarea style="width:100%;height:60vh;font-size:0.85rem;" readonly></textarea><br /><button type="button">Fechar</button>'
            modal.querySelector('textarea').value = texto
            modal.querySelector('button').addEventListener('click', () => modal.close())
            document.body.appendChild(modal)
            modal.showModal()
          }
        }
      } catch (e) {
        Core.toast ? Core.toast(e.message || 'Falha ao copiar conversa', 'erro') : alert(e.message || 'Falha ao copiar conversa')
      } finally {
        btn.disabled = false
        btn.textContent = prev
      }
    })
    document.querySelectorAll('[data-lead-fill-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('perfil-estagio-input')
        const value = btn.getAttribute('data-lead-fill-action') || ''
        if (input && value) input.value = value
      })
    })
    document.getElementById('btn-salvar-contexto')?.addEventListener('click', async () => {
      const ta = document.getElementById('lead-contexto-texto')
      const st = document.getElementById('lead-contexto-status')
      const btn = document.getElementById('btn-salvar-contexto')
      const conteudo = (ta && ta.value ?ta.value : '').trim()
      if (!conteudo) {
        if (st) st.textContent = 'Escreva um contexto antes de salvar.'
        return
      }
      const prev = btn.textContent
      btn.disabled = true
      if (st) st.textContent = 'Salvando...'
      try {
        const r = await fetch('/dashboard/lead-contexto', {
          method: 'POST',
          headers: headersPostJson(),
          body: JSON.stringify({ numero: jid, tipo: 'contexto_manual', conteudo }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        if (ta) ta.value = ''
        if (st) st.textContent = 'Contexto salvo.'
        await carregarPerfil()
      } catch (e) {
        if (st) st.textContent = e.message || 'Falha ao salvar contexto'
      } finally {
        btn.disabled = false
        btn.textContent = prev
      }
    })

    document.querySelectorAll('.btn-audio-reprocessar').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-audio-id')
        if (!id) return
        const prev = btn.textContent
        btn.disabled = true
        btn.textContent = 'Transcrevendo...'
        try {
          const r = await fetch('/dashboard/audio-reprocessar', {
            method: 'POST',
            headers: headersPostJson(),
            body: JSON.stringify({ id: Number(id) }),
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(j.erro || r.statusText)
          Core.toast ?Core.toast('Audio reprocessado e salvo no contexto.', 'sucesso') : alert('Audio reprocessado.')
          await carregarPerfil()
        } catch (e) {
          Core.toast ?Core.toast(e.message || 'Falha ao reprocessar audio', 'erro') : alert(e.message || 'Falha ao reprocessar audio')
        } finally {
          btn.disabled = false
          btn.textContent = prev
        }
      })
    })

    document.getElementById('btn-audio-upload')?.addEventListener('click', async () => {
      const input = document.getElementById('lead-audio-upload')
      const st = document.getElementById('lead-audio-upload-status')
      const btn = document.getElementById('btn-audio-upload')
      const file = input && input.files && input.files[0]
      if (!file) {
        if (st) st.textContent = 'Escolha um arquivo de audio.'
        return
      }
      const prev = btn.textContent
      btn.disabled = true
      if (st) st.textContent = 'Lendo e transcrevendo...'
      try {
        const base64 = await fileToBase64(file)
        const r = await fetch('/dashboard/audio-upload-contexto', {
          method: 'POST',
          headers: headersPostJson(),
          body: JSON.stringify({
            numero: jid,
            filename: file.name,
            mimetype: file.type || 'audio/ogg',
            base64,
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        if (input) input.value = ''
        if (st) st.textContent = 'Audio transcrito e salvo.'
        await carregarPerfil()
      } catch (e) {
        if (st) st.textContent = e.message || 'Falha ao transcrever audio'
      } finally {
        btn.disabled = false
        btn.textContent = prev
      }
    })

    document.getElementById('btn-perfil-followup')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-perfil-followup')
      setHeroAcaoLoading(btn, true)
      try {
        const r = await fetch('/dashboard/followup', {
          method: 'POST',
          headers: headersPostJson(),
          body: JSON.stringify({ numero: jid }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        setHeroAcaoDone(btn)
        Core.toast ?Core.toast('Follow-up enviado.', 'sucesso') : alert('Follow-up enviado.')
        await carregarPerfil()
      } catch (e) {
        Core.toast ?Core.toast(e.message || 'Falha no follow-up', 'erro') : alert(e.message || 'Falha no follow-up')
        setHeroAcaoLoading(btn, false)
      }
    })
    document.getElementById('btn-perfil-reprocessar')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-perfil-reprocessar')
      setHeroAcaoLoading(btn, true)
      try {
        const r = await fetch('/dashboard/reprocessar', {
          method: 'POST',
          headers: headersPostJson(),
          body: JSON.stringify({ numero: jid }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        setHeroAcaoDone(btn)
        Core.toast ?Core.toast('Resposta reenviada.', 'sucesso') : alert('Resposta reenviada.')
        await carregarPerfil()
      } catch (e) {
        Core.toast ?Core.toast(e.message || 'Falha ao reenviar', 'erro') : alert(e.message || 'Falha ao reenviar')
        setHeroAcaoLoading(btn, false)
      }
    })
    document.getElementById('btn-marcar-vendido')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-marcar-vendido')
      const novoValor = !d.venda_fechada
      btn.disabled = true
      try {
        const r = await fetch('/dashboard/conversa-meta', {
          method: 'PATCH',
          headers: headersPostJson(),
          body: JSON.stringify({ numero: jid, venda_fechada: novoValor }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        Core.toast
          ? Core.toast(novoValor ? 'Lead marcado como vendido.' : 'Venda desfeita.', 'sucesso')
          : alert(novoValor ? 'Lead marcado como vendido.' : 'Venda desfeita.')
        await carregarPerfil()
      } catch (e) {
        Core.toast
          ? Core.toast(e.message || 'Falha ao atualizar venda', 'erro')
          : alert(e.message || 'Falha ao atualizar venda')
        btn.disabled = false
      }
    })

    preencherCoachNaTela(d.analise_conversa && d.analise_conversa.coach, d.analise_conversa || null)
    const coachStatusInicial = document.getElementById('perfil-coach-status')
    if (coachStatusInicial) {
      coachStatusInicial.textContent = d.analise_conversa ?'Última análise salva carregada.' : ''
    }
    const coachBlock = document.getElementById('perfil-coach-bloco')
    if (coachBlock && Array.isArray(d.historico_analises) && d.historico_analises.length) {
      coachBlock.innerHTML += renderHistoricoAnalises(d.historico_analises)
    }

    document.getElementById('perfil-salvar-meta').addEventListener('click', async () => {
      const stEl = document.getElementById('perfil-meta-save-status')
      const btnMeta = document.getElementById('perfil-salvar-meta')
      const venda = document.getElementById('perfil-venda-fechada').checked
      const status = (document.getElementById('perfil-status').value || '').trim()
      const estagio = (document.getElementById('perfil-estagio-input').value || '').trim()
      if (!estagio) {
        if (stEl) stEl.textContent = 'Preencha o estágio (não pode ficar vazio no banco).'
        return
      }
      const prev = btnMeta.textContent
      btnMeta.disabled = true
      if (stEl) stEl.textContent = 'Salvando…'
      try {
        const r = await fetch('/dashboard/conversa-meta', {
          method: 'PATCH',
          headers: headersPostJson(),
          body: JSON.stringify({
            numero: jid,
            venda_fechada: venda,
            status,
            estagio,
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        if (stEl) stEl.textContent = 'Salvo.'
        await carregarPerfil()
      } catch (e) {
        if (stEl) stEl.textContent = e.message || 'Falha ao salvar'
        console.error(e)
      } finally {
        btnMeta.disabled = false
        btnMeta.textContent = prev
      }
    })

    document.getElementById('btn-gerar-coach').addEventListener('click', async () => {
      const st = document.getElementById('perfil-coach-status')
      const btn = document.getElementById('btn-gerar-coach')
      btn.disabled = true
      st.textContent = 'Gerando análise…'
      try {
        const r = await fetch('/dashboard/lead-coach', {
          method: 'POST',
          headers: headersPostJson(),
          body: JSON.stringify({ numero: jid }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.erro || r.statusText)
        preencherCoachNaTela(j.coach, j.analise || null)
        st.textContent = 'Análise pronta e salva.'
      } catch (e) {
        st.textContent = e.message || 'Falha na análise'
        console.error(e)
      } finally {
        btn.disabled = false
      }
    })

    document.getElementById('btn-copiar-gamma').addEventListener('click', () => {
      const gammaTa = document.getElementById('gamma-prompt-textarea')
      copiarTexto(gammaTa ?gammaTa.value : '')
    })

    conteudo.hidden = false
  }

  let urlNumeroPerfil = ''

  async function carregarPerfil() {
    if (!urlNumeroPerfil) return
    try {
      const r = await fetch('/dashboard/conversa-detalhe?numero=' + encodeURIComponent(urlNumeroPerfil), {
        headers: headersGet(),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        mostrarErro(d.erro || r.statusText || 'Falha ao carregar detalhe.')
        return
      }
      if (!d.ok) {
        mostrarErro(d.erro || 'Resposta inválida.')
        return
      }
      mostrarErro('')
      mountPage(d)
    } catch (e) {
      mostrarErro(e.message || 'Erro de rede')
      console.error(e)
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search)
    urlNumeroPerfil = (params.get('numero') || '').trim()
    if (!urlNumeroPerfil) {
      mostrarErro('Parâmetro numero ausente na URL. Abra a partir da lista em Conversas (clique no número).')
      return
    }

    await carregarPerfil()
  })
})()
