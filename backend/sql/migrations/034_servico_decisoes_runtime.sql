-- ============================================================================
-- Migration 034 - Decisoes de servico no runtime do Contexto 2
-- Idempotente e aditiva. Registra qual item do catalogo a IA detectou/ofereceu.
-- ============================================================================

ALTER TABLE app.lead_insights
  ADD COLUMN IF NOT EXISTS servicos_interesse_slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ultimo_servico_recomendado_slug TEXT,
  ADD COLUMN IF NOT EXISTS ultimo_servico_oferecido_slug TEXT,
  ADD COLUMN IF NOT EXISTS ultima_decisao_servico_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app.lead_servico_decisoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  contexto_id           UUID REFERENCES app.empresa_contextos(id) ON DELETE SET NULL,
  contexto_versao_id    UUID REFERENCES app.empresa_contexto_versoes(id) ON DELETE SET NULL,
  conversa_id           TEXT,
  numero                TEXT NOT NULL,
  contexto_servico_id   UUID REFERENCES app.contexto_servicos(id) ON DELETE SET NULL,
  servico_slug          TEXT NOT NULL DEFAULT '',
  servico_nome          TEXT NOT NULL DEFAULT '',
  tipo_decisao          TEXT NOT NULL,
  origem                TEXT NOT NULL DEFAULT 'ia',
  motivo                TEXT NOT NULL DEFAULT '',
  confianca             TEXT NOT NULL DEFAULT 'media',
  mensagem_lead         TEXT NOT NULL DEFAULT '',
  mensagem_ia           TEXT NOT NULL DEFAULT '',
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_servico_decisoes_tipo_chk
    CHECK (tipo_decisao IN ('interesse_detectado', 'recomendado', 'oferecido', 'mencionado', 'ambigua')),
  CONSTRAINT lead_servico_decisoes_origem_chk
    CHECK (origem IN ('ia', 'heuristica', 'operador')),
  CONSTRAINT lead_servico_decisoes_confianca_chk
    CHECK (confianca IN ('baixa', 'media', 'alta'))
);

CREATE INDEX IF NOT EXISTS idx_lead_servico_decisoes_empresa_numero
  ON app.lead_servico_decisoes (empresa_id, numero, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_servico_decisoes_empresa_servico
  ON app.lead_servico_decisoes (empresa_id, servico_slug, tipo_decisao, created_at DESC);
