-- 055_aquisicao_curadoria.sql
-- Assistente de Oportunidades POR LEAD (curadoria da Busca avulsa).
--
-- A Busca avulsa continua funcionando exatamente como antes: ela coleta e IMPORTA os
-- leads para prospectador.prospects (pipeline de coleta INTOCADO por esta migration).
-- O que nasce aqui é a camada de CURADORIA: o operador abre uma sessão, o assistente
-- mostra UMA oportunidade por vez com uma justificativa curta, e cada decisão
-- (aprovar / descartar) fica registrada — tanto para auditoria quanto para o
-- aprendizado que reordena as próximas filas.
--
-- O que esta migration faz:
--   1. cria prospectador.curadoria_sessoes (a sessão, sua meta e sua fila);
--   2. cria prospectador.curadoria_decisoes (o registro de cada decisão + sinais);
--   3. garante, no BANCO, que só existe UMA sessão ativa por operador.
--
-- ADITIVA: nenhuma tabela existente é alterada e nenhum dado é mutado.

-- ---------------------------------------------------------------------------
-- 1. Sessões
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospectador.curadoria_sessoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  -- Quem abriu. A sessão é pessoal: dois operadores da mesma empresa podem curar em
  -- paralelo sem disputar a mesma fila (a corrida por um lead é resolvida no claim).
  usuario_id      UUID,
  -- Mercado da sessão. Vem da Busca avulsa que acabou de rodar; NULL = todos.
  nicho           TEXT,
  cidade          TEXT,
  uf              TEXT,
  -- Ligado quando o operador aceita "ampliar a busca": a fila deixa de se limitar ao
  -- mercado da sessão e passa a considerar o resto da carteira.
  escopo_ampliado BOOLEAN NOT NULL DEFAULT false,
  -- Meta de leads NOVOS aprovados. Não limita quantos candidatos são avaliados.
  meta            SMALLINT NOT NULL,
  aprovados       SMALLINT NOT NULL DEFAULT 0,
  descartados     SMALLINT NOT NULL DEFAULT 0,
  -- Fila já montada e já explicada pela IA. Persistir evita duas coisas: perder o
  -- ritmo ao recarregar a página e pagar de novo pela mesma explicação.
  fila_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'ativa',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encerrado_em    TIMESTAMPTZ
);

ALTER TABLE prospectador.curadoria_sessoes
  DROP CONSTRAINT IF EXISTS curadoria_sessoes_status_chk,
  DROP CONSTRAINT IF EXISTS curadoria_sessoes_meta_chk,
  DROP CONSTRAINT IF EXISTS curadoria_sessoes_uf_chk,
  DROP CONSTRAINT IF EXISTS curadoria_sessoes_contadores_chk;

ALTER TABLE prospectador.curadoria_sessoes
  ADD CONSTRAINT curadoria_sessoes_status_chk
    CHECK (status IN ('ativa', 'concluida', 'encerrada')),
  -- 200 é o teto de leads que uma única coleta importa (MAX_LEADS_POR_BUSCA).
  ADD CONSTRAINT curadoria_sessoes_meta_chk
    CHECK (meta BETWEEN 1 AND 200),
  ADD CONSTRAINT curadoria_sessoes_uf_chk
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT curadoria_sessoes_contadores_chk
    CHECK (aprovados >= 0 AND descartados >= 0);

-- Uma sessão ativa por operador. Sem isto, dois cliques no botão premium abririam duas
-- sessões sobre a mesma fila e a meta seria contada duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS curadoria_sessoes_uma_ativa_uk
  ON prospectador.curadoria_sessoes
     (empresa_id, COALESCE(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ativa';

CREATE INDEX IF NOT EXISTS curadoria_sessoes_historico_idx
  ON prospectador.curadoria_sessoes (empresa_id, criado_em DESC);

-- ---------------------------------------------------------------------------
-- 2. Decisões (auditoria + matéria-prima do aprendizado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospectador.curadoria_decisoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  -- Sessão preservada como histórico: apagar a sessão não apaga o aprendizado.
  sessao_id       UUID REFERENCES prospectador.curadoria_sessoes(id) ON DELETE SET NULL,
  prospect_id     UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  decisao         TEXT NOT NULL,
  -- true só quando a decisão MOVEU um lead que ainda estava aguardando. Repetir a ação
  -- (recarregar, clicar de novo) grava false e não consome a meta.
  contou_meta     BOOLEAN NOT NULL DEFAULT false,
  -- Explicação mostrada ao operador no momento da decisão (o "porquê" auditável).
  justificativa   TEXT,
  -- Retrato do lead no instante da decisão. É daqui que o aprendizado lê — e não do
  -- prospect atual, que pode ter mudado depois. Nunca PII: só faixas e categorias.
  caracteristicas JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id      UUID,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.curadoria_decisoes
  DROP CONSTRAINT IF EXISTS curadoria_decisoes_decisao_chk;

ALTER TABLE prospectador.curadoria_decisoes
  ADD CONSTRAINT curadoria_decisoes_decisao_chk
    CHECK (decisao IN ('aprovado', 'descartado'));

-- Idempotência: o mesmo lead não é decidido duas vezes na mesma sessão. É esta trava
-- que faz "recarregar a página não criar importação duplicada" ser garantia de dados.
CREATE UNIQUE INDEX IF NOT EXISTS curadoria_decisoes_sessao_lead_uk
  ON prospectador.curadoria_decisoes (sessao_id, prospect_id)
  WHERE sessao_id IS NOT NULL;

-- Leitura do aprendizado: as decisões recentes desta empresa.
CREATE INDEX IF NOT EXISTS curadoria_decisoes_aprendizado_idx
  ON prospectador.curadoria_decisoes (empresa_id, criado_em DESC);
