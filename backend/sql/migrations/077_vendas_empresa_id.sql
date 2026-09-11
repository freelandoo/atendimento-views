-- 077_vendas_empresa_id.sql
-- CRM em EQUIPE — Etapa 11.2. `empresa_id` nas tabelas `vendas.*` que a operação alcança.
-- Ver docs/especificacao-crm-equipe.md §4.4 e docs/plano-execucao-crm-equipe.md §6 (Etapa 11).
--
-- ══ O ESTADO DE HOJE ══
-- A migration 001 acrescentou `empresa_id` a **5** tabelas `vendas.*` (`conversas`,
-- `lead_profiles`, `followup_envios`, `analises_pos_conversa`, `ai_logs`). O schema tem **28**.
-- As que ficaram de fora e a operação em equipe alcança por rota autenticada:
--
--   `vendas.agenda_eventos`             -> a agenda do BOT, lida pela Agenda e pelos Follow-ups
--   `vendas.eventos_comerciais`         -> alimenta o call score e os relatórios
--   `vendas.followup_auto_agendamentos` -> alimenta a fila de Follow-ups
--   `vendas.lead_contextos`             -> contexto por lead
--   `vendas.agenda_lembretes`           -> lembretes enviados
--
-- ══ ESTA MIGRATION SÓ CRIA COLUNA E ÍNDICE ══
-- **Nenhum `UPDATE`, nenhum `DEFAULT`, nenhum `NOT NULL`.** O preenchimento é um SCRIPT separado
-- (`npm run backfill:vendas-empresa`), que simula por padrão — mesmo padrão de
-- `backfill:lead-profiles-empresa` (migration 058).
--
-- ⚠️ POR QUE **SEM `DEFAULT`**, AO CONTRÁRIO DAS MIGRATIONS 005 E 006
-- Aquelas puseram `DEFAULT '<PJ>'` e o resultado está documentado no AGENTS.md: **todo lead de
-- toda empresa nascia marcado como PJ**, e a conversão CTWA do tenant nunca saía. A migration 058
-- teve de remover o DEFAULT e escrever um backfill para consertar. Repetir o padrão aqui seria
-- repetir um defeito que este repositório já pagou para aprender.
--
-- Consequência declarada: as linhas novas nascem com `empresa_id` NULO até alguém informá-lo.
-- Isso é seguro porque **nada passa a filtrar por esta coluna nesta migration** — quem lê essas
-- tabelas hoje continua lendo como sempre leu. A coluna existe para o backfill e para os
-- consumidores que vierem depois, e é por isso que ela chega antes deles.
--
-- ADITIVA e idempotente. `IF EXISTS` em cada tabela: um ambiente sem alguma delas não quebra.

DO $$
DECLARE
  t TEXT;
  tabelas TEXT[] := ARRAY[
    'agenda_eventos',
    'eventos_comerciais',
    'followup_auto_agendamentos',
    'lead_contextos',
    'agenda_lembretes'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'vendas' AND table_name = t
    ) THEN
      -- Coluna: nullable, sem DEFAULT. Ver o cabeçalho.
      EXECUTE format(
        'ALTER TABLE vendas.%I ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES app.empresas(id)', t
      );
      -- Índice PARCIAL: só as linhas já atribuídas. Enquanto a maioria estiver NULA (antes do
      -- backfill), um índice cheio seria quase todo composto de nulos.
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%s_empresa ON vendas.%I (empresa_id) WHERE empresa_id IS NOT NULL', t, t
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN vendas.agenda_eventos.empresa_id IS
  'Tenant da reuniao marcada pelo BOT. Nullable e SEM DEFAULT de proposito: as migrations 005/006 usaram DEFAULT = PJ e o resultado foi todo lead de toda empresa nascer marcado como PJ (ver AGENTS.md). Preenchido pelo script backfill:vendas-empresa, que resolve o dono pela conversa/lead — nunca por adivinhacao.';
