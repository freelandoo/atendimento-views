-- 097_aquisicao_pais.sql
-- A Aquisição deixa de tratar localização como "cidade brasileira implícita".
-- `pais` passa a ser eixo persistido em prospects, coletas e rotinas.
--
-- Escolha de modelagem:
-- - ISO-2 em texto (`BR`, `US`, `PT`...), porque Nominatim, Bright Data Maps e Meta Ads
--   trabalham naturalmente com esse vocabulário.
-- - Default `BR` para preservar todo o acervo atual e o comportamento existente.
-- - Rotinas únicas por empresa+nicho+país+cidade+UF; antes dois países com mesma cidade
--   poderiam competir pelo mesmo índice.

ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT 'BR';

ALTER TABLE prospectador.busca_snapshots
  ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT 'BR';

ALTER TABLE prospectador.aquisicao_rotinas
  ADD COLUMN IF NOT EXISTS pais TEXT NOT NULL DEFAULT 'BR';

UPDATE prospectador.prospects
   SET pais = 'BR'
 WHERE pais IS NULL OR BTRIM(pais) = '';

UPDATE prospectador.busca_snapshots
   SET pais = 'BR'
 WHERE pais IS NULL OR BTRIM(pais) = '';

UPDATE prospectador.aquisicao_rotinas
   SET pais = 'BR'
 WHERE pais IS NULL OR BTRIM(pais) = '';

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_pais_chk,
  ADD CONSTRAINT prospects_pais_chk CHECK (pais ~ '^[A-Z]{2}$');

ALTER TABLE prospectador.busca_snapshots
  DROP CONSTRAINT IF EXISTS busca_snapshots_pais_chk,
  ADD CONSTRAINT busca_snapshots_pais_chk CHECK (pais ~ '^[A-Z]{2}$');

ALTER TABLE prospectador.aquisicao_rotinas
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_pais_chk,
  ADD CONSTRAINT aquisicao_rotinas_pais_chk CHECK (pais ~ '^[A-Z]{2}$');

DROP INDEX IF EXISTS prospectador.aquisicao_rotinas_mercado_uk;

CREATE UNIQUE INDEX IF NOT EXISTS aquisicao_rotinas_mercado_uk
  ON prospectador.aquisicao_rotinas (empresa_id, LOWER(nicho), pais, LOWER(cidade), COALESCE(uf, ''));

CREATE INDEX IF NOT EXISTS idx_prospects_empresa_pais_cidade
  ON prospectador.prospects (empresa_id, pais, cidade);

CREATE INDEX IF NOT EXISTS busca_snapshots_empresa_pais_created_idx
  ON prospectador.busca_snapshots (empresa_id, pais, created_at DESC);

COMMENT ON COLUMN prospectador.prospects.pais IS
  'Pais ISO-2 do mercado de origem do lead. Default BR preserva o acervo brasileiro anterior.';

COMMENT ON COLUMN prospectador.busca_snapshots.pais IS
  'Pais ISO-2 usado na coleta paga que originou o snapshot.';

COMMENT ON COLUMN prospectador.aquisicao_rotinas.pais IS
  'Pais ISO-2 da rotina de Aquisição; compõe a identidade do mercado junto de nicho/cidade/UF.';
