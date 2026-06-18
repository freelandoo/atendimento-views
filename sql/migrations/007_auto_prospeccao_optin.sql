-- 007_auto_prospeccao_optin.sql
-- Fase 3b (gate de segurança): flag de opt-in por empresa para o disparo AUTÔNOMO
-- de prospecção (que envia WhatsApp real). DEFAULT false = nenhuma empresa nova
-- dispara sozinha; só a PJ (operacional hoje) já vem habilitada. Assim o sender
-- autônomo por empresa fica gated e dormente até habilitação deliberada + teste.
-- Aditiva/idempotente.

ALTER TABLE app.empresas
  ADD COLUMN IF NOT EXISTS auto_prospeccao_habilitada BOOLEAN NOT NULL DEFAULT false;

-- PJ Codeworks (empresa padrão/operacional) mantém o comportamento atual: habilitada.
UPDATE app.empresas
   SET auto_prospeccao_habilitada = true
 WHERE id = '00000000-0000-0000-0000-000000000001';
