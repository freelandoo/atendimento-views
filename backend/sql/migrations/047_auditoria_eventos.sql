-- 047_auditoria_eventos.sql
-- Centro de Ligacoes — Fatia G: log de AUDITORIA (append-only) de acoes do sistema.
-- Objetivo: reconstruir QUEM fez O QUE e QUANDO — separado da analitica comercial
-- (a analitica sai da view app.vw_ligacoes_analiticas; auditoria NAO deve ser fonte de
-- dashboards). Generico (entidade_tipo/entidade_id + acao). `acao` e `entidade_tipo` sao
-- TEXT livres (extensiveis) — sem CHECK/enum de proposito. Isolado por empresa.
-- Gravacao best-effort: uma falha aqui nunca deve quebrar a acao principal.

CREATE TABLE IF NOT EXISTS app.auditoria_eventos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id        UUID,
  entidade_tipo     TEXT NOT NULL,   -- ex.: 'ligacao', 'roteiro'
  entidade_id       UUID,
  acao              TEXT NOT NULL,   -- ex.: 'ligacao_iniciada', 'ligacao_encerrada', 'ligacao_descartada'
  estado_anterior   TEXT,
  estado_novo       TEXT,
  contexto          JSONB,
  client_event_id   UUID,
  ocorrido_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade
  ON app.auditoria_eventos (empresa_id, entidade_tipo, entidade_id, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_acao
  ON app.auditoria_eventos (empresa_id, acao, ocorrido_em DESC);
