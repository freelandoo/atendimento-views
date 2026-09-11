-- 074_conversa_responsavel.sql
-- CRM em EQUIPE — Etapa 7. Dono da CONVERSA + histórico de responsáveis.
-- Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 7) e docs/especificacao-crm-equipe.md §4.
--
-- O DEFEITO QUE ESTA MIGRATION CORRIGE
-- `vendas.conversas` tem `operador_assumiu_em TIMESTAMPTZ` — registra **QUANDO** alguém assumiu o
-- atendimento e **NUNCA QUEM**. O conceito de handoff existe no produto desde sempre, sem dono.
-- Com uma pessoa isso nunca importou; com equipe, "quem está atendendo este cliente?" não tem
-- resposta, e duas pessoas podem responder a mesma conversa sem saber uma da outra.
--
-- POR QUE ESTA ETAPA VEM JUNTO DA ABERTURA DO PAPEL COMERCIAL
-- A matriz (§3) diz que o `comercial` vê **as suas conversas + as não atribuídas**, e que
-- `CONVERSA_VER_TODAS` é de admin. Sem esta coluna não existe "as suas" — o recorte seria
-- impossível e o comercial veria a empresa inteira. É por isso que a Etapa 6 deliberadamente NÃO
-- migrou `/conversas`: a permissão sem o ownership seria pior que nenhuma das duas.
--
-- `NULL` É A FILA DE NÃO ATRIBUÍDAS — estado de primeira classe, não erro. Toda conversa nasce
-- assim (chega pelo webhook, sem dono), e o `comercial` PRECISA vê-la: uma conversa que ninguém
-- vê é um cliente sem resposta. Este é o contraste com o lead (migration 072), onde a fila de
-- livres é opcional; aqui ela é obrigatória.
--
-- ADITIVA: nenhum UPDATE de dado. Idempotente.
-- **Nenhum backfill de responsável, e isto é a decisão:** `operador_assumiu_em` diz quando, não
-- quem — não existe de onde inferir. Inventar dono retroativo é o defeito que as migrations 058 e
-- 060 removeram deste repositório. As conversas antigas entram como não atribuídas, que é a
-- verdade sobre elas.

-- ---------------------------------------------------------------------------
-- 1. O dono da conversa
-- ---------------------------------------------------------------------------
-- Sem FK para `app.usuarios`: `vendas` é o schema do agente single-tenant e não referencia `app`
-- em colunas de autoria (mesma escolha de `vendas.followup_ligacoes.usuario_id`, migration 030).
-- A validação de que o responsável é membro ATIVO da empresa é da camada de dados.
--
-- `responsavel_desde` existe separado de `atualizado_em` por um motivo concreto: a Central de
-- Mensagens ORDENA por `atualizado_em`, e o AGENTS.md já registra que escrever nele sem fato novo
-- reordena a lista debaixo do operador (foi o cuidado tomado com `nome_whatsapp`, migration 065).
-- Assumir uma conversa não é mensagem nova.
ALTER TABLE vendas.conversas
  ADD COLUMN IF NOT EXISTS responsavel_id    UUID,
  ADD COLUMN IF NOT EXISTS responsavel_desde TIMESTAMPTZ;

ALTER TABLE vendas.conversas
  DROP CONSTRAINT IF EXISTS conversas_responsavel_desde_chk;

ALTER TABLE vendas.conversas
  ADD CONSTRAINT conversas_responsavel_desde_chk
  CHECK (responsavel_id IS NULL OR responsavel_desde IS NOT NULL)
  NOT VALID;

-- "Minhas conversas" e "não atribuídas": os dois caminhos quentes da Central de Mensagens.
-- Não é índice parcial (como o de leads) porque AQUI as duas metades são consultadas: o comercial
-- pede `responsavel_id = eu OR responsavel_id IS NULL` na mesma query.
CREATE INDEX IF NOT EXISTS idx_conversas_empresa_responsavel
  ON vendas.conversas (empresa_id, responsavel_id, atualizado_em DESC);

-- ---------------------------------------------------------------------------
-- 2. Histórico de responsáveis da conversa
-- ---------------------------------------------------------------------------
-- Tabela própria, no schema `app`, pelo mesmo motivo da 072: `app.auditoria_eventos` declara no
-- cabeçalho da 047 que **não deve ser fonte de dashboards**, e "quantas conversas passaram por
-- este atendente" é métrica de gestão. As duas convivem.
--
-- IDENTIDADE: `empresa_id` + `conversa_numero`, **sem FK para `vendas.conversas`**.
-- Este é o mesmo raciocínio das migrations 062 e 066, e é obrigatório aqui: `vendas.conversas.numero`
-- é `UNIQUE` **GLOBAL** (init.sql:6), então uma FK não provaria mesma empresa — e o histórico de
-- transferências de um tenant poderia apontar para a conversa de outro.
CREATE TABLE IF NOT EXISTS app.conversa_responsavel_historico (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  -- O JID/telefone como está em vendas.conversas.numero. Não é PII exposta por rota: as leituras
  -- desta tabela são escopadas por empresa e a API devolve o telefone já mascarado.
  conversa_numero         TEXT NOT NULL,
  responsavel_anterior_id UUID,
  responsavel_novo_id     UUID,
  usuario_id              UUID,
  -- `assumiu` (o atendente pegou uma conversa sem dono) | `atribuiu` (admin deu a alguém) |
  -- `transferiu` (trocou de atendente) | `liberou` (voltou para a fila de não atribuídas).
  -- Vocabulário FECHADO e o MESMO da migration 072, de propósito: é a mesma pergunta de gestão
  -- sobre outra entidade, e dois vocabulários divergentes fariam o painel do admin ter duas
  -- colunas que significam a mesma coisa.
  acao                    TEXT NOT NULL,
  motivo                  TEXT,
  ocorrido_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversa_resp_hist_acao_chk
    CHECK (acao IN ('assumiu', 'atribuiu', 'transferiu', 'liberou')),
  CONSTRAINT conversa_resp_hist_mudanca_chk
    CHECK (responsavel_anterior_id IS NOT NULL OR responsavel_novo_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_conversa_resp_hist_conversa
  ON app.conversa_responsavel_historico (empresa_id, conversa_numero, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_conversa_resp_hist_responsavel
  ON app.conversa_responsavel_historico (empresa_id, responsavel_novo_id, ocorrido_em DESC);

COMMENT ON COLUMN vendas.conversas.responsavel_id IS
  'Atendente responsavel. NULL = FILA DE NAO ATRIBUIDAS, e o comercial PRECISA ver essa fila: conversa que ninguem ve e cliente sem resposta. Complementa operador_assumiu_em, que registrava QUANDO alguem assumiu e nunca QUEM.';
COMMENT ON TABLE app.conversa_responsavel_historico IS
  'SEQUENCIA de atendentes de cada conversa. Identidade = (empresa_id, conversa_numero), SEM FK para vendas.conversas: aquele numero e UNIQUE GLOBAL e nao prova empresa (mesmo motivo das migrations 062/066). Vocabulario de acao identico ao de app.lead_responsavel_historico, de proposito.';
