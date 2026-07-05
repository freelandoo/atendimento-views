'use strict'

// Acesso a dados da conexão Freelandoo (token/segredo cifrados) e da fila de
// idempotência do webhook. Cifra na escrita e decifra na leitura — o token e o
// webhook_secret NUNCA transitam em texto puro fora deste módulo + crypto.js.

const { pool } = require('../db')
const { encrypt, decrypt } = require('../freelandoo/crypto')

// Grava/atualiza a conexão da instância (upsert por instance_id).
async function salvarConexao(client, {
  instanceId, empresaId, baseUrl, token, webhookSecret,
  connectionId, connectionName, username, scopePersonal, webhookUrl, meta,
}) {
  const db = client || pool
  const { rows: [row] } = await db.query(
    `INSERT INTO app.freelandoo_connections
       (instance_id, empresa_id, base_url, api_token_enc, webhook_secret_enc,
        connection_id, connection_name, username, scope_personal, webhook_url, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (instance_id) DO UPDATE SET
       base_url           = EXCLUDED.base_url,
       api_token_enc      = EXCLUDED.api_token_enc,
       webhook_secret_enc = COALESCE(EXCLUDED.webhook_secret_enc, app.freelandoo_connections.webhook_secret_enc),
       connection_id      = EXCLUDED.connection_id,
       connection_name    = EXCLUDED.connection_name,
       username           = EXCLUDED.username,
       scope_personal     = EXCLUDED.scope_personal,
       webhook_url        = EXCLUDED.webhook_url,
       meta_json          = EXCLUDED.meta_json,
       atualizado_em      = NOW()
     RETURNING instance_id`,
    [
      instanceId, empresaId, baseUrl,
      encrypt(token),
      webhookSecret !== undefined ? encrypt(webhookSecret) : null,
      connectionId || null, connectionName || null, username || null,
      typeof scopePersonal === 'boolean' ? scopePersonal : null,
      webhookUrl || null, JSON.stringify(meta || {}),
    ]
  )
  return row
}

// Só o webhook_secret cifrado (após registrar o webhook).
async function atualizarWebhook(instanceId, { webhookSecret, webhookUrl }) {
  await pool.query(
    `UPDATE app.freelandoo_connections
        SET webhook_secret_enc = $2, webhook_url = COALESCE($3, webhook_url), atualizado_em = NOW()
      WHERE instance_id = $1`,
    [instanceId, webhookSecret !== undefined ? encrypt(webhookSecret) : null, webhookUrl || null]
  )
}

function _shapeConexao(c) {
  return {
    instanceId: c.instance_id,
    empresaId: c.empresa_id,
    baseUrl: c.base_url,
    token: c.api_token_enc ? decrypt(c.api_token_enc) : null,
    webhookSecret: c.webhook_secret_enc ? decrypt(c.webhook_secret_enc) : null,
    connectionName: c.connection_name,
    username: c.username,
    scopePersonal: c.scope_personal,
    webhookUrl: c.webhook_url,
    evolutionInstance: c.evolution_instance,
    ativo: c.ativo,
    contextoId: c.contexto_id,
    // Provisionamento Atendimento IA (mig 020)
    externalId: c.external_id || null,
    tokenData: c.token_data_enc ? decrypt(c.token_data_enc) : null,
    tokenLimitMonthly: c.token_limit_monthly !== null && c.token_limit_monthly !== undefined
      ? Number(c.token_limit_monthly) : null,
    cycleStart: c.cycle_start || null,
    tokensUsed: Number(c.tokens_used || 0),
    config: c.config_json || {},
    playbookGeneratedAt: c.playbook_generated_at || null,
  }
}

// Conexão descriptografada (uso interno: webhook/responder). Retorna null se não existe.
async function buscarConexaoDescriptografada(instanceId) {
  const { rows: [c] } = await pool.query(
    `SELECT fc.*, ewi.evolution_instance, ewi.ativo, ewi.contexto_id,
            ewi.empresa_id AS empresa_id_inst
       FROM app.freelandoo_connections fc
       JOIN app.empresa_whatsapp_instances ewi ON ewi.id = fc.instance_id
      WHERE fc.instance_id = $1`,
    [instanceId]
  )
  if (!c) return null
  return _shapeConexao(c)
}

// Conexão provisionada pela Freelandoo (Atendimento IA), por id_user externo.
async function buscarConexaoPorExternalId(externalId) {
  const { rows: [c] } = await pool.query(
    `SELECT fc.*, ewi.evolution_instance, ewi.ativo, ewi.contexto_id,
            ewi.empresa_id AS empresa_id_inst
       FROM app.freelandoo_connections fc
       JOIN app.empresa_whatsapp_instances ewi ON ewi.id = fc.instance_id
      WHERE fc.external_id = $1`,
    [externalId]
  )
  if (!c) return null
  return _shapeConexao(c)
}

// Campos do provisionamento (tokens re-cunhados chegam cifrados aqui; campos
// undefined = manter o valor atual). Se o cycle_start mudou, ZERA o contador.
async function atualizarProvisionamento(instanceId, {
  externalId, token, tokenData, tokenLimitMonthly, cycleStart, config,
}) {
  await pool.query(
    `UPDATE app.freelandoo_connections
        SET external_id         = COALESCE($2, external_id),
            api_token_enc       = COALESCE($3, api_token_enc),
            token_data_enc      = COALESCE($4, token_data_enc),
            token_limit_monthly = COALESCE($5, token_limit_monthly),
            tokens_used         = CASE
                                    WHEN $6::timestamptz IS NOT NULL
                                     AND (cycle_start IS NULL OR cycle_start <> $6::timestamptz)
                                    THEN 0 ELSE tokens_used END,
            cycle_start         = COALESCE($6, cycle_start),
            config_json         = COALESCE($7::jsonb, config_json),
            atualizado_em       = NOW()
      WHERE instance_id = $1`,
    [
      instanceId,
      externalId || null,
      token !== undefined && token !== null ? encrypt(token) : null,
      tokenData !== undefined && tokenData !== null ? encrypt(tokenData) : null,
      tokenLimitMonthly !== undefined && tokenLimitMonthly !== null ? tokenLimitMonthly : null,
      cycleStart || null,
      config !== undefined ? JSON.stringify(config) : null,
    ]
  )
}

// Soma tokens de LLM gastos num turno (contador do ciclo).
async function somarTokensUsados(instanceId, tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0))
  if (!n) return
  await pool.query(
    `UPDATE app.freelandoo_connections
        SET tokens_used = tokens_used + $2, atualizado_em = NOW()
      WHERE instance_id = $1`,
    [instanceId, n]
  )
}

async function marcarPlaybookGerado(instanceId) {
  await pool.query(
    `UPDATE app.freelandoo_connections
        SET playbook_generated_at = NOW(), atualizado_em = NOW()
      WHERE instance_id = $1`,
    [instanceId]
  )
}

// Instâncias provisionadas ativas com token de dados (para o refresh diário).
async function listarProvisionadasAtivas() {
  const { rows } = await pool.query(
    `SELECT fc.instance_id
       FROM app.freelandoo_connections fc
       JOIN app.empresa_whatsapp_instances ewi ON ewi.id = fc.instance_id
      WHERE fc.external_id IS NOT NULL
        AND fc.token_data_enc IS NOT NULL
        AND ewi.ativo = TRUE`
  )
  return rows.map((r) => r.instance_id)
}

// Lista para a UI: instância + metadados da conexão, SEM segredos.
async function listarConexoesPorEmpresa(empresaId) {
  const { rows } = await pool.query(
    `SELECT ewi.id, ewi.evolution_instance, ewi.nome, ewi.ativo,
            ewi.contexto_id, ewi.config_json,
            c.nome AS contexto_nome,
            fc.connection_name, fc.username, fc.scope_personal, fc.webhook_url,
            fc.criado_em AS conectado_em
       FROM app.freelandoo_connections fc
       JOIN app.empresa_whatsapp_instances ewi ON ewi.id = fc.instance_id
       LEFT JOIN app.empresa_contextos c ON c.id = ewi.contexto_id
      WHERE fc.empresa_id = $1
      ORDER BY fc.criado_em DESC`,
    [empresaId]
  )
  return rows
}

// ─── Fila / idempotência do webhook ────────────────────────────────────────────
// Registra o evento recebido. Retorna { novo: true } só na 1ª vez (retry = false).
async function registrarEventoRecebido({ idMessage, instanceId, conversationId, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO app.freelandoo_webhook_events (id_message, instance_id, conversation_id, payload_json)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (id_message) DO NOTHING
     RETURNING id`,
    [idMessage, instanceId || null, conversationId || null, JSON.stringify(payload || {})]
  )
  return { novo: rows.length > 0, id: rows[0]?.id || null }
}

async function marcarEventoProcessado(idMessage) {
  await pool.query(
    `UPDATE app.freelandoo_webhook_events
        SET status='processado', processado_em=NOW(), tentativas = tentativas + 1
      WHERE id_message = $1`,
    [idMessage]
  )
}

async function marcarEventoErro(idMessage, erro) {
  await pool.query(
    `UPDATE app.freelandoo_webhook_events
        SET status='erro', ultimo_erro=$2, tentativas = tentativas + 1
      WHERE id_message = $1`,
    [idMessage, String(erro || '').slice(0, 500)]
  )
}

module.exports = {
  salvarConexao,
  atualizarWebhook,
  buscarConexaoDescriptografada,
  buscarConexaoPorExternalId,
  atualizarProvisionamento,
  somarTokensUsados,
  marcarPlaybookGerado,
  listarProvisionadasAtivas,
  listarConexoesPorEmpresa,
  registrarEventoRecebido,
  marcarEventoProcessado,
  marcarEventoErro,
}
