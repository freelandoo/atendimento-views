-- 109_conversa_primeira_resposta.sql
-- "Conversou" no painel comercial: carimbo da PRIMEIRA resposta do lead, gravado NO WEBHOOK
-- (decisao do operador, 2026-09-29). Ver docs/propostas/2026-09-29-dashboard-inteligente-visao-geral.md.
--
-- ADITIVA, nullable, SEM default e SEM backfill: inventar QUANDO um lead respondeu no passado
-- seria mentira (mesma disciplina de origem_vinculo / lead_profiles.empresa_id). So conta pra
-- frente. NULL = ainda nao respondeu OU conversa anterior a esta migration.

ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS primeira_resposta_em TIMESTAMPTZ;

-- O painel filtra por (empresa_id, primeira_resposta_em) num intervalo; indice parcial cobre isso
-- sem pesar as linhas que nunca responderam.
CREATE INDEX IF NOT EXISTS idx_conversas_primeira_resposta
  ON vendas.conversas (empresa_id, primeira_resposta_em)
  WHERE primeira_resposta_em IS NOT NULL;

COMMENT ON COLUMN vendas.conversas.primeira_resposta_em IS
  'Instante da 1a mensagem inbound do lead, gravado no webhook so na 1a vez. NULL = nao respondeu ou conversa anterior a 2026-09-29.';
