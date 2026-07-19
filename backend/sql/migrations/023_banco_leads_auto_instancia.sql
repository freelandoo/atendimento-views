-- 023_banco_leads_auto_instancia.sql
-- Modo Automático do Banco de Leads: instância escolhida para os disparos automáticos.
-- NULL = usa a instância ativa mais recente da empresa (comportamento anterior). ADITIVA.

ALTER TABLE app.banco_leads_config
  ADD COLUMN IF NOT EXISTS auto_instancia_id UUID;
