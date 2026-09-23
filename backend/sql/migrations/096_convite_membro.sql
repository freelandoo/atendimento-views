-- 096_convite_membro.sql
-- CONVITE DE CADASTRO POR LINK + data de nascimento do usuario.
--
-- O QUE ESTA MIGRATION RESOLVE
-- Para uma pessoa entrar numa empresa, o gestor precisava digitar nome, e-mail e uma senha
-- inicial por ela em Contas da empresa — e depois repassar essa senha. Agora ele gera um LINK
-- de cadastro, e a propria pessoa preenche os dados dela.
--
-- AS REGRAS DO CONVITE (operador, 2026-09-23)
--  - Vale 24 horas e e' de USO UNICO (`usado_em`). Nao e' preso a um e-mail: quem abrir o link
--    se cadastra com o e-mail que quiser — por isso ele morre no primeiro uso e pode ser revogado.
--  - Carrega o PAPEL e, para o comercial, a EQUIPE em que a pessoa entra. `owner` nunca e'
--    convidado (um link vazado nao pode fazer nascer outro dono).
--  - O banco guarda so' o SHA-256 do token. Quem ler a tabela nao consegue montar um link.
--
-- ADITIVA. Cria UMA tabela e acrescenta UMA coluna nullable a `app.usuarios`. Nao apaga e nao
-- muta nenhum dado: contas que ja existem ficam com `data_nascimento` NULL (a ausencia do dado,
-- nomeada — nao se inventa idade retroativa).
-- Rollback: DROP TABLE app.membro_convites; ALTER TABLE app.usuarios DROP COLUMN data_nascimento.

ALTER TABLE app.usuarios
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

CREATE TABLE IF NOT EXISTS app.membro_convites (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  token_hash            TEXT NOT NULL,
  -- SEM DEFAULT, de proposito: o papel e' a decisao do convite, nunca um valor implicito.
  role                  TEXT NOT NULL,
  equipe_id             UUID,
  -- "Para quem e'" — texto livre do gestor, so' para ele reconhecer o convite na lista.
  rotulo                TEXT,
  criado_por            UUID,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em             TIMESTAMPTZ NOT NULL,
  usado_em              TIMESTAMPTZ,
  usado_por_usuario_id  UUID,
  revogado_em           TIMESTAMPTZ,
  revogado_por          UUID,

  CONSTRAINT membro_convites_token_uk UNIQUE (token_hash),
  -- `owner` fica de fora de proposito (ver cabecalho).
  CONSTRAINT membro_convites_role_chk CHECK (role IN ('admin', 'comercial', 'member')),
  -- O comercial SEMPRE nasce numa equipe (decisao do operador). Garantido aqui tambem, para um
  -- caminho futuro que esqueca a validacao nao gravar convite de comercial sem equipe.
  CONSTRAINT membro_convites_equipe_comercial_chk CHECK (role <> 'comercial' OR equipe_id IS NOT NULL),
  -- Usado e revogado sao desfechos excludentes.
  CONSTRAINT membro_convites_desfecho_chk CHECK (usado_em IS NULL OR revogado_em IS NULL),
  CONSTRAINT membro_convites_usado_por_chk CHECK ((usado_em IS NULL) = (usado_por_usuario_id IS NULL)),
  CONSTRAINT membro_convites_rotulo_chk CHECK (rotulo IS NULL OR char_length(rotulo) <= 120),
  -- FK COMPOSTA: a equipe precisa ser DESTA empresa. Um id de equipe de outro tenant falha no
  -- banco, nao so' na aplicacao.
  CONSTRAINT membro_convites_equipe_fk FOREIGN KEY (equipe_id, empresa_id)
    REFERENCES app.equipes_comerciais (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_membro_convites_empresa
  ON app.membro_convites (empresa_id, criado_em DESC);
