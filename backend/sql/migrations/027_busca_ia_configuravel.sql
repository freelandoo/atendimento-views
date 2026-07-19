-- 027_busca_ia_configuravel.sql
-- Torna explícitos os modos da Aquisição (manual, automático fixo e Busca IA)
-- e persiste limites/estado operacional por empresa. Migração somente aditiva.

ALTER TABLE prospectador.prospeccao_configuracoes
  ADD COLUMN IF NOT EXISTS modo_busca TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS busca_max_diaria SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS busca_estrategia TEXT NOT NULL DEFAULT 'equilibrada',
  ADD COLUMN IF NOT EXISTS busca_nichos_permitidos TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS busca_localizacoes_permitidas TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS busca_permitir_nichos_relacionados BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS busca_estado TEXT NOT NULL DEFAULT 'aguardando',
  ADD COLUMN IF NOT EXISTS busca_mensagem TEXT,
  ADD COLUMN IF NOT EXISTS busca_mercado_atual JSONB,
  ADD COLUMN IF NOT EXISTS busca_zero_consecutivos SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS busca_ultima_decisao_em TIMESTAMPTZ;

-- Preserva o comportamento anterior: agendas já ligadas rotacionavam mercado por IA.
UPDATE prospectador.prospeccao_configuracoes
   SET modo_busca = CASE WHEN agendamento_busca_ativo THEN 'ia' ELSE 'manual' END,
       busca_intervalo_horas = GREATEST(busca_intervalo_horas, 6)
 WHERE modo_busca = 'manual';

ALTER TABLE prospectador.prospeccao_configuracoes
  DROP CONSTRAINT IF EXISTS prospeccao_modo_busca_chk,
  DROP CONSTRAINT IF EXISTS prospeccao_busca_max_diaria_chk,
  DROP CONSTRAINT IF EXISTS prospeccao_busca_estrategia_chk,
  DROP CONSTRAINT IF EXISTS prospeccao_busca_estado_chk;

ALTER TABLE prospectador.prospeccao_configuracoes
  ADD CONSTRAINT prospeccao_modo_busca_chk
    CHECK (modo_busca IN ('manual', 'automatico_fixo', 'ia')),
  ADD CONSTRAINT prospeccao_busca_max_diaria_chk
    CHECK (busca_max_diaria BETWEEN 1 AND 2),
  ADD CONSTRAINT prospeccao_busca_estrategia_chk
    CHECK (busca_estrategia IN ('conservadora', 'equilibrada', 'exploratoria')),
  ADD CONSTRAINT prospeccao_busca_estado_chk
    CHECK (busca_estado IN ('aguardando', 'escolhendo', 'coletando', 'processando', 'esgotado', 'sem_mercados', 'limite_diario', 'erro', 'pausado'));

ALTER TABLE prospectador.busca_snapshots
  ADD COLUMN IF NOT EXISTS novos_prospects INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decisao_json JSONB;

