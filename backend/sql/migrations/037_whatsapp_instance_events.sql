-- 037_whatsapp_instance_events.sql
-- Historico operacional seguro de eventos de conexao/saude das instancias WhatsApp.

CREATE TABLE IF NOT EXISTS app.whatsapp_instance_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  instance_id         UUID REFERENCES app.empresa_whatsapp_instances(id) ON DELETE SET NULL,
  evolution_instance  TEXT NOT NULL,
  event               TEXT NOT NULL,
  state               TEXT,
  reason              TEXT,
  disconnect_code     TEXT,
  risk_level          TEXT NOT NULL DEFAULT 'normal',
  risk_message        TEXT,
  detalhes_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_instance_events_risk_chk CHECK (risk_level IN ('normal','atencao','alto'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_events_empresa_instancia
  ON app.whatsapp_instance_events (empresa_id, evolution_instance, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_events_instance_id
  ON app.whatsapp_instance_events (instance_id, criado_em DESC)
  WHERE instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_events_risco
  ON app.whatsapp_instance_events (empresa_id, risk_level, criado_em DESC)
  WHERE risk_level IN ('atencao','alto');
