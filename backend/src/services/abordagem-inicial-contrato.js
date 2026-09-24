// @ts-check
'use strict'

const { classificarLead } = require('./site-classificacao')

const ABORDAGEM_SCHEMA_VERSION = 'abordagem_inicial_v1'
const MAX_MENSAGEM_CHARS = 600
const ANGULOS_ABORDAGEM = Object.freeze([
  'sem_site',
  'site_construtor',
  'instagram_ativo',
  'presenca_local',
  'site_a_melhorar',
  'presenca_digital',
])

function texto(valor, max = 500) {
  const out = String(valor == null ? '' : valor).trim()
  return out ? out.slice(0, max) : ''
}

function numero(valor) {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

function normalizarLeadEntrada(entrada = {}) {
  const empresa = entrada.empresa && typeof entrada.empresa === 'object' ? entrada.empresa : {}
  const perfil = entrada.perfil && typeof entrada.perfil === 'object' ? entrada.perfil : {}
  return {
    ...entrada,
    nome: texto(entrada.nome || entrada.prospect_nome || entrada.nome_lead || empresa.nome || perfil.nome, 180),
    nicho: texto(entrada.nicho || entrada.prospect_nicho || entrada.categoria || empresa.nicho || perfil.nicho, 180),
    cidade: texto(entrada.cidade || entrada.prospect_cidade || empresa.cidade || perfil.cidade, 120),
    site: texto(entrada.site || empresa.site || perfil.site || '', 1000),
    link_original: texto(entrada.link_original || entrada.link_bio || empresa.link_original || perfil.link_bio || '', 1000),
    link_bio: texto(entrada.link_bio || perfil.link_bio || '', 1000),
    place_id: texto(entrada.place_id || empresa.place_id || '', 160),
    maps_url: texto(entrada.maps_url || empresa.maps_url || '', 1000),
    instagram_handle: texto(entrada.instagram_handle || perfil.username || '', 120).replace(/^@/, ''),
    bio: texto(entrada.bio || perfil.bio || '', 1000),
    seguidores: numero(entrada.seguidores || perfil.seguidores),
    rating: entrada.rating == null ? empresa.nota : entrada.rating,
    avaliacoes: entrada.avaliacoes == null ? empresa.avaliacoes : entrada.avaliacoes,
    tem_site: typeof entrada.tem_site === 'boolean'
      ? entrada.tem_site
      : (typeof empresa.tem_site === 'boolean' ? empresa.tem_site : entrada.tem_site),
    classificacao_url: texto(entrada.classificacao_url || empresa.classificacao_url || '', 120),
    fonte: texto(entrada.fonte || entrada.origem || '', 80),
    lacunas: Array.isArray(entrada.lacunas) ? entrada.lacunas.map((x) => texto(x, 80)).filter(Boolean) : [],
    pontuacao: entrada.pontuacao || null,
  }
}

function pushUnico(lista, valor) {
  const v = texto(valor, 220)
  if (v && !lista.includes(v)) lista.push(v)
}

function descreverSite(lead, siteInfo) {
  const oportunidade = siteInfo.site_oportunidade || {}
  if (oportunidade.tipo === 'site_construtor') return 'link em construtor de site ou dominio compartilhado'
  if (oportunidade.tipo === 'perfil_ou_diretorio') return 'usa perfil/diretorio no lugar de site proprio'
  if (oportunidade.tipo === 'sem_site_confirmado') return 'sem site proprio confirmado'
  if (siteInfo.situacao_site === 'tem_site' && siteInfo.site) return 'tem site proprio informado'
  if (siteInfo.situacao_site === 'nao_identificado') return 'site ainda nao identificado'
  if (lead.tem_site === false) return 'sem site proprio visivel'
  return ''
}

function montarSinais(lead, siteInfo) {
  const sinais = []
  const nome = lead.nome || 'o negocio'
  const cidade = lead.cidade ? ` em ${lead.cidade}` : ''
  pushUnico(sinais, `${nome}${cidade}`)

  const site = descreverSite(lead, siteInfo)
  if (site) pushUnico(sinais, site)

  const rating = numero(lead.rating)
  const avaliacoes = numero(lead.avaliacoes)
  if (rating >= 4 && avaliacoes >= 20) pushUnico(sinais, `boa reputacao no Google: ${rating.toFixed(1)} com ${avaliacoes} avaliacoes`)
  else if (rating >= 4) pushUnico(sinais, `boa nota no Google: ${rating.toFixed(1)}`)
  else if (avaliacoes >= 20) pushUnico(sinais, `${avaliacoes} avaliacoes no Google`)

  if (lead.instagram_handle) pushUnico(sinais, `Instagram @${lead.instagram_handle}`)
  if (lead.seguidores >= 100) pushUnico(sinais, `${lead.seguidores} seguidores no Instagram`)
  if (lead.bio) pushUnico(sinais, 'bio do Instagram preenchida')
  if (lead.lacunas.includes('site')) pushUnico(sinais, 'lacuna de site no cadastro')
  if (lead.lacunas.includes('email')) pushUnico(sinais, 'lacuna de e-mail no cadastro')
  if (lead.lacunas.includes('horario')) pushUnico(sinais, 'horario de funcionamento incompleto')
  if (lead.lacunas.includes('fotos')) pushUnico(sinais, 'perfil com poucas fotos')
  return sinais.slice(0, 6)
}

function escolherAngulo(lead, siteInfo) {
  const oportunidade = siteInfo.site_oportunidade || {}
  if (oportunidade.tipo === 'site_construtor') return 'site_construtor'
  if (siteInfo.situacao_site === 'sem_site' || lead.tem_site === false) return 'sem_site'
  if (lead.instagram_handle || lead.seguidores > 0 || lead.fonte === 'instagram') return 'instagram_ativo'
  if (numero(lead.rating) >= 4 || numero(lead.avaliacoes) >= 20) return 'presenca_local'
  if (siteInfo.situacao_site === 'tem_site') return 'site_a_melhorar'
  return 'presenca_digital'
}

function perguntaPorAngulo(angulo) {
  if (angulo === 'site_construtor') return 'Hoje esse site ja te traz clientes pelo WhatsApp ou voce sente que poderia converter mais?'
  if (angulo === 'sem_site') return 'Hoje voce gostaria de transformar essa presenca em mais pedidos pelo WhatsApp?'
  if (angulo === 'instagram_ativo') return 'Hoje o Instagram ja vira clientes com previsibilidade ou voce queria melhorar isso?'
  if (angulo === 'presenca_local') return 'Hoje quem te encontra no Google consegue virar contato pelo WhatsApp com facilidade?'
  if (angulo === 'site_a_melhorar') return 'Hoje o site ja traz bastante cliente ou voce gostaria de melhorar essa conversao?'
  return 'Posso te mostrar uma analise rapida para melhorar essa presenca?'
}

function fraseOportunidade(angulo) {
  if (angulo === 'site_construtor') return 'Vi que voce ja parece ter interesse em site, mas talvez ainda esteja em uma estrutura de construtor.'
  if (angulo === 'sem_site') return 'Vi que sua presenca aparece mais por perfil do que por um site proprio.'
  if (angulo === 'instagram_ativo') return 'Vi sinais de atencao com Instagram e presenca digital.'
  if (angulo === 'presenca_local') return 'Vi que ja existe uma presenca local interessante no Google.'
  if (angulo === 'site_a_melhorar') return 'Vi que voce ja tem site, entao pensei mais em conversao do que em comecar do zero.'
  return 'Vi alguns pontos de presenca digital que podem virar mais contatos.'
}

function montarEstrategiaAbordagem(entrada = {}, opts = {}) {
  const lead = normalizarLeadEntrada(entrada)
  const siteInfo = classificarLead(lead)
  const angulo = escolherAngulo(lead, siteInfo)
  const sinais = montarSinais(lead, siteInfo)
  return {
    schema_version: ABORDAGEM_SCHEMA_VERSION,
    nome_lead: lead.nome || opts.nomeLead || 'seu negocio',
    nome_empresa: opts.nomeEmpresa || 'nossa empresa',
    angulo,
    sinais,
    site: {
      situacao: siteInfo.situacao_site,
      classificacao_url: siteInfo.classificacao,
      oportunidade: siteInfo.site_oportunidade?.tipo || null,
      verificacao: siteInfo.site_oportunidade?.verificacao || null,
      link_original: siteInfo.link_original || null,
    },
    pergunta_final: perguntaPorAngulo(angulo),
    diretriz_spin: 'Use uma abertura curta com situacao real, uma implicacao leve e uma pergunta de necessidade/ganho; nao pergunte budget ou autoridade nesta primeira mensagem.',
  }
}

function avisoSiteProntoPresente(mensagem) {
  const m = String(mensagem || '').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return /\b(site|previa|estrutura|analise)\b/.test(m) && /\b(pront|preparad|separad|montad|deixei)\w*/.test(m)
}

function renderMensagemAbordagemFallback(entrada = {}, opts = {}) {
  const estrategia = opts.estrategia || montarEstrategiaAbordagem(entrada, opts)
  const nomeEmp = estrategia.nome_empresa || opts.nomeEmpresa || 'nossa empresa'
  const nome = estrategia.nome_lead || 'seu negocio'
  const nicho = texto(entrada.nicho || entrada.prospect_nicho || entrada.categoria || '', 120)
  const cidade = texto(entrada.cidade || entrada.prospect_cidade || '', 120)
  const sinal = estrategia.sinais.find((s) => !s.toLowerCase().includes((nome || '').toLowerCase())) || estrategia.sinais[0] || 'sua presenca digital'
  const oportunidade = fraseOportunidade(estrategia.angulo)
  const alvoPartes = [nome]
  if (cidade) alvoPartes.push(`em ${cidade}`)
  if (nicho) alvoPartes.push(`no segmento de ${nicho}`)
  const alvo = alvoPartes.join(', ')
  const msg = `Oi, tudo bem? Sou da ${nomeEmp}. Ja deixei uma previa de site pronta aqui no atendimento para ${alvo}. ${oportunidade} Notei ${sinal}. ${estrategia.pergunta_final}`
  return msg.replace(/\s+/g, ' ').trim().slice(0, MAX_MENSAGEM_CHARS)
}

function parseJsonPossivel(textoBruto) {
  const bruto = String(textoBruto || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  if (!bruto) return null
  try { return JSON.parse(bruto) } catch {}
  const ini = bruto.indexOf('{')
  const fim = bruto.lastIndexOf('}')
  if (ini >= 0 && fim > ini) {
    try { return JSON.parse(bruto.slice(ini, fim + 1)) } catch {}
  }
  return null
}

function normalizarContratoAbordagem(textoBruto, estrategia = {}) {
  const obj = typeof textoBruto === 'object' && textoBruto !== null ? textoBruto : parseJsonPossivel(textoBruto)
  if (!obj || typeof obj !== 'object') return null
  if (obj.schema_version !== ABORDAGEM_SCHEMA_VERSION) return null
  const mensagem = texto(obj.mensagem, MAX_MENSAGEM_CHARS + 1).replace(/\s+/g, ' ').trim()
  if (!mensagem || mensagem.length < 30 || mensagem.length > MAX_MENSAGEM_CHARS) return null
  if (!avisoSiteProntoPresente(mensagem)) return null
  const angulo = ANGULOS_ABORDAGEM.includes(obj.angulo) ? obj.angulo : (estrategia.angulo || 'presenca_digital')
  const sinaisUsados = Array.isArray(obj.sinais_usados)
    ? obj.sinais_usados.map((s) => texto(s, 160)).filter(Boolean).slice(0, 6)
    : []
  return {
    schema_version: ABORDAGEM_SCHEMA_VERSION,
    mensagem,
    angulo,
    sinais_usados: sinaisUsados,
    pergunta_final: texto(obj.pergunta_final || estrategia.pergunta_final, 240),
    confianca: Math.max(0, Math.min(1, Number(obj.confianca) || 0)),
    aviso_site_pronto: true,
  }
}

function montarPromptContratoAbordagem({ estrategia, dadosLead = {}, conhecimento = '', instrucoes = '', nomeEmpresa = '' }) {
  const schema = {
    schema_version: ABORDAGEM_SCHEMA_VERSION,
    mensagem: 'texto final da primeira mensagem de WhatsApp, maximo 500 caracteres',
    angulo: ANGULOS_ABORDAGEM.join('|'),
    sinais_usados: ['sinais reais usados na mensagem'],
    pergunta_final: 'ultima pergunta da mensagem',
    confianca: 0.0,
  }
  const regras = [
    'Voce escreve a PRIMEIRA abordagem de WhatsApp em portugues do Brasil.',
    'Retorne APENAS JSON valido, sem markdown, sem texto fora do JSON.',
    'A mensagem deve abrir avisando que ja existe uma previa/estrutura de site pronta aqui no atendimento.',
    'Use no maximo 1 ou 2 sinais reais do lead; nao invente faturamento, campanhas, resultados, desconto ou urgencia falsa.',
    'Use raciocinio SPIN: situacao real -> problema/oportunidade -> ganho esperado -> uma pergunta final.',
    'Nao use BANT nesta primeira mensagem: nao pergunte budget, decisor ou prazo agora.',
    'Detecte o idioma/variante pelos dados do lead (pais, endereco, cidade, telefone, perfil e textos coletados). Se o lead indicar Estados Unidos, escreva em ingles; se indicar Portugal, use portugues de Portugal; se nao houver sinal claro, use portugues do Brasil.',
    `Quando mencionar quem envia, use "${nomeEmpresa || estrategia.nome_empresa || 'nossa empresa'}".`,
    'Nao peca reuniao nesta mensagem; peca permissao ou faca uma pergunta de interesse.',
    'Maximo 500 caracteres na mensagem.',
  ]
  return {
    systemPrompt: [
      'Voce e a camada de inteligencia artificial de uma prospeccao comercial.',
      'Sua unica saida e um contrato JSON que o aplicativo vai validar antes de enviar.',
      `Schema obrigatorio: ${JSON.stringify(schema)}`,
    ].join('\n'),
    userPrompt: [
      `REGRAS\n${regras.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      conhecimento ? `CONHECIMENTO DA EMPRESA\n${conhecimento}` : '',
      instrucoes ? `INSTRUCOES EXTRAS DA EMPRESA\n${instrucoes}` : '',
      `ESTRATEGIA CALCULADA PELO APP\n${JSON.stringify(estrategia, null, 2)}`,
      `DADOS DO LEAD\n${JSON.stringify(dadosLead, null, 2)}`,
      'JSON DE SAIDA',
    ].filter(Boolean).join('\n\n'),
  }
}

module.exports = {
  ABORDAGEM_SCHEMA_VERSION,
  ANGULOS_ABORDAGEM,
  MAX_MENSAGEM_CHARS,
  montarEstrategiaAbordagem,
  montarPromptContratoAbordagem,
  normalizarContratoAbordagem,
  renderMensagemAbordagemFallback,
  avisoSiteProntoPresente,
}
