-- Migration 014: Identidade & Acesso
-- Idempotente. Apenas aditiva — nunca dropa colunas/tabelas.

-- Ganchos de billing (sem lógica nesta entrega)
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'free';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS assinatura_status TEXT NOT NULL DEFAULT 'ativa';
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS onboarding_completo BOOLEAN NOT NULL DEFAULT false;

-- Dono direto da empresa (atalho de leitura; o vínculo N:N segue sendo a fonte de verdade de acesso)
ALTER TABLE app.empresas ADD COLUMN IF NOT EXISTS criada_por UUID REFERENCES app.usuarios(id);

CREATE INDEX IF NOT EXISTS idx_empresas_criada_por ON app.empresas (criada_por);
