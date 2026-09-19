-- 090_agenda_bloqueio_espelho.sql
-- Bloqueio de agenda que vale TAMBEM para o bot do WhatsApp.
--
-- ─── O DEFEITO QUE ESTA MIGRATION EXISTE PARA CORRIGIR ─────────────────────────────────
-- Existem DUAS agendas neste produto e elas NAO se enxergam:
--   `app.agenda_eventos`    -> a agenda da TELA (multiempresa, dono por `responsavel_id` UUID)
--   `vendas.agenda_eventos` -> a agenda do BOT  (dono por `usuario_id` BIGINT)
--
-- O bot oferece horario ao cliente lendo `vendas.agenda_eventos` (`eventosDoDia`, agenda.js) e
-- valida a escolha na MESMA tabela (`validarSlotReuniao`). A tela grava em `app.agenda_eventos`.
-- Consequencia medida no codigo: **um bloqueio criado na tela nao tem efeito nenhum sobre quem
-- marca pelo WhatsApp.** O dono bloqueia o feriado, o bot oferece aquele horario assim mesmo, a
-- validacao aprova, e a reuniao cai em cima do bloqueio.
--
-- ─── A DECISAO (operador, 2026-09-19) ──────────────────────────────────────────────────
-- ESPELHAR o bloqueio, nao unificar as agendas. Unificar as duas e' projeto proprio e esta
-- declarado como tal no `AGENTS.md`; alem disso, mudar a leitura do bot mexeria no caminho que
-- decide TODO horario oferecido a cliente — o caminho mais quente do funil de vendas.
-- Espelhar mantem aquela leitura intacta: para o bot, o bloqueio simplesmente passa a existir.
--
-- O bloqueio e' da EMPRESA INTEIRA (sem `responsavel_id`), tambem por decisao do operador. Nao e'
-- so' preferencia: `vendas` identifica o dono por BIGINT e `app` por UUID, e **nao existe traducao
-- entre os dois**. Bloqueio por pessoa nao atravessaria o espelho — valeria so' na tela, que e'
-- exatamente o descompasso que esta migration remove. Feriado, almoco e reuniao interna (os tres
-- casos pedidos) sao naturalmente da empresa toda.
--
-- ADITIVA: acrescenta UMA coluna nullable. Nenhum dado e' mutado, nenhuma linha e' criada.
-- Bloqueio que ja existia continua sem espelho (`NULL`) — e' a ausencia de espelho, nomeada.
-- Idempotente: pode rodar 2x.
--
-- ─── POR QUE UMA COLUNA, E NAO `metadata` ──────────────────────────────────────────────
-- O vinculo precisa sobreviver a edicao e a exclusao: apagar o bloqueio na tela tem de apagar o
-- espelho, senao o bot fica bloqueado para sempre num horario que ninguem mais ve. Um id perdido
-- dentro de um JSONB nao tem tipo, nao tem indice e nao quebra nada quando alguem sobrescreve o
-- objeto inteiro — e sobrescrever `metadata` e' exatamente o que um PATCH faz hoje
-- (`validarEvento` troca o objeto, nao faz merge).
--
-- ─── SEM DEFAULT, DE PROPOSITO ─────────────────────────────────────────────────────────
-- Mesma disciplina de `origem_vinculo` (061) e das colunas da 082: um DEFAULT autorizaria em
-- silencio um INSERT futuro que esquecesse a coluna. Aqui o valor so' pode vir de um INSERT que
-- REALMENTE criou a linha espelhada — inventa-lo apontaria para uma linha que nao existe.
--
-- ─── SEM FOREIGN KEY, DE PROPOSITO ─────────────────────────────────────────────────────
-- `app` e `vendas` sao mundos separados por decisao de arquitetura (`agenda-multiempresa.js:3-5`
-- declara a vertical "sem acoplamento a agenda legada"). Uma FK entre schemas amarraria o
-- ciclo de vida das duas agendas e faria um `ON DELETE CASCADE` de `vendas.dashboard_users`
-- derrubar evento da tela. O vinculo e' de aplicacao, com limpeza explicita no `removerEvento`.

ALTER TABLE app.agenda_eventos
  ADD COLUMN IF NOT EXISTS espelho_vendas_id BIGINT;

COMMENT ON COLUMN app.agenda_eventos.espelho_vendas_id IS
  'Id da linha espelhada em vendas.agenda_eventos, para que o BLOQUEIO valha tambem para o bot do '
  'WhatsApp (que le apenas aquela tabela ao oferecer horario). NULL = sem espelho: ou o evento nao '
  'e bloqueio, ou e anterior a migration 090. Sem FK de proposito (schemas desacoplados); a '
  'limpeza e feita pela aplicacao em removerEvento/atualizarEvento.';

-- Serve a limpeza e a reconciliacao ("quais eventos desta empresa tem espelho?"). Parcial porque
-- a esmagadora maioria dos eventos NAO e bloqueio e nunca tera espelho.
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_espelho
  ON app.agenda_eventos (espelho_vendas_id)
  WHERE espelho_vendas_id IS NOT NULL;
