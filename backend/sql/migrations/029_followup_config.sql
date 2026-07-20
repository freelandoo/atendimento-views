-- 029_followup_config.sql
-- Config por EMPRESA da pagina de Follow-ups (Fase 1): modo + meta de ligacoes + pausa.
-- Espelha app.banco_leads_config (mesmo padrao multi-tenant). Aditivo/idempotente.
-- Pesos/intervalos dos criterios seguem no codigo/ENV nesta fase; a UI editavel e Fase 3.

CREATE TABLE IF NOT EXISTS app.followup_config (
  empresa_id        UUID PRIMARY KEY REFERENCES app.empresas(id) ON DELETE CASCADE,
  modo              TEXT    NOT NULL DEFAULT 'automatico',  -- manual | semi | automatico
  meta_ligacoes_dia INTEGER NOT NULL DEFAULT 12,            -- meta diaria de ligacoes (modo Semi)
  pausado           BOOLEAN NOT NULL DEFAULT false,         -- pausa o disparo automatico de follow-up
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
