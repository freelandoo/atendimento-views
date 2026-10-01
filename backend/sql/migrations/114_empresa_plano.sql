-- 114_empresa_plano.sql
-- Camada de PLANO / assinatura (Fase 1 — planos SaaS + cobranca ASAAS).
-- Proposta: docs/propostas/2026-10-01-planos-landing-e-cobranca-asaas.md (secao 2.1).
--
-- O QUE ESTA MIGRATION RESOLVE
-- Nao existe nenhuma camada de "plano contratado" hoje. O controle de acesso e' por papel +
-- capacidades por vinculo (acesso-capacidades.js); os limites de lead sao operacionais (teto
-- diario, orcamento Bright Data). Nenhum deles e' um DIREITO de plano por conta. Sem isto nao
-- da' pra vender em tiers (Minimo/Basico/Pro) nem controlar trial/pagamento. Esta tabela diz
-- QUAL plano e QUAL status (trial/ativo/atrasado/cancelado/expirado) cada empresa tem; o mapa
-- plano->recursos vive no modulo PURO src/services/plano-definicao.js, e o GATE (bloqueio +
-- liberacao de recurso) entra em src/middleware/tenant.js num passo SEPARADO.
--
-- ADITIVA: cria UMA tabela nova. Nenhuma tabela existente e' alterada.
-- ⚠️ NAO confundir com app.empresas.plano (coluna LEGADA da migration 001, valores
-- free/starter/pro/enterprise) — ela nunca foi ligada a logica nenhuma e NAO e' tocada aqui.
-- A assinatura e' um conjunto de fatos (status, trial, vinculo ASAAS) que nao cabem numa coluna.
--
-- GRANDFATHER (mutacao de dado DECLARADA): as empresas que JA existem recebem plano 'legado' +
-- status 'ativo' (origem 'grandfather'), pra continuarem com acesso TOTAL. Fazer o gate bloquear
-- quem ja' usa o produto seria regressao; dar a elas um tier pago seria mentira. 'legado' = "a
-- ausencia de contrato, nomeada" — mesma disciplina de origem_vinculo (061), qualificacao (071)
-- e do papel legado (070). Empresa NOVA (signup) nasce 'trial' pela PROVISAO (passo futuro),
-- nunca por esta migration. Idempotente (ON CONFLICT DO NOTHING): pode rodar 2x.

CREATE TABLE IF NOT EXISTS app.empresa_plano (
  empresa_id            UUID PRIMARY KEY REFERENCES app.empresas(id) ON DELETE CASCADE,
  plano                 TEXT NOT NULL,
  status                TEXT NOT NULL,
  trial_fim             TIMESTAMPTZ,                 -- so' faz sentido em status 'trial'
  asaas_customer_id     TEXT,                        -- preenchido na conversao (ASAAS)
  asaas_subscription_id TEXT,
  origem                TEXT NOT NULL,               -- NOT NULL e SEM DEFAULT de proposito (061):
                                                     -- um INSERT futuro que esquecer a coluna FALHA.
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT empresa_plano_plano_chk  CHECK (plano  IN ('minimo', 'basico', 'pro', 'legado')),
  CONSTRAINT empresa_plano_status_chk CHECK (status IN ('trial', 'ativo', 'atrasado', 'cancelado', 'expirado')),
  CONSTRAINT empresa_plano_origem_chk CHECK (origem IN ('signup', 'grandfather', 'manual')),
  -- status 'trial' precisa saber quando acaba; os demais nao exigem trial_fim.
  CONSTRAINT empresa_plano_trial_chk  CHECK (status <> 'trial' OR trial_fim IS NOT NULL)
);

-- Grandfather: toda empresa existente = acesso total, origem 'grandfather'.
INSERT INTO app.empresa_plano (empresa_id, plano, status, origem)
SELECT id, 'legado', 'ativo', 'grandfather'
  FROM app.empresas
ON CONFLICT (empresa_id) DO NOTHING;
