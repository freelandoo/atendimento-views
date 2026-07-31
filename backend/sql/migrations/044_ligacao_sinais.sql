-- 044_ligacao_sinais.sql
-- Centro de Ligacoes — Fatia D: sinais estruturados registrados DURANTE a ligacao.
-- Antes o "sinal criado na hora" ia empacotado em ligacoes.notas (texto livre, sem
-- estrutura). Agora cada sinal e' uma linha: tipo (interesse|resistencia), texto, origem
-- (roteiro | novo_durante_ligacao), etapa e momento. Persistencia IMEDIATA no clique.
-- Aditiva/idempotente, isolada por empresa. Enums travados por src/domain-enums.js
-- (SINAL_TIPO / SINAL_ORIGEM) + test/domain-enums.test.js.
-- Nao altera o roteiro publicado: promover um sinal novo ao roteiro e' acao separada.

CREATE TABLE IF NOT EXISTS app.ligacao_sinais (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  ligacao_id        UUID NOT NULL REFERENCES app.ligacoes(id) ON DELETE CASCADE,
  roteiro_id        UUID REFERENCES app.roteiros(id) ON DELETE SET NULL,
  roteiro_versao_id UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,
  roteiro_etapa_id  UUID REFERENCES app.roteiro_etapas(id) ON DELETE SET NULL,
  etapa_tipo        TEXT,            -- ROTEIRO_ETAPA_TIPO (redundante p/ analitica; nullable)
  tipo              TEXT NOT NULL,   -- SINAL_TIPO
  texto             TEXT NOT NULL,
  origem            TEXT NOT NULL DEFAULT 'novo_durante_ligacao',  -- SINAL_ORIGEM
  usuario_id        UUID,
  client_event_id   UUID,
  registrado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removido_em       TIMESTAMPTZ,     -- correcao: desmarcar nao apaga, marca removido
  CONSTRAINT ligacao_sinais_tipo_chk   CHECK (tipo IN ('interesse', 'resistencia')),
  CONSTRAINT ligacao_sinais_origem_chk CHECK (origem IN ('roteiro', 'novo_durante_ligacao'))
);

-- Idempotencia por clique (retry/duplo clique nao duplica).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacao_sinais_cei
  ON app.ligacao_sinais (empresa_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- Reconstrucao rapida dos sinais ativos de uma ligacao (recuperacao/selecao).
CREATE INDEX IF NOT EXISTS idx_ligacao_sinais_ligacao
  ON app.ligacao_sinais (ligacao_id) WHERE removido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_ligacao_sinais_empresa
  ON app.ligacao_sinais (empresa_id, tipo);
