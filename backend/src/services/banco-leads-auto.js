'use strict'
const os = require('node:os')
// Worker do modo AUTOMÁTICO do Banco de Leads (Fase 2). A cada tick, para cada empresa
// com modo='automatico' e auto_ativo, se estiver DENTRO da janela horária e já passou o
// instante do próximo disparo, pega UM lead elegível e dispara reusando rodarLeads (que
// já faz elegibilidade, teto, cooldown, geração IA e marcação de tem_whatsapp). Depois
// sorteia o próximo intervalo (intervalo_min..intervalo_max min) e agenda.
//
// Puro reuso: o worker NÃO reimplementa envio/throttle — só orquestra o "quando/quem".
const { logger } = require('../logger')
const { obterConfigBancoLeads } = require('../db/banco-leads-config')
const {
  rodarLeads, gerarPendentesSemi, reconciliarConfirmacoesPendentes, STATUS_RODAVEL, MAX_LOTE,
} = require('./rodar-leads')
const { canProspectLead } = require('./prospecting-eligibility')
const { horaLocal } = require('./captacao-scheduler')

const WORKER_MS = Math.max(30000, parseInt(process.env.BANCO_LEADS_AUTO_WORKER_MS, 10) || 60000)
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'America/Sao_Paulo'
const REPLICA_ID = process.env.REPLICA_ID || process.env.RAILWAY_REPLICA_ID || os.hostname()
const LOCK_KEY = 'banco-leads-worker'
const CANDIDATE_PAGE_SIZE = 50
const CANDIDATE_SCAN_LIMIT = 500
const GERACAO_TRAVADA_MINUTOS = 10
const autoScanOffsets = new Map()
let workerTickRodando = false

function minutosDoDia(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

// Janela horária no APP_TIMEZONE, independente do fuso UTC do container.
function dentroDaJanela(now, inicio, fim, timezone = APP_TIMEZONE) {
  const ini = minutosDoDia(inicio)
  const f = minutosDoDia(fim)
  if (ini == null || f == null || f < ini) return false
  const atual = horaLocal(now, timezone).minutos_do_dia
  return atual >= ini && atual <= f
}

function sortearIntervaloMinutos(min, max) {
  const lo = Math.max(1, Number(min) || 15)
  const hi = Math.max(lo, Number(max) || 30)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function somarMotivo(motivos, motivo) {
  const chave = String(motivo || 'inelegivel')
  motivos[chave] = (motivos[chave] || 0) + 1
}

async function agendarProximoDisparo(pool, empresaId, now, cfg) {
  const proxMin = sortearIntervaloMinutos(cfg.intervalo_min, cfg.intervalo_max)
  const proximo = new Date(now.getTime() + proxMin * 60_000)
  await pool.query(
    `UPDATE app.banco_leads_config
        SET auto_proximo_disparo_em = $2, atualizado_em = NOW()
      WHERE empresa_id = $1`,
    [empresaId, proximo]
  )
  return { proxMin, proximo }
}

async function adquirirLiderancaWorker(pool, replicaId = REPLICA_ID) {
  const { rows } = await pool.query(
    `INSERT INTO vendas.watcher_locks (chave, replica_id, locked_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + INTERVAL '2 minutes')
     ON CONFLICT (chave) DO UPDATE
       SET replica_id = EXCLUDED.replica_id,
           locked_at = NOW(),
           expires_at = NOW() + INTERVAL '2 minutes'
     WHERE vendas.watcher_locks.expires_at < NOW()
     RETURNING replica_id`,
    [LOCK_KEY, replicaId]
  )
  return rows[0]?.replica_id === replicaId
}

async function renovarLiderancaWorker(pool, replicaId = REPLICA_ID) {
  const { rowCount } = await pool.query(
    `UPDATE vendas.watcher_locks
        SET expires_at = NOW() + INTERVAL '2 minutes'
      WHERE chave = $1 AND replica_id = $2`,
    [LOCK_KEY, replicaId]
  )
  return rowCount > 0
}

async function liberarLiderancaWorker(pool, replicaId = REPLICA_ID) {
  await pool.query(
    `DELETE FROM vendas.watcher_locks WHERE chave = $1 AND replica_id = $2`,
    [LOCK_KEY, replicaId]
  )
}

// Roda a decisão de UMA empresa. rodarLeadsFn/queryFns injetáveis para teste.
async function instanciaConfiguradaOuRecente(pool, empresaId, instanciaId) {
  if (instanciaId) {
    const { rows } = await pool.query(
      `SELECT id, evolution_instance FROM app.empresa_whatsapp_instances
        WHERE id = $1 AND empresa_id = $2 AND ativo = true LIMIT 1`,
      [instanciaId, empresaId]
    )
    if (rows[0]) return rows[0]
  }
  const { rows } = await pool.query(
    `SELECT id, evolution_instance FROM app.empresa_whatsapp_instances
      WHERE empresa_id = $1 AND ativo = true
      ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1`,
    [empresaId]
  )
  return rows[0] || null
}

async function buscarPrimeiroLeadElegivel(pool, empresaId, statusList, deps = {}) {
  const canProspectLeadFn = deps.canProspectLeadFn || canProspectLead
  const scanState = deps.scanState || autoScanOffsets
  const pageSize = Math.min(Math.max(Number(deps.candidatePageSize) || CANDIDATE_PAGE_SIZE, 1), 100)
  const scanLimit = Math.min(Math.max(Number(deps.candidateScanLimit) || CANDIDATE_SCAN_LIMIT, pageSize), 2000)
  const offsetInicial = Math.max(Number(scanState.get(empresaId)) || 0, 0)
  let offset = offsetInicial
  let analisados = 0
  let paginas = 0
  let voltouAoInicio = false
  const motivos = {}

  while (analisados < scanLimit) {
    if (voltouAoInicio && offset >= offsetInicial) break
    const limitePagina = Math.min(pageSize, scanLimit - analisados)
    const { rows } = await pool.query(
      `SELECT p.id, p.telefone FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.status = ANY($2)
          AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
          AND (p.tem_whatsapp IS DISTINCT FROM false)
          AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
          AND NOT EXISTS (
            SELECT 1 FROM prospectador.lead_disparos d
             WHERE d.empresa_id = p.empresa_id
               AND d.prospect_id = p.id
               AND d.status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao')
          )
        ORDER BY p.score DESC NULLS LAST, p.created_at ASC, p.id ASC
        LIMIT $3 OFFSET $4`,
      [empresaId, statusList, limitePagina, offset]
    )
    paginas++

    if (!rows.length) {
      if (offsetInicial > 0 && !voltouAoInicio) {
        offset = 0
        voltouAoInicio = true
        continue
      }
      scanState.delete(empresaId)
      return { lead: null, analisados, paginas, motivos, esgotou: true, proximo_offset: 0 }
    }

    for (let indice = 0; indice < rows.length && analisados < scanLimit; indice++) {
      const candidato = rows[indice]
      analisados++
      const elegibilidade = await canProspectLeadFn(pool, candidato.telefone, {
        prospectId: candidato.id,
        empresaId,
        complianceOnly: true,
      })
      if (elegibilidade.allowed) {
        return {
          lead: candidato,
          analisados,
          paginas,
          motivos,
          esgotou: false,
          proximo_offset: offset + indice + 1,
        }
      }
      somarMotivo(motivos, elegibilidade.reason)
    }

    offset += rows.length
    if (rows.length < limitePagina) {
      if (offsetInicial > 0 && !voltouAoInicio) {
        offset = 0
        voltouAoInicio = true
        continue
      }
      scanState.delete(empresaId)
      return { lead: null, analisados, paginas, motivos, esgotou: true, proximo_offset: 0 }
    }
  }

  scanState.set(empresaId, offset)
  return { lead: null, analisados, paginas, motivos, esgotou: false, proximo_offset: offset }
}

async function reconciliarGeracoesTravadas(pool, minutos = GERACAO_TRAVADA_MINUTOS) {
  const limiteMinutos = Math.min(Math.max(parseInt(minutos, 10) || GERACAO_TRAVADA_MINUTOS, 5), 60)
  const { rowCount } = await pool.query(
    `UPDATE prospectador.lead_disparos
        SET status = 'erro_ia', erro = 'geracao_interrompida:timeout'
      WHERE status = 'gerando'
        AND criado_em < NOW() - ($1::int * INTERVAL '1 minute')`,
    [limiteMinutos]
  )
  const corrigidas = rowCount || 0
  if (corrigidas > 0) {
    logger.warn({ operation: 'banco_leads_reconcile', corrigidas }, '[banco-leads-auto] geracoes travadas liberadas')
  }
  return { corrigidas }
}

async function _semiEmpresa(pool, empresaId, deps = {}) {
  const gerarPendentesSemiFn = deps.gerarPendentesSemiFn || gerarPendentesSemi
  const cfg = await obterConfigBancoLeads(pool, empresaId)
  if (cfg.modo !== 'semi_automatico') return { empresa_id: empresaId, motivo: 'inativo' }
  const instancia = await instanciaConfiguradaOuRecente(pool, empresaId, cfg.auto_instancia_id)
  if (!instancia) return { empresa_id: empresaId, motivo: 'sem_instancia' }
  const res = await gerarPendentesSemiFn(pool, {
    empresaId,
    usuarioId: null,
    instanciaId: instancia.id,
    limit: MAX_LOTE,
  })
  const gerados = Array.isArray(res.gerados) ? res.gerados.length : 0
  if (gerados > 0) {
    logger.info({ operation: 'banco_leads_semi', empresa_id: empresaId, gerados }, '[banco-leads-semi] mensagens geradas')
  }
  return { empresa_id: empresaId, motivo: gerados > 0 ? 'gerado' : 'sem_pendentes', gerados, pulados: res.pulados?.length || 0 }
}

async function _autoEmpresa(pool, empresaId, now, deps = {}) {
  const rodarLeadsFn = deps.rodarLeadsFn || rodarLeads
  const canProspectLeadFn = deps.canProspectLeadFn || canProspectLead
  const cfg = await obterConfigBancoLeads(pool, empresaId)
  if (cfg.modo !== 'automatico' || !cfg.auto_ativo) return { empresa_id: empresaId, motivo: 'inativo' }
  if (!dentroDaJanela(now, cfg.janela_inicio, cfg.janela_fim)) return { empresa_id: empresaId, motivo: 'fora_janela' }
  if (cfg.auto_proximo_disparo_em && now < new Date(cfg.auto_proximo_disparo_em)) {
    return { empresa_id: empresaId, motivo: 'aguardando_intervalo' }
  }

  // Instância dos disparos automáticos: a configurada (auto_instancia_id) se ativa,
  // senão a ativa mais recente da empresa.
  const instancia = await instanciaConfiguradaOuRecente(pool, empresaId, cfg.auto_instancia_id)
  if (!instancia) return { empresa_id: empresaId, motivo: 'sem_instancia' }

  // Teto diário por instância (conta os disparos de hoje).
  const { rows: tetoRows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE criado_em::date = NOW()::date
              AND status IN ('enviando', 'pendente_confirmacao', 'enviado'))::int AS hoje
       FROM prospectador.lead_disparos WHERE empresa_id = $1 AND evolution_instance = $2`,
    [empresaId, instancia.evolution_instance]
  )
  if ((cfg.teto_diario || 0) > 0 && (tetoRows[0]?.hoje || 0) >= cfg.teto_diario) {
    return { empresa_id: empresaId, motivo: 'teto_diario' }
  }

  // Próximo lead elegível (rodável, com telefone, não travado, com WhatsApp != false).
  // Ordem: MELHOR primeiro (maior score = mais quente), desempate por mais antigo e id
  // (determinístico, sem empates indefinidos entre leads do mesmo lote).
  const statusList = [...STATUS_RODAVEL]
  const { rows: leads } = await pool.query(
    `SELECT p.id, p.telefone FROM prospectador.prospects p
      WHERE p.empresa_id = $1
        AND p.status = ANY($2)
        AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
        AND (p.tem_whatsapp IS DISTINCT FROM false)
        AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
        AND NOT EXISTS (
          SELECT 1 FROM prospectador.lead_disparos d
           WHERE d.empresa_id = p.empresa_id
             AND d.prospect_id = p.id
             AND d.status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao')
        )
      ORDER BY p.score DESC NULLS LAST, p.created_at ASC, p.id ASC LIMIT $3`,
    [empresaId, statusList, MAX_LOTE]
  )
  if (!leads.length) return { empresa_id: empresaId, motivo: 'sem_lead' }

  // A consulta remove reservas ativas; a elegibilidade compartilhada remove telefone fixo,
  // opt-out e conversas ativas. Assim um candidato bloqueado nao prende todos os ticks.
  let lead = null
  for (const candidato of leads) {
    const elegibilidade = await canProspectLeadFn(pool, candidato.telefone, {
      prospectId: candidato.id,
      empresaId,
      complianceOnly: true,
    })
    if (elegibilidade.allowed) {
      lead = candidato
      break
    }
  }
  if (!lead) return { empresa_id: empresaId, motivo: 'sem_lead_elegivel' }

  try {
    const res = await rodarLeadsFn(pool, {
      empresaId, usuarioId: null, instanciaId: instancia.id, prospectIds: [lead.id],
    })
    if (res && res.rodada && res.aceitos && res.aceitos.length) {
      const proxMin = sortearIntervaloMinutos(cfg.intervalo_min, cfg.intervalo_max)
      const proximo = new Date(now.getTime() + proxMin * 60_000)
      await pool.query(
        `UPDATE app.banco_leads_config SET auto_proximo_disparo_em = $2, atualizado_em = NOW() WHERE empresa_id = $1`,
        [empresaId, proximo]
      )
      logger.info({ operation: 'banco_leads_auto', empresa_id: empresaId, lead_id: lead.id, proximo_em_min: proxMin }, '[banco-leads-auto] lead disparado')
      return { empresa_id: empresaId, motivo: 'disparado', lead_id: lead.id, proximo_em_min: proxMin }
    }
    return { empresa_id: empresaId, motivo: 'nao_aceito' }
  } catch (e) {
    // Erro persistente (sem saudação/instância caída/cooldown): recua o próximo disparo
    // pelo intervalo p/ não re-tentar a cada tick (evita loop apertado no log).
    const proxMin = sortearIntervaloMinutos(cfg.intervalo_min, cfg.intervalo_max)
    await pool.query(
      `UPDATE app.banco_leads_config SET auto_proximo_disparo_em = $2, atualizado_em = NOW() WHERE empresa_id = $1`,
      [empresaId, new Date(now.getTime() + proxMin * 60_000)]
    ).catch(() => {})
    logger.warn({ operation: 'banco_leads_auto', empresa_id: empresaId, err: e.message, recuo_min: proxMin }, '[banco-leads-auto] disparo pulado')
    return { empresa_id: empresaId, motivo: 'erro', erro: e.message }
  }
}

async function verificarBancoLeadsAuto(pool, now = new Date(), deps = {}) {
  let empresas
  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM app.banco_leads_config WHERE modo = 'automatico' AND auto_ativo = true`
    )
    empresas = rows.map((r) => r.empresa_id).filter(Boolean)
  } catch (e) {
    return { ok: false, motivo: 'config_indisponivel', erro: e.message }
  }
  if (!empresas.length) return { ok: true, empresas: 0, resultados: [] }
  const resultados = []
  for (const empresaId of empresas) {
    try {
      resultados.push(await _autoEmpresa(pool, empresaId, now, deps))
    } catch (e) {
      logger.error({ operation: 'banco_leads_auto', empresa_id: empresaId, err: e.message }, '[banco-leads-auto] empresa falhou')
      resultados.push({ empresa_id: empresaId, motivo: 'erro', erro: e.message })
    }
  }
  return { ok: true, empresas: empresas.length, resultados }
}

async function verificarBancoLeadsSemi(pool, deps = {}) {
  let empresas
  try {
    const { rows } = await pool.query(
      `SELECT empresa_id FROM app.banco_leads_config WHERE modo = 'semi_automatico'`
    )
    empresas = rows.map((r) => r.empresa_id).filter(Boolean)
  } catch (e) {
    return { ok: false, motivo: 'config_indisponivel', erro: e.message }
  }
  if (!empresas.length) return { ok: true, empresas: 0, resultados: [] }
  const resultados = []
  for (const empresaId of empresas) {
    try {
      resultados.push(await _semiEmpresa(pool, empresaId, deps))
    } catch (e) {
      logger.error({ operation: 'banco_leads_semi', empresa_id: empresaId, err: e.message }, '[banco-leads-semi] empresa falhou')
      resultados.push({ empresa_id: empresaId, motivo: 'erro', erro: e.message })
    }
  }
  return { ok: true, empresas: empresas.length, resultados }
}

async function executarBancoLeadsWorkerTick(pool, now = new Date(), deps = {}) {
  if (workerTickRodando) return { ok: true, motivo: 'tick_em_andamento' }
  workerTickRodando = true
  const replicaId = deps.replicaId || REPLICA_ID
  const adquirir = deps.adquirirLiderancaFn || adquirirLiderancaWorker
  const renovar = deps.renovarLiderancaFn || renovarLiderancaWorker
  const liberar = deps.liberarLiderancaFn || liberarLiderancaWorker
  const reconciliar = deps.reconciliarFn || reconciliarConfirmacoesPendentes
  const verificarSemi = deps.verificarSemiFn || verificarBancoLeadsSemi
  const verificarAuto = deps.verificarAutoFn || verificarBancoLeadsAuto
  let lider = false
  let heartbeat = null
  try {
    lider = await adquirir(pool, replicaId)
    if (!lider) return { ok: true, motivo: 'outra_replica' }
    heartbeat = setInterval(() => {
      renovar(pool, replicaId).catch((e) =>
        logger.warn({ err: e.message }, '[banco-leads-auto] renovacao da lideranca falhou'))
    }, 30000)
    if (heartbeat.unref) heartbeat.unref()

    const confirmacoes = await reconciliar(pool)
    const [semi, automatico] = await Promise.all([
      verificarSemi(pool, deps),
      verificarAuto(pool, now, deps),
    ])
    return { ok: true, motivo: 'executado', confirmacoes, semi, automatico }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (lider) {
      await liberar(pool, replicaId).catch((e) =>
        logger.warn({ err: e.message }, '[banco-leads-auto] liberacao da lideranca falhou'))
    }
    workerTickRodando = false
  }
}

function iniciarBancoLeadsAutoWorker(pool) {
  logger.info({ intervalo_ms: WORKER_MS, replica_id: REPLICA_ID }, '[banco-leads-auto] worker iniciado')
  const tick = () => {
    executarBancoLeadsWorkerTick(pool, new Date()).catch((e) =>
      logger.warn({ err: e.message }, '[banco-leads-auto] tick falhou'))
  }
  const timer = setInterval(tick, WORKER_MS)
  if (timer.unref) timer.unref()
  return timer
}

module.exports = {
  iniciarBancoLeadsAutoWorker,
  verificarBancoLeadsAuto,
  verificarBancoLeadsSemi,
  executarBancoLeadsWorkerTick,
  adquirirLiderancaWorker,
  renovarLiderancaWorker,
  liberarLiderancaWorker,
  _autoEmpresa,
  _semiEmpresa,
  dentroDaJanela,
  sortearIntervaloMinutos,
  minutosDoDia,
  APP_TIMEZONE,
}
