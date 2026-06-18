-- Proposito: Registrar análises, decisões e restrições de cada resposta

  numero TEXT NOT NULL,
  mensagem_lead TEXT NOT NULL,
  decisoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  restricoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confianca_analise NUMERIC(3,0) DEFAULT 0,
  feedback_score NUMERIC(1,0),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_analise_estruturada_numero_chk CHECK (numero IS NOT NULL AND length(numero) > 0)
CREATE INDEX IF NOT EXISTS idx_ai_analise_numero
  WHERE criado_em > NOW() - INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_ai_analise_confianca
  WHERE confianca_resposta > 0;

CREATE INDEX IF NOT EXISTS idx_ai_analise_feedback
  ON vendas.ai_analise_estruturada (feedback_score DESC)

CREATE TABLE IF NOT EXISTS vendas.ai_padroes_sucesso (
  intencao TEXT NOT NULL,
  estagio TEXT NOT NULL,
  acao_principal TEXT NOT NULL,
  tom_resposta TEXT NOT NULL,
  vezes_usado BIGINT NOT NULL DEFAULT 1,
  vezes_bem_avaliado BIGINT NOT NULL DEFAULT 1,
  peso_aprendizado NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_padroes_sucesso_unique
  CONSTRAINT ai_padroes_sucesso_taxa_chk
);

CREATE INDEX IF NOT EXISTS idx_ai_padroes_peso
  ON vendas.ai_padroes_sucesso (peso_aprendizado DESC);

CREATE INDEX IF NOT EXISTS idx_ai_padroes_estagio
  ON vendas.ai_padroes_sucesso (estagio);
CREATE TABLE IF NOT EXISTS vendas.ai_guardrail_logs (
  id BIGSERIAL PRIMARY KEY,
  numero TEXT NOT NULL,
  severidade TEXT NOT NULL DEFAULT 'warning',
  ação_tomada TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_guardrail_logs_tipo_chk CHECK (tipo_guardrail IS NOT NULL AND length(tipo_guardrail) > 0)

CREATE INDEX IF NOT EXISTS idx_ai_guardrail_tipo
  ON vendas.ai_guardrail_logs (tipo_guardrail, severidade);

CREATE INDEX IF NOT EXISTS idx_ai_guardrail_numero
  WHERE criado_em > NOW() - INTERVAL '7 days';
COMMENT ON TABLE vendas.ai_analise_estruturada
  IS 'Análises estruturadas retornadas pelo Claude — para aprendizado e auditoria';
  IS 'Padrões de resposta que funcionaram bem — reforçados pelo sistema de aprendizado';
COMMENT ON TABLE vendas.ai_guardrail_logs
  IS 'Log de guardrails acionados — para monitorar segurança das respostas';

CREATE OR REPLACE FUNCTION atualizar_timestamp_ai_analise()
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_analise_atualizar_timestamp
  BEFORE UPDATE ON vendas.ai_analise_estruturada
  FOR EACH ROW
