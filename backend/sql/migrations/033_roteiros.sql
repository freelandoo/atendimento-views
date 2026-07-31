-- 033_roteiros.sql
-- Modulo Prospeccao & Inteligencia Comercial — Fase 0 (fatia: Roteiros humanos versionados).
-- Roteiro comercial ESTRUTURADO e VERSIONADO, por empresa. Espelha o padrao de versionamento
-- de app.empresa_contexto_versoes (migration 001). NAO confundir com o "roteiro do bot"
-- (Contexto 2 / prompts). Aditivo/idempotente. Enums travados por src/domain-enums.js +
-- test/domain-enums.test.js (anti-drift Set×CHECK).
--
-- Regra de imutabilidade (aplicada na camada de dados, src/db/roteiros.js):
--   versao com status='publicada' NUNCA muda; editar cria uma NOVA versao (rascunho).
--   Cada ligacao (fase futura) guardara roteiro_versao_id -> historico nunca se altera.

-- Cabecalho do roteiro (agrupa versoes).
CREATE TABLE IF NOT EXISTS app.roteiros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  nicho         TEXT,               -- por ora TEXTO (compat com prospects.nicho); nicho_id vem em fase futura
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID,               -- app.usuarios (soft ref; sem FK p/ nao acoplar)
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roteiros_empresa ON app.roteiros (empresa_id, ativo);

-- Versao do roteiro (imutavel apos publicada).
CREATE TABLE IF NOT EXISTS app.roteiro_versoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roteiro_id    UUID NOT NULL REFERENCES app.roteiros(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,  -- desnormalizado p/ filtro/isolamento
  versao        INT  NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'rascunho',   -- rascunho | publicada | arquivada
  criado_por    UUID,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publicada_em  TIMESTAMPTZ,
  arquivada_em  TIMESTAMPTZ,
  CONSTRAINT roteiro_versoes_versao_uq UNIQUE (roteiro_id, versao),
  CONSTRAINT roteiro_versoes_status_chk CHECK (status IN ('rascunho', 'publicada', 'arquivada'))
);
CREATE INDEX IF NOT EXISTS idx_roteiro_versoes_empresa ON app.roteiro_versoes (empresa_id, roteiro_id);

-- Etapas ordenadas de UMA versao (imutaveis junto com a versao publicada).
CREATE TABLE IF NOT EXISTS app.roteiro_etapas (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  versao_id                UUID NOT NULL REFERENCES app.roteiro_versoes(id) ON DELETE CASCADE,
  empresa_id               UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  ordem                    INT  NOT NULL,
  tipo                     TEXT NOT NULL,   -- ROTEIRO_ETAPA_TIPO (ver domain-enums.js)
  titulo                   TEXT,
  objetivo                 TEXT,
  frase_sugerida           TEXT,
  perguntas_json           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["...", "..."]
  sinais_interesse_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  sinais_resistencia_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  objecoes_json            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{"objecao":"...","resposta":"..."}]
  criado_em                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roteiro_etapas_ordem_uq UNIQUE (versao_id, ordem),
  CONSTRAINT roteiro_etapas_tipo_chk CHECK (tipo IN (
    'abertura', 'permissao', 'situacao', 'descoberta', 'problema', 'implicacao',
    'insight', 'qualificacao', 'objecoes', 'convite_reuniao', 'proxima_acao'
  ))
);
CREATE INDEX IF NOT EXISTS idx_roteiro_etapas_versao ON app.roteiro_etapas (versao_id, ordem);
