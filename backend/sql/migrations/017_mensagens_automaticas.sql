-- 017_mensagens_automaticas.sql
-- Mensagens automáticas POR contexto: saudações do agente + gatilhos da agenda,
-- editáveis por empresa (mesmo molde de estagios_json da migration 008). Cada
-- contexto (card) guarda seus próprios textos; o runtime lê o contexto ativo e,
-- se a chave estiver vazia, cai no template default (com o nome da empresa).
-- Aditiva/idempotente — não toca dados existentes nem constraints.

ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS saudacoes_json       JSONB,
  ADD COLUMN IF NOT EXISTS gatilhos_agenda_json JSONB;
