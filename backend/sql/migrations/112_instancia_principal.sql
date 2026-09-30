-- 112_instancia_principal.sql
-- Instância PRINCIPAL da empresa (marcada na tela de Instâncias).
--
-- O QUE ESTA MIGRATION RESOLVE
-- O envio avulso pela ficha do lead (gerar por IA + enviar) precisa de uma instância. Em modo
-- Automático o seletor fica oculto (o operador vê só "Pool: N instâncias"), então o avulso
-- precisa de um PADRÃO estável. "A primeira ativa" muda quando a ordem muda; a PRINCIPAL é uma
-- escolha humana e explícita. Ela só PRÉ-PREENCHE a instância de um envio disparado por uma
-- pessoa — não participa da resolução de instância de envio nem do webhook (Fase 2 intacta).
--
-- POR QUE COLUNA + ÍNDICE PARCIAL, E NÃO config_json
-- "No máximo UMA principal por empresa" é invariante, e este repositório o enforce no BANCO
-- (mesmo padrão de `missoes_uma_ativa...`, `busca_snapshots_uma_ativa...`). Um booleano em
-- config_json não tem como garantir isso — dois cliques marcariam duas.
--
-- ADITIVA. Acrescenta UMA coluna nullable-com-default e um índice; não muta nenhum dado
-- (ninguém nasce principal). SEM DEFAULT diferente de false: uma empresa começa sem principal
-- e cai na 1ª instância ativa até alguém marcar.
-- Rollback: DROP INDEX ...; ALTER TABLE ... DROP COLUMN principal.

ALTER TABLE app.empresa_whatsapp_instances
  ADD COLUMN IF NOT EXISTS principal BOOLEAN NOT NULL DEFAULT false;

-- No máximo uma principal por empresa (parcial: só as marcadas ocupam o índice).
CREATE UNIQUE INDEX IF NOT EXISTS empresa_whatsapp_uma_principal_por_empresa_uk
  ON app.empresa_whatsapp_instances (empresa_id)
  WHERE principal;
