-- 087_prospects_nicho_id.sql
-- Equipes por Nicho — PRE-REQUISITO: o lead passa a saber em que nicho esta, por ID.
--
-- ─── O QUE ESTA MIGRATION RESOLVE ──────────────────────────────────────────────────────
-- `app.nichos` existe desde a migration 038 (catalogo administravel por empresa, com
-- `uq_nichos_empresa_nome` case-insensitive) e `app.campanhas.nicho_id` ja o referencia. Mas
-- `prospectador.prospects` NAO tinha `nicho_id`: guardava `nicho` como TEXTO LIVRE, escrito com o
-- termo digitado na Aquisicao (`prospecting.js`, `normalizarTexto(ctx.nicho || pIn.nicho, 160)`) e
-- SOBRESCRITO a cada recoleta (`nicho = EXCLUDED.nicho`). O cabecalho da propria 038 declarava
-- que `nicho_id` nos leads seria "migracao futura" — o recorte obrigatorio por equipe a torna
-- pre-requisito, e esta e' essa fase.
--
-- ─── POR QUE ID, E NAO CASAR POR NOME (decisao D1, 2026-09-18) ─────────────────────────
-- "Energia Solar", "energia solar residencial" e "instalacao de energia solar" sao tres nichos
-- para o banco e o mesmo negocio para a pessoa. Um recorte OBRIGATORIO que casasse por nome
-- deixaria leads de fora EM SILENCIO — e o desfecho ruim nao e' o erro visivel, e' o vendedor
-- abrir o Banco de Leads e ver menos carteira do que tem, sem nada explicando por que.
--
-- ─── ADITIVA. NENHUM DADO E' MUTADO ────────────────────────────────────────────────────
-- Acrescenta uma coluna NULLABLE e SEM DEFAULT, um UNIQUE auxiliar e um indice. Nenhum UPDATE,
-- nenhum DELETE, nenhuma linha existente tocada. Idempotente: pode rodar 2x.
--
-- SEM DEFAULT de proposito: um DEFAULT autorizaria em silencio qualquer INSERT futuro que
-- esquecesse a coluna. Foi exatamente assim que "todo lead de toda empresa nascia marcado como
-- PJ" (migrations 005/006, que a 058 teve de desfazer, e cujos DEFAULTs a 078 removeu).
--
-- ─── `nicho` CONTINUA EXISTINDO, e nao vira lixo ───────────────────────────────────────
-- Ele permanece como o texto CRU que a coleta observou — mesma relacao de `site` x
-- `link_original` (056) e de `telefone` x `raw_json.telefone_origem`. A evidencia nao se perde
-- quando o veredito estruturado aparece; e' ela que permite auditar e refazer o vinculo.
--
-- ─── NULL NAO E' ERRO: E' "NINGUEM VINCULOU AINDA" ─────────────────────────────────────
-- Terceiro estado de primeira classe, como `qualificacao = legado`, `situacao_site =
-- nao_identificado` e a ausencia de linha em `contato_canal_disponibilidade`. O backfill deixa em
-- NULL todo lead cujo texto nao casar com o catalogo, e isso e' resultado legitimo — nunca um
-- palpite gravado.

-- 1) UNIQUE auxiliar em app.nichos, para a FK composta abaixo poder existir.
--    `id` ja e' PRIMARY KEY, entao este UNIQUE nao restringe NADA que ja nao fosse verdade: ele
--    so' da ao Postgres o alvo que uma FK de duas colunas exige.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nichos_id_empresa ON app.nichos (id, empresa_id);

-- 2) A coluna.
ALTER TABLE prospectador.prospects
  ADD COLUMN IF NOT EXISTS nicho_id UUID;

-- 3) FK COMPOSTA (nicho_id, empresa_id) -> app.nichos (id, empresa_id).
--
--    ⚠️ E' aqui que mora a garantia que uma FK simples NAO daria: com `REFERENCES app.nichos(id)`
--    seria possivel gravar num lead da empresa A o nicho da empresa B, e o recorte por equipe
--    passaria a atravessar tenant. Isolamento por empresa e' invariante deste repositorio
--    (migrations 058/060/061); ele tem de valer no BANCO, nao so' na camada de dados.
--
--    LIMITE DECLARADO: `prospects.empresa_id` e' NULLABLE (a 078 nao pos NOT NULL de proposito,
--    porque linhas antigas com NULL derrubariam o boot). Uma FK composta usa MATCH SIMPLE, entao
--    ela NAO valida quando `empresa_id` e' NULL. Na pratica isso so' alcanca lead orfao, que ja
--    esta fora de todo recorte por empresa — e o backfill nunca vincula lead sem empresa.
--
--    ON DELETE SET NULL (nicho_id): apagar um nicho do catalogo NUNCA pode apagar lead nem
--    apagar `empresa_id`. Em FK composta, `SET NULL` sem lista limparia as duas colunas; aqui o
--    lead so' volta a "ninguem vinculou ainda". Mesmo comportamento de `app.campanhas.nicho_id`
--    (039), mas preservando o tenant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospects_nicho_empresa_fk'
  ) THEN
    ALTER TABLE prospectador.prospects
      ADD CONSTRAINT prospects_nicho_empresa_fk
      FOREIGN KEY (nicho_id, empresa_id)
      REFERENCES app.nichos (id, empresa_id)
      ON DELETE SET NULL (nicho_id);
  END IF;
END $$;

-- 4) O indice do RECORTE que vem a seguir (equipe -> nicho -> leads daquele nicho).
--    Parcial: lead sem vinculo nao entra no recorte por nicho, entao nao precisa ocupar o indice.
CREATE INDEX IF NOT EXISTS idx_prospects_empresa_nicho
  ON prospectador.prospects (empresa_id, nicho_id)
  WHERE nicho_id IS NOT NULL;

COMMENT ON COLUMN prospectador.prospects.nicho_id IS
  'Nicho ESTRUTURADO do lead (app.nichos). NULL = ninguem vinculou ainda, que NAO e'' erro. O texto cru observado pela coleta continua em prospects.nicho. Preenchido por scripts/backfill-prospects-nicho.js; a recoleta NUNCA o sobrescreve.';
