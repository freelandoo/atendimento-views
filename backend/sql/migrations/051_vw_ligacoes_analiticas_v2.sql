-- 051_vw_ligacoes_analiticas_v2.sql
-- Centro de Ligacoes — Validacao Operacional (bloqueador: a view entregava contagem, nao o "porque").
--
-- A v1 (migration 046) so trazia AGREGADOS numericos. As duas perguntas mais obvias de um
-- gestor comercial — "quais objecoes mais aparecem?" e "como cada vendedor esta indo?" —
-- exigiam join manual FORA da view, furando justamente a centralizacao que a Fatia G criou.
-- Esta versao completa a view para que o futuro Painel de Gestao Comercial leia SO daqui.
--
-- CREATE OR REPLACE exige manter as colunas existentes com mesmo nome, tipo e ordem; todas
-- as novas entram NO FIM. A regra central (`status = 'encerrada'`) continua vivendo aqui e
-- em nenhum outro lugar.
--
-- Novas colunas:
--   chamada_encerrada_em    instante real do fim da chamada (migration 049)
--   duracao_registro_seg    tempo gasto PREENCHENDO o resumo (atrito de UX, mensuravel)
--   usuario_nome            vendedor legivel (antes so usuario_id)
--   campanha_nome           recorte por campanha sem join extra
--   objecoes_texto          quais objecoes apareceram (nao so quantas)
--   sinais_interesse_texto  quais sinais de interesse apareceram
--   sinais_resistencia_texto  idem, resistencia
-- Arrays vem como ARRAY[] vazio (nunca NULL) para nao exigir COALESCE no consumidor.

CREATE OR REPLACE VIEW app.vw_ligacoes_analiticas AS
SELECT
  l.id                     AS ligacao_id,
  l.empresa_id,
  l.campanha_id,
  l.campanha_lead_id,
  l.prospect_id,
  l.usuario_id,
  l.roteiro_versao_id,
  l.iniciada_em,
  l.encerrada_em,
  l.duracao_seg,
  l.resultado,
  l.etapa_alcancada,
  l.etapa_maior_interesse,
  l.etapa_perda_interesse,
  l.objecao_principal,
  l.motivo_perda,
  -- Etapas temporais (Fatia B) — fonte oficial de duracao por etapa
  (SELECT COUNT(*)::int FROM app.ligacao_etapas e WHERE e.ligacao_id = l.id) AS qtd_ocorrencias_etapa,
  (SELECT COALESCE(SUM(e.duracao_seg), 0)::int FROM app.ligacao_etapas e WHERE e.ligacao_id = l.id) AS tempo_total_etapas_seg,
  (SELECT e.tipo_etapa FROM app.ligacao_etapas e WHERE e.ligacao_id = l.id ORDER BY e.entrou_em DESC LIMIT 1) AS etapa_final,
  -- Sinais (Fatia D) — ativos. Fonte UNICA de interesse/resistencia apos a unificacao das marcas.
  (SELECT COUNT(*)::int FROM app.ligacao_sinais s WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'interesse')   AS qtd_sinais_interesse,
  (SELECT COUNT(*)::int FROM app.ligacao_sinais s WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'resistencia') AS qtd_sinais_resistencia,
  -- Objecoes (Fatia E) — ativas
  (SELECT COUNT(*)::int FROM app.ligacao_objecoes o WHERE o.ligacao_id = l.id AND o.removida_em IS NULL) AS qtd_objecoes,
  (SELECT COUNT(*)::int FROM app.ligacao_objecoes o WHERE o.ligacao_id = l.id AND o.removida_em IS NULL AND o.resolvida) AS qtd_objecoes_resolvidas,
  -- Perguntas (Fatia C) — marcadas
  (SELECT COUNT(*)::int FROM app.ligacao_perguntas p WHERE p.ligacao_id = l.id AND p.status = 'realizada') AS qtd_perguntas,
  -- ---- v2: colunas novas (sempre no fim, exigencia do CREATE OR REPLACE) ----
  l.chamada_encerrada_em,
  CASE
    WHEN l.chamada_encerrada_em IS NOT NULL AND l.encerrada_em IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (l.encerrada_em - l.chamada_encerrada_em)))::int
  END                      AS duracao_registro_seg,
  u.nome                   AS usuario_nome,
  c.nome                   AS campanha_nome,
  COALESCE((SELECT ARRAY_AGG(o.texto_objecao ORDER BY o.registrada_em)
              FROM app.ligacao_objecoes o
             WHERE o.ligacao_id = l.id AND o.removida_em IS NULL), ARRAY[]::TEXT[]) AS objecoes_texto,
  COALESCE((SELECT ARRAY_AGG(s.texto ORDER BY s.registrado_em)
              FROM app.ligacao_sinais s
             WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'interesse'), ARRAY[]::TEXT[]) AS sinais_interesse_texto,
  COALESCE((SELECT ARRAY_AGG(s.texto ORDER BY s.registrado_em)
              FROM app.ligacao_sinais s
             WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'resistencia'), ARRAY[]::TEXT[]) AS sinais_resistencia_texto
FROM app.ligacoes l
LEFT JOIN app.usuarios  u ON u.id = l.usuario_id
LEFT JOIN app.campanhas c ON c.id = l.campanha_id
WHERE l.status = 'encerrada';   -- REGRA CENTRAL (unico lugar): so encerradas na analitica
