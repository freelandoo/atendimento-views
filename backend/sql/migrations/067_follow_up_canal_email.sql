-- 067_follow_up_canal_email.sql
-- CANAL DE E-MAIL DO FOLLOW-UP — a "fase separada" que a migration 066 declarou.
--
-- O QUE ESTA MIGRATION RESOLVE
-- A 066 gravou o veredito humano "este contato nao tem WhatsApp" e moveu o trabalho para o
-- canal possivel. So que o canal possivel era SEMPRE `ligacao`, inclusive quando havia
-- e-mail conhecido: `follow_ups_canal_chk` era fechada em whatsapp|ligacao e **nenhuma tela
-- sabia executar** um follow-up de e-mail. A decisao registrada em docs/ai-decision-log.md
-- (2026-08-12, Decisao 4) foi explicita: criar o valor `email` sem o executor produziria
-- itens que entram na fila e nunca saem dela — pior que a ausencia do canal.
--
-- Esta migration entra JUNTO com o executor (services/followup-email.js + a acao "Escrever
-- e-mail" na Central de Follow-ups). O valor so existe porque agora ha quem o execute.
--
-- ADITIVA quanto a DADOS: nao muta, nao apaga e nao move nenhuma linha existente. O que ela
-- altera sao duas CHECKs, e as duas apenas ALARGAM o que era aceito — nenhuma linha gravada
-- deixa de ser valida. `origem` (a garantia de "so humano" da 066) NAO e tocada.
--
-- Enums travados por src/services/contato-canal-disponibilidade.js e
-- src/services/follow-up-modelo.js (modulos PUROS, donos do vocabulario) + anti-drift em
-- test/domain-enums.test.js, que a partir daqui compara com ESTA migration (o mesmo padrao
-- da 040 -> 052: quando uma CHECK e redefinida, o anti-drift olha a definicao ATUAL).

-- ─── 1) O follow-up passa a ter canal de e-mail ──────────────────────────────
-- A tela executora do canal e a PROPRIA Central de Follow-ups (compositor + envio), e nao
-- a Central de Mensagens (WhatsApp) nem a de Ligacoes. Ver services/follow-up-modelo.js.
ALTER TABLE app.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_canal_chk;
ALTER TABLE app.follow_ups
  ADD CONSTRAINT follow_ups_canal_chk CHECK (canal IN ('whatsapp', 'ligacao', 'email'));

-- O indice unico parcial `follow_ups_um_aberto_por_canal_uk` (062) continua valendo sem
-- alteracao: ele e por (empresa, telefone, CANAL), entao o e-mail entra como um terceiro
-- trabalho possivel — "mandar e-mail amanha" e "ligar na sexta" seguem sendo dois itens.

-- ─── 2) A disponibilidade de e-mail e curada por PESSOA, como a de WhatsApp ──
-- Mesma tabela da 066 de proposito: e o MESMO tipo de fato (veredito humano sobre um canal
-- de um contato), com a MESMA identidade (empresa_id + telefone_digitos). Uma tabela
-- separada duplicaria a curadoria em dois lugares e deixaria as duas divergirem.
ALTER TABLE app.contato_canal_disponibilidade DROP CONSTRAINT IF EXISTS contato_canal_disp_canal_chk;
ALTER TABLE app.contato_canal_disponibilidade
  ADD CONSTRAINT contato_canal_disp_canal_chk CHECK (canal IN ('whatsapp', 'email'));

-- `ligacao` continua FORA: o telefone E a identidade do contato (telefone_digitos, NOT NULL),
-- entao a resposta seria sempre "disponivel" e a linha nao diria nada.

-- O ENDERECO. Nullable e sem DEFAULT: para `whatsapp` ele nao existe (o "endereco" e o
-- proprio telefone, que ja e a identidade), e para `email` ele so faz sentido quando alguem
-- confirmou um. Coluna nova em tabela existente, sem reescrever linha nenhuma.
ALTER TABLE app.contato_canal_disponibilidade ADD COLUMN IF NOT EXISTS endereco TEXT;

-- Um endereco so pode existir no canal que tem endereco. Sem isso, uma linha de WhatsApp
-- poderia carregar um e-mail e ninguem saberia qual canal aquele endereco descreve.
ALTER TABLE app.contato_canal_disponibilidade DROP CONSTRAINT IF EXISTS contato_canal_disp_endereco_chk;
ALTER TABLE app.contato_canal_disponibilidade
  ADD CONSTRAINT contato_canal_disp_endereco_chk
  CHECK (canal = 'email' OR endereco IS NULL);

-- ESTA e a CHECK que impede o defeito que a Decisao 4 apontou: "e-mail disponivel" sem
-- endereco seria um canal roteavel para lugar nenhum, e o item entraria na fila para nunca
-- sair dela. Confirmar exige dizer PARA ONDE. Marcar `disponivel = false` (o contato nao
-- tem e-mail que receba) segue permitido sem endereco — e uma negacao, nao um destino.
ALTER TABLE app.contato_canal_disponibilidade DROP CONSTRAINT IF EXISTS contato_canal_disp_email_confirmado_chk;
ALTER TABLE app.contato_canal_disponibilidade
  ADD CONSTRAINT contato_canal_disp_email_confirmado_chk
  CHECK (canal <> 'email' OR disponivel = false OR endereco IS NOT NULL);

COMMENT ON COLUMN app.contato_canal_disponibilidade.endereco IS
  'Endereco do canal, quando ele tem um (so canal=email). Confirmar e-mail exige endereco: canal sem destino nao e canal. E-mail de cadastro/anotacao NUNCA chega aqui sozinho — e candidato ate uma pessoa confirmar.';

-- ─── 3) O EXECUTOR precisa deixar rastro ─────────────────────────────────────
-- Registro de cada envio de e-mail feito a partir de um follow-up. Tabela propria, em `app`,
-- e nao `prospectador.email_outreach`, por dois motivos concretos:
--   1. aquela tabela e chaveada por `prospect_id` (com indice unico por
--      `(prospect_id, lower(email))` entre agendado/enviado) e o follow-up NAO tem prospect
--      obrigatorio — um item nascido de mensagem ou criado a mao nao tem cadastro nenhum;
--   2. aquela tabela e o ledger do outreach de PROSPECCAO (primeira abordagem). Misturar os
--      dois faria a contagem de abordagem e a de follow-up medirem a mesma coisa.
-- NAO existe status 'desativado' aqui, ao contrario de email_outreach: quando o canal nao
-- esta configurado o envio e RECUSADO antes de compor, o item continua na fila e nada e
-- gravado — gravar um "envio" que nunca aconteceu faria a linha do tempo do contato mentir.
CREATE TABLE IF NOT EXISTS app.follow_up_emails (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- ON DELETE SET NULL, como as referencias de contexto da 062: apagar o item nao pode
  -- apagar o fato de que um e-mail foi enviado a um cliente real.
  follow_up_id      UUID REFERENCES app.follow_ups(id) ON DELETE SET NULL,

  -- A identidade do contato, a mesma das migrations 062 e 066.
  telefone_digitos  TEXT NOT NULL,

  -- Para ONDE foi. Guardado no momento do envio: se o contato trocar de e-mail depois, o
  -- registro tem de continuar dizendo para onde a mensagem realmente saiu.
  destinatario      TEXT NOT NULL,
  assunto           TEXT NOT NULL,
  corpo             TEXT NOT NULL,

  status            TEXT NOT NULL,
  provider_id       TEXT,
  -- Mensagem de erro APARADA. Nunca o corpo cru da resposta do provider, que pode ecoar o
  -- payload enviado (mesma regra de app.conversao_tentativas).
  erro              TEXT,

  enviado_por       UUID,
  enviado_em        TIMESTAMPTZ,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT follow_up_emails_status_chk   CHECK (status IN ('enviado', 'falhou')),
  CONSTRAINT follow_up_emails_telefone_chk CHECK (telefone_digitos ~ '^[0-9]{8,15}$'),
  -- 'enviado' sem quando seria um fato sem hora (mesma regra de follow_ups_conclusao_chk).
  CONSTRAINT follow_up_emails_enviado_chk  CHECK (status <> 'enviado' OR enviado_em IS NOT NULL)
);

-- Linha do tempo do contato (o historico unificado le por empresa + telefone).
CREATE INDEX IF NOT EXISTS idx_follow_up_emails_contato
  ON app.follow_up_emails (empresa_id, telefone_digitos, criado_em DESC);

-- "O que foi enviado por causa deste item".
CREATE INDEX IF NOT EXISTS idx_follow_up_emails_item
  ON app.follow_up_emails (follow_up_id)
  WHERE follow_up_id IS NOT NULL;

COMMENT ON TABLE app.follow_up_emails IS
  'Registro de execucao do canal de e-mail do follow-up (um envio por linha). Separado de prospectador.email_outreach, que e o ledger do outreach de PROSPECCAO e exige prospect_id. Sem status desativado: canal nao configurado recusa antes de compor e nada e gravado.';
