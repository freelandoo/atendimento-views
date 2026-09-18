-- 083_comissao_sdr.sql
-- Camada de COMISSAO do comercial (SDR): plano versionado, venda, recebimento e credito.
--
-- ══ POR QUE ESTA MIGRATION EXISTE ══
-- A ATRIBUICAO ja existia e e' a parte dificil: `app.lead_responsavel_historico` (072) e'
-- append-only e prova quem ORIGINOU o lead mesmo depois de ele trocar de mao, e
-- `app.agenda_eventos.responsavel_id` (076) ja separa quem MARCA de quem CONDUZ. O que nao
-- existia era dinheiro: nenhuma tabela, nenhuma coluna, nenhum estado de pagamento.
-- `docs/analise-processo-comercial-tenka.md` §1.5 declarava isso em 2026-08-18
-- ("OPORTUNIDADE_STATUS vai ate `convertido`. Nao ha estado de pagamento") e a decisao de
-- entao foi MEDIR FORA do sistema. Esta migration reverte aquela decisao, a pedido do operador.
--
-- ══ AS TRES SEPARACOES QUE SAO A FEATURE ══
--
-- 1. PLANO ≠ CALCULO. `comissao_planos` e' VERSIONADO (slug + versao, o padrao de
--    `prospectador.icp_modelos`). As faixas sao DADO, nao `if` no codigo. Sem isso, ajustar a
--    faixa em novembro reescreveria o que foi pago em setembro — e comissao paga e' FATO,
--    nao calculo.
--
-- 2. VENDA ≠ PAGAMENTO. `vendas` e' o que foi fechado; `venda_pagamentos` e' o que o cliente
--    efetivamente pagou. O gatilho da comissao e' o PAGAMENTO, e com parcelamento isso sao
--    varios fatos ao longo de meses. Um unico campo "valor da venda" nao consegue responder
--    "quanto ja entrou?" — e e' essa a pergunta que o painel do SDR faz.
--
-- 3. PERCENTUAL CONGELADO ≠ PERCENTUAL CALCULADO. A regra escolhida pelo operador e' "a taxa
--    alcancada vale para as PROXIMAS vendas do mes, sem recalcular para tras". Isso depende da
--    ORDEM das vendas dentro do mes. Se o percentual fosse recalculado na leitura, a comissao
--    do SDR CAIRIA SOZINHA quando uma venda antiga fosse paga com atraso. Por isso
--    `comissao_percentual`, `comissao_valor` e o plano ficam gravados NA LINHA.
--
-- ADITIVA: cria tabelas novas. Nenhum UPDATE de dado existente, nenhuma coluna alterada em
-- tabela que ja existia, nenhum DEFAULT que autorize INSERT futuro a esquecer coluna.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. O PLANO — versionado, porque o passado nao pode ser reescrito
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.comissao_planos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  versao         INTEGER NOT NULL,
  status         TEXT NOT NULL,
  -- [{ "min": 0, "max": 4999.99, "percentual": 10 }, ...] — faixas de faturamento PAGO no mes.
  faixas_json    JSONB NOT NULL,
  gatilho        TEXT NOT NULL,
  moeda          TEXT NOT NULL DEFAULT 'BRL',
  criado_por     UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.comissao_planos
  DROP CONSTRAINT IF EXISTS comissao_planos_status_chk,
  DROP CONSTRAINT IF EXISTS comissao_planos_versao_chk,
  DROP CONSTRAINT IF EXISTS comissao_planos_gatilho_chk,
  DROP CONSTRAINT IF EXISTS comissao_planos_moeda_chk;

ALTER TABLE app.comissao_planos
  ADD CONSTRAINT comissao_planos_status_chk  CHECK (status IN ('rascunho', 'ativo', 'arquivado')),
  ADD CONSTRAINT comissao_planos_versao_chk  CHECK (versao > 0),
  -- CHECK fechada em UM valor, de proposito. E' a licao do canal de e-mail do follow-up
  -- (migration 067): o valor nasce JUNTO do executor. `proporcional` e `acumulado_50` sao
  -- gatilhos legitimos e discutidos, mas nenhum codigo os aplica — cria-los aqui permitiria
  -- configurar um plano que ninguem sabe executar, e o SDR ficaria esperando uma comissao que
  -- nunca seria liberada. Alargar a CHECK e implementar o gatilho tem de ser o MESMO diff.
  ADD CONSTRAINT comissao_planos_gatilho_chk CHECK (gatilho IN ('primeiro_pagamento')),
  ADD CONSTRAINT comissao_planos_moeda_chk   CHECK (moeda ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX IF NOT EXISTS comissao_planos_empresa_slug_versao_uk
  ON app.comissao_planos (empresa_id, slug, versao);

-- UM plano em vigor por empresa. Dois ativos tornariam "qual e' a minha faixa?" ambigua — e
-- essa pergunta e' a unica coisa que o programa inteiro promete responder sem discussao.
CREATE UNIQUE INDEX IF NOT EXISTS comissao_planos_um_ativo_por_empresa_uk
  ON app.comissao_planos (empresa_id)
  WHERE status = 'ativo';

COMMENT ON TABLE app.comissao_planos IS
  'Plano de comissao VERSIONADO. Editar um plano vigente e proibido por desenho: publica-se uma versao nova, e as vendas ja creditadas continuam apontando para a versao sob a qual foram creditadas.';
COMMENT ON COLUMN app.comissao_planos.faixas_json IS
  'Faixas de faturamento PAGO no mes de competencia: [{min, max (null = sem teto), percentual}]. Dado, nunca codigo.';
COMMENT ON COLUMN app.comissao_planos.gatilho IS
  'Em qual pagamento a comissao integral fica liberada. Hoje so `primeiro_pagamento` (decisao do operador, 2026-09-18): o SDR nao controla inadimplencia, e o risco do projeto ja e da operacao.';

-- ---------------------------------------------------------------------------
-- 2. A VENDA — com originador e plano CONGELADOS na linha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.vendas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- Vinculo com o lead. Os TRES sao opcionais e nao se substituem: `prospect_id` e o vinculo
  -- firme; `telefone_digitos` e a identidade do contato (o padrao das migrations 062/066) e
  -- casa venda com contato que ainda nao virou prospect; `agenda_evento_id` existe porque
  -- MUITA venda nao vem de reuniao (fechamento por WhatsApp, semanas depois).
  prospect_id         UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  agenda_evento_id    UUID REFERENCES app.agenda_eventos(id) ON DELETE SET NULL,
  telefone_digitos    TEXT,
  descricao           TEXT,

  valor               NUMERIC(14,2) NOT NULL,
  moeda               TEXT NOT NULL DEFAULT 'BRL',
  fechada_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ORIGINADOR CONGELADO. Resolvido de `app.lead_responsavel_historico` no momento do registro
  -- e gravado aqui. NAO e' uma consulta feita na leitura: o lead pode trocar de mao depois, e a
  -- comissao e' de quem originou, nao de quem esta com o lead hoje.
  originador_id       UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  originador_origem   TEXT NOT NULL,

  -- PLANO CONGELADO (ver a separacao 3 no cabecalho).
  plano_id            UUID REFERENCES app.comissao_planos(id) ON DELETE SET NULL,
  plano_slug          TEXT,
  plano_versao        INTEGER,
  comissao_percentual NUMERIC(5,2),
  comissao_base       NUMERIC(14,2),
  comissao_valor      NUMERIC(14,2),

  -- Mes de competencia = mes em que a comissao foi LIBERADA (o pagamento do cliente), nao o mes
  -- do fechamento. E' a leitura honesta de "faturamento pago no mes": venda fechada em agosto e
  -- paga em setembro conta em setembro, que e quando o dinheiro entrou.
  competencia            DATE,
  comissao_liberada_em   TIMESTAMPTZ,
  comissao_paga_em       TIMESTAMPTZ,
  comissao_paga_por      UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  comissao_pagamento_ref TEXT,

  status              TEXT NOT NULL DEFAULT 'aguardando_pagamento',
  cancelada_motivo    TEXT,
  registrada_por      UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.vendas
  DROP CONSTRAINT IF EXISTS vendas_valor_chk,
  DROP CONSTRAINT IF EXISTS vendas_moeda_chk,
  DROP CONSTRAINT IF EXISTS vendas_status_chk,
  DROP CONSTRAINT IF EXISTS vendas_originador_origem_chk,
  DROP CONSTRAINT IF EXISTS vendas_telefone_chk,
  DROP CONSTRAINT IF EXISTS vendas_credito_completo_chk,
  DROP CONSTRAINT IF EXISTS vendas_competencia_dia1_chk;

ALTER TABLE app.vendas
  ADD CONSTRAINT vendas_valor_chk  CHECK (valor > 0),
  ADD CONSTRAINT vendas_moeda_chk  CHECK (moeda ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT vendas_status_chk CHECK (status IN ('aguardando_pagamento', 'comissao_liberada', 'comissao_paga', 'cancelada')),
  -- `sem_originador` e a ausencia de prova, NOMEADA (o vocabulario de `origem_vinculo`,
  -- migration 061, e de `legado`, 071). Venda sem SDR e' legitima — o operador tambem vende.
  ADD CONSTRAINT vendas_originador_origem_chk CHECK (originador_origem IN ('historico_lead', 'operador', 'sem_originador')),
  ADD CONSTRAINT vendas_telefone_chk CHECK (telefone_digitos IS NULL OR telefone_digitos ~ '^[0-9]{8,15}$'),
  -- Ou o credito esta COMPLETO, ou nao existe. Meio credito (percentual sem valor, competencia
  -- sem plano) deixaria o painel do SDR mostrar um numero que ninguem consegue explicar.
  ADD CONSTRAINT vendas_credito_completo_chk CHECK (
    (comissao_liberada_em IS NULL AND comissao_percentual IS NULL AND comissao_valor IS NULL
      AND comissao_base IS NULL AND competencia IS NULL AND plano_id IS NULL)
    OR (comissao_liberada_em IS NOT NULL AND comissao_percentual IS NOT NULL AND comissao_valor IS NOT NULL
      AND comissao_base IS NOT NULL AND competencia IS NOT NULL AND plano_id IS NOT NULL)
  ),
  ADD CONSTRAINT vendas_competencia_dia1_chk CHECK (competencia IS NULL OR EXTRACT(DAY FROM competencia) = 1);

-- O painel do SDR e o ranking: "vendas creditadas a fulano no mes X".
CREATE INDEX IF NOT EXISTS vendas_empresa_originador_competencia_idx
  ON app.vendas (empresa_id, originador_id, competencia)
  WHERE status <> 'cancelada';

-- A fila do financeiro: o que foi vendido e ainda nao recebeu pagamento.
CREATE INDEX IF NOT EXISTS vendas_empresa_status_idx
  ON app.vendas (empresa_id, status, fechada_em DESC);

CREATE INDEX IF NOT EXISTS vendas_empresa_prospect_idx
  ON app.vendas (empresa_id, prospect_id)
  WHERE prospect_id IS NOT NULL;

COMMENT ON COLUMN app.vendas.originador_id IS
  'Quem ORIGINOU o lead, congelado no registro da venda (resolvido de app.lead_responsavel_historico). NULL = sem originador, que e estado legitimo: nem toda venda vem de SDR.';
COMMENT ON COLUMN app.vendas.comissao_percentual IS
  'Percentual CONGELADO no momento do credito, determinado pelo acumulado do SDR ANTES desta venda. Recalcular na leitura faria a comissao mudar sozinha quando uma venda antiga fosse paga com atraso.';
COMMENT ON COLUMN app.vendas.competencia IS
  'Primeiro dia do mes em que a comissao foi LIBERADA (pagamento do cliente), nao o mes do fechamento.';

-- ---------------------------------------------------------------------------
-- 3. O RECEBIMENTO — ledger append-only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.venda_pagamentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  venda_id       UUID NOT NULL REFERENCES app.vendas(id) ON DELETE CASCADE,
  valor          NUMERIC(14,2) NOT NULL,
  moeda          TEXT NOT NULL DEFAULT 'BRL',
  recebido_em    DATE NOT NULL,
  metodo         TEXT,
  -- Idempotencia OPCIONAL: id do Pix/boleto/cobranca. Quando informada, impede que o mesmo
  -- recebimento seja lancado duas vezes — o que liberaria comissao sobre dinheiro que entrou
  -- uma vez so.
  referencia     TEXT,
  observacao     TEXT,
  registrado_por UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.venda_pagamentos
  DROP CONSTRAINT IF EXISTS venda_pagamentos_valor_chk,
  DROP CONSTRAINT IF EXISTS venda_pagamentos_moeda_chk;

ALTER TABLE app.venda_pagamentos
  ADD CONSTRAINT venda_pagamentos_valor_chk CHECK (valor > 0),
  ADD CONSTRAINT venda_pagamentos_moeda_chk CHECK (moeda ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX IF NOT EXISTS venda_pagamentos_referencia_uk
  ON app.venda_pagamentos (empresa_id, venda_id, referencia)
  WHERE referencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS venda_pagamentos_venda_idx
  ON app.venda_pagamentos (venda_id, recebido_em);

COMMENT ON TABLE app.venda_pagamentos IS
  'Ledger APPEND-ONLY do que o cliente efetivamente pagou. Nao ha UPDATE nem DELETE por rota: lancamento errado se corrige com estorno explicito, porque o painel do SDR e uma promessa de transparencia e um numero que muda sem rastro a destroi.';

-- ---------------------------------------------------------------------------
-- 4. Plano inicial da PJ Codeworks (as faixas aprovadas em 2026-09-18)
-- ---------------------------------------------------------------------------
-- Semeado apenas para a empresa que ja opera comercialmente. Nenhuma outra empresa ganha plano:
-- ausencia de plano e' estado legitimo (= o programa nao foi ligado ali) e inventar um faria a
-- tela prometer comissao que ninguem combinou.
INSERT INTO app.comissao_planos (empresa_id, nome, slug, versao, status, faixas_json, gatilho, moeda)
SELECT e.id, 'Comissao SDR v1', 'sdr-v1', 1, 'ativo',
  '[
    {"min": 0,     "max": 4999.99,  "percentual": 10},
    {"min": 5000,  "max": 9999.99,  "percentual": 12},
    {"min": 10000, "max": 14999.99, "percentual": 15},
    {"min": 15000, "max": null,     "percentual": 18}
  ]'::jsonb,
  'primeiro_pagamento', 'BRL'
  FROM app.empresas e
 WHERE e.nome ILIKE '%PJ Codeworks%'
   AND NOT EXISTS (SELECT 1 FROM app.comissao_planos p WHERE p.empresa_id = e.id);
