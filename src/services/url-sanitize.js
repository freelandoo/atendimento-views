'use strict'

// Bloqueia URLs claramente placeholder. NUNCA deixar a IA emitir.
const FAKE_URL_PATTERNS = [
  /^https?:\/\/(www\.)?example\.(com|org|net|io)/i,
  /^https?:\/\/(www\.)?(yoursite|seu-?site|teste|test|tests|dominio|domain|placeholder|sample|demo|fake)\./i,
  /^https?:\/\/(www\.)?site\.com(\/|$)/i,
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
  /^https?:\/\/(www\.)?lorem(ipsum)?\./i,
  /^https?:\/\/(www\.)?xn--[^/]+\.test/i,
  /^https?:\/\/[^/]+\.invalid(\/|$)/i,
  /^https?:\/\/(www\.)?(empresa|company|nome|nomedaempresa)\.(com|org|net|io)/i,
]

// URL syntax válida (regex grosseiro mas suficiente)
function ehUrlValida(s) {
  if (!s || typeof s !== 'string') return false
  const u = s.trim()
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(u)) return false
  return true
}

function ehUrlFalsa(s) {
  if (!s || typeof s !== 'string') return true
  const u = s.trim()
  if (!ehUrlValida(u)) return true
  return FAKE_URL_PATTERNS.some((rx) => rx.test(u))
}

// Limpa string única — devolve URL ou string vazia
function sanitizarUrl(url, fallback = '') {
  if (!url) return fallback || ''
  if (ehUrlFalsa(url)) return fallback || ''
  return String(url).trim()
}

// Limpa array de URLs/objetos {label, url}. Filtra e dedup.
function sanitizarListaLinks(arr, fallback = '') {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    if (!item) continue
    if (typeof item === 'string') {
      const u = sanitizarUrl(item, fallback)
      if (u && !seen.has(u)) { seen.add(u); out.push({ label: u, url: u, tipo: 'outro' }) }
    } else if (typeof item === 'object') {
      const url = sanitizarUrl(item.url || item.href || item.link || '', fallback)
      if (url && !seen.has(url)) {
        seen.add(url)
        out.push({
          label: String(item.label || item.titulo || item.nome || url).trim().slice(0, 200),
          url,
          tipo: typeof item.tipo === 'string' ? item.tipo : 'outro',
          ...(item.quando_enviar ? { quando_enviar: String(item.quando_enviar).slice(0, 300) } : {}),
        })
      }
    }
  }
  return out
}

// Substitui qualquer fake URL por fallback dentro de texto livre.
function sanitizarUrlsEmTexto(texto, fallback = '') {
  if (!texto || typeof texto !== 'string') return texto || ''
  return texto.replace(/https?:\/\/[^\s)>\]]+/gi, (match) => {
    return ehUrlFalsa(match) ? (fallback || '') : match
  })
}

// Aplica sanitização full no JSON do playbook v2.
// fallback = link_principal real (vindo do contexto1 ou da fonte importada).
function sanitizarPlaybookUrls(playbook, fallback = '') {
  if (!playbook || typeof playbook !== 'object') return playbook
  const f = sanitizarUrl(fallback, '')

  // links_uteis_estruturados
  if (Array.isArray(playbook.links_uteis_estruturados)) {
    playbook.links_uteis_estruturados = sanitizarListaLinks(playbook.links_uteis_estruturados, f)
  }

  // cadastro_e_onboarding.link_cadastro
  if (playbook.cadastro_e_onboarding && typeof playbook.cadastro_e_onboarding === 'object') {
    playbook.cadastro_e_onboarding.link_cadastro = sanitizarUrl(
      playbook.cadastro_e_onboarding.link_cadastro,
      f
    )
    if (typeof playbook.cadastro_e_onboarding.resposta_base_cadastro === 'string') {
      playbook.cadastro_e_onboarding.resposta_base_cadastro = sanitizarUrlsEmTexto(
        playbook.cadastro_e_onboarding.resposta_base_cadastro, f
      )
    }
  }

  // respostas_base — entradas podem ter URLs
  if (Array.isArray(playbook.respostas_base)) {
    playbook.respostas_base = playbook.respostas_base.map((r) => {
      if (typeof r === 'string') return sanitizarUrlsEmTexto(r, f)
      if (r && typeof r === 'object') {
        const out = { ...r }
        for (const k of Object.keys(out)) {
          if (typeof out[k] === 'string') out[k] = sanitizarUrlsEmTexto(out[k], f)
        }
        return out
      }
      return r
    })
  }

  // handoff.mensagem_para_lead / mensagem_para_operador
  if (playbook.handoff && typeof playbook.handoff === 'object') {
    if (typeof playbook.handoff.mensagem_para_lead === 'string') {
      playbook.handoff.mensagem_para_lead = sanitizarUrlsEmTexto(playbook.handoff.mensagem_para_lead, f)
    }
  }

  // resumo_empresa pode ter site/url
  if (playbook.resumo_empresa && typeof playbook.resumo_empresa === 'object') {
    for (const k of ['site', 'url', 'link_principal']) {
      if (playbook.resumo_empresa[k]) {
        playbook.resumo_empresa[k] = sanitizarUrl(playbook.resumo_empresa[k], f)
      }
    }
  }

  return playbook
}

// Sanitiza decisão da IA (mensagem_pro_lead) substituindo fake URLs pelo link real.
function sanitizarDecisaoUrls(decisao, fallback = '') {
  if (!decisao || typeof decisao !== 'object') return decisao
  const f = sanitizarUrl(fallback, '')
  if (typeof decisao.mensagem_pro_lead === 'string') {
    decisao.mensagem_pro_lead = sanitizarUrlsEmTexto(decisao.mensagem_pro_lead, f)
  }
  return decisao
}

module.exports = {
  FAKE_URL_PATTERNS,
  ehUrlValida,
  ehUrlFalsa,
  sanitizarUrl,
  sanitizarListaLinks,
  sanitizarUrlsEmTexto,
  sanitizarPlaybookUrls,
  sanitizarDecisaoUrls,
}
