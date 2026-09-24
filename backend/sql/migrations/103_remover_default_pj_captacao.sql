-- 103_remover_default_pj_captacao.sql
-- Remove o `DEFAULT '<PJ Codeworks>'` de `empresa_id` nas 3 tabelas de captacao social.
-- Continuacao direta da migration 078, que limpou 6 tabelas e deixou estas de fora.
--
-- ══ O DEFEITO QUE ESTE DEFAULT PRODUZ ══
-- Um DEFAULT autoriza EM SILENCIO qualquer INSERT futuro que esqueca a coluna. Foi assim que
-- "todo lead de toda empresa nascia marcado como PJ" (migrations 005/006, corrigidas pela 058
-- com backfill). E' a mesma razao pela qual as colunas de PROVA das migrations 061 e 066 sao
-- `NOT NULL SEM DEFAULT`: sem o default, o esquecimento falha alto em vez de gravar dado sujo.
--
-- ══ A CONFERENCIA QUE TORNA ISTO SEGURO (feita INSERT por INSERT, 2026-09-24) ══
-- Remover o DEFAULT so' e' seguro depois de provar que TODO INSERT informa a coluna — senao a
-- linha passa a nascer NULA e some dos paineis por empresa. Sao SETE INSERTs, e os sete
-- informam `empresa_id` explicitamente:
--
--   prospectador.captacao_campanhas   1 INSERT  — services/social-capture.js:176
--   prospectador.captacao_snapshots   3 INSERTs — services/social-capture.js:267, 456, 512
--   prospectador.email_outreach       3 INSERTs — services/email-outreach.js:81, 91, 99
--
-- Diferenca declarada em relacao a 078: la, DOIS INSERTs dependiam do default e precisaram ser
-- corrigidos no mesmo diff. Aqui NENHUM depende — por isso esta migration vem sozinha, sem
-- alteracao de codigo junto.
--
-- ══ O QUE ESTA MIGRATION NAO FAZ ══
--   * **Nao muta dado.** Linha que ja nasceu marcada como PJ pelo default continua como esta';
--     corrigir retroativamente e' trabalho de backfill, com simulacao e rollback.
--   * **Nao mexe no NOT NULL**, que ja existia nas tres colunas desde a migration 012 e continua.
--   * **Nao remove fallback da PJ no CODIGO** — nao ha nenhum nestes tres caminhos.
--
-- ADITIVA quanto a dados. Idempotente.

DO $$
DECLARE
  alvos TEXT[] := ARRAY['captacao_campanhas', 'captacao_snapshots', 'email_outreach'];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(alvos, 1) LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'prospectador'
         AND table_name = alvos[i]
         AND column_name = 'empresa_id'
    ) THEN
      EXECUTE format('ALTER TABLE prospectador.%I ALTER COLUMN empresa_id DROP DEFAULT', alvos[i]);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN prospectador.captacao_campanhas.empresa_id IS
  'Tenant da campanha. SEM DEFAULT desde a migration 103: um DEFAULT autoriza em silencio qualquer INSERT futuro que esqueca a coluna. O unico INSERT (services/social-capture.js) a informa explicitamente.';
COMMENT ON COLUMN prospectador.captacao_snapshots.empresa_id IS
  'Tenant do snapshot de coleta. SEM DEFAULT desde a migration 103. Os 3 INSERTs (services/social-capture.js) informam a coluna explicitamente.';
COMMENT ON COLUMN prospectador.email_outreach.empresa_id IS
  'Tenant do ledger de primeira abordagem por e-mail. SEM DEFAULT desde a migration 103. Os 3 INSERTs (services/email-outreach.js) informam a coluna explicitamente.';
