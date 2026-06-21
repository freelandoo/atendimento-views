-- 015_prospects_social_nullable.sql
-- Corrige uma OMISSÃO da 012: leads sociais (Instagram/LinkedIn) não têm nicho nem
-- cidade, mas prospectador.prospects herdou NOT NULL nessas colunas do fluxo Google
-- Places. A 012 só dropou o NOT NULL de place_id e esqueceu nicho/cidade — resultado:
-- TODO upsert social falhava ("null value in column cidade violates not-null
-- constraint"), o snapshot baixava N registros (custo > 0) mas gravava 0 prospects.
--
-- Mudança ADITIVA e idempotente: apenas relaxa o NOT NULL (DROP NOT NULL é no-op se a
-- coluna já for nullable). Os leads do Google continuam preenchendo nicho/cidade
-- normalmente (a validação deles vive no código, em normalizarProspectParaPersistencia).
--
-- FONTE DE VERDADE: o CREATE TABLE do init.sql ainda nasce com NOT NULL (não é reaplicado
-- em bancos existentes); esta migration é a fonte de verdade da nulabilidade a partir de agora.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    RETURN; -- prospects ainda não existe (boot muito cedo); init.sql cria depois.
  END IF;
  EXECUTE 'ALTER TABLE prospectador.prospects ALTER COLUMN cidade DROP NOT NULL';
  EXECUTE 'ALTER TABLE prospectador.prospects ALTER COLUMN nicho  DROP NOT NULL';
END $$;
