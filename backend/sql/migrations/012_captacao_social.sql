-- 012_captacao_social.sql
-- Captação de leads por REDE SOCIAL (Instagram agora; LinkedIn no mesmo motor),
-- reaproveitando a mesma pipeline da prospecção Google (prospects → fila → disparo →
-- conversa → temperatura). Mudança ADITIVA e idempotente.
--
-- O QUE FAZ:
--   1) Generaliza a IDENTIDADE de prospectador.prospects: place_id deixa de ser
--      obrigatório (era do Google) e entra UNIQUE(empresa_id, origem, external_ref)
--      como nova chave de dedup por fonte. A dedup do Google (empresa_id, place_id)
--      continua intacta; ganha companhia.
--   2) Amplia os CHECKs de `origem` (+instagram, +linkedin) e `status` (+coletado,
--      +contato_encontrado, +nao_contatar) sem quebrar o pipeline atual.
--   3) Adiciona campos de perfil social (email, instagram_handle, bio, link_bio,
--      categoria_perfil, seguidores).
--   4) Cria captacao_campanhas (hashtags/termos por empresa) e captacao_snapshots
--      (fila assíncrona + controle de orçamento Bright Data).
--
-- SEGURANÇA DE BOOT: os CHECKs de prospects vivem dentro de CREATE TABLE IF NOT EXISTS
-- (init.sql + db.js), então NÃO são reaplicados a cada boot em bancos existentes —
-- esta migration é a fonte de verdade. (Diferente de job_queue, que é dropado/recriado
-- no boot; por isso a captação NÃO usa job_queue.)

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    RETURN; -- prospects ainda não existe (boot muito cedo); init.sql cria depois.
  END IF;

  -- (1) place_id deixa de ser obrigatório (lead social não tem place_id).
  EXECUTE 'ALTER TABLE prospectador.prospects ALTER COLUMN place_id DROP NOT NULL';

  -- (1) Nova chave de dedup por fonte. PARCIAL: só vale quando external_ref existe,
  -- então linhas do Google (external_ref NULL) ficam de fora e não colidem.
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS external_ref TEXT';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_empresa_origem_ref
           ON prospectador.prospects (empresa_id, origem, external_ref)
           WHERE external_ref IS NOT NULL';

  -- (3) Campos de perfil social.
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS email TEXT';
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS instagram_handle TEXT';
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS bio TEXT';
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS link_bio TEXT';
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS categoria_perfil TEXT';
  EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS seguidores INTEGER';

  -- (2) Amplia CHECK de origem (+instagram, +linkedin). NOT VALID: não revalida o
  -- histórico (já está dentro do conjunto antigo).
  EXECUTE 'ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_origem_chk';
  EXECUTE $chk$
    ALTER TABLE prospectador.prospects ADD CONSTRAINT prospects_origem_chk
    CHECK (origem IN ('manual','automatico','instagram','linkedin')) NOT VALID
  $chk$;

  -- (2) Amplia CHECK de status com os estágios pré-contato do funil social.
  EXECUTE 'ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_status_chk';
  EXECUTE $chk$
    ALTER TABLE prospectador.prospects ADD CONSTRAINT prospects_status_chk
    CHECK (status IN (
      'aguardando','aprovado','rejeitado','enviado','respondeu',
      'coletado','contato_encontrado','nao_contatar'
    )) NOT VALID
  $chk$;

  -- Índices de apoio à listagem do funil social.
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_prospects_origem_status
           ON prospectador.prospects (origem, status, updated_at DESC)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_prospects_email
           ON prospectador.prospects (email) WHERE email IS NOT NULL';
END $$;

-- (4) Campanhas de captação (hashtags/termos por empresa e por fonte).
CREATE TABLE IF NOT EXISTS prospectador.captacao_campanhas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES app.empresas(id),
  fonte        TEXT NOT NULL DEFAULT 'instagram',
  termo        TEXT NOT NULL,              -- hashtag (sem '#') ou palavra-chave
  nicho        TEXT,
  cidade       TEXT,
  teto_diario  INTEGER NOT NULL DEFAULT 50,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  ultima_coleta_em TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT captacao_campanhas_fonte_chk CHECK (fonte IN ('instagram','linkedin')),
  CONSTRAINT captacao_campanhas_teto_chk CHECK (teto_diario BETWEEN 1 AND 5000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_captacao_campanha_empresa_fonte_termo
  ON prospectador.captacao_campanhas (empresa_id, fonte, lower(termo));
CREATE INDEX IF NOT EXISTS idx_captacao_campanhas_empresa_ativo
  ON prospectador.captacao_campanhas (empresa_id, ativo);

-- (4) Snapshots Bright Data = fila assíncrona + auditoria de orçamento.
--   etapa: 'descoberta' (hashtag→posts/usernames) | 'perfis' (usernames→profiles).
--   status: 'pendente' | 'processando' | 'concluido' | 'falhou'.
CREATE TABLE IF NOT EXISTS prospectador.captacao_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES app.empresas(id),
  campanha_id   UUID REFERENCES prospectador.captacao_campanhas(id) ON DELETE SET NULL,
  fonte         TEXT NOT NULL DEFAULT 'instagram',
  etapa         TEXT NOT NULL DEFAULT 'descoberta',
  snapshot_id   TEXT,                      -- id retornado pela Bright Data
  termo         TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente',
  custo_registros INTEGER NOT NULL DEFAULT 0,
  total_prospects INTEGER NOT NULL DEFAULT 0,
  erro          TEXT,
  payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- input + estado intermediário
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT captacao_snapshots_fonte_chk CHECK (fonte IN ('instagram','linkedin')),
  CONSTRAINT captacao_snapshots_etapa_chk CHECK (etapa IN ('descoberta','perfis')),
  CONSTRAINT captacao_snapshots_status_chk CHECK (status IN ('pendente','processando','concluido','falhou'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_captacao_snapshot_id
  ON prospectador.captacao_snapshots (snapshot_id) WHERE snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_captacao_snapshots_pendentes
  ON prospectador.captacao_snapshots (status, created_at) WHERE status IN ('pendente','processando');
CREATE INDEX IF NOT EXISTS idx_captacao_snapshots_empresa_dia
  ON prospectador.captacao_snapshots (empresa_id, created_at DESC);

-- Canal de e-mail (Fase futura, já com dados gravados): registro de envios por lead.
CREATE TABLE IF NOT EXISTS prospectador.email_outreach (
  id            BIGSERIAL PRIMARY KEY,
  empresa_id    UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES app.empresas(id),
  prospect_id   UUID REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  assunto       TEXT,
  corpo         TEXT,
  status        TEXT NOT NULL DEFAULT 'agendado',
  provider_id   TEXT,
  erro          TEXT,
  enviado_em    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_outreach_status_chk CHECK (status IN ('agendado','enviado','falhou','desativado'))
);

CREATE INDEX IF NOT EXISTS idx_email_outreach_prospect
  ON prospectador.email_outreach (prospect_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_outreach_prospect_email
  ON prospectador.email_outreach (prospect_id, lower(email))
  WHERE status IN ('agendado','enviado');
