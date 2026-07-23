-- 035_prospeccao_relatorio_por_empresa.sql
-- prospeccao_relatorios_diarios tinha PRIMARY KEY só em data_referencia — sobrou do modelo
-- single-tenant de antes da migration 005 (que adicionou empresa_id em todo o schema
-- prospectador, mas não corrigiu a chave desta tabela, diferente do que a 010 fez para
-- prospeccao_execucoes_diarias). Com 2+ empresas rodando a Busca IA/Automática no mesmo dia,
-- o relatório da segunda empresa processada no tick SOBRESCREVIA o da primeira (mesma linha,
-- via ON CONFLICT (data_referencia)), e a leitura por data vazava entre empresas.
-- Aqui trocamos a PK para (data_referencia, empresa_id), permitindo um relatório por empresa
-- por dia. A linha PJ existente é preservada. Idempotente.

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_relatorios_diarios'
  ) THEN
    RETURN;
  END IF;

  -- Garante empresa_id preenchido e obrigatório (reforça o backfill da 005).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_relatorios_diarios ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id)';
  EXECUTE format('UPDATE prospectador.prospeccao_relatorios_diarios SET empresa_id = %L WHERE empresa_id IS NULL', pj);
  EXECUTE format('ALTER TABLE prospectador.prospeccao_relatorios_diarios ALTER COLUMN empresa_id SET DEFAULT %L', pj);
  EXECUTE 'ALTER TABLE prospectador.prospeccao_relatorios_diarios ALTER COLUMN empresa_id SET NOT NULL';

  -- Troca a PK global por dia pela PK composta (dia, empresa).
  EXECUTE 'ALTER TABLE prospectador.prospeccao_relatorios_diarios DROP CONSTRAINT IF EXISTS prospeccao_relatorios_diarios_pkey';
  EXECUTE 'ALTER TABLE prospectador.prospeccao_relatorios_diarios ADD CONSTRAINT prospeccao_relatorios_diarios_pkey PRIMARY KEY (data_referencia, empresa_id)';
END $$;
