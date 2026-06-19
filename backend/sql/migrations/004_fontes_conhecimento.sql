-- ============================================================================
-- Migration 004 — Camada de Fontes de Conhecimento (link, PDF, texto manual)
-- Idempotente.
--   Camada 1: app.empresa_fontes_conhecimento (raw + resumo IA por fonte)
--   Camada 1.5 (futura): app.empresa_conhecimento_chunks (criada vazia)
--   Ajustes em app.empresa_contextos: fontes_usadas_json + schema_version
--   Rename de chave do contexto_form_json: objeções_comuns → objecoes_comuns
-- ============================================================================

-- ─── app.empresa_fontes_conhecimento ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.empresa_fontes_conhecimento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  contexto_id       UUID REFERENCES app.empresa_contextos(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL CHECK (tipo IN ('site', 'pdf', 'documento', 'texto_manual')),
  url               TEXT,
  filename          TEXT,
  titulo            TEXT,
  conteudo_extraido TEXT,
  resumo_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'analisando', 'analisado', 'erro')),
  erro              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fontes_empresa_contexto
  ON app.empresa_fontes_conhecimento (empresa_id, contexto_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fontes_status
  ON app.empresa_fontes_conhecimento (empresa_id, status);

-- ─── app.empresa_conhecimento_chunks (estrutura pronta, populamos só na v2) ─
CREATE TABLE IF NOT EXISTS app.empresa_conhecimento_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  fonte_id    UUID NOT NULL REFERENCES app.empresa_fontes_conhecimento(id) ON DELETE CASCADE,
  titulo      TEXT,
  url         TEXT,
  chunk_text  TEXT,
  chunk_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_empresa_fonte
  ON app.empresa_conhecimento_chunks (empresa_id, fonte_id);

-- ─── app.empresa_contextos: novas colunas ────────────────────────────────────
ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS fontes_usadas_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS schema_version TEXT NOT NULL DEFAULT 'contexto1.v1';

-- ─── Rename de chave: objeções_comuns → objecoes_comuns ──────────────────────
-- Acentos em chave JSON funcionam mas quebram grep/log/parser. Padroniza ASCII.
UPDATE app.empresa_contextos
   SET contexto_form_json = (contexto_form_json - 'objeções_comuns')
                            || jsonb_build_object('objecoes_comuns', contexto_form_json->'objeções_comuns')
 WHERE contexto_form_json ? 'objeções_comuns';
