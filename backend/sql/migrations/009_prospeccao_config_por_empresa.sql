-- 009_prospeccao_config_por_empresa.sql
-- Torna prospectador.prospeccao_configuracoes uma config POR EMPRESA (antes era
-- um singleton global). A migration 005 já adicionou empresa_id (default PJ).
-- Aqui: remove o PK/CHECK de singleton_id que travava em UMA linha e passa a
-- unicidade para empresa_id (uma config por empresa). A linha PJ existente é
-- preservada, então o scheduler/queues que leem com default PJ continuam idênticos.
-- Idempotente: detecta e remove constraints só se existirem.

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  pk_name TEXT;
  chk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_configuracoes'
  ) THEN
    RETURN;
  END IF;

  -- Garante empresa_id preenchido (reforça o backfill da 005) e obrigatório.
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id)';
  EXECUTE format('UPDATE prospectador.prospeccao_configuracoes SET empresa_id = %L WHERE empresa_id IS NULL', pj);
  EXECUTE format('ALTER TABLE prospectador.prospeccao_configuracoes ALTER COLUMN empresa_id SET DEFAULT %L', pj);
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes ALTER COLUMN empresa_id SET NOT NULL';

  -- Remove o CHECK (singleton_id = true) que forçava linha única.
  SELECT conname INTO chk_name
    FROM pg_constraint
   WHERE conrelid = 'prospectador.prospeccao_configuracoes'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%singleton_id%';
  IF chk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prospectador.prospeccao_configuracoes DROP CONSTRAINT %I', chk_name);
  END IF;

  -- Troca a PK de singleton_id (passa a permitir várias linhas, uma por empresa).
  SELECT conname INTO pk_name
    FROM pg_constraint
   WHERE conrelid = 'prospectador.prospeccao_configuracoes'::regclass
     AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE prospectador.prospeccao_configuracoes DROP CONSTRAINT %I', pk_name);
  END IF;

  -- singleton_id mantido só por compatibilidade; não é mais obrigatório.
  EXECUTE 'ALTER TABLE prospectador.prospeccao_configuracoes ALTER COLUMN singleton_id DROP NOT NULL';

  -- Uma configuração por empresa.
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_config_empresa ON prospectador.prospeccao_configuracoes (empresa_id)';
END $$;
