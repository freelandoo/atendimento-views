'use strict'

/** Texto padrão quando o dado não existe no perfil ou na IA. */
const NI = 'não informado'

const CHECKLIST_POS_FECHAMENTO_PADRAO = [
  'Confirmar escopo (páginas, funcionalidades, integrações) e registrar no contrato (DocuSign).',
  'Alinhar prazo de entrega, revisões incluídas e formato de entrega (site, hospedagem, domínio).',
  'Coletar materiais do cliente: logo, fotos, textos, cores e referências visuais.',
  'Validar canais oficiais: WhatsApp comercial, Instagram, Google Meu Negócio e outros links.',
  'Agendar kickoff técnico e definir canal de comunicação durante o projeto.',
]

const PADRAO_VENDER_REUNIAO = [
  'PJ Codeworks como soluções em código, tecnologia, sites, sistemas, automações e agentes de IA.',
  'Site como produto completo: experiência do usuário, performance e estrutura para SEO local como parte da entrega — não só “aparecer no Google”.',
  'Fluxo claro de conversão: visitante entende o serviço e chama no WhatsApp com poucos cliques.',
  'Suporte pós-entrega e evolução (mensalidade / melhorias) quando fizer sentido ao escopo.',
]

const PADRAO_EVITAR_REUNIAO = [
  'Prometer posição fixa no Google ou resultado exclusivamente orgânico sem contexto de escopo.',
  'Tratar SEO como promessa isolada — é componente da criação do site quando combinado.',
  'Pedir dados sensíveis (CPG, cartão, documentos) fora do canal formal do contrato.',
]

function slugifySegment(raw) {
  const s = String(raw ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .trim()
  return s || 'nao-informado'
}

function telefoneLimpo(numero) {
  return String(numero ?? '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/\D/g, '')
}

function lerObjetoJsonLoose(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw)
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
    } catch (_) {
      return {}
    }
  }
  return {}
}

function parseCidadeEstado(cidadeRaw) {
  const full = String(cidadeRaw ?? '').trim()
  if (!full) return { cidadeCompleta: NI, city: NI, state: NI }
  const parts = full.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
    const uf = parts[parts.length - 1].toUpperCase()
    const city = parts.slice(0, -1).join(' - ')
    return { cidadeCompleta: full, city: city || NI, state: uf }
  }
  return { cidadeCompleta: full, city: full || NI, state: NI }
}

function inferirTemperatura(perfil, overlayLead) {
  const t = String(overlayLead?.temperature ?? perfil?.temperatura_lead ?? '')
    .trim()
    .toLowerCase()
  if (t === 'quente' || t === 'morno' || t === 'frio') return t
  return undefined
}

function tipoNegocioPorComplexidade(c) {
  const x = String(c ?? '').toLowerCase()
  if (x === 'landing') return 'Landing / página focada em conversão'
  if (x === 'servicos') return 'Site de serviços / institucional'
  if (x === 'sistema') return 'Sistema, automação ou escopo digital mais profundo'
  return NI
}

function inferirPlanoComercial(perfil) {
  const prod = String(perfil?.produto_sugerido ?? '').toLowerCase()
  if (prod.includes('personal') || prod.includes('reuniao')) return 'personalizado'
  const pr = String(perfil?.precificacao_json?.plano_recomendado ?? '').toLowerCase()
  if (['iniciante', 'padrao', 'premium'].includes(pr)) return pr
  const ps = String(perfil?.plano_sugerido ?? '').toLowerCase()
  if (['iniciante', 'padrao', 'premium'].includes(ps)) return ps
  return 'personalizado'
}

function reuniaoNormalizada(perfil) {
  return lerObjetoJsonLoose(perfil?.reuniao_proposta)
}

function formatarDataBr(iso) {
  const s = String(iso ?? '').trim()
  if (!s || s === NI) return NI
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return s
  return `${m[3]}/${m[2]}/${m[1]}`
}

function extrairListaOverlay(val) {
  if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean)
  if (typeof val === 'string' && val.trim()) return [val.trim()]
  return []
}

function inferirServicosPorNicho(negocio) {
  const n = String(negocio ?? '').toLowerCase()
  const mapa = [
    ['vidro', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],
    ['vidrac', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],
    ['eletric', ['Instalações residenciais', 'Manutenção e adequação NR-10', 'Quadros e iluminação']],
    ['pintura', ['Pintura residencial', 'Pintura predial', 'Acabamento profissional']],
    ['barbear', ['Cortes', 'Barba', 'Agendamento pelo WhatsApp']],
    ['dent', ['Consultas', 'Tratamentos', 'Agendamento rápido']],
    ['foto', ['Ensaios', 'Eventos', 'Portfólio profissional']],
    ['limpeza', ['Limpeza residencial', 'Higienização', 'Orçamento pelo WhatsApp']],
  ]
  for (const [needle, servs] of mapa) {
    if (n.includes(needle)) return servs
  }
  return ['Serviços principais', 'Chamada para WhatsApp', 'Prova social / antes e depois']
}

function mergeDeepLoose(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, pv] of Object.entries(patch)) {
    if (pv == null) continue
    const cur = out[k]
    if (
      pv &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      out[k] = mergeDeepLoose(cur, pv)
    } else {
      out[k] = pv
    }
  }
  return out
}

function montarSiteStructurePadrao() {
  return {
    hero: 'Destaque da proposta de valor, nicho e cidade; botão principal para WhatsApp.',
    sobre: 'Quem é o negócio, experiência e tom de confiança.',
    servicos: 'Lista clara dos serviços com benefícios (não só nomes).',
    diferenciais: 'Por que escolher este profissional/empresa na região.',
    areaAtendimento: 'Cidades e regiões atendidas (reforço local).',
    provaSocial: 'Depoimentos, avaliações, fotos de trabalhos (quando houver).',
    chamadaWhatsapp: 'CTA fixo ou flutuante para conversa rápida.',
    faq: 'Objeções frequentes e respostas curtas.',
    ctaFinal: 'Último empurrão para contato com próximo passo claro.',
  }
}

function montarPromptHeroIA({ niche, city, state, mainPain, styleHint }) {
  const local = [city, state].filter((x) => x && x !== NI).join(' - ') || NI
  const dor = mainPain && mainPain !== NI ? ` Contexto de dor do cliente: ${mainPain}.` : ''
  const estilo = styleHint || 'Visual limpo, confiável e moderno, estilo realista premium, iluminação natural.'
  return (
    `Crie uma imagem hero profissional para um site de ${niche} em ${local}.${dor} ` +
    `${estilo} Mostrar cenário coerente com o nicho e o público local, transmitindo segurança, organização e profissionalismo. ` +
    `Composição horizontal adequada para hero de site, com espaço livre à esquerda para inserir título e botão de WhatsApp. ` +
    `Sem textos na imagem. Sem logotipos fictícios ou marcas reconhecíveis. Proporção 16:9.`
  )
}

function montarPromptApoioIA({ niche, city, state }) {
  const local = [city, state].filter((x) => x && x !== NI).join(' - ') || NI
  return (
    `Imagem de apoio para página de serviços ou seção intermediária — ${niche} em ${local}. ` +
    `Detalhe contextual do trabalho (ferramentas, ambiente, materiais), mantendo o mesmo tom premium e realista do hero. ` +
    `Sem texto na imagem. Sem logos. Proporção 4:3.`
  )
}

/**
 * Prompt para imagem de prévia da landing “pronta” (handoff interno) — não é wireframe.
 * Usa apenas dados do handoff; a geração HTTP continua em `gerarImagemOpenAiPorPrompt`.
 *
 * @param {Record<string, unknown>} handoff — objeto ProjectHandoff (ou parcial com lead + briefing).
 */
function gerarPromptImagemEstruturaSiteHandoff(handoff) {
  const l = handoff.lead || {}
  const b = handoff.briefing || {}
  const niche = String(l.niche ?? '').trim() || NI
  const loc = [l.city, l.state].filter((x) => x && x !== NI).join(' - ') || NI
  const nLower = niche.toLowerCase()

  let blocoNichoEspecifico = ''
  if (/eletric/i.test(nLower)) {
    blocoNichoEspecifico =
      `A página deve transmitir segurança, urgência, confiança e atendimento local.\n` +
      `Use elementos visuais sutis de elétrica, quadro de distribuição, ferramentas, iluminação residencial e manutenção predial.\n` +
      `A estrutura deve mostrar hero, serviços, diferenciais, região de atendimento e CTA para WhatsApp.\n` +
      `Visual moderno, premium, limpo, com fundo branco/off-white, azul #0168FF como cor de ação, preto/azul escuro para autoridade, cards arredondados e aparência de site real.\n` +
      `Não criar wireframe. Não criar blueprint. Não criar rabisco. Não colocar textos longos ilegíveis.`
  }

  const servicosLinha =
    Array.isArray(b.mainServices) && b.mainServices.length > 0
      ? `Sugira visualmente nos cards de serviços (títulos curtos legíveis, sem microtexto): ${b.mainServices
          .slice(0, 4)
          .join(', ')}.\n`
      : ''

  const dorLinha =
    b.mainPain && String(b.mainPain).trim() && String(b.mainPain).trim() !== NI
      ? `Contexto de negócio (reflita de forma sutil na composição): ${String(b.mainPain).trim()}.\n`
      : ''

  const nucleo = `Crie uma prévia visual profissional de uma landing page pronta para ${niche} em ${loc}.
A imagem deve parecer uma tela real de site moderno, premium e comercial, não um wireframe.
Layout horizontal em formato desktop, com visual limpo, tecnológico e confiável.

Estrutura da página visível:
1. Header com logo fictício do negócio à esquerda e botão de WhatsApp à direita.
2. Hero com título forte, subtítulo, botão de WhatsApp e imagem/elemento visual relacionado ao nicho.
3. Seção de serviços em cards.
4. Seção de diferenciais com ícones.
5. Seção de área de atendimento/localização.
6. CTA final chamando para orçamento pelo WhatsApp.

Direção visual:
Fundo branco/off-white, detalhes em azul vibrante #0168FF, preto/azul escuro para autoridade, cards arredondados, sombras suaves, espaçamento premium e aparência de site real.
O design deve transmitir confiança, organização, profissionalismo e conversão.
A linguagem visual deve soar compatível com produto digital tech premium (referência interna: PJ Codeworks), sem exibir o nome ou logo da PJ Codeworks como marca do cliente — apenas site do negócio fictício.

Não usar textos pequenos ilegíveis.
Não usar marca PJ Codeworks como marca do cliente.
Não gerar apenas wireframe.
Não gerar layout rabiscado ou blueprint técnico.
Não gerar imagem genérica sem estrutura clara de página de site.
A imagem precisa servir como referência visual para construção posterior do site.`

  const partes = [nucleo.trim()]
  if (servicosLinha) partes.push(servicosLinha.trim())
  if (dorLinha) partes.push(dorLinha.trim())
  if (blocoNichoEspecifico) partes.push(blocoNichoEspecifico.trim())
  return partes.join('\n\n')
}

/**
 * Monta o objeto ProjectHandoff a partir do perfil, preço e opcionalmente enriquecimento da IA (`resultado.project_handoff`).
 */
function buildProjectHandoff({
  numero,
  perfil = {},
  preco = {},
  motivo,
  resumoHandoff,
  resultado = {},
}) {
  const phone = telefoneLimpo(numero)
  const coletados = lerObjetoJsonLoose(perfil.campos_coletados)
  const { cidadeCompleta, city, state } = parseCidadeEstado(perfil.cidade ?? coletados.cidade)
  const niche = String(perfil.negocio ?? coletados.negocio ?? '').trim() || NI
  const reuniao = reuniaoNormalizada(perfil)

  const overlayRaw =
    resultado && typeof resultado.project_handoff === 'object' && resultado.project_handoff
      ? resultado.project_handoff
      : {}

  const nome =
    String(overlayRaw.lead?.name ?? perfil.apelido ?? coletados.nome ?? coletados.nome_completo ?? '').trim() ||
    undefined
  const email = String(overlayRaw.lead?.email ?? coletados.email ?? '').trim() || undefined

  const total = Number(preco.total ?? perfil.preco_calculado ?? 0)
  const entrada = Number(preco.entrada ?? perfil.entrada ?? 0)
  const parcela = Number(preco.parcela ?? perfil.parcela ?? 0)

  const base = {
    lead: {
      name: nome,
      phone,
      email,
      niche,
      businessType: tipoNegocioPorComplexidade(perfil.complexidade),
      city: city === NI ? cidadeCompleta : city,
      state,
      temperature: inferirTemperatura(perfil, overlayRaw.lead),
      painScore:
        perfil.score_dor != null && Number.isFinite(Number(perfil.score_dor))
          ? Number(perfil.score_dor)
          : perfil.termometro_dor != null && Number.isFinite(Number(perfil.termometro_dor))
            ? Number(perfil.termometro_dor)
            : undefined,
      complexity: String(perfil.complexidade ?? '').trim() || NI,
    },
    commercial: {
      reason: String(motivo ?? '').trim() || NI,
      plan: inferirPlanoComercial(perfil),
      totalPrice: total > 0 ? total : undefined,
      entryPrice: entrada > 0 ? entrada : undefined,
      installments:
        parcela > 0
          ? { quantity: 3, value: parcela }
          : undefined,
      monthlyFee: undefined,
      monthlyStartsAfter: undefined,
      freeDays: undefined,
      roi:
        perfil.precificacao_json?.roi_score != null && Number.isFinite(Number(perfil.precificacao_json.roi_score))
          ? Math.round(Number(perfil.precificacao_json.roi_score) * 100)
          : undefined,
      objections: [],
      sellingPoints: [...PADRAO_VENDER_REUNIAO],
    },
    meeting: {
      date: formatarDataBr(reuniao.data_confirmada ?? reuniao.data_sugerida),
      time: String(reuniao.horario_confirmado ?? '').trim() || NI,
      durationMinutes:
        reuniao.duracao_maxima_minutos != null && Number.isFinite(Number(reuniao.duracao_maxima_minutos))
          ? Number(reuniao.duracao_maxima_minutos)
          : 15,
      goal: 'Alinhar escopo do site/projeto, investimento e próximos passos com clareza.',
      suggestedOpening:
        'Agradecer o horário, contextualizar que a PJ Codeworks trabalha com sites, sistemas e automações, e perguntar qual resultado ele espera ver online nos próximos meses.',
      recommendedTone: 'Consultivo, direto e seguro — técnico o suficiente sem jargon desnecessário.',
      reinforce: [...PADRAO_VENDER_REUNIAO],
      avoid: [...PADRAO_EVITAR_REUNIAO],
      nextSteps: [
        'Confirmar necessidades e materiais disponíveis.',
        'Apresentar estrutura sugerida e integrações.',
        'Fechar escopo e enviar contrato (DocuSign).',
      ],
      checklistPosFechamento: [...CHECKLIST_POS_FECHAMENTO_PADRAO],
    },
    briefing: {
      googlePresenceNote:
        perfil.ja_aparece_google === true
          ? 'Lead indicou que já aparece no Google.'
          : perfil.ja_aparece_google === false
            ? 'Lead indicou que não aparece bem ou não aparece.'
            : NI,
      projectGoal:
        'Presença digital profissional que explica serviços, gera confiança e leva o cliente ao WhatsApp — com base técnica e espaço para SEO local dentro da entrega.',
      targetAudience: `Moradores e empresas da região de ${city !== NI ? city : cidadeCompleta} que buscam ${niche}.`,
      mainServices: inferirServicosPorNicho(niche),
      serviceRegion: cidadeCompleta !== NI ? cidadeCompleta : NI,
      differentiators: extrairListaOverlay(perfil.personalizacao_nicho_cidade_enviada ? ['Personalização já alinhada ao nicho/cidade'] : []),
      competitors: Array.isArray(perfil.concorrentes)
        ? perfil.concorrentes.map((c) => String(c)).filter(Boolean).slice(0, 6)
        : [],
      mainPain: String(perfil.dor_principal ?? '').trim() || NI,
      sitePromise:
        'Transparência no que será entregue, página rápida e clara, e caminho curto para contato no WhatsApp.',
      requiredCtas: ['WhatsApp', 'Solicitar orçamento / chamada rápida'],
      integrations: ['Formulário ou disparo para WhatsApp', 'Google Analytics / Meta Pixel (se aplicável)'],
      importantLinks: {
        instagram: String(coletados.instagram ?? '').trim() || undefined,
        whatsapp: phone ? `https://wa.me/${phone}` : undefined,
        googleBusiness: String(coletados.google_meu_negocio ?? coletados.gmb ?? '').trim() || undefined,
        website: String(coletados.site ?? coletados.website ?? '').trim() || undefined,
      },
      recommendedSections: [
        'Hero com proposta de valor',
        'Serviços principais',
        'Prova social',
        'Área de atuação',
        'FAQ',
        'CTA final',
      ],
    },
    siteStructure: montarSiteStructurePadrao(),
    seoLocal: {
      mainKeyword:
        city !== NI && niche !== NI ? `${niche} ${city}` : niche !== NI ? niche : NI,
      secondaryKeywords: [
        `${niche} ${city !== NI ? city : ''}`.trim(),
        `${niche} ${state !== NI ? state : ''}`.trim(),
      ].filter((x) => x && !/^undefined/.test(x)),
      city: city !== NI ? city : cidadeCompleta,
      regions: state !== NI ? [state] : [],
      suggestedTitle:
        city !== NI && niche !== NI ? `${niche} em ${city} — site profissional e WhatsApp` : `${niche} — presença digital`,
      suggestedMetaDescription:
        city !== NI && niche !== NI
          ? `${niche} em ${city}: site rápido, claro e focado em gerar contato pelo WhatsApp.`
          : `Site profissional para ${niche}, com estrutura para SEO local como parte da entrega.`,
    },
    initialContent: {
      headline:
        city !== NI && niche !== NI ? `${niche} em ${city}` : `${niche}`,
      subtitle:
        'Solução em site profissional com foco em conversão, organização do conteúdo e performance.',
      apresentacao:
        'A PJ Codeworks desenvolve sites, sistemas, automações e agentes de IA. Neste projeto, o foco é criar uma vitrine digital que comunica serviços com clareza e leva o visitante ao próximo passo (WhatsApp).',
      servicos: inferirServicosPorNicho(niche),
      ctas: ['Chamar no WhatsApp', 'Pedir orçamento'],
      faq: [
        { pergunta: 'Quanto tempo leva?', resposta: NI },
        { pergunta: 'O que preciso enviar para começar?', resposta: 'Logo, fotos dos trabalhos e informações de contato.' },
      ],
    },
    aiImage: {
      type: 'site_preview',
      heroPrompt: '',
      sitePreviewPrompt: '',
      supportPrompt: '',
      style:
        'Landing desktop premium: fundo off-white, ação #0168FF, autoridade em azul escuro/preto, cards arredondados, sombras suaves — aparência de site real (não wireframe).',
      aspectRatio: '16:9',
      brandingNotes:
        'Prévia interna alinhada ao posicionamento PJ Codeworks (tech, código, produto digital); sem usar PJ Codeworks como marca do cliente na arte.',
      status: 'pending',
    },
    generatedFiles: {},
    rawDigest: typeof resumoHandoff === 'string' ? resumoHandoff.slice(0, 4000) : undefined,
  }

  base.aiImage.heroPrompt = montarPromptHeroIA({
    niche,
    city: base.lead.city,
    state: base.lead.state,
    mainPain: base.briefing.mainPain,
    styleHint: overlayRaw.aiImage?.style,
  })
  base.aiImage.supportPrompt = montarPromptApoioIA({
    niche,
    city: base.lead.city,
    state: base.lead.state,
  })
  base.aiImage.sitePreviewPrompt = gerarPromptImagemEstruturaSiteHandoff(base)
  if (overlayRaw.aiImage?.aspectRatio) {
    base.aiImage.aspectRatio = overlayRaw.aiImage.aspectRatio
  }

  const merged = mergeDeepLoose(base, overlayRaw)

  merged.lead.phone = phone
  merged.lead.niche = merged.lead.niche || niche
  merged.commercial.reason = String(motivo ?? '').trim() || NI

  merged.aiImage = merged.aiImage || {}
  if (!merged.aiImage.sitePreviewPrompt || !String(merged.aiImage.sitePreviewPrompt).trim()) {
    merged.aiImage.sitePreviewPrompt = gerarPromptImagemEstruturaSiteHandoff(merged)
  }
  merged.aiImage.type = 'site_preview'
  merged.aiImage.prompt = merged.aiImage.sitePreviewPrompt

  if (typeof resumoHandoff === 'string' && resumoHandoff.trim()) {
    merged.meeting = merged.meeting || {}
    merged.meeting.reunionSummary = resumoHandoff.trim()
  }

  const citySlug =
    parseCidadeEstado(merged.lead.city).city !== NI
      ? slugifySegment(parseCidadeEstado(merged.lead.city).city)
      : slugifySegment(cidadeCompleta)

  const fileBase = `briefing-${slugifySegment(merged.lead.niche)}-${citySlug}-${phone}`

  return { handoff: merged, fileBase, NI }
}

function valorOuNi(v) {
  if (v == null || v === '') return NI
  if (typeof v === 'number' && !Number.isFinite(v)) return NI
  return v
}

function formatarMoeda(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return NI
  return `R$ ${Math.round(Number(n)).toLocaleString('pt-BR')}`
}

const ESTRUTURA_PAGINA_PADRAO = [
  '1. Header com nome do negócio e botão WhatsApp',
  '2. Hero com promessa principal e CTA',
  '3. Serviços principais',
  '4. Diferenciais',
  '5. Área de atendimento',
  '6. Prova social/confiança',
  '7. FAQ',
  '8. CTA final',
]

/**
 * Mensagem interna para WhatsApp/Telegram (não enviar ao lead).
 * Não gera DOCX nem imagem — apenas texto estruturado.
 */
function formatarMensagemHandoffEnriquecida(handoff, ctx = {}) {
  const { motivo } = ctx
  const l = handoff.lead || {}
  const c = handoff.commercial || {}
  const m = handoff.meeting || {}
  const b = handoff.briefing || {}
  const ai = handoff.aiImage || {}

  const leadRotulo = l.name && String(l.name).trim() ? `${l.name} (${l.phone})` : l.phone || NI
  const cidadeLinha = [l.city, l.state].filter((x) => x && x !== NI).join(' / ') || NI

  const resumoRapido =
    (typeof m.reunionSummary === 'string' && m.reunionSummary.trim()) ||
    handoff.rawDigest ||
    `Lead ${l.niche !== NI ? l.niche : 'negócio'} — ${cidadeLinha}. Motivo interno: ${motivo || c.reason || NI}.`

  const reuniaoLinha =
    m.date && m.date !== NI && m.time && m.time !== NI
      ? `${m.date} às ${m.time}`
      : m.date && m.date !== NI
        ? m.date
        : NI

  const emailProximo = l.email && l.email !== NI ? l.email : NI

  const listaVender = (m.reinforce && m.reinforce.length ? m.reinforce : PADRAO_VENDER_REUNIAO)
    .map((x) => `• ${x}`)
    .join('\n')
  const listaEvitar = (m.avoid && m.avoid.length ? m.avoid : PADRAO_EVITAR_REUNIAO)
    .map((x) => `• ${x}`)
    .join('\n')

  const promptImagem = valorOuNi(ai.sitePreviewPrompt || ai.heroPrompt)

  return (
    `🔔 HANDOFF — PJ Codeworks\n\n` +
    `Lead: ${leadRotulo}\n` +
    `Nicho: ${valorOuNi(l.niche)}\n` +
    `Cidade: ${cidadeLinha}\n` +
    `Temperatura: ${valorOuNi(l.temperature)}\n` +
    `Plano: ${valorOuNi(c.plan)}\n` +
    `Valor: ${formatarMoeda(c.totalPrice)}\n` +
    `Reunião: ${reuniaoLinha}\n\n` +
    `Resumo rápido:\n${resumoRapido}\n\n` +
    `Como falar na ligação:\n` +
    `(a) Tom recomendado: ${valorOuNi(m.recommendedTone)}\n` +
    `(b) Personalidade do lead: ${valorOuNi(m.personality)}\n` +
    `(c) Abertura sugerida: ${valorOuNi(m.suggestedOpening)}\n` +
    `(d) O que reforçar:\n${listaVender}\n` +
    `(e) O que evitar:\n${listaEvitar}\n` +
    `(f) Objetivo da reunião: ${valorOuNi(m.goal)}\n\n` +
    `Dor principal:\n${valorOuNi(b.mainPain)}\n\n` +
    `Objetivo do projeto:\n${valorOuNi(b.projectGoal)}\n\n` +
    `O que vender na reunião:\n${listaVender}\n\n` +
    `O que evitar:\n${listaEvitar}\n\n` +
    `Estrutura sugerida da página:\n${ESTRUTURA_PAGINA_PADRAO.join('\n')}\n\n` +
    `Prompt para gerar imagem:\n${promptImagem}\n\n` +
    `Próximo passo:\n` +
    `Confirmar escopo, fechar contrato e enviar DocuSign para ${emailProximo}.\n`
  )
}

module.exports = {
  NI,
  slugifySegment,
  buildProjectHandoff,
  formatarMensagemHandoffEnriquecida,
  montarPromptHeroIA,
  gerarPromptImagemEstruturaSiteHandoff,
  CHECKLIST_POS_FECHAMENTO_PADRAO,
}
