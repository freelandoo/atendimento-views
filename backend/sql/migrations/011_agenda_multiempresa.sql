-- 011_agenda_multiempresa.sql
-- Agenda comercial MULTIEMPRESA: calendário de reuniões/compromissos por empresa.
-- Tabela NOVA e autocontida (app.agenda_eventos) — NÃO mexe na agenda legada
-- single-tenant (vendas.agenda_eventos + worker de lembretes/IA), que segue servindo
-- a PJ Codeworks. Aqui o usuário é UUID (app.usuarios via JWT) e tudo é escopado por
-- empresa_id. Vínculo a lead/conversa é opcional e por telefone (sem FK cross-schema),
-- pra não acoplar à modelagem single-tenant. Idempotente.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.agenda_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  criado_por      UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  tipo            TEXT NOT NULL DEFAULT 'reuniao',
  status          TEXT NOT NULL DEFAULT 'pendente',
  prioridade      TEXT NOT NULL DEFAULT 'media',
  data_inicio     TIMESTAMPTZ NOT NULL,
  data_fim        TIMESTAMPTZ NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  lead_telefone   TEXT,
  lead_nome       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  excluido_em     TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_eventos_periodo_chk CHECK (data_fim > data_inicio),
  CONSTRAINT agenda_eventos_tipo_chk CHECK (tipo IN ('reuniao','follow_up','retorno','tarefa','bloqueio','outro')),
  CONSTRAINT agenda_eventos_status_chk CHECK (status IN ('pendente','confirmado','concluido','cancelado','bloqueado','nao_compareceu'))
);

-- Listagem por empresa + janela de tempo (caminho quente da agenda do painel).
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_empresa_periodo
  ON app.agenda_eventos (empresa_id, data_inicio)
  WHERE excluido_em IS NULL;

-- Busca por lead (vínculo com a carteira/prospecção via telefone).
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_empresa_lead
  ON app.agenda_eventos (empresa_id, lead_telefone)
  WHERE excluido_em IS NULL AND lead_telefone IS NOT NULL;
