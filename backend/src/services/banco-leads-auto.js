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
  COOLDOWN_MIN, instanciasVinculadasDosLeads, vinculoDoTelefone,
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
const RESUMIR_RECONCILIACAO_A_CADA_FALHAS = 15
const autoScanOffsets = new Map()
let workerTickRodando = false
const saudeWorker = {
  estado: 'nao_iniciado',
  iniciado_em: null,
  ultima_execucao_em: null,
  ultima_execucao_bem_sucedida_em: null,
  ultima_falha_em: null,
  falhas_consecutivas: 0,
  reconciliacao: {
    estado: 'desconhecido',
    codigo_erro: null,
    primeira_falha_em: null,
    ultima_falha_em: null,
    falhas_consecutivas: 0,
  },
}

function isoAgora(now = new Date()) {
  return now.toISOString()
}

function erroMessageUpdateIndisponivel(err) {
  return err?.code === 'evolution_message_update_missing'
}

function registrarFalhaReconciliacao(err, now = new Date()) {
  const instante = isoAgora(now)
  const codigo = String(err?.code || 'evolution_reconciliation_failed')
  const anterior = saudeWorker.reconciliacao
  const mesmaFalha = anterior.estado === 'indisponivel' && anterior.codigo_erro === codigo
  const falhas = mesmaFalha ? anterior.falhas_consecutivas + 1 : 1
  saudeWorker.reconciliacao = {
    estado: 'indisponivel',
    codigo_erro: codigo,
    primeira_falha_em: mesmaFalha ? anterior.primeira_falha_em : instante,
    ultima_falha_em: instante,
    falhas_consecutivas: falhas,
  }
  saudeWorker.estado = 'degradado'

  // O primeiro erro e resumos periódicos continuam visíveis sem transformar um problema
  // conhecido a cada minuto em uma enxurrada de logs idênticos.
  if (falhas === 1 || falhas % RESUMIR_RECONCILIACAO_A_CADA_FALHAS === 0) {
    logger.error({
      component: 'evolution-reconciliation',
      event: 'reconciliation_failed',
      error_code: codigo,
      retryable: false,
      impact: 'message_confirmation_unavailable',
      worker_id: REPLICA_ID,
      consecutive_failures: falhas,
      first_failure_at: saudeWorker.reconciliacao.primeira_falha_em,
      err,
    }, '[banco-leads-auto] reconciliação Evolution indisponível; automático segue em modo degradado')
  }
  return { ...saudeWorker.reconciliacao }
}

function registrarSucessoReconciliacao(now = new Date()) {
  const anterior = saudeWorker.reconciliacao
  if (anterior.estado === 'indisponivel') {
    logger.info({
      component: 'evolution-reconciliation',
      event: 'reconciliation_recovered',
      worker_id: REPLICA_ID,
      previous_error_code: anterior.codigo_erro,
      previous_consecutive_failures: anterior.falhas_consecutivas,
      recovered_at: isoAgora(now),
    }, '[banco-leads-auto] reconciliação Evolution recuperada')
  }
  saudeWorker.reconciliacao = {
    estado: 'saudavel',
    codigo_erro: null,
    primeira_falha_em: null,
    ultima_falha_em: null,
    falhas_consecutivas: 0,
  }
}

function registrarFalhaWorker(err, now = new Date()) {
  saudeWorker.estado = 'falhando'
  saudeWorker.ultima_falha_em = isoAgora(now)
  saudeWorker.falhas_consecutivas += 1
  if (saudeWorker.falhas_consecutivas === 1
    || saudeWorker.falhas_consecutivas % RESUMIR_RECONCILIACAO_A_CADA_FALHAS === 0) {
    logger.error({
      component: 'banco-leads-auto-worker',
      event: 'worker_tick_failed',
      error_code: String(err?.code || 'worker_tick_failed'),
      retryable: true,
      impact: 'automatic_dispatch_interrupted',
      worker_id: REPLICA_ID,
      consecutive_failures: saudeWorker.falhas_consecutivas,
      err,
    }, '[banco-leads-auto] tick interrompido antes de concluir')
  }
}

function registrarSucessoWorker(now = new Date(), degradado = false) {
  if (saudeWorker.falhas_consecutivas > 0) {
    logger.info({
      component: 'banco-leads-auto-worker',
      event: 'worker_tick_recovered',
      worker_id: REPLICA_ID,
      previous_consecutive_failures: saudeWorker.falhas_consecutivas,
      recovered_at: isoAgora(now),
      mode: degradado ? 'degradado' : 'saudavel',
    }, '[banco-leads-auto] execução do tick recuperada')
  }
  saudeWorker.estado = degradado ? 'degradado' : 'saudavel'
  saudeWorker.ultima_execucao_bem_sucedida_em = isoAgora(now)
  saudeWorker.falhas_consecutivas = 0
}

function obterSaudeBancoLeadsWorker() {
  return {
    estado: saudeWorker.estado,
    iniciado_em: saudeWorker.iniciado_em,
    ultima_execucao_em: saudeWorker.ultima_execucao_em,
    ultima_execucao_bem_sucedida_em: saudeWorker.ultima_execucao_bem_sucedida_em,
    ultima_falha_em: saudeWorker.ultima_falha_em,
    falhas_consecutivas: saudeWorker.falhas_consecutivas,
    reconciliacao: { ...saudeWorker.reconciliacao },
  }
}

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

/**
 * O erro recusa ESTA instancia (vale tentar a proxima do rodizio) ou o ciclo inteiro?
 *
 * Lista FECHADA: desconexao na Evolution, instancia nao comprovada (inativa/outra empresa/outro
 * canal) e 429 de cooldown/teto sao estados DAQUELE numero. Qualquer outro erro — falha de IA,
 * lead inelegivel, banco fora — valeria igual em todas as instancias: tentar de novo ali seria
 * repetir a mesma falha N vezes e, pior, poderia reservar o mesmo lead em dois numeros.
 */
function erroDaInstancia(err) {
  if (!err) return false
  if (err.code === 'instance_disconnected') return true
  if (err.code === 'INSTANCIA_NAO_COMPROVADA' || err.instanciaBloqueada === true) return true
  return err.statusCode === 429
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
    // A FILA inteira, na ordem do rodizio. Quem consome tenta a seguinte quando a primeira
    // recusa por motivo DA INSTANCIA (desconectada, inativa, cooldown/teto) — perder o ciclo
    // por causa de um numero fora do ar deixava o pool com a vazao de um pool menor.
    fila: disponiveis,
    motivo: 'ok',
    total: poolInstancias.length,
    disponiveis: disponiveis.length,
    menor_cooldown_s: 0,
    total_disparos_hoje: totalDisparosHoje,
  }
}

/**
 * O WHERE que define CANDIDATO do Automatico — fonte UNICA.
 *
 * A varredura que ESCOLHE o lead e a contagem que a TELA mostra precisam do mesmo recorte: duas
 * copias fariam o painel prometer uma fila que o worker nao enxerga (ou o contrario). Espera
 * `$1 = empresa_id` e `$2 = lista de status`; o parametro do nicho e' acrescentado ao array
 * recebido, para servir aos dois chamadores sem fixar numeracao.
 *
 * NAO inclui o que so se decide lead a lead — janela local do pais, compliance/opt-out e
 * continuidade da instancia. Quem le a contagem tem de saber que ela e' o universo ANTES
 * desses tres filtros, e a tela diz isso em texto.
 */
function whereCandidatosAutomatico(recorte, params) {
  let filtroNicho = ''
  if (recorte.modo === 'nicho') {
    params.push(recorte.nicho)
    const nichoParam = params.length
    filtroNicho = `AND (
            LOWER(BTRIM(COALESCE(p.nicho, ''))) = LOWER(BTRIM($${nichoParam}::text))
            OR LOWER(BTRIM(COALESCE(p.categoria_perfil, ''))) = LOWER(BTRIM($${nichoParam}::text))
          )`
  }
  return `p.empresa_id = $1
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
          )`
}

/** Quantos leads o recorte atual alcanca. SOMENTE LEITURA — nao reserva e nao dispara nada. */
async function contarCandidatosAutomatico(pool, empresaId, cfg = {}) {
  const params = [empresaId, [...STATUS_RODAVEL]]
  const where = whereCandidatosAutomatico(recorteAutomatico(cfg), params)
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM prospectador.prospects p WHERE ${where}`,
    params
  )
  return Number(rows[0]?.total || 0)
}

async function buscarPrimeiroLeadElegivel(pool, empresaId, statusList, deps = {}) {
  const canProspectLeadFn = deps.canProspectLeadFn || canProspectLead
  const avaliarJanelaLocalLeadFn = deps.avaliarJanelaLocalLeadFn || avaliarJanelaLocalLead
  const vinculosFn = deps.instanciasVinculadasFn || instanciasVinculadasDosLeads
  // Lista FECHADA de instancias aptas a enviar neste ciclo. Ausente = chamador que nao escolhe
  // instancia (teste direto); ai a continuidade nao e julgada aqui — quem julga e' o enviador.
  const instanciasAceitas = Array.isArray(deps.instanciasDisponiveis)
    ? new Set(deps.instanciasDisponiveis.filter(Boolean).map(String))
    : null
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
    const whereCandidatos = whereCandidatosAutomatico(recorte, params)
    const { rows } = await pool.query(
      `SELECT p.id, p.telefone, p.pais, p.cidade, p.endereco FROM prospectador.prospects p
        WHERE ${whereCandidatos}
        ORDER BY (p.qualificacao = 'aprovado') DESC, p.score DESC NULLS LAST, p.created_at ASC, p.id ASC
        LIMIT $3 OFFSET $4`,
      params
    )
    paginas++
    // Vinculo provado de cada candidato desta pagina, em UMA consulta (nunca N+1).
    const vinculos = instanciasAceitas
      ? await vinculosFn(pool, empresaId, rows.map((r) => r.telefone))
      : null

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
      // CONTINUIDADE vence o rodizio. Se o lead ja fala com um numero desta empresa, ele so
      // pode ser atendido por aquele numero; se aquele numero nao esta apto agora, o lead e
      // PULADO e a varredura segue. Trocar o numero seria quebrar o atendimento que existe.
      if (instanciasAceitas) {
        const vinculada = vinculoDoTelefone(vinculos, candidato.telefone)
        if (vinculada && !instanciasAceitas.has(vinculada)) {
          somarMotivo(motivos, 'instancia_vinculada_indisponivel')
          continue
        }
        candidato.instancia_vinculada = vinculada || null
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
    // Mesmo recorte (geral/nicho) do modo Automático: a empresa está em um único `modo` por
    // vez, então as colunas auto_* servem aos dois sem conflito.
    recorteModo: cfg.auto_recorte_modo,
    autoNicho: cfg.auto_nicho,
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
  const fila = Array.isArray(escolhaInstancia.fila) && escolhaInstancia.fila.length
    ? escolhaInstancia.fila
    : [instancia]
  const scan = await buscarPrimeiroLeadElegivel(pool, empresaId, statusList, {
    ...deps,
    autoRecorte: cfg,
    now,
    instanciasDisponiveis: fila.map((i) => i.evolution_instance),
  })
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

  // Ordem de tentativa. Lead VINCULADO tem exatamente UMA candidata — a instancia dele; se
  // ela nao estiver na fila, o lead nem chega aqui (a varredura o pulou). Lead novo percorre o
  // rodizio: motivo DA INSTANCIA passa para a seguinte, motivo DO LEAD encerra o ciclo.
  const tentativas = lead.instancia_vinculada
    ? fila.filter((i) => i.evolution_instance === lead.instancia_vinculada)
    : fila
  if (!tentativas.length) {
    return {
      empresa_id: empresaId,
      motivo: 'instancia_vinculada_indisponivel',
      lead_id: lead.id,
      instancia_vinculada: lead.instancia_vinculada,
      instancias_pool: escolhaInstancia.total,
      total_disparos_hoje: escolhaInstancia.total_disparos_hoje,
    }
  }

  let instanciaUsada = tentativas[0]
  const recusasDeInstancia = []
  try {
    let res = null
    for (const candidata of tentativas) {
      instanciaUsada = candidata
      try {
        res = await rodarLeadsFn(pool, {
          empresaId, usuarioId: null, instanciaId: candidata.id, prospectIds: [lead.id],
        })
        break
      } catch (err) {
        if (!erroDaInstancia(err) || candidata === tentativas[tentativas.length - 1]) throw err
        recusasDeInstancia.push({ instancia: candidata.evolution_instance, erro: err.message })
        logger.warn({
          operation: 'banco_leads_auto',
          empresa_id: empresaId,
          instancia: candidata.evolution_instance,
          err: err.message,
        }, '[banco-leads-auto] instancia recusou o ciclo; tentando a proxima do pool')
      }
    }
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
        instancia_id: instanciaUsada.id,
        evolution_instance: instanciaUsada.evolution_instance,
        continuidade: Boolean(lead.instancia_vinculada),
        instancias_recusaram: recusasDeInstancia.length ? recusasDeInstancia : undefined,
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

/**
 * Diagnostico das instancias WhatsApp da empresa — TODAS, nao so as do rodizio.
 *
 * O painel precisa dizer por que um numero NAO esta no pool ("desativado", "sem saudacao"), e
 * um numero que simplesmente nao aparece na lista e' indistinguivel de um numero que nao existe.
 * Esta leitura NAO decide quem entra no rodizio: a autoridade continua sendo
 * `listarPoolAutomatico`; aqui so se explica a ausencia.
 */
async function listarInstanciasDiagnostico(pool, empresaId) {
  const { rows } = await pool.query(
    `SELECT i.id, i.evolution_instance, i.nome, i.ativo, i.principal,
            NULLIF(BTRIM(COALESCE(i.config_json->>'saudacao', '')), '') IS NOT NULL AS tem_saudacao,
            COALESCE(i.config_json->>'canal', 'whatsapp') AS canal,
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
        AND COALESCE(i.config_json->>'canal', 'whatsapp') <> 'freelandoo'
      GROUP BY i.id, i.evolution_instance, i.nome, i.ativo, i.principal, i.config_json
      ORDER BY i.principal DESC, i.criado_em ASC`,
    [empresaId]
  )
  return rows
}

/** Por que este numero esta fora do rodizio. Lista FECHADA, sem texto livre. */
function motivoForaDoRodizio(inst) {
  if (inst.ativo !== true) return 'desativada'
  if (inst.tem_saudacao !== true) return 'sem_saudacao'
  return 'fora_do_pool'
}

/**
 * ESTADO REAL do modo Automatico de uma empresa — SOMENTE LEITURA.
 *
 * Nao escolhe lead, nao reserva disparo, nao chama a Evolution e nao mexe em
 * `auto_proximo_disparo_em`: abrir o painel nao pode mudar o que o painel mostra. A ORDEM dos
 * estados espelha a do worker (`_autoEmpresa`) de proposito — um painel que decidisse em outra
 * ordem mostraria um motivo diferente do que de fato segura o ciclo.
 */
async function estadoAutomatico(pool, empresaId, now = new Date(), deps = {}) {
  const cfg = await obterConfigBancoLeads(pool, empresaId)
  const recorte = recorteAutomatico(cfg)
  const escolha = await escolherInstanciaAutomatico(pool, empresaId, now, cfg, deps)
  const candidatos = await (deps.contarCandidatosFn || contarCandidatosAutomatico)(pool, empresaId, cfg)
  const todas = await (deps.listarInstanciasDiagnosticoFn || listarInstanciasDiagnostico)(pool, empresaId)

  const noRodizio = new Set((escolha.fila || []).map((i) => String(i.evolution_instance)))
  const tetoPorInstancia = tetoPorInstanciaPool(cfg.teto_diario, escolha.total || 0)
  const instancias = todas.map((inst) => {
    const cooldown = cooldownRestanteInstancia(inst, now)
    const apta = noRodizio.has(String(inst.evolution_instance))
    let motivo = null
    if (!apta) {
      if (inst.ativo === true && inst.tem_saudacao === true && cooldown > 0) motivo = 'aguardando_cooldown'
      else if (inst.ativo === true && inst.tem_saudacao === true && tetoPorInstancia > 0
        && Number(inst.disparos_hoje || 0) >= tetoPorInstancia) motivo = 'teto_da_instancia'
      else motivo = motivoForaDoRodizio(inst)
    }
    return {
      id: inst.id,
      nome: inst.nome || inst.evolution_instance,
      evolution_instance: inst.evolution_instance,
      principal: inst.principal === true,
      ativo: inst.ativo === true,
      tem_saudacao: inst.tem_saudacao === true,
      disparos_hoje: Number(inst.disparos_hoje || 0),
      ultimo_disparo_em: inst.ultimo_disparo_em || null,
      cooldown_restante_s: cooldown,
      teto_instancia: tetoPorInstancia > 0 ? tetoPorInstancia : null,
      no_rodizio: apta,
      motivo_fora: motivo,
    }
  })

  const proximo = cfg.auto_proximo_disparo_em ? new Date(cfg.auto_proximo_disparo_em) : null
  const proximoValido = proximo && !Number.isNaN(proximo.getTime()) ? proximo : null
  const aguardandoIntervalo = Boolean(proximoValido && now < proximoValido)

  let estado
  if (cfg.modo !== 'automatico') estado = 'modo_manual'
  else if (!cfg.auto_ativo) estado = 'pausado'
  else if (aguardandoIntervalo) estado = 'aguardando_intervalo'
  else if (escolha.motivo !== 'ok') estado = escolha.motivo
  else if (candidatos <= 0) estado = 'sem_lead_elegivel'
  else estado = 'pronto'

  return {
    modo: cfg.modo,
    auto_ativo: cfg.auto_ativo === true,
    estado,
    janela_inicio: cfg.janela_inicio,
    janela_fim: cfg.janela_fim,
    intervalo_min: cfg.intervalo_min,
    intervalo_max: cfg.intervalo_max,
    teto_diario: cfg.teto_diario,
    timezone: APP_TIMEZONE,
    proximo_disparo_em: proximoValido ? proximoValido.toISOString() : null,
    segundos_para_proximo: aguardandoIntervalo
      ? Math.ceil((proximoValido.getTime() - now.getTime()) / 1000)
      : 0,
    recorte: { modo: recorte.modo, nicho: recorte.nicho },
    // "Candidatos", nunca "elegiveis": janela local, compliance e continuidade da instancia so
    // se decidem lead a lead, na hora. A tela declara isso.
    leads_candidatos: candidatos,
    total_disparos_hoje: escolha.total_disparos_hoje || 0,
    instancias_no_rodizio: escolha.total || 0,
    instancias_disponiveis: escolha.disponiveis || 0,
    menor_cooldown_s: escolha.menor_cooldown_s,
    instancias,
    saude_worker: obterSaudeBancoLeadsWorker(),
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
  saudeWorker.ultima_execucao_em = isoAgora(now)
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

    let confirmacoes
    let reconciliacaoDegradada = false
    try {
      confirmacoes = await reconciliar(pool)
      registrarSucessoReconciliacao(now)
    } catch (err) {
      // Esta indisponibilidade impede apenas a auditoria da confirmação. Os disparos que já
      // chegaram à Evolution continuam pendentes e nunca voltam à fila por essa via; por isso é
      // seguro avaliar NOVOS candidatos sem duplicar os existentes. Erros diferentes seguem
      // interrompendo o tick: banco, SQL ou regra de negócio não podem ser escondidos aqui.
      if (!erroMessageUpdateIndisponivel(err)) throw err
      reconciliacaoDegradada = true
      const saude = registrarFalhaReconciliacao(err, now)
      confirmacoes = {
        estado: 'indisponivel',
        motivo: 'evolution_message_update_missing',
        falhas_consecutivas: saude.falhas_consecutivas,
      }
    }
    const [semi, automatico] = await Promise.all([
      verificarSemi(pool, deps),
      verificarAuto(pool, now, deps),
    ])
    registrarSucessoWorker(now, reconciliacaoDegradada)
    return {
      ok: true,
      motivo: reconciliacaoDegradada ? 'executado_degradado' : 'executado',
      confirmacoes,
      semi,
      automatico,
    }
  } catch (err) {
    registrarFalhaWorker(err, now)
    throw err
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
  saudeWorker.estado = 'iniciado'
  saudeWorker.iniciado_em = isoAgora()
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
  contarCandidatosAutomatico,
  whereCandidatosAutomatico,
  estadoAutomatico,
  listarInstanciasDiagnostico,
  erroDaInstancia,
  erroMessageUpdateIndisponivel,
  obterSaudeBancoLeadsWorker,
  dentroDaJanela,
  sortearIntervaloMinutos,
  minutosDoDia,
  APP_TIMEZONE,
}
