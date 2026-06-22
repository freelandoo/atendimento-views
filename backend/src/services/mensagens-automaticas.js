'use strict'
// Mensagens automáticas POR contexto (mesmo molde dos estágios):
//   - "saudacoes"        -> saudações/handoff fixos do agente (primeiro contato, etc.)
//   - "gatilhos_agenda"  -> lembretes e remarcação de reunião
// Cada contexto guarda seus textos em app.empresa_contextos.{saudacoes_json,
// gatilhos_agenda_json}. O runtime lê o contexto ATIVO da empresa; se a chave
// estiver vazia, usa o DEFAULT (texto atual da PJ) com o nome da empresa injetado.
//
// Os defaults preservam exatamente o texto atual single-tenant — trocando só o
// nome literal por {empresa}. Assim a PJ não muda de comportamento e qualquer
// outra empresa já sai com o próprio nome, mesmo sem clicar em "Gerar".
//
// Placeholders suportados no render: {empresa} {nome} {hora} {data} {opcoes} {saudacao}

const { nomeEmpresa } = require('../db/empresas')

// ─── Catálogo de chaves + defaults ────────────────────────────────────────────
const SAUDACOES = [
  { chave: 'primeiro_contato', label: 'Primeiro contato (sem origem)',
    default: 'Oi! Tudo bem? Aqui é o assistente da {empresa} 👋' },
  { chave: 'primeiro_contato_anuncio', label: 'Primeiro contato (via anúncio)',
    default: 'Oi! Aqui é o assistente da {empresa}. Vi que você chegou pelo nosso anúncio 👋' },
  { chave: 'primeiro_contato_instagram', label: 'Primeiro contato (via Instagram)',
    default: 'Oi! Aqui é o assistente da {empresa}. Vi que você chegou pelo Instagram 👋' },
  { chave: 'primeiro_contato_indicacao', label: 'Primeiro contato (via indicação)',
    default: 'Oi! Aqui é o assistente da {empresa} 👋' },
  { chave: 'pedido_humano', label: 'Pedido de atendente humano / handoff',
    default: 'Claro. Vou chamar a equipe da {empresa} pra te ajudar diretamente por aqui.' },
  { chave: 'agenda_indisponivel', label: 'Agenda indisponível no momento',
    default: 'Não consegui consultar a agenda agora. Vou pedir para a equipe da {empresa} verificar os próximos horários e te chamar por aqui.' },
]

const GATILHOS_AGENDA = [
  { chave: 'lembrete_dia', label: 'Lembrete na manhã do dia da reunião',
    default: '{saudacao} Hoje às {hora} temos nossa conversa rápida com a equipe da {empresa}. Posso confirmar seu horário? Responde *sim* que já garanto. 🙌' },
  { chave: 'lembrete_agora', label: 'Lembrete na hora da reunião',
    default: '{saudacao} Nossa conversa rápida com a equipe da {empresa} é agora ({hora}). Já estou te aguardando por aqui!' },
  { chave: 'lembrete_15min', label: 'Lembrete 15 min antes',
    default: '{saudacao} Lembrete rápido: nossa reunião com a equipe da {empresa} está marcada para hoje às {hora}.\n\nA ideia é te mostrar a estrutura recomendada, prazo e investimento em até 15 minutos. Continua disponível nesse horário?' },
  { chave: 'remarcacao', label: 'Oferta de remarcação',
    default: 'Sem problema, a gente remarca. Tenho {data} às {opcoes} com a equipe da {empresa}. Qual desses horários fica melhor pra você?' },
  { chave: 'reuniao_confirmada', label: 'Confirmação de reunião marcada',
    default: 'Perfeito! Sua reunião está marcada para {data} às {hora} com a equipe da {empresa} — vai ser rápida, de até 15 minutos.' },
]

const GRUPOS = {
  saudacoes: { etapas: SAUDACOES, coluna: 'saudacoes_json' },
  gatilhos_agenda: { etapas: GATILHOS_AGENDA, coluna: 'gatilhos_agenda_json' },
}
const CHAVES_GRUPO = Object.keys(GRUPOS)

function _str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

function grupoValido(grupo) { return Object.prototype.hasOwnProperty.call(GRUPOS, grupo) }
function chavesDoGrupo(grupo) { return GRUPOS[grupo].etapas.map((e) => e.chave) }

/** Defaults do grupo (texto atual, com {empresa} no lugar do nome literal). */
function defaultsDoGrupo(grupo) {
  const out = {}
  for (const e of GRUPOS[grupo].etapas) out[e.chave] = e.default
  return out
}

/** Garante objeto só com as chaves conhecidas do grupo (strings). Descarta o resto. */
function normalizar(grupo, input) {
  const out = {}
  const src = input && typeof input === 'object' ? input : {}
  for (const chave of chavesDoGrupo(grupo)) out[chave] = _str(src[chave]).trim()
  return out
}

/** Mescla os textos salvos sobre os defaults — chave vazia herda o default. */
function mesclarComDefaults(grupo, salvos) {
  const base = defaultsDoGrupo(grupo)
  const norm = normalizar(grupo, salvos)
  const out = {}
  for (const chave of chavesDoGrupo(grupo)) out[chave] = norm[chave] || base[chave]
  return out
}

function grupoVazio(grupo, obj) {
  const norm = normalizar(grupo, obj)
  return chavesDoGrupo(grupo).every((c) => !norm[c])
}

// ─── Render (substituição de placeholders) ────────────────────────────────────
const PLACEHOLDERS = ['empresa', 'nome', 'hora', 'data', 'opcoes', 'saudacao']

function renderTemplate(template, values = {}) {
  let txt = _str(template)
  for (const ph of PLACEHOLDERS) {
    if (values[ph] == null) continue
    txt = txt.split(`{${ph}}`).join(_str(values[ph]))
  }
  // Remove placeholders não preenchidos para nunca vazar "{x}" ao lead.
  txt = txt.replace(/\s*\{(?:empresa|nome|hora|data|opcoes|saudacao)\}/g, '').replace(/\{(?:empresa|nome|hora|data|opcoes|saudacao)\}/g, '')
  return txt.replace(/[ \t]{2,}/g, ' ').trim()
}

// ─── Geração por IA (adapta os textos ao tom/negócio da empresa) ───────────────
const GERAR_SYSTEM = `Você recebe mensagens automáticas curtas de WhatsApp de um agente de vendas e o CONHECIMENTO de uma empresa.

Reescreva CADA mensagem adaptando ao tom e ao negócio descritos no conhecimento:
- MANTENHA o objetivo e o sentido de cada mensagem (saudação, handoff, lembrete de reunião, etc.).
- Mensagens curtas e naturais de WhatsApp, português brasileiro, sem markdown de cerca.
- OBRIGATÓRIO: preserve EXATAMENTE os placeholders entre chaves quando existirem na mensagem original: {empresa} {nome} {hora} {data} {opcoes} {saudacao}. NÃO os traduza, não os remova, não invente novos.
- NUNCA escreva o nome de nenhuma empresa diretamente — use sempre {empresa}.
- Não invente dados que não estejam no conhecimento.

Responda APENAS com um objeto JSON válido: { "<chave>": "<texto reescrito>", ... } exatamente com as mesmas chaves recebidas.`

async function gerarGrupo({ pool, log, aiProvider, empresaId, contextoId, grupo, conhecimento, base }) {
  if (!grupoValido(grupo)) throw new Error(`grupo inválido: ${grupo}`)
  const provider = aiProvider || require('../ai-provider')
  const origem = normalizar(grupo, base)
  // Se nada salvo, parte dos defaults.
  const partida = grupoVazio(grupo, origem) ? defaultsDoGrupo(grupo) : mesclarComDefaults(grupo, origem)
  const userPrompt =
    `CONHECIMENTO DA EMPRESA:\n${_str(conhecimento) || '(sem conhecimento — mantenha neutro e preserve os placeholders)'}\n\n` +
    `MENSAGENS A REESCREVER (JSON):\n${JSON.stringify(partida, null, 2)}\n\n` +
    `Reescreva cada uma adaptada a esta empresa, preservando os placeholders.`
  const result = await provider.generateAIResponse(
    {
      systemPrompt: GERAR_SYSTEM,
      userPrompt,
      task: 'gerarMensagensAutomaticas',
      maxTokens: Number(process.env.MENSAGENS_MAX_TOKENS) || 1500,
      timeoutMs: Number(process.env.MENSAGENS_TIMEOUT_MS) || 60000,
      responseFormatJson: true,
      empresaId, refType: 'contexto', refId: contextoId,
    },
    pool, log
  )
  let parsed = null
  try { parsed = JSON.parse(_str(result?.text)) } catch { parsed = null }
  // Mescla a saída da IA sobre a partida; chave faltante/ inválida mantém a partida.
  const out = {}
  for (const chave of chavesDoGrupo(grupo)) {
    const v = parsed && typeof parsed[chave] === 'string' ? parsed[chave].trim() : ''
    out[chave] = v || partida[chave]
  }
  return normalizar(grupo, out)
}

// ─── Persistência / leitura (app.empresa_contextos) ───────────────────────────
async function getContextoMensagens(pool, empresaId, contextoId) {
  const { rows: [ctx] } = await pool.query(
    `SELECT id, empresa_id, nome, conteudo, contexto_form_json, runtime_ativo,
            saudacoes_json, gatilhos_agenda_json
       FROM app.empresa_contextos WHERE id = $1 AND empresa_id = $2`,
    [contextoId, empresaId]
  )
  return ctx || null
}

async function salvarGrupo(pool, empresaId, contextoId, grupo, mensagens) {
  if (!grupoValido(grupo)) throw new Error(`grupo inválido: ${grupo}`)
  const coluna = GRUPOS[grupo].coluna
  const norm = normalizar(grupo, mensagens)
  const { rows: [ctx] } = await pool.query(
    `UPDATE app.empresa_contextos
        SET ${coluna} = $3::jsonb, atualizado_em = NOW()
      WHERE id = $1 AND empresa_id = $2
      RETURNING id, ${coluna} AS salvo`,
    [contextoId, empresaId, JSON.stringify(norm)]
  )
  return ctx ? normalizar(grupo, ctx.salvo) : null
}

// ─── Runtime: resolve UMA mensagem pronta para envio ──────────────────────────
// Lê o contexto runtime-ativo da empresa, escolhe o texto salvo (ou default) e
// renderiza com o nome da empresa + valores. Fail-open: qualquer erro cai no
// default renderizado, então o envio NUNCA quebra por causa disto.
const _ativoCache = new Map() // empresaId -> { data:{saudacoes,gatilhos_agenda}, at }
const ATIVO_TTL_MS = 30_000

async function _carregarAtivo(pool, empresaId) {
  const c = _ativoCache.get(empresaId)
  if (c && Date.now() - c.at < ATIVO_TTL_MS) return c.data
  let data = { saudacoes: {}, gatilhos_agenda: {} }
  try {
    if (empresaId) {
      const { rows: [ctx] } = await pool.query(
        `SELECT saudacoes_json, gatilhos_agenda_json
           FROM app.empresa_contextos
          WHERE empresa_id = $1 AND runtime_ativo = true LIMIT 1`,
        [empresaId]
      )
      if (ctx) data = { saudacoes: ctx.saudacoes_json || {}, gatilhos_agenda: ctx.gatilhos_agenda_json || {} }
    }
  } catch { /* fail-open: usa defaults */ }
  _ativoCache.set(empresaId || '_null_', { data, at: Date.now() })
  return data
}

function invalidarCacheAtivo(empresaId) {
  if (empresaId) _ativoCache.delete(empresaId)
  else _ativoCache.clear()
}

/**
 * Resolve a mensagem final pronta para envio.
 * @returns {Promise<string>} texto renderizado (placeholders substituídos).
 */
async function resolverMensagem(pool, { empresaId = null, grupo, chave, values = {}, log = null } = {}) {
  try {
    if (!grupoValido(grupo) || !chavesDoGrupo(grupo).includes(chave)) {
      throw new Error(`grupo/chave inválido: ${grupo}/${chave}`)
    }
    const ativo = await _carregarAtivo(pool, empresaId)
    const salvos = normalizar(grupo, ativo[grupo])
    const template = salvos[chave] || defaultsDoGrupo(grupo)[chave]
    const empresa = values.empresa != null ? values.empresa : await nomeEmpresa(empresaId)
    return renderTemplate(template, { ...values, empresa })
  } catch (e) {
    if (log && typeof log.warn === 'function') log.warn({ err: e.message, grupo, chave }, 'resolverMensagem caiu no default')
    const empresa = values.empresa != null ? values.empresa : (process.env.EMPRESA_NOME_PADRAO || 'nossa empresa')
    const def = (GRUPOS[grupo] && defaultsDoGrupo(grupo)[chave]) || ''
    return renderTemplate(def, { ...values, empresa })
  }
}

module.exports = {
  GRUPOS,
  CHAVES_GRUPO,
  SAUDACOES,
  GATILHOS_AGENDA,
  grupoValido,
  chavesDoGrupo,
  defaultsDoGrupo,
  normalizar,
  mesclarComDefaults,
  grupoVazio,
  renderTemplate,
  gerarGrupo,
  getContextoMensagens,
  salvarGrupo,
  resolverMensagem,
  invalidarCacheAtivo,
}
