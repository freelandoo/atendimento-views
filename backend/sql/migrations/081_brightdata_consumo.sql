-- 081_brightdata_consumo.sql
-- Contabilidade de creditos da Bright Data: ledger de consumo + saldo informado.
--
-- Regra de negocio:
--   * 1 linha em `brightdata_consumo` por requisicao que CONSUMIU credito, com o numero REAL de
--     registros devolvidos — nunca uma estimativa. E' o `brightdata_requests` pedido pelo
--     operador, e a fonte de `credits_used` por periodo, por scraper e por lead.
--   * `brightdata_saldo` guarda o saldo que uma PESSOA informou, com a data. O saldo corrente e'
--     aritmetica: informado - SUM(registros desde a data).
--
-- POR QUE O SALDO E' INFORMADO E NAO LIDO: a API da Bright Data usada aqui (Dataset API v3) expoe
-- apenas /trigger, /progress e /snapshot. Nenhum deles devolve saldo. Inventar uma leitura seria
-- apresentar como oficial um numero que ninguem conferiu — por isso a coluna se chama
-- `saldo_informado` e carrega quem informou e quando.
--
-- POR QUE O CONSUMO NAO E' POR EMPRESA: os creditos sao de UMA conta Bright Data, compartilhada
-- por todos os tenants. `empresa_id` fica na linha para auditoria e rateio, mas a soma que trava
-- a coleta e' GLOBAL. Somar por empresa deixaria N empresas gastarem N x o teto da mesma conta.
--
-- ADITIVA: nao altera tabela existente, nao muta dado, nao cria DEFAULT que autorize INSERT
-- incompleto. Consumo anterior a esta migration NAO e' retroagido — o saldo informado e' o marco
-- zero da contagem, e e' por isso que ele carrega data.

CREATE TABLE IF NOT EXISTS prospectador.brightdata_consumo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID REFERENCES app.empresas(id),
  prospect_id   UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  scraper_type  TEXT NOT NULL,
  dataset_id    TEXT,
  snapshot_id   TEXT,
  registros     INTEGER NOT NULL,
  contexto      JSONB,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.brightdata_consumo
  DROP CONSTRAINT IF EXISTS brightdata_consumo_scraper_chk,
  DROP CONSTRAINT IF EXISTS brightdata_consumo_registros_chk;

ALTER TABLE prospectador.brightdata_consumo
  ADD CONSTRAINT brightdata_consumo_scraper_chk
    CHECK (scraper_type IN ('maps_descoberta', 'ig_descoberta', 'ig_perfis', 'ig_posts',
                            'li_descoberta', 'li_perfis')),
  ADD CONSTRAINT brightdata_consumo_registros_chk
    CHECK (registros >= 0);

-- Um snapshot so' pode ser contabilizado UMA vez. O worker da Aquisicao reprocessa snapshots
-- (retry, reentrega), e sem esta trava a mesma coleta seria somada de novo a cada passagem —
-- o teto diario travaria a operacao por consumo que nao existiu. PARCIAL porque snapshot_id e'
-- NULL em consumo avulso (que nao vem de lote).
CREATE UNIQUE INDEX IF NOT EXISTS brightdata_consumo_snapshot_uk
  ON prospectador.brightdata_consumo (scraper_type, snapshot_id)
  WHERE snapshot_id IS NOT NULL;

-- A consulta quente: quanto foi consumido hoje (global) e desde a data do saldo informado.
CREATE INDEX IF NOT EXISTS brightdata_consumo_periodo_idx
  ON prospectador.brightdata_consumo (criado_em DESC, scraper_type);

CREATE INDEX IF NOT EXISTS brightdata_consumo_prospect_idx
  ON prospectador.brightdata_consumo (prospect_id, criado_em DESC)
  WHERE prospect_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospectador.brightdata_saldo (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saldo_informado  INTEGER NOT NULL,
  observacao       TEXT,
  informado_por    UUID REFERENCES app.usuarios(id),
  informado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.brightdata_saldo
  DROP CONSTRAINT IF EXISTS brightdata_saldo_valor_chk;

ALTER TABLE prospectador.brightdata_saldo
  ADD CONSTRAINT brightdata_saldo_valor_chk CHECK (saldo_informado >= 0);

-- Append-only: cada informe e' uma linha nova e o corrente e' o mais recente. Sobrescrever
-- apagaria o marco zero de todas as contagens anteriores.
CREATE INDEX IF NOT EXISTS brightdata_saldo_recente_idx
  ON prospectador.brightdata_saldo (informado_em DESC);

COMMENT ON TABLE prospectador.brightdata_consumo IS
  'Ledger de creditos Bright Data: 1 linha por requisicao paga, com o numero REAL de registros devolvidos.';

COMMENT ON COLUMN prospectador.brightdata_consumo.registros IS
  'Creditos consumidos = registros devolvidos pela fonte. Nunca estimativa.';

COMMENT ON TABLE prospectador.brightdata_saldo IS
  'Saldo INFORMADO por uma pessoa, com data. A API da Bright Data nao expoe saldo; o corrente e estimativa.';
