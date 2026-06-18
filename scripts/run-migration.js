#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

// Conexão direta sem usar pool do projeto
const { Pool } = require('pg')

const SQL = `
-- Migration: Tabela para armazenar análises estruturadas da IA
CREATE TABLE IF NOT EXISTS vendas.ai_analise_estruturada (
  id BIGSERIAL PRIMARY KEY,
  numero TEXT NOT NULL,
  mensagem_lead TEXT NOT NULL,
  analise_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decisoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  restricoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resposta_enviada TEXT,
  confianca_analise NUMERIC(3,0) DEFAULT 0,
  confianca_resposta NUMERIC(3,0) DEFAULT 0,
  feedback_score NUMERIC(1,0),
  feedback_motivo TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_analise_estruturada_numero_chk CHECK (numero IS NOT NULL AND length(numero) > 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_analise_numero
  ON vendas.ai_analise_estruturada (numero)
  WHERE criado_em > NOW() - INTERVAL '30 days';

CREATE INDEX IF NOT EXISTS idx_ai_analise_confianca
  ON vendas.ai_analise_estruturada (confianca_resposta DESC)
  WHERE confianca_resposta > 0;

CREATE INDEX IF NOT EXISTS idx_ai_analise_feedback
  ON vendas.ai_analise_estruturada (feedback_score DESC)
  WHERE feedback_score IS NOT NULL;

CREATE TABLE IF NOT EXISTS vendas.ai_padroes_sucesso (
  id BIGSERIAL PRIMARY KEY,
  intencao TEXT NOT NULL,
  estagio TEXT NOT NULL,
  acao_principal TEXT NOT NULL,
  tom_resposta TEXT NOT NULL,
  vezes_usado BIGINT NOT NULL DEFAULT 1,
  vezes_bem_avaliado BIGINT NOT NULL DEFAULT 1,
  taxa_sucesso NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  peso_aprendizado NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_padroes_sucesso_unique
    UNIQUE (intencao, estagio, acao_principal, tom_resposta),
  CONSTRAINT ai_padroes_sucesso_taxa_chk
    CHECK (taxa_sucesso >= 0 AND taxa_sucesso <= 1)
);

CREATE INDEX IF NOT EXISTS idx_ai_padroes_peso
  ON vendas.ai_padroes_sucesso (peso_aprendizado DESC);

CREATE INDEX IF NOT EXISTS idx_ai_padroes_estagio
  ON vendas.ai_padroes_sucesso (estagio);

CREATE TABLE IF NOT EXISTS vendas.ai_guardrail_logs (
  id BIGSERIAL PRIMARY KEY,
  numero TEXT NOT NULL,
  tipo_guardrail TEXT NOT NULL,
  severidade TEXT NOT NULL DEFAULT 'warning',
  detecção JSONB NOT NULL DEFAULT '{}'::jsonb,
  ação_tomada TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_guardrail_logs_tipo_chk CHECK (tipo_guardrail IS NOT NULL AND length(tipo_guardrail) > 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_guardrail_tipo
  ON vendas.ai_guardrail_logs (tipo_guardrail, severidade);

CREATE INDEX IF NOT EXISTS idx_ai_guardrail_numero
  ON vendas.ai_guardrail_logs (numero)
  WHERE criado_em > NOW() - INTERVAL '7 days';

COMMENT ON TABLE vendas.ai_analise_estruturada
  IS 'Análises estruturadas retornadas pelo Claude — para aprendizado e auditoria';

COMMENT ON TABLE vendas.ai_padroes_sucesso
  IS 'Padrões de resposta que funcionaram bem — reforçados pelo sistema de aprendizado';

COMMENT ON TABLE vendas.ai_guardrail_logs
  IS 'Log de guardrails acionados — para monitorar segurança das respostas';

CREATE OR REPLACE FUNCTION atualizar_timestamp_ai_analise()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_analise_atualizar_timestamp
  BEFORE UPDATE ON vendas.ai_analise_estruturada
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_timestamp_ai_analise();
`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Permite conectar via internal Railway ou external URL
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

(async () => {
  const client = await pool.connect()
  try {
    console.log('🚀 Iniciando migration das tabelas de análise estruturada...\n')

    // Executar SQL
    await client.query(SQL)
    console.log('✅ Migration executada com sucesso!\n')

    // Validar tabelas
    console.log('🔍 Validando tabelas criadas...')
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='vendas'
      AND table_name LIKE 'ai_%'
      ORDER BY table_name;
    `)

    console.log('\n📋 Tabelas criadas:')
    result.rows.forEach((row, idx) => {
      console.log(`  ${idx + 1}. ${row.table_name}`)
    })

    if (result.rows.length === 3) {
      console.log('\n✨ PASSO 1 COMPLETO!')
      console.log('✅ As 3 tabelas foram criadas com sucesso')
      console.log('\n👉 Próximo: Passo 2 — Integrar em chamarClaude()')
    } else {
      console.log(`\n⚠️  Aviso: Esperava 3 tabelas, encontrou ${result.rows.length}`)
    }

    process.exit(0)
  } catch (err) {
    console.error('❌ Erro ao executar migration:')
    console.error(err.message)
    if (err.detail) console.error('Detalhe:', err.detail)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
})()
