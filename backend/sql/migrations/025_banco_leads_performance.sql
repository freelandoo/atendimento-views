-- 025_banco_leads_performance.sql
-- Indices aditivos para os caminhos quentes do Banco de Leads. Todos sao
-- idempotentes e preservam dados e contratos existentes.

-- Worker automatico: reduz o conjunto antes de ordenar o lead mais antigo.
-- bloqueado_ate nao entra no predicado porque uma condicao com NOW() nao pode
-- compor indice parcial; ele segue como filtro residual da consulta.
CREATE INDEX IF NOT EXISTS idx_prospects_auto_elegivel
  ON prospectador.prospects (empresa_id, status, created_at)
  INCLUDE (id, bloqueado_ate)
  WHERE tem_whatsapp IS DISTINCT FROM false
    AND NULLIF(BTRIM(COALESCE(telefone, '')), '') IS NOT NULL;

-- GET /leads: localiza o rascunho pendente mais recente sem percorrer todo o
-- historico de disparos do prospect.
CREATE INDEX IF NOT EXISTS idx_lead_disparos_rascunho
  ON prospectador.lead_disparos (prospect_id, criado_em DESC)
  INCLUDE (evolution_instance, mensagem)
  WHERE status = 'aguardando_disparo';

-- GET /leads: o vinculo com a agenda compara telefones normalizados. O indice
-- de lead_telefone bruto da migration 011 nao atende essa expressao.
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_empresa_telefone_normalizado
  ON app.agenda_eventos (
    empresa_id,
    (regexp_replace(COALESCE(lead_telefone, ''), '[^0-9]', '', 'g')),
    data_inicio
  )
  WHERE excluido_em IS NULL
    AND status IN ('pendente', 'confirmado')
    AND lead_telefone IS NOT NULL;
