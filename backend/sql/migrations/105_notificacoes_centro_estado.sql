-- 105_notificacoes_centro_estado.sql
-- Estado pessoal da Central de Notificacoes.
-- A notificacao em si continua calculada nas fontes oficiais; esta tabela guarda apenas
-- a decisao do usuario de arquivar/apagar um agrupamento da central.

CREATE TABLE IF NOT EXISTS app.notificacao_centro_estado (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id      UUID NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  notificacao_id  TEXT NOT NULL,
  estado          TEXT NOT NULL,
  tipo            TEXT,
  grupo           TEXT,
  prioridade      TEXT,
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  total           INTEGER NOT NULL DEFAULT 0,
  quando          TIMESTAMPTZ,
  destino_url     TEXT,
  acao_label      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notificacao_centro_estado_chk CHECK (estado IN ('arquivada', 'apagada')),
  CONSTRAINT notificacao_centro_prioridade_chk CHECK (
    prioridade IS NULL OR prioridade IN ('critica', 'alta', 'media', 'baixa')
  ),
  CONSTRAINT notificacao_centro_total_chk CHECK (total >= 0),
  CONSTRAINT notificacao_centro_id_len_chk CHECK (
    length(notificacao_id) BETWEEN 1 AND 160
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notificacao_centro_estado_usuario_uk
  ON app.notificacao_centro_estado (empresa_id, usuario_id, notificacao_id);

CREATE INDEX IF NOT EXISTS notificacao_centro_estado_lista_idx
  ON app.notificacao_centro_estado (empresa_id, usuario_id, estado, atualizado_em DESC);
