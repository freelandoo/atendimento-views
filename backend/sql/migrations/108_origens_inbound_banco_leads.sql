-- 108_origens_inbound_banco_leads.sql
-- Permite registrar manualmente leads que chegaram ate a empresa (inbound), sem criar conversa
-- artificial nem historico de WhatsApp. A origem continua sendo a fonte declarada do lead.

ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_origem_chk;
ALTER TABLE prospectador.prospects ADD CONSTRAINT prospects_origem_chk
  CHECK (origem IN ('manual', 'automatico', 'instagram', 'linkedin', 'meta_ads', 'whatsapp', 'meta_form'));
