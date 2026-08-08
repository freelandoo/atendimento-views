-- 061_instancia_origem_autorizada.sql
-- Origem AUTORIZADA do vínculo empresa↔instância.
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
-- A regra de negócio é: uma instância só pode ter vínculo com uma empresa quando foi
-- CRIADA pelo Atendimento Views, dentro daquela empresa. Até aqui o produto não tinha
-- como saber isso: `app.empresa_whatsapp_instances` guardava o vínculo, mas não guardava
-- de onde ele veio. Pior, `POST /api/empresas/:id/whatsapp` ENGOLIA o 403/409 "already in
-- use" do Evolution e gravava o vínculo assim mesmo — bastava digitar o nome de uma
-- instância criada por fora (API externa, painel da infraestrutura) para o produto adotá-la
-- e passar a atendê-la como se fosse dele.
--
-- A partir daqui a evidência de origem é PERSISTIDA junto do vínculo, na MESMA transação
-- que o cria. Não existe vínculo sem evidência: a coluna é NOT NULL e NÃO TEM DEFAULT, de
-- propósito. Um DEFAULT autorizaria silenciosamente qualquer INSERT futuro que esquecesse
-- a coluna; sem ele, esse INSERT falha alto, na hora de escrever, e não meses depois numa
-- auditoria.
--
-- OS DOIS VALORES (lista fechada)
--   atendimento_views — o vínculo nasceu do fluxo autorizado (criação da instância pelo
--                       produto, dentro de uma empresa). Único valor que código novo
--                       escreve;
--   legado            — linha que já existia quando esta migration rodou. NÃO é prova de
--                       origem: é a ausência dela. Fica explícito para poder ser auditado
--                       e recriado.
--
-- MUTAÇÃO DE DADO DECLARADA
--   O backfill marca TODAS as linhas existentes como `legado`. É carência deliberada,
--   decidida com o operador: exigir a evidência dessas linhas no webhook pararia o
--   atendimento de todos os números já conectados até que cada um fosse recriado (nome
--   técnico novo, QR novo, reconexão do WhatsApp). O webhook continua atendendo `legado`.
--   RISCO RESIDUAL, declarado e aceito: se alguma das linhas atuais foi adotada de fora
--   pelo defeito acima, ela segue atendendo até ser removida à mão. A tela de instâncias
--   marca quais são legadas justamente para isso.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ
--   - não cria empresa, não move vínculo, não apaga instância;
--   - não dá a ninguém um caminho para "regularizar" instância externa. Regularizar é
--     criar de novo pelo produto — e a instância nova nasce com outro nome técnico.
--
-- ROLLBACK
--   ALTER TABLE app.empresa_whatsapp_instances
--     DROP COLUMN IF EXISTS origem_vinculo,
--     DROP COLUMN IF EXISTS origem_vinculo_em,
--     DROP COLUMN IF EXISTS origem_vinculo_usuario_id;
--   DELETE FROM app.schema_migrations WHERE nome = '061_instancia_origem_autorizada.sql';
--   O rollback perde a evidência já registrada — não há como recomputá-la.

ALTER TABLE app.empresa_whatsapp_instances
  ADD COLUMN IF NOT EXISTS origem_vinculo            TEXT,
  ADD COLUMN IF NOT EXISTS origem_vinculo_em         TIMESTAMPTZ,
  -- Quem pediu a criação. NULL quando o vínculo nasceu de provisionamento
  -- máquina-a-máquina (freelandoo-provision) ou é `legado`.
  ADD COLUMN IF NOT EXISTS origem_vinculo_usuario_id UUID
    REFERENCES app.usuarios(id) ON DELETE SET NULL;

-- Carência: o que já existia vira `legado`, com a data de criação da própria linha (e não
-- NOW()), para a auditoria não sugerir que a evidência foi colhida hoje.
UPDATE app.empresa_whatsapp_instances
   SET origem_vinculo = 'legado',
       origem_vinculo_em = COALESCE(criado_em, NOW())
 WHERE origem_vinculo IS NULL;

ALTER TABLE app.empresa_whatsapp_instances
  ALTER COLUMN origem_vinculo SET NOT NULL;

-- Sem DEFAULT: INSERT que não informar a origem falha, em vez de nascer autorizado.
ALTER TABLE app.empresa_whatsapp_instances
  DROP CONSTRAINT IF EXISTS empresa_whatsapp_instances_origem_vinculo_chk;

ALTER TABLE app.empresa_whatsapp_instances
  ADD CONSTRAINT empresa_whatsapp_instances_origem_vinculo_chk
  CHECK (origem_vinculo IN ('atendimento_views', 'legado'));
