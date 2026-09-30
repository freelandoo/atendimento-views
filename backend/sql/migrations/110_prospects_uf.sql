-- 110_prospects_uf.sql
-- Estado (UF) do lead, para o SELETOR de estado do painel comercial. Até aqui `uf` só existia na
-- COLETA (rotinas/curadoria), nunca no lead — então "filtrar por estado" era impossível.
--
-- ADITIVA, nullable, SEM default e SEM backfill: o UF passa a ser capturado na coleta (do endereço
-- do próprio place, "Cidade - UF, CEP"), só PRA FRENTE. Lead antigo fica NULL (estado desconhecido)
-- até ser recoletado — inventar o estado dele seria mentira. Mesmo padrão do "conversou" (mig 109).

ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS uf TEXT;

-- Mesma CHECK das outras tabelas de coleta (053/054/055): 2 letras maiúsculas, ou NULL.
ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_uf_chk,
  ADD CONSTRAINT prospects_uf_chk CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');

-- O painel filtra por (empresa_id, uf); índice parcial cobre sem pesar os NULL.
CREATE INDEX IF NOT EXISTS idx_prospects_empresa_uf
  ON prospectador.prospects (empresa_id, uf)
  WHERE uf IS NOT NULL;

COMMENT ON COLUMN prospectador.prospects.uf IS
  'Estado (UF) do lead, capturado na coleta a partir de 2026-09-29. NULL = lead anterior ou sem UF legível.';
