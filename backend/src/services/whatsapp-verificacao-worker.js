'use strict'

const os = require('node:os')
const { logger } = require('../logger')
const { numeroEnvioWhatsapp, verificarNumerosWhatsapp } = require('../whatsapp')

const WORKER_MS = Math.max(30000, parseInt(process.env.WHATSAPP_VERIFICACAO_WORKER_MS, 10) || 300000)
const BATCH_POR_EMPRESA = Math.min(Math.max(parseInt(process.env.WHATSAPP_VERIFICACAO_BATCH, 10) || 20, 1), 50)
const REPLICA_ID = process.env.REPLICA_ID || process.env.RAILWAY_REPLICA_ID || os.hostname()
const LOCK_KEY = 'whatsapp-verificacao-worker'

let tickRodando = false
let timer = null

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

async function listarInstanciasElegiveis(pool) {
  const { rows } = await pool.query(
    `WITH ativas AS (
       SELECT id, empresa_id, evolution_instance,
              COUNT(*) OVER (PARTITION BY empresa_id) AS total_ativas
         FROM app.empresa_whatsapp_instances
        WHERE ativo = true
          AND COALESCE(config_json->>'canal', 'whatsapp') <> 'freelandoo'
     ),
     configuradas AS (
       SELECT a.empresa_id, a.id, a.evolution_instance, 'configurada'::text AS origem
         FROM app.banco_leads_config c
         JOIN ativas a ON a.id = c.auto_instancia_id
     ),
     unicas AS (
       SELECT empresa_id, id, evolution_instance, 'unica_ativa'::text AS origem
         FROM ativas
        WHERE total_ativas = 1
     )
     SELECT * FROM configuradas
     UNION ALL
     SELECT u.*
       FROM unicas u
      WHERE NOT EXISTS (
        SELECT 1 FROM configuradas c WHERE c.empresa_id = u.empresa_id
      )
     ORDER BY empresa_id`
  )
  return rows
}

async function buscarLeadsPendentes(pool, empresaId, limite = BATCH_POR_EMPRESA) {
  const { rows } = await pool.query(
    `SELECT id, telefone
       FROM prospectador.prospects
      WHERE empresa_id = $1
        AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NOT NULL
        AND tem_whatsapp IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT $2`,
    [empresaId, limite]
  )
  return rows
}

async function aplicarVeredito(pool, empresaId, lead, veredito, instanceName) {
  if (!veredito || typeof veredito.exists !== 'boolean') return false
  const numero = numeroEnvioWhatsapp(lead.telefone)
  if (!numero) return false
  const { rowCount } = await pool.query(
    `UPDATE prospectador.prospects
        SET tem_whatsapp = $4,
            raw_json = jsonb_set(
              COALESCE(raw_json, '{}'::jsonb),
              '{whatsapp_verificacao}',
              jsonb_build_object(
                'em', NOW(),
                'origem', 'evolution_whatsapp_numbers',
                'instance', $5::text,
                'numero', $3::text,
                'jid', $6::text,
                'lid', $7::text
              ),
              true
            ),
            updated_at = NOW()
      WHERE empresa_id = $1
        AND id = $2::uuid
        AND telefone = $8::text
        AND tem_whatsapp IS NULL`,
    [
      empresaId,
      lead.id,
      numero,
      veredito.exists,
      instanceName,
      veredito.jid || null,
      veredito.lid || null,
      lead.telefone,
    ]
  )
  return rowCount > 0
}

async function verificarEmpresa(pool, instancia, deps = {}) {
  const verificar = deps.verificarNumerosWhatsapp || verificarNumerosWhatsapp
  const leads = await buscarLeadsPendentes(pool, instancia.empresa_id, deps.batchPorEmpresa || BATCH_POR_EMPRESA)
  if (!leads.length) return { empresa_id: instancia.empresa_id, verificados: 0, com_whatsapp: 0, sem_whatsapp: 0, pendentes: 0 }

  const numeros = leads.map((lead) => lead.telefone)
  const vereditos = await verificar(numeros, instancia.evolution_instance)
  if (vereditos === null) {
    return { empresa_id: instancia.empresa_id, verificados: 0, com_whatsapp: 0, sem_whatsapp: 0, pendentes: leads.length, falhou: true }
  }

  let comWhatsapp = 0
  let semWhatsapp = 0
  let atualizados = 0
  for (const lead of leads) {
    const numero = numeroEnvioWhatsapp(lead.telefone)
    const veredito = numero ? vereditos.get(numero) : null
    if (!veredito) continue
    const aplicou = await aplicarVeredito(pool, instancia.empresa_id, lead, veredito, instancia.evolution_instance)
    if (!aplicou) continue
    atualizados++
    if (veredito.exists) comWhatsapp++
    else semWhatsapp++
  }

  return {
    empresa_id: instancia.empresa_id,
    verificados: atualizados,
    com_whatsapp: comWhatsapp,
    sem_whatsapp: semWhatsapp,
    pendentes: Math.max(0, leads.length - atualizados),
  }
}

async function tickVerificacaoWhatsapp(pool, deps = {}) {
  if (tickRodando) return { skipped: true, motivo: 'tick_em_andamento' }
  tickRodando = true
  try {
    const lider = await (deps.adquirirLiderancaWorker || adquirirLiderancaWorker)(pool)
    if (!lider) return { skipped: true, motivo: 'sem_lideranca' }

    const instancias = await (deps.listarInstanciasElegiveis || listarInstanciasElegiveis)(pool)
    const resultados = []
    for (const instancia of instancias) {
      resultados.push(await verificarEmpresa(pool, instancia, deps))
    }
    const verificados = resultados.reduce((acc, r) => acc + (r.verificados || 0), 0)
    if (verificados > 0) {
      logger.info({ verificados, empresas: resultados.length }, '[whatsapp-verificacao] leads verificados')
    }
    return { skipped: false, resultados }
  } catch (err) {
    logger.warn({ err: err.message }, '[whatsapp-verificacao] tick falhou')
    return { skipped: true, motivo: 'erro', erro: err.message }
  } finally {
    tickRodando = false
  }
}

function iniciarWhatsappVerificacaoWorker(pool) {
  if (timer) return timer
  timer = setInterval(() => {
    tickVerificacaoWhatsapp(pool).catch((err) => logger.warn({ err: err.message }, '[whatsapp-verificacao] tick rejeitado'))
  }, WORKER_MS)
  tickVerificacaoWhatsapp(pool).catch((err) => logger.warn({ err: err.message }, '[whatsapp-verificacao] primeiro tick rejeitado'))
  return timer
}

module.exports = {
  WORKER_MS,
  BATCH_POR_EMPRESA,
  listarInstanciasElegiveis,
  buscarLeadsPendentes,
  aplicarVeredito,
  verificarEmpresa,
  tickVerificacaoWhatsapp,
  iniciarWhatsappVerificacaoWorker,
}
