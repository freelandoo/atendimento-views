-- 070_papel_comercial.sql
-- CRM em EQUIPE — Etapa 1 (fundação de autorização). Ver docs/plano-execucao-crm-equipe.md.
--
-- O QUE ESTA MIGRATION RESOLVE
-- `app.usuarios_empresas.role` existe desde a migration 001 (owner|admin|member), é escrito em
-- 3 lugares e NUNCA autorizou nada: `requireRole` lê `app.usuarios.role`, que é GLOBAL. Efeito
-- medido: quem é `admin` global é admin em TODA empresa a que pertença. A partir desta etapa o
-- papel EFETIVO passa a ser o do VÍNCULO, e é aqui que ele ganha o valor que faltava.
--
-- ADITIVA E NEUTRA EM COMPORTAMENTO:
--   * a CHECK de `role` só ALARGA (acrescenta 'comercial'); nenhum valor é removido;
--   * nenhuma linha existente é mutada — nenhum UPDATE de dado neste arquivo;
--   * as 3 colunas novas são NULLABLE ou têm DEFAULT compatível com o que já existe;
--   * nada passa a ler `permissoes` nesta etapa (a matriz de capacidades reproduz o gating
--     atual). Quem concede é a Etapa 2; quem consome é a Etapa 6.
-- Idempotente: pode rodar 2x.
--
-- POR QUE UM ÚNICO PAPEL NOVO, E NÃO SEIS
-- `manager`, `sdr`, `closer`, `attendant` e `viewer` não têm ocupante — a operação é uma
-- pessoa. Papel sem ocupante é coluna de matriz que ninguém valida e que apodrece na primeira
-- divergência. `superadmin` (plataforma) e `owner`/`admin` (empresa) já existem. Quando houver
-- um gerente de verdade, `manager` é UM valor nesta CHECK e UMA coluna na matriz — não uma
-- refatoração. Decisão A de docs/especificacao-crm-equipe.md.
--
-- POR QUE `permissoes` É JSONB NA LINHA DO VÍNCULO, E NÃO UMA TABELA `user_permissions`
-- A concessão é rara e esparsa (0 a 2 por pessoa). Uma tabela produziria um JOIN extra em TODO
-- request autenticado para guardar o que cabe na linha que o middleware já carrega. O projeto
-- já usa JSONB extensível exatamente para isto (`config_json`, `metadata`, `auditoria.contexto`).
-- Decisão B de docs/especificacao-crm-equipe.md.
--
-- REGRA DURA, ENCARNADA NO CÓDIGO (services/acesso-capacidades.js), NÃO NO SCHEMA:
-- `permissoes` é SOMENTE ADITIVA — nunca nega o que o papel permite. Sem isso nasce o estado
-- "o papel diz sim, o override diz não", que é onde toda matriz de permissão apodrece e onde a
-- resposta a "por que ele não consegue?" deixa de ser derivável. Negar = trocar o papel.
-- Não há CHECK para isso porque a garantia é de leitura (o avaliador ignora chave falsa), e uma
-- CHECK sobre JSONB livre engessaria o formato antes de existirem consumidores.

-- ---------------------------------------------------------------------------
-- 1. O papel comercial
-- ---------------------------------------------------------------------------
ALTER TABLE app.usuarios_empresas
  DROP CONSTRAINT IF EXISTS app_usuarios_empresas_role_chk;

ALTER TABLE app.usuarios_empresas
  ADD CONSTRAINT app_usuarios_empresas_role_chk
  CHECK (role IN ('owner', 'admin', 'comercial', 'member'));

-- ---------------------------------------------------------------------------
-- 2. Concessões pontuais, autoria e último acesso POR VÍNCULO
-- ---------------------------------------------------------------------------
-- `permissoes`: concessões aditivas ({capacidade: true}). DEFAULT '{}' = nenhuma concessão,
--   que é exatamente o estado de hoje. NOT NULL para o avaliador nunca precisar tratar null.
-- `criado_por`: quem adicionou a pessoa à empresa. Nullable SEM DEFAULT — os vínculos que já
--   existem não têm autor conhecido, e inventar um seria mentir sobre quem convidou quem.
--   (Mesmo raciocínio de `origem_vinculo_usuario_id`, migration 061.)
-- `ultimo_acesso_em`: "last_access" POR EMPRESA. `app.usuarios.ultimo_login_em` já existe, mas
--   é global: com uma pessoa servindo duas empresas, ele não responde "quando ela trabalhou
--   NESTA operação?". Nada escreve nesta coluna na Etapa 1 (ver plano, Etapa 2.4).
ALTER TABLE app.usuarios_empresas
  ADD COLUMN IF NOT EXISTS permissoes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS criado_por       UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;

-- Listagem de "Contas da empresa" (Etapa 2) e resolução do papel efetivo no middleware.
-- O índice cobre o caminho quente: o vínculo ATIVO de um usuário numa empresa.
CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_empresa_role
  ON app.usuarios_empresas (empresa_id, role)
  WHERE ativo = true;

COMMENT ON COLUMN app.usuarios_empresas.role IS
  'Papel EFETIVO do usuario NESTA empresa (owner|admin|comercial|member). A partir da Etapa 1 do CRM em equipe e esta coluna que autoriza, nao app.usuarios.role (que ficou restrito a superadmin = operador da plataforma).';
COMMENT ON COLUMN app.usuarios_empresas.permissoes IS
  'Concessoes pontuais ADITIVAS por vinculo ({capacidade: true}). NUNCA nega o que o papel permite — negar e trocar o papel. Avaliado por src/services/acesso-capacidades.js.';
