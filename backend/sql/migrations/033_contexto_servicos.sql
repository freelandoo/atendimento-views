-- ============================================================================
-- Migration 033 - Catalogo estruturado de servicos por contexto
-- Idempotente e aditiva. Nao remove nem altera campos legados do Contexto 1.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.contexto_servicos (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                 UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  contexto_id                UUID NOT NULL REFERENCES app.empresa_contextos(id) ON DELETE CASCADE,
  slug                       TEXT NOT NULL,
  nome                       TEXT NOT NULL,
  categoria                  TEXT NOT NULL DEFAULT '',
  descricao_curta            TEXT NOT NULL DEFAULT '',
  descricao_completa         TEXT NOT NULL DEFAULT '',
  indicado_para              JSONB NOT NULL DEFAULT '[]'::jsonb,
  problemas_que_resolve      JSONB NOT NULL DEFAULT '[]'::jsonb,
  beneficios                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  perguntas_qualificacao     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sinais_para_recomendar     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sinais_para_nao_recomendar JSONB NOT NULL DEFAULT '[]'::jsonb,
  preco_texto                TEXT NOT NULL DEFAULT '',
  prazo_texto                TEXT NOT NULL DEFAULT '',
  link_relacionado           TEXT NOT NULL DEFAULT '',
  origem                     TEXT NOT NULL DEFAULT 'ia',
  fontes_json                JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflitos_json             JSONB NOT NULL DEFAULT '[]'::jsonb,
  confianca                  TEXT NOT NULL DEFAULT 'media',
  status_revisao             TEXT NOT NULL DEFAULT 'ia_preencheu',
  ativo                      BOOLEAN NOT NULL DEFAULT true,
  ordem                      INT NOT NULL DEFAULT 0,
  criado_em                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contexto_servicos_status_revisao_chk
    CHECK (status_revisao IN ('ia_preencheu', 'revisado', 'precisa_revisao')),
  CONSTRAINT contexto_servicos_confianca_chk
    CHECK (confianca IN ('baixa', 'media', 'alta')),
  CONSTRAINT contexto_servicos_origem_chk
    CHECK (origem IN ('ia', 'manual', 'freelandoo', 'importado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contexto_servicos_contexto_slug
  ON app.contexto_servicos (contexto_id, slug);

CREATE INDEX IF NOT EXISTS idx_contexto_servicos_empresa_contexto
  ON app.contexto_servicos (empresa_id, contexto_id, ativo, ordem);
