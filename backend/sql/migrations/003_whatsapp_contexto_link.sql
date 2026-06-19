-- ============================================================================
-- Migration 003 — Link instância WhatsApp ↔ Contexto
-- Cada instância pode opcionalmente apontar para um Contexto 1 específico.
-- Idempotente.
-- ============================================================================

ALTER TABLE app.empresa_whatsapp_instances
  ADD COLUMN IF NOT EXISTS contexto_id UUID REFERENCES app.empresa_contextos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_empresa_whatsapp_instances_contexto
  ON app.empresa_whatsapp_instances (contexto_id);

-- Conversas precisam guardar de qual Evolution instance a mensagem veio,
-- pra runtime resolver o contexto certo quando há múltiplas instâncias.
ALTER TABLE vendas.conversas
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT;

CREATE INDEX IF NOT EXISTS idx_conversas_evolution_instance
  ON vendas.conversas (evolution_instance);
