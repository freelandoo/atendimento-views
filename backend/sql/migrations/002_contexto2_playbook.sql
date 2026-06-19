-- ============================================================================
-- Migration 002 — Contexto 2 como Playbook Comercial Operacional
-- Idempotente. Adiciona colunas + tabela de sugestões + colunas de lead_insights.
-- ============================================================================

-- ─── app.empresa_contextos ────────────────────────────────────────────────────
ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS contexto_form_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS schema_version TEXT NOT NULL DEFAULT 'contexto1.v1';

-- ─── app.empresa_contexto_versoes ────────────────────────────────────────────
ALTER TABLE app.empresa_contexto_versoes
  ADD COLUMN IF NOT EXISTS playbook_schema_version TEXT NOT NULL DEFAULT 'contexto2.playbook.v1';

ALTER TABLE app.empresa_contexto_versoes
  ADD COLUMN IF NOT EXISTS aprovado_por UUID;

ALTER TABLE app.empresa_contexto_versoes
  ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;

ALTER TABLE app.empresa_contexto_versoes
  ADD COLUMN IF NOT EXISTS conteudo_markdown TEXT;

-- ─── app.empresa_contexto_sugestoes ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.empresa_contexto_sugestoes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  contexto_versao_id   UUID REFERENCES app.empresa_contexto_versoes(id) ON DELETE SET NULL,
  conversa_id          TEXT,
  lead_phone           TEXT,
  tipo                 TEXT NOT NULL,
  evidencia            TEXT NOT NULL,
  impacto_comercial    TEXT,
  sugestao_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  sugestao_markdown    TEXT,
  confianca            TEXT NOT NULL DEFAULT 'media',
  status               TEXT NOT NULL DEFAULT 'pendente',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID,
  CONSTRAINT app_sugestoes_status_chk    CHECK (status IN ('pendente','aprovada','rejeitada','aplicada')),
  CONSTRAINT app_sugestoes_confianca_chk CHECK (confianca IN ('baixa','media','alta'))
);

CREATE INDEX IF NOT EXISTS idx_sugestoes_empresa_status
  ON app.empresa_contexto_sugestoes (empresa_id, status, created_at DESC);

-- ─── app.lead_insights — extensão para runtime do playbook ───────────────────
ALTER TABLE app.lead_insights
  ADD COLUMN IF NOT EXISTS conversa_id            TEXT,
  ADD COLUMN IF NOT EXISTS lead_phone             TEXT,
  ADD COLUMN IF NOT EXISTS dados_extraidos        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS campos_coletados_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS campos_faltantes_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ultima_intencao        TEXT,
  ADD COLUMN IF NOT EXISTS ultima_etapa           TEXT,
  ADD COLUMN IF NOT EXISTS proxima_melhor_acao    TEXT,
  ADD COLUMN IF NOT EXISTS temperatura            TEXT,
  ADD COLUMN IF NOT EXISTS score                  NUMERIC,
  ADD COLUMN IF NOT EXISTS objecoes               JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dores                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS servicos_interesse     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS orcamento_status       TEXT,
  ADD COLUMN IF NOT EXISTS reuniao_status         TEXT,
  ADD COLUMN IF NOT EXISTS proximas_acoes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confianca_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_insights_empresa_numero
  ON app.lead_insights (empresa_id, numero)
  WHERE tipo = 'playbook_runtime';

CREATE INDEX IF NOT EXISTS idx_lead_insights_empresa_phone
  ON app.lead_insights (empresa_id, lead_phone);
