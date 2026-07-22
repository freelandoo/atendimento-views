'use strict'

const { generateAIResponse } = require('../ai-provider')
const { parsearRespostaJsonClaude } = require('../string-utils')
const { buscarContexto2Ativo } = require('./contexto-empresa')
const { calcularScoreInteresseLead } = require('./lead-interest-score')
const { validarNumeroConversa, validarTextoMensagem } = require('./conversa-manual')
const { logger } = require('../logger')

const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'
const HISTORICO_MAX = 18
const PLAYBOOK_MAX_CHARS = 7000

function erroOperacao(message, statusCode = 400, code = 'BAD_REQUEST') {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  return err
}

function normalizarHistorico(historico) {
  if (Array.isArray(historico)) return historico
  if (typeof historico === 'string') {
    try {
      const parsed = JSON.parse(historico)
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }
  return []
}

function textoMensagem(m) {
  return String(m?.content || m?.text || '').trim()
}

function formatarHistorico(historico) {
  return normalizarHistorico(historico)
    .slice(-HISTORICO_MAX)
    .map((m) => {
      const role = m.role === 'user' ? 'cliente' : m.role === 'assistant' ? 'agente' : m.role === 'operator' ? 'operador' : (m.role || 'sistema')
      return `${role}: ${textoMensagem(m).slice(0, 1200)}`
    })
    .filter((l) => !/:\s*$/.test(l))
    .join('\n')
}

function compactarJson(value, max = PLAYBOOK_MAX_CHARS) {
  if (!value) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > max ? `${text.slice(0, max)}\n...(recortado)` : text
}

async function buscarConversaParaOrientador(pool, empresaId, numero) {
  const { rows } = await pool.query(
    `SELECT c.numero, c.empresa_id, c.historico, c.estagio, c.status, c.agente_pausado,
            c.evolution_instance, c.atualizado_em,
            lp.negocio, lp.cidade, lp.temperatura_lead, lp.score_lead,
            lp.dor_principal, lp.produto_sugerido, lp.intencao_principal,
            lp.insights_lead, lp.reuniao_proposta
       FROM vendas.conversas c
       LEFT JOIN LATERAL (
         SELECT lp.*
           FROM vendas.lead_profiles lp
          WHERE lp.numero = c.numero
            AND (lp.empresa_id = c.empresa_id OR lp.empresa_id IS NULL)
          ORDER BY CASE WHEN lp.empresa_id = c.empresa_id THEN 0 ELSE 1 END,
                   lp.atualizado_em DESC NULLS LAST
          LIMIT 1
       ) lp ON true
      WHERE (c.empresa_id = $1 OR ($1::uuid = $2::uuid AND c.empresa_id IS NULL))
        AND c.numero = $3
      LIMIT 1`,
    [empresaId, PJ_EMPRESA_ID, numero]
  )
  return rows[0] || null
}

function normalizarOrientacao(raw) {
  const parsed = parsearRespostaJsonClaude(String(raw || '')) || {}
  const resposta = String(parsed.resposta || parsed.mensagem || parsed.mensagem_sugerida || '').trim()
  const explicacao = String(parsed.explicacao || parsed.porque || parsed.justificativa || '').trim()
  const confiancaRaw = String(parsed.confianca || 'media').trim().toLowerCase()
  const confianca = ['alta', 'media', 'baixa'].includes(confiancaRaw) ? confiancaRaw : 'media'
  const alertas = Array.isArray(parsed.alertas)
    ? parsed.alertas.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4)
    : []
  if (!resposta) throw erroOperacao('A IA nao retornou uma resposta sugerida. Tente novamente.', 502, 'AI_EMPTY_RESPONSE')
  return {
    resposta: validarTextoMensagem(resposta, 1200),
    explicacao: explicacao.slice(0, 700) || 'Resposta sugerida a partir do historico recente e do contexto comercial da empresa.',
    confianca,
    alertas,
  }
}

function montarPrompt({ conversa, historico, playbook, rascunho }) {
  const interesse = calcularScoreInteresseLead(conversa, {
    historico,
    estagio: conversa.estagio,
    atualizadoEm: conversa.atualizado_em,
  })
  const lead = {
    numero: conversa.numero,
    estagio: conversa.estagio,
    status: conversa.status,
    agente_pausado: conversa.agente_pausado === true,
    negocio: conversa.negocio || null,
    cidade: conversa.cidade || null,
    temperatura_lead: conversa.temperatura_lead || null,
    score_lead: conversa.score_lead ?? null,
    dor_principal: conversa.dor_principal || null,
    produto_sugerido: conversa.produto_sugerido || null,
    intencao_principal: conversa.intencao_principal || null,
    score_interesse: interesse.score,
    score_interesse_label: interesse.label,
    score_interesse_resumo: interesse.resumo,
    score_interesse_criterios: interesse.criterios,
  }

  return `DADOS DO LEAD E DA CONVERSA:
${JSON.stringify(lead, null, 2)}

CONTEXTO/PLAYBOOK ATIVO DA EMPRESA:
${compactarJson(playbook || null) || '(sem playbook ativo; use apenas o historico e nao invente dados da empresa)'}

HISTORICO RECENTE:
${formatarHistorico(historico) || '(sem historico recente)'}

RASCUNHO ATUAL DO OPERADOR, SE HOUVER:
${rascunho ? rascunho.slice(0, 1000) : '(vazio)'}

Gere uma resposta para o operador revisar e enviar manualmente.`
}

const SYSTEM_PROMPT = `Voce e um orientador de respostas para operadores humanos em WhatsApp comercial.
Sua tarefa e sugerir UMA resposta ao cliente e explicar ao operador por que ela e boa.

Regras:
- Nao envie nada. Voce so orienta o operador.
- A resposta sugerida deve ser escrita como mensagem para o cliente, em PT-BR, natural e editavel.
- Use o historico, sinais comerciais do lead e contexto/playbook da empresa.
- Responda diretamente quando o cliente fez uma pergunta direta.
- Nao invente preco, prazo, link, promessa, desconto, agenda ou dado da empresa que nao esteja no contexto.
- Se faltar contexto, faca uma pergunta curta ao cliente em vez de afirmar.
- Explicacao e para o operador, simples e curta, sem termos tecnicos.
- Maximo de 2 bolhas curtas na resposta. Evite texto longo.

Retorne APENAS JSON valido neste formato:
{"explicacao":"por que essa resposta faz sentido","resposta":"mensagem editavel para o cliente","confianca":"alta|media|baixa","alertas":[]}`

async function gerarOrientacaoResposta({
  pool,
  log = logger,
  empresaId,
  numero,
  rascunho = '',
  _generate = generateAIResponse,
  _buscarContexto2Ativo = buscarContexto2Ativo,
}) {
  if (!pool) throw erroOperacao('pool obrigatorio.', 500, 'INTERNAL_ERROR')
  if (!empresaId) throw erroOperacao('empresaId obrigatorio.', 500, 'INTERNAL_ERROR')
  const numeroValidado = validarNumeroConversa(numero)
  const rascunhoValidado = rascunho ? validarTextoMensagem(rascunho, 1200) : ''

  const conversa = await buscarConversaParaOrientador(pool, empresaId, numeroValidado)
  if (!conversa) throw erroOperacao('Conversa nao encontrada para esta empresa.', 404, 'NOT_FOUND')

  const historico = normalizarHistorico(conversa.historico)
  const contextoAtivo = await _buscarContexto2Ativo(pool, empresaId, conversa.evolution_instance || null).catch((err) => {
    if (log?.warn) log.warn({ err: err.message }, '[orientador-resposta] contexto ativo indisponivel')
    return null
  })
  const playbook = contextoAtivo?.json || contextoAtivo || null

  const result = await _generate({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: montarPrompt({ conversa, historico, playbook, rascunho: rascunhoValidado }),
    task: 'orientador_resposta',
    maxTokens: 700,
    timeoutMs: 30000,
    responseFormatJson: true,
    empresaId,
    ref_type: 'conversa',
    ref_id: numeroValidado,
    client_numero: numeroValidado,
  }, pool, log)

  const orientacao = normalizarOrientacao(result?.text)
  return {
    ...orientacao,
    numero: conversa.numero,
    contexto_usado: {
      historico_mensagens: historico.length,
      playbook: !!playbook,
      score_interesse: calcularScoreInteresseLead(conversa, { historico, estagio: conversa.estagio, atualizadoEm: conversa.atualizado_em }).score,
    },
  }
}

module.exports = {
  gerarOrientacaoResposta,
  normalizarOrientacao,
  _internals: { buscarConversaParaOrientador, montarPrompt, formatarHistorico },
}
