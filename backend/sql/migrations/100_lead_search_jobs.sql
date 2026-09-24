-- 100_lead_search_jobs.sql
-- API de busca de leads/provisao de dados — Fase 1.
-- Cria a base de jobs assincronos, fontes, dossies, bruto interno e auditoria de uso.

CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app.lead_search_api_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID REFERENCES app.empresas(id) ON DELETE SET NULL,
  nome                  TEXT NOT NULL,
  key_hash              TEXT NOT NULL UNIQUE,
  key_hint              TEXT NOT NULL,
  scopes                TEXT[] NOT NULL DEFAULT ARRAY['lead_search:maps:create','lead_search:jobs:read']::text[],
  status                TEXT NOT NULL DEFAULT 'active',
  max_leads_per_job     INT NOT NULL DEFAULT 100,
  rate_limit_per_minute INT NOT NULL DEFAULT 10,
  expires_at            TIMESTAMPTZ,
  created_by_usuario_id UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  revoked_by_usuario_id UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_api_keys_status_chk CHECK (status IN ('active', 'revoked')),
  CONSTRAINT lead_search_api_keys_max_leads_chk CHECK (max_leads_per_job BETWEEN 1 AND 100),
  CONSTRAINT lead_search_api_keys_rate_limit_chk CHECK (rate_limit_per_minute BETWEEN 1 AND 60),
  CONSTRAINT lead_search_api_keys_nome_chk CHECK (length(trim(nome)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_search_api_keys_empresa_created
  ON app.lead_search_api_keys (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_search_api_keys_status
  ON app.lead_search_api_keys (status, expires_at);

CREATE TABLE IF NOT EXISTS app.lead_search_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id      UUID,
  api_key_id      UUID REFERENCES app.lead_search_api_keys(id) ON DELETE SET NULL,
  entry_source    TEXT NOT NULL,
  request         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'queued',
  requested_limit INT NOT NULL,
  returned_count  INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_jobs_entry_source_chk
    CHECK (entry_source IN ('maps', 'instagram', 'facebook_page', 'meta_ads')),
  CONSTRAINT lead_search_jobs_status_chk
    CHECK (status IN ('queued', 'running', 'partial_completed', 'completed', 'failed', 'cancelled', 'expired')),
  CONSTRAINT lead_search_jobs_requested_limit_chk
    CHECK (requested_limit BETWEEN 1 AND 100),
  CONSTRAINT lead_search_jobs_returned_count_chk
    CHECK (returned_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_search_jobs_empresa_created
  ON app.lead_search_jobs (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_search_jobs_status_created
  ON app.lead_search_jobs (status, created_at ASC);

CREATE TABLE IF NOT EXISTS app.lead_search_job_sources (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               UUID NOT NULL REFERENCES app.lead_search_jobs(id) ON DELETE CASCADE,
  source               TEXT NOT NULL,
  source_state         TEXT NOT NULL DEFAULT 'not_checked',
  provider_status      TEXT,
  external_snapshot_id TEXT,
  records_requested    INT NOT NULL DEFAULT 0,
  records_returned     INT NOT NULL DEFAULT 0,
  cost_records         INT NOT NULL DEFAULT 0,
  error_type           TEXT,
  error_message        TEXT,
  raw_progress         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_job_sources_source_chk
    CHECK (source IN ('google_maps', 'instagram_serp', 'instagram_profile', 'facebook_page', 'meta_ads')),
  CONSTRAINT lead_search_job_sources_state_chk
    CHECK (source_state IN ('not_checked', 'found', 'not_found', 'provider_failed', 'empty')),
  CONSTRAINT lead_search_job_sources_records_chk
    CHECK (records_requested >= 0 AND records_returned >= 0 AND cost_records >= 0),
  CONSTRAINT lead_search_job_sources_job_source_uk UNIQUE (job_id, source)
);

CREATE INDEX IF NOT EXISTS idx_lead_search_sources_snapshot
  ON app.lead_search_job_sources (external_snapshot_id)
  WHERE external_snapshot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.lead_search_raw_refs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES app.lead_search_jobs(id) ON DELETE CASCADE,
  source_id   UUID REFERENCES app.lead_search_job_sources(id) ON DELETE SET NULL,
  source      TEXT NOT NULL,
  item_index  INT NOT NULL DEFAULT 0,
  external_id TEXT,
  raw_path    TEXT NOT NULL DEFAULT 'payload',
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_raw_refs_source_chk
    CHECK (source IN ('google_maps', 'instagram_serp', 'instagram_profile', 'facebook_page', 'meta_ads')),
  CONSTRAINT lead_search_raw_refs_item_index_chk CHECK (item_index >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_search_raw_refs_job_source
  ON app.lead_search_raw_refs (job_id, source, item_index);

CREATE TABLE IF NOT EXISTS app.lead_search_dossiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES app.lead_search_jobs(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  primary_source TEXT NOT NULL,
  external_ref  TEXT,
  canonical     JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_dossiers_primary_source_chk
    CHECK (primary_source IN ('google_maps', 'instagram_serp', 'instagram_profile', 'facebook_page', 'meta_ads'))
);

CREATE INDEX IF NOT EXISTS idx_lead_search_dossiers_job_created
  ON app.lead_search_dossiers (job_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_search_dossiers_job_source_external
  ON app.lead_search_dossiers (job_id, primary_source, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.lead_search_usage_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id        UUID,
  api_key_id        UUID REFERENCES app.lead_search_api_keys(id) ON DELETE SET NULL,
  job_id            UUID REFERENCES app.lead_search_jobs(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'internal',
  event_type        TEXT NOT NULL,
  endpoint          TEXT,
  request_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL,
  records_requested INT NOT NULL DEFAULT 0,
  records_returned  INT NOT NULL DEFAULT 0,
  error_code        TEXT,
  contexto          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_search_usage_channel_chk CHECK (channel IN ('internal', 'external')),
  CONSTRAINT lead_search_usage_status_chk
    CHECK (status IN ('accepted', 'completed', 'failed', 'blocked', 'expired_key', 'quota_exceeded', 'provider_failed')),
  CONSTRAINT lead_search_usage_records_chk CHECK (records_requested >= 0 AND records_returned >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lead_search_usage_empresa_created
  ON app.lead_search_usage_events (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_search_usage_job
  ON app.lead_search_usage_events (job_id, created_at DESC);
