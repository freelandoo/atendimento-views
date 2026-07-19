-- 022_banco_leads_auto.sql
-- Fase 2 do Banco de Leads: modo Automático. Guarda o instante do próximo disparo
-- automático por empresa (o worker sorteia intervalo entre intervalo_min e intervalo_max
-- a cada envio). ADITIVA e idempotente.

ALTER TABLE app.banco_leads_config
  ADD COLUMN IF NOT EXISTS auto_proximo_disparo_em TIMESTAMPTZ;
