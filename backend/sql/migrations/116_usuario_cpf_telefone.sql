-- 116_usuario_cpf_telefone.sql
-- Cadastro público passa a exigir CPF + telefone, e a conta fica LINKADA ao CPF (1 conta por CPF).
-- Proposta: docs/propostas/2026-10-01-planos-landing-e-cobranca-asaas.md (secao 4.3, anti-abuso do trial).
--
-- ADITIVA: duas colunas NULLABLE (contas que ja' existiam ficam sem CPF/telefone — nao se inventa
-- CPF de ninguem) + indice unico PARCIAL no CPF (so' entre os nao-nulos). A unicidade e' a trava
-- anti-abuso: o mesmo CPF nao abre uma segunda conta/trial. Nenhum dado existente e' mutado.

ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS cpf      TEXT;
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;

-- 1 conta por CPF (so' vale para quem tem CPF; contas antigas NULL nao colidem).
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_cpf_uk ON app.usuarios (cpf) WHERE cpf IS NOT NULL;
