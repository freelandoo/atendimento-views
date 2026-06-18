-- 005_prospeccao_multiempresa.sql
-- Torna o schema `prospectador` multiempresa de forma ADITIVA e segura:
--   - adiciona empresa_id (FK app.empresas) em todas as tabelas de prospecção;
--   - backfill de linhas existentes para a empresa padrão (PJ Codeworks);
--   - DEFAULT = PJ, para que o código single-tenant atual continue funcionando
--     sem alteração (toda escrita não-escopada cai na PJ).
-- Idempotente: ADD COLUMN IF NOT EXISTS + UPDATE só de NULL.

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  t  TEXT;
  tabelas TEXT[] := ARRAY[
    'prospects',
    'diagnosticos',
    'prospect_events',
    'send_attempts',
    'contato_politicas',
    'nichos_performantes',
    'auto_prospeccao_config',
    'prospeccao_configuracoes',
    'prospeccao_tags',
    'prospeccao_regioes',
    'prospeccao_execucoes_diarias',
    'prospeccao_fila_diaria',
    'prospeccao_decisoes_ia',
    'prospeccao_metricas_diarias',
    'prospeccao_relatorios_diarios',
    'prospeccao_bloqueios'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    -- só age se a tabela existir (algumas podem não ter sido criadas ainda)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'prospectador' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE prospectador.%I ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id)', t
      );
      EXECUTE format(
        'UPDATE prospectador.%I SET empresa_id = %L WHERE empresa_id IS NULL', t, pj
      );
      EXECUTE format(
        'ALTER TABLE prospectador.%I ALTER COLUMN empresa_id SET DEFAULT %L', t, pj
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_empresa ON prospectador.%I (empresa_id)', t, t
      );
    END IF;
  END LOOP;

  -- prospects: place_id era ÚNICO GLOBAL; passa a ser único POR EMPRESA, para que
  -- empresas diferentes possam prospectar o mesmo estabelecimento do Google.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    EXECUTE 'ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_place_id_key';
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_empresa_place ON prospectador.prospects (empresa_id, place_id)';
  END IF;
END $$;
