'use strict'

const { parsearRespostaJsonClaude } = require('../string-utils')
const { buscarContexto2Ativo, registrarSugestaoAprendizadoContexto } = require('./contexto-empresa')

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
  return _normalizeExtracao(parsed)
}

function _normalizeExtracao(p) {
  const e = p && typeof p === 'object' ? p : {}
  return {
    intencao: typeof e.intencao === 'string' ? e.intencao : 'outro',
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

async function decidirRespostaComPlaybook({ pool, log, playbook, historico, mensagem, leadInsights, extracao, empresaId, conversaId, leadPhone, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  const userPrompt = `PLAYBOOK ATIVO:
${_truncatePlaybook(playbook?.json || playbook)}

LEAD INSIGHTS:
${JSON.stringify(leadInsights || {}, null, 2)}

EXTRAÇÃO RECENTE:
${JSON.stringify(extracao || {}, null, 2)}

HISTÓRICO:
${_formatHistorico(historico)}

ÚLTIMA MENSAGEM DO LEAD:
${mensagem || ''}

Decida a melhor resposta.`

  const result = await provider.generateAIResponse(
    {
      systemPrompt: REPLY_SYSTEM,
      userPrompt,
      task: 'replyWithPlaybook',
      maxTokens: 1200,
      timeoutMs: 25000,
      empresaId, refType: 'reply', clientNumero: leadPhone,
    },
    pool, log
  )
  const p = _safeJson(result.text)
  return {
    mensagem_pro_lead: typeof p.mensagem_pro_lead === 'string' ? p.mensagem_pro_lead : '',
    etapa_proxima: typeof p.etapa_proxima === 'string' ? p.etapa_proxima : '',
    atualizar_perfil: p.atualizar_perfil && typeof p.atualizar_perfil === 'object' ? p.atualizar_perfil : {},
    precisa_handoff: !!p.precisa_handoff,
    motivo_handoff: typeof p.motivo_handoff === 'string' ? p.motivo_handoff : '',
    sugestao_aprendizado: p.sugestao_aprendizado && typeof p.sugestao_aprendizado === 'object' ? p.sugestao_aprendizado : null,
  }
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
const BUNDLE_SYSTEM = `Você é o agente comercial da empresa em WhatsApp.

Em UMA passada, você faz duas coisas:
1) Extrai dados úteis da última mensagem do lead (mesmo respostas parciais).
2) Decide a próxima mensagem do agente — natural, curta, com no máximo UMA pergunta principal.

Use o Contexto 2 (playbook) para decidir tom, perguntas, regras de orçamento, regras de reunião e gatilhos de handoff.

Regras:
- Não invente dados/preço/prazo/garantia.
- Não apague dados conhecidos com vazio/null.
- Não repita perguntas já respondidas no histórico.
- Faça UMA pergunta principal por mensagem (salvo combinações naturais).
- Se lead pedir preço sem escopo: peça O dado mais importante para faixa.
- Se faltar dado: peça o próximo mais importante (consulte dados_para_coletar).
- Se houver risco/pedido fora do contexto: precisa_handoff = true.
- sugestao_aprendizado só quando padrão claro (objeção nova, pergunta frequente, resposta que funcionou).

Retorne APENAS JSON neste schema:
{
  "extracao": {
    "intencao": "orcamento|reuniao|duvida|objecao|diagnostico|fechamento|vaga|outro",
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
}`

async function extrairEDecidirBundle({ pool, log, playbook, historico, mensagem, leadInsights, empresaId, conversaId, leadPhone, aiProvider }) {
  const provider = aiProvider || require('../ai-provider')
  const userPrompt = `PLAYBOOK ATIVO:
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
      systemPrompt: BUNDLE_SYSTEM,
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
  const decisao = {
    mensagem_pro_lead: typeof p.decisao?.mensagem_pro_lead === 'string' ? p.decisao.mensagem_pro_lead : '',
    etapa_proxima: typeof p.decisao?.etapa_proxima === 'string' ? p.decisao.etapa_proxima : '',
    atualizar_perfil: p.decisao?.atualizar_perfil && typeof p.decisao.atualizar_perfil === 'object' ? p.decisao.atualizar_perfil : {},
    precisa_handoff: !!p.decisao?.precisa_handoff,
    motivo_handoff: typeof p.decisao?.motivo_handoff === 'string' ? p.decisao.motivo_handoff : '',
    sugestao_aprendizado: p.decisao?.sugestao_aprendizado && typeof p.decisao.sugestao_aprendizado === 'object' ? p.decisao.sugestao_aprendizado : null,
  }
  return { extracao, decisao }
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

  const usarBundle = String(process.env.CONTEXT_PLAYBOOK_BUNDLE || 'true').toLowerCase() !== 'false'

  let extracao, decisao
  if (usarBundle) {
    const b = await extrairEDecidirBundle({
      pool, log, playbook, historico, mensagem, leadInsights,
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
      pool, log, playbook, historico, mensagem, leadInsights, extracao,
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

module.exports = {
  carregarPlaybookAtivo,
  extrairDadosDaMensagem,
  atualizarLeadInsights,
  decidirRespostaComPlaybook,
  extrairEDecidirBundle,
  talvezGerarSugestaoAprendizado,
  processarMensagemComPlaybook,
}
