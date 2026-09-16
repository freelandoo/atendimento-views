-- 079_lead_icp.sql
-- ICP comercial do lead: separado de cadastro e de prioridade operacional.
--
-- Regra de negocio:
--   * `score_cadastro` continua sendo completude de dados.
--   * `icp_score`/`icp_faixa` respondem "este lead parece o cliente certo?".
--   * fila/prioridade continuam calculadas pelos seus proprios services.
--
-- Fase 1: modelo Tenka v1.1 fixo, versionado e sem tela de configuracao.

CREATE TABLE IF NOT EXISTS prospectador.icp_modelos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID,
  nome            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  versao          INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ativo',
  criterios_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  cortes_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_por      UUID,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.icp_modelos
  DROP CONSTRAINT IF EXISTS icp_modelos_status_chk,
  DROP CONSTRAINT IF EXISTS icp_modelos_versao_chk;

ALTER TABLE prospectador.icp_modelos
  ADD CONSTRAINT icp_modelos_status_chk CHECK (status IN ('rascunho', 'ativo', 'arquivado')),
  ADD CONSTRAINT icp_modelos_versao_chk CHECK (versao > 0);

CREATE UNIQUE INDEX IF NOT EXISTS icp_modelos_global_slug_versao_uk
  ON prospectador.icp_modelos (slug, versao)
  WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS icp_modelos_empresa_status_idx
  ON prospectador.icp_modelos (empresa_id, status, slug, versao DESC);

INSERT INTO prospectador.icp_modelos
  (id, empresa_id, nome, slug, versao, status, criterios_json, cortes_json)
SELECT
  '11111111-1111-4111-8111-111111110079'::uuid,
  NULL,
  'Tenka v1.1',
  'tenka-v1-1',
  1,
  'ativo',
  '[
    {"id":"operacao_validada","rotulo":"Operacao validada","pontos":1,"tipo":"humano_auto"},
    {"id":"instagram_ativo","rotulo":"Instagram ativo","pontos":1,"tipo":"automatico"},
    {"id":"imagem_valor","rotulo":"Preocupacao com imagem","pontos":1,"tipo":"humano"},
    {"id":"investiu_marketing_tecnologia","rotulo":"Ja investiu em marketing/tecnologia","pontos":2,"tipo":"humano"},
    {"id":"crescimento","rotulo":"Esta em crescimento","pontos":2,"tipo":"humano"},
    {"id":"cliente_valor_relevante","rotulo":"Cliente/contrato de valor relevante","pontos":2,"tipo":"humano"},
    {"id":"lacuna_digital_clara","rotulo":"Lacuna digital clara","pontos":2,"tipo":"humano_auto"},
    {"id":"acesso_decisor","rotulo":"Acesso facil ao decisor","pontos":2,"tipo":"humano"}
  ]'::jsonb,
  '{"A":{"min":10,"max":13},"B":{"min":6,"max":9},"C":{"min":0,"max":5}}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM prospectador.icp_modelos
   WHERE empresa_id IS NULL AND slug = 'tenka-v1-1' AND versao = 1
);

CREATE TABLE IF NOT EXISTS prospectador.lead_icp_avaliacoes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL,
  prospect_id         UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  modelo_id           UUID NOT NULL REFERENCES prospectador.icp_modelos(id) ON DELETE RESTRICT,
  modelo_slug         TEXT NOT NULL,
  modelo_versao       INTEGER NOT NULL,
  score               SMALLINT NOT NULL,
  faixa               TEXT NOT NULL,
  decisao             TEXT NOT NULL,
  respostas_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  sinais_auto_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  motivos_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  observacao          TEXT,
  avaliado_por        UUID,
  avaliado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.lead_icp_avaliacoes
  DROP CONSTRAINT IF EXISTS lead_icp_score_chk,
  DROP CONSTRAINT IF EXISTS lead_icp_faixa_chk,
  DROP CONSTRAINT IF EXISTS lead_icp_decisao_chk;

ALTER TABLE prospectador.lead_icp_avaliacoes
  ADD CONSTRAINT lead_icp_score_chk CHECK (score BETWEEN 0 AND 13),
  ADD CONSTRAINT lead_icp_faixa_chk CHECK (faixa IN ('A', 'B', 'C', 'fora')),
  ADD CONSTRAINT lead_icp_decisao_chk CHECK (decisao IN ('aprovado', 'descartado', 'revisar'));

CREATE INDEX IF NOT EXISTS lead_icp_avaliacoes_prospect_idx
  ON prospectador.lead_icp_avaliacoes (empresa_id, prospect_id, avaliado_em DESC);

CREATE INDEX IF NOT EXISTS lead_icp_avaliacoes_faixa_idx
  ON prospectador.lead_icp_avaliacoes (empresa_id, faixa, avaliado_em DESC);

ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS icp_modelo_id     UUID REFERENCES prospectador.icp_modelos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS icp_score         SMALLINT,
  ADD COLUMN IF NOT EXISTS icp_faixa         TEXT,
  ADD COLUMN IF NOT EXISTS icp_avaliado_em   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS icp_avaliado_por  UUID,
  ADD COLUMN IF NOT EXISTS icp_resumo_json   JSONB;

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_icp_score_chk,
  DROP CONSTRAINT IF EXISTS prospects_icp_faixa_chk;

ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_icp_score_chk CHECK (icp_score IS NULL OR icp_score BETWEEN 0 AND 13),
  ADD CONSTRAINT prospects_icp_faixa_chk CHECK (icp_faixa IS NULL OR icp_faixa IN ('A', 'B', 'C', 'fora'));

CREATE INDEX IF NOT EXISTS idx_prospects_empresa_icp
  ON prospectador.prospects (empresa_id, icp_faixa, icp_score DESC, icp_avaliado_em DESC)
  WHERE icp_faixa IS NOT NULL;

COMMENT ON COLUMN prospectador.prospects.icp_score IS
  'Pontuacao ICP atual do lead. Separada de score_cadastro/completude e de prioridade operacional.';

COMMENT ON COLUMN prospectador.prospects.icp_faixa IS
  'Faixa ICP atual: A/B/C/fora. Indica aderencia ao cliente ideal, nao estado do cadastro.';
