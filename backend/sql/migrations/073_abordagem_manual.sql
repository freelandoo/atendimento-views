-- 073_abordagem_manual.sql
-- CRM em EQUIPE — Etapa 5. Abordagem MANUAL pelo WhatsApp (wa.me), e a distinção entre
-- fato COMPROVADO e fato DECLARADO por uma pessoa.
-- Ver docs/especificacao-crm-equipe.md §5.4 e docs/plano-execucao-crm-equipe.md §6 (Etapa 5).
--
-- A REGRA DE NEGÓCIO QUE GOVERNA ESTA MIGRATION
-- **Abrir um link `wa.me` NÃO prova que a mensagem foi enviada.** O sistema abre o WhatsApp; quem
-- envia é o vendedor, no aparelho dele, fora do alcance de qualquer webhook. Tratar o clique como
-- envio produziria a pior espécie de métrica: um número que parece medir entrega e mede intenção.
--
-- POR QUE ISSO VIRA COLUNA, E NÃO UM STATUS NOVO
-- `prospectador.lead_disparos.status` já tem 7 valores, e todos descrevem **geração por IA e
-- entrega técnica pela Evolution** (`gerando`, `aguardando_disparo`, `erro_ia`, `enviando`,
-- `pendente_confirmacao`, `enviado`, `falhou`). Acrescentar `enviado_manualmente` ali faria o mesmo
-- valor (`enviado`) significar duas coisas com força de prova diferente, dependendo de outra coluna.
-- Separar o CANAL de como o fato foi CONFIRMADO deixa `status` medindo uma coisa só.
--
-- O VOCABULÁRIO É REUSADO, NÃO INVENTADO — este repositório já distingue prova de declaração:
--   * `lead_disparos`: `pendente_confirmacao` -> `enviado` só com DELIVERY_ACK|READ|PLAYED
--     do provedor (`aguardarStatusEnvioEvolution`);
--   * `empresa_whatsapp_instances.origem_vinculo` (061): `atendimento_views` (prova) vs `legado`
--     (a ausência de prova, nomeada);
--   * `contato_canal_disponibilidade.origem` (066): NOT NULL, SEM DEFAULT, CHECK de UM valor
--     (`operador`) — para que nenhum job possa gravar um veredito humano;
--   * `prospects.qualificacao = 'legado'` (071): mesma ideia.
--
-- ADITIVA. O único ALTER que muda regra existente é o `DROP NOT NULL` de `evolution_instance`, e
-- ele só ALARGA o que era aceito (ver §3). Nenhum UPDATE de dado. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Canal do disparo
-- ---------------------------------------------------------------------------
-- `DEFAULT 'evolution'` é o que preserva o passado: as 74 linhas já existentes foram todas envio
-- pela Evolution, e é isso que a coluna passa a afirmar sobre elas. Aqui o DEFAULT não autoriza
-- nada em silêncio (ao contrário de uma coluna de prova) — ele descreve o único canal que existia.
ALTER TABLE prospectador.lead_disparos
  ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'evolution';

ALTER TABLE prospectador.lead_disparos
  DROP CONSTRAINT IF EXISTS lead_disparos_canal_chk;

ALTER TABLE prospectador.lead_disparos
  ADD CONSTRAINT lead_disparos_canal_chk
  CHECK (canal IN ('evolution', 'manual_wa_me'));

-- ---------------------------------------------------------------------------
-- 2. Fato comprovado × fato declarado
-- ---------------------------------------------------------------------------
-- `provider`: a Evolution confirmou a entrega (DELIVERY_ACK | READ | PLAYED).
-- `operador`:  uma PESSOA declarou que enviou. Não é prova, e a tela é obrigada a dizer isso.
-- NULL: ninguém confirmou nada ainda — inclui o clique em "Abrir WhatsApp", que é registro de
--       ABERTURA, não de envio.
--
-- Nullable de propósito: o terceiro estado ("ainda não se sabe") é o mais comum no canal manual, e
-- forçar um valor obrigaria a inventar confirmação.
ALTER TABLE prospectador.lead_disparos
  ADD COLUMN IF NOT EXISTS confirmado_por TEXT,
  ADD COLUMN IF NOT EXISTS confirmado_em  TIMESTAMPTZ;

ALTER TABLE prospectador.lead_disparos
  DROP CONSTRAINT IF EXISTS lead_disparos_confirmado_por_chk,
  DROP CONSTRAINT IF EXISTS lead_disparos_confirmado_em_chk;

ALTER TABLE prospectador.lead_disparos
  ADD CONSTRAINT lead_disparos_confirmado_por_chk
    CHECK (confirmado_por IS NULL OR confirmado_por IN ('provider', 'operador')),
  -- Quem confirmou tem data. Sem isso, "confirmado por operador" sem quando seria um fato sem
  -- momento, e é o momento que distingue a declaração do clique que a precedeu.
  ADD CONSTRAINT lead_disparos_confirmado_em_chk
    CHECK (confirmado_por IS NULL OR confirmado_em IS NOT NULL) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. `evolution_instance` deixa de ser obrigatória
-- ---------------------------------------------------------------------------
-- A abordagem manual **não tem instância**: ninguém do produto envia nada. Manter o NOT NULL
-- obrigaria a inventar um nome de instância para uma mensagem que não passou por instância
-- nenhuma — dado falso, e pior: um nome que os relatórios de instância somariam como se fosse
-- envio daquele número.
--
-- Isto NÃO afrouxa a regra de instância de envio (Fase 2 / services/instancia-envio.js): aquela
-- rege QUEM PODE ENVIAR pelo produto, e continua exigindo instância provada. Aqui o produto não
-- envia. A CHECK abaixo é o que amarra as duas coisas: canal Evolution CONTINUA exigindo a
-- instância; só o manual pode vir sem.
ALTER TABLE prospectador.lead_disparos
  ALTER COLUMN evolution_instance DROP NOT NULL;

ALTER TABLE prospectador.lead_disparos
  DROP CONSTRAINT IF EXISTS lead_disparos_instancia_por_canal_chk;

ALTER TABLE prospectador.lead_disparos
  ADD CONSTRAINT lead_disparos_instancia_por_canal_chk
  CHECK (
    (canal = 'evolution'    AND evolution_instance IS NOT NULL) OR
    (canal = 'manual_wa_me' AND evolution_instance IS NULL)
  ) NOT VALID;  -- NOT VALID: as linhas antigas são todas 'evolution' com instância, então passam;
                -- validar agora custaria varredura sem ganho.

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
-- "O que este vendedor abordou à mão" e o teto/cooldown por canal. O teto diário da Evolution NÃO
-- se aplica ao manual (não há número do produto a proteger), então as contagens precisam poder
-- separar os dois — sem este índice, cada tela filtraria por canal em varredura.
CREATE INDEX IF NOT EXISTS idx_lead_disparos_canal_usuario
  ON prospectador.lead_disparos (empresa_id, canal, usuario_id, criado_em DESC);

COMMENT ON COLUMN prospectador.lead_disparos.canal IS
  'evolution = o produto enviou pela Evolution | manual_wa_me = o sistema abriu o wa.me e o VENDEDOR enviou do aparelho dele. O teto diario e o cooldown anti-ban valem so para evolution: no manual nao ha numero do produto a proteger.';
COMMENT ON COLUMN prospectador.lead_disparos.confirmado_por IS
  'provider = entrega confirmada pela Evolution (DELIVERY_ACK|READ|PLAYED) | operador = uma PESSOA declarou que enviou (NAO e prova; toda tela que exibir precisa dizer isso) | NULL = ninguem confirmou, inclui o clique em "Abrir WhatsApp", que registra ABERTURA e nao envio.';
