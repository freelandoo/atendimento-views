-- 065_conversa_nome_whatsapp.sql
-- Nome CRU recebido do WhatsApp (pushName) + indice que torna viavel o nome do Google Maps.
--
-- O QUE ESTA MIGRATION RESOLVE
-- A Central de Mensagens mostrava, na coluna "Lead", o TELEFONE quando nao havia nome — o
-- mesmo dado que ja esta na coluna "Telefone", ao lado. E o nome que o proprio WhatsApp
-- entrega (`pushName`) NAO existia no banco: `capturarNomeContato` (src/agent.js) o passa por
-- `nomeDePushName` (src/nome-contato.js), que fica so' com o PRIMEIRO TOKEN e recusa palavras
-- de negocio (`pizzaria`, `loja`, `clinica`… na lista NAO_NOME). "Pizzaria do Ze" era
-- descartado inteiro e nada era gravado. Ou seja: a melhor fonte de nome do produto estava
-- sendo jogada fora a cada mensagem recebida.
--
-- POR QUE UMA COLUNA NOVA, E EM `vendas.conversas`
-- `lead_profiles.apelido` e' outro fato: e' o nome JA FILTRADO, tratado como nome do contato.
-- Gravar o pushName cru la' misturaria o valor bruto com o valor curado e mudaria o que os
-- prompts leem. A conversa e' o lugar certo: o pushName chega POR MENSAGEM, junto do numero,
-- e e' um atributo do canal, nao do perfil comercial.
--
-- ADITIVA. Nullable, sem DEFAULT, sem CHECK: nenhuma linha existente e' tocada e nenhum
-- comportamento muda ao aplicar. Quem escreve e' `capturarNomeContato`, ao lado do fluxo de
-- identificacao que ja existe.
--
-- O INDICE FUNCIONAL
-- O nome do Google Maps vive em `prospectador.prospects.nome` e nao tem FK com a conversa: o
-- casamento e' por TELEFONE normalizado. Sem indice, resolver o nome de uma pagina de 50
-- conversas varreria a tabela de prospects inteira. A expressao indexada e' exatamente a do
-- lado esquerdo da comparacao em src/db/lead-nome-maps.js — mudar uma exige mudar a outra,
-- senao o indice deixa de ser usado em silencio.
--
-- Ordem de prioridade do nome exibido: src/services/lead-nome-exibicao.js (fonte unica).

ALTER TABLE vendas.conversas
  ADD COLUMN IF NOT EXISTS nome_whatsapp TEXT;

COMMENT ON COLUMN vendas.conversas.nome_whatsapp IS
  'Nome CRU do contato como o WhatsApp entregou (pushName), preservado sem filtro. '
  'Nao confundir com vendas.lead_profiles.apelido, que e o nome ja filtrado por '
  'src/nome-contato.js (primeiro token, sem palavras de negocio). Fonte de prioridade 1 '
  'da coluna Lead da Central de Mensagens (src/services/lead-nome-exibicao.js).';

-- regexp_replace/COALESCE sao IMMUTABLE, entao a expressao pode ser indexada.
CREATE INDEX IF NOT EXISTS idx_prospects_empresa_telefone_digitos
  ON prospectador.prospects (empresa_id, (regexp_replace(COALESCE(telefone, ''), '\D', '', 'g')));
