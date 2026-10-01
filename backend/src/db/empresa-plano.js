'use strict'
// Acesso a banco da camada de PLANO (migrations 114/115). As REGRAS (mapa plano->recursos,
// veredito de status, mapa evento->status) vivem nos modulos PUROS plano-definicao.js e
// asaas-eventos.js; aqui so' ha SQL.
const { pool } = require('../db')
const { planoPermite, avaliarAcesso } = require('../services/plano-definicao')

// Cache curto do veredito "o plano desta empresa permite IA automática?" — lido no caminho MAIS
// quente (uma vez por mensagem). Mesmo padrão do pause cache (db/empresas.js): TTL de 30s e
// FAIL-OPEN (erro de leitura nunca bloqueia resposta). O plano muda raramente (webhook/conversão),
// então 30s de atraso na propagação é aceitável — e as escritas abaixo invalidam na hora.
const _iaCache = new Map() // empresaId -> { permitida, at }
const IA_TTL_MS = 30_000

function invalidarCachePlano(empresaId) {
  if (empresaId) _iaCache.delete(empresaId)
  else _iaCache.clear()
}

// Veredito cacheado por empresa: { ia_auto, followup_auto } — "o plano permite cada automação?".
// Sem linha = grandfather (tudo true). Com linha: precisa estar LIBERADO (não cancelado/expirado/
// trial-vencido) E o plano permitir o recurso. Fail-open em erro (tudo true).
async function _recursosDaEmpresa(empresaId) {
  const LIBERA_TUDO = { ia_auto: true, followup_auto: true }
  if (!empresaId) return LIBERA_TUDO
  const c = _iaCache.get(empresaId)
  if (c && Date.now() - c.at < IA_TTL_MS) return c.recursos
  try {
    const { rows } = await pool.query(
      'SELECT plano, status, trial_fim FROM app.empresa_plano WHERE empresa_id = $1',
      [empresaId]
    )
    const row = rows[0]
    const liberado = !row || avaliarAcesso({ status: row.status, trialFim: row.trial_fim }).liberado
    const recursos = !row
      ? LIBERA_TUDO
      : { ia_auto: liberado && planoPermite(row.plano, 'ia_auto'), followup_auto: liberado && planoPermite(row.plano, 'followup_auto') }
    _iaCache.set(empresaId, { recursos, at: Date.now() })
    return recursos
  } catch (_) {
    return LIBERA_TUDO // fail-open: nunca derruba a resposta/automação por erro de leitura
  }
}

async function iaAutoPermitida(empresaId) {
  return (await _recursosDaEmpresa(empresaId)).ia_auto
}
async function followupAutoPermitido(empresaId) {
  return (await _recursosDaEmpresa(empresaId)).followup_auto
}

async function obterPlano(empresaId) {
  const { rows } = await pool.query(
    `SELECT empresa_id, plano, status, trial_fim, asaas_customer_id, asaas_subscription_id,
            origem, criado_em, atualizado_em
       FROM app.empresa_plano WHERE empresa_id = $1`,
    [empresaId]
  )
  return rows[0] || null
}

// Processa um evento do webhook ASAAS, ATOMICO e idempotente:
//  1. tenta registrar o evento (dedup por chave) — se ja' existe, nao faz nada ('novo=false');
//  2. aplica o status na empresa casada por subscription/customer id;
//  3. tudo numa transacao: se o UPDATE falhar, o evento NAO fica registrado e a ASAAS reenvia.
// Retorna { novo, empresaId }. empresaId=null quando nenhuma empresa casou (conta desconhecida —
// normal antes de a conversao/outbound ter gravado os ids ASAAS).
async function processarEventoAsaas({ chave, tipo, status, subscriptionId, customerId }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ins = await client.query(
      `INSERT INTO app.asaas_webhook_events (chave, tipo)
       VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING RETURNING chave`,
      [chave, tipo]
    )
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK')
      return { novo: false, empresaId: null }
    }
    const upd = await client.query(
      `UPDATE app.empresa_plano
          SET status = $1, atualizado_em = now()
        WHERE ($2::text IS NOT NULL AND asaas_subscription_id = $2)
           OR ($3::text IS NOT NULL AND asaas_customer_id = $3)
        RETURNING empresa_id`,
      [status, subscriptionId, customerId]
    )
    const empresaId = upd.rows[0] ? upd.rows[0].empresa_id : null
    if (empresaId) {
      await client.query('UPDATE app.asaas_webhook_events SET empresa_id = $1 WHERE chave = $2', [empresaId, chave])
    }
    await client.query('COMMIT')
    if (empresaId) invalidarCachePlano(empresaId) // status mudou → enforcement imediato
    return { novo: true, empresaId }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Grava o vínculo ASAAS (customer+subscription) e o plano escolhido na conversão. NÃO muda o
// `status` — este só vira 'ativo' quando o pagamento for confirmado pelo webhook. Fail-safe:
// cria a linha se por acaso não existir (ON CONFLICT).
async function vincularAsaas(empresaId, { customerId, subscriptionId, plano }) {
  const { rows } = await pool.query(
    `INSERT INTO app.empresa_plano (empresa_id, plano, status, trial_fim, origem, asaas_customer_id, asaas_subscription_id)
     VALUES ($1, $2, 'trial', now() + interval '7 days', 'manual', $3, $4)
     ON CONFLICT (empresa_id) DO UPDATE
       SET plano = EXCLUDED.plano,
           asaas_customer_id = EXCLUDED.asaas_customer_id,
           asaas_subscription_id = EXCLUDED.asaas_subscription_id,
           atualizado_em = now()
     RETURNING empresa_id, plano, status, asaas_customer_id, asaas_subscription_id`,
    [empresaId, plano, customerId, subscriptionId]
  )
  invalidarCachePlano(empresaId) // plano mudou → enforcement imediato
  return rows[0] || null
}

module.exports = { obterPlano, processarEventoAsaas, vincularAsaas, iaAutoPermitida, followupAutoPermitido, invalidarCachePlano }
