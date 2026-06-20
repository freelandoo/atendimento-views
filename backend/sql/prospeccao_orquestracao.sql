-- =============================================================================
-- Prospeccao: configuracao, execucao diaria e fila controlada.
--
-- Fase segura: nenhuma tabela abaixo dispara envio real, gera mensagem com IA ou
-- agenda job por conta propria. Elas apenas preparam a base para configurar,
-- simular e auditar a esteira diaria descrita em docs/.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS prospectador;

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_configuracoes (
  singleton_id BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton_id = true),
  ativo BOOLEAN NOT NULL DEFAULT false,
  modo TEXT NOT NULL DEFAULT 'manual',
  horario_inicio TIME NOT NULL DEFAULT '08:00',
  horario_fim TIME NOT NULL DEFAULT '17:00',
  intervalo_envio_minutos SMALLINT NOT NULL DEFAULT 15,
  limite_diario SMALLINT NOT NULL DEFAULT 80,
  dias_semana_ativos SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  categoria_padrao TEXT,
  cidade_padrao TEXT,
  estado_padrao TEXT,
  regiao_padrao TEXT,
  gerar_mensagem_ia BOOLEAN NOT NULL DEFAULT false,
  envio_real_habilitado BOOLEAN NOT NULL DEFAULT false,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_config_modo_chk CHECK (modo IN ('manual', 'semi_automatico', 'automatico')),
  CONSTRAINT prospeccao_config_intervalo_chk CHECK (intervalo_envio_minutos BETWEEN 5 AND 1440),
  CONSTRAINT prospeccao_config_limite_chk CHECK (limite_diario BETWEEN 1 AND 200),
  CONSTRAINT prospeccao_config_horario_chk CHECK (horario_fim > horario_inicio),
  CONSTRAINT prospeccao_config_dias_chk CHECK (cardinality(dias_semana_ativos) BETWEEN 1 AND 7),
  CONSTRAINT prospeccao_config_sem_envio_automatico_chk CHECK (
    envio_real_habilitado = false OR gerar_mensagem_ia = true
  )
);

-- Seed da linha singleton APENAS enquanto a tabela está no formato singleton
-- (banco novo, antes da migration 009). Depois da 009 a config passa a ser POR
-- EMPRESA: a constraint única de singleton_id deixa de existir e a linha é semeada
-- por empresa via garantirLinhaConfiguracao. Sem este guard, o INSERT ON CONFLICT
-- (singleton_id) — que roda a CADA boot — quebra com 42P10 e derruba o initDB.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'prospectador.prospeccao_configuracoes'::regclass
       AND contype IN ('p', 'u')
       AND pg_get_constraintdef(oid) ILIKE '%singleton_id%'
  ) THEN
    INSERT INTO prospectador.prospeccao_configuracoes (singleton_id)
    VALUES (true)
    ON CONFLICT (singleton_id) DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_tags (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  descricao TEXT,
  ativa BOOLEAN NOT NULL DEFAULT true,
  prioridade SMALLINT NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_tags_ativas
  ON prospectador.prospeccao_tags (ativa, prioridade DESC, nome);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_regioes (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  estado TEXT,
  cidades TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ativa BOOLEAN NOT NULL DEFAULT true,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_regioes_ativas
  ON prospectador.prospeccao_regioes (ativa, nome);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_execucoes_diarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_execucao DATE NOT NULL,
  modo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planejada',
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_encontrados INT NOT NULL DEFAULT 0,
  total_elegiveis INT NOT NULL DEFAULT 0,
  total_agendados INT NOT NULL DEFAULT 0,
  total_simulados INT NOT NULL DEFAULT 0,
  total_enviados INT NOT NULL DEFAULT 0,
  total_respondidos INT NOT NULL DEFAULT 0,
  total_falhas INT NOT NULL DEFAULT 0,
  iniciado_em TIMESTAMPTZ,
  finalizado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_exec_modo_chk CHECK (modo IN ('manual', 'semi_automatico', 'automatico')),
  CONSTRAINT prospeccao_exec_status_chk CHECK (
    status IN ('planejada', 'buscando_leads', 'montando_fila', 'simulada', 'em_execucao', 'concluida', 'cancelada', 'falhou')
  ),
  CONSTRAINT prospeccao_exec_dia_unique UNIQUE (data_execucao)
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_exec_status_data
  ON prospectador.prospeccao_execucoes_diarias (status, data_execucao DESC);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_fila_diaria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execucao_id UUID NOT NULL REFERENCES prospectador.prospeccao_execucoes_diarias(id) ON DELETE CASCADE,
  prospect_id UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  telefone_normalizado TEXT,
  nome_lead TEXT,
  categoria TEXT,
  cidade TEXT,
  estado TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_agendamento',
  ordem INT NOT NULL,
  slot_envio TIMESTAMPTZ,
  mensagem_gerada TEXT,
  mensagem_editada TEXT,
  job_id BIGINT,
  tentativas INT NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_fila_status_chk CHECK (
    status IN ('aguardando_agendamento', 'agendado', 'simulado', 'enviando', 'enviado', 'respondido', 'cancelado', 'falhou')
  ),
  CONSTRAINT prospeccao_fila_slot_chk CHECK (
    (status IN ('agendado', 'simulado', 'enviando', 'enviado') AND slot_envio IS NOT NULL)
    OR status IN ('aguardando_agendamento', 'respondido', 'cancelado', 'falhou')
  ),
  CONSTRAINT prospeccao_fila_exec_ordem_unique UNIQUE (execucao_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_fila_exec_status
  ON prospectador.prospeccao_fila_diaria (execucao_id, status, ordem);
CREATE INDEX IF NOT EXISTS idx_prospeccao_fila_slot_status
  ON prospectador.prospeccao_fila_diaria (slot_envio, status)
  WHERE slot_envio IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_prospeccao_fila_ativa_telefone
  ON prospectador.prospeccao_fila_diaria (telefone_normalizado)
  WHERE telefone_normalizado IS NOT NULL
    AND status IN ('aguardando_agendamento', 'agendado', 'simulado', 'enviando', 'enviado');

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_decisoes_ia (
  id BIGSERIAL PRIMARY KEY,
  execucao_id UUID REFERENCES prospectador.prospeccao_execucoes_diarias(id) ON DELETE CASCADE,
  fila_id UUID REFERENCES prospectador.prospeccao_fila_diaria(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  aprovado BOOLEAN,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_decisoes_tipo_chk CHECK (
    tipo IN ('categoria', 'regiao', 'score', 'mensagem', 'elegibilidade')
  )
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_decisoes_exec_tipo
  ON prospectador.prospeccao_decisoes_ia (execucao_id, tipo, criado_em DESC);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_metricas_diarias (
  data_referencia DATE PRIMARY KEY,
  encontrados INT NOT NULL DEFAULT 0,
  elegiveis INT NOT NULL DEFAULT 0,
  agendados INT NOT NULL DEFAULT 0,
  simulados INT NOT NULL DEFAULT 0,
  enviados INT NOT NULL DEFAULT 0,
  respondidos INT NOT NULL DEFAULT 0,
  falhas INT NOT NULL DEFAULT 0,
  bloqueados INT NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_relatorios_diarios (
  data_referencia DATE PRIMARY KEY,
  execucao_id UUID REFERENCES prospectador.prospeccao_execucoes_diarias(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'gerado',
  relatorio_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  texto_relatorio TEXT NOT NULL,
  enviado_operadores_em TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_relatorios_status_chk CHECK (status IN ('gerado', 'enviado', 'falhou_envio'))
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_relatorios_status_data
  ON prospectador.prospeccao_relatorios_diarios (status, data_referencia DESC);

CREATE TABLE IF NOT EXISTS prospectador.prospeccao_bloqueios (
  id BIGSERIAL PRIMARY KEY,
  telefone_normalizado TEXT,
  prospect_id UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  motivo TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual',
  ativo BOOLEAN NOT NULL DEFAULT true,
  expira_em TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_bloqueios_motivo_chk CHECK (
    motivo IN ('opt_out', 'cliente_fechado', 'conversa_ativa', 'prospectado_recentemente', 'telefone_invalido', 'duplicado', 'lead_respondeu', 'manual', 'outro')
  )
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'prospeccao_bloqueios_motivo_chk'
      AND ns.nspname = 'prospectador'
      AND cl.relname = 'prospeccao_bloqueios'
  ) THEN
    ALTER TABLE prospectador.prospeccao_bloqueios DROP CONSTRAINT prospeccao_bloqueios_motivo_chk;
  END IF;
  ALTER TABLE prospectador.prospeccao_bloqueios
    ADD CONSTRAINT prospeccao_bloqueios_motivo_chk CHECK (
      motivo IN ('opt_out', 'cliente_fechado', 'conversa_ativa', 'prospectado_recentemente', 'telefone_invalido', 'duplicado', 'lead_respondeu', 'manual', 'outro')
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_prospeccao_bloqueios_telefone_ativo
  ON prospectador.prospeccao_bloqueios (telefone_normalizado, ativo)
  WHERE telefone_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospeccao_bloqueios_prospect_ativo
  ON prospectador.prospeccao_bloqueios (prospect_id, ativo)
  WHERE prospect_id IS NOT NULL;
