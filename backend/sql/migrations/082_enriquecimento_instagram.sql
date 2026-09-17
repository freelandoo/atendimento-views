-- 082_enriquecimento_instagram.sql
-- Pipeline de enriquecimento POR LEAD (hoje: Instagram) + cache do que foi raspado.
--
-- POR QUE UMA LINHA POR (LEAD, ETAPA) E NAO UMA POR LEAD. Ate' aqui o estado do enriquecimento
-- era o estado do SNAPSHOT — ou seja, de um LOTE. Nao havia como dizer "o lead X falhou ao
-- raspar o perfil e volta a tentar as 14h": ou o lote inteiro deu certo, ou o lote inteiro deu
-- errado. Com uma linha por etapa, cada lead tem retry proprio e a falha de um nunca para os
-- outros — a mesma disciplina de `app.conversao_eventos` (ledger da Meta), de onde vem tambem o
-- lease + backoff usados aqui.
--
-- `pulado` NAO e' `concluido`, e essa diferenca e' o que permite auditar a economia depois:
-- "nao precisei rodar" e "rodei e veio vazio" tem o mesmo efeito na tela e significados opostos
-- na conta de creditos.
--
-- AS DUAS MOEDAS SAO CONTADAS SEPARADAS, de proposito. `custo_creditos` e' Bright Data (dinheiro,
-- conta unica compartilhada por todos os tenants) e `custo_consultas` e' Google CSE (cota diaria,
-- 100/dia no gratuito). Somar as duas numa coluna so' faria o teto de uma travar a outra: sao
-- fornecedores diferentes, com limites diferentes, que se esgotam em ritmos diferentes.
--
-- ADITIVA: nenhuma tabela existente muda de forma, nenhuma linha e' atualizada, e nenhuma coluna
-- nova em `prospects` ganha DEFAULT. Um DEFAULT ali autorizaria em silencio qualquer INSERT
-- futuro que esquecesse a coluna — foi assim que "todo lead de toda empresa nascia marcado como
-- PJ" (migrations 005/006, corrigidas pela 058/078).
--
-- NAO cria variavel de ambiente e NAO toca em `instagram_handle`, `instagram_candidato` nem
-- `instagram_confianca` (migration 080): o veredito de QUEM e' o perfil continua sendo daquelas
-- colunas. Esta migration trata de QUANDO/COMO ele foi buscado e de o que foi visto la' dentro.

CREATE TABLE IF NOT EXISTS prospectador.enriquecimento_etapas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID REFERENCES app.empresas(id),
  prospect_id          UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,
  etapa                TEXT NOT NULL,
  status               TEXT NOT NULL,
  motivo               TEXT,
  tentativas           INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TIMESTAMPTZ,
  lease_ate            TIMESTAMPTZ,
  ultima_execucao_em   TIMESTAMPTZ,
  resultado_json       JSONB,
  custo_creditos       INTEGER NOT NULL DEFAULT 0,
  custo_consultas      INTEGER NOT NULL DEFAULT 0,
  snapshot_id          TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prospectador.enriquecimento_etapas
  DROP CONSTRAINT IF EXISTS enriquecimento_etapas_etapa_chk,
  DROP CONSTRAINT IF EXISTS enriquecimento_etapas_status_chk,
  DROP CONSTRAINT IF EXISTS enriquecimento_etapas_motivo_chk,
  DROP CONSTRAINT IF EXISTS enriquecimento_etapas_custo_chk;

-- Listas FECHADAS. Espelham `src/services/enriquecimento-pipeline.js`, e ha' teste anti-drift
-- que le esta migration e falha se as duas divergirem — o mesmo contrato de `domain-enums`.
ALTER TABLE prospectador.enriquecimento_etapas
  -- SAO DUAS ETAPAS, e nao tres. O plano original previa uma etapa propria de POSTS, com
  -- dataset e custo proprios (~5 creditos por lead). A sonda de 2026-09-17
  -- (`npm run instagram:sonda`, snapshot `sd_mu4s0dte1kezq4wylo`) mostrou que o dataset de
  -- PERFIL ja' devolve `posts_count` e um array `posts` com `datetime` em cada um — a etapa
  -- seria uma segunda chamada paga para buscar o que a primeira ja' trouxe. Custo por rodada de
  -- 200 leads: ~120 creditos em vez de ~720. Criar a etapa assim mesmo seria codigo morto
  -- nascendo pronto.
  ADD CONSTRAINT enriquecimento_etapas_etapa_chk
    CHECK (etapa IN ('instagram_descoberta', 'instagram_perfil')),
  ADD CONSTRAINT enriquecimento_etapas_status_chk
    CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou', 'revisao_humana', 'pulado')),
  -- `motivo` e' vocabulario fechado, nao texto livre: ele vira filtro e rotulo na tela, e texto
  -- livre viraria N grafias da mesma causa (o defeito que `motivo_decisao` do follow-up tem hoje).
  ADD CONSTRAINT enriquecimento_etapas_motivo_chk
    CHECK (motivo IS NULL OR motivo IN (
      'sem_nome',                 -- lead sem nome utilizavel: nao ha' o que procurar
      'ja_confirmado',            -- perfil ja' provado antes; nao se paga de novo
      'cache_recente',            -- raspado ha' pouco tempo (TTL); reprocessar nao repaga nada
      'sem_handle',               -- etapa seguinte precisa de um @ e nao ha' nenhum
      'nenhum_resultado',         -- a busca respondeu, e nao achou perfil deste negocio
      'prova_insuficiente',       -- achou candidato e nao conseguiu provar: vira revisao humana
      'perfil_inexistente',       -- o dataset respondeu que aquele @ nao existe (resposta, nao falha)
      'contrato_desconhecido',    -- a fonte respondeu, mas sem o campo que esta etapa precisa ler
      'cota_esgotada',            -- cota do dia acabou; volta amanha, NUNCA vira "nao tem"
      'orcamento',                -- teto/reserva de creditos barrou a chamada paga
      'fonte_indisponivel',       -- token invalido, dataset desligado, rede fora
      'erro_transitorio',         -- 5xx/429/timeout: volta para a fila com backoff
      'tentativas_esgotadas',     -- teto de tentativas: para de tentar, com motivo
      'decidido_por_pessoa'       -- uma pessoa resolveu a revisao; a etapa fecha por decisao humana
    )),
  ADD CONSTRAINT enriquecimento_etapas_custo_chk
    CHECK (custo_creditos >= 0 AND custo_consultas >= 0);

-- Antiduplicidade no BANCO, nao na aplicacao — mesma disciplina de
-- `follow_ups_um_aberto_por_canal_uk` e da trava de uma coleta paga por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS enriquecimento_etapas_lead_etapa_uk
  ON prospectador.enriquecimento_etapas (prospect_id, etapa);

-- A consulta do worker: o que esta' na hora de rodar. Parcial porque so' esses dois estados sao
-- trabalho pendente — a base inteira nao interessa a ele.
CREATE INDEX IF NOT EXISTS idx_enriquecimento_etapas_fila
  ON prospectador.enriquecimento_etapas (etapa, proxima_tentativa_em)
  WHERE status IN ('pendente', 'processando');

-- A fila de revisao humana, por empresa.
CREATE INDEX IF NOT EXISTS idx_enriquecimento_etapas_revisao
  ON prospectador.enriquecimento_etapas (empresa_id, atualizado_em DESC)
  WHERE status = 'revisao_humana';

-- O contador de cota do dia sai daqui (nao ha' tabela nova para isso): cada execucao gasta
-- exatamente 1 consulta, entao somar `custo_consultas` das etapas executadas hoje responde
-- "quantas queries ja' foram gastas". Depende de `ultima_execucao_em` ser indexada.
CREATE INDEX IF NOT EXISTS idx_enriquecimento_etapas_execucao
  ON prospectador.enriquecimento_etapas (ultima_execucao_em DESC)
  WHERE ultima_execucao_em IS NOT NULL;

COMMENT ON TABLE prospectador.enriquecimento_etapas IS
  'Uma linha por (lead, etapa) do enriquecimento. Retry e custo por etapa; a falha de um lead nunca para os outros.';
COMMENT ON COLUMN prospectador.enriquecimento_etapas.status IS
  'pulado != concluido: "nao precisei rodar" e "rodei e veio vazio" tem significados opostos na conta de creditos.';
COMMENT ON COLUMN prospectador.enriquecimento_etapas.custo_creditos IS
  'Creditos Bright Data (dinheiro). Separado de custo_consultas (cota do Google CSE) de proposito.';
COMMENT ON COLUMN prospectador.enriquecimento_etapas.resultado_json IS
  'Registro CRU da fonte, sem interpretacao. Mesma licao do fonte_bruta do Maps: permite descobrir o nome de um campo depois, sem recoletar.';

-- ── Cache do que foi raspado, no proprio lead ────────────────────────────────────────────────
-- Tabela separada seria indirecao sem ganho: o perfil pertence ao lead, e a unicidade do handle
-- por empresa ja' e' garantida pela rota (409). As datas abaixo sao o que implementa a regra
-- "nao raspar de novo o que foi raspado ha' menos de N dias".
ALTER TABLE prospectador.prospects
  -- Nao ha' `instagram_posts_json`: os posts vem DENTRO do registro de perfil (confirmado pela
  -- sonda), entao `instagram_perfil_json` ja' os guarda. Uma coluna so' para eles duplicaria o
  -- mesmo dado em duas colunas que poderiam divergir.
  ADD COLUMN IF NOT EXISTS instagram_perfil_json    JSONB,
  ADD COLUMN IF NOT EXISTS instagram_perfil_em      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS instagram_atividade      TEXT,
  ADD COLUMN IF NOT EXISTS instagram_ultimo_post_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS instagram_seguidores     INTEGER;

ALTER TABLE prospectador.prospects
  DROP CONSTRAINT IF EXISTS prospects_instagram_atividade_chk;

-- `nao_verificado` e NULL sao estados DIFERENTES, e confundi-los seria o defeito classico deste
-- projeto: NULL = a etapa nunca rodou para este lead; `nao_verificado` = ela rodou e a fonte nao
-- deu como saber. Nenhum dos dois autoriza dizer que o negocio esta' parado.
ALTER TABLE prospectador.prospects
  ADD CONSTRAINT prospects_instagram_atividade_chk
    CHECK (instagram_atividade IS NULL OR instagram_atividade IN (
      'ativo_recente', 'atividade_morna', 'atividade_antiga', 'sem_posts', 'nao_verificado'));

COMMENT ON COLUMN prospectador.prospects.instagram_atividade IS
  'ativo_recente | atividade_morna | atividade_antiga | sem_posts | nao_verificado. NULL = a etapa nunca rodou, que NAO e nao_verificado.';
COMMENT ON COLUMN prospectador.prospects.instagram_perfil_json IS
  'Registro CRU do dataset de perfil. Guardado para poder ler um campo novo depois sem repagar a coleta.';
COMMENT ON COLUMN prospectador.prospects.instagram_ultimo_post_em IS
  'Data do post mais recente que a fonte DECLAROU. Ausencia aqui nunca significa inatividade.';
