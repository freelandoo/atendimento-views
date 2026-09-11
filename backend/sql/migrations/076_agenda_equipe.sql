-- 076_agenda_equipe.sql
-- CRM em EQUIPE — Etapa 11. Responsável pela reunião + vínculo firme com o lead.
-- Ver docs/especificacao-crm-equipe.md §1.4 e docs/plano-execucao-crm-equipe.md §6 (Etapa 11).
--
-- ══ O DEFEITO: A AGENDA ESTÁ PARTIDA EM DUAS, COM MODELOS OPOSTOS ══
--
--   `vendas.agenda_eventos` (a agenda do BOT, init.sql):
--       tem `usuario_id NOT NULL`, `lead_id`, `conversa_id`, `marcado_por`, recorrência e cadeia
--       de reagendamento — mas o usuário é do dashboard **LEGADO** (`vendas.dashboard_users`) e a
--       tabela **não tem `empresa_id`**.
--   `app.agenda_eventos` (a agenda do PAINEL, migration 011):
--       tem `empresa_id` — mas só `criado_por`, nenhum responsável, e o lead é um **telefone em
--       TEXT**, sem vínculo com `prospectador.prospects`.
--
-- Ou seja: **a agenda que tem dono não tem tenant, e a que tem tenant não tem dono.**
-- Esta migration resolve o lado multiempresa (que é o que a equipe usa). Unificar as duas agendas
-- é projeto próprio e continua fora de escopo.
--
-- ══ POR QUE `responsavel_id` NÃO É `criado_por` ══
-- Quem MARCA e quem CONDUZ a reunião podem ser pessoas diferentes, e com equipe isso deixa de ser
-- exceção: o admin marca para o vendedor, o SDR marca para o closer. `criado_por` já existe e
-- responde "quem agendou"; `responsavel_id` responde "de quem é a reunião" — que é a pergunta que
-- o buffer de horário e a agenda consolidada precisam fazer.
--
-- ══ POR QUE `prospect_id` ══
-- Hoje o vínculo com o lead é `lead_telefone TEXT`, casado por dígitos. Isso funciona para exibir,
-- mas não sobrevive a "de quantas reuniões este lead participou" nem a um lead que trocou de
-- número. `prospect_id` é o vínculo firme; `lead_telefone` **continua existindo e não é tocado** —
-- é ele que casa reunião com contato que ainda não virou prospect.
--
-- ADITIVA: nenhum UPDATE de dado. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Responsável e vínculo com o lead
-- ---------------------------------------------------------------------------
ALTER TABLE app.agenda_eventos
  ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prospect_id    UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL;

-- NENHUM backfill de `responsavel_id = criado_por`, e isto é a decisão: quem criou não é
-- necessariamente quem conduz, e afirmar isso retroativamente inventaria responsabilidade sobre
-- reuniões que já aconteceram. Evento antigo fica sem responsável, que é a verdade sobre ele; a
-- leitura trata `NULL` como "da empresa".

-- "A agenda de fulano", e o cálculo de conflito de horário POR PESSOA (o buffer).
CREATE INDEX IF NOT EXISTS idx_agenda_responsavel_periodo
  ON app.agenda_eventos (empresa_id, responsavel_id, data_inicio)
  WHERE excluido_em IS NULL;

-- "Quantas reuniões este lead teve."
CREATE INDEX IF NOT EXISTS idx_agenda_prospect
  ON app.agenda_eventos (empresa_id, prospect_id)
  WHERE excluido_em IS NULL AND prospect_id IS NOT NULL;

COMMENT ON COLUMN app.agenda_eventos.responsavel_id IS
  'De quem e a reuniao. Distinto de criado_por (quem agendou): com equipe, o admin marca para o vendedor e o SDR marca para o closer. NULL = evento da empresa (inclui todo evento anterior a esta migration — nao ha backfill, porque afirmar que o criador conduz inventaria responsabilidade).';
COMMENT ON COLUMN app.agenda_eventos.prospect_id IS
  'Vinculo FIRME com o lead. lead_telefone continua existindo e nao foi tocado: e ele que casa reuniao com contato que ainda nao virou prospect.';
