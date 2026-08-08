-- 057_meta_conversoes.sql
-- Integração Meta (Conversions API) MULTITENANT, baseada em resultado de reunião.
--
-- PROBLEMA QUE ESTA MIGRATION EXISTE PARA RESOLVER
-- A integração Meta que já roda hoje é global: src/services/meta-capi.js lê
-- META_DATASET_ID/META_CAPI_TOKEN do PROCESSO e meta-attribution.js varre
-- vendas.lead_profiles SEM filtro de empresa_id — ou seja, conversão de qualquer
-- tenant vai para o dataset de um tenant só. Aqui nasce a estrutura que torna
-- credencial, ledger e histórico coisas DA EMPRESA, nunca do processo.
--
-- O QUE ESTA MIGRATION FAZ
--   1. app.agenda_eventos ganha o RESULTADO FINANCEIRO da reunião (valor/moeda).
--      Não cria enum novo: o resultado da reunião continua sendo o `status` que a
--      tabela já tem (concluido / cancelado / nao_compareceu).
--   2. app.meta_integracoes  — credencial + preferências POR EMPRESA (token cifrado).
--   3. app.conversao_eventos — ledger: um fato de negócio, uma linha, por empresa.
--   4. app.conversao_tentativas — uma linha por tentativa de envio (diagnóstico).
--
-- ADITIVA. Não altera nem apaga dado existente: as três tabelas são novas e as três
-- colunas de app.agenda_eventos nascem NULL. Nenhum backfill, nenhum UPDATE.
--
-- ROLLBACK (manual, nesta ordem — nenhuma destas instruções roda no boot):
--   DROP TABLE IF EXISTS app.conversao_tentativas;
--   DROP TABLE IF EXISTS app.conversao_eventos;
--   DROP TABLE IF EXISTS app.meta_integracoes;
--   ALTER TABLE app.agenda_eventos
--     DROP COLUMN IF EXISTS venda_valor,
--     DROP COLUMN IF EXISTS venda_moeda,
--     DROP COLUMN IF EXISTS venda_registrada_em;
--   Efeito de reverter: a integração por empresa some junto com o histórico de envio.
--   Os eventos JÁ ACEITOS pela Meta continuam lá (a Meta não tem estorno) — reverter
--   apaga só o nosso registro deles, e um novo ledger reenviaria os mesmos event_id
--   (a Meta deduplica por event_id, então não gera conversão dobrada).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- 1. Resultado financeiro da reunião (app.agenda_eventos)
-- ---------------------------------------------------------------------------
-- Decisão registrada em docs/ai-decision-log.md: NÃO criamos coluna `resultado`
-- nem módulo de vendas. O `status` que a tabela já tem responde "o que aconteceu
-- com a reunião" e a CHECK dele não muda:
--   status='concluido'                     -> reunião realizada
--   status='concluido' + venda_valor > 0   -> realizada COM VENDA
--   status='cancelado' / 'nao_compareceu'  -> resultado INTERNO, nunca vai à Meta
-- Criar um segundo enum sobre o mesmo fato daria duas verdades para a mesma
-- reunião — é a duplicação que o AGENTS.md proíbe.
ALTER TABLE app.agenda_eventos
  ADD COLUMN IF NOT EXISTS venda_valor         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS venda_moeda         TEXT,
  ADD COLUMN IF NOT EXISTS venda_registrada_em TIMESTAMPTZ;

ALTER TABLE app.agenda_eventos
  DROP CONSTRAINT IF EXISTS agenda_eventos_venda_chk;

-- Venda ou é completa (valor > 0 + moeda + quando foi registrada) ou não existe.
-- Meia-venda gravada no banco viraria evento Purchase sem valor — que a Meta aceita
-- e contabiliza como receita zero, estragando o ROAS do anunciante em silêncio.
ALTER TABLE app.agenda_eventos
  ADD CONSTRAINT agenda_eventos_venda_chk CHECK (
    (venda_valor IS NULL AND venda_moeda IS NULL AND venda_registrada_em IS NULL)
    OR (venda_valor > 0 AND venda_moeda ~ '^[A-Z]{3}$' AND venda_registrada_em IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. Credencial e preferências da Meta, por empresa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.meta_integracoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: uma configuração Meta por empresa nesta fase. Se um dia uma empresa
  -- precisar de vários datasets, este índice é o que muda primeiro.
  empresa_id          UUID NOT NULL UNIQUE REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- Identificadores públicos (NÃO são segredo; podem aparecer na tela e no log).
  dataset_id          TEXT NOT NULL,
  -- Para Click-to-WhatsApp a Meta exige page_id OU whatsapp_business_account_id no
  -- user_data; sem um dos dois o evento é rejeitado (subcode 2804116). A CHECK abaixo
  -- impede salvar uma configuração que nasceria quebrada.
  page_id             TEXT,
  waba_id             TEXT,

  -- Segredo. Cifrado em repouso (AES-256-GCM, src/services/segredos-crypto.js,
  -- prefixo mt1). NUNCA é devolvido por rota nenhuma, nem para superadmin.
  access_token_enc    TEXT NOT NULL,
  -- Últimos 4 caracteres, só para a tela dizer "••••4821". Não reconstrói o token.
  token_hint          TEXT,

  -- Modo teste: os eventos aparecem em "Testar eventos" do Gerenciador e NÃO entram
  -- na otimização das campanhas. É por empresa — antes era o env global
  -- META_CAPI_TEST_CODE, que não deixava um tenant testar sem afetar os outros.
  test_event_code     TEXT,

  -- Estados da tela. "não configurada" não é valor: é a AUSÊNCIA de linha.
  status              TEXT NOT NULL DEFAULT 'em_teste',

  -- Eventos habilitados, independentes entre si (critério de aceite do produto).
  evento_agendada     BOOLEAN NOT NULL DEFAULT false,
  evento_realizada    BOOLEAN NOT NULL DEFAULT false,
  evento_venda        BOOLEAN NOT NULL DEFAULT false,

  -- Resultado do último "Testar conexão". ultimo_erro é mensagem SANITIZADA
  -- (sem token, sem PII) — é o que a tela mostra em "precisa de atenção".
  ultimo_teste_em     TIMESTAMPTZ,
  ultimo_teste_ok     BOOLEAN,
  ultimo_erro         TEXT,

  criado_por          UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.meta_integracoes
  DROP CONSTRAINT IF EXISTS meta_integracoes_status_chk,
  DROP CONSTRAINT IF EXISTS meta_integracoes_destino_chk,
  DROP CONSTRAINT IF EXISTS meta_integracoes_dataset_chk;

ALTER TABLE app.meta_integracoes
  ADD CONSTRAINT meta_integracoes_status_chk
    CHECK (status IN ('em_teste', 'ativa', 'precisa_atencao', 'desativada')),
  -- CTWA exige page_id OU waba_id no user_data (subcode 2804116).
  ADD CONSTRAINT meta_integracoes_destino_chk
    CHECK (COALESCE(page_id, '') <> '' OR COALESCE(waba_id, '') <> ''),
  ADD CONSTRAINT meta_integracoes_dataset_chk
    CHECK (dataset_id ~ '^[0-9]{5,}$');

-- ---------------------------------------------------------------------------
-- 3. Ledger de conversões (um fato de negócio = uma linha)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.conversao_eventos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NOT NULL sem default. É esta coluna que impede o vazamento entre tenants:
  -- não existe evento Meta sem empresa, nem no banco nem no código.
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- Nome INTERNO de negócio. O nome que a Meta recebe (event_name) é resolvido no
  -- envio, a partir do mapeamento em src/services/meta-conversao.js — de propósito:
  -- se a taxonomia da Meta mudar, muda o mapeamento, não o histórico.
  tipo              TEXT NOT NULL,
  event_name        TEXT,

  -- Idempotência pela ENTIDADE DE NEGÓCIO + tipo do evento, NUNCA pelo telefone.
  -- O modelo antigo usava `${numero}:${event_name}`, o que travava o sistema em uma
  -- venda por telefone para sempre. Aqui, duas reuniões do mesmo contato são duas
  -- entidades e portanto duas conversões legítimas.
  event_id          TEXT NOT NULL,
  entidade_tipo     TEXT NOT NULL,
  entidade_id       TEXT NOT NULL,

  -- Chave de junção com a atribuição. Só dígitos. Não é a chave de idempotência.
  telefone_norm     TEXT,

  -- Momento do FATO (a reunião), não do envio. A Meta aceita evento de mensagem com
  -- até 7 dias de atraso e usa este horário para atribuir ao clique certo.
  ocorrido_em       TIMESTAMPTZ NOT NULL,

  valor             NUMERIC(14,2),
  moeda             TEXT,

  status            TEXT NOT NULL DEFAULT 'pendente',
  -- Por que este fato não virou envio (integração desligada, evento desabilitado,
  -- sem atribuição de anúncio...). É o que a tela explica ao operador.
  motivo_ignorado   TEXT,

  -- Correção posterior ao envio: o primeiro envio aceito é o registro externo válido
  -- (a Meta não estorna). A correção fica AUDITADA aqui e não gera reenvio — reenviar
  -- valor corrigido é como se infla ROAS sem ninguém perceber.
  valor_corrigido   NUMERIC(14,2),
  corrigido_em      TIMESTAMPTZ,

  tentativas        SMALLINT NOT NULL DEFAULT 0,
  proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_em        TIMESTAMPTZ,
  -- Erro SANITIZADO da última tentativa (para a tela). Nunca token, nunca PII.
  ultimo_erro       TEXT,

  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.conversao_eventos
  DROP CONSTRAINT IF EXISTS conversao_eventos_tipo_chk,
  DROP CONSTRAINT IF EXISTS conversao_eventos_status_chk,
  DROP CONSTRAINT IF EXISTS conversao_eventos_entidade_chk,
  DROP CONSTRAINT IF EXISTS conversao_eventos_venda_chk;

ALTER TABLE app.conversao_eventos
  ADD CONSTRAINT conversao_eventos_tipo_chk
    CHECK (tipo IN ('reuniao_agendada', 'reuniao_realizada', 'reuniao_realizada_com_venda')),
  ADD CONSTRAINT conversao_eventos_status_chk
    CHECK (status IN ('pendente', 'enviado', 'falhou', 'ignorado', 'corrigido')),
  ADD CONSTRAINT conversao_eventos_entidade_chk
    CHECK (entidade_tipo IN ('agenda_app', 'agenda_vendas')),
  -- Venda SEM valor não vira evento de venda. Esta CHECK é a última linha de defesa
  -- do critério de aceite: a validação também existe na rota e no reconciliador, mas
  -- é aqui que ela deixa de depender de alguém ter lembrado de validar.
  ADD CONSTRAINT conversao_eventos_venda_chk CHECK (
    tipo <> 'reuniao_realizada_com_venda'
    OR (valor > 0 AND moeda ~ '^[A-Z]{3}$')
  );

-- Idempotência real, garantida no BANCO e não na aplicação: registrar o mesmo fato
-- duas vezes (worker concorrente, reprocessamento, dois cliques) devolve conflito e
-- não cria segunda linha. Escopada por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS conversao_eventos_empresa_event_uk
  ON app.conversao_eventos (empresa_id, event_id);

-- Caminho quente do worker: o que está devendo envio, por empresa.
CREATE INDEX IF NOT EXISTS conversao_eventos_fila_idx
  ON app.conversao_eventos (empresa_id, proxima_tentativa_em)
  WHERE status = 'pendente';

-- Caminho quente da tela: histórico recente da empresa.
CREATE INDEX IF NOT EXISTS conversao_eventos_historico_idx
  ON app.conversao_eventos (empresa_id, ocorrido_em DESC);

-- ---------------------------------------------------------------------------
-- 4. Tentativas de envio (diagnóstico)
-- ---------------------------------------------------------------------------
-- Uma linha por tentativa. Guarda o DIAGNÓSTICO estruturado da Meta (código,
-- subcódigo, fbtrace_id) e NUNCA o corpo cru da resposta — a resposta pode ecoar
-- o que foi enviado, e o que foi enviado inclui identificador de pessoa.
CREATE TABLE IF NOT EXISTS app.conversao_tentativas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       UUID NOT NULL REFERENCES app.conversao_eventos(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  numero_tentativa SMALLINT NOT NULL,
  ok              BOOLEAN NOT NULL DEFAULT false,
  http_status     INTEGER,
  erro_codigo     INTEGER,
  erro_subcodigo  INTEGER,
  erro_mensagem   TEXT,
  fbtrace_id      TEXT,
  duracao_ms      INTEGER,
  tentado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversao_tentativas_evento_idx
  ON app.conversao_tentativas (evento_id, tentado_em DESC);
