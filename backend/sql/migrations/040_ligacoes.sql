-- 040_ligacoes.sql
-- Modulo Prospeccao & Inteligencia Comercial — Fase 3 (Central de Ligacoes / Operacao).
-- Registro RICO de ligacao (outbound). Guarda a versao do roteiro usada (imutavel) +
-- marcadores por etapa (interesse/perda) para inteligencia comercial. NAO mexe em
-- vendas.followup_ligacoes (unificacao e fase futura). Isolado por empresa. Enums
-- (resultado / motivo_perda) travados por src/domain-enums.js + anti-drift.

CREATE TABLE IF NOT EXISTS app.ligacoes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  campanha_id            UUID REFERENCES app.campanhas(id) ON DELETE SET NULL,
  campanha_lead_id       UUID REFERENCES app.campanha_leads(id) ON DELETE SET NULL,
  prospect_id            UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  telefone               TEXT,
  roteiro_versao_id      UUID REFERENCES app.roteiro_versoes(id) ON DELETE SET NULL,  -- versao usada (fixa)
  usuario_id             UUID,
  iniciada_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duracao_seg            INT,
  resultado              TEXT NOT NULL,   -- LIGACAO_RESULTADO (disposicao da chamada)
  etapa_alcancada        TEXT,            -- ROTEIRO_ETAPA_TIPO
  etapa_maior_interesse  TEXT,
  etapa_perda_interesse  TEXT,
  objecao_principal      TEXT,
  motivo_perda           TEXT,            -- MOTIVO_PERDA (nullable)
  notas                  TEXT,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ligacoes_resultado_chk CHECK (resultado IN (
    'atendeu', 'nao_atendeu', 'caixa_postal', 'ocupado', 'numero_invalido', 'reagendou'
  )),
  CONSTRAINT ligacoes_motivo_perda_chk CHECK (motivo_perda IS NULL OR motivo_perda IN (
    'numero_invalido', 'nao_era_decisor', 'sem_disponibilidade', 'sem_prioridade', 'sem_orcamento',
    'ja_tem_fornecedor', 'nao_percebeu_valor', 'sem_perfil', 'pediu_novo_contato', 'sem_interesse'
  ))
);
CREATE INDEX IF NOT EXISTS idx_ligacoes_empresa ON app.ligacoes (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_ligacoes_campanha ON app.ligacoes (campanha_id);
CREATE INDEX IF NOT EXISTS idx_ligacoes_lead ON app.ligacoes (campanha_lead_id);

-- Progressao por etapa DENTRO da ligacao (alimenta "etapas de maior perda/curiosidade").
CREATE TABLE IF NOT EXISTS app.ligacao_etapa_eventos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ligacao_id  UUID NOT NULL REFERENCES app.ligacoes(id) ON DELETE CASCADE,
  empresa_id  UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  etapa       TEXT NOT NULL,   -- ROTEIRO_ETAPA_TIPO
  interesse   TEXT NOT NULL DEFAULT 'neutro',  -- interesse | resistencia | neutro
  atingiu     BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ligacao_etapa_interesse_chk CHECK (interesse IN ('interesse', 'resistencia', 'neutro'))
);
CREATE INDEX IF NOT EXISTS idx_ligacao_etapa_eventos_ligacao ON app.ligacao_etapa_eventos (ligacao_id);
CREATE INDEX IF NOT EXISTS idx_ligacao_etapa_eventos_empresa ON app.ligacao_etapa_eventos (empresa_id, etapa);
