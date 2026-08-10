-- 062_follow_ups.sql
-- Fluxo integrado de Follow-ups (Central de Ligacoes <-> Follow-ups <-> Central de Mensagens).
--
-- O QUE ESTA MIGRATION RESOLVE
-- Ate aqui NAO EXISTIA a entidade "Follow-up". A fila de /dashboard/follow-ups era derivada em
-- tempo de request de duas fontes que nao se conhecem: `montarCallList`
-- (services/followup-listing.js — recomendacao heuristica, nada persistido) e
-- `vendas.followup_auto_agendamentos` (a agenda do motor de IA). Nenhuma das duas tem CANAL,
-- RESPONSAVEL, ORIGEM ou STATUS que o operador possa mexer, entao "concluir", "reagendar" e
-- "cancelar" nao tinham onde ser gravados. Em paralelo, a proxima acao decidida ao encerrar
-- uma ligacao era gravada como TEXTO LIVRE em `app.campanha_leads.proxima_acao` +
-- `data_followup` (DATE, sem hora) — e nenhuma linha da Central de Follow-ups lia aquela
-- tabela, ou seja: a decisao tomada na ligacao era invisivel para a fila.
--
-- ADITIVA. Nao muta, nao apaga e nao move nenhum dado existente. `app.campanha_leads`
-- continua intacta e continua sendo escrita por `encerrarLigacao` (o acompanhamento da
-- campanha depende dela); o follow-up passa a ser gravado ALEM dela, nao no lugar dela.
--
-- IDENTIDADE DO CONTATO: `empresa_id` + `telefone_digitos`.
-- Os dois mundos ligados aqui tem chaves incompativeis — Ligacoes usa
-- `prospectador.prospects.id`, Mensagens usa `vendas.conversas.numero` (o JID), que e'
-- `UNIQUE` **GLOBAL** (sql/init.sql:6) e nao `UNIQUE (empresa_id, numero)`. Uma FK para a
-- conversa exigiria que ela ja existisse E ainda assim NAO provaria mesma empresa. Por isso a
-- coluna canonica e' o telefone em digitos e a conversa e' resolvida na LEITURA — o mesmo
-- casamento que followup-listing.js ja faz (`regexp_replace(…, '[^0-9]', '', 'g')`).
--
-- Enums travados por src/domain-enums.js + anti-drift em test/domain-enums.test.js.

CREATE TABLE IF NOT EXISTS app.follow_ups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- Por onde a acao vai ser executada. Decide QUAL tela executa (regra de roteamento).
  canal             TEXT NOT NULL,
  -- O verbo da fila. NOT NULL: fila de trabalho sem verbo nao diz o que fazer.
  proxima_acao      TEXT NOT NULL,
  -- TIMESTAMPTZ, nao DATE: o pedido exige data **e hora** ("retomar amanha as 10h"), que
  -- `campanha_leads.data_followup` nunca conseguiu guardar (a tela mandava type="date").
  agendado_para     TIMESTAMPTZ NOT NULL,
  prioridade        TEXT NOT NULL DEFAULT 'media',
  status            TEXT NOT NULL DEFAULT 'aguardando',
  -- Rastreabilidade obrigatoria: nao existe follow-up sem saber o que o gerou.
  origem            TEXT NOT NULL,

  -- Identidade canonica do contato (ver cabecalho).
  telefone_digitos  TEXT NOT NULL,

  -- Dono do trabalho. NULL = "nao atribuido" — estado legitimo e filtravel, nao ausencia de
  -- dado. Sem FK para app.usuarios pelo mesmo motivo de vendas.followup_ligacoes.usuario_id:
  -- nao acoplar o ciclo de vida do registro ao da conta que o criou.
  responsavel_id    UUID,
  criado_por        UUID,

  -- Contexto de origem. TODOS opcionais e TODOS ON DELETE SET NULL: apagar a campanha nao
  -- pode apagar a proxima acao combinada com um cliente real. A verificacao same-tenant
  -- destas FKs e reforcada na camada de dados (src/db/follow-ups.js), como no resto do modulo.
  ligacao_id        UUID REFERENCES app.ligacoes(id) ON DELETE SET NULL,
  campanha_lead_id  UUID REFERENCES app.campanha_leads(id) ON DELETE SET NULL,
  prospect_id       UUID REFERENCES prospectador.prospects(id) ON DELETE SET NULL,
  -- JID da conversa QUANDO ela ja existia no momento da criacao. E cache de conveniencia,
  -- nunca a identidade: a autoridade e' `telefone_digitos` (ver cabecalho).
  conversa_numero   TEXT,

  observacao        TEXT,
  -- Fechamento: o que aconteceu, quando, e por quem.
  resultado_nota    TEXT,
  concluido_em      TIMESTAMPTZ,
  concluido_por     UUID,

  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT follow_ups_canal_chk      CHECK (canal      IN ('whatsapp', 'ligacao')),
  CONSTRAINT follow_ups_status_chk     CHECK (status     IN ('aguardando', 'concluido', 'cancelado', 'falha')),
  CONSTRAINT follow_ups_prioridade_chk CHECK (prioridade IN ('alta', 'media', 'baixa')),
  CONSTRAINT follow_ups_origem_chk     CHECK (origem     IN ('ligacao', 'mensagem', 'automacao', 'manual')),
  -- O telefone e' a identidade: um valor mal formado aqui produziria um item que nunca casa
  -- com conversa nenhuma e ficaria orfao na fila para sempre.
  CONSTRAINT follow_ups_telefone_chk   CHECK (telefone_digitos ~ '^[0-9]{8,15}$'),
  -- Estado terminal 'concluido' sem data de conclusao seria um fato sem quando.
  CONSTRAINT follow_ups_conclusao_chk  CHECK (status <> 'concluido' OR concluido_em IS NOT NULL)
);

-- ANTIDUPLICIDADE, garantida no BANCO e nao na aplicacao.
-- Regra de negocio explicita: um contato tem NO MAXIMO UMA proxima acao em aberto POR CANAL.
-- Duas acoes de WhatsApp aguardando para o mesmo contato nao sao duas tarefas, sao a mesma
-- tarefa duas vezes — e foi isso que o pedido proibiu ("nao duplicar Follow-ups equivalentes
-- para o mesmo contato e mesma proxima acao"). Por canal, e nao por contato, porque "ligar na
-- sexta" e "mandar mensagem amanha" sao trabalhos diferentes, feitos em telas diferentes.
-- PARCIAL (so entre as abertas): o historico de acoes ja concluidas cresce sem limite, como deve.
CREATE UNIQUE INDEX IF NOT EXISTS follow_ups_um_aberto_por_canal_uk
  ON app.follow_ups (empresa_id, telefone_digitos, canal)
  WHERE status = 'aguardando';

-- Fila: o que esta em aberto, na ordem do prazo. E a leitura quente da tela.
CREATE INDEX IF NOT EXISTS idx_follow_ups_fila
  ON app.follow_ups (empresa_id, status, agendado_para);

-- Linha do tempo por contato (historico unificado) e resolucao da conversa na leitura.
CREATE INDEX IF NOT EXISTS idx_follow_ups_contato
  ON app.follow_ups (empresa_id, telefone_digitos, criado_em DESC);

-- "Meus follow-ups" / filtro por responsavel.
CREATE INDEX IF NOT EXISTS idx_follow_ups_responsavel
  ON app.follow_ups (empresa_id, responsavel_id, status)
  WHERE responsavel_id IS NOT NULL;

-- Resumo da proxima acao dentro da tela de Ligacoes (a ligacao mostra so o resumo + link).
CREATE INDEX IF NOT EXISTS idx_follow_ups_ligacao
  ON app.follow_ups (ligacao_id)
  WHERE ligacao_id IS NOT NULL;

COMMENT ON TABLE app.follow_ups IS
  'Proxima acao concreta de um contato (canal, prazo, prioridade, responsavel, status, origem). Identidade do contato = (empresa_id, telefone_digitos); a conversa de WhatsApp e resolvida na leitura, nunca por FK — vendas.conversas.numero e UNIQUE GLOBAL e nao prova empresa.';

COMMENT ON COLUMN app.follow_ups.conversa_numero IS
  'Cache do JID quando a conversa ja existia na criacao. Conveniencia de leitura; a identidade e telefone_digitos.';
