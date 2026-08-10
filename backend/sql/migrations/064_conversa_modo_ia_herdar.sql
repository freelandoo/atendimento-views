-- 064_conversa_modo_ia_herdar.sql
-- O modo de IA vira POLITICA: padrao GLOBAL da Central + EXCECAO por conversa.
--
-- ⚠️ ESTA MIGRATION ALTERA DADOS EXISTENTES. Leia o motivo antes de mexer nela.
--
-- O QUE MUDA
-- A migration 063 (mesmo dia) criou `vendas.conversas.modo_ia` como MODO da conversa:
-- `NOT NULL DEFAULT 'conversa'`, CHECK (conversa | analise). A coluna passa agora a
-- representar a PREFERENCIA da conversa, com tres valores:
--     herdar   = SEM excecao; a conversa segue o modo padrao da Central de Mensagens
--     conversa = excecao explicita: responde, mesmo que a Central esteja em Analise
--     analise  = excecao explicita: nao responde, mesmo que a Central esteja em Conversa
--
-- POR QUE OS DADOS PRECISAM SER CONVERTIDOS (e nao ha alternativa boa)
-- Com o DEFAULT 'conversa' da 063, TODA linha da base esta hoje em `'conversa'`. Sob a
-- semantica nova isso significa "excecao explicita: Conversa" — ou seja, mudar o modo
-- global nao alcancaria conversa nenhuma, e o primeiro criterio de aceite da feature
-- ("conversa sem excecao acompanha o global") nasceria FALSO para 100% da base.
--
-- O QUE A CONVERSAO CUSTA, DECLARADO
-- Uma conversa que alguem tenha marcado explicitamente como "Conversa" nas horas entre o
-- deploy da 063 e esta migration perde essa fixacao e volta a herdar. Como o padrao global
-- nasce em `conversa`, o COMPORTAMENTO OBSERVAVEL nao muda para ninguem — muda so a
-- capacidade de a conversa resistir a uma futura troca do global.
-- Linhas em `'analise'` sao PRESERVADAS como excecao: aquilo alguem escolheu de verdade, e
-- e' justamente a escolha que existe para calar o bot.
--
-- O MODO GLOBAL NAO TEM MIGRATION
-- Ele vive em `app.empresas.config->>'modo_ia_padrao'` (JSONB que ja existe), reusando o
-- mesmo padrao de `config.agente_pausado`: cache curto em src/db/empresas.js + invalidacao
-- no PATCH. Ausencia da chave = `conversa`, que e' o comportamento historico.
--
-- A COLUNA NAO E RENOMEADA NESTA ENTREGA (divida declarada)
-- O nome honesto seria `modo_ia_preferencia`. Renomear abriria uma janela de erro durante o
-- deploy: o container antigo, ainda servindo requisicoes, consultaria uma coluna que deixou
-- de existir. No codigo os nomes sao explicitos (`preferenciaDaConversa`, `modoEfetivo`).
--
-- O modo EFETIVO nao e' persistido em lugar nenhum: e' calculado a cada leitura e a cada
-- turno por src/services/conversa-modo-ia.js. Uma copia gravada envelheceria no instante em
-- que o global mudasse.
--
-- `agente_pausado` NAO e' tocado: pausa temporaria por intervencao humana continua sendo
-- outro fato, com outro dono.

-- 1. O CHECK novo precisa entrar ANTES da conversao aceitar 'herdar'.
ALTER TABLE vendas.conversas DROP CONSTRAINT IF EXISTS conversas_modo_ia_check;

ALTER TABLE vendas.conversas
  ADD CONSTRAINT conversas_modo_ia_check
  CHECK (modo_ia IN ('herdar', 'conversa', 'analise'));

-- 2. Conversa nova nasce SEM excecao.
ALTER TABLE vendas.conversas ALTER COLUMN modo_ia SET DEFAULT 'herdar';

-- 3. MUTACAO DE DADOS declarada acima. Idempotente: reexecutar nao encontra mais linhas.
UPDATE vendas.conversas SET modo_ia = 'herdar' WHERE modo_ia = 'conversa';

COMMENT ON COLUMN vendas.conversas.modo_ia IS
  'PREFERENCIA de modo de IA desta conversa (nao o modo efetivo). herdar = sem excecao, '
  'segue app.empresas.config.modo_ia_padrao; conversa/analise = excecao explicita que o '
  'modo global nao altera. O modo EFETIVO e calculado em src/services/conversa-modo-ia.js e '
  'nunca persistido. Nao confundir com agente_pausado (pausa temporaria por intervencao '
  'humana): o envio exige modo efetivo conversa E agente nao pausado. Follow-up e agenda '
  'NAO dependem desta coluna nem do modo global.';
