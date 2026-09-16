-- 080_instagram_perfil.sql
-- Perfil de Instagram do lead: QUEM e' o perfil, e com que FORCA isso foi provado.
--
-- Regra de negocio:
--   * `instagram_handle` (ja' existia, migration 012) passa a guardar SO' perfil CONFIRMADO.
--   * o perfil achado e nao provado vive em `instagram_candidato`, separado de proposito —
--     mesmo contrato de `site` vs `link_original` da migration 056: o confirmado numa coluna,
--     o cru/duvidoso noutra. Misturar os dois faria a tela dizer "este e' o Instagram dele"
--     sobre um palpite de busca.
--   * `instagram_confianca` e' TERCEIRO ESTADO de verdade: NULL = ninguem verificou, que NAO e'
--     `nao_encontrado`. Mesmo padrao de `contato_canal_disponibilidade` (migration 066) e de
--     `situacao_site` (056): ausencia de prova nao e' prova de ausencia.
--
-- ADITIVA: nenhuma coluna existente muda de tipo, nenhuma linha e' atualizada, nenhum DEFAULT e'
-- criado. Um DEFAULT aqui autorizaria em silencio qualquer INSERT futuro que esquecesse a coluna
-- — foi assim que "todo lead de toda empresa nascia marcado como PJ" (corrigido pela 058/078).
--
-- NAO cria variavel de ambiente, NAO cria tabela e NAO toca em `prospectador.prospects.site`.

ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS instagram_origem        TEXT,
  ADD COLUMN IF NOT EXISTS instagram_confianca     TEXT,
  ADD COLUMN IF NOT EXISTS instagram_candidato     TEXT,
  ADD COLUMN IF NOT EXISTS instagram_evidencia     JSONB,
  ADD COLUMN IF NOT EXISTS instagram_verificado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS instagram_verificado_por UUID;

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_instagram_origem_chk,
  DROP CONSTRAINT IF EXISTS prospects_instagram_confianca_chk,
  DROP CONSTRAINT IF EXISTS prospects_instagram_confirmado_chk;

ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_instagram_origem_chk
    CHECK (instagram_origem IS NULL
           OR instagram_origem IN ('google_meu_negocio', 'busca', 'operador')),
  ADD CONSTRAINT prospects_instagram_confianca_chk
    CHECK (instagram_confianca IS NULL
           OR instagram_confianca IN ('confirmado', 'candidato', 'nao_encontrado'));

-- A garantia que sustenta o contrato das duas colunas, e ela vive no BANCO, nao na aplicacao:
-- confianca `confirmado` EXIGE handle. Sem isto, um bug de rota poderia marcar um lead como
-- "Instagram confirmado" sem dizer QUAL — e o sinal do ICP passaria a valer sobre nada.
-- `candidato` e `nao_encontrado` nao sao cobrados: o primeiro guarda o palpite em
-- `instagram_candidato`, o segundo e' justamente a ausencia de perfil.
ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_instagram_confirmado_chk
    CHECK (instagram_confianca IS DISTINCT FROM 'confirmado' OR instagram_handle IS NOT NULL);

-- Fila de revisao humana: os candidatos que a busca achou e nao conseguiu provar. Parcial porque
-- e' exatamente esse o recorte que a tela pede — e' trabalho pendente, nao a base inteira.
CREATE INDEX IF NOT EXISTS idx_prospects_instagram_revisar
  ON prospectador.prospects (empresa_id, instagram_verificado_em DESC)
  WHERE instagram_confianca = 'candidato';

COMMENT ON COLUMN prospectador.prospects.instagram_handle IS
  'Perfil de Instagram CONFIRMADO do lead (sem @). Palpite nao provado vai para instagram_candidato.';

COMMENT ON COLUMN prospectador.prospects.instagram_candidato IS
  'Perfil achado por busca e ainda NAO provado. Nunca deve ser tratado como o Instagram do lead.';

COMMENT ON COLUMN prospectador.prospects.instagram_confianca IS
  'confirmado | candidato | nao_encontrado. NULL = ninguem verificou, que NAO e nao_encontrado.';

COMMENT ON COLUMN prospectador.prospects.instagram_evidencia IS
  'Quais sinais bateram e quais nao (telefone, site, nome, cidade). E o que a revisao humana le.';
