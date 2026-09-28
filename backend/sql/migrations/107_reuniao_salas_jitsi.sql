-- 107_reuniao_salas_jitsi.sql
-- Salas de reuniao no app (Jitsi) + presenca.
--
-- A reuniao continua sendo o fato oficial em app.agenda_eventos. Esta migration acrescenta
-- somente a sala e o rastro de entrada/saida. O token publico do lead e' um segredo de acesso
-- ao link da reuniao, mas precisa ser reexibido ao responsavel para copiar/reenviar o convite;
-- por isso fica persistido e nunca deve ir para logs.

CREATE TABLE IF NOT EXISTS app.reuniao_salas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  agenda_evento_id    UUID NOT NULL REFERENCES app.agenda_eventos(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'jitsi',
  provider_domain     TEXT NOT NULL DEFAULT 'meet.jit.si',
  room_name           TEXT NOT NULL,
  lead_token          TEXT NOT NULL,
  status_presenca     TEXT NOT NULL DEFAULT 'pendente',
  host_entrou_em      TIMESTAMPTZ,
  lead_entrou_em      TIMESTAMPTZ,
  classificado_em     TIMESTAMPTZ,
  criado_por          UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reuniao_salas_evento_uk UNIQUE (empresa_id, agenda_evento_id),
  CONSTRAINT reuniao_salas_room_uk UNIQUE (provider_domain, room_name),
  CONSTRAINT reuniao_salas_token_uk UNIQUE (lead_token),
  CONSTRAINT reuniao_salas_provider_chk CHECK (provider IN ('jitsi', 'google_meet')),
  CONSTRAINT reuniao_salas_status_chk CHECK (status_presenca IN (
    'pendente',
    'host_entrou',
    'lead_entrou',
    'ambos_entraram',
    'lead_nao_compareceu',
    'host_nao_entrou',
    'sem_presenca_registrada'
  )),
  CONSTRAINT reuniao_salas_room_chk CHECK (char_length(room_name) BETWEEN 8 AND 160),
  CONSTRAINT reuniao_salas_token_chk CHECK (char_length(lead_token) BETWEEN 24 AND 160)
);

CREATE INDEX IF NOT EXISTS idx_reuniao_salas_empresa_evento
  ON app.reuniao_salas (empresa_id, agenda_evento_id);

CREATE INDEX IF NOT EXISTS idx_reuniao_salas_reconciliar
  ON app.reuniao_salas (empresa_id, status_presenca)
  WHERE status_presenca IN ('pendente', 'host_entrou', 'lead_entrou');

CREATE TABLE IF NOT EXISTS app.reuniao_presencas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  sala_id           UUID NOT NULL REFERENCES app.reuniao_salas(id) ON DELETE CASCADE,
  agenda_evento_id  UUID NOT NULL REFERENCES app.agenda_eventos(id) ON DELETE CASCADE,
  papel             TEXT NOT NULL,
  evento            TEXT NOT NULL,
  usuario_id        UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  participante_id   TEXT,
  display_name      TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reuniao_presencas_papel_chk CHECK (papel IN ('host', 'lead')),
  CONSTRAINT reuniao_presencas_evento_chk CHECK (evento IN ('entrou', 'saiu')),
  CONSTRAINT reuniao_presencas_display_chk CHECK (display_name IS NULL OR char_length(display_name) <= 160),
  CONSTRAINT reuniao_presencas_participante_chk CHECK (participante_id IS NULL OR char_length(participante_id) <= 160)
);

CREATE INDEX IF NOT EXISTS idx_reuniao_presencas_sala
  ON app.reuniao_presencas (sala_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_reuniao_presencas_evento
  ON app.reuniao_presencas (empresa_id, agenda_evento_id, criado_em DESC);
