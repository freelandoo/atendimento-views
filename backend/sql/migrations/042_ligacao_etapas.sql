-- 042_ligacao_etapas.sql
-- Centro de Ligacoes — Fatia B: etapas TEMPORAIS (quanto tempo o operador ficou em cada
-- etapa). Cada PASSAGEM por uma etapa e' uma OCORRENCIA independente: entrou_em / saiu_em /
-- duracao_seg (calculada no servidor). Voltar para uma etapa cria uma NOVA ocorrencia (nao
-- reabre a anterior). So uma ocorrencia ativa (saiu_em IS NULL) por ligacao.
--
-- FONTE OFICIAL de duracao-por-etapa: esta tabela (app.ligacao_etapas).
-- NAO confundir com app.ligacao_etapa_eventos (migration 040) — aquela guarda MARCAS de
-- interesse/resistencia por etapa (alimenta o funil), coisa diferente de tempo. As duas
-- coexistem; a legada NAO e' removida nesta fatia e NAO deve ser usada para tempo por etapa.
-- Aditiva/idempotente, isolada por empresa. tipo_etapa e' copia denormalizada de
-- roteiro_etapas.tipo (ROTEIRO_ETAPA_TIPO), validada na origem — sem CHECK aqui.

CREATE TABLE IF NOT EXISTS app.ligacao_etapas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  ligacao_id        UUID NOT NULL REFERENCES app.ligacoes(id) ON DELETE CASCADE,
  roteiro_id        UUID REFERENCES app.roteiros(id) ON DELETE SET NULL,
  roteiro_versao_id UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,
  roteiro_etapa_id  UUID REFERENCES app.roteiro_etapas(id) ON DELETE SET NULL,
  tipo_etapa        TEXT,
  ordem_etapa       INT,
  entrou_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saiu_em           TIMESTAMPTZ,
  duracao_seg       INT,
  usuario_id        UUID,
  client_event_id   UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ligacao_etapas_duracao_chk CHECK (duracao_seg IS NULL OR duracao_seg >= 0)
);

-- No maximo UMA ocorrencia ativa por ligacao (protege ate' em corrida).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacao_etapas_ativa
  ON app.ligacao_etapas (ligacao_id) WHERE saiu_em IS NULL;
-- Idempotencia por clique (abrir/trocar).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacao_etapas_cei
  ON app.ligacao_etapas (empresa_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- Apoio de leitura.
CREATE INDEX IF NOT EXISTS idx_ligacao_etapas_empresa_lig ON app.ligacao_etapas (empresa_id, ligacao_id);
CREATE INDEX IF NOT EXISTS idx_ligacao_etapas_lig_saida   ON app.ligacao_etapas (ligacao_id, saiu_em);
CREATE INDEX IF NOT EXISTS idx_ligacao_etapas_roteiro_etapa ON app.ligacao_etapas (roteiro_etapa_id);
