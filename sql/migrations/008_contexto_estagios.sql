-- 008_contexto_estagios.sql
-- Estágios POR contexto + ativação por empresa + thumbnail do card.
-- Cada contexto (card) passa a guardar seus próprios 6 estágios (Núcleo + 5),
-- pode ser ativado/desativado e só UM fica ativo por empresa.
-- Aditiva/idempotente. Não altera comportamento até o runtime passar a ler isto.

ALTER TABLE app.empresa_contextos
  ADD COLUMN IF NOT EXISTS estagios_json JSONB,
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Garante no máximo UM contexto ativo por empresa (trava no banco; o código
-- também desativa os demais ao ativar um).
CREATE UNIQUE INDEX IF NOT EXISTS app_empresa_contextos_um_ativo
  ON app.empresa_contextos (empresa_id)
  WHERE ativo = true;
