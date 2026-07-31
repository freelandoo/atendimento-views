-- 041_ligacoes_estado.sql
-- Centro de Ligacoes — Fatia A: ciclo de vida da SESSAO de ligacao.
-- Antes a ligacao nascia "pronta" no POST final (batch). Agora ela tem um ciclo real:
--   em_andamento -> encerrada   (alimenta metricas/dashboards/IA)
--   em_andamento -> descartada  (fica so para auditoria; fora da analitica)
-- Aditiva e idempotente. Preserva dados existentes: linhas antigas viram 'encerrada'
-- (o fluxo antigo so criava ligacoes ja completas) com encerrada_em = criado_em.
-- Enum travado por src/domain-enums.js (LIGACAO_STATUS) + test/domain-enums.test.js.

ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'encerrada';
ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS encerrada_em    TIMESTAMPTZ;
ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS descartada_em   TIMESTAMPTZ;
ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS motivo_descarte TEXT;
ALTER TABLE app.ligacoes ADD COLUMN IF NOT EXISTS client_event_id UUID;

-- Uma ligacao 'em_andamento' ainda nao tem disposicao: resultado passa a ser opcional.
ALTER TABLE app.ligacoes ALTER COLUMN resultado DROP NOT NULL;

-- CHECK do status (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ligacoes_status_chk') THEN
    ALTER TABLE app.ligacoes
      ADD CONSTRAINT ligacoes_status_chk CHECK (status IN ('em_andamento', 'encerrada', 'descartada'));
  END IF;
END $$;

-- Backfill: linhas legadas eram sempre ligacoes concluidas.
UPDATE app.ligacoes SET encerrada_em = criado_em WHERE status = 'encerrada' AND encerrada_em IS NULL;

-- Idempotencia do Iniciar: repetir o clique com o mesmo client_event_id nao cria outra ligacao.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacoes_client_event
  ON app.ligacoes (empresa_id, client_event_id) WHERE client_event_id IS NOT NULL;

-- Recuperacao / "uma ligacao ativa por lead": lookup rapido da ligacao em andamento.
CREATE INDEX IF NOT EXISTS idx_ligacoes_ativa
  ON app.ligacoes (empresa_id, campanha_lead_id) WHERE status = 'em_andamento';

-- Leitura analitica filtra por status; indice de apoio.
CREATE INDEX IF NOT EXISTS idx_ligacoes_status ON app.ligacoes (empresa_id, status);
