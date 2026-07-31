-- 048_ligacoes_uma_ativa_por_lead.sql
-- QA (regressao A-G): fecha um buraco de CONCORRENCIA. Antes, "uma ligacao ativa por lead"
-- era garantido so no app (SELECT+INSERT em iniciarLigacao, racy) — dois POST /iniciar
-- concorrentes (ex.: duas abas) criavam DUAS ligacoes 'em_andamento' para o mesmo lead.
-- Agora a invariante e' garantida pelo BANCO (mesma classe de protecao ja usada para
-- client_event_id e para "uma etapa ativa"). Ad-hoc sem lead (campanha_lead_id IS NULL)
-- fica de fora. Aditiva; exige que nao haja duplicatas ativas (verificado no clone: 0).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ligacoes_uma_ativa_por_lead
  ON app.ligacoes (empresa_id, campanha_lead_id)
  WHERE status = 'em_andamento' AND campanha_lead_id IS NOT NULL;
