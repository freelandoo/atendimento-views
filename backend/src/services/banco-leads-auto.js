'use strict'
const os = require('node:os')
// Worker do modo AUTOMÁTICO do Banco de Leads (Fase 2). A cada tick, para cada empresa
// com modo='automatico' e auto_ativo, se já passou o instante do próximo disparo, pega
// UM lead elegível cuja janela esteja aberta no horário local do país do lead e dispara
// reusando rodarLeads (que já faz elegibilidade, teto, cooldown, geração IA e marcação
// de tem_whatsapp). Depois sorteia o próximo intervalo (intervalo_min..intervalo_max min)
// e agenda.
//
// Puro reuso: o worker NÃO reimplementa envio/throttle — só orquestra o "quando/quem".
const { logger } = require('../logger')
const { obterConfigBancoLeads } = require('../db/banco-leads-config')
const {
  rodarLeads, gerarPendentesSemi, reconciliarConfirmacoesPendentes, STATUS_RODAVEL, MAX_LOTE,
  COOLDOWN_MIN,
} = require('./rodar-leads')
// A PORTA da operacao comercial (Etapa 3.4). Este worker e' o UNICO caminho do produto que
// aborda um lead SEM humano nenhum no circuito — e era ele que aceitava `aguardando`. Medido em
// 2026-09-11: modo Automatico desligado em todas as empresas, mas o codigo estava pronto para
// disparar para 2.748 leads nunca triados.
const { sqlAbordavel } = require('./lead-qualificacao')
const { canProspectLead } = require('./prospecting-eligibility')
const { horaLocal } = require('./captacao-scheduler')
const { avaliarJanelaLocalLead } = require('./lead-timezone')

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

function recorteAutomatico(cfg = {}) {
  const nicho = String(cfg.auto_nicho || '').trim()
  return cfg.auto_recorte_modo === 'nicho' && nicho
    ? { modo: 'nicho', nicho }
    : { modo: 'geral', nicho: null }
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
        WHERE id = $1 AND empresa_id = $2 AND ativo = true
          AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'
        LIMIT 1`,
      [instanciaId, empresaId]
    )
    if (rows[0]) return rows[0]
  }
  const { rows } = await pool.query(
    `SELECT id, evolution_instance FROM app.empresa_whatsapp_instances
      WHERE empresa_id = $1 AND ativo = true
        AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'
      ORDER BY atualizado_em DESC, criado_em DESC LIMIT 1`,
    [empresaId]
  )
  return rows[0] || null
}

function cooldownRestanteInstancia(row, now) {
  const ultimo = row?.ultimo_disparo_em ? new Date(row.ultimo_disparo_em) : null
  if (!ultimo || Number.isNaN(ultimo.getTime()) || COOLDOWN_MIN <= 0) return 0
  const faltaMs = COOLDOWN_MIN * 60_000 - (now.getTime() - ultimo.getTime())
  return faltaMs > 0 ? Math.ceil(faltaMs / 1000) : 0
}

function totalDisparosPool(instancias = []) {
  return (instancias || []).reduce((total, inst) => total + (Number(inst.disparos_hoje) || 0), 0)
}

function tetoPorInstanciaPool(tetoDiario, totalInstancias) {
  const teto = Number(tetoDiario) > 0 ? Number(tetoDiario) : 0
  const total = Math.max(1, Number(totalInstancias) || 1)
  return teto > 0 ? Math.ceil(teto / total) : 0
}

function ordenarPoolAutomatico(instancias, now, tetoDiario) {
  const teto = Number(tetoDiario) > 0 ? Number(tetoDiario) : 0
  return [...(instancias || [])]
    .map((inst) => ({
      ...inst,
      disparos_hoje: Number(inst.disparos_hoje || 0),
      cooldown_restante_s: cooldownRestanteInstancia(inst, now),
    }))
    .sort((a, b) => {
      const aTeto = teto > 0 && a.disparos_hoje >= teto
      const bTeto = teto > 0 && b.disparos_hoje >= teto
      if (aTeto !== bTeto) return aTeto ? 1 : -1
      if (a.cooldown_restante_s !== b.cooldown_restante_s) return a.cooldown_restante_s - b.cooldown_restante_s
      const aUlt = a.ultimo_disparo_em ? new Date(a.ultimo_disparo_em).getTime() : 0
      const bUlt = b.ultimo_disparo_em ? new Date(b.ultimo_disparo_em).getTime() : 0
      if (aUlt !== bUlt) return aUlt - bUlt
      return String(a.evolution_instance || '').localeCompare(String(b.evolution_instance || ''))
    })
}

async function listarPoolAutomatico(pool, empresaId, now, cfg = {}) {
  const { rows } = await pool.query(
    `SELECT i.id, i.evolution_instance, i.nome,
            COUNT(d.id) FILTER (
              WHERE d.criado_em::date = NOW()::date
                AND d.status IN ('enviando', 'pendente_confirmacao', 'enviado')
            )::int AS disparos_hoje,
            MAX(d.criado_em) FILTER (
              WHERE d.status IN ('enviando', 'pendente_confirmacao', 'enviado')
            ) AS ultimo_disparo_em
       FROM app.empresa_whatsapp_instances i
       LEFT JOIN prospectador.lead_disparos d
         ON d.empresa_id = i.empresa_id
        AND d.evolution_instance = i.evolution_instance
      WHERE i.empresa_id = $1
        AND i.ativo = true
        AND COALESCE(i.config_json->>'canal', 'whatsapp') <> 'freelandoo'
        AND NULLIF(BTRIM(COALESCE(i.config_json->>'saudacao', '')), '') IS NOT NULL
      GROUP BY i.id, i.evolution_instance, i.nome
      ORDER BY i.atualizado_em DESC, i.criado_em DESC`,
    [empresaId]
  )
  return ordenarPoolAutomatico(rows, now, 0)
}

async function escolherInstanciaAutomatico(pool, empresaId, now, cfg = {}, deps = {}) {
  const listar = deps.listarPoolAutomaticoFn || listarPoolAutomatico
  const poolInstanciasBruto = await listar(pool, empresaId, now, cfg)
  const teto = Number(cfg.teto_diario) > 0 ? Number(cfg.teto_diario) : 0
  const tetoPorInstancia = tetoPorInstanciaPool(teto, poolInstanciasBruto.length)
  const poolInstancias = ordenarPoolAutomatico(poolInstanciasBruto, now, tetoPorInstancia)
  if (!poolInstancias.length) {
    return { instancia: null, motivo: 'sem_instancia_pronta', total: 0, disponiveis: 0, menor_cooldown_s: null, total_disparos_hoje: 0 }
  }
  const totalDisparosHoje = totalDisparosPool(poolInstancias)
  if (teto > 0 && totalDisparosHoje >= teto) {
    return { instancia: null, motivo: 'teto_diario_pool', total: poolInstancias.length, disponiveis: 0, menor_cooldown_s: null, total_disparos_hoje: totalDisparosHoje }
  }
  const semTeto = poolInstancias.filter((inst) => tetoPorInstancia <= 0 || inst.disparos_hoje < tetoPorInstancia)
  if (!semTeto.length) {
    return { instancia: null, motivo: 'teto_diario_instancias', total: poolInstancias.length, disponiveis: 0, menor_cooldown_s: null, total_disparos_hoje: totalDisparosHoje }
  }
  const disponiveis = semTeto.filter((inst) => inst.cooldown_restante_s <= 0)
  if (!disponiveis.length) {
    const menor = Math.min(...semTeto.map((inst) => inst.cooldown_restante_s).filter((n) => Number.isFinite(n)))
    return {
      instancia: null,
      motivo: 'aguardando_cooldown_pool',
      total: poolInstancias.length,
      disponiveis: 0,
      menor_cooldown_s: Number.isFinite(menor) ? menor : null,
      total_disparos_hoje: totalDisparosHoje,
    }
  }
  return {
    instancia: disponiveis[0],
    motivo: 'ok',
    total: poolInstancias.length,
    disponiveis: disponiveis.length,
    menor_cooldown_s: 0,
    total_disparos_hoje: totalDisparosHoje,
  }
}

async function buscarPrimeiroLeadElegivel(pool, empresaId, statusList, deps = {}) {
  const canProspectLeadFn = deps.canProspectLeadFn || canProspectLead
  const avaliarJanelaLocalLeadFn = deps.avaliarJanelaLocalLeadFn || avaliarJanelaLocalLead
  const scanState = deps.scanState || autoScanOffsets
  const recorte = recorteAutomatico(deps.autoRecorte)
  const cfg = deps.autoRecorte || {}
  const now = deps.now instanceof Date ? deps.now : new Date()
  const scanKey = recorte.modo === 'nicho' ? `${empresaId}:nicho:${recorte.nicho.toLowerCase()}` : `${empresaId}:geral`
  const pageSize = Math.min(Math.max(Number(deps.candidatePageSize) || CANDIDATE_PAGE_SIZE, 1), 100)
  const scanLimit = Math.min(Math.max(Number(deps.candidateScanLimit) || CANDIDATE_SCAN_LIMIT, pageSize), 2000)
  const offsetInicial = Math.max(Number(scanState.get(scanKey)) || 0, 0)
  let offset = offsetInicial
  let analisados = 0
  let paginas = 0
  let voltouAoInicio = false
  const motivos = {}

  while (analisados < scanLimit) {
    if (voltouAoInicio && offset >= offsetInicial) break
    const limitePagina = Math.min(pageSize, scanLimit - analisados)
    const params = [empresaId, statusList, limitePagina, offset]
    let filtroNicho = ''
    if (recorte.modo === 'nicho') {
      params.push(recorte.nicho)
      const nichoParam = params.length
      filtroNicho = `AND (
            LOWER(BTRIM(COALESCE(p.nicho, ''))) = LOWER(BTRIM($${nichoParam}::text))
            OR LOWER(BTRIM(COALESCE(p.categoria_perfil, ''))) = LOWER(BTRIM($${nichoParam}::text))
          )`
    }
    const { rows } = await pool.query(
      `SELECT p.id, p.telefone, p.pais, p.cidade, p.endereco FROM prospectador.prospects p
        WHERE p.empresa_id = $1
          AND p.status = ANY($2)
          ${filtroNicho}
          AND ${sqlAbordavel('p')}
          AND NULLIF(BTRIM(COALESCE(p.telefone, '')), '') IS NOT NULL
          AND (p.tem_whatsapp IS DISTINCT FROM false)
          AND (p.bloqueado_ate IS NULL OR p.bloqueado_ate <= NOW())
          AND NOT EXISTS (
            SELECT 1 FROM prospectador.lead_disparos d
             WHERE d.empresa_id = p.empresa_id
               AND d.prospect_id = p.id
               AND d.status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao')
          )
        ORDER BY (p.qualificacao = 'aprovado') DESC, p.score DESC NULLS LAST, p.created_at ASC, p.id ASC
        LIMIT $3 OFFSET $4`,
      params
    )
    paginas++

    if (!rows.length) {
      if (offsetInicial > 0 && !voltouAoInicio) {
        offset = 0
        voltouAoInicio = true
        continue
      }
      scanState.delete(scanKey)
      return { lead: null, analisados, paginas, motivos, esgotou: true, proximo_offset: 0 }
    }

    for (let indice = 0; indice < rows.length && analisados < scanLimit; indice++) {
      const candidato = rows[indice]
      analisados++
      const janelaLocal = avaliarJanelaLocalLeadFn(candidato, now, cfg.janela_inicio, cfg.janela_fim)
      candidato.janela_local = janelaLocal
      if (!janelaLocal.permitido) {
        somarMotivo(motivos, janelaLocal.motivo)
        continue
      }
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
      scanState.delete(scanKey)
      return { lead: null, analisados, paginas, motivos, esgotou: true, proximo_offset: 0 }
    }
  }

  scanState.set(scanKey, offset)
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
  const cfg = await obterConfigBancoLeads(pool, empresaId)
  if (cfg.modo !== 'automatico' || !cfg.auto_ativo) return { empresa_id: empresaId, motivo: 'inativo' }
  if (cfg.auto_proximo_disparo_em && now < new Date(cfg.auto_proximo_disparo_em)) {
    return { empresa_id: empresaId, motivo: 'aguardando_intervalo' }
  }

  // Automático usa POOL da empresa: a cada ciclo escolhe a instância ativa, com saudação,
  // abaixo do teto e mais descansada. O intervalo global continua limitando 1 lead por ciclo.
  const escolhaInstancia = await escolherInstanciaAutomatico(pool, empresaId, now, cfg, deps)
  const instancia = escolhaInstancia.instancia
  if (!instancia) {
    return {
      empresa_id: empresaId,
      motivo: escolhaInstancia.motivo,
      instancias_pool: escolhaInstancia.total,
      cooldown_restante_s: escolhaInstancia.menor_cooldown_s,
      total_disparos_hoje: escolhaInstancia.total_disparos_hoje,
    }
  }

  // Próximo lead elegível (rodável, com telefone, não travado, com WhatsApp != false).
  // Ordem: MELHOR primeiro (maior score = mais quente), desempate por mais antigo e id
  // (determinístico, sem empates indefinidos entre leads do mesmo lote).
  // Varre a carteira em PÁGINAS (com memória de offset por empresa) até achar um lead
  // elegível — NÃO desiste só porque os primeiros por score são telefone fixo/inválido
  // (o que travava o disparo quando o topo do score era dominado por landlines).
  const statusList = [...STATUS_RODAVEL]
  const scan = await buscarPrimeiroLeadElegivel(pool, empresaId, statusList, { ...deps, autoRecorte: cfg, now })
  const lead = scan.lead
  if (!lead) {
    const motivos = scan.motivos || {}
    const totalMotivos = Object.values(motivos).reduce((s, n) => s + (Number(n) || 0), 0)
    const motivoJanela = totalMotivos > 0 && (Number(motivos.fora_janela_local || 0) + Number(motivos.sem_fuso_resolvido || 0) + Number(motivos.janela_invalida || 0)) === totalMotivos
    return {
      empresa_id: empresaId,
      motivo: motivoJanela ? 'fora_janela_local' : (scan.esgotou ? 'sem_lead' : 'sem_lead_elegivel'),
      analisados: scan.analisados,
      motivos,
      instancias_pool: escolhaInstancia.total,
      total_disparos_hoje: escolhaInstancia.total_disparos_hoje,
    }
  }

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
      logger.info({
        operation: 'banco_leads_auto',
        empresa_id: empresaId,
        lead_id: lead.id,
        pais: lead.janela_local?.pais || null,
        timezone: lead.janela_local?.timezone || null,
        hora_local: lead.janela_local?.hora_local || null,
        janela_inicio: cfg.janela_inicio,
        janela_fim: cfg.janela_fim,
        total_disparos_hoje: escolhaInstancia.total_disparos_hoje + 1,
        proximo_em_min: proxMin,
      }, '[banco-leads-auto] lead disparado')
      return {
        empresa_id: empresaId,
        motivo: 'disparado',
        lead_id: lead.id,
        pais: lead.janela_local?.pais || null,
        timezone: lead.janela_local?.timezone || null,
        hora_local: lead.janela_local?.hora_local || null,
        instancia_id: instancia.id,
        evolution_instance: instancia.evolution_instance,
        instancias_pool: escolhaInstancia.total,
        instancias_disponiveis: escolhaInstancia.disponiveis,
        total_disparos_hoje: escolhaInstancia.total_disparos_hoje + 1,
        proximo_em_min: proxMin,
      }
    }
    return {
      empresa_id: empresaId,
      motivo: 'nao_aceito',
      instancias_pool: escolhaInstancia.total,
      total_disparos_hoje: escolhaInstancia.total_disparos_hoje,
    }
  } catch (e) {
    // Erro persistente (sem saudação/instância caída/cooldown): recua o próximo disparo
    // pelo intervalo p/ não re-tentar a cada tick (evita loop apertado no log).
    const proxMin = sortearIntervaloMinutos(cfg.intervalo_min, cfg.intervalo_max)
    await pool.query(
      `UPDATE app.banco_leads_config SET auto_proximo_disparo_em = $2, atualizado_em = NOW() WHERE empresa_id = $1`,
      [empresaId, new Date(now.getTime() + proxMin * 60_000)]
    ).catch(() => {})
    logger.warn({ operation: 'banco_leads_auto', empresa_id: empresaId, err: e.message, recuo_min: proxMin }, '[banco-leads-auto] disparo pulado')
    return {
      empresa_id: empresaId,
      motivo: 'erro',
      erro: e.message,
      instancias_pool: escolhaInstancia.total,
      total_disparos_hoje: escolhaInstancia.total_disparos_hoje,
    }
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
  listarPoolAutomatico,
  escolherInstanciaAutomatico,
  ordenarPoolAutomatico,
  totalDisparosPool,
  tetoPorInstanciaPool,
  cooldownRestanteInstancia,
  dentroDaJanela,
  sortearIntervaloMinutos,
  minutosDoDia,
  APP_TIMEZONE,
}
