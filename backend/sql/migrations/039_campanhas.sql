-- 039_campanhas.sql
-- Modulo Prospeccao & Inteligencia Comercial — Fase 2 (fatia: Campanhas).
-- Campanha comercial "guarda-chuva": objetivo, hipotese, nicho, roteiro+versao, periodo,
-- metas, status. + responsaveis (N:N usuarios) + campanha_leads (N:N prospects, com STATUS
-- da oportunidade POR campanha). Enums travados por src/domain-enums.js + anti-drift.
-- Isolado por empresa (empresa_id NOT NULL em todas). FKs de nicho/roteiro/prospect existem
-- p/ integridade; a garantia SAME-TENANT e reforcada na camada de dados (src/db/campanhas.js).

CREATE TABLE IF NOT EXISTS app.campanhas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL,
  objetivo          TEXT,
  hipotese          TEXT,
  nicho_id          UUID REFERENCES app.nichos(id) ON DELETE SET NULL,
  roteiro_versao_id UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,  -- versao "oficial" da campanha
  data_inicio       DATE,
  data_fim          DATE,
  status            TEXT NOT NULL DEFAULT 'rascunho',
  meta_ligacoes     INT,
  meta_reunioes     INT,
  criado_por        UUID,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campanhas_status_chk CHECK (status IN ('rascunho', 'ativa', 'pausada', 'encerrada'))
);
CREATE INDEX IF NOT EXISTS idx_campanhas_empresa ON app.campanhas (empresa_id, status);

CREATE TABLE IF NOT EXISTS app.campanha_responsaveis (
  campanha_id UUID NOT NULL REFERENCES app.campanhas(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL,
  empresa_id  UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campanha_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_campanha_responsaveis_empresa ON app.campanha_responsaveis (empresa_id, usuario_id);

CREATE TABLE IF NOT EXISTS app.campanha_leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id    UUID NOT NULL REFERENCES app.campanhas(id) ON DELETE CASCADE,
  prospect_id    UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  empresa_id     UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'nao_iniciado',   -- OPORTUNIDADE_STATUS (por campanha)
  responsavel_id UUID,
  proxima_acao   TEXT,
  data_followup  TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campanha_leads_uq UNIQUE (campanha_id, prospect_id),
  CONSTRAINT campanha_leads_status_chk CHECK (status IN (
    'nao_iniciado', 'tentativa_contato', 'nao_atendeu', 'contato_realizado', 'em_descoberta',
    'qualificado', 'follow_up', 'reuniao_marcada', 'proposta_enviada', 'negociacao',
    'convertido', 'descartado'
  ))
);
CREATE INDEX IF NOT EXISTS idx_campanha_leads_campanha ON app.campanha_leads (campanha_id, status);
CREATE INDEX IF NOT EXISTS idx_campanha_leads_empresa ON app.campanha_leads (empresa_id);
