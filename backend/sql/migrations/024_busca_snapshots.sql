-- 024_busca_snapshots.sql
-- Fila assíncrona da BUSCA de leads da Aquisição via Bright Data (Google Maps
-- "Discover by location"). Espelha prospectador.captacao_snapshots: cada busca vira
-- um snapshot na Bright Data (job de minutos); um worker acompanha o estado e, quando
-- fica 'ready', baixa os registros → mapearPlace → salvarProspects. Sem job_queue.
-- Idempotente: CREATE ... IF NOT EXISTS (não mexe em nada existente).

CREATE TABLE IF NOT EXISTS prospectador.busca_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID,
  nicho           TEXT NOT NULL,
  cidade          TEXT NOT NULL,
  origem          TEXT NOT NULL DEFAULT 'manual',      -- manual | automatico
  snapshot_id     TEXT,                                -- id do job na Bright Data
  status          TEXT NOT NULL DEFAULT 'pendente',    -- pendente|processando|concluido|falhou
  total_prospects INTEGER NOT NULL DEFAULT 0,          -- leads salvos deste snapshot
  custo_registros INTEGER NOT NULL DEFAULT 0,          -- registros baixados (consumo Bright Data)
  erro            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Worker busca por status; index acelera o poll dos pendentes.
CREATE INDEX IF NOT EXISTS busca_snapshots_status_idx
  ON prospectador.busca_snapshots (status, created_at)
  WHERE status IN ('pendente', 'processando');
