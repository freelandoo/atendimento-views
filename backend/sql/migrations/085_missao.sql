-- 085_missao.sql
-- Operacao Comercial — Etapa 2 (Missao: desafio com recompensa).
--
-- O QUE ESTA MIGRATION RESOLVE
-- A Etapa 1 criou a PORTA do programa (aceite do termo, 084) e a camada de comissao (083) ja
-- responde "quanto esta pessoa originou de faturamento PAGO". Nao existia o DESAFIO: um alvo
-- publicado pelo dono, valido para a equipe por um periodo, com uma recompensa declarada.
--
-- ADITIVA: cria UMA tabela nova. Nenhuma tabela existente e' alterada, nenhum dado e' mutado.
-- Idempotente: pode rodar 2x.
--
-- ─── A DECISAO QUE GOVERNA O ARQUIVO: A MISSAO E' IMUTAVEL DEPOIS DE PUBLICADA ──────────
-- Alvo e recompensa NAO sao editaveis. Mudar o alvo em outubro reescreveria o desafio que
-- alguem cumpriu em setembro — e "quem alcancou" deixaria de ser um fato para virar uma conta
-- que depende do estado atual da tabela. Para mudar, encerra-se a missao e publica-se outra.
-- Mesma disciplina de `app.comissao_planos` (083, versionado) e de `app.roteiro_versoes`
-- (publicada = imutavel). Nao ha trigger: a garantia e' que NENHUM caminho escreve essas
-- colunas depois do INSERT (guarda de regressao le o fonte de src/db/missao.js).
--
-- ─── POR QUE NAO EXISTE TABELA DE "CONQUISTA" ──────────────────────────────────────────
-- Quem alcancou o alvo e' DERIVADO da mesma fonte que a comissao ja reconcilia
-- (`app.vendas.comissao_base`, das vendas com comissao liberada dentro da janela). Persistir a
-- conquista criaria uma SEGUNDA definicao de "resultado", que passaria a divergir da primeira no
-- dia em que uma venda fosse cancelada. Como a missao e' imutavel e as vendas nao somem, a lista
-- de quem alcancou continua reconstruivel para sempre — inclusive depois de a missao encerrar.
--
-- ─── POR QUE UMA METRICA SO', COM CHECK FECHADA ────────────────────────────────────────
-- E' a licao do canal de e-mail do follow-up (067) e do gatilho da comissao (083): valor de
-- vocabulario nasce JUNTO do executor. Uma metrica sem medidor produz missao que entra na tela e
-- nunca pode ser cumprida. Alargar esta CHECK e implementar o medidor tem de ser o MESMO diff.
--
-- ─── POR QUE RESULTADO PAGO, E NAO ATIVIDADE ───────────────────────────────────────────
-- Recompensar atividade paga por atividade: premiar "numero de reunioes" paga para marcar
-- reuniao ruim. E' a mesma razao pela qual a Decisao 3 de 2026-09-18 recusou ranking por
-- atividade, e pela qual `frontend/lib/equipe-painel.test.js` quebra o build se o painel da
-- equipe virar placar. A missao mede o que o cliente efetivamente PAGOU.

CREATE TABLE IF NOT EXISTS app.missoes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  titulo               TEXT NOT NULL,
  descricao            TEXT,

  -- O QUE a missao mede. Lista FECHADA (ver o cabecalho). O vocabulario vive em
  -- src/services/missao.js; ha teste anti-drift que le esta CHECK.
  metrica              TEXT NOT NULL,

  -- O ALVO. Sem DEFAULT de proposito: um DEFAULT autorizaria em silencio um INSERT futuro que
  -- esquecesse a coluna, e a missao passaria a ter um alvo que ninguem escolheu.
  alvo_valor           NUMERIC(14,2) NOT NULL,
  moeda                TEXT NOT NULL DEFAULT 'BRL',

  -- A JANELA. Datas, nao competencia mensal: um desafio pode ser semanal, mensal ou de uma
  -- quinzena, e `vendas.competencia` e' sempre o dia 1 do mes (083) — amarrar a missao a ela
  -- proibiria qualquer janela que nao fosse o mes inteiro.
  inicio               DATE NOT NULL,
  fim                  DATE NOT NULL,

  -- A RECOMPENSA. A descricao e' OBRIGATORIA (desafio sem premio declarado e' so' uma meta), o
  -- valor e' opcional porque nem toda recompensa e' dinheiro.
  -- ⚠️ O SISTEMA NAO PAGA A RECOMPENSA. Ele publica o desafio, mede o progresso e diz quem
  -- alcancou. Marcar a recompensa como entregue e' etapa seguinte, declarada como fora de escopo.
  recompensa_descricao TEXT NOT NULL,
  recompensa_valor     NUMERIC(14,2),

  status               TEXT NOT NULL DEFAULT 'ativa',
  encerrada_em         TIMESTAMPTZ,
  encerrada_por        UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  -- `prazo` = fechada automaticamente ao publicar a proxima, porque a janela dela ja tinha
  -- acabado. `decisao` = alguem encerrou antes da hora. Sao coisas diferentes para quem le o
  -- historico depois: uma e' rotina, a outra e' uma escolha que precisa de explicacao.
  encerrada_motivo     TEXT,

  criado_por           UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.missoes
  DROP CONSTRAINT IF EXISTS missoes_metrica_chk,
  DROP CONSTRAINT IF EXISTS missoes_alvo_chk,
  DROP CONSTRAINT IF EXISTS missoes_moeda_chk,
  DROP CONSTRAINT IF EXISTS missoes_janela_chk,
  DROP CONSTRAINT IF EXISTS missoes_recompensa_valor_chk,
  DROP CONSTRAINT IF EXISTS missoes_status_chk,
  DROP CONSTRAINT IF EXISTS missoes_encerramento_chk;

ALTER TABLE app.missoes
  ADD CONSTRAINT missoes_metrica_chk CHECK (metrica IN ('faturamento_pago_originado')),
  ADD CONSTRAINT missoes_alvo_chk    CHECK (alvo_valor > 0),
  ADD CONSTRAINT missoes_moeda_chk   CHECK (moeda ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT missoes_janela_chk  CHECK (fim >= inicio),
  -- Recompensa em dinheiro, quando existe, e' um valor de verdade. Zero seria uma promessa vazia
  -- com aparencia de premio.
  ADD CONSTRAINT missoes_recompensa_valor_chk CHECK (recompensa_valor IS NULL OR recompensa_valor > 0),
  ADD CONSTRAINT missoes_status_chk  CHECK (status IN ('ativa', 'encerrada')),
  -- Nao existe missao "encerrada" sem dizer QUANDO e POR QUE. Se um caminho futuro esquecer, o
  -- UPDATE falha em vez de deixar um encerramento sem rastro.
  ADD CONSTRAINT missoes_encerramento_chk CHECK (
    status <> 'encerrada'
    OR (encerrada_em IS NOT NULL AND encerrada_motivo IN ('prazo', 'decisao'))
  );

-- UMA missao ativa por empresa, garantido no BANCO e nao na aplicacao — mesmo mecanismo de
-- `comissao_planos_um_ativo_por_empresa_uk` (083) e de `busca_snapshots_uma_ativa_por_empresa_uk`.
-- Duas missoes ativas tornariam "a missao ativa" (o termo que a Etapa 1 usa) ambiguo.
CREATE UNIQUE INDEX IF NOT EXISTS missoes_uma_ativa_por_empresa_uk
  ON app.missoes (empresa_id)
  WHERE status = 'ativa';

-- Historico: "quais missoes esta empresa ja publicou", da mais recente para a mais antiga.
CREATE INDEX IF NOT EXISTS missoes_empresa_inicio_idx
  ON app.missoes (empresa_id, inicio DESC);

COMMENT ON TABLE app.missoes IS
  'Desafio com recompensa da Operacao Comercial. UMA ativa por empresa, valida para toda a equipe. IMUTAVEL depois de publicada (alvo e recompensa nunca sao editados — para mudar, encerra e publica outra). Quem alcancou o alvo e DERIVADO de app.vendas, a mesma fonte que a comissao reconcilia: persistir a conquista criaria uma segunda definicao de resultado.';
COMMENT ON COLUMN app.missoes.metrica IS
  'O que a missao mede. CHECK fechada em UM valor: metrica sem medidor produz missao que entra na tela e nunca pode ser cumprida. Alargar a CHECK e implementar o medidor tem de ser o MESMO diff.';
