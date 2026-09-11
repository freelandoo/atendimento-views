-- 078_remover_default_pj.sql
-- CRM em EQUIPE — Etapa 12.3. Remove os `DEFAULT '<PJ Codeworks>'` de `empresa_id`.
-- Ver docs/plano-execucao-crm-equipe.md §6 (Etapa 12) e AGENTS.md.
--
-- ══ O DEFEITO QUE ESTE DEFAULT PRODUZ ══
-- As migrations 005 e 006 puseram `DEFAULT '<PJ>'` em `empresa_id` porque, na época, nenhum
-- INSERT informava a coluna e o campo ficava NULL. O default nunca saiu. O resultado medido está
-- no AGENTS.md, em duas frases: *"todo lead de toda empresa nascia marcado como PJ"* e *"a
-- conversão CTWA do tenant nunca sai"*. A migration 058 precisou removê-lo de
-- `vendas.lead_profiles` e escrever um backfill para consertar as linhas.
--
-- O que sobra hoje é a mesma armadilha em 6 tabelas: **um DEFAULT autoriza em silêncio qualquer
-- INSERT futuro que esqueça a coluna.** É exatamente por isso que as migrations 061 e 066 fizeram
-- suas colunas de prova `NOT NULL SEM DEFAULT`.
--
-- ══ POR QUE ISTO É A ÚLTIMA ETAPA, E NÃO A PRIMEIRA ══
-- Remover o DEFAULT só é seguro depois de conferir que TODO INSERT informa a coluna — senão a
-- linha passa a nascer NULA e some dos painéis por empresa. A auditoria foi feita, INSERT por
-- INSERT, e está registrada abaixo. **Duas delas não informavam**, e foram corrigidas no mesmo
-- diff desta migration (é por isso que ela não vem sozinha):
--
--   prospectador.prospects        3 INSERTs, todos informam
--                                  (prospecting.js:1106, api-banco-leads.js:486,
--                                   social-capture.js:299)
--   vendas.conversas              3 INSERTs, todos informam — com `COALESCE($n, PJ)` no NÍVEL DA
--                                  APLICAÇÃO (db-crud.js:145). Remover o DEFAULT do banco não
--                                  muda nada aqui: o fallback da PJ continua existindo no código,
--                                  e é dívida SEPARADA, não desta migration.
--   vendas.lead_profiles          4 INSERTs, todos usam o fragmento de db/lead-profile-empresa.js
--                                  (migration 058)
--   vendas.ai_logs                1 INSERT, informa
--   vendas.followup_envios        1 INSERT **NÃO informava** -> corrigido em db-crud.js:441
--   vendas.analises_pos_conversa  1 INSERT **NÃO informava** -> corrigido em learning.js:153
--
-- As duas correções seguem o padrão da migration 058: a empresa é resolvida a partir da CONVERSA,
-- dentro do próprio SQL. Conversa inexistente ⇒ `NULL`, nunca PJ — não se inventa dono.
--
-- ══ O QUE ESTA MIGRATION NÃO FAZ ══
--   * **Não muta nenhuma linha.** As que já estão marcadas como PJ continuam como estão; corrigir
--     retroativamente é trabalho de backfill, com simulação e rollback.
--   * **Não põe `NOT NULL`.** Linhas antigas com NULL derrubariam o boot (mesmo motivo da 058).
--   * **Não remove o fallback da PJ no CÓDIGO** (`COALESCE($n, PJ)` em db-crud.js e
--     historico-envio.js, e o `PJ_EMPRESA_ID` de api-conversas.js). Aquilo é decisão de produto
--     sobre conversa órfã, documentada no AGENTS.md, e sai numa fase própria.
--
-- ADITIVA quanto a dados. Idempotente.

DO $$
DECLARE
  t TEXT;
  alvos TEXT[][] := ARRAY[
    ARRAY['prospectador', 'prospects'],
    ARRAY['vendas', 'conversas'],
    ARRAY['vendas', 'lead_profiles'],
    ARRAY['vendas', 'followup_envios'],
    ARRAY['vendas', 'analises_pos_conversa'],
    ARRAY['vendas', 'ai_logs']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(alvos, 1) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = alvos[i][1]
         AND table_name = alvos[i][2]
         AND column_name = 'empresa_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN empresa_id DROP DEFAULT', alvos[i][1], alvos[i][2]);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN prospectador.prospects.empresa_id IS
  'Tenant do lead. SEM DEFAULT desde a migration 078: um DEFAULT autoriza em silencio qualquer INSERT futuro que esqueca a coluna, e foi assim que "todo lead de toda empresa nascia marcado como PJ" (migrations 005/006, corrigidas pela 058). Todo INSERT informa a coluna explicitamente.';
