-- 053_aquisicao_rotinas.sql
-- Aquisição deixa de ser uma CONFIGURAÇÃO ÚNICA por empresa e passa a ser um conjunto
-- de ROTINAS independentes (nicho + cidade + UF), cada uma com sua própria agenda.
--
-- O que esta migration faz:
--   1. cria prospectador.aquisicao_rotinas (a nova entidade);
--   2. liga busca_snapshots à rotina e adiciona os campos de segurança do disparo pago
--      (idempotência, tentativas, quantidade pedida);
--   3. cria a TRAVA de "uma coleta paga em andamento por empresa" como índice único
--      parcial — a garantia vive no banco, não na aplicação;
--   4. converte a configuração fixa atual na PRIMEIRA rotina, PAUSADA (nada dispara
--      cobrança sozinho no deploy — o admin revisa e ativa);
--   5. aposenta o modo 'automatico_fixo' da config antiga (as rotinas assumem esse papel).
--      O modo 'ia' (Busca IA) NÃO é tocado: continua no motor global existente.
--
-- Mutação de dados declarada (itens 3 a 5) — ver os comentários de cada bloco.

CREATE TABLE IF NOT EXISTS prospectador.aquisicao_rotinas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL,
  nicho               TEXT NOT NULL,
  cidade              TEXT NOT NULL,
  uf                  TEXT,
  dias_semana         SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}'::SMALLINT[],
  janela_inicio       TIME NOT NULL DEFAULT '08:00',
  janela_fim          TIME NOT NULL DEFAULT '18:00',
  -- Intervalo mínimo de 6h entre execuções da MESMA rotina (regra de negócio).
  intervalo_horas     SMALLINT NOT NULL DEFAULT 6,
  -- Quantidade desejada por execução: 1..200 (o teto da fonte é 200).
  quantidade          SMALLINT NOT NULL DEFAULT 200,
  ativo               BOOLEAN NOT NULL DEFAULT false,
  -- Estado DURÁVEL. Os estados efêmeros ("aguardando horário", "aguardando intervalo",
  -- "na fila") são derivados na leitura pelo scheduler — não geram escrita no banco.
  estado              TEXT NOT NULL DEFAULT 'aguardando',
  mensagem            TEXT,
  -- Marcado no DISPARO (não na conclusão): uma coleta travada não pode reabrir o
  -- intervalo e gerar cobrança nova.
  ultima_execucao_em  TIMESTAMPTZ,
  ultima_conclusao_em TIMESTAMPTZ,
  total_execucoes     INTEGER NOT NULL DEFAULT 0,
  ultimo_coletados    INTEGER,
  ultimo_novos        INTEGER,
  ultimo_duplicados   INTEGER,
  falhas_consecutivas SMALLINT NOT NULL DEFAULT 0,
  ultimo_erro         TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.aquisicao_rotinas
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_intervalo_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_quantidade_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_estado_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_janela_chk,
  DROP CONSTRAINT IF EXISTS aquisicao_rotinas_uf_chk;

ALTER TABLE prospectador.aquisicao_rotinas
  ADD CONSTRAINT aquisicao_rotinas_intervalo_chk
    CHECK (intervalo_horas BETWEEN 6 AND 168),
  ADD CONSTRAINT aquisicao_rotinas_quantidade_chk
    CHECK (quantidade BETWEEN 1 AND 200),
  ADD CONSTRAINT aquisicao_rotinas_estado_chk
    CHECK (estado IN ('aguardando', 'coletando', 'importando', 'concluida', 'pausada', 'precisa_atencao')),
  ADD CONSTRAINT aquisicao_rotinas_janela_chk
    CHECK (janela_fim > janela_inicio),
  ADD CONSTRAINT aquisicao_rotinas_uf_chk
    CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');

-- Duas rotinas iguais na mesma empresa competiriam pelo mesmo mercado e gastariam
-- coleta paga em duplicidade — o par (nicho, cidade, uf) é único por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS aquisicao_rotinas_mercado_uk
  ON prospectador.aquisicao_rotinas (empresa_id, LOWER(nicho), LOWER(cidade), COALESCE(uf, ''));

-- O scheduler varre as rotinas ativas de todas as empresas a cada tick.
CREATE INDEX IF NOT EXISTS aquisicao_rotinas_ativas_idx
  ON prospectador.aquisicao_rotinas (empresa_id, ultima_execucao_em)
  WHERE ativo = true;

-- ---------------------------------------------------------------------------
-- busca_snapshots: vínculo com a rotina + campos de segurança do disparo pago.
-- ---------------------------------------------------------------------------
ALTER TABLE prospectador.busca_snapshots
  ADD COLUMN IF NOT EXISTS rotina_id             UUID,
  ADD COLUMN IF NOT EXISTS quantidade_solicitada INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS tentativas            SMALLINT NOT NULL DEFAULT 0,
  -- Chave de idempotência: impede que duas requisições simultâneas virem duas
  -- coletas pagas. É gravada ANTES de chamar a Bright Data.
  ADD COLUMN IF NOT EXISTS idempotency_key       TEXT;

-- MUTAÇÃO DE DADOS (necessária para o índice único abaixo): hoje nada impede várias
-- coletas 'pendente'/'processando' na mesma empresa. Mantemos a MAIS RECENTE de cada
-- empresa e expiramos as demais — são registros transitórios de job, não dado de negócio.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY empresa_id ORDER BY created_at DESC, id DESC) AS rn
    FROM prospectador.busca_snapshots
   WHERE status IN ('pendente', 'processando')
     AND empresa_id IS NOT NULL
)
UPDATE prospectador.busca_snapshots s
   SET status = 'falhou',
       erro = COALESCE(s.erro, 'expirado_na_migracao_053'),
       updated_at = NOW()
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn > 1;

-- A TRAVA: no máximo uma coleta paga em voo por empresa. Vale para TODAS as origens
-- (manual, rotina e Busca IA) porque a garantia está no banco, não em cada caminho.
CREATE UNIQUE INDEX IF NOT EXISTS busca_snapshots_uma_ativa_por_empresa_uk
  ON prospectador.busca_snapshots (empresa_id)
  WHERE status IN ('pendente', 'processando') AND empresa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS busca_snapshots_idempotency_uk
  ON prospectador.busca_snapshots (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS busca_snapshots_rotina_idx
  ON prospectador.busca_snapshots (rotina_id, created_at DESC)
  WHERE rotina_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Conversão da configuração atual na PRIMEIRA rotina — sempre PAUSADA.
-- Preserva o que o operador já configurou sem disparar cobrança no primeiro tick
-- depois do deploy. A config antiga NÃO é apagada (a Busca IA ainda vive nela).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'prospectador' AND table_name = 'prospeccao_configuracoes'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO prospectador.aquisicao_rotinas (
    empresa_id, nicho, cidade, uf, dias_semana,
    janela_inicio, janela_fim, intervalo_horas, quantidade,
    ativo, estado, mensagem
  )
  SELECT
    c.empresa_id,
    TRIM(c.categoria_padrao),
    TRIM(c.cidade_padrao),
    -- UF inválida (texto livre, 1 letra, vazio) vira NULL em vez de quebrar o CHECK ou
    -- fazer a empresa perder a rotina. A cidade sozinha continua utilizável.
    CASE WHEN UPPER(TRIM(COALESCE(c.estado_padrao, ''))) ~ '^[A-Z]{2}$'
         THEN UPPER(TRIM(c.estado_padrao)) END,
    COALESCE(NULLIF(c.dias_semana_ativos, '{}'::SMALLINT[]), '{1,2,3,4,5}'::SMALLINT[]),
    -- A rotina exige janela_fim > janela_inicio. Se o par salvo for inconsistente
    -- (invertido, igual ou nulo), AMBOS caem no padrão — nunca um só, que deixaria a
    -- combinação ainda inválida e abortaria a migration no boot.
    CASE WHEN c.horario_fim > c.horario_inicio THEN c.horario_inicio ELSE '08:00'::TIME END,
    CASE WHEN c.horario_fim > c.horario_inicio THEN c.horario_fim   ELSE '18:00'::TIME END,
    LEAST(GREATEST(COALESCE(c.busca_intervalo_horas, 6), 6), 168),
    200,
    false,
    'pausada',
    'Rotina criada a partir da configuração anterior da Aquisição. Revise os dados e ative quando quiser.'
  FROM prospectador.prospeccao_configuracoes c
  WHERE c.empresa_id IS NOT NULL
    AND COALESCE(TRIM(c.categoria_padrao), '') <> ''
    AND COALESCE(TRIM(c.cidade_padrao), '') <> ''
  ON CONFLICT DO NOTHING;

  -- MUTAÇÃO DE DADOS: o mercado fixo agora é responsabilidade das rotinas. Deixar o
  -- motor antigo ligado criaria DOIS agendadores disparando coleta paga para o mesmo
  -- mercado. A Busca IA (modo_busca='ia') fica intacta.
  UPDATE prospectador.prospeccao_configuracoes
     SET modo_busca = 'manual',
         agendamento_busca_ativo = false,
         busca_estado = 'pausado',
         busca_mensagem = 'O mercado fixo virou uma Rotina de Aquisição (pausada). Ative a rotina para retomar a coleta automática.',
         atualizado_em = NOW()
   WHERE modo_busca = 'automatico_fixo';
END $$;
