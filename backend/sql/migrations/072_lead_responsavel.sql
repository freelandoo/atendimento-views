-- 072_lead_responsavel.sql
-- CRM em EQUIPE — Etapa 4. Dono explícito do lead + fila de livres + histórico de responsáveis.
-- Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 4) e docs/especificacao-crm-equipe.md §4.
--
-- O QUE ESTA MIGRATION RESOLVE
-- `prospectador.prospects` não tem dono. Com uma pessoa só isso nunca importou; com equipe, "quem
-- trabalha este lead?" não tem resposta, e o problema a evitar é concreto: **dois vendedores
-- abordando a mesma pessoa**.
--
-- 1:1, NÃO N:N — e isto é a decisão, não uma simplificação.
-- A especificação lista `lead_assignments` como tabela candidata. Ela foi recusada (§4.3): um lead
-- tem UM responsável. Permitir vários seria modelar exatamente o problema que o ownership existe
-- para impedir. `responsavel_id` na própria linha também é o que permite o CLAIM atômico
-- (`UPDATE ... WHERE responsavel_id IS NULL RETURNING`), que é como duas pessoas clicando ao mesmo
-- tempo são resolvidas sem lock de aplicação.
--
-- `NULL` É ESTADO DE PRIMEIRA CLASSE: é a **fila de livres**. Não é "erro", não é "sem dono
-- ainda" — é o lead que qualquer vendedor pode assumir. Todo lead nasce assim, e o backfill
-- desta coluna **não existe de propósito**: inventar dono retroativo é o defeito que as migrations
-- 058 e 060 removeram deste repositório.
--
-- ADITIVA: nenhum UPDATE de dado. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. O dono
-- ---------------------------------------------------------------------------
-- Sem FK para `app.usuarios`: `prospectador` não depende de `app` em nenhuma coluna de autoria
-- (mesma escolha de `vendas.followup_ligacoes.usuario_id`, migration 030, e de
-- `prospects.qualificado_por`, migration 071). A validação de que o responsável é um membro ATIVO
-- da empresa é da camada de dados — é lá que ela pode ser feita com o `empresa_id` em mãos.
--
-- `responsavel_desde` existe separado de `atualizado_em` porque a Central de Mensagens e o Banco
-- de Leads ordenam por `updated_at`: se a atribuição mexesse nele, distribuir 40 leads reordenaria
-- a carteira inteira sem nenhum fato novo sobre os leads.
ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS responsavel_id     UUID,
  ADD COLUMN IF NOT EXISTS responsavel_desde  TIMESTAMPTZ;

-- Coerência: quem tem dono tem data. O contrário é o estado normal (fila de livres).
ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_responsavel_desde_chk;

ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_responsavel_desde_chk
  CHECK (responsavel_id IS NULL OR responsavel_desde IS NOT NULL)
  NOT VALID;  -- nenhuma linha existente tem responsável, então não há o que revalidar.

-- "Meus leads": o caminho quente do vendedor. Parcial porque a maioria da carteira é livre.
CREATE INDEX IF NOT EXISTS idx_prospects_responsavel
  ON prospectador.prospects (empresa_id, responsavel_id)
  WHERE responsavel_id IS NOT NULL;

-- "Leads livres abordáveis": a fila que o vendedor pode assumir. Combina os dois eixos desta
-- etapa e da anterior — é a consulta que a tela do Banco de Leads faz por padrão.
CREATE INDEX IF NOT EXISTS idx_prospects_livres_abordaveis
  ON prospectador.prospects (empresa_id, created_at DESC)
  WHERE responsavel_id IS NULL AND qualificacao IN ('aprovado', 'legado');

-- ---------------------------------------------------------------------------
-- 2. Histórico de responsáveis
-- ---------------------------------------------------------------------------
-- POR QUE UMA TABELA, E NÃO `app.auditoria_eventos`
-- A auditoria registraria o evento, mas o cabeçalho da migration 047 declara que ela
-- **"NÃO deve ser fonte de dashboards"**. "Quantos leads o vendedor X já teve", "quantas vezes
-- este lead trocou de mão" e "quem o tinha em março" são métricas de GESTÃO — é o mesmo
-- raciocínio que separou `vendas.lead_profiles_empresa_backfill` da auditoria.
-- As duas coisas convivem: a auditoria também recebe a linha (quem fez), e esta tabela é a
-- SEQUÊNCIA (de quem para quem).
CREATE TABLE IF NOT EXISTS app.lead_responsavel_historico (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  prospect_id           UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  -- NULL no anterior = veio da fila de livres. NULL no novo = voltou para a fila.
  -- Os dois nulos ao mesmo tempo não fazem sentido e a CHECK abaixo recusa.
  responsavel_anterior_id UUID,
  responsavel_novo_id     UUID,
  -- Quem executou a troca. Pode ser o próprio vendedor (assumiu) ou o admin (distribuiu).
  usuario_id            UUID,
  -- `assumiu` (claim pelo vendedor) | `atribuiu` (admin distribuiu) | `transferiu` (admin trocou o
  -- dono) | `liberou` (voltou para a fila). É vocabulário FECHADO: cada um responde uma pergunta
  -- diferente de gestão, e um texto livre aqui viraria um campo que ninguém consegue agrupar.
  acao                  TEXT NOT NULL,
  motivo                TEXT,
  ocorrido_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_resp_hist_acao_chk
    CHECK (acao IN ('assumiu', 'atribuiu', 'transferiu', 'liberou')),
  CONSTRAINT lead_resp_hist_mudanca_chk
    CHECK (responsavel_anterior_id IS NOT NULL OR responsavel_novo_id IS NOT NULL)
);

-- A linha do tempo de um lead.
CREATE INDEX IF NOT EXISTS idx_lead_resp_hist_prospect
  ON app.lead_responsavel_historico (empresa_id, prospect_id, ocorrido_em DESC);
-- "O que passou pelas mãos deste vendedor" — a leitura de gestão.
CREATE INDEX IF NOT EXISTS idx_lead_resp_hist_responsavel
  ON app.lead_responsavel_historico (empresa_id, responsavel_novo_id, ocorrido_em DESC);

COMMENT ON COLUMN prospectador.prospects.responsavel_id IS
  'Dono do lead. NULL = FILA DE LIVRES (estado normal e de primeira classe, nao erro): qualquer vendedor pode assumir via claim atomico. 1:1 de proposito — permitir varios responsaveis modelaria o problema que o ownership existe para impedir.';
COMMENT ON TABLE app.lead_responsavel_historico IS
  'SEQUENCIA de donos de cada lead. Separada de app.auditoria_eventos porque aquela nao deve ser fonte de dashboard (migration 047) e "quantos leads o vendedor X teve" e metrica de gestao. As duas convivem: a auditoria registra quem fez, esta registra de quem para quem.';
