-- 084_programa_aceite.sql
-- Operacao Comercial — Etapa 1 (Base do Programa e Aceite).
--
-- O QUE ESTA MIGRATION RESOLVE
-- Nao existia registro de que uma pessoa ENTROU no programa comercial. O login era criado pelo
-- dono (Etapa 2 do CRM em equipe, `app.usuarios_empresas`) e a pessoa caia direto na operacao —
-- sem termo, sem confirmacao de maioridade e sem nenhum rastro de quando e sob QUAL texto ela
-- concordou com as regras. Este arquivo cria a evidencia; o bloqueio vive na camada de
-- autorizacao (`src/middleware/tenant.js`).
--
-- ADITIVA: cria UMA tabela nova. Nenhuma tabela existente e' alterada, nenhum dado e' mutado,
-- nenhum DEFAULT novo em coluna alheia. Idempotente: pode rodar 2x.
--
-- ⚠️ CONSEQUENCIA DECLARADA E ACEITA: no primeiro boot depois deste deploy, TODA pessoa com
-- vinculo `comercial` ou `member` fica parada na tela de aceite ate assinar. Nao ha backfill, e
-- nao deve haver: um aceite inserido por migration seria o sistema afirmando que alguem leu um
-- texto que nunca viu — exatamente o tipo de dado sujo que `legado`/`origem_vinculo` (061) e
-- `qualificacao` (071) existem para nao produzir. `owner` e `admin` nao sao sujeitos do programa
-- e nao sao afetados.
--
-- POR QUE APPEND-ONLY, E NAO UMA COLUNA `aceitou_em` EM `usuarios_empresas`
-- O aceite e' um FATO datado sobre um TEXTO. Uma coluna guardaria so' o ultimo estado e seria
-- sobrescrita quando o termo mudasse de versao — apagando a prova de que a pessoa aceitou a v1
-- em setembro. Mesma disciplina de `app.lead_responsavel_historico` (072) e de
-- `prospectador.lead_icp_avaliacoes` (079): o historico e' a entidade, o "atual" e' derivado.
--
-- POR QUE A VERSAO E O HASH DO TEXTO, E NAO SO' A DATA
-- O texto do termo vive VERSIONADO no fonte (`src/services/programa-termo.js`). Guardar apenas a
-- data faria "editar o arquivo amanha" reescrever, de fato, o que a pessoa aceitou ontem. A
-- versao diz QUAL termo; o hash PROVA que o texto daquela versao nao mudou depois. Mesmo
-- raciocinio do percentual congelado na linha do credito de comissao (083): o que ja foi aceito
-- e' fato, nao calculo.

CREATE TABLE IF NOT EXISTS app.programa_aceites (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL REFERENCES app.empresas(id) ON DELETE CASCADE,
  usuario_id            UUID NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,

  -- Lista FECHADA. Um programa novo (ex.: um plano de parceiros) e' UM valor nesta CHECK e uma
  -- entrada no vocabulario de `src/services/programa-aceite.js` — nunca um texto livre, que
  -- deixaria o gate comparando string digitada.
  programa              TEXT NOT NULL,

  -- QUAL termo foi aceito. Sem DEFAULT de proposito: um DEFAULT autorizaria em silencio um
  -- INSERT futuro que esquecesse a coluna, e o registro passaria a afirmar uma versao que
  -- ninguem escolheu. Mesmo motivo de `origem_vinculo` (061) e das colunas da 080.
  termo_versao          TEXT NOT NULL,
  termo_hash            TEXT NOT NULL,

  -- As duas confirmacoes sao COLUNAS, nao um booleano so'. Sao duas declaracoes distintas da
  -- pessoa (idade e leitura das regras) e a tela pede as duas separadas; guardar uma so' faria o
  -- registro dizer menos do que foi perguntado.
  maioridade_confirmada BOOLEAN NOT NULL,
  regras_confirmadas    BOOLEAN NOT NULL,

  aceito_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- O vocabulario vive em src/services/programa-aceite.js (PROGRAMA). Ha teste anti-drift
-- (test/programa-aceite.test.js) que le esta migration e falha se os dois divergirem.
ALTER TABLE app.programa_aceites
  DROP CONSTRAINT IF EXISTS programa_aceites_programa_chk;
ALTER TABLE app.programa_aceites
  ADD CONSTRAINT programa_aceites_programa_chk
  CHECK (programa IN ('operacao_comercial'));

-- NAO EXISTE ACEITE PARCIAL, e a garantia e' do BANCO. Uma linha com `regras_confirmadas = false`
-- seria um "aceite" que ninguem deu; se um caminho futuro esquecer a validacao da rota, o INSERT
-- falha em vez de gravar consentimento que nao houve.
ALTER TABLE app.programa_aceites
  DROP CONSTRAINT IF EXISTS programa_aceites_confirmacoes_chk;
ALTER TABLE app.programa_aceites
  ADD CONSTRAINT programa_aceites_confirmacoes_chk
  CHECK (maioridade_confirmada = true AND regras_confirmadas = true);

-- Idempotencia por (empresa, pessoa, programa, VERSAO): reenviar o formulario ou dar dois cliques
-- nao cria duas linhas, e uma VERSAO NOVA do termo gera linha nova — que e' como o aceite volta a
-- ser exigido quando o texto muda de verdade.
CREATE UNIQUE INDEX IF NOT EXISTS programa_aceites_pessoa_versao_uk
  ON app.programa_aceites (empresa_id, usuario_id, programa, termo_versao);

-- Caminho quente: "qual o aceite mais recente desta pessoa nesta empresa?" — lido a cada request
-- com escopo de empresa, junto do vinculo.
CREATE INDEX IF NOT EXISTS idx_programa_aceites_pessoa
  ON app.programa_aceites (empresa_id, usuario_id, programa, aceito_em DESC);

COMMENT ON TABLE app.programa_aceites IS
  'Aceite do termo de um programa (Operacao Comercial). APPEND-ONLY: uma linha por versao aceita. A versao e o hash dizem QUAL texto foi aceito — editar o termo no fonte nao reescreve o que ja foi aceito. Sem backfill de proposito: aceite inserido por migration seria afirmar que alguem leu um texto que nunca viu.';
COMMENT ON COLUMN app.programa_aceites.termo_hash IS
  'SHA-256 do texto da versao aceita (src/services/programa-termo.js). Prova que o texto daquela versao nao mudou depois do aceite.';
