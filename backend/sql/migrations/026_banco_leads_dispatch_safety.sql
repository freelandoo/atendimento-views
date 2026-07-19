-- 026_banco_leads_dispatch_safety.sql
-- Reserva atomica por lead, confirmacao rastreavel na Evolution e teto conservador.

ALTER TABLE prospectador.lead_disparos
  ADD COLUMN IF NOT EXISTS evolution_message_id TEXT;

LOCK TABLE prospectador.lead_disparos IN SHARE ROW EXCLUSIVE MODE;

WITH duplicados AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY prospect_id
           ORDER BY criado_em DESC, id DESC
         ) AS ordem
    FROM prospectador.lead_disparos
   WHERE status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao')
)
UPDATE prospectador.lead_disparos d
   SET status = 'falhou',
       erro = 'reserva_duplicada_migracao'
  FROM duplicados x
 WHERE d.id = x.id
   AND x.ordem > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_disparos_reserva_ativa
  ON prospectador.lead_disparos (prospect_id)
  WHERE status IN ('gerando', 'aguardando_disparo', 'enviando', 'pendente_confirmacao');

CREATE INDEX IF NOT EXISTS idx_lead_disparos_confirmacao_pendente
  ON prospectador.lead_disparos (criado_em ASC)
  WHERE status = 'pendente_confirmacao' AND evolution_message_id IS NOT NULL;

ALTER TABLE app.banco_leads_config
  ALTER COLUMN teto_diario SET DEFAULT 40;

-- O teto ainda era fixo na aplicacao; 100 representa o default anterior, nao uma escolha.
UPDATE app.banco_leads_config
   SET teto_diario = 40,
       atualizado_em = NOW()
 WHERE teto_diario = 100;
