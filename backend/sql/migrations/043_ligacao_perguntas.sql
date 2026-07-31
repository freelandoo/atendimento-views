-- 043_ligacao_perguntas.sql
-- Centro de Ligacoes — Fatia C: perguntas do roteiro marcadas como FEITAS durante a ligacao.
-- Antes iam empacotadas em ligacoes.notas ("Perguntas feitas: ..."). Agora cada pergunta
-- marcada e' uma linha, com o TEXTO no momento (preserva a versao usada), a etapa e o
-- momento. So do roteiro (nao ha criacao na hora). Desmarcar NAO apaga: vira 'desmarcada'
-- (correcao auditavel). Persistencia imediata; idempotente por client_event_id.
-- Aditiva/idempotente, isolada por empresa. Espelha app.ligacao_sinais (044). Enum travado
-- por src/domain-enums.js (PERGUNTA_STATUS) + test/domain-enums.test.js.

CREATE TABLE IF NOT EXISTS app.ligacao_perguntas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  ligacao_id        UUID NOT NULL REFERENCES app.ligacoes(id) ON DELETE CASCADE,
  roteiro_id        UUID REFERENCES app.roteiros(id) ON DELETE SET NULL,
  roteiro_versao_id UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,
  roteiro_etapa_id  UUID REFERENCES app.roteiro_etapas(id) ON DELETE SET NULL,
  etapa_tipo        TEXT,            -- ROTEIRO_ETAPA_TIPO (redundante p/ analitica; nullable)
  pergunta_indice   INT,             -- posicao na perguntas_json daquela versao (id estavel na versao)
  texto_no_momento  TEXT NOT NULL,   -- preserva o texto da pergunta na versao usada
  status            TEXT NOT NULL DEFAULT 'realizada',  -- PERGUNTA_STATUS
  usuario_id        UUID,
  client_event_id   UUID,
  realizada_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  desmarcada_em     TIMESTAMPTZ,     -- correcao: desmarcar vira 'desmarcada', nao apaga
  CONSTRAINT ligacao_perguntas_status_chk CHECK (status IN ('realizada', 'desmarcada'))
);

-- Idempotencia por clique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacao_perguntas_cei
  ON app.ligacao_perguntas (empresa_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- Reconstrucao rapida das perguntas marcadas (status realizada) de uma ligacao.
CREATE INDEX IF NOT EXISTS idx_ligacao_perguntas_ligacao
  ON app.ligacao_perguntas (ligacao_id) WHERE status = 'realizada';
CREATE INDEX IF NOT EXISTS idx_ligacao_perguntas_empresa
  ON app.ligacao_perguntas (empresa_id, ligacao_id);
