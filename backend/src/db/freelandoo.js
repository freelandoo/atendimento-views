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

// Conexão descriptografada (uso interno: webhook/responder). Retorna null se não existe.
async function buscarConexaoDescriptografada(instanceId) {
  const { rows: [c] } = await pool.query(
    `SELECT fc.*, ewi.evolution_instance, ewi.ativo, ewi.empresa_id AS empresa_id_inst
       FROM app.freelandoo_connections fc
       JOIN app.empresa_whatsapp_instances ewi ON ewi.id = fc.instance_id
      WHERE fc.instance_id = $1`,
    [instanceId]
  )
  if (!c) return null
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
  }
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
  listarConexoesPorEmpresa,
  registrarEventoRecebido,
  marcarEventoProcessado,
  marcarEventoErro,
}
