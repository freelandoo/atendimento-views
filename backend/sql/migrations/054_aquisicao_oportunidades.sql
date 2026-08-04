-- 054_aquisicao_oportunidades.sql
-- Assistente de Oportunidades da Aquisição.
--
-- A "Busca IA" escolhia um mercado sozinha e DISPARAVA coleta paga (Bright Data) sem
-- humano no meio. Ela passa a ser um assistente que SUGERE e EXPLICA; quem cria, edita,
-- ativa ou pausa qualquer rotina é sempre o administrador.
--
-- O que esta migration faz:
--   1. cria prospectador.aquisicao_sugestoes (sugestão + evidências + decisão do admin);
--   2. garante, no BANCO, que a mesma sugestão pendente não se duplica;
--   3. desliga o motor autônomo da Busca IA que ficou sem código
--      (mutação de dados declarada no bloco 3).

CREATE TABLE IF NOT EXISTS prospectador.aquisicao_sugestoes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL,
  tipo                 TEXT NOT NULL,
  -- Alvo quando a sugestão age sobre uma rotina existente. Removida a rotina, suas
  -- sugestões perdem sentido — vão junto.
  rotina_id            UUID REFERENCES prospectador.aquisicao_rotinas(id) ON DELETE CASCADE,
  -- Alvo quando a sugestão propõe um mercado (criar rotina / variar mercado).
  nicho                TEXT,
  cidade               TEXT,
  uf                   TEXT,
  -- Proposta de parâmetros (quantidade, intervalo_horas, dias_semana, janela). É só uma
  -- PROPOSTA: a criação/edição real passa pela validação normal das rotinas.
  parametros           JSONB NOT NULL DEFAULT '{}'::jsonb,
  titulo               TEXT NOT NULL,
  motivo               TEXT NOT NULL,
  impacto              TEXT,
  -- Números que sustentam a sugestão (agregados desta empresa). Nunca PII.
  evidencias           JSONB NOT NULL DEFAULT '{}'::jsonb,
  confianca            SMALLINT NOT NULL DEFAULT 0,
  prioridade           SMALLINT NOT NULL DEFAULT 0,
  -- Hash do CONTEXTO MATERIAL (tipo + alvo + faixa das evidências). É ele que faz
  -- "sugestão dispensada não volta sem motivo novo" ser garantia de dados, não de prompt:
  -- enquanto a evidência não mudar de faixa, a assinatura é a mesma e o candidato é
  -- filtrado na geração.
  assinatura           TEXT NOT NULL,
  -- Quem redigiu o texto: 'ia' (sintetizou/explicou) ou 'regra' (fallback determinístico
  -- quando a IA falhou). O QUE sugerir é sempre determinístico.
  origem_texto         TEXT NOT NULL DEFAULT 'regra',
  status               TEXT NOT NULL DEFAULT 'pendente',
  decidido_por         UUID,
  decidido_em          TIMESTAMPTZ,
  decisao_nota         TEXT,
  -- Rotina efetivamente criada/alterada quando o admin aprovou (rastro da decisão).
  rotina_resultante_id UUID,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.aquisicao_sugestoes
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_tipo_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_status_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_confianca_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_origem_texto_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_uf_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_sugestoes_alvo_chk;

ALTER TABLE prospectador.aquisicao_sugestoes
  ADD CONSTRAINT aquisicao_sugestoes_tipo_chk
    CHECK (tipo IN ('criar_rotina', 'pausar_rotina', 'revisar_rotina', 'ajustar_rotina')),
  ADD CONSTRAINT aquisicao_sugestoes_status_chk
    CHECK (status IN ('pendente', 'aprovada', 'dispensada')),
  ADD CONSTRAINT aquisicao_sugestoes_confianca_chk
    CHECK (confianca BETWEEN 0 AND 100),
  ADD CONSTRAINT aquisicao_sugestoes_origem_texto_chk
    CHECK (origem_texto IN ('ia', 'regra')),
  ADD CONSTRAINT aquisicao_sugestoes_uf_chk
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  -- Toda sugestão precisa de um alvo: uma rotina existente OU um mercado proposto.
  -- Sem isto, uma linha malformada viraria um botão "Aprovar" que não sabe o que fazer.
  ADD CONSTRAINT aquisicao_sugestoes_alvo_chk
    CHECK (rotina_id IS NOT NULL OR (COALESCE(nicho, '') <> '' AND COALESCE(cidade, '') <> ''));

-- Duas análises seguidas não podem empilhar a mesma sugestão pendente.
CREATE UNIQUE INDEX IF NOT EXISTS aquisicao_sugestoes_pendente_uk
  ON prospectador.aquisicao_sugestoes (empresa_id, assinatura)
  WHERE status = 'pendente';

-- Listagem do painel (pendentes por prioridade) e histórico de decisões.
CREATE INDEX IF NOT EXISTS aquisicao_sugestoes_painel_idx
  ON prospectador.aquisicao_sugestoes (empresa_id, status, prioridade DESC, criado_em DESC);

-- Filtro da geração: "esta assinatura já foi decidida por aqui?".
CREATE INDEX IF NOT EXISTS aquisicao_sugestoes_assinatura_idx
  ON prospectador.aquisicao_sugestoes (empresa_id, assinatura, status);

-- ---------------------------------------------------------------------------
-- MUTAÇÃO DE DADOS: aposentadoria do motor autônomo da Busca IA.
--
-- O código que disparava coleta paga a partir da escolha da IA
-- (verificarAgendaBuscaRecorrenteProspeccao) foi REMOVIDO nesta entrega. Deixar
-- `modo_busca='ia'` gravado mostraria "Busca IA ativa" num painel cujo motor não existe
-- mais — estado mentiroso. As PREFERÊNCIAS (estratégia, nichos e regiões permitidos)
-- são preservadas: agora elas alimentam o Assistente de Oportunidades.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_configuracoes'
  ) THEN
    RETURN;
  END IF;

  UPDATE prospectador.prospeccao_configuracoes
     SET modo_busca = 'manual',
         agendamento_busca_ativo = false,
         busca_estado = 'pausado',
         busca_mensagem = 'A busca automática por IA foi substituída pelo Assistente de Oportunidades: '
                          || 'agora a IA sugere mercados e ajustes, e você aprova antes de qualquer coleta.',
         atualizado_em = NOW()
   WHERE modo_busca = 'ia' OR agendamento_busca_ativo = true;
END $$;
