-- 032_eventos_comerciais_auto_reply.sql
-- Alinha a CHECK de vendas.eventos_comerciais ao whitelist do codigo (db-crud.js
-- registrarEventoComercial), incluindo 'auto_reply_detectado'. Esse tipo era aceito
-- pelo codigo mas REJEITADO pelo banco -> em producao dava, a cada auto-reply de WhatsApp:
--   "Erro ao registrar evento comercial: new row for relation \"eventos_comerciais\"
--    violates check constraint \"eventos_comerciais_tipo_chk\""
-- (webhook-handler.js:107 grava 'auto_reply_detectado'). Aditivo/idempotente: apenas
-- amplia o conjunto permitido (nenhuma linha existente viola o novo CHECK).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'vendas' AND table_name = 'eventos_comerciais'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eventos_comerciais_tipo_chk') THEN
      ALTER TABLE vendas.eventos_comerciais DROP CONSTRAINT eventos_comerciais_tipo_chk;
    END IF;
    ALTER TABLE vendas.eventos_comerciais ADD CONSTRAINT eventos_comerciais_tipo_chk
      CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview', 'auto_reply_detectado'));
  END IF;
END $$;
