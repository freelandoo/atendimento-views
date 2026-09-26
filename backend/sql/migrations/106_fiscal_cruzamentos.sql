-- 106_fiscal_cruzamentos.sql
-- Cache e ledger de cruzamento fiscal/cadastral restritos a superadmin.
--
-- Separado de Bright Data de proposito: fonte fiscal, custo e permissao sao outra familia.

CREATE TABLE IF NOT EXISTS app.fiscal_cnpj_cache (
  cnpj_digits          CHAR(14) PRIMARY KEY,
  razao_social         TEXT,
  nome_fantasia        TEXT,
  situacao_cadastral   TEXT,
  cnae_principal       TEXT,
  cnae_descricao       TEXT,
  municipio            TEXT,
  uf                   CHAR(2),
  endereco             JSONB,
  qsa                  JSONB,
  fonte                TEXT NOT NULL,
  dados                JSONB,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_cnpj_cache_digits_chk CHECK (cnpj_digits ~ '^[0-9]{14}$')
);

CREATE INDEX IF NOT EXISTS fiscal_cnpj_cache_nome_idx
  ON app.fiscal_cnpj_cache (razao_social, nome_fantasia);

CREATE INDEX IF NOT EXISTS fiscal_cnpj_cache_uf_municipio_idx
  ON app.fiscal_cnpj_cache (uf, municipio);

CREATE TABLE IF NOT EXISTS app.fiscal_cruzamentos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID REFERENCES app.empresas(id) ON DELETE SET NULL,
  prospect_id       UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  lead_numero       TEXT,
  origem            TEXT NOT NULL DEFAULT 'manual',
  nome_informado    TEXT,
  cidade_informada  TEXT,
  uf_informada      CHAR(2),
  cnpj_digits       CHAR(14) REFERENCES app.fiscal_cnpj_cache(cnpj_digits),
  status            TEXT NOT NULL,
  fonte             TEXT NOT NULL,
  confianca         SMALLINT NOT NULL DEFAULT 0,
  custo_creditos    INTEGER NOT NULL DEFAULT 0,
  erro              TEXT,
  resultado         JSONB,
  consultado_por    UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  consultado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fiscal_cruzamentos_status_chk
    CHECK (status IN ('encontrado', 'possivel', 'sem_resultado', 'erro', 'fonte_indisponivel')),
  CONSTRAINT fiscal_cruzamentos_confianca_chk CHECK (confianca BETWEEN 0 AND 100),
  CONSTRAINT fiscal_cruzamentos_custo_chk CHECK (custo_creditos >= 0),
  CONSTRAINT fiscal_cruzamentos_cnpj_chk CHECK (cnpj_digits IS NULL OR cnpj_digits ~ '^[0-9]{14}$')
);

CREATE INDEX IF NOT EXISTS fiscal_cruzamentos_consultado_idx
  ON app.fiscal_cruzamentos (consultado_em DESC);

CREATE INDEX IF NOT EXISTS fiscal_cruzamentos_empresa_idx
  ON app.fiscal_cruzamentos (empresa_id, consultado_em DESC)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fiscal_cruzamentos_prospect_idx
  ON app.fiscal_cruzamentos (prospect_id, consultado_em DESC)
  WHERE prospect_id IS NOT NULL;

COMMENT ON TABLE app.fiscal_cnpj_cache IS
  'Snapshot normalizado de dados cadastrais publicos/fiscais por CNPJ. Acesso via rotas superadmin.';

COMMENT ON TABLE app.fiscal_cruzamentos IS
  'Ledger de tentativas de cruzamento fiscal/cadastral. Nao sobrescreve leads/prospects.';
