-- Ajuste operacional aprovado em 2026-09-24.
--
-- Modelo final:
--   - papel de plataforma em app.usuarios.role;
--   - papel por empresa em app.usuarios_empresas.role.
--
-- Esta migration garante o caso do operador principal:
-- pjcodeworks@gmail.com deve ser superadmin da plataforma e owner da empresa PJ Codeworks.
-- Idempotente: se usuario ou empresa ainda nao existirem neste banco, nao faz nada.

DO $$
DECLARE
  v_usuario_id UUID;
  v_empresa_id UUID;
BEGIN
  SELECT id
    INTO v_usuario_id
    FROM app.usuarios
   WHERE lower(email) = 'pjcodeworks@gmail.com'
   LIMIT 1;

  SELECT id
    INTO v_empresa_id
    FROM app.empresas
   WHERE slug = 'pj-codeworks'
   LIMIT 1;

  IF v_usuario_id IS NOT NULL THEN
    UPDATE app.usuarios
       SET role = 'superadmin',
           atualizado_em = NOW()
     WHERE id = v_usuario_id
       AND role <> 'superadmin';
  END IF;

  IF v_usuario_id IS NOT NULL AND v_empresa_id IS NOT NULL THEN
    INSERT INTO app.usuarios_empresas (usuario_id, empresa_id, role, ativo)
    VALUES (v_usuario_id, v_empresa_id, 'owner', true)
    ON CONFLICT (usuario_id, empresa_id)
    DO UPDATE
       SET role = 'owner',
           ativo = true;
  END IF;
END $$;
