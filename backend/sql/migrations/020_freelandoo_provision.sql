-- 020_freelandoo_provision.sql
-- Provisionamento automático vindo da Freelandoo (produto "Atendimento IA"):
-- a Freelandoo cunha os tokens e chama POST /freelandoo/provision. A conexão
-- ganha identidade externa (external_id = id_user da Freelandoo), o token da
-- API de Dados (para gerar/atualizar o playbook), o limite de tokens de LLM
-- por ciclo de cobrança e o contador de uso. Aditiva/idempotente.

ALTER TABLE app.freelandoo_connections
  ADD COLUMN IF NOT EXISTS external_id           TEXT,          -- id_user na Freelandoo
  ADD COLUMN IF NOT EXISTS token_data_enc        TEXT,          -- token flnd_data_ cifrado (playbook)
  ADD COLUMN IF NOT EXISTS token_limit_monthly   BIGINT,        -- limite de tokens LLM por ciclo (NULL = sem limite)
  ADD COLUMN IF NOT EXISTS cycle_start           TIMESTAMPTZ,   -- âncora do ciclo de cobrança
  ADD COLUMN IF NOT EXISTS tokens_used           BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS config_json           JSONB  NOT NULL DEFAULT '{}'::jsonb, -- { paused, answer_dm, answer_os, extra_instructions }
  ADD COLUMN IF NOT EXISTS playbook_generated_at TIMESTAMPTZ;

-- Uma conexão provisionada por conta Freelandoo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_freelandoo_conn_external
  ON app.freelandoo_connections (external_id)
  WHERE external_id IS NOT NULL;
