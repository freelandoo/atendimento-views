-- 045_ligacao_objecoes.sql
-- Centro de Ligacoes — Fatia E: objecoes estruturadas registradas DURANTE a ligacao.
-- Antes a objecao ia empacotada em ligacoes.notas (texto livre). Agora cada objecao e'
-- uma linha: texto, origem (roteiro | novo_durante_ligacao), etapa, momento, resposta
-- utilizada e se foi resolvida. Persistencia IMEDIATA no clique; correcao por soft-remove.
-- Aditiva/idempotente, isolada por empresa. Espelha app.ligacao_sinais (migration 044).
-- Enum travado por src/domain-enums.js (OBJECAO_ORIGEM) + test/domain-enums.test.js.

CREATE TABLE IF NOT EXISTS app.ligacao_objecoes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  ligacao_id         UUID NOT NULL REFERENCES app.ligacoes(id) ON DELETE CASCADE,
  roteiro_id         UUID REFERENCES app.roteiros(id) ON DELETE SET NULL,
  roteiro_versao_id  UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,
  roteiro_etapa_id   UUID REFERENCES app.roteiro_etapas(id) ON DELETE SET NULL,
  objecao_roteiro_id UUID,          -- reservado (objecoes do roteiro sao JSON, sem id estavel)
  etapa_tipo         TEXT,          -- ROTEIRO_ETAPA_TIPO (redundante p/ analitica; nullable)
  texto_objecao      TEXT NOT NULL,
  resposta_utilizada TEXT,          -- opcional; pode ser informada depois, durante a ligacao
  origem             TEXT NOT NULL DEFAULT 'novo_durante_ligacao',  -- OBJECAO_ORIGEM
  usuario_id         UUID,
  client_event_id    UUID,
  registrada_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolvida          BOOLEAN NOT NULL DEFAULT false,
  resolvida_em       TIMESTAMPTZ,
  removida_em        TIMESTAMPTZ,   -- correcao: desmarcar nao apaga, marca removido
  CONSTRAINT ligacao_objecoes_origem_chk CHECK (origem IN ('roteiro', 'novo_durante_ligacao'))
);

-- Idempotencia por clique (retry/duplo clique nao duplica).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacao_objecoes_cei
  ON app.ligacao_objecoes (empresa_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- Reconstrucao rapida das objecoes ativas de uma ligacao (recuperacao/selecao).
CREATE INDEX IF NOT EXISTS idx_ligacao_objecoes_ligacao
  ON app.ligacao_objecoes (ligacao_id) WHERE removida_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_ligacao_objecoes_empresa
  ON app.ligacao_objecoes (empresa_id, resolvida);
