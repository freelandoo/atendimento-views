-- 071_lead_qualificacao.sql
-- CRM em EQUIPE — Etapa 3.1. A PORTA da operação comercial.
-- Ver docs/analise-qualificacao-lead-e-multiusuario.md §6 e docs/plano-execucao-crm-equipe.md §5.
--
-- A REGRA DE NEGÓCIO: encontrar um lead NÃO autoriza trabalhá-lo. Ele só entra na operação
-- comercial (ligação, WhatsApp, e-mail, campanha) depois de triagem e aprovação humana.
--
-- POR QUE UMA COLUNA NOVA, E NÃO REUSAR `status`
-- `prospectador.prospects.status` já tem `aguardando|aprovado|rejeitado` — e a semântica está
-- certa. O que impede reusá-lo como fonte única é FACTUAL, não estético:
--   `rodar-leads.js` e `prospecting-send-worker.js` gravam `status = 'enviado'` ao abordar.
--   Ou seja: **`enviado` SOBRESCREVE `aprovado`**. Um lead já contatado não tem mais registro de
--   qualificação. Uma regra da forma "só entra quem está `aprovado`" expulsaria da operação
--   justamente quem mais precisa de follow-up.
-- Aquela coluna mistura QUATRO eixos (qualificação, estado de coleta, fato comercial e
-- compliance). Esta guarda UM: o lead pode ser trabalhado?
-- `status` continua INTOCADO — nenhum valor sai, nenhuma CHECK muda, nenhum dado é mutado.
--
-- ADITIVA: nenhum UPDATE de dado neste arquivo. Idempotente.
--
-- POR QUE `DEFAULT 'legado'` E NÃO `'pendente'`
-- Medido em produção em 2026-09-11 (`npm run medir:qualificacao-lead`): há **4.430 leads**, e
-- **2.748 dos 3.535 elegíveis ao disparo (77,7%) não têm nenhuma prova de triagem** — a curadoria
-- foi usada 3 vezes na vida. Um `DEFAULT 'pendente'` marcaria o acervo inteiro como não triado e
-- **pararia a operação no primeiro boot**.
-- `legado` NÃO é "aprovado": é **a ausência de prova, NOMEADA** — exatamente o vocabulário de
-- `origem_vinculo = 'legado'` (migration 061). Ele opera, e aparece rotulado na tela como
-- "origem não comprovada". Decisão D1, aprovada pelo operador.
--
-- RISCO RESIDUAL DECLARADO E ACEITO: se algum desses leads não deveria ser abordado, ele continua
-- abordável até alguém triá-lo. O custo inverso (parar tudo) foi julgado maior. A ferramenta de
-- redução do acervo `legado` é a curadoria que já existe (migration 055).
--
-- ⚠️ O `DEFAULT` É UMA EXCEÇÃO CONSCIENTE À DISCIPLINA DO PROJETO.
-- As migrations 061 e 066 deixaram colunas de PROVA como `NOT NULL SEM DEFAULT`, porque um
-- DEFAULT autoriza em silêncio qualquer INSERT futuro que esqueça a coluna. Aqui o DEFAULT é o
-- que viabiliza a carência. A mitigação é no CÓDIGO, não no schema: os 2 coletores
-- (`salvarProspect` e o upsert social) informam `'pendente'` EXPLICITAMENTE, e há guarda de
-- regressão em `test/lead-qualificacao.test.js` que lê o fonte e falha se um coletor novo omitir
-- a coluna — é ela que impede um lead novo de nascer `legado` por esquecimento.

-- ---------------------------------------------------------------------------
-- 1. O eixo de qualificação
-- ---------------------------------------------------------------------------
ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS qualificacao      TEXT NOT NULL DEFAULT 'legado',
  ADD COLUMN IF NOT EXISTS qualificado_em    TIMESTAMPTZ,
  -- Quem triou. Nullable SEM DEFAULT: o acervo `legado` não tem autor, e inventar um seria
  -- afirmar que alguém aprovou 4.268 leads. Sem FK para não acoplar prospectador a app.usuarios
  -- (mesma escolha de `vendas.followup_ligacoes.usuario_id`, migration 030).
  ADD COLUMN IF NOT EXISTS qualificado_por   UUID;

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_qualificacao_chk;

ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_qualificacao_chk
  CHECK (qualificacao IN ('pendente', 'aprovado', 'descartado', 'legado'));

-- Coerência: quem tem decisão registrada tem data. O contrário NÃO é exigido — `legado` e
-- `pendente` nunca têm data, e é isso que os distingue de uma aprovação real.
ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_qualificado_em_chk;

ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_qualificado_em_chk
  CHECK (qualificacao NOT IN ('aprovado', 'descartado') OR qualificado_em IS NOT NULL)
  NOT VALID;  -- NOT VALID: nenhuma linha existente é revalidada (todas nascem 'legado').

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
-- A fila comercial só olha quem PODE ser abordado. Índice parcial sobre os dois valores que
-- passam pela porta — é o caminho quente de `filaDeTrabalho`, `rodarLeads` e do worker.
CREATE INDEX IF NOT EXISTS idx_prospects_empresa_abordavel
  ON prospectador.prospects (empresa_id, qualificacao)
  WHERE qualificacao IN ('aprovado', 'legado');

-- A fila de TRIAGEM (o que falta decidir).
CREATE INDEX IF NOT EXISTS idx_prospects_empresa_pendente
  ON prospectador.prospects (empresa_id, created_at DESC)
  WHERE qualificacao = 'pendente';

COMMENT ON COLUMN prospectador.prospects.qualificacao IS
  'A PORTA da operacao comercial: pendente (coletado, ninguem triou) | aprovado (triado por uma pessoa) | descartado (recusado) | legado (operava antes da regra; ausencia de prova, NOMEADA). Distinto de `status`, que mistura coleta, fato comercial e compliance e e sobrescrito por `enviado` ao abordar. Julgado por src/services/lead-qualificacao.js.';
COMMENT ON COLUMN prospectador.prospects.qualificado_por IS
  'Quem triou. NULL em `legado` e `pendente` — o acervo anterior a regra nao tem autor, e inventar um seria afirmar que alguem o aprovou.';
