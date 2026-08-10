-- 063_conversa_modo_ia.sql
-- Modo de atuacao da IA POR CONVERSA: separa PERMISSAO DE RESPONDER de CAPACIDADE DE ANALISAR.
--
-- O QUE ESTA MIGRATION RESOLVE
-- Ate aqui a unica forma de impedir a IA de responder um atendimento era `agente_pausado`,
-- que e' PAUSA TEMPORARIA por intervencao humana: nasce sozinha quando um atendente envia
-- mensagem (`conversa-manual.js`), cancela os follow-ups pendentes
-- (`followup-auto-cancel.js`), tira a conversa da call-list e, no webhook
-- (`webhook-handler.js`), corta o fluxo ANTES do turno de LLM — ou seja, pausar tambem
-- desliga a ANALISE. Nao existia como dizer "quero a inteligencia acompanhando este
-- atendimento, mas quem fala com o cliente sou eu".
--
-- POR QUE UMA COLUNA NOVA E NAO UM VALOR NOVO EM `agente_pausado`
-- Sao dois fatos diferentes sobre a mesma conversa e eles CONVIVEM:
--   agente_pausado = estado OPERACIONAL, efemero, escrito pelo proprio sistema;
--   modo_ia        = DECISAO do operador sobre o atendimento, persistente, so muda por
--                    acao explicita dele.
-- Derivar um do outro faria a pausa automatica (um atendente respondeu uma vez) apagar
-- uma decisao de configuracao, e faria a decisao de configuracao sobreviver ao "Retomar
-- agente". O envio automatico exige os DOIS: modo_ia = 'conversa' E agente nao pausado.
--
-- ADITIVA. Nao muta, nao apaga e nao move nenhum dado existente. O DEFAULT e' exatamente o
-- comportamento de hoje, entao NENHUMA conversa existente muda de comportamento ao aplicar.
--
-- Vocabulario travado em src/services/conversa-modo-ia.js (fonte de verdade unica) +
-- guarda de regressao em test/conversa-modo-ia.test.js.

ALTER TABLE vendas.conversas
  ADD COLUMN IF NOT EXISTS modo_ia TEXT NOT NULL DEFAULT 'conversa';

-- CHECK fechado e SEPARADO do ADD COLUMN: `ADD COLUMN ... CHECK` nao aceita
-- `IF NOT EXISTS` na constraint, e esta migration precisa ser reexecutavel.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversas_modo_ia_check'
  ) THEN
    ALTER TABLE vendas.conversas
      ADD CONSTRAINT conversas_modo_ia_check
      CHECK (modo_ia IN ('conversa', 'analise'));
  END IF;
END $$;

COMMENT ON COLUMN vendas.conversas.modo_ia IS
  'Politica de resposta da conversa. conversa = a IA pode responder automaticamente; '
  'analise = a IA analisa e registra, mas nao envia resposta conversacional ao cliente. '
  'Nao confundir com agente_pausado (pausa temporaria por intervencao humana): os dois '
  'convivem e o envio exige os dois liberados. Follow-up e agenda NAO dependem desta coluna.';
