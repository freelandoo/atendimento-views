-- 104_banco_leads_auto_recorte.sql
-- Recorte simples do modo Automático do Banco de Leads.
-- NULL/geral = carteira geral; nicho = dispara apenas leads daquele nicho.

ALTER TABLE app.banco_leads_config
  ADD COLUMN IF NOT EXISTS auto_recorte_modo TEXT NOT NULL DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS auto_nicho TEXT;

ALTER TABLE app.banco_leads_config
  DROP CONSTRAINT IF EXISTS banco_leads_config_auto_recorte_chk;

ALTER TABLE app.banco_leads_config
  ADD CONSTRAINT banco_leads_config_auto_recorte_chk
  CHECK (auto_recorte_modo IN ('geral', 'nicho'));

UPDATE app.banco_leads_config
   SET auto_recorte_modo = 'geral',
       auto_nicho = NULL,
       atualizado_em = NOW()
 WHERE auto_recorte_modo <> 'nicho'
    OR NULLIF(BTRIM(COALESCE(auto_nicho, '')), '') IS NULL;
