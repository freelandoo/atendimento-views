-- 046_vw_ligacoes_analiticas.sql
-- Centro de Ligacoes — Fatia G: FONTE OFICIAL da analitica de ligacoes.
-- A "regra central" (SOMENTE ligacoes encerradas alimentam metricas/dashboards/IA) fica
-- num UNICO lugar: esta view. Dashboards e IA futuros DEVEM ler daqui (filtrando empresa_id)
-- em vez de reimplementar `status = 'encerrada'` espalhado. Consolida os agregados por
-- ligacao vindos das estruturas das Fatias B/C/D/E (etapas, perguntas, sinais, objecoes).
-- Aditiva; nao altera dados. Sinais/objecoes contam apenas os ATIVOS (nao removidos);
-- perguntas contam as 'realizada'.

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
  -- Sinais (Fatia D) — ativos
  (SELECT COUNT(*)::int FROM app.ligacao_sinais s WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'interesse')   AS qtd_sinais_interesse,
  (SELECT COUNT(*)::int FROM app.ligacao_sinais s WHERE s.ligacao_id = l.id AND s.removido_em IS NULL AND s.tipo = 'resistencia') AS qtd_sinais_resistencia,
  -- Objecoes (Fatia E) — ativas
  (SELECT COUNT(*)::int FROM app.ligacao_objecoes o WHERE o.ligacao_id = l.id AND o.removida_em IS NULL) AS qtd_objecoes,
  (SELECT COUNT(*)::int FROM app.ligacao_objecoes o WHERE o.ligacao_id = l.id AND o.removida_em IS NULL AND o.resolvida) AS qtd_objecoes_resolvidas,
  -- Perguntas (Fatia C) — marcadas
  (SELECT COUNT(*)::int FROM app.ligacao_perguntas p WHERE p.ligacao_id = l.id AND p.status = 'realizada') AS qtd_perguntas
FROM app.ligacoes l
WHERE l.status = 'encerrada';   -- REGRA CENTRAL (unico lugar): so encerradas na analitica
