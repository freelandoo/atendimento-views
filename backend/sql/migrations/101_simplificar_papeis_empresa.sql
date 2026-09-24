-- 101_simplificar_papeis_empresa.sql
-- Separacao definitiva entre cargo de PLATAFORMA e cargo POR EMPRESA.
--
-- Decisao do operador (2026-09-24):
--   - app.usuarios.role continua sendo plataforma: superadmin | admin | user.
--   - app.usuarios_empresas.role fica somente com os papeis da empresa: owner | comercial.
--   - `admin` de empresa era duplicado de `owner` e vira owner.
--   - `member` era legado sem papel claro no produto novo e vira comercial.
--
-- Convites seguem mais restritos: owner nao nasce por link; por enquanto convite novo cria
-- somente comercial. Convites pendentes antigos admin/member sao convertidos para comercial
-- para nao ficarem invalidos ao apertar a CHECK.

UPDATE app.usuarios_empresas
   SET role = 'owner'
 WHERE role = 'admin';

UPDATE app.usuarios_empresas
   SET role = 'comercial'
 WHERE role = 'member';

ALTER TABLE app.usuarios_empresas
  DROP CONSTRAINT IF EXISTS app_usuarios_empresas_role_chk;

ALTER TABLE app.usuarios_empresas
  ADD CONSTRAINT app_usuarios_empresas_role_chk
  CHECK (role IN ('owner', 'comercial'));

COMMENT ON COLUMN app.usuarios_empresas.role IS
  'Papel EFETIVO do usuario NESTA empresa (owner|comercial). Cargo de plataforma fica em app.usuarios.role (superadmin|admin|user).';

DO $$
BEGIN
  IF to_regclass('app.membro_convites') IS NOT NULL THEN
    UPDATE app.membro_convites
       SET role = 'comercial'
     WHERE role IN ('admin', 'member');

    ALTER TABLE app.membro_convites
      DROP CONSTRAINT IF EXISTS membro_convites_role_chk;

    ALTER TABLE app.membro_convites
      ADD CONSTRAINT membro_convites_role_chk
      CHECK (role IN ('comercial'));
  END IF;
END $$;
