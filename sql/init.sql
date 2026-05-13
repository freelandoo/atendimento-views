CREATE SCHEMA IF NOT EXISTS vendas;

-- Tabela principal de conversas (adiciona status se não existir)
CREATE TABLE IF NOT EXISTS vendas.conversas (
  id            SERIAL PRIMARY KEY,
  numero        TEXT UNIQUE NOT NULL,
  historico     JSONB NOT NULL DEFAULT '[]',
  estagio       TEXT NOT NULL DEFAULT 'primeiro_contato',
  status        TEXT NOT NULL DEFAULT 'ativo',
  venda_fechada BOOLEAN DEFAULT false,
  criado_em     TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Adiciona coluna status se a tabela já existia sem ela
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo';

-- Pausa respostas automáticas do agente (webhook) sem apagar o histórico — ativado pelo dashboard
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS agente_pausado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_codigo TEXT;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_msg TEXT;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_em TIMESTAMP;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS motivo_arquivamento TEXT;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ;

-- Perfil detalhado do lead (separado para não poluir histórico)
CREATE TABLE IF NOT EXISTS vendas.lead_profiles (
  id                   SERIAL PRIMARY KEY,
  numero               TEXT UNIQUE REFERENCES vendas.conversas(numero),
  negocio              TEXT,
  cidade               TEXT,
  ticket_cliente_final TEXT,   -- 'baixo' | 'medio' | 'alto' | 'premium'
  ja_aparece_google    BOOLEAN,
  concorrentes         TEXT[],
  termometro_dor       INT,
  complexidade         TEXT,   -- 'landing' | 'servicos' | 'sistema'
  score_dor            INT,
  preco_calculado      NUMERIC,
  entrada              NUMERIC,
  parcela              NUMERIC,
  plano_sugerido       TEXT,
  pronto_handoff       BOOLEAN DEFAULT false,
  temperatura_lead     TEXT,
  origem               TEXT NOT NULL DEFAULT 'inbound',
  contexto_prospeccao  JSONB,
  maturidade_digital   JSONB NOT NULL DEFAULT '{}'::jsonb,
  origem_anuncio       JSONB,
  intencao_principal   TEXT,
  produto_sugerido     TEXT,
  eventos_conversa     JSONB NOT NULL DEFAULT '{}'::jsonb,
  reuniao_proposta     JSONB NOT NULL DEFAULT '{}'::jsonb,
  dor_principal        TEXT,
  confusao_site_anuncio_google BOOLEAN NOT NULL DEFAULT false,
  explicacao_teste_gratis_enviada BOOLEAN NOT NULL DEFAULT false,
  expectativa_google_alinhada BOOLEAN NOT NULL DEFAULT false,
  personalizacao_nicho_cidade_enviada BOOLEAN NOT NULL DEFAULT false,
  atualizado_em        TIMESTAMP DEFAULT NOW(),
  CONSTRAINT lead_profiles_temperatura_lead_chk CHECK (
    temperatura_lead IS NULL OR temperatura_lead IN ('quente', 'morno', 'frio')
  )
);

-- Aprendizado automático de vendas fechadas
CREATE TABLE IF NOT EXISTS vendas.aprendizado (
  id        SERIAL PRIMARY KEY,
  resumo    TEXT NOT NULL,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Lacunas de conhecimento (temas fora do CONHECIMENTO AUTORIZADO ou sem resposta segura)
CREATE TABLE IF NOT EXISTS vendas.conhecimento_lacunas (
  id              SERIAL PRIMARY KEY,
  numero          TEXT NOT NULL,
  tema_lacuna     TEXT NOT NULL,
  detalhe_lacuna  TEXT NOT NULL,
  criado_em       TIMESTAMP DEFAULT NOW(),
  resolucao_nota  TEXT,
  resolvido_em    TIMESTAMP
);

-- Análises pós-conversa geradas manualmente no dashboard
CREATE TABLE IF NOT EXISTS vendas.analises_pos_conversa (
  id                        BIGSERIAL PRIMARY KEY,
  numero                    TEXT NOT NULL REFERENCES vendas.conversas (numero) ON DELETE CASCADE,
  etapa                     TEXT NOT NULL DEFAULT 'primeiro_contato',
  status_conversa           TEXT,
  resumo_problema           TEXT,
  o_que_faltou_para_vender  TEXT[] NOT NULL DEFAULT '{}',
  melhorias_para_ia         TEXT[] NOT NULL DEFAULT '{}',
  sinais_melhoria_ia        TEXT[] NOT NULL DEFAULT '{}',
  acoes_de_preparo          TEXT[] NOT NULL DEFAULT '{}',
  confianca_analise         TEXT,
  payload_coach             JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'primeiro_contato';
ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS status_conversa TEXT;
ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS sinais_melhoria_ia TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_criado_em ON vendas.conhecimento_lacunas (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_tema ON vendas.conhecimento_lacunas (tema_lacuna);
CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_abertas ON vendas.conhecimento_lacunas (criado_em DESC) WHERE resolvido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_criado_em
  ON vendas.analises_pos_conversa (numero, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_etapa_criado_em
  ON vendas.analises_pos_conversa (numero, etapa, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_etapa_criado_em
  ON vendas.analises_pos_conversa (etapa, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_criado_em
  ON vendas.analises_pos_conversa (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_sinais_ia_gin
  ON vendas.analises_pos_conversa USING GIN (sinais_melhoria_ia);

-- Diagnostico geral por etapa do funil + prompts versionados por etapa
CREATE TABLE IF NOT EXISTS vendas.funil_prompt_versions (
  id          BIGSERIAL PRIMARY KEY,
  etapa       TEXT NOT NULL,
  version     INT NOT NULL,
  prompt      TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  origem      TEXT NOT NULL DEFAULT 'seed',
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (etapa, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_funil_prompt_versions_ativo
  ON vendas.funil_prompt_versions (etapa)
  WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_funil_prompt_versions_etapa_criado
  ON vendas.funil_prompt_versions (etapa, criado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.funil_diagnosticos (
  id                      BIGSERIAL PRIMARY KEY,
  etapa                   TEXT NOT NULL,
  prompt_version_id       BIGINT REFERENCES vendas.funil_prompt_versions(id),
  fonte                   TEXT NOT NULL,
  total_conversas         INT NOT NULL DEFAULT 0,
  resultado_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  avaliacao_prompt_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funil_diagnosticos_etapa_criado
  ON vendas.funil_diagnosticos (etapa, criado_em DESC);

-- Overlays de prompts globais (system, empresa, followup, etc.) com histórico no banco
CREATE TABLE IF NOT EXISTS vendas.prompt_overlays (
  id        BIGSERIAL PRIMARY KEY,
  chave     TEXT NOT NULL,
  version   INT  NOT NULL,
  conteudo  TEXT NOT NULL,
  ativo     BOOLEAN NOT NULL DEFAULT true,
  origem    TEXT NOT NULL DEFAULT 'dashboard',
  autor     TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chave, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_overlays_ativo
  ON vendas.prompt_overlays (chave)
  WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_prompt_overlays_chave_criado
  ON vendas.prompt_overlays (chave, criado_em DESC);

-- Aprendizados consolidados a partir de analises_pos_conversa (auto-melhoria do prompt)
CREATE TABLE IF NOT EXISTS vendas.prompt_aprendizados (
  id              BIGSERIAL PRIMARY KEY,
  etapa           TEXT,
  tipo            TEXT NOT NULL DEFAULT 'correcao',
  regras          TEXT NOT NULL,
  fonte_ids       BIGINT[] DEFAULT '{}',
  total_analises  INT DEFAULT 0,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  aprovado        BOOLEAN NOT NULL DEFAULT false,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_aprendizados_ativo_aprovado
  ON vendas.prompt_aprendizados (criado_em DESC)
  WHERE ativo = true AND aprovado = true;
CREATE INDEX IF NOT EXISTS idx_prompt_aprendizados_criado
  ON vendas.prompt_aprendizados (criado_em DESC);

ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS impacto TEXT NOT NULL DEFAULT 'leve';
ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS aplicado_como TEXT;
ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS prompt_alvo TEXT NOT NULL DEFAULT 'system';

CREATE INDEX IF NOT EXISTS idx_conversas_numero ON vendas.conversas(numero);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_numero ON vendas.lead_profiles(numero);

ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS temperatura_lead TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_profiles_temperatura_lead_chk'
  ) THEN
    ALTER TABLE vendas.lead_profiles ADD CONSTRAINT lead_profiles_temperatura_lead_chk
      CHECK (temperatura_lead IS NULL OR temperatura_lead IN ('quente', 'morno', 'frio'));
  END IF;
END $$;

-- Precificação estendida: valor base V; modelos de entrega 20/50/100% sobre V; valor_ancora_plataforma e tiers de site 20/50/100% sobre a âncora (plataforma_*); upgrades 30/25/35%
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS precificacao_json JSONB;

CREATE TABLE IF NOT EXISTS vendas.followup_envios (
  id                 BIGSERIAL PRIMARY KEY,
  numero             TEXT NOT NULL REFERENCES vendas.conversas (numero) ON DELETE CASCADE,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modo               TEXT NOT NULL,
  instrucao_snippet  TEXT,
  mensagem_preview   TEXT,
  envio_ok           BOOLEAN NOT NULL DEFAULT true,
  erro               TEXT,
  resposta_lead_em   TIMESTAMPTZ,
  CONSTRAINT followup_envios_modo_chk CHECK (modo IN ('reengajamento', 'fluxo_funil'))
);

CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_criado ON vendas.followup_envios (numero, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_aberto
  ON vendas.followup_envios (numero)
  WHERE resposta_lead_em IS NULL AND envio_ok = true;

-- Idempotência de webhook (Evolution pode reenviar o mesmo messages.upsert)
CREATE TABLE IF NOT EXISTS vendas.webhook_messages_processed (
  message_key   TEXT PRIMARY KEY,
  numero        TEXT NOT NULL,
  processado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_msg_proc_em ON vendas.webhook_messages_processed (processado_em DESC);

-- Camada de memória operacional + rastreio de divergência preço IA vs motor (dashboard)
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS resumo_memoria_vendas TEXT;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS memoria_vendas_versao INT NOT NULL DEFAULT 0;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS ia_total_projeto_detectado_ultima_resposta NUMERIC;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS preco_ia_divergente_motor BOOLEAN NOT NULL DEFAULT false;

-- Rastreio de quais campos diagnósticos já foram coletados (e quando)
-- Formato: { "negocio": "2026-04-24T10:30:00Z", "cidade": "...", ... }
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS campos_coletados JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS vendas.dashboard_users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  nome            TEXT,
  role            TEXT NOT NULL DEFAULT 'admin',
  password_hash   TEXT NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  ultimo_login_em TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dashboard_users_role_chk CHECK (role IN ('admin'))
);

CREATE TABLE IF NOT EXISTS vendas.dashboard_sessions (
  id            TEXT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES vendas.dashboard_users(id) ON DELETE CASCADE,
  csrf_token    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  ip            TEXT,
  user_agent    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_uso_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user_active
  ON vendas.dashboard_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS vendas.dashboard_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES vendas.dashboard_users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  method     TEXT,
  path       TEXT,
  ip         TEXT,
  user_agent TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_audit_user_criado
  ON vendas.dashboard_audit_log (user_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.operadores (
  id              BIGSERIAL PRIMARY KEY,
  nome            TEXT,
  numero          TEXT NOT NULL,
  jid             TEXT NOT NULL UNIQUE,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  recebe_alertas  BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operadores_ativos
  ON vendas.operadores (ativo, recebe_alertas, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.eventos_comerciais (
  id         BIGSERIAL PRIMARY KEY,
  numero     TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  origem     TEXT NOT NULL DEFAULT 'sistema',
  detalhe    JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT eventos_comerciais_tipo_chk CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview')),
  CONSTRAINT eventos_comerciais_origem_chk CHECK (origem IN ('sistema', 'operador'))
);

CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_numero_criado
  ON vendas.eventos_comerciais (numero, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_tipo_criado
  ON vendas.eventos_comerciais (tipo, criado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.lead_contextos (
  id         BIGSERIAL PRIMARY KEY,
  numero     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'contexto_manual',
  conteudo   TEXT NOT NULL,
  origem     TEXT NOT NULL DEFAULT 'operador',
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_contextos_numero_criado
  ON vendas.lead_contextos (numero, criado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.audio_processamentos (
  id               BIGSERIAL PRIMARY KEY,
  numero           TEXT NOT NULL,
  message_key      TEXT UNIQUE,
  web_message_info JSONB,
  mimetype         TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INT NOT NULL DEFAULT 0,
  erro             TEXT,
  transcricao      TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em    TIMESTAMPTZ,
  CONSTRAINT audio_processamentos_status_chk CHECK (status IN ('pending', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_audio_processamentos_numero_status
  ON vendas.audio_processamentos (numero, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS vendas.llm_chamadas (
  id            BIGSERIAL PRIMARY KEY,
  request_id    TEXT,
  tipo          TEXT NOT NULL,
  numero        TEXT,
  model         TEXT,
  estagio       TEXT,
  duration_ms   INT,
  http_ok       BOOLEAN NOT NULL DEFAULT true,
  http_status   INT,
  stop_reason   TEXT,
  round_index   INT,
  stale_retry   BOOLEAN NOT NULL DEFAULT false,
  usage         JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro_codigo   TEXT,
  erro_msg      TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_chamadas_criado_em
  ON vendas.llm_chamadas (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_llm_chamadas_numero_criado
  ON vendas.llm_chamadas (numero, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_llm_chamadas_tipo_criado
  ON vendas.llm_chamadas (tipo, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_llm_chamadas_request_id
  ON vendas.llm_chamadas (request_id);
CREATE INDEX IF NOT EXISTS idx_llm_chamadas_model_criado
  ON vendas.llm_chamadas (model, criado_em DESC);

-- Consultas uteis para custo/uso Anthropic (nao gravar prompts, historico nem respostas nesta tabela).
-- 1) Uso por dia/modelo/tipo:
-- SELECT date_trunc('day', criado_em) AS dia, model, tipo, COUNT(*) AS chamadas,
--        SUM(COALESCE((usage->>'input_tokens')::int, 0)) AS input_tokens,
--        SUM(COALESCE((usage->>'output_tokens')::int, 0)) AS output_tokens,
--        SUM(COALESCE((usage->>'cache_creation_input_tokens')::int, 0)) AS cache_creation_input_tokens,
--        SUM(COALESCE((usage->>'cache_read_input_tokens')::int, 0)) AS cache_read_input_tokens
-- FROM vendas.llm_chamadas
-- GROUP BY 1, 2, 3
-- ORDER BY 1 DESC, chamadas DESC;
--
-- 2) Uso por conversa/dia para estimativa externa de custo:
-- SELECT numero, date_trunc('day', criado_em) AS dia, model, COUNT(*) AS chamadas,
--        SUM(COALESCE((usage->>'input_tokens')::int, 0)) AS input_tokens,
--        SUM(COALESCE((usage->>'output_tokens')::int, 0)) AS output_tokens
-- FROM vendas.llm_chamadas
-- WHERE numero IS NOT NULL
-- GROUP BY 1, 2, 3
-- ORDER BY dia DESC, numero;
--
-- 3) Latencia media e p95 por tipo:
-- SELECT tipo, COUNT(*) AS chamadas, AVG(duration_ms) AS media_ms,
--        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
-- FROM vendas.llm_chamadas
-- WHERE duration_ms IS NOT NULL
-- GROUP BY tipo
-- ORDER BY p95_ms DESC;
--
-- 4) Rounds de web search por resposta logica:
-- SELECT request_id, numero, MIN(criado_em) AS inicio, COUNT(*) AS rounds, MAX(round_index) AS max_round
-- FROM vendas.llm_chamadas
-- WHERE tipo = 'funnel_web_search_round'
-- GROUP BY request_id, numero
-- ORDER BY inicio DESC;
--
-- 5) Taxa de stale retry em follow-up/funil:
-- SELECT date_trunc('day', criado_em) AS dia, tipo, COUNT(*) AS chamadas,
--        COUNT(*) FILTER (WHERE stale_retry) AS stale_retries
-- FROM vendas.llm_chamadas
-- WHERE tipo IN ('funnel', 'funnel_web_search_round')
-- GROUP BY 1, 2
-- ORDER BY dia DESC, tipo;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'eventos_comerciais_tipo_chk'
  ) THEN
    ALTER TABLE vendas.eventos_comerciais DROP CONSTRAINT eventos_comerciais_tipo_chk;
  END IF;
  ALTER TABLE vendas.eventos_comerciais ADD CONSTRAINT eventos_comerciais_tipo_chk
    CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview'));
END $$;

CREATE TABLE IF NOT EXISTS vendas.job_queue (
  id            BIGSERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL,
  dedupe_key    TEXT UNIQUE,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at     TIMESTAMPTZ,
  locked_until  TIMESTAMPTZ,
  last_error    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_queue_status_chk CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT job_queue_tipo_chk CHECK (tipo IN (
    'webhook_resposta', 'followup_auto', 'agenda_lembrete_reuniao',
    'prospeccao_nichos_sync', 'prospeccao_places_auto',
    'prospeccao_completo', 'prospeccao_envio_agendado'
  ))
);

ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'job_queue_tipo_chk'
      AND ns.nspname = 'vendas'
      AND cl.relname = 'job_queue'
  ) THEN
    ALTER TABLE vendas.job_queue DROP CONSTRAINT job_queue_tipo_chk;
  END IF;
  ALTER TABLE vendas.job_queue ADD CONSTRAINT job_queue_tipo_chk
    CHECK (tipo IN (
      'webhook_resposta', 'followup_auto', 'agenda_lembrete_reuniao',
      'prospeccao_nichos_sync', 'prospeccao_places_auto',
      'prospeccao_completo', 'prospeccao_envio_agendado'
    )) NOT VALID;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON vendas.job_queue (available_at, id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS vendas.followup_auto_agendamentos (
  id              BIGSERIAL PRIMARY KEY,
  numero          TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
  sequencia       INT  NOT NULL DEFAULT 1,
  detectado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  silencio_min    INT NOT NULL,
  agendado_para   TIMESTAMPTZ NOT NULL,
  instrucao_ia    TEXT,
  motivo_decisao  TEXT,
  timing_origem   TEXT NOT NULL DEFAULT 'regra',
  job_id          BIGINT,
  status          TEXT NOT NULL DEFAULT 'agendado',
  executado_em    TIMESTAMPTZ,
  cancelado_em    TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT followup_auto_status_chk CHECK (status IN ('agendado', 'executado', 'cancelado', 'falhou')),
  CONSTRAINT followup_auto_timing_origem_chk CHECK (timing_origem IN ('regra', 'claude_override'))
);

CREATE INDEX IF NOT EXISTS idx_followup_auto_numero_status
  ON vendas.followup_auto_agendamentos (numero, status, agendado_para);

CREATE INDEX IF NOT EXISTS idx_followup_auto_agendado
  ON vendas.followup_auto_agendamentos (agendado_para)
  WHERE status = 'agendado';
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS apelido TEXT;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS precisa_sistema BOOLEAN;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS contexto_prospeccao JSONB;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS maturidade_digital JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS origem_anuncio JSONB;
ALTER TABLE vendas.lead_profiles ALTER COLUMN origem_anuncio DROP DEFAULT;
ALTER TABLE vendas.lead_profiles ALTER COLUMN origem_anuncio DROP NOT NULL;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS intencao_principal TEXT;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS produto_sugerido TEXT;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS eventos_conversa JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS reuniao_proposta JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS dor_principal TEXT;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS confusao_site_anuncio_google BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS explicacao_teste_gratis_enviada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS expectativa_google_alinhada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS personalizacao_nicho_cidade_enviada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS motivo_arquivamento TEXT;
ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS vendas.agenda_eventos (
  id                  BIGSERIAL PRIMARY KEY,
  usuario_id          BIGINT NOT NULL REFERENCES vendas.dashboard_users(id) ON DELETE CASCADE,
  lead_id             INTEGER REFERENCES vendas.lead_profiles(id) ON DELETE SET NULL,
  conversa_id         INTEGER REFERENCES vendas.conversas(id) ON DELETE SET NULL,
  titulo              TEXT NOT NULL,
  descricao           TEXT,
  tipo                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pendente',
  prioridade          TEXT NOT NULL DEFAULT 'media',
  data_inicio         TIMESTAMPTZ NOT NULL,
  data_fim            TIMESTAMPTZ NOT NULL,
  timezone            TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  recorrente          BOOLEAN NOT NULL DEFAULT false,
  regra_recorrencia   JSONB,
  recorrencia_id      UUID,
  reagendado_de_evento_id BIGINT REFERENCES vendas.agenda_eventos(id) ON DELETE SET NULL,
  reagendado_para_evento_id BIGINT REFERENCES vendas.agenda_eventos(id) ON DELETE SET NULL,
  motivo_reagendamento TEXT,
  nao_compareceu_em   TIMESTAMPTZ,
  marcado_por         BIGINT REFERENCES vendas.dashboard_users(id) ON DELETE SET NULL,
  origem              TEXT NOT NULL DEFAULT 'manual',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em        TIMESTAMPTZ,
  excluido_em         TIMESTAMPTZ,
  CONSTRAINT agenda_eventos_tipo_chk CHECK (tipo IN ('reuniao', 'follow_up', 'retorno', 'tarefa', 'prospeccao', 'disparo', 'pessoal', 'bloqueio', 'outro')),
  CONSTRAINT agenda_eventos_status_chk CHECK (status IN ('pendente', 'concluido', 'atrasado', 'cancelado', 'bloqueado', 'confirmado', 'nao_compareceu', 'reagendamento_pendente')),
  CONSTRAINT agenda_eventos_prioridade_chk CHECK (prioridade IN ('baixa', 'normal', 'media', 'alta', 'urgente')),
  CONSTRAINT agenda_eventos_periodo_chk CHECK (data_fim > data_inicio),
  CONSTRAINT agenda_eventos_timezone_chk CHECK (timezone = 'America/Sao_Paulo')
);

ALTER TABLE vendas.agenda_eventos DROP CONSTRAINT IF EXISTS agenda_eventos_tipo_chk;
ALTER TABLE vendas.agenda_eventos
  ADD CONSTRAINT agenda_eventos_tipo_chk CHECK (tipo IN ('reuniao', 'follow_up', 'retorno', 'tarefa', 'prospeccao', 'disparo', 'pessoal', 'bloqueio', 'outro'));
ALTER TABLE vendas.agenda_eventos DROP CONSTRAINT IF EXISTS agenda_eventos_status_chk;
ALTER TABLE vendas.agenda_eventos
  ADD CONSTRAINT agenda_eventos_status_chk CHECK (status IN ('pendente', 'concluido', 'atrasado', 'cancelado', 'bloqueado', 'confirmado', 'nao_compareceu', 'reagendamento_pendente'));
ALTER TABLE vendas.agenda_eventos DROP CONSTRAINT IF EXISTS agenda_eventos_prioridade_chk;
ALTER TABLE vendas.agenda_eventos
  ADD CONSTRAINT agenda_eventos_prioridade_chk CHECK (prioridade IN ('baixa', 'normal', 'media', 'alta', 'urgente'));
ALTER TABLE vendas.agenda_eventos ADD COLUMN IF NOT EXISTS reagendado_de_evento_id BIGINT REFERENCES vendas.agenda_eventos(id) ON DELETE SET NULL;
ALTER TABLE vendas.agenda_eventos ADD COLUMN IF NOT EXISTS reagendado_para_evento_id BIGINT REFERENCES vendas.agenda_eventos(id) ON DELETE SET NULL;
ALTER TABLE vendas.agenda_eventos ADD COLUMN IF NOT EXISTS motivo_reagendamento TEXT;
ALTER TABLE vendas.agenda_eventos ADD COLUMN IF NOT EXISTS nao_compareceu_em TIMESTAMPTZ;
ALTER TABLE vendas.agenda_eventos ADD COLUMN IF NOT EXISTS marcado_por BIGINT REFERENCES vendas.dashboard_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agenda_eventos_usuario_periodo
  ON vendas.agenda_eventos (usuario_id, data_inicio, data_fim)
  WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_status_periodo
  ON vendas.agenda_eventos (status, data_inicio)
  WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_tipo_periodo
  ON vendas.agenda_eventos (tipo, data_inicio)
  WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_recorrencia
  ON vendas.agenda_eventos (recorrencia_id)
  WHERE recorrencia_id IS NOT NULL AND excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_reuniao_origem_lead_inicio
  ON vendas.agenda_eventos (usuario_id, lead_id, tipo, origem, data_inicio)
  WHERE excluido_em IS NULL AND lead_id IS NOT NULL AND tipo = 'reuniao';
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_reuniao_origem_numero_inicio
  ON vendas.agenda_eventos (usuario_id, (metadata->>'lead_numero'), tipo, origem, data_inicio)
  WHERE excluido_em IS NULL AND metadata->>'lead_numero' IS NOT NULL AND tipo = 'reuniao';
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_reagendado_de
  ON vendas.agenda_eventos (reagendado_de_evento_id)
  WHERE excluido_em IS NULL AND reagendado_de_evento_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendas.agenda_lembretes (
  id          BIGSERIAL PRIMARY KEY,
  evento_id   BIGINT NOT NULL REFERENCES vendas.agenda_eventos(id) ON DELETE CASCADE,
  lead_id     INTEGER REFERENCES vendas.lead_profiles(id) ON DELETE SET NULL,
  conversa_id INTEGER REFERENCES vendas.conversas(id) ON DELETE SET NULL,
  tipo        TEXT NOT NULL DEFAULT '15min',
  enviar_em   TIMESTAMPTZ NOT NULL,
  enviado_em  TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'pendente',
  canal       TEXT NOT NULL DEFAULT 'whatsapp',
  mensagem    TEXT,
  erro        TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_lembretes_tipo_chk CHECK (tipo IN ('15min', '1h', 'manual')),
  CONSTRAINT agenda_lembretes_status_chk CHECK (status IN ('pendente', 'enviado', 'falhou', 'cancelado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_lembretes_evento_tipo
  ON vendas.agenda_lembretes (evento_id, tipo)
  WHERE tipo <> 'manual';
CREATE INDEX IF NOT EXISTS idx_agenda_lembretes_pendentes
  ON vendas.agenda_lembretes (enviar_em, id)
  WHERE status = 'pendente';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS prospectador;

CREATE TABLE IF NOT EXISTS prospectador.prospects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  telefone    TEXT,
  nicho       TEXT NOT NULL,
  cidade      TEXT NOT NULL,
  endereco    TEXT,
  avaliacoes  INT,
  rating      NUMERIC,
  tem_site    BOOLEAN NOT NULL DEFAULT false,
  site        TEXT,
  maps_url    TEXT,
  place_id    TEXT NOT NULL UNIQUE,
  origem      TEXT NOT NULL DEFAULT 'manual',
  status      TEXT NOT NULL DEFAULT 'aguardando',
  score       INT,
  motivo_score TEXT,
  raw_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospects_origem_chk CHECK (origem IN ('manual', 'automatico')),
  CONSTRAINT prospects_status_chk CHECK (status IN ('aguardando', 'aprovado', 'rejeitado', 'enviado', 'respondeu'))
);

CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_status_created
  ON prospectador.prospects (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_nicho_cidade
  ON prospectador.prospects (nicho, cidade);
CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_updated
  ON prospectador.prospects (updated_at DESC);

CREATE TABLE IF NOT EXISTS prospectador.diagnosticos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id       UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  dor_principal     TEXT,
  perda_estimada    NUMERIC,
  mensagem_gerada   TEXT,
  mensagem_editada  TEXT,
  metadata_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  aprovado_em       TIMESTAMPTZ,
  enviado_em        TIMESTAMPTZ,
  agendado_para     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospectador_diagnosticos_prospect
  ON prospectador.diagnosticos (prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospectador_diagnosticos_updated
  ON prospectador.diagnosticos (updated_at DESC);

ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS dor_principal TEXT;
ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS prospectador.prospect_events (
  id          BIGSERIAL PRIMARY KEY,
  prospect_id UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  tipo_evento TEXT NOT NULL,
  detalhe     JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect
  ON prospectador.prospect_events (prospect_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_prospect_events_tipo
  ON prospectador.prospect_events (tipo_evento, criado_em DESC);

CREATE TABLE IF NOT EXISTS prospectador.send_attempts (
  id                BIGSERIAL PRIMARY KEY,
  prospect_id       UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  idempotency_key   TEXT NOT NULL UNIQUE,
  mensagem_hash     TEXT NOT NULL,
  status            TEXT NOT NULL,
  erro              TEXT,
  evolution_resposta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT send_attempts_status_chk CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_send_attempts_prospect_created
  ON prospectador.send_attempts (prospect_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prospectador.contato_politicas (
  telefone           TEXT PRIMARY KEY,
  origem_contato     TEXT NOT NULL DEFAULT 'places',
  consentimento      BOOLEAN NOT NULL DEFAULT false,
  opt_out            BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_inicio SMALLINT NOT NULL DEFAULT 20,
  quiet_hours_fim    SMALLINT NOT NULL DEFAULT 8,
  limite_diario      INT NOT NULL DEFAULT 30,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contato_politicas_optout
  ON prospectador.contato_politicas (opt_out, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'job_queue_tipo_chk'
      AND ns.nspname = 'vendas'
      AND cl.relname = 'job_queue'
  ) THEN
    ALTER TABLE vendas.job_queue DROP CONSTRAINT job_queue_tipo_chk;
  END IF;
  ALTER TABLE vendas.job_queue ADD CONSTRAINT job_queue_tipo_chk
    CHECK (tipo IN (
      'webhook_resposta', 'followup_auto', 'agenda_lembrete_reuniao',
      'prospeccao_nichos_sync', 'prospeccao_places_auto',
      'prospeccao_completo', 'prospeccao_envio_agendado'
    )) NOT VALID;
END $$;

CREATE TABLE IF NOT EXISTS prospectador.nichos_performantes (
  nicho               TEXT NOT NULL,
  cidade              TEXT NOT NULL,
  total_conversas     INT NOT NULL DEFAULT 0,
  total_fechamentos   INT NOT NULL DEFAULT 0,
  taxa_conversao      NUMERIC NOT NULL DEFAULT 0,
  ultima_atualizacao  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nichos_performantes_pk UNIQUE (nicho, cidade)
);

CREATE TABLE IF NOT EXISTS prospectador.auto_prospeccao_config (
  singleton_id BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton_id = true),
  enabled BOOLEAN NOT NULL DEFAULT false,
  modo VARCHAR(20) NOT NULL DEFAULT 'manual',
  weekday SMALLINT NOT NULL DEFAULT 1,
  hour SMALLINT NOT NULL DEFAULT 9,
  minute SMALLINT NOT NULL DEFAULT 0,
  weekly_limit INT NOT NULL DEFAULT 40,
  intervalo_envio_minutos SMALLINT NOT NULL DEFAULT 30,
  categoria TEXT,
  last_enqueued_window_start TIMESTAMPTZ,
  last_enqueued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auto_prospeccao_modo_chk CHECK (modo IN ('manual', 'semi_automatico', 'automatico')),
  CONSTRAINT auto_prospeccao_weekday_chk CHECK (weekday >= 0 AND weekday <= 6),
  CONSTRAINT auto_prospeccao_hour_chk CHECK (hour >= 0 AND hour <= 23),
  CONSTRAINT auto_prospeccao_minute_chk CHECK (minute >= 0 AND minute <= 59),
  CONSTRAINT auto_prospeccao_limit_chk CHECK (weekly_limit >= 1 AND weekly_limit <= 200),
  CONSTRAINT auto_prospeccao_intervalo_envio_chk CHECK (intervalo_envio_minutos BETWEEN 5 AND 1440)
);

ALTER TABLE prospectador.auto_prospeccao_config ADD COLUMN IF NOT EXISTS weekly_limit INT NOT NULL DEFAULT 40;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint co
    JOIN pg_class cl ON cl.oid = co.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE co.conname = 'auto_prospeccao_limit_chk'
      AND ns.nspname = 'prospectador'
      AND cl.relname = 'auto_prospeccao_config'
  ) THEN
    ALTER TABLE prospectador.auto_prospeccao_config DROP CONSTRAINT auto_prospeccao_limit_chk;
  END IF;
  ALTER TABLE prospectador.auto_prospeccao_config ADD CONSTRAINT auto_prospeccao_limit_chk
    CHECK (weekly_limit >= 1 AND weekly_limit <= 200);
END $$;
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS intervalo_envio_minutos SMALLINT NOT NULL DEFAULT 30
    CHECK (intervalo_envio_minutos BETWEEN 5 AND 1440);
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS modo VARCHAR(20) DEFAULT 'manual'
    CHECK (modo IN ('manual', 'semi_automatico', 'automatico'));
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS rodada_diaria BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS last_enqueued_date DATE;
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS weekly_sent INT NOT NULL DEFAULT 0;
ALTER TABLE prospectador.auto_prospeccao_config
  ADD COLUMN IF NOT EXISTS weekly_sent_reset_date DATE;

-- ─── Motor de IA: configuração de provedor ────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendas.ai_settings (
  id              SERIAL PRIMARY KEY,
  provider        TEXT    NOT NULL DEFAULT 'anthropic',
  model           TEXT    NOT NULL DEFAULT 'claude-sonnet-4-6',
  temperature     NUMERIC NOT NULL DEFAULT 0.4,
  max_tokens      INTEGER NOT NULL DEFAULT 1200,
  fallback_provider TEXT  NOT NULL DEFAULT 'openai',
  fallback_model  TEXT    NOT NULL DEFAULT 'gpt-4o-mini',
  fallback_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed da linha singleton se ainda não existir
INSERT INTO vendas.ai_settings (provider, model)
SELECT 'anthropic', 'claude-sonnet-4-6'
WHERE NOT EXISTS (SELECT 1 FROM vendas.ai_settings);

CREATE TABLE IF NOT EXISTS vendas.ai_logs (
  id            BIGSERIAL PRIMARY KEY,
  provider      TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  task          TEXT,
  success       BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_created
  ON vendas.ai_logs (created_at DESC);

-- Seed: correcoes primeiro contato (pendente de aprovacao no dashboard)
INSERT INTO vendas.prompt_aprendizados (etapa, tipo, regras, total_analises, ativo, aprovado, impacto)
SELECT 'primeiro_contato', 'correcao',
  E'CORRECOES PRIMEIRO CONTATO (baseadas em analise de 20 conversas reais):\n1. PROIBIDO follow-up repetitivo: se o lead nao respondeu a mesma pergunta 2x, mude o angulo ou ofereca valor novo (print, dado, comparativo). Nunca reenvie variacao da mesma frase.\n2. DOR ANTES DE PRODUTO: nao mencione planos, valores ou \"site\" antes de mostrar o problema concreto (print de concorrentes ou pesquisa ao vivo).\n3. PROVA VISUAL OBRIGATORIA: todo lead deve receber evidencia concreta (print de ranking, pesquisa no Google, dado de mercado) antes de ouvir solucao. Sem prova = sem avanco.\n4. TRIAGEM RAPIDA (max 2 msgs): se em 2 mensagens o lead nao tem negocio OU revela nao ter empresa, encerre com gentileza. Nao gaste 5+ follow-ups com leads sem qualificacao minima.\n5. PERSONALIZACAO POR SEGMENTO: encanador, manicure, funilaria, esquadrias tem linguagens e dores diferentes. Use vocabulario do setor e cite exemplos especificos do ramo na prova visual.\n6. OBJECAO DE MOMENTO != DESINTERESSE: leads com compromisso temporario (festa, viagem, saude) devem receber data de retorno combinada via agendar_followup_auto. Nao trate como lead perdido.\n7. FECHAMENTO DE LEAD QUENTE: quando o lead pedir Pix/contrato/avancar, NUNCA peca confirmacao extra de timing — confirme o compromisso emocional e siga para e-mail/DocuSign imediatamente.',
  20, true, false, 'leve'
WHERE NOT EXISTS (
  SELECT 1 FROM vendas.prompt_aprendizados
  WHERE etapa = 'primeiro_contato' AND regras LIKE '%CORRECOES PRIMEIRO CONTATO%'
);
