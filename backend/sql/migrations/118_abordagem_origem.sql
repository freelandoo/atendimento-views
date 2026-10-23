-- 118_abordagem_origem.sql
-- ORIENTAÇÃO COMERCIAL que originou cada conversa (oferta + nicho + versões usadas).
--
-- O QUE ESTA MIGRATION RESOLVE
-- A oferta escolhida na primeira abordagem NÃO era persistida em lugar nenhum. `lead_disparos`
-- guarda o TEXTO enviado, não a orientação que o produziu; `vendas.conversas.historico` guarda a
-- mensagem, não a decisão. Consequência medida no código (2026-10-22): quando o lead respondia,
-- `processarMensagemComPlaybook` e `gerarFollowupComPlaybook` montavam o prompt com playbook +
-- insights + histórico e **nada** sobre qual oferta tinha sido apresentada — a IA reabria a
-- conversa pelo carro-chefe do playbook, que pode ser outro. O follow-up tinha o mesmo buraco.
--
-- POR QUE NENHUMA TABELA NOVA
-- `app.lead_insights` já é o estado por (empresa_id, numero) que o runtime do playbook lê a cada
-- turno, e já carrega mais de um `tipo` (`playbook_runtime` desde a 002). Uma tabela nova seria
-- um segundo lugar para a mesma identidade — e um JOIN a mais no caminho mais quente do produto.
-- Esta migration só acrescenta o índice que garante UMA linha de origem por conversa.
--
-- O QUE A LINHA SIGNIFICA — E O QUE ELA NÃO SIGNIFICA
-- É um SNAPSHOT datado: "esta conversa começou com esta oferta". NÃO é referência à configuração
-- viva. A oferta é copiada inteira (nome, descrição, nicho, escopo, se foi apresentada como
-- pronta) justamente para que editar ou apagar a oferta na tela depois não reescreva o passado —
-- a mesma disciplina de `vendas.comissao_percentual` (083) e da missão publicada (085).
-- Ausência de linha = ORIGEM DESCONHECIDA, estado legítimo e de primeira classe: conversa
-- anterior a este deploy, abordagem por template (sem IA) ou abordagem manual pelo wa.me. Não há
-- backfill e não deve haver — atribuir oferta retroativa seria o sistema afirmar o que não viu.
--
-- ADITIVA: cria UM índice. Não cria tabela, não altera coluna e não muta nenhum dado.
-- Rollback: DROP INDEX app.uq_lead_insights_abordagem_origem.

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_insights_abordagem_origem
  ON app.lead_insights (empresa_id, numero)
  WHERE tipo = 'abordagem_origem';
