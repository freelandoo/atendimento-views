'use strict'
// "Rodar leads" — disparo manual da saudação (primeira mensagem) a partir do Banco
// de Leads, por uma instância WhatsApp escolhida. Throttle conservador anti-ban:
//   - lote de até RODAR_LEADS_MAX_LOTE por rodada (default 15)
//   - RODAR_LEADS_COOLDOWN_MIN minutos entre rodadas por instância (default 5)
//   - teto diário por instância RODAR_LEADS_TETO_DIARIO (default 40)
//   - envios espaçados com delay aleatório (não dispara em rajada)
//
// Fluxo: valida + reserva (insere lead_disparos status 'enviando' numa transação,
// o que já conta pro cooldown/teto e evita corrida), responde na hora e processa os
// envios em background com jitter, atualizando cada disparo pra 'enviado'/'falhou'.
const { enviarMensagem } = require('../whatsapp')
const { logger } = require('../logger')

const MAX_LOTE = Math.max(1, parseInt(process.env.RODAR_LEADS_MAX_LOTE, 10) || 15)
const COOLDOWN_MIN = Math.max(0, parseInt(process.env.RODAR_LEADS_COOLDOWN_MIN, 10) || 5)
const TETO_DIARIO = Math.max(0, parseInt(process.env.RODAR_LEADS_TETO_DIARIO, 10) || 40)
const DELAY_MIN_MS = Math.max(0, parseInt(process.env.RODAR_LEADS_DELAY_MIN_MS, 10) || 12000)
const DELAY_MAX_MS = Math.max(DELAY_MIN_MS, parseInt(process.env.RODAR_LEADS_DELAY_MAX_MS, 10) || 20000)

// Status do prospect que ainda podem ser abordados (espelha a aba "sem_contato").
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])

function delayAleatorio() {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1))
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// Renderiza o template da saudação com os dados do lead. Variáveis: {nome} {empresa}
// {cidade} {nicho}. {empresa} é alias de {nome} (nome do negócio do lead).
function renderSaudacao(template, prospect = {}) {
  const vars = {
    nome: prospect.nome || 'tudo bem',
    empresa: prospect.nome || '',
    cidade: prospect.cidade || '',
    nicho: prospect.nicho || '',
  }
  return String(template || '')
    .replace(/\{(nome|empresa|cidade|nicho)\}/gi, (_, k) => vars[k.toLowerCase()] ?? '')
    .trim()
}

async function carregarInstancia(pool, empresaId, instanciaId) {
  const { rows } = await pool.query(
    `SELECT id, evolution_instance, nome, ativo, config_json
       FROM app.empresa_whatsapp_instances
      WHERE id = $1 AND empresa_id = $2`,
    [instanciaId, empresaId]
  )
  return rows[0] || null
}

function saudacaoDaInstancia(instancia) {
  const cfg = instancia?.config_json
  const obj = typeof cfg === 'string' ? safeJson(cfg) : (cfg || {})
  return String(obj?.saudacao || '').trim()
}
function safeJson(s) { try { return JSON.parse(s) } catch { return {} } }

// Quanto falta do cooldown (em segundos) e quantos disparos já saíram hoje na instância.
async function estadoThrottle(pool, empresaId, evolutionInstance) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE criado_em::date = NOW()::date
                          AND status IN ('enviando', 'enviado'))::int AS hoje,
        MAX(criado_em) AS ultimo
       FROM prospectador.lead_disparos
      WHERE empresa_id = $1 AND evolution_instance = $2`,
    [empresaId, evolutionInstance]
  )
  const hoje = rows[0]?.hoje || 0
  const ultimo = rows[0]?.ultimo ? new Date(rows[0].ultimo) : null
  let cooldownRestanteS = 0
  if (ultimo && COOLDOWN_MIN > 0) {
    const passouMs = Date.now() - ultimo.getTime()
    const faltaMs = COOLDOWN_MIN * 60_000 - passouMs
    if (faltaMs > 0) cooldownRestanteS = Math.ceil(faltaMs / 1000)
  }
  return { hoje, cooldownRestanteS }
}

/**
 * Valida, reserva e agenda (em background) o disparo da saudação para os leads.
 * Retorna o resumo imediato { aceitos, pulados, cooldown_restante_s, teto_restante }.
 */
async function rodarLeads(pool, { empresaId, usuarioId, instanciaId, prospectIds }) {
  const ids = Array.from(new Set((prospectIds || []).map((x) => String(x || '').trim()).filter(Boolean)))
  if (!ids.length) { const e = new Error('Selecione ao menos um lead.'); e.statusCode = 400; throw e }
  if (ids.length > MAX_LOTE) { const e = new Error(`Máximo de ${MAX_LOTE} leads por rodada.`); e.statusCode = 400; throw e }

  const instancia = await carregarInstancia(pool, empresaId, instanciaId)
  if (!instancia) { const e = new Error('Instância não encontrada.'); e.statusCode = 404; throw e }
  if (!instancia.ativo) { const e = new Error('Instância está desativada. Ative o número antes de rodar.'); e.statusCode = 409; throw e }

  const saudacao = saudacaoDaInstancia(instancia)
  if (!saudacao) { const e = new Error('Configure a saudação desta instância antes de rodar (botão "Saudação — teste e edição").'); e.statusCode = 409; throw e }

  const { hoje, cooldownRestanteS } = await estadoThrottle(pool, empresaId, instancia.evolution_instance)
  if (cooldownRestanteS > 0) {
    const e = new Error(`Aguarde ${Math.ceil(cooldownRestanteS / 60)} min para rodar de novo nesta instância.`)
    e.statusCode = 429
    throw e
  }
  const tetoRestante = TETO_DIARIO > 0 ? Math.max(0, TETO_DIARIO - hoje) : ids.length
  if (tetoRestante <= 0) {
    const e = new Error(`Teto diário de ${TETO_DIARIO} disparos atingido nesta instância. Tente amanhã.`)
    e.statusCode = 429
    throw e
  }

  // Carrega os prospects e separa elegíveis de pulados (bloqueados / status / sem telefone).
  const { rows: prospects } = await pool.query(
    `SELECT id, nome, telefone, status, nicho, cidade, bloqueado_ate
       FROM prospectador.prospects
      WHERE empresa_id = $1 AND id = ANY($2::uuid[])`,
    [empresaId, ids]
  )
  const porId = new Map(prospects.map((p) => [p.id, p]))
  const pulados = []
  const elegiveis = []
  const agora = Date.now()
  for (const id of ids) {
    const p = porId.get(id)
    if (!p) { pulados.push({ id, motivo: 'nao_encontrado' }); continue }
    if (p.bloqueado_ate && new Date(p.bloqueado_ate).getTime() > agora) { pulados.push({ id, motivo: 'bloqueado', bloqueado_ate: p.bloqueado_ate }); continue }
    if (!STATUS_RODAVEL.has(p.status)) { pulados.push({ id, motivo: `status_${p.status}` }); continue }
    if (!String(p.telefone || '').trim()) { pulados.push({ id, motivo: 'sem_telefone' }); continue }
    elegiveis.push(p)
  }

  // Respeita o teto diário: corta o lote ao que ainda cabe hoje.
  const aceitos = elegiveis.slice(0, tetoRestante)
  for (const p of elegiveis.slice(tetoRestante)) pulados.push({ id: p.id, motivo: 'teto_diario' })

  if (!aceitos.length) {
    return { rodada: false, aceitos: [], pulados, teto_restante: tetoRestante, total_dia: hoje }
  }

  // Reserva: insere os disparos como 'enviando' (já conta no cooldown/teto e evita corrida).
  const disparoIds = new Map()
  for (const p of aceitos) {
    const mensagem = renderSaudacao(saudacao, p)
    const { rows } = await pool.query(
      `INSERT INTO prospectador.lead_disparos
         (empresa_id, prospect_id, usuario_id, evolution_instance, mensagem, status)
       VALUES ($1, $2, $3, $4, $5, 'enviando') RETURNING id`,
      [empresaId, p.id, usuarioId || null, instancia.evolution_instance, mensagem]
    )
    disparoIds.set(p.id, { disparoId: rows[0].id, mensagem })
  }

  // Processa os envios em background com jitter (não bloqueia a resposta HTTP).
  processarEnviosEmBackground(pool, {
    empresaId,
    evolutionInstance: instancia.evolution_instance,
    aceitos,
    disparoIds,
  }).catch((err) => logger.error({ err: err.message }, '[rodar-leads] background falhou'))

  return {
    rodada: true,
    aceitos: aceitos.map((p) => ({ id: p.id, nome: p.nome })),
    pulados,
    teto_restante: Math.max(0, tetoRestante - aceitos.length),
    total_dia: hoje + aceitos.length,
  }
}

async function processarEnviosEmBackground(pool, { aceitos, disparoIds, evolutionInstance }) {
  for (let i = 0; i < aceitos.length; i++) {
    const p = aceitos[i]
    const { disparoId, mensagem } = disparoIds.get(p.id)
    try {
      await enviarMensagem(p.telefone, mensagem, { instanceName: evolutionInstance })
      await pool.query(
        `UPDATE prospectador.lead_disparos SET status = 'enviado' WHERE id = $1`,
        [disparoId]
      )
      // Move o prospect pro funil "já conversou" (não reabordar). Só se ainda rodável.
      await pool.query(
        `UPDATE prospectador.prospects SET status = 'enviado', updated_at = NOW()
          WHERE id = $1 AND status IN ('coletado', 'contato_encontrado', 'aguardando', 'aprovado')`,
        [p.id]
      ).catch(() => {})
    } catch (err) {
      await pool.query(
        `UPDATE prospectador.lead_disparos SET status = 'falhou', erro = $2 WHERE id = $1`,
        [disparoId, String(err.message || 'falha_envio').slice(0, 800)]
      ).catch(() => {})
      logger.warn({ prospect: p.id, err: err.message }, '[rodar-leads] envio falhou')
    }
    // Espaça o próximo envio (menos no último).
    if (i < aceitos.length - 1) await sleep(delayAleatorio())
  }
}

module.exports = {
  rodarLeads,
  renderSaudacao,
  estadoThrottle,
  carregarInstancia,
  saudacaoDaInstancia,
  STATUS_RODAVEL,
  MAX_LOTE,
  COOLDOWN_MIN,
  TETO_DIARIO,
}
