'use strict'

function limparSaidaTextoClaude(texto) {
  if (!texto || typeof texto !== 'string') return ''
  let s = texto.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  s = s.replace(/^json\s*\n/i, '').trim()
  return s
}

function extrairPrimeiroObjetoJsonBalanceado(texto) {
  const s = limparSaidaTextoClaude(texto)
  const start = s.indexOf('{')
  if (start === -1) return ''
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      continue
    }
    if (c === '"') inString = !inString
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return ''
}

/** Normaliza saída do modelo (prefixo "json", fences ``` e ```json) e extrai o primeiro objeto JSON balanceado. */
function parsearRespostaJsonClaude(texto) {
  if (!texto || typeof texto !== 'string') return null
  const s = limparSaidaTextoClaude(texto)
  const candidatos = []
  const pushCand = (c) => {
    const t = typeof c === 'string' ? c.trim() : ''
    if (t && !candidatos.includes(t)) candidatos.push(t)
  }
  pushCand(s)
  for (const m of texto.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (m[1]) pushCand(m[1].trim())
  }
  const balanceado = extrairPrimeiroObjetoJsonBalanceado(s)
  if (balanceado) pushCand(balanceado)
  for (const cand of candidatos) {
    if (!cand) continue
    try {
      return JSON.parse(cand)
    } catch (_) {}
  }
  return null
}

/**
 * Remove prefixo de citação estilo WhatsApp (bloco inicial de linhas com ">"),
 * que costuma colar a pergunta anterior do assistente na mensagem do lead.
 */
function stripCitacaoWhatsappTexto(s) {
  if (s == null || typeof s !== 'string') return ''
  let t = s.replace(/^\uFEFF|\u200E/g, '')
  const lines = t.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('>')) {
      i++
      continue
    }
    if (trimmed === '' && i + 1 < lines.length && lines[i + 1].trimStart().startsWith('>')) {
      i++
      continue
    }
    break
  }
  return lines.slice(i).join('\n').trim()
}

function stripCitacaoEmContentMensagem(content) {
  if (typeof content === 'string') return stripCitacaoWhatsappTexto(content)
  if (!Array.isArray(content)) return content
  return content.map((b) => {
    if (!b || typeof b !== 'object') return b
    if (b.type === 'text' && typeof b.text === 'string') return { ...b, text: stripCitacaoWhatsappTexto(b.text) }
    return b
  })
}

/** Mascara CPF no texto enviado ao WhatsApp (somente se SANITIZAR_CPF_RESPOSTA estiver ativo). */
function sanitizarCpfNaSaidaTexto(texto, habilitado = false) {
  if (!habilitado || !texto || typeof texto !== 'string') return texto
  return texto.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF omitido]')
}

/** Troca placeholders de empresa por marca real antes do envio ao lead. */
function sanitizarPlaceholderEmpresaNaSaidaTexto(texto) {
  if (!texto || typeof texto !== 'string') return texto
  return texto.replace(/\[(empresa)\]/gi, '{{empresa}}')
}

/**
 * Extrai texto plano de um campo `content` (string ou array de blocos).
 * Usado internamente para comparação de eco.
 */
function textoDeContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && typeof b.text === 'string' ? b.text : ''))
    .join(' ')
    .trim()
}

function stripEcoAssistenteNoHistorico(msgs) {
  const out = []
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.role !== 'user') {
      out.push(m)
      continue
    }

    const conteudo = typeof m.content === 'string' ? m.content : textoDeContent(m.content)
    if (!conteudo || conteudo.length < 5) {
      out.push(m)
      continue
    }

    let textoAssistente = null
    for (let j = i - 1; j >= 0; j--) {
      if (msgs[j].role === 'assistant') {
        textoAssistente = textoDeContent(msgs[j].content)
        break
      }
    }

    if (!textoAssistente || textoAssistente.length < 20) {
      out.push(m)
      continue
    }

    const prefixRef = textoAssistente.slice(0, 600)
    let stripped = null

    if (conteudo.startsWith(prefixRef)) {
      const resto = conteudo.slice(prefixRef.length).replace(/^[\r\n\s]+/, '')
      if (resto) stripped = resto
    } else {
      const nlIdx = conteudo.indexOf('\n')
      if (nlIdx >= 20) {
        const primeiraLinha = conteudo.slice(0, nlIdx)
        if (prefixRef.startsWith(primeiraLinha) || primeiraLinha === prefixRef.slice(0, nlIdx)) {
          const resto = conteudo.slice(nlIdx + 1).trim()
          if (resto) stripped = resto
        }
      }
    }

    out.push(stripped ? { ...m, content: stripped } : m)
  }
  return out
}

/** Histórico vindo do pg como string JSON ou formato inesperado. */
function normalizarHistoricoMensagens(raw) {
  if (raw == null) return []
  let h = raw
  if (typeof h === 'string') {
    try {
      h = JSON.parse(h)
    } catch (_) {
      return []
    }
  }
  if (!Array.isArray(h)) return []
  const normalizado = h
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const out = { ...m }
      if (typeof out.content === 'string') {
        out.content = stripCitacaoWhatsappTexto(out.content)
      } else if (Array.isArray(out.content)) {
        out.content = stripCitacaoEmContentMensagem(out.content)
      }
      return out
    })
  return stripEcoAssistenteNoHistorico(normalizado)
}

function slugify(texto) {
  if (!texto) return ''
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function gerarSlugEmpresa(nome) {
  const base = slugify(nome) || 'empresa'
  const sufixo = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${base}-${sufixo}`
}

module.exports = {
  limparSaidaTextoClaude,
  extrairPrimeiroObjetoJsonBalanceado,
  parsearRespostaJsonClaude,
  stripCitacaoWhatsappTexto,
  stripCitacaoEmContentMensagem,
  sanitizarCpfNaSaidaTexto,
  sanitizarPlaceholderEmpresaNaSaidaTexto,
  textoDeContent,
  stripEcoAssistenteNoHistorico,
  normalizarHistoricoMensagens,
  slugify,
  gerarSlugEmpresa,
}
