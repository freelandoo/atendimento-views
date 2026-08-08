-- 058_lead_profiles_empresa.sql
-- Fase A do isolamento por empresa: `vendas.lead_profiles.empresa_id` deixa de nascer
-- com o valor da PJ por DEFAULT e passa a ser escrito explicitamente, a partir da
-- conversa (src/db/lead-profile-empresa.js).
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
-- A migration 006 pôs `DEFAULT '<PJ>'` na coluna e declarou, no próprio cabeçalho, que
-- o default sairia "quando o roteamento por instância for ligado". Ele nunca saiu.
-- Como nenhum dos quatro caminhos de INSERT informava `empresa_id`, TODO lead de TODA
-- empresa nascia marcado como PJ. Efeito prático medido no código: `meta-dispatch.js`
-- casa `lp.empresa_id` com a empresa da reunião/conversa; o join não fecha, o lead conta
-- como "sem atribuição" e a conversão CTWA do tenant nunca é enviada.
--
-- O QUE ESTA MIGRATION FAZ (ADITIVA — NENHUM DADO É MUTADO AQUI)
--   1. Remove o DEFAULT da PJ. A partir daqui, quem não informar empresa grava NULL —
--      e o código sempre informa (COALESCE(conversa, PJ)), então NULL vira sinal de bug,
--      não de rotina.
--   2. `empresa_id_origem` — quanto se pode CONFIAR na atribuição. É o que permitirá à
--      Meta, na Fase B, recusar atribuição frouxa sem remover o fallback agora.
--        conversa_confirmada     = a empresa veio da conversa E a instância WhatsApp dela
--                                  aponta para a mesma empresa. Confiável;
--        conversa_nao_confirmada = veio da conversa, mas nada confirmou — conversa sem
--                                  instância, instância não mapeada, ou fallback da PJ
--                                  (middleware/tenant.js). NÃO confiável;
--        NULL                    = linha anterior a esta migration, também não confiável.
--      Medição em produção (2026-08-08) que justifica a confirmação pela instância: das 6
--      conversas marcadas como PJ, só 1 é PJ de verdade — 2 sem instância, 3 com instância
--      não mapeada. "Veio da conversa" sozinho seria uma confiança inventada.
--      QUEM escreveu o valor (atendimento ou backfill) não entra aqui de propósito: esse
--      rastro é auditoria e vive em vendas.lead_profiles_empresa_backfill.
--   3. Índice (empresa_id, numero) — o casamento que os consumidores por tenant fazem
--      (meta-dispatch, painel de anúncios, aquisição). Hoje só existe (empresa_id).
--   4. Tabela `vendas.lead_profiles_empresa_backfill` — o "antes" de cada linha que o
--      script de backfill alterar. É o mecanismo de ROLLBACK do backfill (ver abaixo).
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO
--   - NÃO corrige as linhas históricas. Isso é trabalho do script, que simula por padrão,
--     roda em lotes e guarda o valor anterior:
--         npm run backfill:lead-profiles-empresa              # simulação, não grava
--         npm run backfill:lead-profiles-empresa -- --aplicar # grava
--     Backfill pesado no boot travaria o start do serviço no Railway.
--   - NÃO torna `empresa_id` NOT NULL: linhas antigas com NULL derrubariam o boot.
--   - NÃO troca `UNIQUE (numero)` por `UNIQUE (empresa_id, numero)`. Fora de escopo.
--
-- ROLLBACK DESTA MIGRATION
--   ALTER TABLE vendas.lead_profiles
--     ALTER COLUMN empresa_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
--   DROP INDEX IF EXISTS vendas.idx_lead_profiles_empresa_numero;
--   -- (opcional) ALTER TABLE vendas.lead_profiles DROP COLUMN empresa_id_origem;
--   DELETE FROM app.schema_migrations WHERE nome = '058_lead_profiles_empresa.sql';
--   A coluna e a tabela de backfill são aditivas: mantê-las não quebra o código antigo.

-- 1. Fim do DEFAULT da PJ ────────────────────────────────────────────────────────
ALTER TABLE vendas.lead_profiles ALTER COLUMN empresa_id DROP DEFAULT;

-- 2. Procedência do valor ────────────────────────────────────────────────────────
ALTER TABLE vendas.lead_profiles
  ADD COLUMN IF NOT EXISTS empresa_id_origem TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lead_profiles_empresa_id_origem_chk'
       AND conrelid = 'vendas.lead_profiles'::regclass
  ) THEN
    ALTER TABLE vendas.lead_profiles
      ADD CONSTRAINT lead_profiles_empresa_id_origem_chk
      CHECK (empresa_id_origem IS NULL OR empresa_id_origem IN (
        'conversa_confirmada', 'conversa_nao_confirmada'
      ));
  END IF;
END $$;

-- 3. Índice do casamento por tenant ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lead_profiles_empresa_numero
  ON vendas.lead_profiles (empresa_id, numero);

-- O backfill varre as linhas de procedência desconhecida; o índice parcial mantém
-- essa varredura barata e some sozinho de utilidade quando a correção terminar.
CREATE INDEX IF NOT EXISTS idx_lead_profiles_empresa_origem_pendente
  ON vendas.lead_profiles (id)
  WHERE empresa_id_origem IS NULL;

-- 4. Mecanismo de rollback do BACKFILL ───────────────────────────────────────────
-- Uma linha por perfil alterado, com o valor ANTERIOR. Sem telefone e sem qualquer
-- outro dado do lead: só o id do perfil, que já basta para desfazer.
--
--   Desfazer uma execução inteira:
--     UPDATE vendas.lead_profiles lp
--        SET empresa_id        = b.empresa_id_anterior,
--            empresa_id_origem = b.empresa_id_origem_anterior
--       FROM vendas.lead_profiles_empresa_backfill b
--      WHERE b.lead_profile_id = lp.id
--        AND b.execucao_id = '<uuid impresso pelo script>';
CREATE TABLE IF NOT EXISTS vendas.lead_profiles_empresa_backfill (
  id                          BIGSERIAL PRIMARY KEY,
  execucao_id                 UUID        NOT NULL,
  lead_profile_id             INTEGER     NOT NULL,
  empresa_id_anterior         UUID,
  empresa_id_origem_anterior  TEXT,
  empresa_id_novo             UUID        NOT NULL,
  aplicado_em                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_profiles_empresa_backfill_execucao
  ON vendas.lead_profiles_empresa_backfill (execucao_id);
