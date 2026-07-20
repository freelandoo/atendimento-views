-- 030_followup_ligacoes.sql
-- Fase 2 da pagina de Follow-ups: log de RESULTADOS das ligacoes do modo Semi.
-- Alimenta metricas (ligacao -> reuniao) e o dedup da call-list (lead ligado ha pouco
-- some da fila). Aditivo/idempotente. Isolado por empresa; casa com o lead por numero.

CREATE TABLE IF NOT EXISTS vendas.followup_ligacoes (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  numero     TEXT NOT NULL,
  resultado  TEXT NOT NULL,   -- atendeu | nao_atendeu | agendou | sem_interesse | ligar_depois
  notas      TEXT,
  usuario_id UUID,            -- quem registrou (soft ref a app.usuarios; sem FK p/ nao acoplar)
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT followup_ligacoes_resultado_chk
    CHECK (resultado IN ('atendeu', 'nao_atendeu', 'agendou', 'sem_interesse', 'ligar_depois'))
);

CREATE INDEX IF NOT EXISTS idx_followup_ligacoes_empresa_criado
  ON vendas.followup_ligacoes (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_followup_ligacoes_numero_criado
  ON vendas.followup_ligacoes (numero, criado_em DESC);
