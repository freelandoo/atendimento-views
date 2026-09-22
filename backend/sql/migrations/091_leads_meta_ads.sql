-- 091_leads_meta_ads.sql
-- Descoberta de leads pela Biblioteca de Anuncios do Meta (Facebook/Instagram), via ator
-- Apify `facebook-ads-scraper`. Fase 0/analise em docs/ai-task-start-log.md (2026-09-21 (3)).
--
-- POR QUE NAO USA place_id. Este novo canal nao tem Google Place ID. A migration 012 ja
-- generalizou a identidade de `prospectador.prospects` para isso: `place_id` deixou de ser
-- obrigatorio e `external_ref` (com UNIQUE parcial em `(empresa_id, origem, external_ref)`)
-- virou a chave de dedup por fonte, usada hoje por Instagram/LinkedIn. Este canal so precisa
-- entrar no mesmo vocabulario ja existente — nao inventa mecanismo novo.
--
-- POR QUE `origem='meta_ads'` E NAO UMA TABELA PROPRIA. O lead capturado por anuncio e' o
-- MESMO tipo de entidade que os demais (nasce, entra na fila de trabalho, e' abordado,
-- enriquecido com Instagram) — so muda a FONTE. Uma tabela separada duplicaria toda a
-- infraestrutura de qualificacao/responsavel/ownership que `prospects` ja tem.
--
-- ADITIVA: nenhuma linha existente e mutada. As 4 colunas novas em `prospects` sao nullable e
-- SEM DEFAULT (mesma disciplina das migrations 080/082: um DEFAULT autorizaria em silencio
-- qualquer INSERT futuro que esquecesse a coluna).

-- (1) Alarga o CHECK de origem — so ADICIONA um valor, nao remove nenhum dos existentes.
ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_origem_chk;
ALTER TABLE prospectador.prospects ADD CONSTRAINT prospects_origem_chk
  CHECK (origem IN ('manual', 'automatico', 'instagram', 'linkedin', 'meta_ads'));

-- (2) Evidencia do anuncio, guardada no proprio lead (nao em tabela separada: e' cache do
-- ultimo anuncio visto, no mesmo padrao de `instagram_atividade`/`instagram_perfil_em` da
-- migration 082 — reavaliar nao reescreve historico, so atualiza o retrato atual).
ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS anuncio_meta_ativo         BOOLEAN,
  ADD COLUMN IF NOT EXISTS anuncio_meta_inicio_em      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anuncio_meta_page_id        TEXT,
  ADD COLUMN IF NOT EXISTS anuncio_meta_verificado_em  TIMESTAMPTZ;

COMMENT ON COLUMN prospectador.prospects.anuncio_meta_ativo IS
  'Estava com anuncio ativo no Meta Ad Library na ultima verificacao. NULL = nunca verificado (nao e'' false'').';
COMMENT ON COLUMN prospectador.prospects.anuncio_meta_page_id IS
  'page_id do Facebook do anunciante, conforme devolvido pela Biblioteca de Anuncios.';

-- (3) Ledger de consumo do Apify (ator facebook-ads-scraper) — mesmo padrao de
-- `prospectador.brightdata_consumo` (migration 081): 1 linha por chamada que consumiu
-- resultado, com o numero REAL devolvido (nunca estimativa). E' uma moeda DIFERENTE da
-- Bright Data (paga por resultado do Apify, nao credito de dataset), por isso ledger proprio
-- em vez de reusar `brightdata_consumo` — misturar as duas faria o teto de uma travar a outra.
CREATE TABLE IF NOT EXISTS prospectador.apify_consumo (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID REFERENCES app.empresas(id),
  actor_id     TEXT NOT NULL,
  run_id       TEXT,
  resultados   INTEGER NOT NULL,
  contexto     JSONB,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.apify_consumo
  DROP CONSTRAINT IF EXISTS apify_consumo_resultados_chk;
ALTER TABLE prospectador.apify_consumo
  ADD CONSTRAINT apify_consumo_resultados_chk CHECK (resultados >= 0);

-- Idempotente por run: reprocessar o mesmo run (retry, reentrega) nao pode somar de novo.
CREATE UNIQUE INDEX IF NOT EXISTS apify_consumo_run_uk
  ON prospectador.apify_consumo (actor_id, run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS apify_consumo_periodo_idx
  ON prospectador.apify_consumo (criado_em DESC, actor_id);

COMMENT ON TABLE prospectador.apify_consumo IS
  'Ledger de consumo pago do Apify (pay-per-resultado): 1 linha por chamada, numero REAL de resultados.';
