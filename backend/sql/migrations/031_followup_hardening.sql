-- 031_followup_hardening.sql
-- Endurece as tabelas de Follow-ups depois das migrations 029/030, que ja foram
-- aplicadas em ambientes locais. Aditiva e idempotente: constraints de dominio
-- na config e indice composto para historico/dedup por empresa + numero.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'followup_config_modo_chk'
       AND conrelid = 'app.followup_config'::regclass
  ) THEN
    ALTER TABLE app.followup_config
      ADD CONSTRAINT followup_config_modo_chk
      CHECK (modo IN ('manual', 'semi', 'automatico'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'followup_config_meta_ligacoes_chk'
       AND conrelid = 'app.followup_config'::regclass
  ) THEN
    ALTER TABLE app.followup_config
      ADD CONSTRAINT followup_config_meta_ligacoes_chk
      CHECK (meta_ligacoes_dia BETWEEN 1 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_followup_ligacoes_empresa_numero_criado
  ON vendas.followup_ligacoes (empresa_id, numero, criado_em DESC);
