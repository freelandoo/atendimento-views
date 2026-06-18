-- 006_vendas_empresa_default.sql
-- Fase 4 (núcleo): a migration 001 adicionou empresa_id às tabelas vendas.* SEM
-- DEFAULT e o insert da conversa não o seta — então TODA conversa/lead criado
-- depois ficava com empresa_id NULL e sumia dos dashboards por empresa (inclusive
-- os da PJ). Aqui definimos DEFAULT = empresa padrão (PJ) e backfillamos NULLs.
-- Aditiva e idempotente. Quando o roteamento por instância (Fase 4 completa) for
-- ligado, o insert passa a informar empresa_id explicitamente e o default deixa de
-- ser usado para empresas não-PJ.

DO $$
DECLARE
  pj CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  t  TEXT;
  tabelas TEXT[] := ARRAY[
    'conversas',
    'lead_profiles',
    'followup_envios',
    'analises_pos_conversa',
    'ai_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'vendas' AND table_name = t AND column_name = 'empresa_id'
    ) THEN
      EXECUTE format('UPDATE vendas.%I SET empresa_id = %L WHERE empresa_id IS NULL', t, pj);
      EXECUTE format('ALTER TABLE vendas.%I ALTER COLUMN empresa_id SET DEFAULT %L', t, pj);
    END IF;
  END LOOP;
END $$;
