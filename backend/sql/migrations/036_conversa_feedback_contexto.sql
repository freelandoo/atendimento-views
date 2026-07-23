-- 036_conversa_feedback_contexto.sql
-- Feedback humano em respostas do agente, com sugestao supervisionada para Contexto 2.

CREATE TABLE IF NOT EXISTS app.conversa_feedbacks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  conversa_id         TEXT,
  lead_phone          TEXT NOT NULL,
  evolution_instance  TEXT,
  mensagem_index      INTEGER NOT NULL,
  mensagem_hash       TEXT NOT NULL,
  tipo                TEXT NOT NULL,
  tags                JSONB NOT NULL DEFAULT '[]'::jsonb,
  observacao          TEXT,
  mensagem_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  contexto_versao_id  UUID REFERENCES app.empresa_contexto_versoes(id) ON DELETE SET NULL,
  sugestao_id         UUID REFERENCES app.empresa_contexto_sugestoes(id) ON DELETE SET NULL,
  criado_por          UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversa_feedbacks_tipo_chk CHECK (tipo IN ('positivo','negativo')),
  CONSTRAINT conversa_feedbacks_mensagem_index_chk CHECK (mensagem_index >= 0)
);

ALTER TABLE app.conversa_feedbacks
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT;

ALTER TABLE app.conversa_feedbacks
  ADD COLUMN IF NOT EXISTS sugestao_id UUID REFERENCES app.empresa_contexto_sugestoes(id) ON DELETE SET NULL;

ALTER TABLE app.empresa_contexto_sugestoes
  ADD COLUMN IF NOT EXISTS feedback_id UUID REFERENCES app.conversa_feedbacks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversa_feedbacks_empresa_created
  ON app.conversa_feedbacks (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversa_feedbacks_empresa_lead
  ON app.conversa_feedbacks (empresa_id, lead_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sugestoes_feedback
  ON app.empresa_contexto_sugestoes (feedback_id)
  WHERE feedback_id IS NOT NULL;
