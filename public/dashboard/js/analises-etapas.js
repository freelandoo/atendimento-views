/**
 * Diagnostico geral por etapa: usa conversas reais + prompt versionado.
 */
;(function () {
  const Core = window.DashboardCore || {}
  let configAtual = null
  let melhoriaAtual = null
  let etapaAtual = 'primeiro_contato'
  const MENSAGENS_PROGRESSO = ['Carregando...', 'Gerando...', 'Está quase pronto...']
  const TEXTO_FUNIL_STATUS_PADRAO =
    'A IA analisa as conversas reais da etapa, gera diagnostico e avalia silenciosamente se o prompt ativo precisa evoluir.'
  const TEXTO_FUNIL_STATUS_PROSPECCAO =
    'A IA analisa somente a primeira mensagem enviada na prospeccao (sem follow-up), gera diagnostico e sugere melhorias para o primeiro contato.'

  function pararProgresso(timerId) {
    if (timerId != null) clearInterval(timerId)
  }

  /** Atualiza status (e opcionalmente a área de resultado) em ciclo até pararProgresso. */
  function iniciarMensagensProgresso(opcoes) {
    const atualizarResultado = !!(opcoes && opcoes.atualizarResultado)
    const intervaloMs = (opcoes && opcoes.intervaloMs) || 4000
    let idx = 0
    const aplicar = () => {
      const msg = MENSAGENS_PROGRESSO[idx % MENSAGENS_PROGRESSO.length]
      idx += 1
      setStatus(msg, false)
      if (atualizarResultado) {
        const el = document.getElementById('funil-diagnostico-result')
        if (el) el.innerHTML = '<div class="vazio">' + esc(msg) + '</div>'
      }
    }
    aplicar()
    return setInterval(aplicar, intervaloMs)
  }

  function esc(s) {
    return String(s == null ?'' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Rótulo curto para badge (alvo do prompt). */
  function labelPromptAlvoBadge(v) {
    if (v === 'followup') return 'follow-up'
    if (v === 'followup_timing') return 'timing'
    return 'funil'
  }

  /** Texto para confirmação do overlay conforme o alvo persistido. */
  function labelPromptAlvoOverlayConfirm(v) {
    if (v === 'followup') return 'prompt de follow-up (mensagens após silêncio)'
    if (v === 'followup_timing') return 'prompt de timing do follow-up automático'
    return 'system prompt principal de vendas'
  }

  function headersJson() {
    const h = Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {}
    return { ...h, 'content-type': 'application/json' }
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, opts || { headers: Core.headersComReprocessSecret ?Core.headersComReprocessSecret(false) : {} })
    const d = await r.json().catch(() => ({}))
    if (r.status === 401) {
      window.location.href = 'login.html'
      return null
    }
    if (!r.ok || d.ok === false) throw new Error(d.erro || r.statusText || 'Falha na requisicao')
    return d
  }

  function setStatus(msg, erro) {
    const el = document.getElementById('funil-diagnostico-status')
    if (!el) return
    el.textContent = msg || ''
    el.classList.toggle('config-status-erro', !!erro)
  }

  function textoStatusPadraoPorEtapa() {
    const etapa = document.getElementById('funil-etapa')?.value || 'primeiro_contato'
    return etapa === 'primeiro_contato_prospeccao'
      ?TEXTO_FUNIL_STATUS_PROSPECCAO
      : TEXTO_FUNIL_STATUS_PADRAO
  }

  function promptAtivo(etapa) {
    return configAtual && configAtual.prompts_ativos ?configAtual.prompts_ativos[etapa] : null
  }

  function atualizarPromptPreview() {
    etapaAtual = document.getElementById('funil-etapa')?.value || 'primeiro_contato'
    const p = promptAtivo(etapaAtual)
    const badge = document.getElementById('funil-prompt-version')
    const pre = document.getElementById('funil-prompt-preview')
    if (badge) badge.textContent = p ?`prompt v${p.version}` : 'prompt v--'
    if (pre) pre.textContent = p ?p.prompt : 'Prompt ainda nao carregado para esta etapa.'
  }

  function renderLista(items) {
    if (!Array.isArray(items) || !items.length) return '<div class="perfil-sem-dados">--</div>'
    return '<ul>' + items.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
  }

  function renderProblemas(problemas) {
    const p = problemas || {}
    return ['alta', 'media', 'baixa']
      .map((grav) => {
        const arr = Array.isArray(p[grav]) ?p[grav] : []
        return (
          '<div class="funil-problema-col funil-grav-' + grav + '">' +
          '<strong>' + grav + '</strong>' +
          renderLista(arr) +
          '</div>'
        )
      })
      .join('')
  }

  function renderResultado(diag) {
    const r = diag && diag.resultado ?diag.resultado : null
    const el = document.getElementById('funil-diagnostico-result')
    if (!el) return
    if (!r) {
      el.innerHTML = '<div class="vazio">Nenhum diagnostico gerado ainda.</div>'
      return
    }
    el.innerHTML =
      '<div class="funil-score-row">' +
      '<div class="funil-score-box"><strong>' + esc(r.pontuacao_geral) + '</strong><span>/10</span></div>' +
      '<div><h2>' + esc(diag.etapa_label || diag.etapa) + '</h2><p>' + esc(r.resumo_geral || 'Sem resumo.') + '</p></div>' +
      '</div>' +
      '<div class="funil-problemas-grid">' + renderProblemas(r.problemas_por_gravidade) + '</div>' +
      '<div class="funil-result-grid">' +
      '<div><strong>Diagnostico dos leads</strong>' + renderLista(r.diagnostico_dos_leads) + '</div>' +
      '<div><strong>Padroes identificados</strong>' + renderLista(r.padroes_identificados) + '</div>' +
      '<div><strong>Proximo passo</strong><p>' + esc(r.proximo_passo_recomendado || '--') + '</p></div>' +
      '<div><strong>Mensagens prontas</strong>' + renderLista(r.mensagens_prontas) + '</div>' +
      '</div>'
  }

  function renderMelhoria(diag) {
    const box = document.getElementById('funil-melhoria-banner')
    if (!box) return
    const av = diag && diag.avaliacao_prompt
    melhoriaAtual = null
    if (!diag || !diag.melhoria_disponivel || !av || !av.prompt_melhorado) {
      box.hidden = true
      box.innerHTML = ''
      return
    }
    melhoriaAtual = av
    box.hidden = false
    box.innerHTML =
      '<div><span class="section-kicker">Auto-melhoria</span><h2>Prompt avaliado como ' +
      esc(av.avaliacao_do_prompt) +
      '</h2><p>A IA sugeriu melhorar o prompt desta etapa antes das proximas analises.</p></div>' +
      '<div class="funil-melhoria-grid">' +
      '<div><strong>Mudancas propostas</strong>' + renderLista(av.principais_mudancas) + '</div>' +
      '<div><strong>Pontos fracos</strong>' + renderLista(av.pontos_fracos_do_prompt) + '</div>' +
      '</div>' +
      '<pre class="funil-prompt-preview">' + esc(av.prompt_melhorado) + '</pre>' +
      '<button type="button" class="btn-reproc" id="btn-funil-aceitar-melhoria">Aceitar melhoria</button>'
    document.getElementById('btn-funil-aceitar-melhoria')?.addEventListener('click', aceitarMelhoria)
  }

  function renderHistorico(d) {
    const list = document.getElementById('funil-history-list')
    const total = document.getElementById('funil-history-total')
    if (!list) return
    const diagnosticos = Array.isArray(d && d.diagnosticos) ?d.diagnosticos : []
    const versoes = Array.isArray(d && d.versoes) ?d.versoes : []
    if (total) total.textContent = String(diagnosticos.length)
    const diagHtml = diagnosticos.length
      ?diagnosticos
          .map((x) => {
            const r = x.resultado_json || {}
            const when = x.criado_em ?new Date(x.criado_em).toLocaleString('pt-BR') : '--'
            return '<article><strong>' + esc(r.pontuacao_geral || 0) + '/10</strong><span>' + esc(when) + ' · ' + esc(x.fonte) + ' · ' + esc(x.total_conversas) + ' conversas</span><p>' + esc(r.resumo_geral || '') + '</p></article>'
          })
          .join('')
      : '<div class="vazio">Sem diagnosticos para esta etapa.</div>'
    const versHtml = versoes.length
      ?'<div class="funil-version-list">' + versoes.map((v) => '<span class="estagio-badge ' + (v.ativo ?'fechado' : '') + '">v' + esc(v.version) + ' ' + esc(v.origem || '') + '</span>').join('') + '</div>'
      : ''
    list.innerHTML = versHtml + diagHtml
  }

  async function carregarHistorico() {
    const etapa = document.getElementById('funil-etapa')?.value || 'primeiro_contato'
    const d = await fetchJson('/dashboard/funil-diagnostico/historico?etapa=' + encodeURIComponent(etapa))
    if (d) renderHistorico(d)
  }

  async function carregarConfig() {
    const progressoTimer = iniciarMensagensProgresso({ atualizarResultado: false })
    try {
      const d = await fetchJson('/dashboard/funil-diagnostico/config')
      if (!d) {
        setStatus(textoStatusPadraoPorEtapa())
        return
      }
      configAtual = d
      const sel = document.getElementById('funil-etapa')
      if (sel && Array.isArray(d.etapas)) {
        const atual = sel.value
        sel.innerHTML = d.etapas.map((e) => '<option value="' + esc(e.id) + '">' + esc(e.label || e.id) + '</option>').join('')
        if (atual && [...sel.options].some((o) => o.value === atual)) sel.value = atual
      }
      atualizarPromptPreview()
      await carregarHistorico()
      setStatus(textoStatusPadraoPorEtapa())
    } finally {
      pararProgresso(progressoTimer)
    }
  }

  async function analisarEtapa() {
    const btn = document.getElementById('btn-funil-analisar')
    const payload = {
      etapa: document.getElementById('funil-etapa')?.value || 'primeiro_contato',
      fonte: document.getElementById('funil-fonte')?.value || 'banco_colar',
      limit: parseInt(document.getElementById('funil-limit')?.value, 10) || 20,
      conversa_colada: document.getElementById('funil-conversa-colada')?.value || '',
    }
    let progressoTimer = null
    try {
      if (btn) btn.disabled = true
      renderMelhoria(null)
      progressoTimer = iniciarMensagensProgresso({ atualizarResultado: true })
      const d = await fetchJson('/dashboard/funil-diagnostico/analisar', {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify(payload),
      })
      if (!d) return
      renderResultado(d.diagnostico)
      renderMelhoria(d.diagnostico)
      let msg =
        'Diagnostico gerado. Prompt avaliado como ' + (d.diagnostico.avaliacao_prompt?.avaliacao_do_prompt || 'boa') + '.'
      if (d.aprendizado_gerado && d.aprendizado_gerado.id) {
        msg +=
          ' Aprendizado pendente #' +
          d.aprendizado_gerado.id +
          ' criado — role ate "Auto-melhoria do prompt" abaixo para Aprovar / Overlay / Rejeitar.'
      } else if (d.aprendizado_erro) {
        msg += ' Auto-melhoria: ' + d.aprendizado_erro
      }
      setStatus(msg)
      await carregarHistorico()
      await carregarAprendizados()
      if (d.aprendizado_gerado && d.aprendizado_gerado.id) {
        document.querySelector('.funil-aprendizados-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch (e) {
      setStatus(e.message || 'Falha ao analisar etapa', true)
      document.getElementById('funil-diagnostico-result').innerHTML = '<div class="vazio">' + esc(e.message || 'erro') + '</div>'
    } finally {
      pararProgresso(progressoTimer)
      if (btn) btn.disabled = false
    }
  }

  async function aceitarMelhoria() {
    if (!melhoriaAtual || !melhoriaAtual.prompt_melhorado) return
    const btn = document.getElementById('btn-funil-aceitar-melhoria')
    let progressoTimer = null
    try {
      if (btn) btn.disabled = true
      progressoTimer = iniciarMensagensProgresso({ atualizarResultado: false, intervaloMs: 2800 })
      await fetchJson('/dashboard/funil-diagnostico/prompts/aceitar-melhoria', {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({
          etapa: document.getElementById('funil-etapa')?.value || 'primeiro_contato',
          prompt_melhorado: melhoriaAtual.prompt_melhorado,
        }),
      })
      renderMelhoria(null)
      await carregarConfig()
      setStatus('Nova versao do prompt ativa para proximas analises.')
    } catch (e) {
      setStatus(e.message || 'Falha ao salvar melhoria', true)
    } finally {
      pararProgresso(progressoTimer)
      if (btn) btn.disabled = false
    }
  }

  // ─── AUTO-MELHORIA: painel de aprendizados ─────────────────────────────────

  function setAprendizadoStatus(msg, erro) {
    const el = document.getElementById('aprendizados-status')
    if (!el) return
    el.textContent = msg || ''
    el.classList.toggle('config-status-erro', !!erro)
  }

  function renderAprendizados(data) {
    const lista = document.getElementById('aprendizados-lista')
    const badge = document.getElementById('aprendizados-pendentes-badge')
    const info = document.getElementById('aprendizados-analises-pendentes')
    if (!lista) return

    const aprendizados = Array.isArray(data?.aprendizados) ?data.aprendizados : []
    const pendentes = aprendizados.filter((a) => a.ativo && !a.aprovado).length
    const ativos = aprendizados.filter((a) => a.ativo && a.aprovado).length

    if (badge) badge.textContent = pendentes > 0 ?pendentes + ' pendente(s)' : ativos + ' ativa(s)'
    if (info) info.textContent = data?.analises_pendentes != null
      ?data.analises_pendentes + ' analise(s) desde ultima consolidacao'
      : ''

    if (!aprendizados.length) {
      lista.innerHTML = '<div class="vazio">Nenhum aprendizado consolidado ainda.</div>'
      return
    }

    lista.innerHTML = aprendizados.map((a) => {
      const when = a.criado_em ?new Date(a.criado_em).toLocaleString('pt-BR') : '--'
      const statusClass = !a.ativo ?'inativo' : a.aprovado ?'fechado' : 'ativo'
      const alvoRaw = a.prompt_alvo || 'system'
      const statusLabel = !a.ativo ?'desativado'
        : a.aplicado_como === 'overlay'
          ?'overlay em ' + labelPromptAlvoBadge(alvoRaw)
        : a.aprovado ?'ativo no prompt'
        : 'pendente de aprovacao'
      const impactoLabel = a.impacto === 'estrutural' ?'estrutural' : 'leve'
      const impactoBadge = '<span style="font-size:.7rem;padding:2px 6px;border-radius:4px;background:' +
        (a.impacto === 'estrutural' ?'var(--cor-alerta)' : 'var(--cor-neutro)') +
        ';color:#fff;margin-left:.4rem">' + impactoLabel + '</span>'
      const alvoBadge = '<span style="font-size:.7rem;padding:2px 6px;border-radius:4px;background:var(--cor-info,#2563eb);color:#fff;margin-left:.35rem">' +
        esc(labelPromptAlvoBadge(alvoRaw)) + '</span>'
      let botoes = ''
      if (a.ativo && !a.aprovado) {
        botoes = '<button class="btn-reproc btn-aprovar-aprendizado" data-id="' + a.id + '">Aprovar</button> '
        if (a.impacto === 'estrutural') {
          botoes += '<button class="btn-reproc btn-overlay-aprendizado" data-id="' + a.id + '" data-prompt-alvo="' +
            esc(alvoRaw) + '" style="background:var(--cor-info,#2563eb)">Aplicar como overlay</button> '
        }
        botoes += '<button class="btn-reproc btn-desativar-aprendizado" data-id="' + a.id + '" style="background:var(--cor-critica)">Rejeitar</button>'
      } else if (a.ativo && a.aprovado) {
        botoes = '<button class="btn-reproc btn-desativar-aprendizado" data-id="' + a.id + '" style="background:var(--cor-critica)">Desativar</button>'
      }
      return (
        '<article class="funil-aprendizado-item" style="border-left:3px solid var(--cor-' + (a.aprovado && a.ativo ?'sucesso' : !a.ativo ?'neutro' : 'alerta') + ');padding:.75rem;margin-bottom:.5rem;border-radius:8px;background:var(--bg-card)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">' +
        '<span class="estagio-badge ' + statusClass + '">' + esc(statusLabel) + '</span>' + impactoBadge + alvoBadge +
        '<span style="font-size:.75rem;opacity:.6">' + esc(when) + ' · ' + esc(a.etapa || 'geral') + ' · ' + a.total_analises + ' analises</span>' +
        '</div>' +
        '<pre style="white-space:pre-wrap;font-size:.82rem;line-height:1.5;margin:.35rem 0">' + esc(a.regras) + '</pre>' +
        '<div style="margin-top:.4rem">' + botoes + '</div>' +
        '</article>'
      )
    }).join('')

    lista.querySelectorAll('.btn-aprovar-aprendizado').forEach((btn) => {
      btn.addEventListener('click', () => acaoAprendizado(btn.dataset.id, 'aprovar'))
    })
    lista.querySelectorAll('.btn-desativar-aprendizado').forEach((btn) => {
      btn.addEventListener('click', () => acaoAprendizado(btn.dataset.id, 'desativar'))
    })
    lista.querySelectorAll('.btn-overlay-aprendizado').forEach((btn) => {
      btn.addEventListener('click', () => aplicarOverlayAprendizado(btn.dataset.id, btn.dataset.promptAlvo))
    })
  }

  async function carregarAprendizados() {
    try {
      const d = await fetchJson('/dashboard/prompt-aprendizados')
      if (d) renderAprendizados(d)
    } catch (e) {
      setAprendizadoStatus(e.message || 'Falha ao carregar aprendizados', true)
    }
  }

  async function consolidarAprendizados() {
    const btn = document.getElementById('btn-consolidar-aprendizados')
    try {
      if (btn) btn.disabled = true
      setAprendizadoStatus('Consolidando analises...')
      const d = await fetchJson('/dashboard/consolidar-aprendizados', {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({}),
      })
      if (d && d.ok) {
        setAprendizadoStatus('Consolidacao concluida. Regra gerada aguarda aprovacao.')
      } else {
        setAprendizadoStatus(d?.motivo || 'Nenhum padrao recorrente encontrado.', false)
      }
      await carregarAprendizados()
    } catch (e) {
      setAprendizadoStatus(e.message || 'Falha ao consolidar', true)
    } finally {
      if (btn) btn.disabled = false
    }
  }

  async function acaoAprendizado(id, acao) {
    try {
      await fetchJson('/dashboard/prompt-aprendizados/' + id + '/' + acao, {
        method: 'POST',
        headers: headersJson(),
        body: '{}',
      })
      await carregarAprendizados()
    } catch (e) {
      setAprendizadoStatus(e.message || 'Falha na acao', true)
    }
  }

  async function aplicarOverlayAprendizado(id, promptAlvo) {
    const alvo = promptAlvo || 'system'
    const dest = labelPromptAlvoOverlayConfirm(alvo)
    if (!confirm('Incorporar esta regra no ' + dest + ' via overlay no banco. Confirma?')) return
    const msgWait =
      alvo === 'followup_timing'
        ?'Aplicando overlay ao prompt de timing (geralmente rapido)...'
        : alvo === 'followup'
          ?'Aplicando overlay ao prompt de follow-up...'
          : 'Aplicando overlay (pode levar varios minutos — prompt grande)...'
    try {
      setAprendizadoStatus(msgWait)
      const d = await fetchJson('/dashboard/prompt-aprendizados/' + id + '/aplicar-overlay', {
        method: 'POST',
        headers: headersJson(),
        body: '{}',
      })
      if (d?.ok) {
        const ch = d.chave_overlay ?' [' + d.chave_overlay + ']' : ''
        setAprendizadoStatus('Overlay aplicado' + ch + ' (v' + (d.overlay_version || '?') + ', ' + (d.prompt_chars || '?') + ' chars)')
      }
      await carregarAprendizados()
    } catch (e) {
      setAprendizadoStatus(e.message || 'Falha ao aplicar overlay', true)
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-funil-analisar')?.addEventListener('click', analisarEtapa)
    document.getElementById('funil-etapa')?.addEventListener('change', async () => {
      atualizarPromptPreview()
      renderMelhoria(null)
      const t = iniciarMensagensProgresso({ atualizarResultado: false, intervaloMs: 3000 })
      try {
        await carregarHistorico()
      } finally {
        pararProgresso(t)
      }
      setStatus(textoStatusPadraoPorEtapa())
    })
    document.getElementById('funil-fonte')?.addEventListener('change', () => {
      const fonte = document.getElementById('funil-fonte')?.value
      document.getElementById('funil-limit').disabled = fonte === 'colar'
    })
    document.getElementById('btn-consolidar-aprendizados')?.addEventListener('click', consolidarAprendizados)
    carregarConfig().catch((e) => setStatus(e.message || 'Falha ao carregar config', true))
    carregarAprendizados()
  })
})()
