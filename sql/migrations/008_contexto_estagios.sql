-- 008_contexto_estagios.sql
-- Estágios POR contexto + ativação de runtime por empresa + thumbnail do card.
-- Cada contexto (card) guarda seus próprios 6 estágios (Núcleo + 5), pode ser
-- ativado/desativado para o RUNTIME e só UM fica ativo por empresa.
-- IMPORTANTE: NÃO reutilizamos a coluna app.empresa_contextos.ativo (criada na
-- 001 com DEFAULT true e múltiplos por empresa). Usamos uma coluna dedicada
-- runtime_ativo (DEFAULT false) — assim o índice único não conflita com dados
-- existentes. Aditiva/idempotente.

ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS estagios_json JSONB,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS runtime_ativo BOOLEAN NOT NULL DEFAULT false;

-- No máximo UM contexto com runtime_ativo por empresa (o código também desativa
-- os demais ao ativar um). DEFAULT false garante que a criação do índice não
-- conflite com os contextos já existentes.
CREATE UNIQUE INDEX IF NOT EXISTS app_empresa_contextos_um_runtime_ativo
  ON app.empresa_contextos (empresa_id)
  WHERE runtime_ativo = true;
