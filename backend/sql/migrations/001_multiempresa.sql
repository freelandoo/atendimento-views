-- Migration 001: Schema multiempresa
-- Segura para re-execução (idempotente). Nunca dropa tabelas ou colunas.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- ─── Tabela de controle de migrations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.schema_migrations (
  id          BIGSERIAL PRIMARY KEY,
  nome        TEXT NOT NULL UNIQUE,
  aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── app.empresas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.empresas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  plano         TEXT NOT NULL DEFAULT 'free',
  config        JSONB NOT NULL DEFAULT '{}',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_empresas_plano_chk CHECK (plano IN ('free', 'starter', 'pro', 'enterprise'))
);

-- ─── app.usuarios ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.usuarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  nome            TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user',
  ativo           BOOLEAN NOT NULL DEFAULT true,
  ultimo_login_em TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_usuarios_role_chk CHECK (role IN ('superadmin', 'admin', 'user'))
);

-- ─── app.usuarios_empresas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.usuarios_empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, empresa_id),
  CONSTRAINT app_usuarios_empresas_role_chk CHECK (role IN ('owner', 'admin', 'member'))
);

-- ─── app.empresa_contextos ─────────────────────────────────────────────────────
-- Contexto 1: texto livre inserido pelo usuário (briefing da empresa)
CREATE TABLE IF NOT EXISTS app.empresa_contextos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL DEFAULT 'Contexto Principal',
  conteudo      TEXT NOT NULL DEFAULT '',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── app.empresa_contexto_versoes ──────────────────────────────────────────────
-- Contexto 2: JSON gerado pela IA, versionado
CREATE TABLE IF NOT EXISTS app.empresa_contexto_versoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contexto_id   UUID NOT NULL REFERENCES app.empresa_contextos(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  versao        INT NOT NULL DEFAULT 1,
  conteudo_json JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'rascunho',
  gerado_por    TEXT NOT NULL DEFAULT 'ia',
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ativado_em    TIMESTAMPTZ,
  CONSTRAINT app_empresa_contexto_versoes_status_chk CHECK (status IN ('rascunho', 'ativo', 'arquivado'))
);

-- ─── app.empresa_fluxos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.empresa_fluxos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  config_json   JSONB NOT NULL DEFAULT '{}',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── app.empresa_whatsapp_instances ───────────────────────────────────────────
-- Mapeia evolution_instance → empresa (usado pelo webhook para resolver tenant)
CREATE TABLE IF NOT EXISTS app.empresa_whatsapp_instances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  evolution_instance  TEXT NOT NULL UNIQUE,
  nome                TEXT,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  config_json         JSONB NOT NULL DEFAULT '{}',
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── app.conversa_resumos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.conversa_resumos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  numero     TEXT NOT NULL,
  resumo     TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}',
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── app.lead_insights ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.lead_insights (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  numero     TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  conteudo   JSONB NOT NULL DEFAULT '{}',
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── empresa_id nas tabelas vendas.* ──────────────────────────────────────────
ALTER TABLE vendas.conversas             ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id);
ALTER TABLE vendas.lead_profiles         ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id);
ALTER TABLE vendas.followup_envios       ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id);
ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id);
ALTER TABLE vendas.ai_logs               ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id);

-- ─── Seed: empresa padrão PJ Codeworks ────────────────────────────────────────
-- UUID fixo para facilitar referências e scripts futuros
INSERT INTO app.empresas (id, nome, slug, plano)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'PJ Codeworks',
  'pj-codeworks',
  'enterprise'
)
ON CONFLICT (slug) DO NOTHING;

-- ─── Associar registros legados à empresa padrão ──────────────────────────────
UPDATE vendas.conversas
  SET empresa_id = '00000000-0000-0000-0000-000000000001'
  WHERE empresa_id IS NULL;

UPDATE vendas.lead_profiles
  SET empresa_id = '00000000-0000-0000-0000-000000000001'
  WHERE empresa_id IS NULL;

UPDATE vendas.followup_envios
  SET empresa_id = '00000000-0000-0000-0000-000000000001'
  WHERE empresa_id IS NULL;

UPDATE vendas.analises_pos_conversa
  SET empresa_id = '00000000-0000-0000-0000-000000000001'
  WHERE empresa_id IS NULL;

UPDATE vendas.ai_logs
  SET empresa_id = '00000000-0000-0000-0000-000000000001'
  WHERE empresa_id IS NULL;

-- ─── Índices em empresa_id nas tabelas vendas.* ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversas_empresa_id
  ON vendas.conversas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_empresa_id
  ON vendas.lead_profiles (empresa_id);
CREATE INDEX IF NOT EXISTS idx_followup_envios_empresa_id
  ON vendas.followup_envios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_empresa_id
  ON vendas.analises_pos_conversa (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_empresa_id
  ON vendas.ai_logs (empresa_id);

-- ─── Índices nas tabelas app.* ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_empresa
  ON app.usuarios_empresas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_usuario
  ON app.usuarios_empresas (usuario_id);
CREATE INDEX IF NOT EXISTS idx_empresa_contextos_empresa
  ON app.empresa_contextos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_empresa_contexto_versoes_empresa
  ON app.empresa_contexto_versoes (empresa_id);
CREATE INDEX IF NOT EXISTS idx_empresa_contexto_versoes_contexto
  ON app.empresa_contexto_versoes (contexto_id);
CREATE INDEX IF NOT EXISTS idx_empresa_fluxos_empresa
  ON app.empresa_fluxos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_empresa_whatsapp_instances_empresa
  ON app.empresa_whatsapp_instances (empresa_id);
CREATE INDEX IF NOT EXISTS idx_conversa_resumos_empresa_numero
  ON app.conversa_resumos (empresa_id, numero, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lead_insights_empresa_numero
  ON app.lead_insights (empresa_id, numero, criado_em DESC);
