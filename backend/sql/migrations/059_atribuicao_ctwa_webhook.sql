-- 059_atribuicao_ctwa_webhook.sql
-- Atribuição Click-to-WhatsApp capturada NO WEBHOOK, escopada por EMPRESA + INSTÂNCIA.
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
-- A atribuição CTWA nunca funcionou. Medido em produção em 2026-08-08, três causas
-- empilhadas, todas na estratégia de MINERAR o banco do Evolution:
--   1. o código procurava `public."Message"`; a tabela é `evolution."Message"` (mesmo
--      banco, outro schema) — `to_regclass` devolvia null e a rotina era um NO-OP
--      silencioso a cada tick do worker;
--   2. o SQL lia o telefone de `key->>'remoteJidAlt'`, campo inexistente nesta versão;
--   3. das 526 mensagens com `externalAdReply`, 100% têm `remoteJid` `@lid`, sem
--      tradução para telefone em `Contact`/`Chat` (251 telefones de anúncio, ZERO
--      casando com `vendas.conversas`).
-- A captura passa para o WEBHOOK, único ponto onde telefone real, empresa resolvida
-- pela instância e instância de origem coexistem.
--
-- POR QUE TABELA NOVA E NÃO MAIS UMA COLUNA EM vendas.lead_profiles
-- `lead_profiles` é chaveada por telefone GLOBAL (`UNIQUE (numero)`): um telefone, uma
-- linha em todo o sistema. Atribuição de anúncio é um FATO DE UMA INSTÂNCIA — o mesmo
-- número pode falar com dois negócios, e cada instância é um negócio separado. Guardar
-- a atribuição lá obrigaria a escolher qual anúncio "vence", que é precisamente o tipo
-- de mistura entre tenants que esta tarefa existe para impedir.
--
-- ESCOPO E CONFIANÇA
--   `empresa_id` + `instancia_id` são NOT NULL. Não existe linha aqui sem dono provado:
--   quando a empresa vem do fallback da PJ, ou a instância não está mapeada, o webhook
--   NÃO grava (registra o motivo em log, sem PII). Preferimos ausência a dado sujo.
--   `atribuicao_confiavel` distingue a linha utilizável pela Meta da linha que existe só
--   para auditoria (hoje: anúncio sem `ctwa_clid`, que a Conversions API não aceita).
--
-- DADO PESSOAL
--   `telefone_norm` — só dígitos, necessário para casar a reunião com o clique.
--   `ctwa_clid`     — identificador do clique. É o que a Meta exige no envio, então
--                     precisa ser persistido em claro (mesma escolha do sistema legado
--                     em vendas.lead_profiles.origem_anuncio). NENHUMA ROTA O DEVOLVE:
--                     a API expõe `ctwa_clid_hint` (4 últimos), como o `token_hint` da
--                     credencial da Meta. Payload cru do webhook NÃO é guardado.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS app.atribuicao_anuncios;
--   DELETE FROM app.schema_migrations WHERE nome = '059_atribuicao_ctwa_webhook.sql';
--   Aditiva: nenhuma tabela existente é alterada e nenhum dado é mutado.

CREATE TABLE IF NOT EXISTS app.atribuicao_anuncios (
  id                   BIGSERIAL PRIMARY KEY,

  -- Dono provado do fato. Sem estes dois não existe linha.
  empresa_id           UUID        NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  instancia_id         UUID        NOT NULL REFERENCES app.empresa_whatsapp_instances(id) ON DELETE CASCADE,
  -- Nome cru da instância no momento da captura. Redundante de propósito: se a instância
  -- for removida e recriada, o histórico continua dizendo por onde o lead entrou.
  evolution_instance   TEXT,

  telefone_norm        TEXT        NOT NULL,
  -- Id da mensagem do WhatsApp (key.id) — a chave de idempotência (ver índice abaixo).
  mensagem_id          TEXT        NOT NULL,

  ad_id                TEXT,
  ctwa_clid            TEXT,
  ctwa_clid_hint       TEXT,
  titulo               TEXT,
  source_url           TEXT,

  -- Utilizável pela Meta? false = existe para auditoria, nunca é enviada.
  atribuicao_confiavel BOOLEAN     NOT NULL DEFAULT false,
  motivo               TEXT,
  origem_registro      TEXT        NOT NULL DEFAULT 'webhook',
  capturado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT atribuicao_anuncios_origem_chk
    CHECK (origem_registro IN ('webhook')),
  -- Linha confiável precisa do identificador do clique: é o que a Meta exige. Sem ele a
  -- linha só pode existir como auditoria.
  CONSTRAINT atribuicao_anuncios_confiavel_chk
    CHECK (atribuicao_confiavel = false OR ctwa_clid IS NOT NULL)
);

-- IDEMPOTÊNCIA — por (empresa, mensagem), nunca por telefone.
--
-- A chave é o id da MENSAGEM que trouxe o anúncio. Reentrega do webhook, retry do
-- Evolution ou reprocessamento manual da mesma mensagem não criam segunda linha.
-- E não bloqueia evento legítimo posterior: quando o mesmo lead clica no anúncio de
-- novo (ou em outro), o WhatsApp entrega uma mensagem NOVA, com id novo, e a linha
-- nova é criada. É a correção do modelo antigo, que deduplicava por telefone e
-- congelava um lead numa única atribuição para sempre.
--
-- A instância fica FORA da chave: uma mensagem chega por exatamente uma instância, e
-- incluí-la permitiria que a mesma mensagem virasse duas linhas se fosse reprocessada
-- com a instância resolvida de outro jeito. O isolamento por instância é garantido na
-- LEITURA, onde toda consulta filtra por `instancia_id`.
CREATE UNIQUE INDEX IF NOT EXISTS atribuicao_anuncios_mensagem_uk
  ON app.atribuicao_anuncios (empresa_id, mensagem_id);

-- Leitura do despacho da Meta: "qual o clique deste telefone, nesta empresa?".
CREATE INDEX IF NOT EXISTS atribuicao_anuncios_empresa_telefone_idx
  ON app.atribuicao_anuncios (empresa_id, telefone_norm, capturado_em DESC);

-- Painel por anúncio e recorte por instância.
CREATE INDEX IF NOT EXISTS atribuicao_anuncios_empresa_instancia_idx
  ON app.atribuicao_anuncios (empresa_id, instancia_id, capturado_em DESC);
