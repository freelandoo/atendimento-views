-- 010_prospeccao_execucao_por_empresa.sql
-- Permite UMA execução diária POR EMPRESA (antes era uma por dia, global).
-- A migration 005 já adicionou empresa_id (default PJ) em prospeccao_execucoes_diarias.
-- Aqui trocamos a UNIQUE(data_execucao) por UNIQUE(data_execucao, empresa_id), para que
-- empresas diferentes rodem no mesmo dia sem colidir na idempotência (ON CONFLICT).
-- A linha PJ existente é preservada (scheduler com default PJ continua idêntico).
-- Idempotente.

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_execucoes_diarias'
  ) THEN
    RETURN;
  END IF;

  -- Garante empresa_id preenchido e obrigatório (reforça o backfill da 005).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_execucoes_diarias ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id)';
  EXECUTE format('UPDATE prospectador.prospeccao_execucoes_diarias SET empresa_id = %L WHERE empresa_id IS NULL', pj);
  EXECUTE format('ALTER TABLE prospectador.prospeccao_execucoes_diarias ALTER COLUMN empresa_id SET DEFAULT %L', pj);
  EXECUTE 'ALTER TABLE prospectador.prospeccao_execucoes_diarias ALTER COLUMN empresa_id SET NOT NULL';

  -- Remove a UNIQUE global por dia e cria a UNIQUE por (dia, empresa).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_execucoes_diarias DROP CONSTRAINT IF EXISTS prospeccao_exec_dia_unique';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_exec_dia_empresa ON prospectador.prospeccao_execucoes_diarias (data_execucao, empresa_id)';
END $$;
