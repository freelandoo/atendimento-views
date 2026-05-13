'use strict'

const { parsearRespostaJsonClaude } = require('../string-utils')

// Cache TTL: 60s por empresa_id (apenas para getContextoAtivoEmpresa)
const _cache = new Map()
const CACHE_TTL_MS = 60_000

function _cacheGet(empresaId) {
  const entry = _cache.get(empresaId)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    _cache.delete(empresaId)
    return undefined
  }
  return entry.value
}

function _cacheSet(empresaId, value) {
  _cache.set(empresaId, { value, at: Date.now() })
}

function invalidarCacheEmpresa(empresaId) {
  if (empresaId) _cache.delete(empresaId)
  else _cache.clear()
}

// ─── Schema do Contexto 1 (form) ──────────────────────────────────────────────
const CONTEXTO1_CAMPOS = [
  'nome_empresa', 'tipo_negocio', 'nicho', 'cidade_regiao',
  'servicos_produtos', 'precos_planos', 'publico_alvo', 'cliente_ideal',
  'diferenciais', 'problemas_que_resolve', 'tom_de_voz', 'horario_atendimento',
  'formas_pagamento', 'objeções_comuns', 'perguntas_frequentes',
  'quando_chamar_humano', 'links_uteis', 'informacoes_extras',
]

function normalizarContexto1(input) {
  const form = {}
  for (const c of CONTEXTO1_CAMPOS) form[c] = String((input && input[c]) || '').trim()
  const linhas = CONTEXTO1_CAMPOS
    .filter((c) => form[c])
    .map((c) => `${c.replace(/_/g, ' ').toUpperCase()}: ${form[c]}`)
  return {
    contexto_form_json: form,
    contexto_bruto: linhas.join('\n'),
  }
}

// ─── Schema do Contexto 2 Playbook ────────────────────────────────────────────
const PLAYBOOK_SCHEMA_VERSION = 'contexto2.playbook.v1'

function _esqueletoPlaybook() {
  return {
    schema_version: PLAYBOOK_SCHEMA_VERSION,
    resumo_empresa: {
      nome: '', nicho: '', cidade_regiao: '',
      descricao_curta: '', promessa_comercial: '', posicionamento: '',
    },
    tom_de_voz: {
      estilo: '', formalidade: '', ritmo: '',
      palavras_recomendadas: [], palavras_evitar: [], regras_de_linguagem: [],
    },
    servicos: [],
    dados_para_coletar: [],
    fluxo_atendimento: [],
    respostas_base: [],
    regras_orcamento: {
      dados_minimos_para_orcamento: [],
      pode_falar_preco_quando: [],
      nao_falar_preco_quando: [],
      respostas_para_pergunta_de_preco: [],
      como_lidar_com_orcamento_baixo: [],
      quando_chamar_humano: [],
    },
    regras_reuniao: {
      oferecer_reuniao_quando: [],
      nao_oferecer_reuniao_quando: [],
      mensagens_base: [],
    },
    objecoes: [],
    lead_scoring: { quente: [], morno: [], frio: [] },
    runtime_policy: {
      regra_principal: 'Nunca seguir roteiro fixo. Sempre extrair dados da resposta do lead, atualizar memória, identificar campos faltantes e escolher a próxima melhor pergunta.',
      fazer_uma_pergunta_por_vez: true,
      nao_repetir_pergunta_respondida: true,
      como_lidar_com_respostas_incompletas: [],
      como_evitar_repeticao: [],
      como_decidir_proxima_pergunta: [],
      como_aproveitar_dados_parciais: [],
    },
    aprendizado_continuo: {
      o_que_registrar: [],
      como_sugerir_melhoria: [],
      nao_alterar_contexto_ativo_sem_aprovacao: true,
    },
    limites_da_ia: {
      nao_prometer: [], nao_inventar: [], nao_fazer: [], chamar_humano_quando: [],
    },
    handoff: { gatilhos: [], mensagem_para_lead: '', mensagem_para_operador: '' },
  }
}

/**
 * Garante todas as seções obrigatórias. Mescla recursivamente o JSON da IA sobre
 * o esqueleto padrão. Se a IA esquecer algo, fica o default seguro.
 */
function validarContexto2Playbook(json) {
  const esq = _esqueletoPlaybook()
  if (!json || typeof json !== 'object') return esq
  const merged = JSON.parse(JSON.stringify(esq))
  for (const k of Object.keys(esq)) {
    if (json[k] === undefined || json[k] === null) continue
    if (Array.isArray(esq[k])) {
      merged[k] = Array.isArray(json[k]) ? json[k] : esq[k]
    } else if (typeof esq[k] === 'object') {
      merged[k] = { ...esq[k], ...(typeof json[k] === 'object' ? json[k] : {}) }
    } else {
      merged[k] = json[k]
    }
  }
  merged.schema_version = PLAYBOOK_SCHEMA_VERSION
  return merged
}

// ─── Prompt para gerar Contexto 2 Playbook ────────────────────────────────────
function gerarPromptContexto2({ empresa, contexto1 }) {
  const empresaJson = JSON.stringify({
    id: empresa?.id, nome: empresa?.nome, slug: empresa?.slug, plano: empresa?.plano,
  })
  const contexto1Json = typeof contexto1 === 'string'
    ? contexto1
    : JSON.stringify(contexto1, null, 2)

  const systemPrompt = `Você é um estrategista comercial especialista em vendas consultivas, WhatsApp, qualificação de leads e agentes de IA.

Sua tarefa é transformar o CONTEXTO 1 de uma empresa em um CONTEXTO 2, que será usado como playbook operacional de atendimento por IA.

O Contexto 2 não é um texto institucional.
O Contexto 2 é o manual de venda da IA.

Ele deve ensinar o agente a abrir conversa, entender o que o lead quer, coletar dados, interpretar respostas incompletas, não repetir perguntas, responder dúvidas, lidar com orçamento, saber quando falar preço, saber quando não falar preço, oferecer reunião, responder objeções, classificar lead como quente/morno/frio, chamar humano quando necessário, registrar aprendizados como sugestões pendentes.

Regras de geração:
- Não invente dados específicos que não estejam no Contexto 1.
- Se preço não foi informado, crie regra segura dizendo que preço depende do escopo.
- Crie perguntas curtas, naturais e boas para WhatsApp.
- Crie respostas-base como referência, não frases obrigatórias.
- O agente faz uma pergunta por vez (salvo quando duas informações simples são naturalmente ligadas).
- O agente sempre aproveita respostas parciais.
- O agente nunca repete pergunta que o lead já respondeu.
- Aprendizados viram sugestões pendentes, nunca alteração automática do contexto ativo.

Crie pelo menos: 8 dados_para_coletar, 8 fluxo_atendimento etapas, 15 respostas_base, 8 objecoes, 5 itens em cada lista de regras_orcamento, 5 em regras_reuniao, 5 handoff.gatilhos.

Retorne APENAS JSON válido (sem markdown, sem texto extra) com o formato:
{
  "markdown": "texto completo em markdown para o usuário editar",
  "json": {
    "schema_version": "contexto2.playbook.v1",
    "resumo_empresa": {...},
    "tom_de_voz": {...},
    "servicos": [...],
    "dados_para_coletar": [...],
    "fluxo_atendimento": [...],
    "respostas_base": [...],
    "regras_orcamento": {...},
    "regras_reuniao": {...},
    "objecoes": [...],
    "lead_scoring": {...},
    "runtime_policy": {...},
    "aprendizado_continuo": {...},
    "limites_da_ia": {...},
    "handoff": {...}
  }
}`

  const userPrompt = `EMPRESA:
${empresaJson}

CONTEXTO 1:
${contexto1Json}

Gere o Contexto 2 Playbook em JSON conforme as regras.`

  return { systemPrompt, userPrompt }
}

/**
 * Gera o Contexto 2 Playbook chamando IA e salva como nova versão (rascunho).
 * Retorna { versao_id, markdown, json }.
 */
async function gerarContexto2Playbook({ pool, log, empresaId, contextoId, userId, aiProvider }) {
  if (!pool || !empresaId || !contextoId) {
    throw new Error('gerarContexto2Playbook: pool, empresaId, contextoId obrigatórios')
  }

  const { rows: [empresa] } = await pool.query(
    'SELECT id, nome, slug, plano FROM app.empresas WHERE id = $1',
    [empresaId]
  )
  if (!empresa) throw new Error('Empresa não encontrada')

  const { rows: [ctx] } = await pool.query(
    'SELECT id, nome, conteudo, contexto_form_json FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2',
    [contextoId, empresaId]
  )
  if (!ctx) throw new Error('Contexto 1 não encontrado')

  const formJson = ctx.contexto_form_json && Object.keys(ctx.contexto_form_json).length > 0
    ? ctx.contexto_form_json
    : null
  const contexto1 = formJson || ctx.conteudo || ''
  if (!contexto1 || (typeof contexto1 === 'string' && contexto1.trim().length < 20)) {
    throw new Error('Contexto 1 muito curto para gerar playbook')
  }

  const { systemPrompt, userPrompt } = gerarPromptContexto2({ empresa, contexto1 })

  const provider = aiProvider || require('../ai-provider')
  const result = await provider.generateAIResponse(
    {
      systemPrompt, userPrompt,
      task: 'generateContextPlaybook',
      maxTokens: Number(process.env.CONTEXT_PLAYBOOK_MAX_TOKENS) || 6000,
      timeoutMs: Number(process.env.CONTEXT_PLAYBOOK_TIMEOUT_MS) || 60000,
      empresaId, refType: 'contexto', refId: contextoId,
      ...(process.env.CONTEXT_PLAYBOOK_MODEL ? { model: process.env.CONTEXT_PLAYBOOK_MODEL } : {}),
    },
    pool, log
  )

  let parsed
  try {
    parsed = parsearRespostaJsonClaude(result.text) || {}
  } catch (_) { parsed = {} }

  const markdown = typeof parsed.markdown === 'string' && parsed.markdown.trim()
    ? parsed.markdown
    : ''
  const jsonValidado = validarContexto2Playbook(parsed.json || {})

  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(versao), 0)::int AS max_versao FROM app.empresa_contexto_versoes WHERE contexto_id = $1',
    [contextoId]
  )
  const versao = (last?.max_versao || 0) + 1

  const { rows: [v] } = await pool.query(
    `INSERT INTO app.empresa_contexto_versoes
      (contexto_id, empresa_id, versao, conteudo_json, conteudo_markdown,
       gerado_por, status, playbook_schema_version)
     VALUES ($1, $2, $3, $4, $5, 'ia', 'rascunho', $6)
     RETURNING *`,
    [contextoId, empresaId, versao, JSON.stringify(jsonValidado), markdown, PLAYBOOK_SCHEMA_VERSION]
  )

  invalidarCacheEmpresa(empresaId)
  return { versao: v, json: jsonValidado, markdown }
}

/**
 * Ativa uma versão e arquiva todas as outras do mesmo contexto.
 */
async function ativarContexto2({ pool, empresaId, versaoId, userId }) {
  if (!pool || !empresaId || !versaoId) throw new Error('ativarContexto2: parâmetros obrigatórios')

  const { rows: [v] } = await pool.query(
    `SELECT id, contexto_id FROM app.empresa_contexto_versoes WHERE id = $1 AND empresa_id = $2`,
    [versaoId, empresaId]
  )
  if (!v) throw new Error('Versão não encontrada')

  await pool.query(
    `UPDATE app.empresa_contexto_versoes
       SET status = 'arquivado'
     WHERE contexto_id = $1 AND status = 'ativo' AND id <> $2`,
    [v.contexto_id, versaoId]
  )
  const { rows: [ativada] } = await pool.query(
    `UPDATE app.empresa_contexto_versoes
       SET status = 'ativo',
           ativado_em = NOW(),
           aprovado_por = $2,
           aprovado_em = NOW()
     WHERE id = $1
     RETURNING *`,
    [versaoId, userId || null]
  )
  invalidarCacheEmpresa(empresaId)
  return ativada
}

/**
 * Busca a versão ativa do Contexto 2 para uma empresa.
 * Retorna { json, markdown, versao_id, ativado_em } ou null.
 */
async function buscarContexto2Ativo(pool, empresaId) {
  if (!empresaId) return null
  const { rows } = await pool.query(
    `SELECT id, conteudo_json, conteudo_markdown, ativado_em
       FROM app.empresa_contexto_versoes
      WHERE empresa_id = $1 AND status = 'ativo'
      ORDER BY ativado_em DESC NULLS LAST
      LIMIT 1`,
    [empresaId]
  )
  if (!rows.length) return null
  return {
    versao_id: rows[0].id,
    json: rows[0].conteudo_json,
    markdown: rows[0].conteudo_markdown || '',
    ativado_em: rows[0].ativado_em,
  }
}

/**
 * LEGADO: mantém assinatura antiga (retorna só json) para compatibilidade com
 * agente atual. Usa cache.
 */
async function getContextoAtivoEmpresa(pool, empresaId) {
  if (!empresaId) return null
  const cached = _cacheGet(empresaId)
  if (cached !== undefined) return cached
  const ativo = await buscarContexto2Ativo(pool, empresaId)
  const result = ativo ? ativo.json : null
  _cacheSet(empresaId, result)
  return result
}

/**
 * Registra uma sugestão de aprendizado pendente.
 * NUNCA altera o contexto ativo automaticamente.
 */
async function registrarSugestaoAprendizadoContexto({
  pool, empresaId, contextoVersaoId, conversaId, leadPhone,
  tipo, evidencia, sugestaoJson, sugestaoMarkdown, confianca, impactoComercial,
}) {
  if (!pool || !empresaId || !tipo || !evidencia) return null
  const conf = ['baixa', 'media', 'alta'].includes(confianca) ? confianca : 'media'
  const { rows: [s] } = await pool.query(
    `INSERT INTO app.empresa_contexto_sugestoes
      (empresa_id, contexto_versao_id, conversa_id, lead_phone, tipo, evidencia,
       impacto_comercial, sugestao_json, sugestao_markdown, confianca, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pendente')
     RETURNING *`,
    [
      empresaId, contextoVersaoId || null, conversaId || null, leadPhone || null,
      tipo, evidencia, impactoComercial || null,
      JSON.stringify(sugestaoJson || {}), sugestaoMarkdown || null, conf,
    ]
  )
  return s
}

// ─── Formatação para prompt ──────────────────────────────────────────────────
function _formatarValor(val, indent) {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    return val
      .map((item) => `${indent}- ${_formatarValor(item, indent + '  ')}`)
      .join('\n')
  }
  if (typeof val === 'object') {
    return Object.entries(val)
      .map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        const formatted = _formatarValor(v, indent + '  ')
        if (!formatted) return null
        return Array.isArray(v) || (typeof v === 'object' && v !== null)
          ? `${indent}${label}:\n${formatted}`
          : `${indent}${label}: ${formatted}`
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function formatarContexto2ParaPrompt(json) {
  if (!json || typeof json !== 'object' || Object.keys(json).length === 0) return null
  const corpo = _formatarValor(json, '')
  if (!corpo.trim()) return null
  return `===== CONTEXTO DA EMPRESA (Contexto 2 — playbook operacional) =====\n\n${corpo.trim()}\n`
}

module.exports = {
  CONTEXTO1_CAMPOS,
  PLAYBOOK_SCHEMA_VERSION,
  normalizarContexto1,
  validarContexto2Playbook,
  gerarPromptContexto2,
  gerarContexto2Playbook,
  ativarContexto2,
  buscarContexto2Ativo,
  getContextoAtivoEmpresa,
  registrarSugestaoAprendizadoContexto,
  formatarContexto2ParaPrompt,
  invalidarCacheEmpresa,
}
