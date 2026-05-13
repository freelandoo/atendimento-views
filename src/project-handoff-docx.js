'use strict'

const fs = require('fs').promises
const path = require('path')
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} = require('docx')

const NI = 'não informado'

function tx(text, bold = false) {
  const t = text == null || text === '' ? NI : String(text)
  return new Paragraph({
    children: [new TextRun({ text: t, bold })],
  })
}

function heading1(text) {
  return new Paragraph({
    text: String(text || ''),
    heading: HeadingLevel.HEADING_1,
  })
}

function heading2(text) {
  return new Paragraph({
    text: String(text || ''),
    heading: HeadingLevel.HEADING_2,
  })
}

function bullets(items) {
  const list = Array.isArray(items) ? items.filter(Boolean).map((x) => String(x).trim()) : []
  if (!list.length) return [tx(NI)]
  return list.map((line) =>
    new Paragraph({
      children: [new TextRun({ text: `• ${line}` })],
    })
  )
}

function kv(label, val) {
  const v = val == null || val === '' ? NI : String(val)
  return tx(`${label}: ${v}`)
}

function linksBlock(importantLinks) {
  const o = importantLinks && typeof importantLinks === 'object' ? importantLinks : {}
  const linhas = [
    ['Instagram', o.instagram],
    ['WhatsApp', o.whatsapp],
    ['Google Meu Negócio', o.googleBusiness],
    ['Site atual', o.website],
  ].filter(([, v]) => v && String(v).trim())
  if (!linhas.length) return [tx(NI)]
  return linhas.map(([k, v]) => tx(`${k}: ${v}`))
}

/**
 * Gera o arquivo .docx do briefing no caminho indicado.
 * @param {import('./project-handoff-types').ProjectHandoff} handoff
 */
async function gerarBriefingDocx(handoff, outPathAbs) {
  const l = handoff.lead || {}
  const c = handoff.commercial || {}
  const m = handoff.meeting || {}
  const b = handoff.briefing || {}
  const seo = handoff.seoLocal || {}
  const ai = handoff.aiImage || {}
  const ic = handoff.initialContent || {}
  const ss = handoff.siteStructure || {}

  const subtituloParts = [
    l.name && String(l.name).trim() ? l.name : l.phone || NI,
    l.niche || NI,
    [l.city, l.state].filter(Boolean).join(' / ') || NI,
  ]

  const kids = [
    new Paragraph({
      text: 'Briefing de Projeto — PJ Codeworks',
      heading: HeadingLevel.TITLE,
    }),
    tx(`Lead: ${subtituloParts.join(' — ')}`, true),
    tx(''),

    heading1('1. Resumo comercial do lead'),
    tx(typeof m.reunionSummary === 'string' && m.reunionSummary.trim() ? m.reunionSummary.trim() : handoff.rawDigest || NI),
    kv('Temperatura', l.temperature),
    kv('Valor total sugerido', c.totalPrice != null ? `R$ ${Math.round(Number(c.totalPrice)).toLocaleString('pt-BR')}` : NI),
    kv('Motivo do handoff', c.reason),
    tx(''),

    heading1('2. Dados do cliente'),
    kv('Nome', l.name),
    kv('Telefone', l.phone),
    kv('E-mail', l.email),
    kv('Cidade', l.city),
    kv('Estado', l.state),
    kv('Nicho', l.niche),
    kv('Tipo de negócio', l.businessType),
    kv('Temperatura', l.temperature),
    kv('Score de dor', l.painScore != null ? String(l.painScore) : NI),
    kv('Complexidade', l.complexity),
    tx(''),

    heading1('3. Diagnóstico do negócio'),
    kv('Presença no Google (diagnóstico)', b.googlePresenceNote),
    kv('Dor principal', b.mainPain),
    bullets(Array.isArray(b.competitors) ? b.competitors.map((x) => String(x)) : []),
    tx(''),

    heading1('4. Objetivo do projeto'),
    tx(b.projectGoal),
    kv('Público-alvo', b.targetAudience),
    kv('Promessa principal do site', b.sitePromise),
    tx(''),

    heading1('5. Plano contratado ou sugerido'),
    kv('Plano', c.plan),
    kv('Valor total', c.totalPrice != null ? `R$ ${Math.round(Number(c.totalPrice)).toLocaleString('pt-BR')}` : NI),
    kv('Entrada', c.entryPrice != null ? `R$ ${Math.round(Number(c.entryPrice)).toLocaleString('pt-BR')}` : NI),
    kv(
      'Parcelas',
      c.installments?.quantity && c.installments?.value
        ? `${c.installments.quantity}x R$ ${Math.round(Number(c.installments.value)).toLocaleString('pt-BR')}`
        : NI
    ),
    kv('Mensalidade', c.monthlyFee != null ? `R$ ${Math.round(Number(c.monthlyFee)).toLocaleString('pt-BR')}` : NI),
    kv('Início da mensalidade', c.monthlyStartsAfter),
    kv('ROI (índice motor)', c.roi != null ? `${c.roi}%` : NI),
    heading2('Benefícios / pontos usados na conversa'),
    bullets(c.sellingPoints),
    heading2('Objeções percebidas'),
    bullets(c.objections),
    tx(''),

    heading1('6. Escopo inicial do site'),
    bullets(b.mainServices),
    kv('Região de atendimento', b.serviceRegion),
    heading2('Diferenciais percebidos'),
    bullets(b.differentiators),
    heading2('Seções recomendadas'),
    bullets(b.recommendedSections),
    tx(''),

    heading1('7. Estrutura recomendada da página'),
    ...Object.entries(ss).flatMap(([k, v]) => [
      tx(`${k}: ${v == null || v === '' ? NI : String(v)}`),
    ]),
    tx(''),

    heading1('8. Conteúdo inicial sugerido'),
    kv('Headline', ic.headline),
    kv('Subtítulo', ic.subtitle),
    tx(typeof ic.apresentacao === 'string' ? ic.apresentacao : NI),
    heading2('Lista de serviços'),
    bullets(ic.servicos),
    heading2('CTAs'),
    bullets(ic.ctas),
    heading2('FAQ inicial'),
    ...(Array.isArray(ic.faq) && ic.faq.length
      ? ic.faq.flatMap((item) => [
          tx(typeof item?.pergunta === 'string' ? `P: ${item.pergunta}` : NI, true),
          tx(typeof item?.resposta === 'string' ? `R: ${item.resposta}` : NI),
        ])
      : [tx(NI)]),
    tx(''),

    heading1('9. SEO local'),
    kv('Palavra-chave principal', seo.mainKeyword),
    heading2('Palavras-chave secundárias'),
    bullets(seo.secondaryKeywords),
    kv('Cidade principal', seo.city),
    heading2('Bairros / regiões'),
    bullets(seo.regions),
    kv('Título sugerido', seo.suggestedTitle),
    kv('Meta description sugerida', seo.suggestedMetaDescription),
    tx(''),

    heading1('10. Integrações necessárias'),
    bullets(b.integrations),
    heading2('Links importantes'),
    ...linksBlock(b.importantLinks),
    heading2('CTAs necessários'),
    bullets(b.requiredCtas),
    tx(''),

    heading1('11. Prompt para geração de imagem via IA'),
    kv('Tipo (handoff interno)', ai.type || 'site_preview'),
    kv('Estilo visual', ai.style),
    kv('Proporção recomendada', ai.aspectRatio),
    tx(typeof ai.brandingNotes === 'string' ? ai.brandingNotes : NI),
    heading2('Prévia visual da estrutura do site (landing pronta — não wireframe)'),
    tx(ai.sitePreviewPrompt || ai.heroPrompt),
    heading2('Hero (referência legada / opcional)'),
    tx(ai.heroPrompt),
    heading2('Imagem de apoio'),
    tx(ai.supportPrompt),
    tx(''),

    heading1('12. Orientações para reunião'),
    kv('Data', m.date),
    kv('Horário', m.time),
    kv('Duração estimada (min)', m.durationMinutes != null ? String(m.durationMinutes) : NI),
    kv('Objetivo da reunião', m.goal),
    kv('Abertura sugerida', m.suggestedOpening),
    kv('Tom recomendado', m.recommendedTone),
    heading2('Reforçar'),
    bullets(m.reinforce),
    heading2('Evitar'),
    bullets(m.avoid),
    tx(''),

    heading1('13. Próximos passos'),
    bullets(m.nextSteps),
    heading2('Checklist após fechamento'),
    bullets(m.checklistPosFechamento),
    tx(''),
    tx(
      'PJ Codeworks — soluções em código, tecnologia, sites, sistemas, automações e agentes de IA. SEO/local faz parte da estrutura do site quando combinado no escopo.',
      true
    ),
  ]

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: kids,
      },
    ],
  })

  const buf = await Packer.toBuffer(doc)
  await fs.mkdir(path.dirname(outPathAbs), { recursive: true })
  await fs.writeFile(outPathAbs, buf)
  return outPathAbs
}

module.exports = {
  gerarBriefingDocx,
}
