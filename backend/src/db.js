'use strict'
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const { logger } = require('./logger')
const { runMigrations } = require('./db/migrations')
const ROOT = path.join(__dirname, '..')
const JOB_MAX_ATTEMPTS = Math.min(
  Math.max(parseInt(process.env.JOB_MAX_ATTEMPTS, 10) || 5, 1),
  20
)

// Railway free tier limit: ~8 concurrent connections per user.
// max=4 atende API + workers no processo principal; em multi-replica, ajuste POOL_MAX
// para que a soma dos pools permaneca dentro do limite do banco.
// Timeouts ajustados em 2026-05-28: o anterior 1s causava falha fast sob contencao.
// Todos os valores sao env-overridable para tuning em producao.
const POOL_CONFIG = {
  max: process.env.POOL_MAX ? parseInt(process.env.POOL_MAX, 10) : 4,
  idleTimeoutMillis: process.env.POOL_IDLE_TIMEOUT_MS
    ? parseInt(process.env.POOL_IDLE_TIMEOUT_MS, 10)
    : 10000, // Close idle connections after 10s
  connectionTimeoutMillis: process.env.POOL_CONNECTION_TIMEOUT_MS
    ? parseInt(process.env.POOL_CONNECTION_TIMEOUT_MS, 10)
    : 3000, // Wait up to 3s for available connection
  statement_timeout: 15000, // Cancel queries after 15s
  min: 0, // Don't pre-create connections
  // keepAlive mantem o TCP vivo: evita conexoes meio-abertas que o Postgres/Docker
  // derruba em silencio e depois estouram como erro de protocolo (pg-protocol parse).
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://evolution:evolution@localhost:5432/evolution_api',
  options: `-c timezone=${process.env.APP_TIMEZONE || process.env.TZ || 'America/Sao_Paulo'}`,
  searchPath: ['vendas'],
  ...POOL_CONFIG
})

// Log pool events for debugging connection issues
pool.on('error', (err) => {
  logger.error({ err: serializeError(err) }, '❌ Unexpected error in pool')
})

pool.on('connect', () => {
  logger.debug(`📊 Pool: ${pool.totalCount}/${POOL_CONFIG.max} connections`)
})

// waitingCount revela contencao real entre dashboard, webhooks e workers. O timer
// nao mantem o processo vivo e so gera log quando existe fila por conexao.
const poolMonitor = setInterval(() => {
  if (pool.waitingCount > 0) {
    logger.warn({
      operation: 'db_pool_wait',
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: POOL_CONFIG.max,
    }, '[db] requisicoes aguardando conexao no pool')
  }
}, 30000)
if (poolMonitor.unref) poolMonitor.unref()

async function initProspectadorDB() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  await pool.query(`CREATE SCHEMA IF NOT EXISTS prospectador`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.prospects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome TEXT NOT NULL,
      telefone TEXT,
      nicho TEXT NOT NULL,
      cidade TEXT NOT NULL,
      endereco TEXT,
      avaliacoes INT,
      rating NUMERIC,
      tem_site BOOLEAN NOT NULL DEFAULT false,
      site TEXT,
      maps_url TEXT,
      place_id TEXT NOT NULL UNIQUE,
      origem TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'aguardando',
      score INT,
      motivo_score TEXT,
      raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT prospects_origem_chk CHECK (origem IN ('manual', 'automatico')),
      CONSTRAINT prospects_status_chk CHECK (status IN ('aguardando', 'aprovado', 'rejeitado', 'enviado', 'respondeu'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_status_created
    ON prospectador.prospects (status, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_nicho_cidade
    ON prospectador.prospects (nicho, cidade)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospectador_prospects_updated
    ON prospectador.prospects (updated_at DESC)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.diagnosticos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prospect_id UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
      dor_principal TEXT,
      perda_estimada NUMERIC,
      mensagem_gerada TEXT,
      mensagem_editada TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      aprovado_em TIMESTAMPTZ,
      enviado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospectador_diagnosticos_prospect
    ON prospectador.diagnosticos (prospect_id, created_at DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospectador_diagnosticos_updated
    ON prospectador.diagnosticos (updated_at DESC)
  `)
  await pool.query(`ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS dor_principal TEXT`)
  await pool.query(`ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`)

  // ── Fase 1: esteira inteligente de prospecção ─────────────────────────────
  // Colunas novas em prospects (score por dimensão, oferta, controle de imagem, log de decisão)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS score_v2 INT`)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS score_dimensoes JSONB`)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS oferta_recomendada TEXT`)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS imagem_gerada BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS aprovacao_imagem_em TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE prospectador.prospects ADD COLUMN IF NOT EXISTS decision_log JSONB NOT NULL DEFAULT '[]'::jsonb`)

  // Colunas novas em diagnosticos (diagnóstico estruturado e versionamento de prompt)
  await pool.query(`ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS diagnostico_json JSONB`)
  await pool.query(`ALTER TABLE prospectador.diagnosticos ADD COLUMN IF NOT EXISTS prompt_version TEXT`)
  // ─────────────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.prospect_events (
      id BIGSERIAL PRIMARY KEY,
      prospect_id UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
      tipo_evento TEXT NOT NULL,
      detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect
    ON prospectador.prospect_events (prospect_id, criado_em DESC)
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prospect_events_tipo
    ON prospectador.prospect_events (tipo_evento, criado_em DESC)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.send_attempts (
      id BIGSERIAL PRIMARY KEY,
      prospect_id UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL UNIQUE,
      mensagem_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      tipo_mensagem TEXT NOT NULL DEFAULT 'abordagem_inicial',
      canal TEXT NOT NULL DEFAULT 'whatsapp',
      numero_normalizado TEXT,
      job_id BIGINT,
      tentativas INT NOT NULL DEFAULT 0,
      enviado_em TIMESTAMPTZ,
      erro TEXT,
      evolution_resposta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT send_attempts_status_chk CHECK (status IN ('scheduled', 'processing', 'sent', 'failed'))
    )
  `)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS tipo_mensagem TEXT NOT NULL DEFAULT 'abordagem_inicial'`)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'whatsapp'`)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS numero_normalizado TEXT`)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS job_id BIGINT`)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS tentativas INT NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE prospectador.send_attempts ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ`)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint co
        JOIN pg_class cl ON cl.oid = co.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        WHERE co.conname = 'send_attempts_status_chk'
          AND ns.nspname = 'prospectador'
          AND cl.relname = 'send_attempts'
      ) THEN
        ALTER TABLE prospectador.send_attempts DROP CONSTRAINT send_attempts_status_chk;
      END IF;
      ALTER TABLE prospectador.send_attempts ADD CONSTRAINT send_attempts_status_chk
        CHECK (status IN ('scheduled', 'processing', 'sent', 'failed')) NOT VALID;
    END $$;
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_send_attempts_prospect_created
    ON prospectador.send_attempts (prospect_id, created_at DESC)
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_send_attempts_abordagem_prospect
    ON prospectador.send_attempts (prospect_id, tipo_mensagem, canal)
    WHERE tipo_mensagem = 'abordagem_inicial'
      AND canal = 'whatsapp'
      AND status IN ('scheduled', 'processing', 'sent')
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_send_attempts_abordagem_numero
    ON prospectador.send_attempts (numero_normalizado, tipo_mensagem, canal)
    WHERE numero_normalizado IS NOT NULL
      AND tipo_mensagem = 'abordagem_inicial'
      AND canal = 'whatsapp'
      AND status IN ('scheduled', 'processing', 'sent')
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.contato_politicas (
      telefone TEXT PRIMARY KEY,
      origem_contato TEXT NOT NULL DEFAULT 'places',
      consentimento BOOLEAN NOT NULL DEFAULT false,
      opt_out BOOLEAN NOT NULL DEFAULT false,
      quiet_hours_inicio SMALLINT NOT NULL DEFAULT 20,
      quiet_hours_fim SMALLINT NOT NULL DEFAULT 8,
      limite_diario INT NOT NULL DEFAULT 30,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contato_politicas_optout
    ON prospectador.contato_politicas (opt_out, updated_at DESC)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospectador.nichos_performantes (
      nicho TEXT NOT NULL,
      cidade TEXT NOT NULL,
      total_conversas INT NOT NULL DEFAULT 0,
      total_fechamentos INT NOT NULL DEFAULT 0,
      taxa_conversao NUMERIC NOT NULL DEFAULT 0,
      ultima_atualizacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT nichos_performantes_pk UNIQUE (nicho, cidade)
    )
  `)
  // [LEGADO REMOVIDO 2026-06-09] prospectador.auto_prospeccao_config era a config do
  // sistema SEMANAL antigo (enabled=false, weekly_sent=70/70 — a "cota fantasma"). O
  // sistema atual usa prospectador.prospeccao_configuracoes; nada lê auto_prospeccao_config.
  // Paramos de criar/migrar a tabela aqui. A tabela existente em produção é inofensiva
  // (pode ser dropada manualmente: DROP TABLE prospectador.auto_prospeccao_config;).
}

async function initProspeccaoOrquestracaoDB() {
  const sqlPath = path.join(ROOT, 'sql', 'prospeccao_orquestracao.sql')
  if (!fs.existsSync(sqlPath)) {
    logger.warn('⚠️ sql/prospeccao_orquestracao.sql não encontrado; pulando migração da prospecção diária')
    return
  }
  const sql = fs.readFileSync(sqlPath, 'utf8')
  await pool.query(sql)
  logger.info('✅ Banco inicializado via sql/prospeccao_orquestracao.sql')
}

// ─── BANCO: INIT ──────────────────────────────────────────────────────────────

async function initDB() {
  const sqlPath = path.join(ROOT, 'sql', 'init.sql')
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8')
    await pool.query(sql)
    logger.info('✅ Banco inicializado via sql/init.sql')
  } else {
    // fallback inline mínimo
    await pool.query(`CREATE SCHEMA IF NOT EXISTS vendas`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.conversas (
        id SERIAL PRIMARY KEY, numero TEXT UNIQUE NOT NULL,
        historico JSONB NOT NULL DEFAULT '[]',
        estagio TEXT NOT NULL DEFAULT 'primeiro_contato',
        status TEXT NOT NULL DEFAULT 'ativo',
        agente_pausado BOOLEAN NOT NULL DEFAULT false,
        venda_fechada BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT NOW(), atualizado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.lead_profiles (
        id SERIAL PRIMARY KEY, numero TEXT UNIQUE REFERENCES vendas.conversas(numero),
        negocio TEXT, cidade TEXT, ticket_cliente_final TEXT,
        ja_aparece_google BOOLEAN, concorrentes TEXT[], termometro_dor INT,
        complexidade TEXT, score_dor INT, preco_calculado NUMERIC,
        entrada NUMERIC, parcela NUMERIC, plano_sugerido TEXT,
        pronto_handoff BOOLEAN DEFAULT false,
        temperatura_lead TEXT,
        origem TEXT NOT NULL DEFAULT 'inbound',
        contexto_prospeccao JSONB,
        maturidade_digital JSONB NOT NULL DEFAULT '{}'::jsonb,
        origem_anuncio JSONB,
        intencao_principal TEXT,
        produto_sugerido TEXT,
        eventos_conversa JSONB NOT NULL DEFAULT '{}'::jsonb,
        reuniao_proposta JSONB NOT NULL DEFAULT '{}'::jsonb,
        dor_principal TEXT,
        confusao_site_anuncio_google BOOLEAN NOT NULL DEFAULT false,
        explicacao_teste_gratis_enviada BOOLEAN NOT NULL DEFAULT false,
        expectativa_google_alinhada BOOLEAN NOT NULL DEFAULT false,
        personalizacao_nicho_cidade_enviada BOOLEAN NOT NULL DEFAULT false,
        atualizado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.aprendizado (
        id SERIAL PRIMARY KEY, resumo TEXT NOT NULL, criado_em TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.conhecimento_lacunas (
        id SERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        tema_lacuna TEXT NOT NULL,
        detalhe_lacuna TEXT NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW(),
        resolucao_nota TEXT,
        resolvido_em TIMESTAMP
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.analises_pos_conversa (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
        etapa TEXT NOT NULL DEFAULT 'primeiro_contato',
        status_conversa TEXT,
        resumo_problema TEXT,
        o_que_faltou_para_vender TEXT[] NOT NULL DEFAULT '{}',
        melhorias_para_ia TEXT[] NOT NULL DEFAULT '{}',
        sinais_melhoria_ia TEXT[] NOT NULL DEFAULT '{}',
        acoes_de_preparo TEXT[] NOT NULL DEFAULT '{}',
        confianca_analise TEXT,
        payload_coach JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_criado_em ON vendas.conhecimento_lacunas (criado_em DESC)`
    )
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_tema ON vendas.conhecimento_lacunas (tema_lacuna)`
    )
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_conhecimento_lacunas_abertas ON vendas.conhecimento_lacunas (criado_em DESC) WHERE resolvido_em IS NULL`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_criado_em
      ON vendas.analises_pos_conversa (numero, criado_em DESC)
    `)
    await pool.query(
      `ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'primeiro_contato'`
    )
    await pool.query(`ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS status_conversa TEXT`)
    await pool.query(
      `ALTER TABLE vendas.analises_pos_conversa ADD COLUMN IF NOT EXISTS sinais_melhoria_ia TEXT[] NOT NULL DEFAULT '{}'`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_numero_etapa_criado_em
      ON vendas.analises_pos_conversa (numero, etapa, criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_etapa_criado_em
      ON vendas.analises_pos_conversa (etapa, criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_criado_em
      ON vendas.analises_pos_conversa (criado_em DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analises_pos_conversa_sinais_ia_gin
      ON vendas.analises_pos_conversa USING GIN (sinais_melhoria_ia)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.funil_prompt_versions (
        id BIGSERIAL PRIMARY KEY,
        etapa TEXT NOT NULL,
        version INT NOT NULL,
        prompt TEXT NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT true,
        origem TEXT NOT NULL DEFAULT 'seed',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (etapa, version)
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_funil_prompt_versions_ativo
      ON vendas.funil_prompt_versions (etapa)
      WHERE ativo = true
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_funil_prompt_versions_etapa_criado
      ON vendas.funil_prompt_versions (etapa, criado_em DESC)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.funil_diagnosticos (
        id BIGSERIAL PRIMARY KEY,
        etapa TEXT NOT NULL,
        prompt_version_id BIGINT REFERENCES vendas.funil_prompt_versions(id),
        fonte TEXT NOT NULL,
        total_conversas INT NOT NULL DEFAULT 0,
        resultado_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        avaliacao_prompt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_funil_diagnosticos_etapa_criado
      ON vendas.funil_diagnosticos (etapa, criado_em DESC)
    `)
    await pool.query(`
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
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_overlays_ativo
      ON vendas.prompt_overlays (chave)
      WHERE ativo = true
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prompt_overlays_chave_criado
      ON vendas.prompt_overlays (chave, criado_em DESC)
    `)
    await pool.query(`
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
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prompt_aprendizados_ativo_aprovado
      ON vendas.prompt_aprendizados (criado_em DESC)
      WHERE ativo = true AND aprovado = true
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prompt_aprendizados_criado
      ON vendas.prompt_aprendizados (criado_em DESC)
    `)
    await pool.query(
      `ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS impacto TEXT NOT NULL DEFAULT 'leve'`
    )
    await pool.query(
      `ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS aplicado_como TEXT`
    )
    await pool.query(
      `ALTER TABLE vendas.prompt_aprendizados ADD COLUMN IF NOT EXISTS prompt_alvo TEXT NOT NULL DEFAULT 'system'`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS agente_pausado BOOLEAN NOT NULL DEFAULT false`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_codigo TEXT`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_msg TEXT`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS ultima_falha_resposta_em TIMESTAMP`
    )
    await pool.query(
      `ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS evolution_instance TEXT`
    )
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS temperatura_lead TEXT`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS precificacao_json JSONB`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS precisa_sistema BOOLEAN`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'inbound'`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS contexto_prospeccao JSONB`)
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS apelido TEXT`)
    // Score do lead (0-100) medido pela IA ao longo da conversa + atualizado na análise.
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS score_lead INTEGER`)
    // Sinais qualitativos capturados pela IA (origem clientes, urgência, orçamento,
    // decisor, concorrentes, sinais de compra, objeções, observação) — acumulador.
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS insights_lead JSONB`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado BOOLEAN NOT NULL DEFAULT false`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS motivo_arquivamento TEXT`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ`)
    await pool.query(`ALTER TABLE vendas.conversas ADD COLUMN IF NOT EXISTS operador_assumiu_em TIMESTAMPTZ`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.lead_contextos (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'contexto_manual',
        conteudo TEXT NOT NULL,
        origem TEXT NOT NULL DEFAULT 'operador',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_contextos_numero_criado
      ON vendas.lead_contextos (numero, criado_em DESC)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.audio_processamentos (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        message_key TEXT UNIQUE,
        web_message_info JSONB,
        mimetype TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        erro TEXT,
        transcricao TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processado_em TIMESTAMPTZ,
        CONSTRAINT audio_processamentos_status_chk CHECK (status IN ('pending', 'processed', 'failed'))
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_processamentos_numero_status
      ON vendas.audio_processamentos (numero, status, criado_em DESC)
    `)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_profiles_temperatura_lead_chk') THEN
          ALTER TABLE vendas.lead_profiles ADD CONSTRAINT lead_profiles_temperatura_lead_chk
            CHECK (temperatura_lead IS NULL OR temperatura_lead IN ('quente', 'morno', 'frio'));
        END IF;
      END $$
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.followup_envios (
        id BIGSERIAL PRIMARY KEY,
        numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        modo TEXT NOT NULL,
        instrucao_snippet TEXT,
        mensagem_preview TEXT,
        envio_ok BOOLEAN NOT NULL DEFAULT true,
        erro TEXT,
        resposta_lead_em TIMESTAMPTZ,
        CONSTRAINT followup_envios_modo_chk CHECK (modo IN ('reengajamento', 'fluxo_funil'))
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_criado ON vendas.followup_envios (numero, criado_em DESC)`
    )
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_followup_envios_numero_aberto
      ON vendas.followup_envios (numero)
      WHERE resposta_lead_em IS NULL AND envio_ok = true
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.webhook_messages_processed (
        message_key TEXT PRIMARY KEY,
        numero TEXT NOT NULL,
        processado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_msg_proc_em ON vendas.webhook_messages_processed (processado_em DESC)`
    )
    await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS resumo_memoria_vendas TEXT`)
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS memoria_vendas_versao INT NOT NULL DEFAULT 0`
    )
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS ia_total_projeto_detectado_ultima_resposta NUMERIC`
    )
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS preco_ia_divergente_motor BOOLEAN NOT NULL DEFAULT false`
    )
    // Rastreio de quais campos diagnósticos já foram coletados (e quando).
    // Formato: { "negocio": "2026-04-24T10:30:00Z", "cidade": "2026-04-24T10:31:00Z", ... }
    await pool.query(
      `ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS campos_coletados JSONB NOT NULL DEFAULT '{}'::jsonb`
    )
    logger.info('✅ Banco inicializado (inline)')
  }
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS campos_coletados JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'inbound'`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS contexto_prospeccao JSONB`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS maturidade_digital JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS origem_anuncio JSONB`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ALTER COLUMN origem_anuncio DROP DEFAULT`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ALTER COLUMN origem_anuncio DROP NOT NULL`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS intencao_principal TEXT`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS produto_sugerido TEXT`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS eventos_conversa JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS reuniao_proposta JSONB NOT NULL DEFAULT '{}'::jsonb`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS dor_principal TEXT`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS confusao_site_anuncio_google BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS explicacao_teste_gratis_enviada BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS expectativa_google_alinhada BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE vendas.lead_profiles ADD COLUMN IF NOT EXISTS personalizacao_nicho_cidade_enviada BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.operadores (
      id BIGSERIAL PRIMARY KEY,
      nome TEXT,
      numero TEXT NOT NULL,
      jid TEXT NOT NULL UNIQUE,
      ativo BOOLEAN NOT NULL DEFAULT true,
      recebe_alertas BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_operadores_ativos ON vendas.operadores (ativo, recebe_alertas, atualizado_em DESC)`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.eventos_comerciais (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      tipo TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'sistema',
      detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT eventos_comerciais_tipo_chk CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview')),
      CONSTRAINT eventos_comerciais_origem_chk CHECK (origem IN ('sistema', 'operador'))
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_numero_criado ON vendas.eventos_comerciais (numero, criado_em DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_eventos_comerciais_tipo_criado ON vendas.eventos_comerciais (tipo, criado_em DESC)`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.lead_contextos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'contexto_manual',
      conteudo TEXT NOT NULL,
      origem TEXT NOT NULL DEFAULT 'operador',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lead_contextos_numero_criado
    ON vendas.lead_contextos (numero, criado_em DESC)
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.audio_processamentos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      message_key TEXT UNIQUE,
      web_message_info JSONB,
      mimetype TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      erro TEXT,
      transcricao TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processado_em TIMESTAMPTZ,
      CONSTRAINT audio_processamentos_status_chk CHECK (status IN ('pending', 'processed', 'failed'))
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audio_processamentos_numero_status
    ON vendas.audio_processamentos (numero, status, criado_em DESC)
  `)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'eventos_comerciais_tipo_chk'
      ) THEN
        ALTER TABLE vendas.eventos_comerciais DROP CONSTRAINT eventos_comerciais_tipo_chk;
      END IF;
      ALTER TABLE vendas.eventos_comerciais ADD CONSTRAINT eventos_comerciais_tipo_chk
        CHECK (tipo IN ('pediu_preco', 'recebeu_proposta', 'respondeu_followup', 'recebeu_preview'));
    END $$
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.job_queue (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      dedupe_key TEXT UNIQUE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT ${JOB_MAX_ATTEMPTS},
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      locked_until TIMESTAMPTZ,
      last_error TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT job_queue_status_chk CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      CONSTRAINT job_queue_tipo_chk CHECK (tipo IN ('webhook_resposta', 'followup_auto'))
    )
  `)
  await pool.query(`ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`ALTER TABLE vendas.job_queue ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`
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
        CHECK (tipo IN ('webhook_resposta', 'followup_auto', 'agenda_lembrete_reuniao', 'prospeccao_nichos_sync', 'prospeccao_places_auto', 'prospeccao_completo', 'prospeccao_envio_agendado', 'resumo_agenda_operador')) NOT VALID;
    END $$
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_job_queue_pending ON vendas.job_queue (available_at, id) WHERE status = 'pending'`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.agenda_lembretes (
      id BIGSERIAL PRIMARY KEY,
      evento_id BIGINT NOT NULL REFERENCES vendas.agenda_eventos(id) ON DELETE CASCADE,
      lead_id INTEGER REFERENCES vendas.lead_profiles(id) ON DELETE SET NULL,
      conversa_id INTEGER REFERENCES vendas.conversas(id) ON DELETE SET NULL,
      tipo TEXT NOT NULL DEFAULT '15min',
      enviar_em TIMESTAMPTZ NOT NULL,
      enviado_em TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pendente',
      canal TEXT NOT NULL DEFAULT 'whatsapp',
      mensagem TEXT,
      erro TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT agenda_lembretes_tipo_chk CHECK (tipo IN ('15min', '1h', 'dia', 'agora', 'manual')),
      CONSTRAINT agenda_lembretes_status_chk CHECK (status IN ('pendente', 'enviado', 'falhou', 'cancelado'))
    )
  `)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_lembretes_evento_tipo
    ON vendas.agenda_lembretes (evento_id, tipo)
    WHERE tipo <> 'manual'
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agenda_lembretes_pendentes
    ON vendas.agenda_lembretes (enviar_em, id)
    WHERE status = 'pendente'
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.followup_auto_agendamentos (
      id BIGSERIAL PRIMARY KEY,
      numero TEXT NOT NULL REFERENCES vendas.conversas(numero) ON DELETE CASCADE,
      sequencia INT NOT NULL DEFAULT 1,
      detectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      silencio_min INT NOT NULL,
      agendado_para TIMESTAMPTZ NOT NULL,
      instrucao_ia TEXT,
      motivo_decisao TEXT,
      timing_origem TEXT NOT NULL DEFAULT 'regra',
      job_id BIGINT,
      status TEXT NOT NULL DEFAULT 'agendado',
      executado_em TIMESTAMPTZ,
      cancelado_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT followup_auto_status_chk CHECK (status IN ('agendado', 'executado', 'cancelado', 'falhou')),
      CONSTRAINT followup_auto_timing_origem_chk CHECK (timing_origem IN ('regra', 'claude_override'))
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_followup_auto_numero_status ON vendas.followup_auto_agendamentos (numero, status, agendado_para)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_followup_auto_agendado ON vendas.followup_auto_agendamentos (agendado_para) WHERE status = 'agendado'`
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.llm_chamadas (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT,
      tipo TEXT NOT NULL,
      numero TEXT,
      model TEXT,
      estagio TEXT,
      duration_ms INT,
      http_ok BOOLEAN NOT NULL DEFAULT true,
      http_status INT,
      stop_reason TEXT,
      round_index INT,
      stale_retry BOOLEAN NOT NULL DEFAULT false,
      usage JSONB NOT NULL DEFAULT '{}'::jsonb,
      erro_codigo TEXT,
      erro_msg TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_llm_chamadas_criado_em ON vendas.llm_chamadas (criado_em DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_llm_chamadas_numero_criado ON vendas.llm_chamadas (numero, criado_em DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_llm_chamadas_tipo_criado ON vendas.llm_chamadas (tipo, criado_em DESC)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_llm_chamadas_request_id ON vendas.llm_chamadas (request_id)`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_llm_chamadas_model_criado ON vendas.llm_chamadas (model, criado_em DESC)`
  )
  // Motor de IA
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.ai_settings (
      id              SERIAL PRIMARY KEY,
      provider        TEXT    NOT NULL DEFAULT 'openai',
      model           TEXT    NOT NULL DEFAULT 'gpt-4o-mini',
      temperature     NUMERIC NOT NULL DEFAULT 0.4,
      max_tokens      INTEGER NOT NULL DEFAULT 1200,
      fallback_provider TEXT  NOT NULL DEFAULT 'anthropic',
      fallback_model  TEXT    NOT NULL DEFAULT 'claude-sonnet-4-6',
      fallback_enabled BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    INSERT INTO vendas.ai_settings (provider, model, fallback_provider, fallback_model)
    SELECT 'openai', 'gpt-4o-mini', 'anthropic', 'claude-sonnet-4-6'
    WHERE NOT EXISTS (SELECT 1 FROM vendas.ai_settings)
  `)
  // Colunas operacionais usadas pela página LLM (api-llm.js). Idempotentes —
  // faltavam no schema base; em produção podem já existir (ADD COLUMN IF NOT EXISTS é no-op).
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS openai_api_key TEXT`)
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT`)
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente'`)
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS last_error TEXT`)
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS tested_at TIMESTAMPTZ`)
  // "LLM de geração" (one-shot): provider/model usados SÓ na geração de contexto/estágios/playbook.
  // NULL = usa o mesmo modelo do atendimento. A CHAVE é reaproveitada do ambiente (mesma conta).
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS gen_provider TEXT`)
  await pool.query(`ALTER TABLE vendas.ai_settings ADD COLUMN IF NOT EXISTS gen_model TEXT`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendas.ai_logs (
      id            BIGSERIAL PRIMARY KEY,
      provider      TEXT    NOT NULL,
      model         TEXT    NOT NULL,
      task          TEXT,
      success       BOOLEAN NOT NULL DEFAULT true,
      error_message TEXT,
      latency_ms    INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON vendas.ai_logs (created_at DESC)`
  )
  await initProspectadorDB()
  await initProspeccaoOrquestracaoDB()
  // Migrações versionadas do schema `app` (multiempresa SaaS): empresas,
  // usuários, instâncias WhatsApp, contexto2/playbook e fontes de conhecimento.
  await runMigrations(pool)
}

// ─── Helper para operações com timeout ───────────────────────────────────────

async function withClientTimeout(fn, timeoutMs = 5000) {
  const client = await pool.connect()
  const timeoutId = setTimeout(() => {
    client.release()
  }, timeoutMs + 1000) // Release após timeout + buffer

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Client operation timeout after ${timeoutMs}ms`)), timeoutMs)
    )
    return await Promise.race([fn(client), timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
    try {
      client.release()
    } catch (_) {
      // Already released on timeout
    }
  }
}

module.exports = { pool, initDB, initProspectadorDB, initProspeccaoOrquestracaoDB, withClientTimeout }
