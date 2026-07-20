-- 028_ai_logs_uso_custo.sql
-- Habilita a página "Uso & Custo": enriquece vendas.ai_logs com tokens + custo + refs.
-- A rota api-llm-uso já lê essas colunas (antes dava 500 por não existirem). O log
-- (ai-provider._logAI) passa a gravá-las a partir do `usage` que a API já devolve.
-- Aditivo/idempotente: só ADD COLUMN IF NOT EXISTS; histórico antigo fica sem custo (NULL).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'vendas' AND table_name = 'ai_logs'
  ) THEN
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS input_tokens  INTEGER';
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS output_tokens INTEGER';
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(12,6)';
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS ref_type      TEXT';
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS ref_id        TEXT';
    EXECUTE 'ALTER TABLE vendas.ai_logs ADD COLUMN IF NOT EXISTS client_numero TEXT';
  END IF;
END $$;
