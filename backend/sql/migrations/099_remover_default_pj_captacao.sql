-- 099_remover_default_pj_captacao.sql
-- Remove os `DEFAULT '<PJ Codeworks>'` de `empresa_id` nas 3 tabelas que a migration 078
-- NAO alcancou. Pendencia registrada em LEGACY_REVIEW.md §1.1 (auditoria de 2026-09-21).
--
-- ══ O DEFEITO ══
-- A migration 012 criou `captacao_campanhas`, `captacao_snapshots` e `email_outreach` com
-- `empresa_id UUID NOT NULL DEFAULT '<PJ>'` (linhas 80, 106 e 135). A 078 removeu exatamente
-- esse DEFAULT de 6 tabelas e nao chegou a estas — elas nasceram depois, num modulo proprio.
--
-- A regra do AGENTS.md vale igual aqui: **um DEFAULT autoriza em silencio qualquer INSERT
-- futuro que esqueca a coluna.** Foi assim que "todo lead de toda empresa nascia marcado como
-- PJ" (migrations 005/006, corrigidas pela 058). O dado entra sob a PJ sem erro e sem rastro.
--
-- ══ A AUDITORIA, INSERT POR INSERT (obrigatoria: a coluna e' NOT NULL) ══
-- Remover o DEFAULT so e' seguro se TODO INSERT informar a coluna. Se algum omitisse, ele
-- passaria a falhar na hora — nao a gravar NULL. Varredura de 2026-09-23, repositorio inteiro:
--
--   prospectador.captacao_campanhas   1 INSERT  — social-capture.js:176      informa
--   prospectador.captacao_snapshots   3 INSERTs — social-capture.js:267,     informam
--                                                 456 e 512
--   prospectador.email_outreach       3 INSERTs — email-outreach.js:81,      informam
--                                                 91 e 99
--
-- Sao 7 INSERTs no total e os 7 nomeiam `empresa_id` na lista de colunas. As demais referencias
-- as tabelas sao SELECT/UPDATE (api-captacao.js:102, social-capture.js) ou comentario
-- (captacao-scheduler.js:46, migrations 018 e 024). Nenhum script, teste ou migration insere.
--
-- Consequencia pratica: **o DEFAULT ja era codigo morto para todos os caminhos de hoje** — ele
-- so dispara quando a coluna e' OMITIDA. Esta migration nao muda o comportamento de nenhum
-- INSERT existente; ela fecha a porta para o INSERT de amanha.
--
-- ══ O QUE ESTA MIGRATION NAO FAZ ══
--   * **Nao muta nenhuma linha.** O que ja esta marcado como PJ continua como esta; corrigir
--     retroativamente e' trabalho de backfill, com simulacao e rollback.
--   * **Nao mexe em `NOT NULL`** nem nas FKs para `app.empresas`.
--   * **Nao toca o fallback da PJ no CODIGO** (`COALESCE($n, PJ)` em db-crud.js e
--     historico-envio.js) — decisao de produto sobre conversa orfa, declarada no AGENTS.md.
--
-- ADITIVA quanto a dados. Idempotente.

DO $$
DECLARE
  alvos TEXT[][] := ARRAY[
    ARRAY['prospectador', 'captacao_campanhas'],
    ARRAY['prospectador', 'captacao_snapshots'],
    ARRAY['prospectador', 'email_outreach']
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

COMMENT ON COLUMN prospectador.captacao_campanhas.empresa_id IS
  'Tenant da campanha. SEM DEFAULT desde a migration 099, pelo mesmo motivo da 078: um DEFAULT autoriza em silencio qualquer INSERT futuro que esqueca a coluna. O unico INSERT (social-capture.js) informa a coluna explicitamente.';

COMMENT ON COLUMN prospectador.captacao_snapshots.empresa_id IS
  'Tenant da coleta. SEM DEFAULT desde a migration 099 (ver 078). Os 3 INSERTs (social-capture.js) informam a coluna explicitamente.';

COMMENT ON COLUMN prospectador.email_outreach.empresa_id IS
  'Tenant do envio. SEM DEFAULT desde a migration 099 (ver 078). Os 3 INSERTs (email-outreach.js) informam a coluna explicitamente.';
