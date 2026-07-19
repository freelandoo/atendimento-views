-- 021_prospects_tem_whatsapp.sql
-- Marca se o telefone do lead tem conta WhatsApp, aprendido no disparo:
--   NULL  = desconhecido (ainda não disparado)
--   true  = envio confirmado (número verificado — ganha ícone no Banco de Leads)
--   false = Evolution respondeu exists:false / numero_inexistente (registra "sem WhatsApp")
-- ADITIVA e idempotente. Sem CHECK novo.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS tem_whatsapp BOOLEAN';
  END IF;
END $$;
