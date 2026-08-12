-- 066_contato_canal_disponibilidade.sql
-- DISPONIBILIDADE DE CANAL POR CONTATO — dado central, HUMANO-CURADO.
--
-- O QUE ESTA MIGRATION RESOLVE
-- Um follow-up podia continuar marcado como "WhatsApp" depois de o operador ja saber que
-- aquele contato NAO tem WhatsApp (caso observado em producao: Elite Auto Renovadora). Nao
-- havia onde gravar esse conhecimento: a fila reagenda prazo/prioridade/texto e o canal
-- ficava congelado no que a ligacao tinha sugerido.
--
-- POR QUE UMA TABELA NOVA, E NAO `prospectador.prospects.tem_whatsapp`
--   1. Aquela coluna e escrita AUTOMATICAMENTE. `rodar-leads.js` chama
--      `marcarDisparoFalhou(..., semWhatsapp=true)` quando o Evolution responde
--      `exists:false`, ou seja: uma FALHA TECNICA vira, sozinha, um veredito sobre o
--      contato. A regra de negocio deste modulo e o oposto — quem marca e uma PESSOA.
--      Guardar as duas coisas na mesma coluna tornaria impossivel distinguir "o operador
--      verificou" de "o provider errou uma vez".
--   2. Aquela coluna e por PROSPECT. Follow-up nao tem prospect obrigatorio (`prospect_id` e
--      nullable): um follow-up nascido de mensagem ou criado a mao nao tem cadastro nenhum.
--      A identidade do contato neste fluxo e `(empresa_id, telefone_digitos)`, a mesma da
--      migration 062 — e e por ela que esta tabela e chaveada.
-- `prospects.tem_whatsapp` CONTINUA existindo e continua governando a elegibilidade do Banco
-- de Leads. Ela nao foi tocada, nao foi lida por este modulo e nao vira fonte de verdade aqui.
--
-- ADITIVA. Nao muta, nao apaga e nao move nenhum dado existente. Nenhum contato nasce com
-- linha aqui: AUSENCIA DE LINHA = "ninguem verificou", que e diferente de "tem" e de "nao
-- tem". Sem linha, o comportamento e exatamente o de antes desta migration.
--
-- Enums travados por src/services/contato-canal-disponibilidade.js (modulo PURO, dono do
-- vocabulario) + anti-drift em test/domain-enums.test.js e test/contato-canal-disponibilidade.test.js.

CREATE TABLE IF NOT EXISTS app.contato_canal_disponibilidade (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,

  -- Identidade do contato, identica a de app.follow_ups (ver cabecalho da migration 062).
  -- Sem FK para vendas.conversas: aquele `numero` e UNIQUE **GLOBAL** e nao prova empresa.
  telefone_digitos  TEXT NOT NULL,

  -- Canal cuja disponibilidade foi verificada. Fechado em 'whatsapp' DE PROPOSITO:
  --   - 'ligacao' nao entra porque o telefone E a identidade — a disponibilidade seria
  --     sempre verdadeira e a linha nao diria nada;
  --   - 'email' nao entra porque NAO EXISTE canal de e-mail no follow-up (a CHECK
  --     follow_ups_canal_chk da migration 062 e fechada em whatsapp|ligacao). Criar o valor
  --     aqui prometeria um roteamento que nenhum codigo sabe executar. Quando o canal de
  --     e-mail nascer, ele acrescenta o valor nas DUAS CHECKs, numa migration propria.
  canal             TEXT NOT NULL,

  -- O veredito. NOT NULL: esta tabela so guarda decisao tomada. "Nao sei" e a AUSENCIA de
  -- linha, nunca um NULL aqui — um NULL faria "verificado e inconclusivo" ficar igual a
  -- "ninguem olhou", que sao estados operacionais diferentes.
  disponivel        BOOLEAN NOT NULL,

  -- Nota curta do operador ("numero so de telefone fixo", "cliente confirmou por e-mail").
  -- Texto livre, opcional, nunca interpretado por codigo.
  motivo            TEXT,

  -- COMO essa marcacao chegou aqui. NOT NULL e **SEM DEFAULT**, pelo mesmo motivo de
  -- `empresa_whatsapp_instances.origem_vinculo` (migration 061): um DEFAULT autorizaria em
  -- silencio qualquer INSERT futuro que esquecesse a coluna. A CHECK e fechada num unico
  -- valor — 'operador' — e isso e a garantia, no BANCO, de que nenhum caminho automatico
  -- (falha de envio, timeout do provider, instabilidade do Evolution) consegue escrever
  -- aqui sem antes alterar o schema e quebrar o teste de anti-drift.
  origem            TEXT NOT NULL,

  -- Quem marcou. Sem FK para app.usuarios, como em app.follow_ups.responsavel_id: nao
  -- acoplar o ciclo de vida do fato ao da conta que o registrou.
  marcado_por       UUID,
  marcado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contato_canal_disp_canal_chk    CHECK (canal  IN ('whatsapp')),
  CONSTRAINT contato_canal_disp_origem_chk   CHECK (origem IN ('operador')),
  CONSTRAINT contato_canal_disp_telefone_chk CHECK (telefone_digitos ~ '^[0-9]{8,15}$')
);

-- Um veredito por contato e canal, dentro da empresa. O upsert grava a decisao MAIS RECENTE
-- (quem acabou de falar com o cliente sabe mais que a marcacao anterior) — e e o que permite
-- DESFAZER: marcar "Tem WhatsApp" reescreve a mesma linha para `disponivel = true`, em vez de
-- empilhar um segundo veredito que contradiz o primeiro.
CREATE UNIQUE INDEX IF NOT EXISTS contato_canal_disp_uk
  ON app.contato_canal_disponibilidade (empresa_id, telefone_digitos, canal);

-- Leitura quente: a fila de follow-ups resolve a disponibilidade de uma pagina inteira de
-- contatos de uma vez, pelo mesmo par que o indice unico ja cobre.
CREATE INDEX IF NOT EXISTS idx_contato_canal_disp_indisponivel
  ON app.contato_canal_disponibilidade (empresa_id, canal)
  WHERE disponivel = false;

COMMENT ON TABLE app.contato_canal_disponibilidade IS
  'Disponibilidade de canal por contato (empresa_id + telefone_digitos), marcada por PESSOA. Ausencia de linha = ninguem verificou. Nenhum caminho automatico pode escrever aqui: a CHECK de origem e fechada em operador.';

COMMENT ON COLUMN app.contato_canal_disponibilidade.origem IS
  'Fechado em operador, sem DEFAULT: falha de envio, provider ou instabilidade externa NAO marcam disponibilidade.';

COMMENT ON COLUMN app.contato_canal_disponibilidade.disponivel IS
  'Veredito humano. "Nao sei" e a ausencia da linha, nunca NULL aqui.';
