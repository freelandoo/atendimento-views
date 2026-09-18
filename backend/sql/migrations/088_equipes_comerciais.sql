-- 088_equipes_comerciais.sql
-- Operacao Comercial — Equipes por Nicho, Etapa 2 (fundacao de equipes).
--
-- O QUE ESTA MIGRATION RESOLVE
-- Depois do pre-requisito `prospectador.prospects.nicho_id` (087), passa a existir a entidade
-- operacional que o dono administra: uma equipe comercial apontada para UM nicho do catalogo.
-- O recorte nos modulos de trabalho ainda NAO e aplicado aqui; esta migration cria somente a
-- fundacao que a proxima etapa vai consultar.
--
-- REGRAS DE PRODUTO ENCODADAS NO BANCO
--  1. Equipe nao e papel. Permissao continua em `app.usuarios_empresas`; equipe e organizacao do
--     trabalho, nao autorizacao.
--  2. Uma equipe tem exatamente um nicho (`nicho_id NOT NULL`).
--  3. Uma pessoa so pode estar em uma equipe ativa por empresa (indice parcial por usuario).
--  4. O nicho e validado por ID + empresa. Recorte por nome foi recusado: grafia diferente tiraria
--     leads da carteira em silencio.
--
-- ADITIVA: cria tabelas novas e indices auxiliares. Nenhum dado existente e mutado.

-- A FK composta equipe -> nicho precisa de alvo composto. O indice tambem existe na 087, mas fica
-- aqui para esta migration ser robusta se alguem executar uma fatia isolada em ambiente local.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nichos_id_empresa ON app.nichos (id, empresa_id);

-- `usuarios_empresas.id` ja e PRIMARY KEY, mas uma FK composta precisa de UNIQUE nas colunas
-- referenciadas. Isto nao restringe nada novo; so permite provar empresa e usuario do vinculo no
-- proprio banco.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_empresas_id_empresa_usuario
  ON app.usuarios_empresas (id, empresa_id, usuario_id);

CREATE TABLE IF NOT EXISTS app.equipes_comerciais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  nicho_id      UUID NOT NULL,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  status        TEXT NOT NULL DEFAULT 'ativa',
  criado_por    UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encerrada_em  TIMESTAMPTZ,
  encerrada_por UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT equipes_comerciais_nome_chk CHECK (length(trim(nome)) >= 2),
  CONSTRAINT equipes_comerciais_status_chk CHECK (status IN ('ativa', 'encerrada')),
  CONSTRAINT equipes_comerciais_encerramento_chk CHECK (
    status <> 'encerrada'
    OR (encerrada_em IS NOT NULL AND encerrada_por IS NOT NULL)
  ),
  CONSTRAINT equipes_comerciais_nicho_fk
    FOREIGN KEY (nicho_id, empresa_id)
    REFERENCES app.nichos (id, empresa_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipes_comerciais_id_empresa
  ON app.equipes_comerciais (id, empresa_id);

-- Evita duas equipes ativas disputando a mesma carteira de nicho. Se um dia houver squad A/B no
-- mesmo nicho, isso deve virar decisao explicita, nao duplicidade acidental.
CREATE UNIQUE INDEX IF NOT EXISTS equipes_comerciais_um_nicho_ativo_uk
  ON app.equipes_comerciais (empresa_id, nicho_id)
  WHERE status = 'ativa';

CREATE UNIQUE INDEX IF NOT EXISTS equipes_comerciais_nome_ativo_uk
  ON app.equipes_comerciais (empresa_id, lower(nome))
  WHERE status = 'ativa';

CREATE INDEX IF NOT EXISTS equipes_comerciais_empresa_status_idx
  ON app.equipes_comerciais (empresa_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS app.equipe_comercial_membros (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  equipe_id          UUID NOT NULL,
  usuario_empresa_id UUID NOT NULL,
  usuario_id         UUID NOT NULL,
  criado_por         UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  entrou_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saiu_em            TIMESTAMPTZ,
  removido_por       UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  motivo_saida       TEXT,
  CONSTRAINT equipe_membros_equipe_fk
    FOREIGN KEY (equipe_id, empresa_id)
    REFERENCES app.equipes_comerciais (id, empresa_id)
    ON DELETE CASCADE,
  CONSTRAINT equipe_membros_vinculo_fk
    FOREIGN KEY (usuario_empresa_id, empresa_id, usuario_id)
    REFERENCES app.usuarios_empresas (id, empresa_id, usuario_id)
    ON DELETE CASCADE,
  CONSTRAINT equipe_membros_saida_chk CHECK (
    (saiu_em IS NULL AND removido_por IS NULL)
    OR (saiu_em IS NOT NULL AND removido_por IS NOT NULL)
  )
);

-- Regra central do operador: uma pessoa so pode estar em uma equipe ativa por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS equipe_membros_um_ativo_por_usuario_uk
  ON app.equipe_comercial_membros (empresa_id, usuario_id)
  WHERE saiu_em IS NULL;

CREATE INDEX IF NOT EXISTS equipe_membros_equipe_ativos_idx
  ON app.equipe_comercial_membros (empresa_id, equipe_id)
  WHERE saiu_em IS NULL;

CREATE INDEX IF NOT EXISTS equipe_membros_usuario_historico_idx
  ON app.equipe_comercial_membros (empresa_id, usuario_id, entrou_em DESC);

COMMENT ON TABLE app.equipes_comerciais IS
  'Equipes operacionais da Operacao Comercial. Uma equipe ativa aponta para UM nicho do catalogo da propria empresa; equipe nao e papel de acesso.';
COMMENT ON TABLE app.equipe_comercial_membros IS
  'Vinculo historico pessoa -> equipe comercial. Uma pessoa so pode ter um vinculo ativo por empresa; saida e explicita e nao apaga historico.';
