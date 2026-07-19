-- 020_banco_leads_modos.sql
-- Banco de Leads vira central de disparo com Modo Manual / Semiautomático / Automático.
-- Fase 1 (Manual + Semi): configuração por EMPRESA + estado "aguardando_disparo" no
-- lead_disparos (mensagem gerada pela IA aguardando o disparo do usuário).
--
-- ADITIVA e idempotente:
--   1) app.banco_leads_config = config por empresa (modo + geração IA + agenda do Auto).
--      Os campos do modo Automático (auto_ativo/janela/teto/intervalo) já nascem aqui
--      para evitar uma 2ª migration na Fase 2 — ficam INERTES até o worker existir.
--   2) índice parcial para achar rápido as mensagens aguardando disparo (Semi/Auto).
-- lead_disparos.status é TEXT sem CHECK, então o novo valor 'aguardando_disparo' não
-- exige alteração de constraint.

CREATE TABLE IF NOT EXISTS app.banco_leads_config (
  empresa_id     UUID PRIMARY KEY,
  modo           TEXT NOT NULL DEFAULT 'manual',
  gerar_ia       BOOLEAN NOT NULL DEFAULT true,
  instrucoes_ia  TEXT,
  -- Campos do modo Automático (Fase 2) — inertes nesta fase.
  auto_ativo     BOOLEAN NOT NULL DEFAULT false,
  janela_inicio  TEXT NOT NULL DEFAULT '08:00',
  janela_fim     TEXT NOT NULL DEFAULT '18:00',
  teto_diario    INTEGER NOT NULL DEFAULT 40,
  intervalo_min  INTEGER NOT NULL DEFAULT 15,
  intervalo_max  INTEGER NOT NULL DEFAULT 30,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT banco_leads_config_modo_chk CHECK (modo IN ('manual', 'semi_automatico', 'automatico'))
);

-- Busca das mensagens geradas aguardando disparo (listagem adapta ao modo Semi/Auto).
CREATE INDEX IF NOT EXISTS idx_lead_disparos_aguardando
  ON prospectador.lead_disparos (empresa_id, prospect_id, criado_em DESC)
  WHERE status = 'aguardando_disparo';
