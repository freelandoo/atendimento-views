-- 089_missao_por_equipe.sql
-- Operacao Comercial — Missao por EQUIPE.
--
-- A 085 nasceu como uma missao ativa por EMPRESA. Depois da camada de Equipes Comerciais (088),
-- isso ficou visualmente insuficiente: cada equipe trabalha um nicho, entao uma missao ativa
-- tambem precisa apontar para a equipe que a executa.
--
-- ADITIVA/COMPATIVEL:
--   * adiciona `equipe_id` nullable para preservar missoes historicas/legadas;
--   * troca a unicidade de "uma ativa por empresa" para:
--       - uma missao ativa GERAL legada por empresa (equipe_id IS NULL);
--       - uma missao ativa por EQUIPE (equipe_id IS NOT NULL).
--
-- A aplicacao passa a exigir `equipe_id` em missoes NOVAS. O nullable existe so para nao quebrar
-- historico e instalacoes que ja tenham uma missao ativa da 085.

ALTER TABLE app.missoes
  ADD COLUMN IF NOT EXISTS equipe_id UUID REFERENCES app.equipes_comerciais(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS missoes_uma_ativa_por_empresa_uk;

-- Compatibilidade com missoes legadas sem equipe: ainda nao permite duas "gerais" ativas.
CREATE UNIQUE INDEX IF NOT EXISTS missoes_uma_ativa_geral_por_empresa_uk
  ON app.missoes (empresa_id)
  WHERE status = 'ativa' AND equipe_id IS NULL;

-- Regra nova: cada equipe tem no maximo uma missao ativa; equipes diferentes podem operar
-- desafios diferentes ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS missoes_uma_ativa_por_equipe_uk
  ON app.missoes (empresa_id, equipe_id)
  WHERE status = 'ativa' AND equipe_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS missoes_empresa_equipe_inicio_idx
  ON app.missoes (empresa_id, equipe_id, inicio DESC);

COMMENT ON COLUMN app.missoes.equipe_id IS
  'Equipe comercial dona da missao. Nullable apenas para missoes legadas publicadas antes da etapa de missoes por equipe; missoes novas exigem equipe_id na aplicacao.';
