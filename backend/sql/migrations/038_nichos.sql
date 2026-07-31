-- 038_nichos.sql
-- Modulo Prospeccao & Inteligencia Comercial — Fase 2 (fatia: Nichos).
-- Catalogo de nichos ADMINISTRAVEL por empresa. Compativel com prospectador.prospects.nicho
-- (que segue como TEXTO livre): o catalogo casa por NOME; nicho_id nos leads e migracao
-- futura/gradual. Aditivo/idempotente. Isolado por empresa (empresa_id NOT NULL).

CREATE TABLE IF NOT EXISTS app.nichos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  descricao      TEXT,
  criterios_json JSONB NOT NULL DEFAULT '{}'::jsonb,  -- criterios de selecao (regiao, porte, sinais, etc.)
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_por     UUID,               -- app.usuarios (soft ref)
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nome unico por empresa (case-insensitive) — evita catalogo duplicado no mesmo tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nichos_empresa_nome ON app.nichos (empresa_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_nichos_empresa ON app.nichos (empresa_id, ativo);
