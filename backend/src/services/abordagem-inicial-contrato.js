// @ts-check
'use strict'

const { classificarLead } = require('./site-classificacao')

const ABORDAGEM_SCHEMA_VERSION = 'abordagem_inicial_v1'
const MAX_MENSAGEM_CHARS = 600
const OBJETIVO_RESPOSTA_ABORDAGEM = 'capturar_interesse'
const ABORDAGEM_IA_CONFIG_INICIO = '[ABORDAGEM_IA_CONFIG]'
const ABORDAGEM_IA_CONFIG_FIM = '[/ABORDAGEM_IA_CONFIG]'
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

function normalizarBusca(valor) {
  return texto(valor, 180)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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

function extrairJsonConfigAbordagem(instrucoes = '') {
  const bruto = String(instrucoes || '')
  const ini = bruto.indexOf(ABORDAGEM_IA_CONFIG_INICIO)
  const fim = bruto.indexOf(ABORDAGEM_IA_CONFIG_FIM)
  if (ini < 0 || fim <= ini) return null
  const json = bruto.slice(ini + ABORDAGEM_IA_CONFIG_INICIO.length, fim).trim()
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function sanitizarOfertaAbordagem(oferta = {}) {
  const sitePronto = oferta.sitePronto !== undefined ? oferta.sitePronto : oferta.site_pronto
  return {
    id: texto(oferta.id, 80),
    nome: texto(oferta.nome || oferta.oferta, 180),
    descricao: texto(oferta.descricao, 700),
    nicho: texto(oferta.nicho, 180),
    ativo: oferta.ativo !== false,
    geral: oferta.geral === true,
    site_pronto: sitePronto !== false,
  }
}

// Motivos da selecao — vocabulario FECHADO. A tela so TRADUZ; ninguem compara com literal fora daqui.
const MOTIVO_OFERTA = Object.freeze({
  ESPECIFICA: 'oferta_especifica_do_nicho',
  GERAL: 'oferta_geral',
  SEM_CONFIG: 'sem_configuracao_de_abordagem',
  SEM_ATIVA: 'nenhuma_oferta_ativa',
  // O caso que o defeito de 2026-10-22 produzia em silencio: ha oferta ativa, mas nenhuma
  // corresponde ao nicho do lead e nao existe oferta geral. Nao se escolhe oferta de outro nicho.
  SEM_CORRESPONDENCIA: 'sem_oferta_para_o_nicho',
})

// Os campos do LEAD que descrevem o NICHO. `fonte`/`origem` ficam FORA de proposito: aquilo e'
// a procedencia da coleta (places | instagram | meta_ads), nao o ramo do negocio — compara-la
// com o nicho da oferta faz uma oferta chamada "instagram" capturar todo lead vindo do Instagram.
function nichosDoLead(lead) {
  return [lead.nicho, lead.prospect_nicho, lead.categoria, lead.categoria_perfil]
    .map(normalizarBusca)
    .filter(Boolean)
}

/**
 * Forca da correspondencia entre o nicho da OFERTA e o do LEAD. 2 = igual, 1 = o nicho do lead
 * CONTEM o da oferta como frase inteira ("energia solar" casa "energia solar fotovoltaica"),
 * 0 = nao casa.
 *
 * A direcao importa e so uma delas e' valida: a oferta pode ser mais GENERICA que o lead, nunca
 * mais ESPECIFICA. O codigo anterior testava os dois sentidos (`alvo.includes(campo)`), entao uma
 * oferta de "energia solar residencial" capturava o lead "solar" — o oposto do que o operador
 * configurou. A comparacao e' por FRASE INTEIRA (limite de palavra): sem isso "sol" casaria
 * "solar" e "odonto" casaria "odontologia" por acidente de substring.
 */
function grauCorrespondenciaNicho(oferta, lead) {
  if (!oferta || oferta.geral || !oferta.nicho) return 0
  const alvo = normalizarBusca(oferta.nicho)
  if (!alvo) return 0
  let grau = 0
  for (const campo of nichosDoLead(lead)) {
    if (campo === alvo) return 2
    if (campo === `${alvo}` || campo.startsWith(`${alvo} `) || campo.endsWith(` ${alvo}`) || campo.includes(` ${alvo} `)) {
      grau = Math.max(grau, 1)
    }
  }
  return grau
}

function ofertaCombinaComLead(oferta, lead) {
  return grauCorrespondenciaNicho(oferta, lead) > 0
}

/**
 * Desempate DETERMINISTICO entre ofertas especificas que casam com o mesmo lead:
 * 1) maior forca de correspondencia (igual vence contem);
 * 2) nicho mais ESPECIFICO (texto mais longo) — "energia solar fotovoltaica" vence "energia solar";
 * 3) nome em ordem alfabetica, para a escolha nao depender da ordem do array.
 * Sem isso, mexer na lista na tela trocava a oferta usada sem ninguem decidir nada.
 */
function compararEspecificas(a, b, lead) {
  const ga = grauCorrespondenciaNicho(a, lead)
  const gb = grauCorrespondenciaNicho(b, lead)
  if (ga !== gb) return gb - ga
  const na = normalizarBusca(a.nicho).length
  const nb = normalizarBusca(b.nicho).length
  if (na !== nb) return nb - na
  return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
}

function selecionarOfertaAbordagem(instrucoes = '', dadosLead = {}) {
  const config = extrairJsonConfigAbordagem(instrucoes)
  if (!config) {
    return {
      instrucoes: texto(instrucoes, 4000),
      oferta: null,
      config: null,
      motivo: MOTIVO_OFERTA.SEM_CONFIG,
      nicho_lead: texto(normalizarLeadEntrada(dadosLead).nicho, 180),
    }
  }
  const lead = normalizarLeadEntrada(dadosLead)
  const ofertas = Array.isArray(config.ofertas)
    ? config.ofertas.map(sanitizarOfertaAbordagem).filter((o) => o.nome || o.descricao)
    : []
  const ativas = ofertas.filter((o) => o.ativo)
  const especificas = ativas
    .filter((o) => !o.geral && ofertaCombinaComLead(o, lead))
    .sort((a, b) => compararEspecificas(a, b, lead))
  const especifica = especificas[0] || null
  const geral = ativas.find((o) => o.geral) || null
  // PRECEDENCIA: especifica do nicho > geral > NENHUMA.
  // ⚠️ NAO existe quarto degrau. Ate 2026-10-22 havia `|| ativas[0]`, que entregava ao lead a
  // PRIMEIRA oferta ativa da lista — a oferta de OUTRO nicho — quando nao havia nem especifica
  // nem geral. O lead de energia solar recebia a oferta de padaria e a IA conduzia a conversa
  // inteira em cima dela. Sem oferta correspondente, a abordagem e' CONSULTIVA (sem carro-chefe).
  const oferta = especifica || geral || null
  const motivo = especifica
    ? MOTIVO_OFERTA.ESPECIFICA
    : (geral ? MOTIVO_OFERTA.GERAL : (ativas.length ? MOTIVO_OFERTA.SEM_CORRESPONDENCIA : MOTIVO_OFERTA.SEM_ATIVA))
  const complemento = texto(config.complemento, 900)
  const identificacao = texto(config.identificacao || config.identificacaoRemetente, 220)
  const idiomaAutomatico = config.idiomaAutomatico !== false
  const linhas = []
  if (identificacao) {
    linhas.push('IDENTIFICACAO DO REMETENTE')
    linhas.push(identificacao)
  }
  if (oferta) {
    linhas.push('OFERTA SELECIONADA PELO APLICATIVO')
    linhas.push(`Nome: ${oferta.nome}`)
    if (oferta.descricao) linhas.push(`Descricao: ${oferta.descricao}`)
    const resultado = resumirResultadoOferta(oferta)
    if (resultado) linhas.push(`Resultado esperado: ${resultado}`)
    linhas.push(`Escopo: ${oferta.geral ? 'geral' : `nicho ${oferta.nicho || '(sem nicho)'}`}`)
    linhas.push(oferta.site_pronto
      ? 'Gancho: pode avisar que a oferta/estrutura selecionada ja esta pronta ou disponivel; nao trocar por site se a oferta nao for site.'
      : 'Gancho: nao dizer que ja existe oferta, site, previa ou estrutura pronta; abordar com diagnostico/analise.')
  } else {
    linhas.push('OFERTA SELECIONADA PELO APLICATIVO')
    linhas.push(motivo === MOTIVO_OFERTA.SEM_CORRESPONDENCIA
      ? 'Nenhuma oferta corresponde ao nicho deste lead e nao ha oferta geral ativa. '
        + 'PROIBIDO usar a oferta configurada para outro nicho: aborde de forma consultiva, sem carro-chefe.'
      : 'Nenhuma oferta principal foi configurada; a IA nao deve assumir qual e o carro-chefe.')
  }
  linhas.push(idiomaAutomatico
    ? 'Idioma: adaptar ao pais/idioma do lead quando houver sinal nos dados.'
    : 'Idioma: manter portugues do Brasil, salvo instrucao manual complementar.')
  if (complemento) {
    linhas.push('INSTRUCOES COMPLEMENTARES')
    linhas.push(complemento)
  }
  return {
    instrucoes: linhas.join('\n'),
    oferta,
    identificacao,
    motivo,
    nicho_lead: texto(lead.nicho, 180),
    config: {
      idiomaAutomatico,
      identificacao,
      complemento,
      ofertas,
    },
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

function resumirResultadoOferta(oferta = {}) {
  const base = texto([oferta.nome, oferta.descricao].filter(Boolean).join(' '), 900)
  const n = normalizarBusca(base)
  if (!n) return ''
  const partes = []
  if (/\bcrm\b|controle de lead|leads?|funil|propost|orcament|whatsapp|follow/.test(n)) {
    partes.push('controlar leads, acompanhar o funil e organizar propostas/retornos')
  }
  if (/site|pagina|landing|presenca|google|captar|captacao/.test(n)) {
    partes.push('captar contatos qualificados e transformar visitas em conversas')
  }
  if (/agenda|reuniao|marcar|atendimento/.test(n)) {
    partes.push('facilitar agendamentos e reduzir perda de oportunidades')
  }
  if (partes.length) return partes.join('; ')
  return texto(oferta.descricao || oferta.nome, 220)
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
  return /\b(site|previa|estrutura|analise|oferta|solucao|sistema|crm|carro chefe)\b/.test(m) && /\b(pront|preparad|separad|montad|disponivel|deixei)\w*/.test(m)
}

function terminaComPergunta(mensagem) {
  return /[?？]\s*$/.test(String(mensagem || '').trim())
}

function renderMensagemAbordagemFallback(entrada = {}, opts = {}) {
  const estrategia = opts.estrategia || montarEstrategiaAbordagem(entrada, opts)
  const nome = estrategia.nome_lead || 'seu negocio'
  const nicho = texto(entrada.nicho || entrada.prospect_nicho || entrada.categoria || '', 120)
  const cidade = texto(entrada.cidade || entrada.prospect_cidade || '', 120)
  const sinal = estrategia.sinais.find((s) => !s.toLowerCase().includes((nome || '').toLowerCase())) || estrategia.sinais[0] || 'sua presenca digital'
  const oportunidade = fraseOportunidade(estrategia.angulo)
  const alvoPartes = [nome]
  if (cidade) alvoPartes.push(`em ${cidade}`)
  if (nicho) alvoPartes.push(`no segmento de ${nicho}`)
  const alvo = alvoPartes.join(', ')
  const resultado = resumirResultadoOferta(opts.ofertaAbordagem || {})
  const fraseResultado = resultado
    ? `A ideia e ${resultado}.`
    : `${oportunidade} Notei ${sinal}.`
  // ⚠️ "Estrutura pronta" so sai quando ALGUEM DECLAROU que ela existe (`avisoSitePronto === true`,
  // que vem de `oferta.site_pronto` da oferta SELECIONADA). Ate 2026-10-22 o default era o
  // contrario (`!== false`): quem chamava sem opcao nenhuma — `montarMensagemFallback`, o caminho
  // da fila diaria — afirmava ao lead que havia material pronto sem nada configurado. Afirmar
  // material pronto que nao existe e' inventar fato, que e' justamente o que a regra proibe.
  const msg = opts.avisoSitePronto === true
    ? `Oi, tudo bem? Tenho essa estrutura pronta aqui para ${alvo}. ${fraseResultado} ${estrategia.pergunta_final}`
    : `Oi, tudo bem? Vi ${alvo}. ${fraseResultado} ${estrategia.pergunta_final}`
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

function normalizarContratoAbordagem(textoBruto, estrategia = {}, opts = {}) {
  const obj = typeof textoBruto === 'object' && textoBruto !== null ? textoBruto : parseJsonPossivel(textoBruto)
  if (!obj || typeof obj !== 'object') return null
  if (obj.schema_version !== ABORDAGEM_SCHEMA_VERSION) return null
  const mensagem = texto(obj.mensagem, MAX_MENSAGEM_CHARS + 1).replace(/\s+/g, ' ').trim()
  if (!mensagem || mensagem.length < 30 || mensagem.length > MAX_MENSAGEM_CHARS) return null
  if (!terminaComPergunta(mensagem)) return null
  const temAvisoSitePronto = avisoSiteProntoPresente(mensagem)
  const exigeSitePronto = opts.avisoSitePronto !== false
  if (exigeSitePronto && !temAvisoSitePronto) return null
  if (!exigeSitePronto && temAvisoSitePronto) return null
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
    aviso_site_pronto: temAvisoSitePronto,
    objetivo_resposta: OBJETIVO_RESPOSTA_ABORDAGEM,
    respostas_esperadas: {
      interesse: 'lead autoriza continuar ou demonstra curiosidade/interesse',
      desinteresse: 'lead diz que nao quer, nao tem interesse ou pede para parar',
    },
  }
}

function montarPromptContratoAbordagem({ estrategia, dadosLead = {}, conhecimento = '', instrucoes = '', nomeEmpresa = '', historicoComercial = '', orientacaoEtapa = '' }) {
  const abordagem = selecionarOfertaAbordagem(instrucoes, dadosLead)
  // A etapa do playbook entra como CONDUCAO, nunca como fonte de oferta: ela foi escrita para a
  // empresa inteira e, se a oferta do nicho vencer, e' ela que vale (precedencia 3 > 5).
  const etapa = texto(orientacaoEtapa, 2500)
  const avisoSitePronto = abordagem.oferta ? abordagem.oferta.site_pronto !== false : false
  const identificacao = texto(abordagem.identificacao, 220)
  const resultadoOferta = resumirResultadoOferta(abordagem.oferta || {})
  const schema = {
    schema_version: ABORDAGEM_SCHEMA_VERSION,
    mensagem: 'texto final da primeira mensagem de WhatsApp, maximo 500 caracteres',
    angulo: ANGULOS_ABORDAGEM.join('|'),
    sinais_usados: ['sinais reais usados na mensagem'],
    pergunta_final: 'ultima pergunta da mensagem',
    confianca: 0.0,
    aviso_site_pronto: avisoSitePronto,
    objetivo_resposta: OBJETIVO_RESPOSTA_ABORDAGEM,
  }
  const regras = [
    'Voce escreve a PRIMEIRA abordagem de WhatsApp em portugues do Brasil.',
    'Retorne APENAS JSON valido, sem markdown, sem texto fora do JSON.',
    abordagem.oferta
      ? `Oferta/carro-chefe selecionado pelo aplicativo: ${abordagem.oferta.nome || abordagem.oferta.descricao}. Use somente essa oferta; se ela for especifica de nicho, nao misture a oferta geral.`
      : 'Nenhuma oferta principal foi configurada. Nao assuma o carro-chefe, nao diga que sabe a oferta e gere no maximo uma abordagem consultiva baseada nos sinais do lead.',
    avisoSitePronto
      ? 'A mensagem pode avisar que a oferta/estrutura selecionada ja esta pronta ou disponivel. Nao diga "site pronto" se a oferta nao for site.'
      : 'Nao diga que existe oferta, site, previa, estrutura, analise ou material pronto/preparado/montado/disponivel; aborde com diagnostico, observacao ou pergunta consultiva.',
    'Use no maximo 1 ou 2 sinais reais do lead; nao invente faturamento, campanhas, resultados, desconto ou urgencia falsa.',
    'Use raciocinio SPIN: situacao real -> problema/oportunidade -> ganho esperado -> uma pergunta final.',
    resultadoOferta
      ? `Ao falar da oferta, foque no resultado operacional: ${resultadoOferta}. Nao reduza tudo a "presenca digital" se a oferta envolver CRM, funil, leads, propostas ou WhatsApp.`
      : 'Ao falar da oferta, traduza a descricao em resultado pratico para o negocio; nao reduza tudo a "presenca digital" quando houver CRM, funil, leads, propostas ou WhatsApp.',
    // A estrategia (angulo, sinais, pergunta_final) e' calculada pela PRESENCA DIGITAL do lead —
    // ela nao conhece a oferta. Com uma oferta de CRM/operacao, a pergunta sugerida ("transformar
    // essa presenca em mais pedidos") sai do assunto. Ela continua servindo de base de TOM.
    abordagem.oferta
      ? 'A "pergunta_final" da ESTRATEGIA foi calculada pela presenca digital do lead e e apenas uma SUGESTAO de tom: adapte-a ao resultado da oferta selecionada. Se a oferta nao for site/presenca, nao termine perguntando sobre site ou presenca digital.'
      : 'Use a "pergunta_final" da ESTRATEGIA como base: sem oferta configurada, a conversa e consultiva sobre os sinais reais do lead.',
    'Nao use BANT nesta primeira mensagem: nao pergunte budget, decisor ou prazo agora.',
    'Detecte o idioma/variante pelos dados do lead (pais, endereco, cidade, telefone, perfil e textos coletados). Se o lead indicar Estados Unidos, escreva em ingles; se indicar Portugal, use portugues de Portugal; se nao houver sinal claro, use portugues do Brasil.',
    identificacao
      ? `Identificacao opcional configurada pelo operador: "${identificacao}". Interprete como orientacao de tom/remetente; nao encaixe mecanicamente no comeco se o perfil do WhatsApp ja identifica o contato.`
      : 'Nao comece se identificando por padrao; o perfil do contato ja deve carregar a identidade. Va direto ao contexto do lead e a pergunta de interesse.',
    'Nao peca reuniao nesta mensagem; peca permissao ou faca uma pergunta de interesse.',
    'A mensagem final deve terminar com uma pergunta direta de permissao/interesse. Ex.: "Posso te mandar?" ou "Faz sentido eu te mostrar?".',
    'Maximo 500 caracteres na mensagem.',
  ]
  return {
    motivo_oferta: abordagem.motivo,
    nicho_lead: abordagem.nicho_lead || '',
    systemPrompt: [
      'Voce e a camada de inteligencia artificial de uma prospeccao comercial.',
      'Sua unica saida e um contrato JSON que o aplicativo vai validar antes de enviar.',
      `Schema obrigatorio: ${JSON.stringify(schema)}`,
    ].join('\n'),
    userPrompt: [
      `REGRAS\n${regras.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
      conhecimento ? `CONHECIMENTO DA EMPRESA\n${conhecimento}` : '',
      etapa ? `ORIENTACAO DA ETAPA "PRIMEIRO CONTATO" (playbook da empresa — conduz o TOM e a CONDUCAO; onde ela falar de oferta/carro-chefe, quem manda e' a OFERTA SELECIONADA acima)\n${etapa}` : '',
      abordagem.instrucoes ? `INSTRUCOES EXTRAS DA EMPRESA\n${abordagem.instrucoes}` : '',
      historicoComercial ? `HISTORICO COMERCIAL DO LEAD (ligacoes e anotacoes ja feitas — se ja houve contato, ajuste o tom para retomada, nao aborde como primeiro contato; NAO copie ao lead)\n${historicoComercial}` : '',
      `ESTRATEGIA CALCULADA PELO APP\n${JSON.stringify(estrategia, null, 2)}`,
      `DADOS DO LEAD\n${JSON.stringify(dadosLead, null, 2)}`,
      'JSON DE SAIDA',
    ].filter(Boolean).join('\n\n'),
    oferta_abordagem: abordagem.oferta || null,
    aviso_site_pronto: avisoSitePronto,
    identificacao,
  }
}

// ─── ORIENTACAO QUE ORIGINOU A CONVERSA (continuidade) ───────────────────────
// A pergunta aqui NAO e' "qual a oferta certa agora?" (isso e' `selecionarOfertaAbordagem`, e so
// vale na 1a abordagem) e sim "com que oferta esta conversa COMECOU?". Sao perguntas diferentes:
// a primeira muda quando o operador edita a configuracao; a segunda e' um FATO datado e nao pode
// mudar depois — trocar a oferta no meio de uma negociacao troca o assunto com o cliente.
const ORIENTACAO_SCHEMA_VERSION = 'abordagem_origem_v1'

/**
 * Congela o que foi usado numa abordagem. Snapshot, nao referencia: a oferta e' copiada inteira
 * para que editar/apagar a configuracao depois nao reescreva o passado (mesma disciplina de
 * `vendas.comissao_percentual` e de `missao` publicada).
 */
function snapshotOrientacaoAbordagem(abordagem = {}, extras = {}) {
  const oferta = abordagem.oferta || abordagem.oferta_abordagem || null
  return {
    schema_version: ORIENTACAO_SCHEMA_VERSION,
    motivo: texto(abordagem.motivo || extras.motivo || MOTIVO_OFERTA.SEM_CONFIG, 60),
    nicho_lead: texto(abordagem.nicho_lead || extras.nichoLead, 180),
    oferta: oferta
      ? {
        id: texto(oferta.id, 80),
        nome: texto(oferta.nome, 180),
        descricao: texto(oferta.descricao, 700),
        nicho: texto(oferta.nicho, 180),
        geral: oferta.geral === true,
        site_pronto: oferta.site_pronto === true,
      }
      : null,
    // Versoes/fontes usadas na composicao — e' o que torna a orientacao AUDITAVEL depois.
    contexto_id: texto(extras.contextoId, 80) || null,
    playbook_versao_id: texto(extras.playbookVersaoId, 80) || null,
    etapa_playbook: extras.temEtapa ? 'primeiro_contato' : null,
    origem_envio: texto(extras.origemEnvio, 40) || null,
    registrado_em: new Date().toISOString(),
  }
}

/**
 * Bloco injetado nos turnos SEGUINTES (resposta do lead e follow-up). Diz o que ja foi
 * apresentado e PROIBE a troca de oferta. Sem oferta registrada devolve '' — nao se inventa
 * atribuicao retroativa para conversa que comecou antes disto existir.
 */
function blocoOrientacaoOrigem(origem) {
  const o = origem && typeof origem === 'object' ? origem : null
  if (!o || !o.oferta || !o.oferta.nome) return ''
  const linhas = [
    `Oferta apresentada na primeira abordagem: ${o.oferta.nome}`,
  ]
  if (o.oferta.descricao) linhas.push(`Descricao: ${o.oferta.descricao}`)
  linhas.push(o.oferta.geral
    ? 'Escopo: oferta geral da empresa.'
    : `Escopo: oferta especifica do nicho "${o.oferta.nicho || o.nicho_lead || 'nao informado'}".`)
  if (!o.oferta.site_pronto) {
    linhas.push('Esta oferta NAO foi apresentada como material/estrutura pronta: nao afirme que existe algo pronto.')
  }
  linhas.push('Continue a conversa NESTA oferta. Nao troque para a oferta geral nem para a oferta de outro nicho,'
    + ' e nao reinicie a abordagem. Se o lead pedir outra coisa, atenda o pedido dele sem reapresentar outro carro-chefe.')
  return linhas.join('\n')
}

module.exports = {
  ABORDAGEM_SCHEMA_VERSION,
  ORIENTACAO_SCHEMA_VERSION,
  MOTIVO_OFERTA,
  snapshotOrientacaoAbordagem,
  blocoOrientacaoOrigem,
  OBJETIVO_RESPOSTA_ABORDAGEM,
  ANGULOS_ABORDAGEM,
  MAX_MENSAGEM_CHARS,
  montarEstrategiaAbordagem,
  montarPromptContratoAbordagem,
  normalizarContratoAbordagem,
  renderMensagemAbordagemFallback,
  avisoSiteProntoPresente,
  terminaComPergunta,
  selecionarOfertaAbordagem,
}
