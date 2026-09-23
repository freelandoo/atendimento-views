-- 098_convite_permissoes.sql
-- O CONVITE carrega tambem as liberacoes alem do papel (`permissoes`).
--
-- Desde 2026-09-23 o cadastro de membro e' SO por convite (a tela de Contas da empresa deixou de
-- ter o formulario direto). As liberacoes que o gestor escolhia ali passam a ir no convite e sao
-- gravadas no vinculo quando a pessoa aceita — o mesmo `usuarios_empresas.permissoes` da 070.
--
-- SOMENTE ADITIVO, igual ao vinculo: so concessao (`true`), nunca negacao. Saneado na criacao
-- contra o papel do convite e REVALIDADO no aceite (a matriz pode mudar entre um e outro).
--
-- ADITIVA: uma coluna com DEFAULT '{}' (a ausencia de concessao — o mesmo default da 070).
-- Convites ja criados ficam sem concessao extra, que e' exatamente o que eles tinham.
-- Rollback: ALTER TABLE app.membro_convites DROP COLUMN permissoes.

ALTER TABLE app.membro_convites
  ADD COLUMN IF NOT EXISTS permissoes JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membro_convites_permissoes_chk'
  ) THEN
    ALTER TABLE app.membro_convites
      ADD CONSTRAINT membro_convites_permissoes_chk CHECK (jsonb_typeof(permissoes) = 'object');
  END IF;
END $$;
