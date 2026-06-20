-- 013_lead_fechado.sql
-- Adiciona o estágio final "fechado" ao funil de prospects (Banco de Leads).
-- Mudança ADITIVA e idempotente: só amplia o CHECK de status, sem tocar dados.
--
-- CONTEXTO: o Banco de Leads agrupa os prospects (Google Places + Instagram) por
-- estágio. "Fecharam" precisa de um status próprio — hoje o funil vai só até
-- 'respondeu'. Marcação é MANUAL (operador clica "Marcar como fechado").
--
-- FONTE DE VERDADE: assim como 012, o CHECK de status vive dentro de
-- CREATE TABLE IF NOT EXISTS no init.sql e NÃO é reaplicado em bancos existentes.
-- Esta migration é a fonte de verdade do conjunto de status a partir de agora.
-- Repete TODOS os valores de 012 + 'fechado' (um DROP/ADD não pode perder valores).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    RETURN; -- prospects ainda não existe (boot muito cedo); init.sql cria depois.
  END IF;

  EXECUTE 'ALTER TABLE prospectador.prospects DROP CONSTRAINT IF EXISTS prospects_status_chk';
  EXECUTE $chk$
    ALTER TABLE prospectador.prospects ADD CONSTRAINT prospects_status_chk
    CHECK (status IN (
      'aguardando','aprovado','rejeitado','enviado','respondeu',
      'coletado','contato_encontrado','nao_contatar',
      'fechado'
    )) NOT VALID
  $chk$;
END $$;
