-- 050_ligacoes_expurgo_legado.sql
-- Centro de Ligacoes — Validacao Operacional (bloqueador: caminho legado polui a analitica).
--
-- O caminho legado `POST /api/empresas/:id/ligacoes` (db: ligacoes.registrarLigacao) gravava
-- status='encerrada' DIRETO, com `duracao_seg` VINDA DO CLIENTE e sem nenhuma ocorrencia
-- temporal de etapa. Essas linhas entram em app.vw_ligacoes_analiticas com duracao_seg NULL
-- e qtd_ocorrencias_etapa = 0 — contaminando qualquer media do futuro Painel de Gestao
-- Comercial. A rota e a funcao foram REMOVIDAS nesta mesma entrega; esta migration limpa o
-- passivo que elas deixaram.
--
-- Discriminante: encerrada COM `duracao_seg IS NULL` E SEM nenhuma ocorrencia em
-- app.ligacao_etapas. Os dois criterios juntos, nunca isolados:
--   * `duracao_seg IS NULL` sozinho ja identifica o legado (encerrarLigacao SEMPRE calcula
--     um int no servidor; so o caminho legado deixava NULL, por depender do cliente), mas
--   * `0 etapas` sozinho apagaria ligacoes LEGITIMAS de campanha sem roteiro publicado —
--     nesse caso nenhuma ocorrencia de etapa e' aberta, e a ligacao e' real.
-- (`iniciada_em IS NULL` NAO serve como discriminante: a coluna tem default e as linhas
--  legadas tambem a preencheram.)
--
-- ARQUIVA ANTES DE APAGAR. runMigrations roda no BOOT (src/db/migrations.js), entao este
-- expurgo executa sozinho em producao no proximo deploy, sem operador olhando. As linhas
-- ficam recuperaveis em app.ligacoes_legado_arquivo.
-- ATENCAO: os filhos (ligacao_etapa_eventos/sinais/objecoes/perguntas/etapas) tem
-- ON DELETE CASCADE e vao junto — por definicao, registros legados nao tinham etapas.

CREATE TABLE IF NOT EXISTS app.ligacoes_legado_arquivo (LIKE app.ligacoes);
ALTER TABLE app.ligacoes_legado_arquivo
  ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON TABLE app.ligacoes_legado_arquivo IS
  'Backup das ligacoes gravadas pelo caminho legado (encerrada sem iniciada_em), expurgadas de app.ligacoes pela migration 050. Fora da analitica; existe so para auditoria/recuperacao.';

INSERT INTO app.ligacoes_legado_arquivo
SELECT l.*, NOW()
  FROM app.ligacoes l
 WHERE l.status = 'encerrada'
   AND l.duracao_seg IS NULL
   AND NOT EXISTS (SELECT 1 FROM app.ligacao_etapas e WHERE e.ligacao_id = l.id);

DELETE FROM app.ligacoes l
 WHERE l.status = 'encerrada'
   AND l.duracao_seg IS NULL
   AND NOT EXISTS (SELECT 1 FROM app.ligacao_etapas e WHERE e.ligacao_id = l.id);
