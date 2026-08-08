-- 060_webhook_quarentena.sql
-- Quarentena de webhooks SEM DONO COMPROVADO — substitui o fallback para a PJ.
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
-- `middleware/tenant.js` resolvia a empresa do webhook pela instância Evolution e, nos
-- TRÊS casos em que não conseguia (nome de instância ausente no payload, instância não
-- mapeada em `app.empresa_whatsapp_instances`, erro de consulta), devolvia o `empresa_id`
-- da PJ Codeworks. O atendimento seguia normalmente e gravava conversa, perfil de lead e
-- eventos comerciais SOB A PJ — dado de um negócio que não é a PJ, dentro do tenant da PJ.
-- Medido em produção em 2026-08-08: das 6 conversas marcadas como PJ, apenas 1 é PJ de
-- verdade (2 sem instância, 3 com instância não mapeada).
--
-- Cada instância é um negócio separado. Não existe "empresa padrão" para uma mensagem
-- cuja origem não foi provada: existe PENDÊNCIA TÉCNICA. É o que esta tabela guarda.
--
-- O QUE ESTA TABELA **NÃO** GUARDA (decisão explícita, não omissão)
--   - texto da mensagem, telefone, pushName, `ctwa_clid`, `ad_id`, URL;
--   - payload cru do webhook, nem cifrado.
-- Guardar a conversa de um negócio que não sabemos de quem é seria criar exatamente o
-- dado sujo que a quarentena existe para impedir — só que em repouso e sem dono para
-- responder por ele. A consequência aceita: a mensagem que caiu na quarentena NÃO é
-- reencenada. Mapeada a instância, a pendência é fechada e o lead volta a ser atendido
-- na PRÓXIMA mensagem. O que se recupera é o vínculo, não o histórico.
--
-- IDEMPOTÊNCIA
--   Uma LINHA POR INSTÂNCIA+MOTIVO (`webhook_quarentena_instancia_uk`), não uma linha por
--   mensagem: o mesmo número mal configurado produz milhares de webhooks e a tela precisa
--   dizer "esta instância está órfã", não listar dez mil eventos idênticos. Reentrega do
--   MESMO webhook não conta duas vezes — `ultima_mensagem_hash` guarda o SHA-256 do id da
--   mensagem já contabilizada e o UPDATE só incrementa quando o hash muda. Hash, e não o
--   id em claro, porque o id da mensagem do WhatsApp é rastreável até a conversa.
--   `instancia_chave` existe porque `evolution_instance` é NULLABLE (motivo
--   `sem_instancia` não tem nome nenhum) e NULL não colide com NULL em índice único —
--   sem ela, cada webhook sem instância viraria uma linha nova.
--
-- RESOLUÇÃO
--   `resolvida_em` / `resolvida_empresa_id` / `resolvida_instancia_id` registram o
--   fechamento. A empresa NÃO é escolhida pelo operador: a rota de reprocessamento
--   reconsulta `app.empresa_whatsapp_instances` pelo mesmo caminho do webhook e só fecha
--   se a instância AGORA resolver. Deixar o operador apontar a empresa à mão reintroduziria
--   o fallback com outro nome.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS app.webhook_quarentena;
--   DELETE FROM app.schema_migrations WHERE nome = '060_webhook_quarentena.sql';
--   Aditiva: nenhuma tabela existente é alterada e nenhum dado é mutado.

CREATE TABLE IF NOT EXISTS app.webhook_quarentena (
  id                    BIGSERIAL PRIMARY KEY,

  -- Nome cru da instância que veio no payload, quando veio. NULL = o payload não trazia
  -- instância alguma (motivo `sem_instancia`).
  evolution_instance    TEXT,
  -- Chave de deduplicação: o nome da instância ou a string vazia quando não há nome.
  -- Existe só para o índice único (NULL não colide com NULL no Postgres).
  instancia_chave       TEXT        NOT NULL,

  -- Por que não foi possível provar o dono. Lista FECHADA:
  --   sem_instancia          — o payload não identificou a instância;
  --   instancia_desconhecida — a instância não está mapeada (ou está inativa);
  --   erro_resolucao         — falha TÉCNICA ao consultar (banco fora, timeout).
  -- O terceiro é transitório e não pede mapeamento: separá-lo evita mandar o operador
  -- cadastrar uma instância que já existe.
  motivo                TEXT        NOT NULL,

  ocorrencias           BIGINT      NOT NULL DEFAULT 1,
  primeira_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- SHA-256 do id da mensagem já contabilizada. Serve à idempotência de reentrega e
  -- NÃO é reversível para a conversa.
  ultima_mensagem_hash  TEXT,

  resolvida_em          TIMESTAMPTZ,
  resolvida_empresa_id  UUID        REFERENCES app.empresas(id) ON DELETE SET NULL,
  resolvida_instancia_id UUID       REFERENCES app.empresa_whatsapp_instances(id) ON DELETE SET NULL,

  CONSTRAINT webhook_quarentena_motivo_chk
    CHECK (motivo IN ('sem_instancia', 'instancia_desconhecida', 'erro_resolucao')),
  -- Pendência fechada tem dono provado; pendência aberta não tem nenhum dos dois.
  -- É o invariante "não se fecha inventando empresa", escrito no banco.
  CONSTRAINT webhook_quarentena_resolucao_chk
    CHECK (
      (resolvida_em IS NULL AND resolvida_empresa_id IS NULL AND resolvida_instancia_id IS NULL)
      OR
      (resolvida_em IS NOT NULL AND resolvida_empresa_id IS NOT NULL AND resolvida_instancia_id IS NOT NULL)
    )
);

-- Uma pendência ABERTA por instância+motivo. O índice é PARCIAL de propósito: depois de
-- resolvida, a linha vira histórico e uma reincidência da mesma instância pode abrir
-- pendência nova (senão a reincidência seria silenciosamente absorvida no registro velho).
CREATE UNIQUE INDEX IF NOT EXISTS webhook_quarentena_instancia_uk
  ON app.webhook_quarentena (instancia_chave, motivo)
  WHERE resolvida_em IS NULL;

-- Listagem do painel: abertas primeiro, mais recentes no topo.
CREATE INDEX IF NOT EXISTS webhook_quarentena_abertas_idx
  ON app.webhook_quarentena (ultima_em DESC)
  WHERE resolvida_em IS NULL;
