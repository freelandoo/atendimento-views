-- 111_meta_pessoal.sql
-- META PESSOAL do comercial (dia/semana), no topo do Banco de Leads.
--
-- O QUE ESTA MIGRATION RESOLVE
-- O comercial nao tinha onde declarar quanto pretende atender. O progresso ele ja tem: os cards
-- movidos para "Feito" no Quadro do Dia (migration 095). Faltava so o ALVO. Esta tabela guarda
-- a meta SEMANAL e os dias da semana em que a pessoa atende; a divisao por dia e' calculada,
-- nao persistida (services/meta-pessoal.js), e o "feito hoje/na semana" e' contado sobre
-- `plano_dia_itens` — esta migration NAO cria contagem nova.
--
-- POR QUE UMA TABELA E NAO UM JSONB EM `app.usuarios_empresas`
-- Mesma escolha do Quadro do Dia: a config e' PESSOAL e por empresa (a mesma pessoa pode ter
-- metas diferentes em operacoes diferentes), e uma linha propria com CHECK e' mais honesta que
-- um blob sem forma. UMA linha por (empresa, usuario) — a meta e' a atual, nao um historico;
-- se um dia quisermos historico semanal, e' uma tabela de fatos separada, nao esta.
--
-- ADITIVA. Cria UMA tabela; nao altera tabela existente, nao apaga e nao muta nenhum dado.
-- Rollback: DROP TABLE app.meta_pessoal.
--
-- IDENTIDADE: empresa + usuario. `usuario_id` sem FK, pelo mesmo motivo de `plano_dia_itens`:
-- nao acoplar o ciclo de vida da meta ao da conta.

CREATE TABLE IF NOT EXISTS app.meta_pessoal (
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id    UUID NOT NULL,

  -- Meta de atendimentos na SEMANA. > 0 (uma meta de zero nao e' meta).
  alvo_semanal  INTEGER NOT NULL,

  -- Dias em que a pessoa atende, no padrao ISO (1=segunda .. 7=domingo). Pelo menos um.
  -- E' com este numero de dias que services/meta-pessoal.js divide o alvo semanal por dia.
  dias_semana   INTEGER[] NOT NULL,

  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (empresa_id, usuario_id),
  CONSTRAINT meta_pessoal_alvo_chk CHECK (alvo_semanal > 0),
  CONSTRAINT meta_pessoal_dias_chk CHECK (
    array_length(dias_semana, 1) BETWEEN 1 AND 7
    AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]
  )
);
