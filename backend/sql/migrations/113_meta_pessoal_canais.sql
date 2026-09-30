-- 113_meta_pessoal_canais.sql
-- META PESSOAL por CANAL: a meta deixa de medir cards "Feito" e passa a medir CONTATOS REAIS.
--
-- O QUE MUDA
-- A migration 111 guardava so um alvo semanal (medido pelos cards em "feito" do Quadro do Dia).
-- O operador quer medir tambem LIGACAO, em dois modos:
--   geral    — um alvo so (mensagem + ligacao contam juntas). `alvo_semanal` continua sendo esse total.
--   separado — alvo de ligacao E alvo de mensagem; `alvo_semanal` passa a ser a SOMA dos dois
--              (mantido preenchido para a CHECK > 0 da 111 seguir valendo e significar "total").
-- A contagem do progresso agora vem de eventos reais (app.ligacoes status='encerrada' e
-- prospectador.lead_disparos status='enviado', por empresa+usuario) — nao ha SQL de contagem aqui.
--
-- ADITIVA. So acrescenta colunas e CHECKs; nao apaga, nao move e nao muta dado. Linhas ja
-- existentes ficam `modo='geral'` (o default) com `alvo_ligacoes/mensagens` NULL — seguem validas
-- e passam a ser medidas como contatos reais, com o MESMO alvo_semanal que a pessoa ja tinha.
-- Rollback: DROP as duas CHECKs e as tres colunas.

ALTER TABLE app.meta_pessoal
  ADD COLUMN IF NOT EXISTS modo           TEXT    NOT NULL DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS alvo_ligacoes  INTEGER,
  ADD COLUMN IF NOT EXISTS alvo_mensagens INTEGER;

ALTER TABLE app.meta_pessoal
  ADD CONSTRAINT meta_pessoal_modo_chk CHECK (modo IN ('geral', 'separado'));

-- No modo separado os dois alvos por canal existem e sao > 0; no geral, ficam ausentes.
ALTER TABLE app.meta_pessoal
  ADD CONSTRAINT meta_pessoal_separado_chk CHECK (
    (modo = 'geral'    AND alvo_ligacoes IS NULL AND alvo_mensagens IS NULL)
    OR
    (modo = 'separado' AND alvo_ligacoes > 0 AND alvo_mensagens > 0)
  );
