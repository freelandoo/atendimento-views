-- 016_rodar_leads.sql
-- Feature "Rodar leads" no Banco de Leads: disparo manual da saudação (primeira
-- mensagem) por instância WhatsApp, com registro de quem rodou/quando e trava de
-- 15 dias quando a conversa morre ou dá sinal de rejeição.
--
-- ADITIVA e idempotente:
--   1) prospectador.prospects ganha bloqueado_ate / bloqueio_motivo (a trava de 15d).
--   2) nova prospectador.lead_disparos = histórico de cada disparo (quem/quando/instância).
-- A saudação por instância NÃO precisa de coluna: vive em
-- app.empresa_whatsapp_instances.config_json->>'saudacao'.

DO $$
BEGIN
  -- Guard: prospects pode ainda não existir num boot muito cedo (init.sql cria depois).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'prospectador' AND table_name = 'prospects'
  ) THEN
    EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS bloqueado_ate TIMESTAMPTZ';
    EXECUTE 'ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS bloqueio_motivo TEXT';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prospectador.lead_disparos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL,
  prospect_id        UUID NOT NULL,
  usuario_id         UUID,
  evolution_instance TEXT NOT NULL,
  mensagem           TEXT,
  status             TEXT NOT NULL DEFAULT 'enviado',
  erro               TEXT,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quem rodou cada lead e quando (último disparo por prospect).
CREATE INDEX IF NOT EXISTS idx_lead_disparos_prospect
  ON prospectador.lead_disparos (prospect_id, criado_em DESC);
-- Contagem de disparos do dia por instância (teto diário) + trava de 5 min entre rodadas.
CREATE INDEX IF NOT EXISTS idx_lead_disparos_instancia_dia
  ON prospectador.lead_disparos (empresa_id, evolution_instance, criado_em DESC);
-- Filtro do worker de auto-lock por prospects bloqueáveis.
CREATE INDEX IF NOT EXISTS idx_prospects_bloqueado_ate
  ON prospectador.prospects (empresa_id, bloqueado_ate);
