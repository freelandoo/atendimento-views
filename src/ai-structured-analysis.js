'use strict'

/**
 * ATIVIDADE A: Respostas Estruturadas em JSON
 *
 * Sistema que faz Claude retornar análises estruturadas em JSON
 * ao invés de respostas livres de template.
 *
 * Fluxo:
 * 1. Claude analisa mensagem + contexto completo
 * 2. Retorna JSON com: análise, decisões, restrições, resposta final
 * 3. Sistema valida guardrails inteligentes
 * 4. Armazena análise para aprendizado
 */

const { logger } = require('./logger')

// ─── SCHEMA JSON ───────────────────────────────────────────────────────────

const SCHEMA_ANALISE_ESTRUTURADA = {
  // Análise do contexto
  analise: {
    intencao: 'string (pergunta_preco|expressa_necessidade|pede_horario|etc)',
    sentimento: 'string (positivo|neutro|negativo|investigativo)',
    confianca_analise: 'number (0-100)',
    dados_extraidos: {
      tipo_projeto: 'string (site|sistema|ecommerce|etc) ou null',
      necessidade_principal: 'string ou null',
      orçamento_mencionado: 'number ou null',
      localização: 'string ou null',
      empresa_nicho: 'string ou null'
    },
    estágio_recomendado: 'string (primeiro_contato|diagnostico|proposta|fechamento)',
    bloqueios_detectados: 'array de strings (vazio se nenhum)'
  },

  // Decisões que Claude toma
  decisoes: {
    ação_principal: 'string (aprofundar_dor|oferecer_preco|agendar|etc)',
    tom_resposta: 'string (consultivo|acolhedor|urgente|investigativo)',
    inclui_oferta_horario: 'boolean',
    coleta_dados: 'array de strings (dados que faltam coletar)',
    recomendação_handoff: 'boolean',
    motivo_handoff: 'string ou null'
  },

  // Restrições que devem ser obedecidas
  restricoes: {
    palavras_proibidas: 'array de strings (victor|etc)',
    termos_internos: 'array de strings (funil|lead quente|etc)',
    promessas_proibidas: 'array de strings (primeiro lugar google|etc)',
    contexto_obedecido: 'boolean (resposta respeita contexto?)'
  },

  // Resposta final em português natural
  resposta: 'string (a mensagem real que será enviada ao lead)',

  // Metadados para log/aprendizado
  metadata: {
    versao_schema: '1.0',
    tempo_analise_ms: 'number',
    confianca_resposta: 'number (0-100)',
    validação_interna: 'string (ok|warning|error)'
  }
}

// ─── MODIFICADOR DE PROMPT ────────────────────────────────────────────────

/**
 * Cria um sistema de prompt que força Claude a responder
 * com JSON estruturado de análise
 *
 * @param {string} basePrompt - Prompt base original
 * @returns {string} - Prompt modificado para retornar JSON estruturado
 */
function criarPromptComAnaliseEstruturada(basePrompt) {
  return `${basePrompt}

---

IMPORTANTE: Voce DEVE responder SEMPRE em JSON valido (sem markdown ou texto solto).
Estrutura obrigatoria:

{
  "analise": {
    "intencao": "string descrevendo a intencao do lead",
    "sentimento": "positivo|neutro|negativo|investigativo",
    "confianca_analise": 0-100,
    "dados_extraidos": {
      "tipo_projeto": null ou string,
      "necessidade_principal": null ou string,
      "orçamento_mencionado": null ou numero,
      "localização": null ou string,
      "empresa_nicho": null ou string
    },
    "estágio_recomendado": "primeiro_contato|diagnostico|proposta|fechamento",
    "bloqueios_detectados": []
  },
  "decisoes": {
    "ação_principal": "string descrevendo melhor acao neste momento",
    "tom_resposta": "consultivo|acolhedor|urgente|investigativo",
    "inclui_oferta_horario": boolean,
    "coleta_dados": ["campo1", "campo2"] ou [],
    "recomendação_handoff": boolean,
    "motivo_handoff": null ou string
  },
  "restricoes": {
    "palavras_proibidas": ["victor"] (adicione mais se necessario),
    "termos_internos": ["funil", "lead quente"] (adicione mais se necessario),
    "promessas_proibidas": [],
    "contexto_obedecido": true
  },
  "resposta": "Sua mensagem em português natural aqui. Seja natural, consultivo e contextual.",
  "metadata": {
    "versao_schema": "1.0",
    "tempo_analise_ms": 0,
    "confianca_resposta": 0-100,
    "validação_interna": "ok"
  }
}

Instrucoes:
1. Analise TUDO: mensagem do lead, historico, perfil, estagio
2. PENSE antes de responder — qual é a melhor acao agora?
3. Responda SÓ em JSON, sem texto extra
4. Campo "resposta" deve ser natural em portugues — nada de template
5. Se vai fazer handoff, explique o motivo
6. Sempre defina "confianca_resposta" baseado em quao certo voce está`
}

// ─── VALIDADOR DE SCHEMA ───────────────────────────────────────────────────

/**
 * Valida se resposta JSON do Claude segue o schema esperado
 *
 * @param {any} resposta - JSON parseado do Claude
 * @param {object} contexto - Contexto do lead (stage, perfil, etc)
 * @returns {object} - { valido: boolean, erros: array, avisos: array, resultado: object }
 */
function validarSchemaAnaliseEstruturada(resposta, contexto = {}) {
  const erros = []
  const avisos = []

  if (!resposta || typeof resposta !== 'object') {
    erros.push('Resposta não é um objeto JSON válido')
    return { valido: false, erros, avisos, resultado: null }
  }

  // Validar campos obrigatórios
  const camposObrigatorios = {
    'analise': 'object',
    'analise.intencao': 'string',
    'analise.sentimento': 'string',
    'analise.confianca_analise': 'number',
    'decisoes': 'object',
    'decisoes.ação_principal': 'string',
    'decisoes.tom_resposta': 'string',
    'decisoes.inclui_oferta_horario': 'boolean',
    'restricoes': 'object',
    'restricoes.contexto_obedecido': 'boolean',
    'resposta': 'string',
    'metadata': 'object'
  }

  for (const [campo, tipo] of Object.entries(camposObrigatorios)) {
    const valor = obterValorAninhado(resposta, campo)
    if (valor === undefined) {
      erros.push(`Campo obrigatório ausente: ${campo}`)
    } else if (typeof valor !== tipo) {
      erros.push(`Campo ${campo} tem tipo ${typeof valor}, esperado ${tipo}`)
    }
  }

  // Validações semânticas
  if (resposta.analise?.sentimento && !['positivo', 'neutro', 'negativo', 'investigativo'].includes(resposta.analise.sentimento)) {
    avisos.push(`Sentimento incomum: ${resposta.analise.sentimento}`)
  }

  if (resposta.decisoes?.inclui_oferta_horario && contexto.stage === 'primeiro_contato') {
    avisos.push('Oferecendo horário em primeiro contato (incomum)')
  }

  if (resposta.decisoes?.recomendação_handoff && !resposta.decisoes?.motivo_handoff) {
    erros.push('Handoff recomendado mas sem motivo')
  }

  // Validar resposta não contém palavras proibidas
  const resposta_texto = (resposta.resposta || '').toLowerCase()
  const palavrasProibidas = resposta.restricoes?.palavras_proibidas || ['victor']
  for (const palavra of palavrasProibidas) {
    if (resposta_texto.includes(palavra.toLowerCase())) {
      erros.push(`Resposta contém palavra proibida: "${palavra}"`)
    }
  }

  return {
    valido: erros.length === 0,
    erros,
    avisos,
    resultado: erros.length === 0 ? resposta : null
  }
}

// ─── HELPER: Obter valor em objeto aninhado ────────────────────────────────

function obterValorAninhado(obj, caminho) {
  return caminho.split('.').reduce((acc, parte) => acc?.[parte], obj)
}

// ─── ARMAZENAR ANÁLISE ─────────────────────────────────────────────────────

/**
 * Registra análise estruturada no banco para aprendizado
 *
 * @param {object} pool - Pool de banco de dados
 * @param {string} numero - Número do lead
 * @param {string} mensagem_lead - Mensagem original
 * @param {object} analise - JSON com análise estruturada
 * @param {object} resposta_final - Resultado da validação
 */
async function armazenarAnaliseEstruturada(pool, numero, mensagem_lead, analise, resposta_final) {
  try {
    await pool.query(`
      INSERT INTO vendas.ai_analise_estruturada (
        numero,
        mensagem_lead,
        analise_json,
        decisoes_json,
        restricoes_json,
        resposta_enviada,
        confianca_analise,
        confianca_resposta,
        criado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (numero, criado_em) DO NOTHING
    `, [
      numero,
      mensagem_lead.substring(0, 500), // Limitar tamanho
      JSON.stringify(analise.analise),
      JSON.stringify(analise.decisoes),
      JSON.stringify(analise.restricoes),
      analise.resposta,
      analise.analise?.confianca_analise || 0,
      analise.metadata?.confianca_resposta || 0
    ])
  } catch (err) {
    // Log mas não bloqueia o fluxo
    logger.warn({ err: err.message }, '[armazenar-analise]')
  }
}

// ─── EXTRAIR RESPOSTA FINAL ────────────────────────────────────────────────

/**
 * Extrai apenas a resposta final (texto enviável) do JSON estruturado
 *
 * @param {object} analiseEstruturada - JSON completo de análise
 * @returns {string} - Apenas o texto da resposta
 */
function extrairRespostaFinal(analiseEstruturada) {
  if (!analiseEstruturada || typeof analiseEstruturada.resposta !== 'string') {
    return '[Sem resposta disponível]'
  }
  return analiseEstruturada.resposta.trim()
}

// ─── EXPORTAR ──────────────────────────────────────────────────────────────

module.exports = {
  SCHEMA_ANALISE_ESTRUTURADA,
  criarPromptComAnaliseEstruturada,
  validarSchemaAnaliseEstruturada,
  armazenarAnaliseEstruturada,
  extrairRespostaFinal,
  obterValorAninhado,
}
