-- 019_freelandoo_channel.sql
-- Canal "Freelandoo" como uma INSTÂNCIA de atendimento, no mesmo molde do WhatsApp.
-- A instância em si continua vivendo em app.empresa_whatsapp_instances (dono do
-- contexto 1:1, do "usa agenda?" e do flag ativo). Estas tabelas só adicionam a
-- CONEXÃO com a API da Freelandoo (token/segredo cifrados) e a fila de idempotência
-- do webhook. Aditiva/idempotente — não toca dados existentes nem constraints.

-- Credenciais da conexão Freelandoo, 1:1 com a instância de atendimento.
CREATE TABLE IF NOT EXISTS app.freelandoo_connections (
  instance_id        UUID PRIMARY KEY
                       REFERENCES app.empresa_whatsapp_instances(id) ON DELETE CASCADE,
  empresa_id         UUID NOT NULL,
  base_url           TEXT NOT NULL,
  api_token_enc      TEXT NOT NULL,          -- cifrado (AES-256-GCM)
  webhook_secret_enc TEXT,                   -- cifrado; valida a assinatura do webhook
  connection_id      TEXT,                   -- id_connection retornado pelo GET /me
  connection_name    TEXT,                   -- name da conexão
  username           TEXT,                   -- user.username
  scope_personal     BOOLEAN,                -- inclui mensagens pessoais?
  webhook_url        TEXT,                   -- URL registrada no POST /webhook
  meta_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_freelandoo_conn_empresa
  ON app.freelandoo_connections (empresa_id);

-- Fila/idempotência do webhook. Cada mensagem RECEBIDA vira um evento; o
-- id_message garante que retries reprocessem o MESMO evento uma única vez.
CREATE TABLE IF NOT EXISTS app.freelandoo_webhook_events (
  id              BIGSERIAL PRIMARY KEY,
  id_message      TEXT NOT NULL UNIQUE,
  instance_id     UUID REFERENCES app.empresa_whatsapp_instances(id) ON DELETE SET NULL,
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente|processado|erro
  tentativas      INTEGER NOT NULL DEFAULT 0,
  ultimo_erro     TEXT,
  payload_json    JSONB,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_freelandoo_events_status
  ON app.freelandoo_webhook_events (status, criado_em);
