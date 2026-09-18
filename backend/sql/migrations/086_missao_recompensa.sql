-- 086_missao_recompensa.sql
-- Operacao Comercial — Etapa 4: a BAIXA da recompensa da missao.
--
-- O CICLO QUE ESTA MIGRATION FECHA
-- A Etapa 2 (085) publica o desafio, mede o progresso e diz QUEM alcancou o alvo. Nao havia onde
-- registrar que o premio foi ENTREGUE — buraco que a comissao nao tem (083 tem `comissao_paga_em`,
-- `comissao_paga_por` e `comissao_pagamento_ref` na propria venda). Sem isso, o dono paga e o
-- sistema continua dizendo "3 pessoas alcancaram", sem distinguir quem ja recebeu.
--
-- ADITIVA: cria UMA tabela nova. Nenhuma tabela existente e' alterada, nenhum dado e' mutado.
-- Idempotente: pode rodar 2x.
--
-- ─── POR QUE UMA TABELA, E NAO COLUNAS ─────────────────────────────────────────────────
-- A CONQUISTA e' DERIVADA (ver o cabecalho da 085): nao existe linha de "fulano alcancou o alvo"
-- onde pendurar a baixa. Ela continua derivada de proposito — persisti-la criaria uma segunda
-- definicao de resultado. O que se persiste aqui e' um fato NOVO e independente: **o premio saiu**.
--
-- ─── A BAIXA NAO E' A CONQUISTA, E NAO A SUBSTITUI ─────────────────────────────────────
-- Alcancar continua sendo calculado das vendas pagas. Esta tabela so' responde "ja paguei?".
-- Quem nao alcancou nao pode receber baixa: a verificacao acontece na aplicacao, DENTRO da
-- transacao, reconferindo a conquista no ato (nao ha como expressar isso numa CHECK, porque
-- depende de uma agregacao sobre `app.vendas`).
--
-- ─── NAO EXISTE DESFAZER ───────────────────────────────────────────────────────────────
-- Append-only, como `app.venda_pagamentos`. Dizer "paguei" e' um fato sobre dinheiro que saiu;
-- um UPDATE que apagasse a baixa destruiria o unico registro de que o premio foi entregue.
-- **Consequencia declarada e aceita: baixa errada nao se corrige por tela nesta etapa.**

CREATE TABLE IF NOT EXISTS app.missao_recompensas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  missao_id      UUID NOT NULL REFERENCES app.missoes(id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,

  -- O que REALMENTE saiu. Nullable porque nem toda recompensa e' dinheiro (a missao aceita
  -- premio so' descrito, 085) e sem DEFAULT porque um DEFAULT autorizaria em silencio um INSERT
  -- futuro que esquecesse a coluna.
  --
  -- ⚠️ E' o valor PAGO, nao o declarado na missao. Os dois podem divergir (arredondamento, premio
  -- entregue em parte, acordo especifico) e a divergencia precisa ficar AUDITAVEL em vez de
  -- desaparecer atras do numero da missao. A missao e' imutavel, entao o declarado continua
  -- consultavel para comparacao.
  valor_pago     NUMERIC(14,2),
  moeda          TEXT NOT NULL DEFAULT 'BRL',

  -- O quanto a pessoa tinha originado quando a baixa foi dada. CONGELADO pelo mesmo motivo do
  -- `comissao_percentual` (083): a conquista e' derivada e continua sendo recalculada; sem este
  -- retrato, "por que paguei este valor?" deixaria de ser respondivel se uma venda fosse
  -- cancelada depois.
  originado_no_pagamento NUMERIC(14,2),
  alvo_no_pagamento      NUMERIC(14,2),

  referencia     TEXT,   -- id do Pix/transferencia, quando houver
  observacao     TEXT,
  pago_por       UUID REFERENCES app.usuarios(id) ON DELETE SET NULL,
  pago_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.missao_recompensas
  DROP CONSTRAINT IF EXISTS missao_recompensas_valor_chk,
  DROP CONSTRAINT IF EXISTS missao_recompensas_moeda_chk;

ALTER TABLE app.missao_recompensas
  -- Zero seria "paguei nada" com aparencia de pagamento. Premio nao-monetario e' NULL, que diz
  -- outra coisa: "saiu, e nao era dinheiro".
  ADD CONSTRAINT missao_recompensas_valor_chk CHECK (valor_pago IS NULL OR valor_pago > 0),
  ADD CONSTRAINT missao_recompensas_moeda_chk CHECK (moeda ~ '^[A-Z]{3}$');

-- UMA baixa por pessoa por missao, garantido no BANCO: um duplo clique, um retry do navegador ou
-- duas abas abertas nao podem pagar o mesmo premio duas vezes. Mesmo mecanismo de
-- `venda_pagamentos_referencia_uk` (083) e `programa_aceites_pessoa_versao_uk` (084).
CREATE UNIQUE INDEX IF NOT EXISTS missao_recompensas_pessoa_uk
  ON app.missao_recompensas (missao_id, usuario_id);

-- Caminho quente: "quem ja recebeu nesta missao?", lido junto da lista de quem alcancou.
CREATE INDEX IF NOT EXISTS missao_recompensas_missao_idx
  ON app.missao_recompensas (empresa_id, missao_id);

COMMENT ON TABLE app.missao_recompensas IS
  'Baixa da recompensa da missao: o premio SAIU. APPEND-ONLY e sem desfazer, como app.venda_pagamentos. NAO e a conquista — alcancar o alvo continua DERIVADO de app.vendas (ver migration 085); esta tabela so responde "ja paguei?". Quem nao alcancou nao recebe baixa: a conquista e reconferida na transacao, porque depende de agregacao sobre vendas e nao cabe numa CHECK.';
COMMENT ON COLUMN app.missao_recompensas.valor_pago IS
  'O que REALMENTE saiu, nao o declarado na missao. NULL = premio nao-monetario. Divergencia com o valor da missao e proposital e fica auditavel.';
