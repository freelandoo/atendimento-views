-- 095_plano_dia.sql
-- QUADRO DO DIA — o planejamento diário do comercial, dentro do Banco de Leads.
--
-- O QUE ESTA MIGRATION RESOLVE
-- Nao existia, no schema, a nocao de "o que eu pretendo trabalhar HOJE". O operador tinha a
-- carteira (`prospectador.prospects`, ordenada pela fila de trabalho) e os compromissos
-- (`app.follow_ups`), e nada entre os dois: a escolha do dia vivia na cabeca dele, morria ao
-- fechar a aba e nao sobrevivia a troca de aparelho.
--
-- POR QUE UMA TABELA PROPRIA, e nao `app.follow_ups` (migration 062).
-- Aquela tabela e' COMPROMISSO COM UM CONTATO: canal + prazo + telefone, e alimenta a fila
-- oficial da Central de Follow-ups. Despejar ali cada lead que alguem arrasta para o quadro
-- encheria a fila de trabalho de TODA a equipe com planejamento pessoal — e exigiria alargar
-- `follow_ups_canal_chk` para um valor ("planejamento") que nenhuma tela sabe EXECUTAR, que e'
-- exatamente o defeito descrito na Decisao 4 de 2026-08-12. As duas convivem: quando um card
-- vira compromisso de verdade, o follow-up e' criado pelo fluxo OFICIAL e o card guarda so' o
-- `follow_up_id` (ver `plano_dia_itens.follow_up_id`).
--
-- POR QUE NAO UM JSONB EM `app.usuarios_empresas`
-- Sem unicidade (dois arrastes simultaneos se sobrescrevem), sem ordem por item, sem historico
-- e sem como consultar "quantos itens o vendedor fechou ontem".
--
-- ADITIVA. Cria UMA tabela; nao altera tabela existente, nao apaga e nao muta nenhum dado.
-- Rollback: DROP TABLE app.plano_dia_itens — nada mais referencia esta tabela.
--
-- IDENTIDADE: empresa + usuario + dia + prospect.
-- O plano e' PESSOAL. `usuario_id` sem FK, pelo mesmo motivo de `follow_ups.responsavel_id`:
-- nao acoplar o ciclo de vida do registro ao da conta que o criou. `prospect_id` TEM FK com
-- CASCADE porque um item de planejamento sobre um lead que nao existe mais e' lixo — ao
-- contrario de um follow-up, que e' compromisso com uma pessoa real.
--
-- ⚠️ `etapa` E' O ESTADO DO DIA, NAO O CICLO COMERCIAL. Ele nao substitui, nao deriva e nao
-- escreve `prospects.status`, `prospects.qualificacao`, `prospects.responsavel_id` nem
-- `icp_*`. Mover um card e' planejamento; mudar o funil continua sendo ato proprio, pelos
-- fluxos que ja existem. Regras puras em src/services/plano-dia.js.

CREATE TABLE IF NOT EXISTS app.plano_dia_itens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- De QUEM e' o plano. Sem FK (ver cabecalho).
  usuario_id    UUID NOT NULL,

  -- O dia operacional, resolvido no BACKEND em APP_TIMEZONE (America/Sao_Paulo por padrao).
  -- DATE e nao TIMESTAMPTZ: "o meu dia 22" nao muda de nome conforme o fuso de quem consulta.
  dia           DATE NOT NULL,

  prospect_id   UUID NOT NULL REFERENCES prospectador.prospects(id) ON DELETE CASCADE,

  -- Etapa DO DIA. CHECK fechada; vocabulario em src/services/plano-dia.js (anti-drift no teste).
  etapa         TEXT NOT NULL DEFAULT 'para_hoje',
  -- Posicao dentro da coluna. Inteiro esparso: reordenar nao precisa reescrever a coluna toda.
  ordem         INTEGER NOT NULL DEFAULT 0,

  -- O que se pretende fazer com este lead hoje. Texto livre e curto — e' anotacao do operador,
  -- nao taxonomia: inventar uma lista fechada aqui produziria opcoes que ninguem escolhe.
  objetivo      TEXT,

  -- Como o lead entrou no dia. CHECK fechada: "eu escolhi" e "o sistema sugeriu" sao fatos
  -- diferentes, e sem distingui-los nao ha como medir se a sugestao ajuda.
  -- SEM DEFAULT, de proposito: um DEFAULT autorizaria em silencio qualquer INSERT futuro que
  -- esquecesse a coluna (o mesmo motivo de `origem_vinculo`, migration 061).
  origem_entrada TEXT NOT NULL,

  -- O compromisso OFICIAL criado a partir deste card, quando houve um. ON DELETE SET NULL:
  -- apagar o follow-up nao pode apagar o planejamento do dia.
  follow_up_id  UUID REFERENCES app.follow_ups(id) ON DELETE SET NULL,

  -- Fechamento do card. `conclusao_tipo` distingue o que o SISTEMA viu do que uma PESSOA
  -- declarou — a mesma disciplina de `confirmado_por` na abordagem manual (migration 073):
  -- somar autodeclaracao com evidencia produziria um numero que nao se sustenta.
  conclusao_tipo TEXT,
  conclusao_nota TEXT,
  concluido_em   TIMESTAMPTZ,

  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT plano_dia_etapa_chk  CHECK (etapa IN ('para_hoje', 'em_trabalho', 'aguardando_retorno', 'feito')),
  CONSTRAINT plano_dia_origem_chk CHECK (origem_entrada IN ('escolha_manual', 'sugestao_vencidos', 'sugestao_agenda')),
  CONSTRAINT plano_dia_conclusao_tipo_chk CHECK (conclusao_tipo IS NULL OR conclusao_tipo IN ('atividade_registrada', 'autodeclarada')),
  -- Card em "feito" sem QUANDO e sem DE QUE FORMA seria um fato sem prova. E o inverso tambem
  -- nao pode existir: conclusao gravada num card que voltou para outra coluna faria a coluna
  -- "Feito hoje" e a contagem do dia discordarem.
  CONSTRAINT plano_dia_feito_chk CHECK (
    (etapa = 'feito' AND concluido_em IS NOT NULL AND conclusao_tipo IS NOT NULL)
    OR (etapa <> 'feito' AND concluido_em IS NULL AND conclusao_tipo IS NULL)
  ),
  -- Autodeclaracao EXIGE a nota: e' a unica coisa que sobra quando nao ha evidencia.
  CONSTRAINT plano_dia_autodeclarada_chk CHECK (
    conclusao_tipo IS DISTINCT FROM 'autodeclarada' OR NULLIF(BTRIM(conclusao_nota), '') IS NOT NULL
  )
);

-- ANTIDUPLICIDADE NO BANCO, nao na aplicacao: arrastar duas vezes, um retry ou duas abas
-- abertas nao podem produzir dois cards do mesmo lead no mesmo dia da mesma pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS plano_dia_um_por_lead_no_dia_uk
  ON app.plano_dia_itens (empresa_id, usuario_id, dia, prospect_id);

-- A leitura quente: o quadro de uma pessoa num dia, ja na ordem das colunas.
CREATE INDEX IF NOT EXISTS idx_plano_dia_quadro
  ON app.plano_dia_itens (empresa_id, usuario_id, dia, etapa, ordem);

-- Pendencias a replanejar: o que ficou em aberto em dias anteriores.
CREATE INDEX IF NOT EXISTS idx_plano_dia_pendentes
  ON app.plano_dia_itens (empresa_id, usuario_id, dia)
  WHERE etapa <> 'feito';
