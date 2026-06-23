'use strict'

const { parsearRespostaJsonClaude } = require('../string-utils')
const { buscarContexto2Ativo, registrarSugestaoAprendizadoContexto } = require('./contexto-empresa')
const { empresaUsaAgenda } = require('../db/empresas')

// Override duro quando a instância NÃO usa agenda (config.usa_agenda=false).
// Anexado ao REPLY_SYSTEM para sobrepor qualquer regra de reunião do playbook.
const REPLY_SEM_AGENDA = `

IMPORTANTE — ESTA INSTÂNCIA NÃO USA AGENDA:
- NUNCA ofereça, sugira, marque ou confirme reunião/call/horário, mesmo que o playbook tenha regras de reunião — ignore-as por completo.
- Em vez de reunião, conduza a conversa: qualifique, responda dúvidas e, quando o lead estiver pronto ou o caso for complexo, faça handoff humano (precisa_handoff=true).
- Não cite "agenda", "agendar", "marcar um horário" nem proponha janelas de horário.`

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _safeJson(text) {
  try { return parsearRespostaJsonClaude(text) || {} } catch (_) { return {} }
}

function _truncatePlaybook(json) {
  // Para prompts, podemos enviar o playbook completo se não for muito grande.
  // Cap a ~12KB pra deixar headroom de contexto.
  const s = JSON.stringify(json || {}, null, 2)
  return s.length > 12000 ? s.slice(0, 12000) + '\n…[truncado]…' : s
}

function _formatHistorico(historico) {
  if (!Array.isArray(historico)) return String(historico || '').slice(0, 4000)
  return historico
    .slice(-20)
    .map((m) => `${m.role || 'user'}: ${(m.content || m.text || '').slice(0, 800)}`)
    .join('\n')
}

// ─── Carrega playbook ativo (opcionalmente linkado à Evolution instance) ────
async function carregarPlaybookAtivo(pool, empresaId, evolutionInstance = null) {
  return buscarContexto2Ativo(pool, empresaId, evolutionInstance)
}

// ─── Extrator de dados (prompt + chamada) ────────────────────────────────────
const EXTRACT_SYSTEM = `Você é um extrator de dados comercial para um agente de atendimento por WhatsApp.

Você receberá:
- playbook da empresa (Contexto 2)
- histórico recente da conversa
- dados já conhecidos do lead
- última mensagem do lead

Sua tarefa: extrair todo dado útil da última mensagem, mesmo que esteja incompleto.

Regras:
- Não invente dados.
- Se o lead responder parcialmente, aproveite a parte útil.
- Se o dado for inferido, marque confianca como "baixa" ou "media".
- Não apague dados anteriores com campos vazios.
- Identifique intenção do lead.
- Identifique se ele pediu orçamento.
- Identifique se ele quer reunião.
- Identifique objeções.
- Identifique dados faltantes (consulte dados_para_coletar do playbook).
- Sugira UMA próxima melhor pergunta.
- Não gere resposta final para o lead nesta etapa.

Retorne APENAS JSON válido neste schema:
{
  "intencao": "orcamento | reuniao | duvida | objecao | diagnostico | fechamento | vaga | outro",
  "dados_extraidos": {},
  "campos_coletados": [],
  "campos_faltantes": [],
  "inferencias": [
    { "campo": "", "valor": "", "confianca": "baixa|media|alta", "precisa_confirmar": true }
  ],
  "objecoes_detectadas": [],
  "dores_detectadas": [],
  "servicos_interesse": [],
  "temperatura": "quente|morno|frio",
  "score": 0,
  "orcamento_status": "nao_solicitado | solicitado_sem_escopo | pronto_para_faixa | precisa_reuniao | enviado",
  "reuniao_status": "nao_oferecida | deve_oferecer | oferecida | aceita | recusada",
  "proxima_melhor_acao": "",
  "proxima_pergunta_sugerida": "",
  "precisa_handoff": false,
  "motivo_handoff": ""
}`

async function extrairDadosDaMensagem({ pool, log, playbook, historico, mensagem, leadInsights, empresaId, conversaId, leadPhone, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  const userPrompt = `PLAYBOOK ATIVO:
${_truncatePlaybook(playbook?.json || playbook)}

HISTÓRICO RECENTE:
${_formatHistorico(historico)}

DADOS JÁ CONHECIDOS DO LEAD:
${JSON.stringify(leadInsights || {}, null, 2)}

ÚLTIMA MENSAGEM DO LEAD:
${mensagem || ''}

Extraia.`

  const result = await provider.generateAIResponse(
    {
      systemPrompt: EXTRACT_SYSTEM,
      userPrompt,
      task: 'extractLeadFromMessage',
      maxTokens: 1500,
      timeoutMs: 25000,
      empresaId, refType: 'reply', clientNumero: leadPhone,
    },
    pool, log
  )
  const parsed = _safeJson(result.text)
  const extracao = _normalizeExtracao(parsed)
  const usaAgenda = await empresaUsaAgenda(empresaId).catch(() => true)
  if (!usaAgenda) _neutralizarAgendaDesligada(extracao)
  return extracao
}

function _normalizeExtracao(p) {
  const e = p && typeof p === 'object' ? p : {}
  const intencoesRaw = Array.isArray(e.intencoes) ? e.intencoes.filter((x) => typeof x === 'string' && x.trim()) : []
  const intencao = typeof e.intencao === 'string' && e.intencao ? e.intencao : (intencoesRaw[0] || 'outro')
  const intencoes = intencoesRaw.length ? intencoesRaw : [intencao]
  const intencaoPrincipal = typeof e.intencao_principal === 'string' && e.intencao_principal
    ? e.intencao_principal
    : intencoes[0]
  return {
    intencoes,
    intencao_principal: intencaoPrincipal,
    intencao,
    dados_extraidos: e.dados_extraidos && typeof e.dados_extraidos === 'object' ? e.dados_extraidos : {},
    campos_coletados: Array.isArray(e.campos_coletados) ? e.campos_coletados : [],
    campos_faltantes: Array.isArray(e.campos_faltantes) ? e.campos_faltantes : [],
    inferencias: Array.isArray(e.inferencias) ? e.inferencias : [],
    objecoes_detectadas: Array.isArray(e.objecoes_detectadas) ? e.objecoes_detectadas : [],
    dores_detectadas: Array.isArray(e.dores_detectadas) ? e.dores_detectadas : [],
    servicos_interesse: Array.isArray(e.servicos_interesse) ? e.servicos_interesse : [],
    temperatura: ['quente', 'morno', 'frio'].includes(e.temperatura) ? e.temperatura : 'morno',
    score: typeof e.score === 'number' ? e.score : 0,
    orcamento_status: typeof e.orcamento_status === 'string' ? e.orcamento_status : 'nao_solicitado',
    reuniao_status: typeof e.reuniao_status === 'string' ? e.reuniao_status : 'nao_oferecida',
    proxima_melhor_acao: typeof e.proxima_melhor_acao === 'string' ? e.proxima_melhor_acao : '',
    proxima_pergunta_sugerida: typeof e.proxima_pergunta_sugerida === 'string' ? e.proxima_pergunta_sugerida : '',
    precisa_handoff: !!e.precisa_handoff,
    motivo_handoff: typeof e.motivo_handoff === 'string' ? e.motivo_handoff : '',
  }
}

function _neutralizarAgendaDesligada(extracao, decisao = null) {
  if (extracao && typeof extracao === 'object') {
    extracao.reuniao_status = 'nao_oferecida'
  }
  const perfil = decisao?.atualizar_perfil
  if (perfil && typeof perfil === 'object' && !Array.isArray(perfil)) {
    delete perfil.reuniao_proposta
  }
}

// Heurística determinística (não-IA) para garantir multi-intent quando IA falha em emitir.
// Pode ser chamada em testes ou pra reforçar a extração da IA.
const PRECO_INTENT_RX = /(quanto\s+custa|quanto\s+(?:fica|sai|paga|[ée]|ta)|qual\s+(o\s+)?(valor|pre[çc]o|custo|investimento)|pre[çc]o|valor|custo|investimento|cobra(m)?\s+quanto|me\s+passa\s+(o\s+)?(valor|pre[çc]o|custo))/i

const INTENT_PATTERNS = [
  { intent: 'cadastro',           rx: /(cadastr[oar]+|como\s+(eu\s+)?(fa[çc]o|crio|crio?\s+conta)|como\s+entr[oa]r?(\s+na\s+plataforma)?|como\s+come[cç]o|criar\s+conta|abrir\s+conta)/i },
  { intent: 'preco',              rx: /(quanto\s+custa|qual\s+(o\s+)?valor|qual\s+(o\s+)?pre[çc]o|quanto\s+(?:fica|sai|paga)|cobra(m)?\s+quanto|me\s+passa\s+(o\s+)?valor)/i },
  { intent: 'plano_gratuito',     rx: /(plano\s+gratuito|tem\s+gr[áa]tis|gr[áa]tis|gratuito|free)/i },
  { intent: 'como_funciona',      rx: /como\s+funciona/i },
  { intent: 'link',               rx: /(tem\s+link|qual\s+(o\s+)?site|me\s+manda\s+(o\s+)?link)/i },
  { intent: 'interesse_maquina_curso',     rx: /(vender|criar)\s+curso/i },
  { intent: 'interesse_maquina_servicos',  rx: /(divulgar|vender|oferecer)\s+(meus\s+)?servi[cç]os/i },
  { intent: 'captacao_clientes',  rx: /(captar|achar|atrair|conseguir)\s+clientes?/i },
]

function detectarIntencoesHeuristicas(mensagem) {
  const t = String(mensagem || '').toLowerCase()
  const out = []
  for (const { intent, rx } of INTENT_PATTERNS) if (rx.test(t)) out.push(intent)
  if (PRECO_INTENT_RX.test(t)) out.push('preco')
  return [...new Set(out)]
}

// ─── Merge seguro de lead insights ────────────────────────────────────────────
function _mergeSeguro(prev, novo) {
  const out = { ...(prev || {}) }
  for (const [k, v] of Object.entries(novo || {})) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && !v.trim()) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    out[k] = v
  }
  return out
}

async function atualizarLeadInsights({ pool, empresaId, conversaId, leadPhone, extracao }) {
  if (!pool || !empresaId || !leadPhone) return null

  const { rows: [prev] } = await pool.query(
    `SELECT * FROM app.lead_insights
     WHERE empresa_id = $1 AND numero = $2 AND tipo = 'playbook_runtime'
     LIMIT 1`,
    [empresaId, leadPhone]
  )

  const dadosExtraidos = _mergeSeguro(prev?.dados_extraidos, extracao.dados_extraidos)
  const objecoes = [...new Set([...(prev?.objecoes || []), ...(extracao.objecoes_detectadas || [])])]
  const dores = [...new Set([...(prev?.dores || []), ...(extracao.dores_detectadas || [])])]
  const servicos = [...new Set([...(prev?.servicos_interesse || []), ...(extracao.servicos_interesse || [])])]

  const dataPayload = {
    empresa_id: empresaId,
    numero: leadPhone,
    tipo: 'playbook_runtime',
    conversa_id: conversaId || prev?.conversa_id || null,
    lead_phone: leadPhone,
    dados_extraidos: dadosExtraidos,
    campos_coletados_json: extracao.campos_coletados,
    campos_faltantes_json: extracao.campos_faltantes,
    ultima_intencao: extracao.intencao,
    ultima_etapa: prev?.ultima_etapa || null,
    proxima_melhor_acao: extracao.proxima_melhor_acao,
    temperatura: extracao.temperatura,
    score: extracao.score,
    objecoes,
    dores,
    servicos_interesse: servicos,
    orcamento_status: extracao.orcamento_status,
    reuniao_status: extracao.reuniao_status,
    proximas_acoes: prev?.proximas_acoes || [],
    confianca_json: { inferencias: extracao.inferencias },
  }

  if (prev) {
    await pool.query(
      `UPDATE app.lead_insights SET
        conversa_id = $1, lead_phone = $2,
        dados_extraidos = $3, campos_coletados_json = $4, campos_faltantes_json = $5,
        ultima_intencao = $6, proxima_melhor_acao = $7, temperatura = $8, score = $9,
        objecoes = $10, dores = $11, servicos_interesse = $12,
        orcamento_status = $13, reuniao_status = $14, confianca_json = $15,
        updated_at = NOW()
       WHERE id = $16`,
      [
        dataPayload.conversa_id, dataPayload.lead_phone,
        JSON.stringify(dataPayload.dados_extraidos),
        JSON.stringify(dataPayload.campos_coletados_json),
        JSON.stringify(dataPayload.campos_faltantes_json),
        dataPayload.ultima_intencao, dataPayload.proxima_melhor_acao,
        dataPayload.temperatura, dataPayload.score,
        JSON.stringify(dataPayload.objecoes),
        JSON.stringify(dataPayload.dores),
        JSON.stringify(dataPayload.servicos_interesse),
        dataPayload.orcamento_status, dataPayload.reuniao_status,
        JSON.stringify(dataPayload.confianca_json),
        prev.id,
      ]
    )
    return { ...prev, ...dataPayload }
  } else {
    const { rows: [created] } = await pool.query(
      `INSERT INTO app.lead_insights
        (empresa_id, numero, tipo, conteudo, conversa_id, lead_phone,
         dados_extraidos, campos_coletados_json, campos_faltantes_json,
         ultima_intencao, proxima_melhor_acao, temperatura, score,
         objecoes, dores, servicos_interesse, orcamento_status, reuniao_status, confianca_json)
       VALUES ($1,$2,'playbook_runtime','{}',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        empresaId, leadPhone,
        dataPayload.conversa_id, dataPayload.lead_phone,
        JSON.stringify(dataPayload.dados_extraidos),
        JSON.stringify(dataPayload.campos_coletados_json),
        JSON.stringify(dataPayload.campos_faltantes_json),
        dataPayload.ultima_intencao, dataPayload.proxima_melhor_acao,
        dataPayload.temperatura, dataPayload.score,
        JSON.stringify(dataPayload.objecoes),
        JSON.stringify(dataPayload.dores),
        JSON.stringify(dataPayload.servicos_interesse),
        dataPayload.orcamento_status, dataPayload.reuniao_status,
        JSON.stringify(dataPayload.confianca_json),
      ]
    )
    return created
  }
}

// ─── Decisor de resposta ─────────────────────────────────────────────────────
const REPLY_SYSTEM = `Você é o agente comercial da empresa, atendendo via WhatsApp.

Você usa:
- Contexto 2 ativo da empresa (playbook)
- dados já coletados (lead_insights)
- última mensagem do lead
- extração já feita (intenção, campos faltantes, próxima ação sugerida)

Regras:
- ANTES de responder qualquer pergunta, consulte playbook.informacoes_empresa (fatos oficiais da empresa). Se a resposta está lá, entregue o fato direto — nunca diga que não sabe nem qualifique antes quando o dado existe no bloco.
- Responda natural, curto, útil. Sem cara de formulário.
- Faça no máximo uma pergunta principal por mensagem (salvo combinações naturais).
- Aproveite dados já respondidos. Não repita pergunta que já foi respondida.
- Se o lead pediu preço cedo demais, explique que precisa entender escopo mínimo.
- Se houver regra de preço no playbook e dados mínimos, pode orientar com faixa.
- Se for complexo, conduza para reunião.
- Se lead está quente, proponha próximo passo claro.
- Se faltar dado, peça O próximo dado mais importante (consulte campos_faltantes).
- Não invente preço, prazo, desconto ou garantia.
- Se houver risco/pedido fora do contexto, acione handoff.

Retorne APENAS JSON neste formato:
{
  "mensagem_pro_lead": "",
  "etapa_proxima": "",
  "atualizar_perfil": {},
  "precisa_handoff": false,
  "motivo_handoff": "",
  "sugestao_aprendizado": null
}

sugestao_aprendizado pode ser null OU objeto:
{ "tipo": "objecao_nova|pergunta_frequente|resposta_que_funcionou|outro",
  "evidencia": "", "sugestao_markdown": "", "confianca": "baixa|media|alta" }`

async function decidirRespostaComPlaybook({ pool, log, playbook, historico, mensagem, leadInsights, extracao, apelido, empresaId, conversaId, leadPhone, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  // Gate de agenda por instância: se desligada, força reuniao_status neutro e
  // anexa o override que proíbe qualquer oferta de reunião.
  const usaAgenda = await empresaUsaAgenda(empresaId).catch(() => true)
  const extracaoView = usaAgenda ? extracao : { ...(extracao || {}), reuniao_status: 'nao_oferecida' }
  const systemPrompt = usaAgenda ? REPLY_SYSTEM : REPLY_SYSTEM + REPLY_SEM_AGENDA
  const userPrompt = `${apelido ? `NOME DO LEAD (trate pelo primeiro nome, com naturalidade; nao repita o nome em toda mensagem): ${apelido}\n\n` : ''}PLAYBOOK ATIVO:
${_truncatePlaybook(playbook?.json || playbook)}

LEAD INSIGHTS:
${JSON.stringify(leadInsights || {}, null, 2)}

EXTRAÇÃO RECENTE:
${JSON.stringify(extracaoView || {}, null, 2)}

HISTÓRICO:
${_formatHistorico(historico)}

ÚLTIMA MENSAGEM DO LEAD:
${mensagem || ''}

Decida a melhor resposta.`

  const result = await provider.generateAIResponse(
    {
      systemPrompt,
      userPrompt,
      task: 'replyWithPlaybook',
      maxTokens: 1200,
      timeoutMs: 25000,
      empresaId, refType: 'reply', clientNumero: leadPhone,
    },
    pool, log
  )
  const p = _safeJson(result.text)
  const decisao = {
    mensagem_pro_lead: typeof p.mensagem_pro_lead === 'string' ? p.mensagem_pro_lead : '',
    etapa_proxima: typeof p.etapa_proxima === 'string' ? p.etapa_proxima : '',
    atualizar_perfil: p.atualizar_perfil && typeof p.atualizar_perfil === 'object' ? p.atualizar_perfil : {},
    precisa_handoff: !!p.precisa_handoff,
    motivo_handoff: typeof p.motivo_handoff === 'string' ? p.motivo_handoff : '',
    sugestao_aprendizado: p.sugestao_aprendizado && typeof p.sugestao_aprendizado === 'object' ? p.sugestao_aprendizado : null,
  }
  _corrigirRespostaPrecoQuandoTemContexto({ decisao, playbook, mensagem, extracao })
  return _corrigirRespostaCadastroQuandoTemLink({ decisao, playbook, mensagem, extracao })
}

/**
 * Se a decisão indicou sugestao_aprendizado, salva como pendente.
 * NUNCA altera o contexto ativo.
 */
async function talvezGerarSugestaoAprendizado({ pool, log, empresaId, contextoVersaoId, conversaId, leadPhone, decisao }) {
  if (!decisao || !decisao.sugestao_aprendizado) return null
  const s = decisao.sugestao_aprendizado
  if (!s.tipo || !s.evidencia) return null
  try {
    return await registrarSugestaoAprendizadoContexto({
      pool, empresaId, contextoVersaoId, conversaId, leadPhone,
      tipo: s.tipo, evidencia: s.evidencia,
      sugestaoJson: s.sugestao_json || {},
      sugestaoMarkdown: s.sugestao_markdown || null,
      confianca: s.confianca || 'media',
    })
  } catch (err) {
    if (log) log.warn({ err: err.message }, 'Falha ao registrar sugestão de aprendizado')
    return null
  }
}

// ─── Pipeline em uma chamada (extração + decisão juntos) ─────────────────────
function _leadPediuPreco(mensagem, extracao) {
  const intents = Array.isArray(extracao?.intencoes) ? extracao.intencoes : []
  return intents.includes('preco') || PRECO_INTENT_RX.test(String(mensagem || ''))
}

function _textoTemPreco(texto) {
  return /(r\$\s?\d|\d+\s*(reais|por\s+m[êe]s|por\s+ano|\/m[êe]s|\/ano|ao\s+ano|mensais|anual|ano))/i.test(String(texto || ''))
}

function _temFraseGenericaDePreco(texto) {
  return /(preciso\s+entender\s+melhor|depende\s+da\s+sua\s+necessidade|nossos\s+servi[cç]os\s+variam|pra\s+te\s+ajudar\s+melhor|qual\s+(é\s+)?(o\s+)?seu\s+nome)/i.test(String(texto || ''))
}

function _stringsDoObjeto(obj, out = []) {
  if (!obj || out.length > 120) return out
  if (typeof obj === 'string') {
    out.push(obj)
    return out
  }
  if (Array.isArray(obj)) {
    for (const item of obj) _stringsDoObjeto(item, out)
    return out
  }
  if (typeof obj === 'object') {
    for (const val of Object.values(obj)) _stringsDoObjeto(val, out)
  }
  return out
}

function _extrairPrecoDoPlaybook(playbook) {
  const pb = playbook?.json || playbook || {}
  const candidatos = []
  if (pb.precos_planos) candidatos.push(pb.precos_planos)
  if (pb.regras_orcamento?.respostas_para_pergunta_de_preco) candidatos.push(pb.regras_orcamento.respostas_para_pergunta_de_preco)
  if (pb.servicos) candidatos.push(pb.servicos)
  if (pb.respostas_base) candidatos.push(pb.respostas_base)
  if (playbook?.markdown) candidatos.push(playbook.markdown)

  for (const s of _stringsDoObjeto(candidatos)) {
    const texto = String(s || '').replace(/\s+/g, ' ').trim()
    if (_textoTemPreco(texto)) return texto.slice(0, 280)
  }
  return ''
}

function _primeiroTexto(arr) {
  return Array.isArray(arr) ? arr.find((x) => typeof x === 'string' && x.trim()) || '' : ''
}

function _montarRespostaPrecoDireta({ playbook, preco, extracao }) {
  const pb = playbook?.json || playbook || {}
  const intencoes = Array.isArray(extracao?.intencoes) ? extracao.intencoes : []
  const partes = [`Sobre o preço: ${preco}.`]

  if (intencoes.includes('cadastro')) {
    const link = _extrairLinkPrincipalDoPlaybook(pb)
    const passos = Array.isArray(pb.cadastro_e_onboarding?.passos)
      ? pb.cadastro_e_onboarding.passos.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3).join(', ')
      : ''
    if (link) partes.push(`Para se cadastrar, acesse ${link}.`)
    else if (passos) partes.push(`Para se cadastrar: ${passos}.`)
  }

  const pergunta = _primeiroTexto(pb.cadastro_e_onboarding?.perguntas_para_direcionar)
    || 'Você quer usar para vender serviços, criar cursos ou captar clientes?'
  partes.push(pergunta)
  return partes.join(' ')
}

function _corrigirRespostaPrecoQuandoTemContexto({ decisao, playbook, mensagem, extracao }) {
  if (!decisao || !_leadPediuPreco(mensagem, extracao)) return decisao
  const preco = _extrairPrecoDoPlaybook(playbook)
  if (!preco) return decisao
  if (_textoTemPreco(decisao.mensagem_pro_lead) && !_temFraseGenericaDePreco(decisao.mensagem_pro_lead)) return decisao
  decisao.mensagem_pro_lead = _montarRespostaPrecoDireta({ playbook, preco, extracao })
  decisao.etapa_proxima = decisao.etapa_proxima || 'preco_respondido'
  decisao.atualizar_perfil = {
    ...(decisao.atualizar_perfil || {}),
    eventos_conversa: {
      ...(decisao.atualizar_perfil?.eventos_conversa || {}),
      perguntou_preco: true,
    },
  }
  return decisao
}

// ─── Correção determinística: cadastro / "como acesso/uso" ──────────────────────
// Espelha a lógica de preço: quando o lead pergunta como se cadastrar/acessar/usar
// e o playbook tem link de cadastro, GARANTE que a resposta traga o link + passos —
// sem depender do LLM (que costumava responder "visite o site" sem a URL).
const CADASTRO_INTENT_RX = /(como\s+(eu\s+)?(fa[çc]o|me\s+)?(cadastr|inscre|registr|acess|entr|come[çc]|us[ao])|como\s+funciona|quero\s+(me\s+)?cadastr|criar\s+(conta|perfil)|abrir\s+conta|qual\s+(o\s+)?site|tem\s+link|me\s+manda\s+o\s+link|onde\s+(eu\s+)?(acesso|cadastr|me\s+inscrevo|come[çc]o))/i

function _leadPediuCadastro(mensagem, extracao) {
  const intents = Array.isArray(extracao?.intencoes) ? extracao.intencoes : []
  if (intents.some((i) => ['cadastro', 'como_funciona', 'link'].includes(i))) return true
  return CADASTRO_INTENT_RX.test(String(mensagem || ''))
}

function _textoContemUrl(texto, url) {
  if (!texto || !url) return false
  const host = String(url).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return texto.includes(url) || (!!host && texto.includes(host))
}

function _extrairCadastroDoPlaybook(playbook) {
  const pb = playbook?.json || playbook || {}
  const co = pb.cadastro_e_onboarding || {}
  const { ehUrlFalsa } = require('./url-sanitize')
  let link = typeof co.link_cadastro === 'string' ? co.link_cadastro.trim() : ''
  if (link && ehUrlFalsa(link)) link = ''
  if (!link) link = _extrairLinkPrincipalDoPlaybook(pb)
  const passos = Array.isArray(co.passos) ? co.passos.filter((x) => typeof x === 'string' && x.trim()) : []
  const respostaBase = typeof co.resposta_base_cadastro === 'string' ? co.resposta_base_cadastro.trim() : ''
  const pergunta = _primeiroTexto(co.perguntas_para_direcionar)
  return { link, passos, respostaBase, pergunta }
}

function _montarRespostaCadastroDireta({ link, passos, respostaBase, pergunta }) {
  if (respostaBase && _textoContemUrl(respostaBase, link)) return respostaBase
  const partes = []
  if (passos.length) partes.push(`É rápido: ${passos.slice(0, 4).join(', ')}.`)
  partes.push(`Acesse ${link} pra criar seu perfil e começar.`)
  if (pergunta) partes.push(pergunta)
  return partes.join(' ')
}

function _corrigirRespostaCadastroQuandoTemLink({ decisao, playbook, mensagem, extracao }) {
  if (!decisao || !_leadPediuCadastro(mensagem, extracao)) return decisao
  const dados = _extrairCadastroDoPlaybook(playbook)
  if (!dados.link) return decisao
  if (_textoContemUrl(decisao.mensagem_pro_lead, dados.link)) return decisao
  decisao.mensagem_pro_lead = _montarRespostaCadastroDireta(dados)
  decisao.etapa_proxima = decisao.etapa_proxima || 'cadastro_orientado'
  decisao.atualizar_perfil = {
    ...(decisao.atualizar_perfil || {}),
    eventos_conversa: {
      ...(decisao.atualizar_perfil?.eventos_conversa || {}),
      enviou_link_cadastro: true,
    },
  }
  return decisao
}

const BUNDLE_SYSTEM = `Você é o agente comercial da empresa em WhatsApp.

Em UMA passada, você faz duas coisas:
1) Extrai dados úteis da última mensagem do lead (mesmo respostas parciais), incluindo MÚLTIPLAS intenções.
2) Decide a próxima mensagem do agente seguindo a REGRA COMERCIAL CENTRAL.

────────────────────────────────────────────────────────────────────
REGRA COMERCIAL CENTRAL — RESPONDER PRIMEIRO, QUALIFICAR DEPOIS
────────────────────────────────────────────────────────────────────
GATILHO DE INFORMAÇÕES (vale para QUALQUER pergunta do lead):
- ANTES de qualquer coisa, verifique se a resposta está em playbook.informacoes_empresa
  (bloco de FATOS oficiais da empresa: serviços, preços, links, horário, formas de pagamento, FAQ, etc.).
- Se a informação existe ali, RESPONDA O FATO direto, com as palavras certas — NUNCA diga "não sei",
  "não tenho essa informação" ou peça pra qualificar antes quando o dado está no bloco.
- Só depois de entregar o fato é que você conduz/qualifica.

Quando o lead faz uma pergunta direta sobre cadastro, preço, planos, link, como funciona, plano gratuito, quais serviços, quais máquinas/módulos:
- RESPONDA DIRETAMENTE usando dados de playbook.informacoes_empresa, .cadastro_e_onboarding, .links_uteis_estruturados, .maquinas_ou_modulos, .servicos.
- NÃO peça nome no início. Peça nome só se for cadastro real ou handoff.
- NÃO responda "depende da sua necessidade", "preciso entender melhor", "qual é o seu nome?", "nossos serviços variam" se o playbook tem dados suficientes.
- TERMINE com UMA pergunta de qualificação ligada à venda (não pergunta vazia).

ESTRUTURA OBRIGATÓRIA da resposta para perguntas diretas:
1. Abertura curta ("Claro.", "Show.", "Beleza.") — opcional.
2. Resposta direta à pergunta.
3. Benefício principal vinculado.
4. Citar produto/plano/máquina relacionado (do playbook.maquinas_ou_modulos / .servicos).
5. Citar preço se existir em precos_planos.
6. Enviar link se existir em links_uteis_estruturados ou cadastro_e_onboarding.link_cadastro.
7. UMA pergunta de qualificação comercial (ex: "Você quer X, Y ou Z?").

Use os dados de playbook.regras_de_conversao, .cadastro_e_onboarding, .maquinas_ou_modulos, .links_uteis_estruturados, .intencoes_de_conversao.

────────────────────────────────────────────────────────────────────
EXTRAÇÃO DE INTENÇÕES MÚLTIPLAS
────────────────────────────────────────────────────────────────────
Mapeie frases para intenções (pode ter mais de uma simultaneamente):
- "como faço cadastro" / "como me cadastro" / "como entro" / "como começo" → cadastro
- "quanto custa" / "qual valor" / "quanto é" / "preço" → preco
- "tem gratuito" / "plano gratuito" / "free" → plano_gratuito
- "como funciona" → como_funciona
- "tem link" / "qual o site" → link
- "quero vender curso" → interesse_maquina_curso
- "quero divulgar serviço" / "quero anunciar" → interesse_maquina_servicos
- "quero captar clientes" / "quero achar cliente" → captacao_clientes

Outras intenções gerais: orcamento, reuniao, duvida, objecao, diagnostico, fechamento, vaga, outro.

Quando lead combina cadastro+preco em uma frase, retorne intencoes=["cadastro","preco"] e proxima_melhor_acao="responder_cadastro_preco_e_direcionar".

Regras gerais:
- Não invente dados/preço/prazo/garantia.
- Não apague dados conhecidos com vazio/null.
- Não repita perguntas já respondidas no histórico.
- Se houver risco/pedido fora do contexto: precisa_handoff = true.
- sugestao_aprendizado só quando padrão claro (objeção nova, pergunta frequente, resposta que funcionou).

Retorne APENAS JSON neste schema:
{
  "extracao": {
    "intencoes": ["cadastro", "preco"],
    "intencao_principal": "cadastro",
    "intencao": "duvida",
    "dados_extraidos": {},
    "campos_coletados": [],
    "campos_faltantes": [],
    "inferencias": [{"campo":"","valor":"","confianca":"baixa|media|alta","precisa_confirmar":true}],
    "objecoes_detectadas": [],
    "dores_detectadas": [],
    "servicos_interesse": [],
    "temperatura": "quente|morno|frio",
    "score": 0,
    "orcamento_status": "nao_solicitado|solicitado_sem_escopo|pronto_para_faixa|precisa_reuniao|enviado",
    "reuniao_status": "nao_oferecida|deve_oferecer|oferecida|aceita|recusada",
    "proxima_melhor_acao": "",
    "proxima_pergunta_sugerida": "",
    "precisa_handoff": false,
    "motivo_handoff": ""
  },
  "decisao": {
    "mensagem_pro_lead": "",
    "etapa_proxima": "",
    "atualizar_perfil": {},
    "precisa_handoff": false,
    "motivo_handoff": "",
    "sugestao_aprendizado": null
  }
}

Mantenha "intencao" (singular) preenchido com intencao_principal para compatibilidade.

REGRA DE URL — PROIBIDO INVENTAR LINK.
Nunca emita example.com, localhost, teste.com, site.com, yoursite.com, dominio.com, sample.com, fake.com ou qualquer URL placeholder. Use APENAS URLs presentes em playbook.links_uteis_estruturados, playbook.cadastro_e_onboarding.link_cadastro, playbook.resumo_empresa.site ou nos dados do lead. Se não houver URL real, NÃO inclua link na resposta.`

async function extrairEDecidirBundle({ pool, log, playbook, historico, mensagem, leadInsights, apelido, empresaId, conversaId, leadPhone, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  // Gate de agenda (também no caminho bundle, que é o default): se desligada, anexa
  // o override que proíbe oferecer reunião.
  const usaAgenda = await empresaUsaAgenda(empresaId).catch(() => true)
  const systemPrompt = usaAgenda ? BUNDLE_SYSTEM : BUNDLE_SYSTEM + REPLY_SEM_AGENDA
  const userPrompt = `${apelido ? `NOME DO LEAD (trate pelo primeiro nome, com naturalidade; nao repita o nome em toda mensagem): ${apelido}\n\n` : ''}PLAYBOOK ATIVO:
${_truncatePlaybook(playbook?.json || playbook)}

DADOS JÁ CONHECIDOS DO LEAD:
${JSON.stringify(leadInsights || {}, null, 2)}

HISTÓRICO RECENTE:
${_formatHistorico(historico)}

ÚLTIMA MENSAGEM DO LEAD:
${mensagem || ''}

Extraia + decida em um único JSON.`

  const result = await provider.generateAIResponse(
    {
      systemPrompt,
      userPrompt,
      task: 'extractAndReply',
      maxTokens: 2000,
      timeoutMs: 30000,
      empresaId, refType: 'reply', clientNumero: leadPhone,
    },
    pool, log
  )
  const p = _safeJson(result.text)
  const extracao = _normalizeExtracao(p.extracao || {})
  if (!usaAgenda) _neutralizarAgendaDesligada(extracao)
  // Reforço heurístico: garante que multi-intent não passe batido se a IA emitir só um
  const heur = detectarIntencoesHeuristicas(mensagem)
  if (heur.length) {
    const merged = [...new Set([...heur, ...extracao.intencoes])]
    extracao.intencoes = merged
    if (!extracao.intencao_principal || extracao.intencao_principal === 'outro') {
      extracao.intencao_principal = merged[0]
    }
  }
  const decisao = {
    mensagem_pro_lead: typeof p.decisao?.mensagem_pro_lead === 'string' ? p.decisao.mensagem_pro_lead : '',
    etapa_proxima: typeof p.decisao?.etapa_proxima === 'string' ? p.decisao.etapa_proxima : '',
    atualizar_perfil: p.decisao?.atualizar_perfil && typeof p.decisao.atualizar_perfil === 'object' ? p.decisao.atualizar_perfil : {},
    precisa_handoff: !!p.decisao?.precisa_handoff,
    motivo_handoff: typeof p.decisao?.motivo_handoff === 'string' ? p.decisao.motivo_handoff : '',
    sugestao_aprendizado: p.decisao?.sugestao_aprendizado && typeof p.decisao.sugestao_aprendizado === 'object' ? p.decisao.sugestao_aprendizado : null,
  }
  if (!usaAgenda) _neutralizarAgendaDesligada(extracao, decisao)
  // Sanitiza URLs fake na resposta — substitui por link real do playbook se existir
  const { sanitizarDecisaoUrls } = require('./url-sanitize')
  const linkReal = _extrairLinkPrincipalDoPlaybook(playbook?.json || playbook)
  sanitizarDecisaoUrls(decisao, linkReal)
  _corrigirRespostaPrecoQuandoTemContexto({ decisao, playbook, mensagem, extracao })
  _corrigirRespostaCadastroQuandoTemLink({ decisao, playbook, mensagem, extracao })
  return { extracao, decisao }
}

function _extrairLinkPrincipalDoPlaybook(pb) {
  if (!pb || typeof pb !== 'object') return ''
  const cands = []
  if (Array.isArray(pb.links_uteis_estruturados)) {
    for (const l of pb.links_uteis_estruturados) {
      if (l && typeof l.url === 'string') cands.push(l.url)
    }
  }
  if (pb.cadastro_e_onboarding?.link_cadastro) cands.push(pb.cadastro_e_onboarding.link_cadastro)
  if (pb.resumo_empresa?.site) cands.push(pb.resumo_empresa.site)
  const { ehUrlFalsa } = require('./url-sanitize')
  return cands.find((u) => u && !ehUrlFalsa(u)) || ''
}

/**
 * Pipeline completa: bundle (1 IA call) → atualiza insights → registra sugestão.
 * Bundle reduz custo pela metade vs duas chamadas separadas.
 *
 * Variável de ambiente CONTEXT_PLAYBOOK_BUNDLE=false força duas chamadas (debug).
 */
async function processarMensagemComPlaybook({ pool, log, empresaId, conversaId, leadPhone, mensagem, historico, evolutionInstance, aiProvider }) {
  const playbook = await carregarPlaybookAtivo(pool, empresaId, evolutionInstance)
  if (!playbook) return null

  const { rows: [insightsRow] } = await pool.query(
    `SELECT * FROM app.lead_insights
     WHERE empresa_id = $1 AND numero = $2 AND tipo = 'playbook_runtime' LIMIT 1`,
    [empresaId, leadPhone]
  )
  const leadInsights = insightsRow || {}
  // Nome do contato (apelido) p/ o agente saudar pelo nome. Fail-open: sem nome, segue.
  const apelido = await pool.query('SELECT apelido FROM vendas.lead_profiles WHERE numero = $1', [leadPhone])
    .then((r) => (r.rows[0]?.apelido || null)).catch(() => null)

  const usarBundle = String(process.env.CONTEXT_PLAYBOOK_BUNDLE || 'true').toLowerCase() !== 'false'

  let extracao, decisao
  if (usarBundle) {
    const b = await extrairEDecidirBundle({
      pool, log, playbook, historico, mensagem, leadInsights, apelido,
      empresaId, conversaId, leadPhone, aiProvider,
    })
    extracao = b.extracao
    decisao = b.decisao
  } else {
    extracao = await extrairDadosDaMensagem({
      pool, log, playbook, historico, mensagem, leadInsights,
      empresaId, conversaId, leadPhone, aiProvider,
    })
    decisao = await decidirRespostaComPlaybook({
      pool, log, playbook, historico, mensagem, leadInsights, extracao, apelido,
      empresaId, conversaId, leadPhone, aiProvider,
    })
  }

  await atualizarLeadInsights({ pool, empresaId, conversaId, leadPhone, extracao })

  await talvezGerarSugestaoAprendizado({
    pool, log, empresaId, contextoVersaoId: playbook.versao_id,
    conversaId, leadPhone, decisao,
  })

  return { playbook, extracao, decisao }
}

// ─── Follow-up (reengajamento) com o playbook da empresa ──────────────────────
const FOLLOWUP_PLAYBOOK_SYSTEM = `Você é o agente comercial da empresa no WhatsApp, escrevendo um FOLLOW-UP (cutucão) para um lead que ficou em silêncio.

Use o playbook (Contexto 2) da empresa: tom de voz, serviços, links e regras.

REGRA OBRIGATÓRIA DE FORMATO: é um cutuque CURTO — no máximo 1 bolha, 1-2 frases curtas. NÃO resuma a conversa nem repita o que o lead já disse. Foque em UM ponto: uma pergunta leve OU um próximo passo concreto. Tom humano, leve, sem pressão.
Não invente preço, link ou dados que não estejam no playbook.

Retorne APENAS JSON válido: {"mensagem":"..."}`

/**
 * Gera o texto de um follow-up de reengajamento usando o playbook da empresa
 * (não os prompts da PJ). Usado quando a conversa pertence a uma empresa com
 * Contexto 2 ativo. Retorna a string da mensagem (lança se vier vazia).
 */
async function gerarFollowupComPlaybook({ pool, log, empresaId, leadPhone, historico, playbook, contextoTempo, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  const userPrompt = `PLAYBOOK ATIVO:
${_truncatePlaybook(playbook?.json || playbook)}

HISTÓRICO RECENTE:
${_formatHistorico(historico)}

CONTEXTO DE TEMPO (uso interno; não copie labels ao lead):
${JSON.stringify(contextoTempo || {}, null, 2)}

Escreva o follow-up curto seguindo as regras.`

  const result = await provider.generateAIResponse(
    {
      systemPrompt: FOLLOWUP_PLAYBOOK_SYSTEM,
      userPrompt,
      task: 'followupPlaybook',
      maxTokens: 400,
      timeoutMs: 20000,
      empresaId, refType: 'followup', clientNumero: leadPhone,
    },
    pool, log
  )
  const p = _safeJson(result.text)
  let texto = typeof p.mensagem === 'string' ? p.mensagem.trim() : ''
  if (!texto) texto = String(result?.text || '').trim()
  if (!texto) throw new Error('Follow-up via playbook retornou vazio')
  return texto
}

module.exports = {
  carregarPlaybookAtivo,
  extrairDadosDaMensagem,
  atualizarLeadInsights,
  decidirRespostaComPlaybook,
  extrairEDecidirBundle,
  talvezGerarSugestaoAprendizado,
  processarMensagemComPlaybook,
  gerarFollowupComPlaybook,
  detectarIntencoesHeuristicas,
}
